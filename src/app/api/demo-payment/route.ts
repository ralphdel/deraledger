import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { getPaymentEnvironmentForMerchantEmail, resolvePaymentRoute, type PaymentMethod } from "@/lib/services/payment-routing.service";
import { isLiveFeatureEnabled } from "@/lib/services/onboarding-flow.service";
import { getProviderSettlementMapping, isProviderSettlementReady } from "@/lib/services/settlement-ledger.service";
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
      .select("id, email, payment_subaccount_code, subscription_plan, merchant_tier, verification_status, bvn_status, selfie_status, cac_status, utility_status, business_affiliation_status, live_features_enabled, setup_mode")
      .eq("id", invoice.merchant_id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    if (!isLiveFeatureEnabled(merchant)) {
      return NextResponse.json({ error: "Merchant is not verified or has no settlement account set up" }, { status: 403 });
    }

    const selectedMethod = (paymentMethod || "card") as PaymentMethod;
    const paymentEnvironment = getPaymentEnvironmentForMerchantEmail(merchant.email);
    const route = await resolvePaymentRoute(
      "invoice_payment",
      selectedMethod,
      paymentEnvironment
    );

    const providerReady = await isProviderSettlementReady(supabase, {
      merchantId: invoice.merchant_id,
      provider: route.provider,
      environment: paymentEnvironment,
    });

    if (!providerReady) {
      const message =
        route.provider === "monnify"
          ? "Monnify settlement account is not ready. OPay is temporarily unavailable for Monnify subaccount setup. Please add another bank account or choose another payment method."
          : "Merchant is not verified or has no settlement account set up";
      return NextResponse.json({ error: message }, { status: 403 });
    }

    const monnifySettlement =
      route.provider === "monnify"
        ? await getProviderSettlementMapping(supabase, {
            merchantId: merchant.id,
            provider: "monnify",
            environment: paymentEnvironment,
          })
        : null;

    if (
      route.provider === "monnify" &&
      (!monnifySettlement?.ready || !monnifySettlement.mapping?.provider_subaccount_code)
    ) {
      const providerMessage = monnifySettlement?.readiness?.merchant_message;
      return NextResponse.json(
        {
          error:
            providerMessage
              ? `Monnify settlement account is not ready. ${providerMessage.replace(/\.$/, "")}. Please add another bank account or choose another payment method.`
              : "Monnify settlement account is not ready. OPay is temporarily unavailable for Monnify subaccount setup. Please add another bank account or choose another payment method.",
        },
        { status: 403 }
      );
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
    const appUrl = getAppUrl();

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

    // Default: Fiat Checkout
    const callback = new URL(`${appUrl}/pay/${invoiceId}`);
    callback.searchParams.set("reference", reference);
    callback.searchParams.set("provider", route.provider);

    const result = await PaymentService.initializeTransaction({
      email: invoice.clients?.email || "customer@deraledger.app",
      amountKobo: chargeAmountKobo,
      reference,
      subaccountCode: route.provider === "paystack" ? merchant.payment_subaccount_code : undefined,
      incomeSplitConfig:
        route.provider === "monnify" && monnifySettlement?.mapping?.provider_subaccount_code
          ? [
              {
                subAccountCode: monnifySettlement.mapping.provider_subaccount_code,
                splitPercentage: 100,
                feePercentage: 100,
              },
            ]
          : undefined,
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
