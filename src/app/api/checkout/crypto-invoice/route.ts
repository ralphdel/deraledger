import crypto from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import {
  computeCryptoAmount,
  confirmationSettingKeyForRail,
  defaultConfirmationsForRail,
  defaultNetworkForRail,
  normalizeCryptoRail,
  rateSettingKeyForRail,
} from "@/lib/treasury";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parseNumericSetting(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId : "";
    const paymentAmount = Number(body.paymentAmount);
    const rail = normalizeCryptoRail(typeof body.rail === "string" ? body.rail : "USDT");

    if (!invoiceId || !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return NextResponse.json({ error: "Missing invoiceId or paymentAmount" }, { status: 400 });
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("*, clients(email, full_name)")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (["closed", "manually_closed", "void", "expired"].includes(invoice.status)) {
      return NextResponse.json({ error: "Invoice is not available for payment" }, { status: 400 });
    }

    const { data: merchant, error: merchantError } = await supabase
      .from("merchants")
      .select("id, verification_status, payment_provider, payment_subaccount_code")
      .eq("id", invoice.merchant_id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    if (merchant.verification_status !== "verified" || !merchant.payment_subaccount_code) {
      return NextResponse.json(
        { error: "Merchant is not ready to receive settlements." },
        { status: 403 }
      );
    }

    const outstanding = Number(invoice.outstanding_balance);
    if (paymentAmount > outstanding + 0.01) {
      return NextResponse.json({ error: "Payment exceeds outstanding balance" }, { status: 400 });
    }

    if (!process.env.BREET_APP_ID || !process.env.BREET_APP_SECRET) {
      return NextResponse.json(
        { error: "Crypto rail is not configured on this environment." },
        { status: 503 }
      );
    }

    const keys = [
      rateSettingKeyForRail(rail),
      confirmationSettingKeyForRail(rail),
      "crypto_session_ttl_minutes",
    ];

    const { data: settings } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", keys);

    const settingsMap = new Map((settings || []).map((row) => [row.key, row.value]));
    const exchangeRate = parseNumericSetting(
      settingsMap.get(rateSettingKeyForRail(rail)),
      rail === "BTC" ? 100000000 : rail === "ETH" ? 5000000 : 1650
    );
    const expectedConfirmations = parseNumericSetting(
      settingsMap.get(confirmationSettingKeyForRail(rail)),
      defaultConfirmationsForRail(rail)
    );
    const ttlMinutes = parseNumericSetting(settingsMap.get("crypto_session_ttl_minutes"), 30);
    const cryptoAmount = computeCryptoAmount(paymentAmount, exchangeRate);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const paymentSessionId = crypto.randomUUID();
    const reference = `INV-CRYPTO-${invoice.id.slice(0, 8).toUpperCase()}-${Date.now()}`;

    const addressResult = await PaymentService.generateCryptoDepositAddress({
      assetId: rail,
      label: `merchant:${merchant.id}|invoice:${invoice.id}|session:${paymentSessionId}|ref:${reference}`,
    });

    const network = addressResult.asset || defaultNetworkForRail(rail);

    const { error: sessionError } = await supabase.from("payment_sessions").insert({
      id: paymentSessionId,
      invoice_id: invoice.id,
      merchant_id: merchant.id,
      payment_rail: rail,
      source_currency: rail,
      destination_currency: "NGN",
      amount_ngn: paymentAmount,
      amount_crypto: cryptoAmount,
      exchange_rate: exchangeRate,
      wallet_address: addressResult.address,
      wallet_provider_id: addressResult.id || null,
      network,
      status: "PENDING",
      expected_confirmations: expectedConfirmations,
      reference,
      provider_reference: addressResult.id || null,
      metadata: {
        invoice_number: invoice.invoice_number,
        client_email: invoice.clients?.email || null,
      },
      expires_at: expiresAt,
    });

    if (sessionError) {
      console.error("Failed to create crypto payment session:", sessionError.message);
      return NextResponse.json({ error: "Could not create payment session" }, { status: 500 });
    }

    await supabase
      .from("invoices")
      .update({
        payment_provider: "breet",
        payment_status: "AWAITING_CONFIRMATION",
        crypto_deposit_address: addressResult.address,
        crypto_asset: rail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invoice.id);

    await supabase.from("audit_logs").insert({
      event_type: "crypto_payment_session_created",
      actor_id: null,
      actor_role: "system",
      target_id: invoice.id,
      target_type: "invoice",
      metadata: {
        actor_name: "System (Crypto Checkout)",
        actor_merchant_id: merchant.id,
        payment_session_id: paymentSessionId,
        payment_rail: rail,
        amount_ngn: paymentAmount,
        amount_crypto: cryptoAmount,
        exchange_rate: exchangeRate,
        wallet_address: addressResult.address,
        reference,
      },
    });

    return NextResponse.json({
      success: true,
      isCrypto: true,
      paymentSessionId,
      cryptoAddress: addressResult.address,
      cryptoNetwork: network,
      cryptoCoin: rail,
      fiatAmount: paymentAmount,
      cryptoAmount,
      exchangeRate,
      reference,
      expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize crypto checkout.";
    console.error("Crypto invoice init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
