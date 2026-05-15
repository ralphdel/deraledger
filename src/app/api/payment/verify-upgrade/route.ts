import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";

const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { reference } = await request.json();
    if (!reference) {
      return NextResponse.json({ error: "Missing reference" }, { status: 400 });
    }

    // Verify with Paystack
    const tx = await PaymentService.verifyTransaction(reference);
    
    if (tx.status !== "success") {
      return NextResponse.json({ error: "Payment not successful" }, { status: 400 });
    }

    const metadata = tx.metadata as Record<string, any> | undefined;
    
    if (metadata?.type !== "subscription_upgrade") {
      return NextResponse.json({ success: true, ignored: true });
    }

    const merchantId = metadata.merchant_id;
    const newPlan = metadata.new_plan;
    const ownerName = metadata.owner_name || null;

    if (!merchantId || !newPlan) {
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
    }

    // Check if already updated (idempotency) and get current owner name
    const { data: merchant } = await supabaseAdmin
      .from("merchants")
      .select("subscription_plan, owner_name")
      .eq("id", merchantId)
      .single();

    if (merchant && merchant.subscription_plan === newPlan) {
      return NextResponse.json({ success: true, already_updated: true });
    }

    // Update merchant plan and limits
    const updates: Record<string, any> = {
      subscription_plan: newPlan,
      merchant_tier: newPlan,
      monthly_collection_limit: newPlan === "individual" ? 5000000 : 0,
    };

    if (ownerName) {
      updates.owner_name = ownerName;
      // If the owner name has changed, reset the identity verification so the new director can verify
      if (merchant?.owner_name && merchant.owner_name !== ownerName) {
        updates.bvn = null;
        updates.bvn_status = "unverified";
        updates.selfie_url = null;
        updates.selfie_status = "unverified";
        updates.verification_status = "unverified";
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from("merchants")
      .update(updates)
      .eq("id", merchantId);

    if (updateError) {
      console.error("Failed to verify upgrade (db error):", updateError.message);
      return NextResponse.json({ error: "Database update failed" }, { status: 500 });
    }

    // Log to audit (only if not already logged)
    const { data: existingLog } = await supabaseAdmin
      .from("audit_logs")
      .select("id")
      .eq("target_id", merchantId)
      .eq("event_type", "subscription_upgraded")
      .contains("metadata", { reference })
      .single();

    if (!existingLog) {
      await supabaseAdmin.from("audit_logs").insert({
        event_type: "subscription_upgraded",
        actor_id: null,
        actor_role: "system",
        target_id: merchantId,
        target_type: "merchant",
        metadata: {
          actor_name: "System (Callback Verify)",
          new_plan: newPlan,
          reference,
          amount_ngn: Number(tx.amount) / 100,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Verify upgrade failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
