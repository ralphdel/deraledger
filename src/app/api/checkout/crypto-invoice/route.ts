import crypto from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import {
  BREET_MIN_AMOUNT_ERROR_MESSAGE,
  type BreetSettlementBankAccount,
  buildBreetSettlementAccountSnapshot,
  buildSettlementBankPayload,
  canUseBreetCryptoCheckout,
  getMerchantBreetMappingState,
  isBelowBreetMinimumAmount,
  maskAccountNumber,
  resolveBreetBankId,
  validateSettlementAccountForBreet,
} from "@/lib/services/breet-crypto.service";
import { getPaymentEnvironmentForMerchantEmail } from "@/lib/services/payment-routing.service";
import {
  confirmationSettingKeyForRail,
  defaultConfirmationsForRail,
  defaultNetworkForRail,
  normalizeCryptoRail,
  rateSettingKeyForRail,
  resolveBreetCheckoutQuote,
} from "@/lib/treasury";
import { calculateProportionalPayment } from "@/lib/calculations";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parseNumericSetting(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

type MerchantSettlementAccount = {
  id: string;
  bank_name: string;
  bank_code: string | null;
  account_number: string;
  account_name: string;
  currency: string | null;
  is_default: boolean;
  verification_status: string;
  status: string;
  raw_verification_payload: Record<string, unknown> | null;
  bank_id?: string | null;
  mapping_confirmed?: boolean;
  validation_passed?: boolean;
};

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

async function loadMerchantSettlementAccount(merchantId: string, environment: "sandbox" | "live") {
  const { data, error } = await supabase
    .from("merchant_settlement_accounts")
    .select("id, bank_name, bank_code, account_number, account_name, currency, is_default, verification_status, status, raw_verification_payload")
    .eq("merchant_id", merchantId)
    .eq("is_default", true)
    .eq("status", "active")
    .eq("verification_status", "verified")
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const { data: providerMapping } = await supabase
    .from("merchant_provider_settlement_accounts")
    .select("provider_account_reference, raw_provider_response")
    .eq("merchant_id", merchantId)
    .eq("settlement_account_id", data.id)
    .eq("provider_name", "breet")
    .eq("environment", environment)
    .in("status", ["connected", "active"])
    .maybeSingle();

  const providerPayload = providerMapping?.raw_provider_response as Record<string, unknown> | null | undefined;
  const bankId =
    readString(data.raw_verification_payload?.bank_id) ||
    readString(data.raw_verification_payload?.bankId) ||
    readString(data.raw_verification_payload?.breet_bank_id) ||
    readString(providerPayload?.bank_id) ||
    readString(providerPayload?.bankId) ||
    readString(providerPayload?.breet_bank_id) ||
    readString(providerPayload?.provider_bank_id) ||
    providerMapping?.provider_account_reference ||
    null;

  const account = {
    ...(data as MerchantSettlementAccount),
    bank_id: bankId,
  } as MerchantSettlementAccount;

  const mappingState = getMerchantBreetMappingState(account, {
    provider_account_reference: providerMapping?.provider_account_reference || null,
    raw_provider_response: providerPayload || null,
  });

  return {
    ...account,
    mapping_confirmed: mappingState.mappingConfirmed,
    validation_passed: mappingState.validationPassed,
  } as MerchantSettlementAccount;
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
      .select("id, email, subscription_plan, merchant_tier, verification_status, bvn_status, selfie_status, cac_status, utility_status, business_affiliation_status, payment_provider, live_features_enabled, setup_mode")
      .eq("id", invoice.merchant_id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    const environment = getPaymentEnvironmentForMerchantEmail(merchant.email);
    const eligibility = await canUseBreetCryptoCheckout({
      supabase,
      purpose: "invoice_payment",
      merchantId: merchant.id,
      environment,
    });

    if (!eligibility.allowed) {
      const errorMessage =
        eligibility.reason === "Crypto settlement setup is incomplete for this merchant."
          ? "Crypto payment is not ready for this payout account. Please refresh payout setup or choose another payment method."
          : "Crypto payment is not ready for this payout account. Please refresh payout setup or choose another payment method.";
      return NextResponse.json({ error: errorMessage }, { status: 403 });
    }

    const outstanding = roundCurrency(Number(invoice.outstanding_balance || 0));
    if (paymentAmount > outstanding + 0.01) {
      return NextResponse.json({ error: "Payment exceeds outstanding balance" }, { status: 400 });
    }

    const intendedPaymentAmount = roundCurrency(paymentAmount);
    const feePayer = invoice.fee_absorption === "customer" ? "customer" : "business";
    const allocation = calculateProportionalPayment(
      intendedPaymentAmount,
      Number(invoice.outstanding_balance || 0),
      Number(invoice.tax_value || 0),
      Number(invoice.discount_value || 0),
      Number(invoice.amount_paid || 0),
      feePayer
    );
    const customerPayableAmount = roundCurrency(
      feePayer === "customer" ? allocation.totalCharge : intendedPaymentAmount
    );
    const expectedFeeAmount = roundCurrency(
      feePayer === "customer" ? allocation.paystackFee : 0
    );
    const minimumAutoSettlementNgn = eligibility.config.minimumAutoSettlementNgn;

    if (isBelowBreetMinimumAmount(outstanding, minimumAutoSettlementNgn)) {
      return NextResponse.json({ error: BREET_MIN_AMOUNT_ERROR_MESSAGE }, { status: 403 });
    }

    if (isBelowBreetMinimumAmount(intendedPaymentAmount, minimumAutoSettlementNgn)) {
      return NextResponse.json({ error: BREET_MIN_AMOUNT_ERROR_MESSAGE }, { status: 403 });
    }

    const settlementMode = eligibility.settlementMode;
    const settlementRecipientType = settlementMode === "treasury_manual" ? "platform" : "merchant";
    const merchantSettlementAccount = settlementRecipientType === "merchant"
      ? await loadMerchantSettlementAccount(merchant.id, environment)
      : null;
    const platformSettlementAccount = settlementRecipientType === "platform"
      ? eligibility.config.platformSettlementBankAccount
      : null;

    if (settlementRecipientType === "merchant") {
      if (!merchantSettlementAccount) {
        return NextResponse.json(
          { error: "Crypto payment is not ready for this payout account. Please refresh payout setup or choose another payment method." },
          { status: 403 }
        );
      }

      const validation = validateSettlementAccountForBreet(merchantSettlementAccount, { requireDefault: true });
      if (!validation.valid) {
        return NextResponse.json(
          { error: "Crypto payment is not ready for this payout account. Please refresh payout setup or choose another payment method." },
          { status: 403 }
        );
      }

      if (!merchantSettlementAccount.bank_id || !(merchantSettlementAccount.mapping_confirmed || merchantSettlementAccount.validation_passed)) {
        return NextResponse.json(
          { error: "Crypto payment is not ready for this payout account. Please refresh payout setup or choose another payment method." },
          { status: 403 }
        );
      }
    }

    if (settlementRecipientType === "platform" && !platformSettlementAccount) {
      return NextResponse.json(
        { error: "Crypto settlement setup is unavailable for treasury/manual mode." },
        { status: 403 }
      );
    }

    const settlementBank = settlementRecipientType === "merchant"
      ? merchantSettlementAccount!
      : platformSettlementAccount!;

    const settlementAccountSnapshot = buildBreetSettlementAccountSnapshot(settlementBank, {
      recipientType: settlementRecipientType,
      settlementMode,
    });

    const keys = [
      rateSettingKeyForRail(rail),
      confirmationSettingKeyForRail(rail),
      "crypto_session_ttl_minutes",
      "breet_quote_fallback_buffer_bps",
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
    const fallbackBufferBps = parseNumericSetting(settingsMap.get("breet_quote_fallback_buffer_bps"), 300);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const paymentSessionId = crypto.randomUUID();
    const reference = `INV-CRYPTO-${invoice.id.slice(0, 8).toUpperCase()}-${Date.now()}`;
    const narrationReference = invoice.invoice_number || reference;
    const settlementBankPayload = buildSettlementBankPayload(
      settlementBank as BreetSettlementBankAccount,
      `Invoice ${narrationReference}`
    );

    if (!settlementBankPayload) {
      return NextResponse.json(
        { error: "Crypto payment is unavailable because the merchant settlement account is not fully configured." },
        { status: 403 }
      );
    }

    const addressResult = await PaymentService.generateInvoicePaymentAddress({
      assetId: rail,
      label: reference,
      settlementBank: settlementBankPayload,
      settlementMode,
      settlementRecipientType,
      paymentType: "invoice",
      providerEnvironment: eligibility.config.apiEnvironment,
      network: defaultNetworkForRail(rail),
    });

    const network = (typeof addressResult.raw?.network === "string" ? addressResult.raw.network : null) || defaultNetworkForRail(rail);
    const quote = resolveBreetCheckoutQuote({
      amountNgn: customerPayableAmount,
      fallbackExchangeRate: exchangeRate,
      providerRaw: addressResult.raw,
      fallbackBufferBps,
    });

    const { error: sessionError } = await supabase.from("payment_sessions").insert({
      id: paymentSessionId,
      invoice_id: invoice.id,
      merchant_id: merchant.id,
      payment_rail: rail,
      provider_name: "breet",
      payment_purpose: "invoice_payment",
      payment_method: "crypto",
      settlement_mode: settlementMode,
      settlement_recipient_type: settlementRecipientType,
      source_currency: rail,
      destination_currency: "NGN",
      amount_ngn: intendedPaymentAmount,
      amount_crypto: quote.cryptoAmount,
      exchange_rate: quote.exchangeRate,
      wallet_address: addressResult.address,
      wallet_provider_id: addressResult.walletId || addressResult.vaultId || addressResult.id || null,
      network,
      status: "PENDING",
      expected_confirmations: expectedConfirmations,
      reference,
      provider_reference: addressResult.id || null,
      crypto_status: "crypto_payment_initialized",
      provider_fee: 0,
      settlement_fee: 0,
      expected_settlement_ngn: customerPayableAmount,
      actual_settlement_ngn: null,
      webhook_status: "pending",
      settlement_account_reference: addressResult.settlementBankId || resolveBreetBankId(settlementBank) || null,
      settlement_account_snapshot: settlementAccountSnapshot,
      metadata: {
        invoice_number: invoice.invoice_number,
        client_email: invoice.clients?.email || null,
        purpose: "invoice_payment",
        selected_invoice_amount: intendedPaymentAmount,
        customer_payable_amount: customerPayableAmount,
        fee_payer: feePayer,
        fee_amount: expectedFeeAmount,
        invoice_fee_absorption: feePayer,
        settlement_mode: settlementMode,
        settlement_recipient_type: settlementRecipientType,
        settlement_destination: settlementRecipientType === "merchant"
          ? "merchant_verified_settlement_account"
          : "deraledger_platform_settlement_account",
        settlement_bank_id_used: addressResult.settlementBankId || settlementBankPayload.bankId,
        settlement_account_masked: addressResult.settlementAccountMasked || maskAccountNumber(settlementBank.account_number),
        wallet_id: addressResult.walletId || addressResult.vaultId || addressResult.id || null,
        wallet_address: addressResult.address,
        auto_settlement_enabled: addressResult.autoSettlementEnabled === true,
        settlement_account_snapshot: settlementAccountSnapshot,
        quote_source: quote.quoteSource,
        provider_quote_available: quote.providerQuoteAvailable,
        fallback_quote_buffer_bps: quote.fallbackBufferBps,
        configured_exchange_rate: exchangeRate,
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
        payment_method: "crypto",
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
        amount_ngn: intendedPaymentAmount,
        amount_crypto: quote.cryptoAmount,
        exchange_rate: quote.exchangeRate,
        quote_source: quote.quoteSource,
        provider_quote_available: quote.providerQuoteAvailable,
        wallet_address: addressResult.address,
        reference,
        settlement_mode: settlementMode,
        settlement_recipient_type: settlementRecipientType,
      },
    });

    return NextResponse.json({
      success: true,
      isCrypto: true,
      paymentSessionId,
      providerReference: addressResult.id || null,
      cryptoAddress: addressResult.address,
      cryptoNetwork: network,
      cryptoCoin: rail,
      fiatAmount: intendedPaymentAmount,
      cryptoAmount: quote.cryptoAmount,
      exchangeRate: quote.exchangeRate,
      quoteSource: quote.quoteSource,
      providerQuoteAvailable: quote.providerQuoteAvailable,
      reference,
      expiresAt,
      settlementMode,
      settlementRecipientType,
      minimumAutoSettlementNgn,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to initialize crypto checkout.";
    console.error("Crypto invoice init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
