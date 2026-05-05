import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { calculateSubscriptionExpiry, PlanType } from "@/lib/subscription";

const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/payment/verify-renew
 *
 * Called after a renewal payment redirect from Paystack.
 * This is the authoritative provisioning step — it verifies the payment
 * with Paystack directly and provisions the new subscription immediately.
 *
 * This ensures renewal works even if the Paystack webhook is delayed,
 * fails to reach the server (e.g. dev environment), or fires after this runs.
 *
 * The webhook handler has its own idempotency check via subscription_payments
 * so double-processing is safe.
 */
export async function POST(request: Request) {
  try {
    const { reference } = await request.json();
    if (!reference) {
      return NextResponse.json({ error: "Missing reference" }, { status: 400 });
    }

    // 1. Verify with Paystack directly — source of truth
    const tx = await PaymentService.verifyTransaction(reference);

    if (tx.status !== "success") {
      return NextResponse.json({ error: "Payment not successful" }, { status: 400 });
    }

    const metadata = tx.metadata as Record<string, any> | undefined;

    if (metadata?.type !== "subscription_renewal") {
      // Not a renewal, ignore gracefully
      return NextResponse.json({ success: true, ignored: true });
    }

    const merchantId = metadata.merchant_id as string | undefined;
    const plan = metadata.plan as "individual" | "corporate" | undefined;

    if (!merchantId || !plan) {
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
    }

    // 2. Idempotency — check if this reference was already processed
    const { data: existingPayment } = await supabaseAdmin
      .from("subscription_payments")
      .select("id")
      .eq("paystack_ref", reference)
      .single();

    if (existingPayment) {
      // Already processed (likely by the webhook), just confirm success
      console.log("verify-renew: Already processed by webhook, returning success:", reference);
      return NextResponse.json({ success: true, already_processed: true });
    }

    // 3. Calculate new expiry
    const amountPaidNgn = Number(tx.amount) / 100;

    const { data: currentSub } = await supabaseAdmin
      .from("subscriptions")
      .select("plan_type, expiry_date, status")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const expiryDate = calculateSubscriptionExpiry(
      amountPaidNgn,
      plan as PlanType,
      currentSub ? { planType: currentSub.plan_type as PlanType, expiryDate: currentSub.expiry_date } : undefined
    );

    const periodStart = currentSub && new Date(currentSub.expiry_date) > new Date()
      ? new Date(currentSub.expiry_date).toISOString()
      : new Date().toISOString();

    // 4. Update the single subscription row (upsert)
    // The subscriptions table has a UNIQUE constraint on merchant_id.
    const { error: upsertError } = await supabaseAdmin
      .from("subscriptions")
      .upsert({
        merchant_id: merchantId,
        plan_type: plan,
        amount_paid: amountPaidNgn,
        start_date: new Date().toISOString(),
        expiry_date: expiryDate.toISOString(),
        status: "active",
        last_notified_at: null,
        is_banner_dismissed: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'merchant_id' });

    if (upsertError) {
      console.error("verify-renew: Failed to upsert subscription:", upsertError.message);
      return NextResponse.json({ error: "Failed to update subscription: " + upsertError.message }, { status: 500 });
    }

    // 6. Update merchant plan and clear notifications
    await supabaseAdmin
      .from("merchants")
      .update({
        subscription_plan: plan,
        merchant_tier: plan,
        monthly_collection_limit: plan === "individual" ? 5000000 : 0,
        subscription_notifications_sent: {},
      })
      .eq("id", merchantId);

    // 7. Record in subscription_payments for idempotency
    await supabaseAdmin.from("subscription_payments").insert({
      merchant_id: merchantId,
      plan,
      amount_ngn: amountPaidNgn,
      period_start: periodStart,
      period_end: expiryDate.toISOString(),
      paystack_ref: reference,
      payment_type: "renewal",
      status: "paid",
    });

    // 8. Audit log
    await supabaseAdmin.from("audit_logs").insert({
      event_type: "subscription_renewed",
      actor_id: null,
      actor_role: "system",
      target_id: merchantId,
      target_type: "merchant",
      metadata: {
        actor_name: "System (Callback Verify)",
        plan,
        reference,
        amount_ngn: amountPaidNgn,
        expiry_date: expiryDate.toISOString(),
        note: "Provisioned via verify-renew callback (not webhook)",
      },
    });

    console.log(`✅ verify-renew: Renewal provisioned for ${merchantId} — ${plan} until ${expiryDate.toISOString()}`);
    return NextResponse.json({
      success: true,
      plan,
      expiry_date: expiryDate.toISOString(),
    });
  } catch (error: any) {
    console.error("verify-renew: Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
