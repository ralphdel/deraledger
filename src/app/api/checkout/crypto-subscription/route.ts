import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { createClient } from "@/lib/supabase/server";
import {
  BREET_MIN_AMOUNT_ERROR_MESSAGE,
  buildBreetSettlementAccountSnapshot,
  buildSettlementBankPayload,
  canUseBreetCryptoCheckout,
  isBelowBreetMinimumAmount,
  maskAccountNumber,
  validateSettlementAccountForBreet,
} from "@/lib/services/breet-crypto.service";
import { getPaymentEnvironment } from "@/lib/services/payment-routing.service";
import { createPendingPlanPaymentRecord } from "@/lib/services/plan-payment-recovery.service";
import { defaultNetworkForRail, rateSettingKeyForRail, resolveBreetCheckoutQuote } from "@/lib/treasury";
import crypto from "crypto";

/**
 * POST /api/checkout/crypto-subscription
 *
 * Generates a Breet crypto deposit address for new merchant subscription.
 * Feature-flagged: returns a "coming_soon" response until Breet credentials are configured.
 */
const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { email, plan, sessionId, amountKobo, context } = await request.json();
    const checkoutContext = context === "renewal" ? "renewal" : "onboarding";

    if (!email || !plan || !sessionId || !amountKobo) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    let resolvedEmail = String(email);
    let merchantId: string | null = null;
    let userId: string | null = null;
    let businessName: string | null = null;
    let ownerName: string | null = null;
    const paymentPurpose = checkoutContext === "renewal" ? "plan_renewal" : "plan_subscription";
    const paymentType = checkoutContext === "renewal" ? "subscription_renewal" : "subscription";

    if (checkoutContext === "renewal") {
      const sessionSupabase = await createClient();
      const { data: { user } } = await sessionSupabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { data: merchant, error: merchantError } = await sessionSupabase
        .from("merchants")
        .select("id, email, business_name, owner_name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (merchantError || !merchant) {
        return NextResponse.json({ error: "Merchant account not found." }, { status: 404 });
      }

      merchantId = merchant.id;
      userId = user.id;
      resolvedEmail = user.email || merchant.email || resolvedEmail;
      businessName = merchant.business_name || null;
      ownerName = merchant.owner_name || null;
    }

    const environment = getPaymentEnvironment();
    const eligibility = await canUseBreetCryptoCheckout({
      supabase,
      purpose: "plan_subscription",
      environment,
    });

    if (!eligibility.allowed) {
      return NextResponse.json({ error: eligibility.reason || "Crypto payments are not yet enabled. Please use Card & Bank or Bank Transfer." }, { status: 403 });
    }

    const settlementMode = eligibility.settlementMode;
    const settlementRecipientType = "platform" as const;
    const platformSettlementAccount = eligibility.config.platformSettlementBankAccount;
    const fiatAmount = amountKobo / 100;
    const minimumAutoSettlementNgn = eligibility.config.minimumAutoSettlementNgn;

    if (isBelowBreetMinimumAmount(fiatAmount, minimumAutoSettlementNgn)) {
      return NextResponse.json({ error: BREET_MIN_AMOUNT_ERROR_MESSAGE }, { status: 403 });
    }

    if (!platformSettlementAccount) {
      return NextResponse.json({ error: "Platform settlement account is not configured." }, { status: 403 });
    }

    const validation = validateSettlementAccountForBreet(platformSettlementAccount);
    if (!validation.valid) {
      return NextResponse.json({ error: "Platform settlement account is not configured." }, { status: 403 });
    }

    const settlementAccountSnapshot = buildBreetSettlementAccountSnapshot(platformSettlementAccount, {
      recipientType: settlementRecipientType,
      settlementMode,
    });

    const referencePrefix = checkoutContext === "renewal" ? "CRYPTO-RNW" : "CRYPTO-SUB";
    const reference = `${referencePrefix}-${plan.toUpperCase()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    await createPendingPlanPaymentRecord(supabase, {
      internalReference: reference,
      provider: "breet",
      paymentMethod: "crypto",
      paymentPurpose,
      customerEmail: resolvedEmail,
      expectedAmount: fiatAmount,
      planName: plan,
      planId: plan,
      userId,
      merchantId,
      passwordSetupRequired: checkoutContext === "onboarding",
      metadata: {
        email: resolvedEmail,
        plan,
        session_id: sessionId,
        type: paymentType,
        merchant_id: merchantId,
        business_name: businessName,
        owner_name: ownerName,
        amount_expected_kobo: amountKobo,
        payment_purpose: paymentPurpose,
        checkout_context: checkoutContext,
      },
    });
    const settlementBankPayload = buildSettlementBankPayload(
      platformSettlementAccount,
      `${checkoutContext === "renewal" ? "Renew" : "Sub"} ${plan.toUpperCase()} ${reference.slice(-12)}`
    );
    if (!settlementBankPayload) {
      return NextResponse.json({ error: "Platform settlement account is not configured." }, { status: 403 });
    }
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", [rateSettingKeyForRail("USDT"), "crypto_session_ttl_minutes", "breet_quote_fallback_buffer_bps"]);
    const settingsMap = new Map((settings || []).map((row) => [row.key, row.value]));
    const exchangeRate = Number(settingsMap.get(rateSettingKeyForRail("USDT")) || 1650);
    const ttlMinutes = Number(settingsMap.get("crypto_session_ttl_minutes") || 30);
    const fallbackBufferBps = Number(settingsMap.get("breet_quote_fallback_buffer_bps") || 300);

    const result = await PaymentService.generatePlatformPaymentAddress({
      assetId: "USDT",
      label: reference,
      settlementBank: settlementBankPayload,
      settlementMode,
      settlementRecipientType,
      paymentType: "subscription",
      providerEnvironment: eligibility.config.apiEnvironment,
      network: defaultNetworkForRail("USDT"),
    });
    const quote = resolveBreetCheckoutQuote({
      amountNgn: fiatAmount,
      fallbackExchangeRate: exchangeRate,
      providerRaw: result.raw,
      fallbackBufferBps,
    });

    const { data: createdSession, error: sessionError } = await supabase.from("crypto_payment_sessions").insert({
      merchant_id: merchantId,
      user_id: userId,
      business_id: null,
      plan_id: plan,
      payment_purpose: paymentPurpose,
      provider_name: "breet",
      internal_reference: reference,
      provider_reference: result.id || reference,
      payment_method: "crypto",
      expected_ngn_amount: fiatAmount,
      crypto_asset: result.asset || "USDT",
      crypto_network: (typeof result.raw?.network === "string" ? result.raw.network : null) || defaultNetworkForRail("USDT"),
      crypto_amount_expected: quote.cryptoAmount,
      settlement_mode: settlementMode,
      settlement_recipient_type: settlementRecipientType,
      crypto_status: "crypto_payment_initialized",
      settlement_status: "pending",
      webhook_status: "pending",
      payment_status: "pending",
      payment_session_reference: sessionId,
      provider_wallet_id: result.walletId || result.vaultId || result.id || null,
      settlement_account_snapshot: settlementAccountSnapshot,
      expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
      metadata: {
        email: resolvedEmail,
        plan,
        session_id: sessionId,
        type: paymentType,
        merchant_id: merchantId,
        business_name: businessName,
        owner_name: ownerName,
        wallet_id: result.walletId || result.vaultId || result.id || null,
        wallet_address: result.address,
        settlement_bank_id_used: result.settlementBankId || settlementBankPayload.bankId,
        settlement_account_masked: result.settlementAccountMasked || maskAccountNumber(platformSettlementAccount.account_number),
        auto_settlement_enabled: result.autoSettlementEnabled === true,
        settlement_mode: settlementMode,
        settlement_recipient_type: settlementRecipientType,
        settlement_account_snapshot: settlementAccountSnapshot,
        exchange_rate: quote.exchangeRate,
        configured_exchange_rate: exchangeRate,
        quote_source: quote.quoteSource,
        provider_quote_available: quote.providerQuoteAvailable,
        fallback_quote_buffer_bps: quote.fallbackBufferBps,
        payment_purpose: paymentPurpose,
        checkout_context: checkoutContext,
      },
      raw_payload: result.raw || {},
    }).select("id, expires_at").single();

    if (sessionError) {
      console.error("Failed to create subscription crypto payment session:", sessionError.message);
      return NextResponse.json({ error: "Could not create crypto payment session" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      cryptoAddress: result.address,
      cryptoNetwork: (typeof result.raw?.network === "string" ? result.raw.network : null) || defaultNetworkForRail("USDT"),
      cryptoCoin: result.asset || "USDT",
      fiatAmount,
      cryptoAmount: quote.cryptoAmount,
      exchangeRate: quote.exchangeRate,
      quoteSource: quote.quoteSource,
      providerQuoteAvailable: quote.providerQuoteAvailable,
      reference,
      paymentSessionId: createdSession?.id || null,
      providerReference: result.id || reference,
      settlementMode,
      settlementRecipientType,
      minimumAutoSettlementNgn,
      expiresAt: createdSession?.expires_at || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate crypto address.";
    console.error("Crypto subscription init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
