import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/admin/subscriptions/repair
 *
 * Scans all subscriptions and corrects merchants whose most recently created
 * subscription has expiry_date > now but status = "expired" — this is the
 * symptom of the ordering bug where the system incorrectly marked the new
 * active row as expired instead of the old one.
 *
 * Also accepts an optional `email` body param to target a single merchant.
 *
 * Returns a summary of what was fixed.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const targetEmail: string | undefined = body.email;

  const now = new Date().toISOString();

  // 1. Fetch ALL subscriptions (or just for the target merchant)
  let query = supabase
    .from("subscriptions")
    .select("id, merchant_id, plan_type, status, expiry_date, created_at")
    .order("created_at", { ascending: false });

  if (targetEmail) {
    // Lookup the merchant id first
    const { data: merchantRow } = await supabase
      .from("merchants")
      .select("id, email, business_name, subscription_plan")
      .eq("email", targetEmail)
      .single();

    if (!merchantRow) {
      return NextResponse.json({ error: `Merchant not found for email: ${targetEmail}` }, { status: 404 });
    }

    query = query.eq("merchant_id", merchantRow.id) as any;
  }

  const { data: allSubs, error: fetchError } = await query;

  if (fetchError || !allSubs) {
    console.error("Repair: failed to fetch subscriptions", fetchError);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }

  // 2. Group by merchant_id — keep only the most recently created row per merchant
  const latestPerMerchant = new Map<string, typeof allSubs[0]>();
  for (const sub of allSubs) {
    if (!latestPerMerchant.has(sub.merchant_id)) {
      latestPerMerchant.set(sub.merchant_id, sub);
    }
  }

  const repaired: Array<{
    merchant_id: string;
    subscription_id: string;
    plan_type: string;
    expiry_date: string;
    old_status: string;
  }> = [];
  const alreadyOk: string[] = [];
  const errors: string[] = [];

  // 3. For each merchant's most recent subscription:
  //    If expiry_date > now AND status = "expired" → it was incorrectly expired, fix it
  for (const [merchantId, sub] of latestPerMerchant.entries()) {
    if (sub.status === "expired" && sub.expiry_date > now) {
      // This subscription should still be active — fix it
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({ status: "active" })
        .eq("id", sub.id);

      if (updateError) {
        console.error(`Repair: failed to fix subscription ${sub.id}:`, updateError.message);
        errors.push(`merchant_id=${merchantId}: ${updateError.message}`);
        continue;
      }

      // Also ensure the merchant's subscription_plan column is correct
      await supabase
        .from("merchants")
        .update({
          subscription_plan: sub.plan_type,
          merchant_tier: sub.plan_type,
        })
        .eq("id", merchantId);

      // Log the repair to audit
      await supabase.from("audit_logs").insert({
        event_type: "subscription_repaired",
        actor_id: null,
        actor_role: "system",
        target_id: merchantId,
        target_type: "merchant",
        metadata: {
          actor_name: "Admin Data Repair Tool",
          subscription_id: sub.id,
          plan_type: sub.plan_type,
          expiry_date: sub.expiry_date,
          note: "Subscription incorrectly marked expired due to ordering bug — restored to active.",
        },
      });

      repaired.push({
        merchant_id: merchantId,
        subscription_id: sub.id,
        plan_type: sub.plan_type,
        expiry_date: sub.expiry_date,
        old_status: "expired",
      });
    } else {
      alreadyOk.push(merchantId);
    }
  }

  return NextResponse.json({
    success: true,
    summary: {
      total_scanned: latestPerMerchant.size,
      repaired: repaired.length,
      already_ok: alreadyOk.length,
      errors: errors.length,
    },
    repaired,
    errors,
  });
}
