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
import { assertPlanAvailable } from "@/lib/plans";
import {
  assertCanonicalPaidAmount,
  loadAndValidatePaidOnboardingSession,
  PaidOnboardingPaymentError,
} from "@/lib/services/paid-onboarding-payment.service";
import {
  prepareSoloPlusOnboardingPayment,
  SoloPlusPaymentLifecycleError,
} from "@/lib/solo-plus/server/payment-lifecycle";

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

    if (!email || !plan || !sessionId || amountKobo == null) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const pricing = assertCanonicalPaidAmount(plan, amountKobo);
    const onboardingBinding = checkoutContext === "onboarding"
      ? await loadAndValidatePaidOnboardingSession(supabase, {
          sessionId,
          email,
          plan,
          amountKobo,
          mode: "initialize",
        })
      : null;
    const normalizedPlan = onboardingBinding?.plan || pricing.plan;
    const canonicalAmountKobo = onboardingBinding?.amountKobo || pricing.amountKobo;
    if (normalizedPlan === "solo_plus" && checkoutContext === "renewal") {
      return NextResponse.json({ error: "Solo Plus renewal remains deferred until post-approval renewal rules are implemented." }, { status: 409 });
    }
    const availability = await assertPlanAvailable(supabase, normalizedPlan);
    if (!availability.ok) {
      return NextResponse.json({ error: "This plan is not available right now." }, { status: 403 });
    }
    const storagePlan = onboardingBinding?.storagePlan || pricing.storagePlan;

    let resolvedEmail = onboardingBinding?.session.email || String(email);
    let merchantId: string | null = null;
    let userId: string | null = null;
    let businessName: string | null = onboardingBinding?.session.business_name || null;
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
    const fiatAmount = canonicalAmountKobo / 100;
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
    const reference = `${referencePrefix}-${storagePlan.toUpperCase()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const paymentMetadata = {
      email: resolvedEmail,
      plan: storagePlan,
      plan_display_code: normalizedPlan,
      session_id: sessionId,
      type: paymentType,
      merchant_id: merchantId,
      business_name: businessName,
      owner_name: ownerName,
      amount_expected_kobo: canonicalAmountKobo,
      payment_purpose: paymentPurpose,
      checkout_context: checkoutContext,
    };
    const soloPlusPayment = normalizedPlan === "solo_plus"
      ? await prepareSoloPlusOnboardingPayment({
          onboardingSessionId: sessionId,
          customerEmail: resolvedEmail,
          amountKobo: canonicalAmountKobo,
          paymentMethod: "crypto",
          provider: "breet",
          metadata: paymentMetadata,
          serviceClient: supabase,
        })
      : null;
    const resolvedReference = soloPlusPayment?.reference || reference;
    const pendingPaymentRecord = soloPlusPayment?.paymentRecord || await createPendingPlanPaymentRecord(supabase, {
      internalReference: reference,
      provider: "breet",
      paymentMethod: "crypto",
      paymentPurpose,
      customerEmail: resolvedEmail,
      expectedAmount: fiatAmount,
      planName: normalizedPlan,
      planId: storagePlan,
      userId,
      merchantId,
      onboardingSessionId: sessionId,
      passwordSetupRequired: checkoutContext === "onboarding",
      metadata: paymentMetadata,
    });
    const { data: existingSession } = await supabase
      .from("crypto_payment_sessions")
      .select("id, provider_reference, expected_ngn_amount, crypto_amount_expected, crypto_asset, crypto_network, settlement_mode, settlement_recipient_type, expires_at, metadata")
      .eq("payment_record_id", pendingPaymentRecord.id)
      .maybeSingle();

    if (existingSession) {
      const sessionMetadata = typeof existingSession.metadata === "object" && existingSession.metadata !== null
        ? existingSession.metadata as Record<string, unknown>
        : {};
      return NextResponse.json({
        success: true,
        cryptoAddress: typeof sessionMetadata.wallet_address === "string" ? sessionMetadata.wallet_address : null,
        cryptoNetwork: existingSession.crypto_network,
        cryptoCoin: existingSession.crypto_asset,
        fiatAmount: existingSession.expected_ngn_amount,
        cryptoAmount: existingSession.crypto_amount_expected,
        exchangeRate: typeof sessionMetadata.exchange_rate === "number" ? sessionMetadata.exchange_rate : Number(sessionMetadata.exchange_rate || 0),
        quoteSource: typeof sessionMetadata.quote_source === "string" ? sessionMetadata.quote_source : "stored_session",
        providerQuoteAvailable: sessionMetadata.provider_quote_available === true,
        reference: resolvedReference,
        paymentSessionId: existingSession.id,
        providerReference: existingSession.provider_reference || resolvedReference,
        settlementMode: existingSession.settlement_mode,
        settlementRecipientType: existingSession.settlement_recipient_type,
        minimumAutoSettlementNgn,
        expiresAt: existingSession.expires_at,
      });
    }
    const settlementBankPayload = buildSettlementBankPayload(
      platformSettlementAccount,
      `${checkoutContext === "renewal" ? "Renew" : "Sub"} ${plan.toUpperCase()} ${resolvedReference.slice(-12)}`
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
      label: resolvedReference,
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
      payment_record_id: pendingPaymentRecord.id,
      plan_id: storagePlan,
      payment_purpose: paymentPurpose,
      provider_name: "breet",
      internal_reference: resolvedReference,
      provider_reference: result.id || resolvedReference,
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
        plan: storagePlan,
        plan_display_code: normalizedPlan,
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
      reference: resolvedReference,
      paymentSessionId: createdSession?.id || null,
      providerReference: result.id || resolvedReference,
      settlementMode,
      settlementRecipientType,
      minimumAutoSettlementNgn,
      expiresAt: createdSession?.expires_at || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate crypto address.";
    console.error("Crypto subscription init error:", message);
    const status =
      error instanceof PaidOnboardingPaymentError
        ? error.httpStatus
        : error instanceof SoloPlusPaymentLifecycleError &&
      (error.code === "SOLO_PLUS_PAYMENT_INIT_CONFLICT" ||
        error.code === "SOLO_PLUS_PAYMENT_ALREADY_CONFIRMED")
        ? 409
        : 500;
    return NextResponse.json({
      error: message,
      ...(error instanceof PaidOnboardingPaymentError ? { code: error.code } : {}),
    }, { status });
  }
}
