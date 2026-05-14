import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Initializes a live payment transaction using the configured PaymentService.
 * Replaces the old demo logic.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const { invoiceId, paymentAmount } = body;

    if (!invoiceId || !paymentAmount || paymentAmount <= 0) {
      return NextResponse.json({ error: "Missing invoiceId or paymentAmount" }, { status: 400 });
    }

    // Fetch the current invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("*, clients(email, full_name)")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found: " + invoiceError?.message }, { status: 404 });
    }

    if (["closed", "manually_closed", "void"].includes(invoice.status)) {
      return NextResponse.json({ error: "Invoice is already closed" }, { status: 400 });
    }

    const currentOutstanding = Number(invoice.outstanding_balance);
    const grandTotal = Number(invoice.grand_total);

    if (paymentAmount > currentOutstanding + 0.01) {
      return NextResponse.json({ error: "Payment exceeds outstanding balance" }, { status: 400 });
    }

    const cappedPayment = Math.min(paymentAmount, currentOutstanding);

    // Fetch the merchant to get the subaccount code
    const { data: merchant, error: merchantError } = await supabase
      .from("merchants")
      .select("payment_subaccount_code, verification_status")
      .eq("id", invoice.merchant_id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    if (merchant.verification_status !== "verified" || !merchant.payment_subaccount_code) {
      return NextResponse.json({ error: "Merchant is not verified or has no settlement account set up" }, { status: 403 });
    }

    if (invoice.payment_provider === "monnify") {
      return NextResponse.json({ 
        error: "Monnify is currently undergoing maintenance. Please contact the merchant for an alternative payment link." 
      }, { status: 400 });
    }

    // Calculate k-factor and total charge
    const kFactor = grandTotal > 0 ? cappedPayment / grandTotal : 0;
    
    // Calculate fee (same logic as before, handled by payment provider in reality but we specify total)
    // If fee_absorption is customer, we must charge the amount + paystack fee.
    // Paystack fee is 1.5% + 100 capped at 2000.
    const rawFee = cappedPayment * 0.015 + 100;
    const paystackFee = invoice.fee_absorption === "customer" ? Math.min(rawFee, 2000) : 0;
    const chargeAmount = cappedPayment + paystackFee;
    const chargeAmountKobo = Math.round(chargeAmount * 100);

    const reference = `purp_${invoiceId.slice(0, 8)}_${Date.now()}`;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const metadata = {
      type: "invoice_payment",
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      merchant_id: invoice.merchant_id,
      payment_amount: cappedPayment,
      k_factor: kFactor,
    };

    if (invoice.payment_provider === "breet") {
      // Crypto Checkout
      const result = await PaymentService.generateCryptoDepositAddress({
        assetId: "BTC", // Defaulting to BTC for Breet scaffold
        label: reference,
      });

      return NextResponse.json({
        success: true,
        isCrypto: true,
        cryptoAddress: result.address,
        cryptoNetwork: result.asset || "BTC",
        cryptoCoin: result.asset || "BTC",
        fiatAmount: chargeAmount,
        reference,
      });
    }

    // Default: Fiat Checkout (Paystack)
    const result = await PaymentService.initializeTransaction({
      email: invoice.clients?.email || "customer@deraledger.app",
      amountKobo: chargeAmountKobo,
      reference,
      subaccountCode: merchant.payment_subaccount_code,
      callbackUrl: `${appUrl}/pay/${invoiceId}?reference=${reference}`,
      bearer: "account",
      metadata,
    });

    return NextResponse.json({
      success: true,
      authorizationUrl: result.authorizationUrl,
      accessCode: result.accessCode,
      reference: result.reference,
    });

  } catch (error: any) {
    console.error("Payment initialization failed:", error);
    return NextResponse.json({ error: error.message || "Failed to initialize payment" }, { status: 500 });
  }
}
