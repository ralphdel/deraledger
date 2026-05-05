import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/admin/invoices/repair-types
 *
 * Corrects invoices that were incorrectly created as 'collection' type
 * for merchants on the Starter plan. These invoices have no Paystack
 * transactions (no payment was ever attempted) and should be 'record' type.
 *
 * Optionally accepts { email } to target a specific merchant only.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const targetEmail: string | undefined = body.email;

  // Find all Starter plan merchants (or just the target one)
  let merchantQuery = supabase
    .from("merchants")
    .select("id, email, business_name, subscription_plan")
    .eq("subscription_plan", "starter");

  if (targetEmail) {
    merchantQuery = merchantQuery.eq("email", targetEmail) as any;
  }

  const { data: starterMerchants, error: merchantError } = await merchantQuery;

  if (merchantError || !starterMerchants) {
    return NextResponse.json({ error: "Failed to fetch merchants" }, { status: 500 });
  }

  if (starterMerchants.length === 0) {
    return NextResponse.json({
      success: true,
      summary: { merchants_scanned: 0, invoices_repaired: 0 },
      repaired: [],
    });
  }

  const merchantIds = starterMerchants.map(m => m.id);

  // Find all collection invoices for these merchants
  const { data: wrongInvoices, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, invoice_number, merchant_id, invoice_type, grand_total, created_at")
    .in("merchant_id", merchantIds)
    .eq("invoice_type", "collection");

  if (invoiceError) {
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }

  if (!wrongInvoices || wrongInvoices.length === 0) {
    return NextResponse.json({
      success: true,
      summary: { merchants_scanned: starterMerchants.length, invoices_repaired: 0 },
      repaired: [],
      message: "No incorrect invoices found — all starter plan invoices are already correct.",
    });
  }

  // For each wrongly-typed invoice, check if it has any Paystack transactions
  // (if it does, someone actually paid it — leave it alone, log it)
  const repaired = [];
  const skipped = [];

  for (const inv of wrongInvoices) {
    const { data: txns } = await supabase
      .from("transactions")
      .select("id")
      .eq("invoice_id", inv.id)
      .limit(1);

    if (txns && txns.length > 0) {
      // Invoice has been paid — skip it, flag for review
      skipped.push({ invoice_id: inv.id, invoice_number: inv.invoice_number, reason: "Has transactions — manual review needed" });
      continue;
    }

    // Safe to fix — no transactions
    const { error: updateError } = await supabase
      .from("invoices")
      .update({ invoice_type: "record" })
      .eq("id", inv.id);

    if (updateError) {
      skipped.push({ invoice_id: inv.id, invoice_number: inv.invoice_number, reason: updateError.message });
      continue;
    }

    const merchant = starterMerchants.find(m => m.id === inv.merchant_id);
    repaired.push({
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      merchant_email: merchant?.email,
      merchant_name: merchant?.business_name,
      grand_total: inv.grand_total,
    });

    // Log to audit
    await supabase.from("audit_logs").insert({
      event_type: "invoice_type_corrected",
      actor_id: null,
      actor_role: "system",
      target_id: inv.id,
      target_type: "invoice",
      metadata: {
        actor_name: "Admin Data Repair Tool",
        merchant_id: inv.merchant_id,
        invoice_number: inv.invoice_number,
        old_type: "collection",
        new_type: "record",
        note: "Invoice incorrectly created as collection type for a Starter plan merchant — corrected to record.",
      },
    });
  }

  return NextResponse.json({
    success: true,
    summary: {
      merchants_scanned: starterMerchants.length,
      invoices_checked: wrongInvoices.length,
      invoices_repaired: repaired.length,
      invoices_skipped: skipped.length,
    },
    repaired,
    skipped,
  });
}
