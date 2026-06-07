import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";
import { sendOnboardingWelcomeEmail } from "@/lib/brevo";
import { getAppUrl } from "@/lib/server-utils";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = (await request.json().catch(() => null)) as { paymentRecordId?: string } | null;
  const paymentRecordId = body?.paymentRecordId;
  if (!paymentRecordId) {
    return NextResponse.json({ error: "Missing payment record id." }, { status: 400 });
  }

  const { data: record, error: recordError } = await supabase
    .from("payment_records")
    .select("id, customer_email, merchant_id, plan_id, plan_name, payment_status, processing_status, account_setup_status, password_setup_required, setup_recovery_email_count")
    .eq("id", paymentRecordId)
    .maybeSingle();

  if (recordError) {
    return NextResponse.json({ error: recordError.message }, { status: 500 });
  }

  if (!record) {
    return NextResponse.json({ error: "Payment record not found." }, { status: 404 });
  }

  const isPaid =
    record.payment_status === "successful" &&
    record.processing_status === "processed" &&
    (record.account_setup_status === "active_pending_password" ||
      record.account_setup_status === "paid_pending_setup" ||
      record.account_setup_status === "active");

  if (!isPaid || !record.customer_email) {
    return NextResponse.json(
      { error: "Setup links can only be resent for successfully processed paid setup records." },
      { status: 400 }
    );
  }

  const { data: merchant } = record.merchant_id
    ? await supabase
        .from("merchants")
        .select("business_name, trading_name, subscription_plan, merchant_tier")
        .eq("id", record.merchant_id)
        .maybeSingle()
    : { data: null };

  const normalizedEmail = String(record.customer_email).toLowerCase().trim();
  const { data: magicLinkData, error: magicError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: normalizedEmail,
  });

  if (magicError || !magicLinkData?.properties?.email_otp) {
    return NextResponse.json(
      { error: magicError?.message || "Failed to generate setup link." },
      { status: 500 }
    );
  }

  const otp = magicLinkData.properties.email_otp;
  const setupLink = `${getAppUrl()}/auth/verify?token=${otp}&email=${encodeURIComponent(
    normalizedEmail
  )}&type=magiclink&next=${encodeURIComponent("/onboarding/set-password")}`;
  const planLabel = normalizePlanLabel(
    merchant?.subscription_plan || merchant?.merchant_tier || record.plan_id || record.plan_name
  );
  const businessName = merchant?.trading_name || merchant?.business_name || "your business";

  const emailResult = await sendOnboardingWelcomeEmail(normalizedEmail, businessName, planLabel, setupLink);
  if (!emailResult.success) {
    return NextResponse.json(
      { error: emailResult.error || "Failed to send setup email." },
      { status: 500 }
    );
  }

  const { error: updateError } = await supabase
    .from("payment_records")
    .update({
      setup_recovery_email_sent_at: new Date().toISOString(),
      setup_recovery_email_count: Number(record.setup_recovery_email_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentRecordId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

function normalizePlanLabel(value: unknown): "starter" | "individual" | "corporate" {
  if (value === "corporate") return "corporate";
  if (value === "starter") return "starter";
  return "individual";
}
