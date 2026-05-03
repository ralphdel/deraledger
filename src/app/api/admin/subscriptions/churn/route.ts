import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    // Update subscription status to cancelled
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({ status: "cancelled" })
      .eq("id", subscriptionId);

    if (updateError) {
      throw updateError;
    }

    // Log to audit_logs
    await supabase.from("audit_logs").insert({
      event_type: "subscription_cancelled_admin",
      actor_id: null,
      actor_role: "admin",
      target_id: merchantId,
      target_type: "merchant",
      metadata: {
        subscription_id: subscriptionId,
        reason: "Marked as churned by admin"
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to mark as churned:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
