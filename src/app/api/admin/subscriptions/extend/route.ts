import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { subscriptionId, merchantId, days, reason } = await request.json();

    if (!subscriptionId || !merchantId || !days || !reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get current subscription
    const { data: sub, error: subError } = await supabase
      .from("subscriptions")
      .select("expiry_date")
      .eq("id", subscriptionId)
      .single();

    if (subError || !sub) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    // Calculate new expiry
    const newExpiry = new Date(sub.expiry_date);
    newExpiry.setDate(newExpiry.getDate() + days);

    // Update subscription
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({ expiry_date: newExpiry.toISOString(), status: "active" }) // Status becomes active if it was expired
      .eq("id", subscriptionId);

    if (updateError) {
      throw updateError;
    }

    // Log to audit_logs
    await supabase.from("audit_logs").insert({
      event_type: "subscription_extended",
      actor_id: null,
      actor_role: "admin",
      target_id: merchantId,
      target_type: "merchant",
      metadata: {
        subscription_id: subscriptionId,
        days_extended: days,
        reason: reason,
        old_expiry: sub.expiry_date,
        new_expiry: newExpiry.toISOString()
      }
    });

    return NextResponse.json({ success: true, newExpiry: newExpiry.toISOString() });
  } catch (error: any) {
    console.error("Failed to extend subscription:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
