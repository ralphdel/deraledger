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

  const { invoiceId, paymentAmount } = await request.json();

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
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (["closed", "manually_closed", "void"].includes(invoice.status)) {
    return NextResponse.json({ error: "Invoice is already closed" }, { status: 400 });
  }

  const currentOutstanding = Number(invoice.outstanding_balance);
  const currentAmountPaid = Number(invoice.amount_paid);

  if (paymentAmount > currentOutstanding) {
    return NextResponse.json({ error: "Payment exceeds outstanding balance" }, { status: 400 });
  }

  // Calculate new balances
  const newAmountPaid = currentAmountPaid + paymentAmount;
  const newOutstanding = Math.max(0, currentOutstanding - paymentAmount);
  const newStatus = newOutstanding <= 0 ? "closed" : "partially_paid";

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
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // 2. Record a demo transaction
  const demoRef = `demo_${invoiceId.slice(0, 8)}_${Date.now()}`;
  await supabase.from("transactions").insert({
    invoice_id: invoiceId,
    amount_paid: paymentAmount,
    payment_method: "bank_transfer",
    paystack_reference: demoRef,
    status: "success",
  });

  return NextResponse.json({
    success: true,
    newAmountPaid,
    newOutstanding,
    newStatus,
    reference: demoRef,
  });
}
