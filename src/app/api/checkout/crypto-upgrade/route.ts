import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PaymentService } from "@/lib/payment";
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
import { computeCryptoAmount, defaultNetworkForRail, rateSettingKeyForRail } from "@/lib/treasury";
import crypto from "crypto";

/**
 * POST /api/checkout/crypto-upgrade
 *
 * Generates a Breet crypto deposit address for an existing merchant plan upgrade.
 * Feature-flagged: returns a "coming_soon" response until Breet credentials are configured.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: merchant, error: merchantError } = await supabase
      .from("merchants")
      .select("id, email")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant account not found." }, { status: 404 });
    }

    const { newPlan } = await request.json();

    if (newPlan !== "individual" && newPlan !== "corporate") {
      return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
    }

    const environment = getPaymentEnvironment();
    const eligibility = await canUseBreetCryptoCheckout({
      supabase,
      purpose: "plan_upgrade",
      merchantId: merchant.id,
      environment,
    });

    if (!eligibility.allowed) {
      return NextResponse.json({ error: eligibility.reason || "Crypto payments are not yet enabled. Please use Card & Bank or Bank Transfer." }, { status: 403 });
    }

    const settlementMode = eligibility.settlementMode;
    const settlementRecipientType = "platform" as const;
    const platformSettlementAccount = eligibility.config.platformSettlementBankAccount;
    const amountNgn = newPlan === "corporate" ? 20000 : 5000;
    const minimumAutoSettlementNgn = eligibility.config.minimumAutoSettlementNgn;

    if (isBelowBreetMinimumAmount(amountNgn, minimumAutoSettlementNgn)) {
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

    const reference = `CRYPTO-UPG-${newPlan.toUpperCase()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    await createPendingPlanPaymentRecord(supabase, {
      internalReference: reference,
      provider: "breet",
      paymentMethod: "crypto",
      paymentPurpose: "plan_upgrade",
      customerEmail: user.email || merchant.email || "billing@deraledger.app",
      expectedAmount: amountNgn,
      planName: newPlan,
      planId: newPlan,
      userId: user.id,
      merchantId: merchant.id,
      metadata: {
        merchant_id: merchant.id,
        new_plan: newPlan,
        type: "subscription_upgrade",
        amount_expected_kobo: amountNgn * 100,
        payment_purpose: "plan_upgrade",
      },
    });
    const settlementBankPayload = buildSettlementBankPayload(
      platformSettlementAccount,
      `Upgrade ${newPlan.toUpperCase()} ${reference.slice(-12)}`
    );
    if (!settlementBankPayload) {
      return NextResponse.json({ error: "Platform settlement account is not configured." }, { status: 403 });
    }
    const { data: settings } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", [rateSettingKeyForRail("USDT"), "crypto_session_ttl_minutes"]);
    const settingsMap = new Map((settings || []).map((row) => [row.key, row.value]));
    const exchangeRate = Number(settingsMap.get(rateSettingKeyForRail("USDT")) || 1650);
    const cryptoAmount = computeCryptoAmount(amountNgn, exchangeRate);
    const ttlMinutes = Number(settingsMap.get("crypto_session_ttl_minutes") || 30);

    const result = await PaymentService.generatePlatformPaymentAddress({
      assetId: "USDT",
      label: reference,
      settlementBank: settlementBankPayload,
      settlementMode,
      settlementRecipientType,
      paymentType: "upgrade",
      providerEnvironment: eligibility.config.apiEnvironment,
      network: defaultNetworkForRail("USDT"),
    });

    const { error: sessionError } = await supabase.from("crypto_payment_sessions").insert({
      merchant_id: merchant.id,
      user_id: user.id,
      business_id: null,
      plan_id: newPlan,
      payment_purpose: "plan_upgrade",
      provider_name: "breet",
      internal_reference: reference,
      provider_reference: result.id || reference,
      payment_method: "crypto",
      expected_ngn_amount: amountNgn,
      crypto_asset: result.asset || "USDT",
      crypto_network: (typeof result.raw?.network === "string" ? result.raw.network : null) || defaultNetworkForRail("USDT"),
      crypto_amount_expected: cryptoAmount,
      settlement_mode: settlementMode,
      settlement_recipient_type: settlementRecipientType,
      crypto_status: "crypto_payment_initialized",
      settlement_status: "pending",
      webhook_status: "pending",
      payment_status: "pending",
      payment_session_reference: merchant.id,
      provider_wallet_id: result.walletId || result.vaultId || result.id || null,
      settlement_account_snapshot: settlementAccountSnapshot,
      expires_at: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(),
      metadata: {
        merchant_id: merchant.id,
        new_plan: newPlan,
        type: "subscription_upgrade",
        wallet_id: result.walletId || result.vaultId || result.id || null,
        wallet_address: result.address,
        settlement_bank_id_used: result.settlementBankId || settlementBankPayload.bankId,
        settlement_account_masked: result.settlementAccountMasked || maskAccountNumber(platformSettlementAccount.account_number),
        auto_settlement_enabled: result.autoSettlementEnabled === true,
        settlement_mode: settlementMode,
        settlement_recipient_type: settlementRecipientType,
        settlement_account_snapshot: settlementAccountSnapshot,
        exchange_rate: exchangeRate,
      },
      raw_payload: result.raw || {},
    });

    if (sessionError) {
      console.error("Failed to create upgrade crypto payment session:", sessionError.message);
      return NextResponse.json({ error: "Could not create crypto payment session" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      cryptoAddress: result.address,
      cryptoNetwork: (typeof result.raw?.network === "string" ? result.raw.network : null) || defaultNetworkForRail("USDT"),
      cryptoCoin: result.asset || "USDT",
      fiatAmount: amountNgn,
      reference,
      providerReference: result.id || reference,
      settlementMode,
      settlementRecipientType,
      minimumAutoSettlementNgn,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate crypto address.";
    console.error("Crypto upgrade init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
