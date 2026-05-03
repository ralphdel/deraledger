import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendSubscriptionExpiringEmail } from "@/lib/brevo";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { subscriptionId, merchantId } = await request.json();

    if (!subscriptionId || !merchantId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Fetch subscription and merchant data
    const { data: sub, error: subError } = await supabase
      .from("subscriptions")
      .select(`
        plan_type,
        expiry_date,
        merchants (
          email,
          business_name
        )
      `)
      .eq("id", subscriptionId)
      .single();

    if (subError || !sub) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const merchant = Array.isArray(sub.merchants) ? sub.merchants[0] : sub.merchants;
    if (!merchant?.email) {
      return NextResponse.json({ error: "Merchant email not found" }, { status: 400 });
    }

    // Calculate days remaining
    const expiryDate = new Date(sub.expiry_date);
    const now = new Date();
    const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Send email via Brevo
    await sendSubscriptionExpiringEmail(
      merchant.email,
      merchant.business_name,
      sub.plan_type,
      sub.expiry_date,
      daysRemaining
    );

    // Log to audit
    await supabase.from("audit_logs").insert({
      event_type: "manual_subscription_reminder_sent",
      actor_id: null,
      actor_role: "admin",
      target_id: merchantId,
      target_type: "merchant",
      metadata: {
        subscription_id: subscriptionId,
        days_remaining: daysRemaining
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to send manual reminder:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
