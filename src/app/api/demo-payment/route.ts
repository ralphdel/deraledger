import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { resolvePaymentRoute, type PaymentMethod } from "@/lib/services/payment-routing.service";
import { getAppUrl } from "@/lib/server-utils";

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

    const { invoiceId, paymentAmount, paymentMethod } = body;

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
      .select("payment_subaccount_code, verification_status, live_features_enabled, setup_mode")
      .eq("id", invoice.merchant_id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    if (
      merchant.verification_status !== "verified" ||
      merchant.setup_mode === true ||
      merchant.live_features_enabled === false ||
      !merchant.payment_subaccount_code
    ) {
      return NextResponse.json({ error: "Merchant is not verified or has no settlement account set up" }, { status: 403 });
    }

    const selectedMethod = (paymentMethod || "card") as PaymentMethod;
    const route = await resolvePaymentRoute("invoice_payment", selectedMethod);

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
    const appUrl = getAppUrl();

    const metadata = {
      type: "invoice_payment",
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      merchant_id: invoice.merchant_id,
      payment_amount: cappedPayment,
      k_factor: kFactor,
      payment_method_requested: selectedMethod,
      resolved_provider: route.provider,
      payment_purpose: "invoice_payment",
    };

    if (selectedMethod === "crypto") {
      const cryptoResponse = await fetch(`${appUrl}/api/checkout/crypto-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: invoice.id,
          paymentAmount: cappedPayment,
          rail: body.rail || invoice.crypto_asset || "USDT",
        }),
      });

      const cryptoResult = await cryptoResponse.json().catch(() => ({}));
      if (!cryptoResponse.ok) {
        return NextResponse.json(
          { error: cryptoResult?.error || "Crypto checkout initialization failed." },
          { status: cryptoResponse.status }
        );
      }

      return NextResponse.json(cryptoResult);
    }

    // Default: Fiat Checkout
    const callback = new URL(`${appUrl}/pay/${invoiceId}`);
    callback.searchParams.set("reference", reference);
    callback.searchParams.set("provider", route.provider);

    const result = await PaymentService.initializeTransaction({
      email: invoice.clients?.email || "customer@deraledger.app",
      amountKobo: chargeAmountKobo,
      reference,
      subaccountCode: merchant.payment_subaccount_code,
      callbackUrl: callback.toString(),
      bearer: "account",
      paymentMethod: selectedMethod,
      metadata,
    }, route.provider === "monnify" ? "monnify" : "paystack");

    return NextResponse.json({
      success: true,
      authorizationUrl: result.authorizationUrl,
      accessCode: result.accessCode,
      reference: result.reference,
      provider: route.provider,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize payment";
    console.error("Payment initialization failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
