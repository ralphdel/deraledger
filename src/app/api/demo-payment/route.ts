import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * DEMO payment endpoint — simulates what the Paystack webhook does.
 * Accepts: { invoiceId, paymentAmount }
 * This endpoint should be DISABLED or REMOVED in production.
 */
export async function POST(request: Request) {
  // Only allow in non-production environments
  if (process.env.NODE_ENV === "production" && !process.env.ENABLE_DEMO_PAYMENTS) {
    return new NextResponse("Demo payments are disabled in production", { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { invoiceId, paymentAmount } = body;

  if (!invoiceId || !paymentAmount || paymentAmount <= 0) {
    return NextResponse.json({ error: "Missing invoiceId or paymentAmount" }, { status: 400 });
  }

  // Fetch the current invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (invoiceError || !invoice) {
    return NextResponse.json({ error: "Invoice not found: " + invoiceError?.message }, { status: 404 });
  }

  if (["closed", "manually_closed", "void"].includes(invoice.status)) {
    return NextResponse.json({ error: "Invoice is already closed" }, { status: 400 });
  }

  const currentOutstanding = Number(invoice.outstanding_balance);
  const currentAmountPaid = Number(invoice.amount_paid);
  const grandTotal = Number(invoice.grand_total);

  if (paymentAmount > currentOutstanding + 0.01) {
    return NextResponse.json({ error: "Payment exceeds outstanding balance" }, { status: 400 });
  }

  const cappedPayment = Math.min(paymentAmount, currentOutstanding);

  // k-factor = proportion of the full invoice this payment represents
  const kFactor = grandTotal > 0 ? cappedPayment / grandTotal : 0;
  const taxCollected = kFactor * Number(invoice.tax_value);
  const discountApplied = kFactor * Number(invoice.discount_value);

  // Paystack fee simulation (1.5% + ₦100, capped at ₦2000)
  const rawFee = cappedPayment * 0.015 + 100;
  const paystackFee = invoice.fee_absorption === "customer" ? Math.min(rawFee, 2000) : 0;

  // Calculate new balances
  const newAmountPaid = currentAmountPaid + cappedPayment;
  const newOutstanding = Math.max(0, currentOutstanding - cappedPayment);
  const newStatus = newOutstanding <= 0.01 ? "closed" : "partially_paid";

  // 1. Update invoice
  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      amount_paid: newAmountPaid,
      outstanding_balance: newOutstanding,
      status: newStatus,
    })
    .eq("id", invoiceId);

  if (updateError) {
    return NextResponse.json({ error: "Failed to update invoice: " + updateError.message }, { status: 500 });
  }

  // 2. Record the transaction with ALL required fields
  const demoRef = `demo_${invoiceId.slice(0, 8)}_${Date.now()}`;
  const { error: txnError } = await supabase.from("transactions").insert({
    invoice_id: invoiceId,
    merchant_id: invoice.merchant_id,
    amount_paid: cappedPayment,
    k_factor: kFactor,
    tax_collected: taxCollected,
    discount_applied: discountApplied,
    paystack_fee: paystackFee,
    fee_absorbed_by: invoice.fee_absorption || "business",
    payment_method: "bank_transfer",
    paystack_reference: demoRef,
    status: "success",
  });

  if (txnError) {
    // Invoice updated but transaction log failed — non-fatal, log it
    console.error("Transaction log failed (non-fatal):", txnError.message);
  }

  return NextResponse.json({
    success: true,
    newAmountPaid,
    newOutstanding,
    newStatus,
    reference: demoRef,
  });
}
