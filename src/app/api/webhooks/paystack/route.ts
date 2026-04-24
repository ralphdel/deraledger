import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  // Verify webhook signature (production security)
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (secret && signature) {
    const hash = crypto.createHmac("sha512", secret).update(body).digest("hex");
    if (hash !== signature) {
      return new NextResponse("Invalid signature", { status: 401 });
    }
  }

  const event = JSON.parse(body);

  // Only process successful charges
  if (event.event !== "charge.success") {
    return NextResponse.json({ received: true });
  }

  const { metadata, amount, reference, channel } = event.data;
  const invoiceId: string = metadata?.invoice_id;
  const paymentAmount: number = metadata?.payment_amount; // The actual invoice payment amount (before any fee markup)

  if (!invoiceId || !paymentAmount) {
    console.error("Webhook missing invoice_id or payment_amount in metadata");
    return NextResponse.json({ received: true });
  }

  // Idempotency: skip if this reference was already processed
  const { data: existingTxn } = await supabase
    .from("transactions")
    .select("id")
    .eq("paystack_reference", reference)
    .single();

  if (existingTxn) {
    console.log("Duplicate webhook, skipping:", reference);
    return NextResponse.json({ received: true });
  }

  // Fetch the current invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (invoiceError || !invoice) {
    console.error("Invoice not found:", invoiceId);
    return NextResponse.json({ received: true });
  }

  const currentOutstanding = Number(invoice.outstanding_balance);
  const currentAmountPaid = Number(invoice.amount_paid);

  // Calculate new balances
  const newAmountPaid = currentAmountPaid + paymentAmount;
  const newOutstanding = Math.max(0, currentOutstanding - paymentAmount);
  const newStatus = newOutstanding <= 0 ? "closed" : "partially_paid";

  // 1. Update invoice balances
  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      amount_paid: newAmountPaid,
      outstanding_balance: newOutstanding,
      status: newStatus,
    })
    .eq("id", invoiceId);

  if (updateError) {
    console.error("Failed to update invoice:", updateError);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Calculate proportional fields
  const kFactor = Number(metadata?.k_factor) || (currentOutstanding > 0 ? paymentAmount / currentOutstanding : 0);
  const taxCollected = Math.round((kFactor * Number(invoice.tax_value)) * 100) / 100;
  const discountApplied = Math.round((kFactor * Number(invoice.discount_value)) * 100) / 100;
  const rawFee = paymentAmount * 0.015 + 100;
  const paystackFee = invoice.fee_absorption === "customer" ? Math.min(rawFee, 2000) : 0;

  // 2. Record the transaction
  const paymentMethod = channel === "card" ? "card" : channel === "bank" ? "bank_transfer" : "ussd";
  const { error: txnError } = await supabase.from("transactions").insert({
    invoice_id: invoiceId,
    merchant_id: invoice.merchant_id,
    amount_paid: paymentAmount,
    k_factor: kFactor,
    tax_collected: taxCollected,
    discount_applied: discountApplied,
    paystack_fee: paystackFee,
    fee_absorbed_by: invoice.fee_absorption || "business",
    payment_method: paymentMethod,
    paystack_reference: reference,
    status: "success",
  });
  
  if (txnError) {
    console.error("Failed to insert transaction:", txnError);
  }

  console.log(`✅ Payment recorded: ${reference} — ₦${paymentAmount} on invoice ${invoiceId}`);

  // 3. Record audit log
  await supabase.from("audit_logs").insert({
    event_type: "payment_received",
    actor_id: null,
    actor_role: "system",
    target_id: invoiceId,
    target_type: "invoice",
    metadata: {
      actor_merchant_id: invoice.merchant_id,
      actor_name: "System (Paystack Webhook)",
      amount: paymentAmount,
      reference: reference
    }
  });

  // 4. Send email receipt
  // We need to fetch the client info because we didn't populate it in the invoice query
  const { data: fullInvoice } = await supabase
    .from("invoices")
    .select("*, clients(email, full_name)")
    .eq("id", invoiceId)
    .single();

  if (fullInvoice?.clients?.email) {
    const { sendPaymentReceiptEmail } = await import("@/lib/brevo");
    const { formatNaira } = await import("@/lib/calculations");
    
    const { data: merchantData } = await supabase
      .from("merchants")
      .select("business_name")
      .eq("id", invoice.merchant_id)
      .single();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const paymentUrl = `${appUrl}/pay/${invoice.id}`;

    await sendPaymentReceiptEmail(
      fullInvoice.clients.email,
      fullInvoice.clients.full_name || "Valued Client",
      merchantData?.business_name || "PurpLedger Merchant",
      invoice.invoice_number,
      formatNaira(paymentAmount),
      formatNaira(newOutstanding),
      invoice.pay_by_date ? new Date(invoice.pay_by_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
      paymentUrl
    ).catch(e => console.error("Failed to send receipt email:", e));
  }

  return NextResponse.json({ received: true });
}
