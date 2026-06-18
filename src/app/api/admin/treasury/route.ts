import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";
import type { BreetBankListItem } from "@/lib/payment/types";
import {
  addBreetIntegrationBank,
  assessBreetValidationForSettlementAccount,
  getBreetConfigWarnings,
  fetchBreetBanks,
  fetchSavedBreetIntegrationBanks,
  getBreetProviderHealth,
  getMerchantBreetMappingState,
  loadBreetRuntimeConfig,
  matchBreetBank,
  resolveBreetBankId,
  validateBreetBankAccount,
  withBreetTimeout,
} from "@/lib/services/breet-crypto.service";
import { getPaymentEnvironmentForMerchantEmail } from "@/lib/services/payment-routing.service";
import { getMerchantPaymentMethodReadiness } from "@/lib/services/settlement-ledger.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MANUAL_PAYOUT_PROVIDERS = ["paystack", "monnify", "fincra"] as const;

type ManualPayoutProvider = (typeof MANUAL_PAYOUT_PROVIDERS)[number];

type BreetSettlementRecordRow = {
  merchant_id?: string | null;
  actual_settlement?: number | string | null;
  amount_settled?: number | string | null;
  settlement_difference?: number | string | null;
  [key: string]: unknown;
};

type MerchantReadinessStatus = {
  merchantId: string;
  merchantName: string | null;
  hasVerifiedSettlementAccount: boolean;
  hasMappedBreetBankId: boolean;
  validationConfirmed: boolean;
  mappingConfirmedByAdmin: boolean;
  validationPassed: boolean;
  amountThresholdEnforced: boolean;
  merchantSettlementAccount: {
    id: string;
    bankName: string | null;
    bankCode: string | null;
    maskedAccountNumber: string | null;
    accountName: string | null;
    verificationStatus: string | null;
    status: string | null;
  } | null;
  currentBreetBank: {
    bankId: string;
    bankName: string | null;
  } | null;
  matchedBreetBank: {
    bankId: string;
    bankName: string;
  } | null;
  mappingEnvironment: "sandbox" | "live" | null;
  validationNote: string | null;
};

type CryptoActionResponse = {
  success: boolean;
  method: "crypto";
  status: "ready" | "setup_required" | "requires_action" | "failed" | "timeout";
  ready: boolean;
  reason_code: string | null;
  merchant_message: string;
  admin_message: string | null;
  readiness: {
    method: "crypto";
    label: string;
    status: string;
    ready: boolean;
  };
};

const CONFIG_KEYS = [
  "crypto_usdt_ngn_rate",
  "crypto_usdc_ngn_rate",
  "crypto_btc_ngn_rate",
  "crypto_eth_ngn_rate",
  "crypto_session_ttl_minutes",
  "crypto_rate_lock_minutes",
  "crypto_rate_slippage_bps",
  "crypto_underpayment_tolerance_bps",
  "crypto_manual_review_threshold_bps",
  "crypto_platform_fee_bps",
  "crypto_overpayment_action",
  "crypto_settlement_currency",
  "crypto_btc_confirmations",
  "crypto_eth_confirmations",
  "crypto_usdt_confirmations",
  "crypto_usdc_confirmations",
  "breet_settlement_mode",
  "breet_api_environment",
  "breet_auto_settlement_enabled",
  "breet_merchant_auto_settlement_enabled",
  "breet_invoice_crypto_enabled",
  "breet_subscription_crypto_enabled",
  "breet_min_auto_settlement_ngn",
  "breet_platform_bank_validated",
  "breet_webhook_url",
  "breet_supported_assets",
  "breet_supported_networks",
  "breet_treasury_settlement_account_reference",
  "breet_treasury_settlement_account_label",
  "breet_platform_bank_id",
  "breet_platform_bank_code",
  "breet_platform_bank_name",
  "breet_platform_account_number",
  "breet_platform_account_name",
  "breet_default_receive_currency",
  "breet_sandbox_force_platform_settlement",
  "breet_live_enabled",
  "breet_allow_pending_as_completed_in_development",
];

export async function GET(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const selectedMerchantId = new URL(request.url).searchParams.get("merchantId");

  const runtimeConfig = await loadBreetRuntimeConfig(supabase);
  const providerHealth = {
    ...getBreetProviderHealth(),
    env: runtimeConfig.apiEnvironment,
  };
  const manualTreasuryEnabled = runtimeConfig.settlementMode === "treasury_manual";
  const manualQueueFunctionAvailable = manualTreasuryEnabled
    ? await hasManualQueueFunction()
    : false;

  const [
    walletRes,
    treasuryRes,
    batchesRes,
    webhooksRes,
    settingsRes,
    sessionsRes,
    cryptoSessionsRes,
    settlementRes,
    merchantRes,
    breetBanks,
    savedIntegrationBanks,
  ] = await Promise.all([
    supabase.from("merchant_wallets").select("*").order("updated_at", { ascending: false }).limit(100),
    supabase.from("treasury_transactions").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("settlement_batches").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("treasury_webhook_logs").select("*").eq("provider", "breet").order("created_at", { ascending: false }).limit(100),
    supabase.from("platform_settings").select("key, value").in("key", CONFIG_KEYS),
    supabase.from("payment_sessions").select("*").eq("provider_name", "breet").order("created_at", { ascending: false }).limit(100),
    supabase.from("crypto_payment_sessions").select("*").eq("provider_name", "breet").order("created_at", { ascending: false }).limit(100),
    supabase.from("settlement_records").select("*").eq("provider_name", "breet").order("created_at", { ascending: false }).limit(100),
    supabase.from("merchants").select("id, business_name").limit(500),
    providerHealth.configured ? fetchBreetBanks("ngn", runtimeConfig.apiEnvironment).catch(() => []) : Promise.resolve([]),
    providerHealth.configured ? fetchSavedBreetIntegrationBanks(runtimeConfig.apiEnvironment).catch(() => []) : Promise.resolve([]),
  ]);

  const merchants = merchantRes.data || [];
  const merchantMap = Object.fromEntries(merchants.map((merchant) => [merchant.id, merchant.business_name]));
  const merchantReadiness = selectedMerchantId
    ? await loadMerchantReadiness(selectedMerchantId, merchantMap[selectedMerchantId] || null, breetBanks)
    : null;
  const wallets = walletRes.data || [];
  const treasuryTransactions = (treasuryRes.data || []).map((tx) => ({
    ...tx,
    merchant_name: merchantMap[tx.merchant_id] || tx.merchant_id,
  }));
  const settlementBatches = (batchesRes.data || []).map((batch) => ({
    ...batch,
    merchant_name: merchantMap[batch.merchant_id] || batch.merchant_id,
  }));
  const paymentSessions = (sessionsRes.data || []).map((session) => ({
    ...session,
    merchant_name: merchantMap[session.merchant_id] || session.merchant_id,
  }));
  const cryptoPaymentSessions = (cryptoSessionsRes.data || []).map((session) => ({
    ...session,
    merchant_name: session.merchant_id ? merchantMap[session.merchant_id] || session.merchant_id : null,
    reference: session.internal_reference,
    wallet_address: session.wallet_address || (
      typeof session.raw_payload === "object" && session.raw_payload
        ? String((session.raw_payload as Record<string, unknown>).address || (session.raw_payload as Record<string, unknown>).destinationAddress || "")
        : ""
    ),
    confirmation_count: 0,
    expected_confirmations: 0,
    status: session.crypto_status || session.payment_status || "pending",
  }));
  const webhookLogs = (webhooksRes.data || []).map((log) => ({
    ...log,
    merchant_name: log.merchant_id ? merchantMap[log.merchant_id] || log.merchant_id : null,
  }));
  const settings = Object.fromEntries((settingsRes.data || []).map((row) => [row.key, row.value]));
  const editableSettings = {
    ...settings,
    breet_api_environment: settings.breet_api_environment || runtimeConfig.apiEnvironment,
    breet_webhook_url: settings.breet_webhook_url || runtimeConfig.webhookUrl || "",
    breet_invoice_crypto_enabled: settings.breet_invoice_crypto_enabled || String(runtimeConfig.invoiceCryptoEnabled),
    breet_subscription_crypto_enabled: settings.breet_subscription_crypto_enabled || String(runtimeConfig.subscriptionCryptoEnabled),
    breet_merchant_auto_settlement_enabled: settings.breet_merchant_auto_settlement_enabled || String(runtimeConfig.merchantAutoSettlementEnabled),
    breet_auto_settlement_enabled: settings.breet_auto_settlement_enabled || String(runtimeConfig.platformAutoSettlementEnabled),
    breet_default_receive_currency: settings.breet_default_receive_currency || runtimeConfig.defaultReceiveCurrency || "NGN",
    breet_min_auto_settlement_ngn: settings.breet_min_auto_settlement_ngn || String(runtimeConfig.minimumAutoSettlementNgn),
    breet_supported_assets: settings.breet_supported_assets || runtimeConfig.supportedAssets.join(","),
    breet_supported_networks: settings.breet_supported_networks || runtimeConfig.supportedNetworks.join(","),
    breet_sandbox_force_platform_settlement: settings.breet_sandbox_force_platform_settlement || String(runtimeConfig.forcePlatformSettlementInSandbox),
    breet_live_enabled: settings.breet_live_enabled || String(runtimeConfig.liveEnabled),
    breet_allow_pending_as_completed_in_development:
      settings.breet_allow_pending_as_completed_in_development ||
      String(runtimeConfig.allowPendingAsCompletedInDevelopment),
  };
  const breetSettlementRecords = ((settlementRes.data as BreetSettlementRecordRow[] | null) || []).map((record) => ({
    ...record,
    merchant_name: merchantMap[String(record.merchant_id || "")] || record.merchant_id,
  }));
  const recentWebhookLogs = webhooksRes.error ? [] : webhookLogs;
  const pendingAutoSettlements = [...paymentSessions, ...cryptoPaymentSessions].filter((session) =>
    ["pending", "PENDING", "AWAITING_CONFIRMATION", "SETTLEMENT_PENDING", "crypto_payment_waiting", "crypto_payment_detected", "crypto_payment_confirming", "crypto_settlement_pending"].includes(
      String(session.status || session.crypto_status || session.payment_status || "")
    )
  ).length;
  const failedSettlements = [...paymentSessions, ...cryptoPaymentSessions].filter((session) =>
    ["failed", "FAILED", "crypto_expired", "crypto_settlement_failed"].includes(
      String(session.status || session.crypto_status || session.payment_status || "")
    )
  ).length;
  const settledAmount = breetSettlementRecords.reduce((sum, record) => sum + Number(record.actual_settlement || record.amount_settled || 0), 0);
  const reconciliationDelta = breetSettlementRecords.reduce((sum, record) => sum + Math.abs(Number(record.settlement_difference || 0)), 0);
  const manualQueueDepth = manualTreasuryEnabled
    ? settlementBatches.filter((batch) => ["queued", "processing", "held"].includes(batch.status)).length
    : 0;

  const summary = {
    totalCryptoInflow: treasuryTransactions.reduce((sum, tx) => sum + Number(tx.gross_ngn || 0), 0),
    pendingAutoSettlements,
    settledAmount,
    failedSettlements,
    webhookFailures: recentWebhookLogs.filter((log) => log.status === "failed").length,
    underReviewCount: [...paymentSessions, ...cryptoPaymentSessions].filter((session) =>
      ["UNDER_REVIEW", "manual_review", "crypto_underpaid", "crypto_overpaid"].includes(String(session.status || session.crypto_status || ""))
    ).length,
    queueDepth: manualQueueDepth,
    reconciliationDelta,
  };

  return NextResponse.json({
    summary,
    merchants,
    wallets: manualTreasuryEnabled ? wallets : [],
    treasuryTransactions,
    settlementBatches: manualTreasuryEnabled ? settlementBatches : [],
    paymentSessions: [...paymentSessions, ...cryptoPaymentSessions],
    settlementRecords: breetSettlementRecords,
    webhookLogs: recentWebhookLogs,
    settings: editableSettings,
    breetBanks,
    savedIntegrationBanks,
    configStatus: {
      settlementMode: runtimeConfig.settlementMode,
      apiEnvironment: runtimeConfig.apiEnvironment,
      appIdConfigured: Boolean(process.env.BREET_APP_ID),
      appSecretConfigured: Boolean(process.env.BREET_APP_SECRET),
      liveEnabled: runtimeConfig.liveEnabled,
      webhookUrl: runtimeConfig.webhookUrl,
      webhookConfigured: providerHealth.webhookConfigured,
      invoiceCryptoEnabled: runtimeConfig.invoiceCryptoEnabled,
      subscriptionCryptoEnabled: runtimeConfig.subscriptionCryptoEnabled,
      minimumAutoSettlementNgn: runtimeConfig.minimumAutoSettlementNgn,
      platformSettlementBankValidated: runtimeConfig.platformSettlementBankValidated,
      merchantAutoSettlementEnabled: runtimeConfig.merchantAutoSettlementEnabled,
      platformAutoSettlementEnabled: runtimeConfig.platformAutoSettlementEnabled,
      platformSettlementBankAccount: runtimeConfig.platformSettlementBankAccount,
      defaultReceiveCurrency: runtimeConfig.defaultReceiveCurrency,
      forcePlatformSettlementInSandbox: runtimeConfig.forcePlatformSettlementInSandbox,
      supportedAssets: runtimeConfig.supportedAssets,
      supportedNetworks: runtimeConfig.supportedNetworks,
      configWarnings: getBreetConfigWarnings(runtimeConfig),
      manualTreasuryEnabled,
      manualQueueFunctionAvailable,
      manualPayoutProviders: manualTreasuryEnabled ? [...MANUAL_PAYOUT_PROVIDERS] : [],
    },
    merchantReadiness,
    providerHealth,
  });
}

export async function POST(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const providerHealth = getBreetProviderHealth();

  const body = (await request.json().catch(() => null)) as
    | {
        action?: string;
        merchantId?: string | null;
        payoutProvider?: string;
        settings?: Record<string, string>;
        bankId?: string;
        accountNumber?: string;
        narration?: string;
      }
    | null;

  if (!body?.action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
  }

  if (body.action === "queue_settlements") {
    const runtimeConfig = await loadBreetRuntimeConfig(supabase);
    if (runtimeConfig.settlementMode !== "treasury_manual") {
      return NextResponse.json({
        error: "Manual settlement queue is disabled because Breet auto-settlement is active.",
      }, { status: 409 });
    }

    const provider = isManualPayoutProvider(body.payoutProvider) ? body.payoutProvider : null;
    if (!provider) {
      return NextResponse.json({ error: "Invalid manual payout provider." }, { status: 400 });
    }

    const functionExists = await hasManualQueueFunction();
    if (!functionExists) {
      return NextResponse.json({
        error: "Manual treasury settlement is enabled, but the queue function is not available in this environment.",
      }, { status: 409 });
    }

    const { data, error } = await supabase.rpc("queue_pending_crypto_settlements", {
      p_merchant_id: body.merchantId || null,
      p_payout_provider: provider,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, result: data });
  }

  if (body.action === "save_settings") {
    const entries = Object.entries(body.settings || {}).filter(([key]) => CONFIG_KEYS.includes(key));
    if (entries.length === 0) {
      return NextResponse.json({ error: "No treasury settings provided" }, { status: 400 });
    }

    const payload = entries.map(([key, value]) => ({ key, value: normalizeSettingValue(key, value) }));
    const webhookUrlEntry = payload.find((entry) => entry.key === "breet_webhook_url");
    if (webhookUrlEntry?.value) {
      const webhookError = validateWebhookUrl(webhookUrlEntry.value);
      if (webhookError) {
        return NextResponse.json({ error: webhookError }, { status: 400 });
      }
    }
    const envEntry = payload.find((entry) => entry.key === "breet_api_environment");
    if (envEntry && !["development", "production"].includes(envEntry.value)) {
      return NextResponse.json({ error: "Breet API environment must be development or production." }, { status: 400 });
    }
    const platformBankFields = new Set([
      "breet_platform_bank_id",
      "breet_platform_bank_name",
      "breet_platform_account_number",
      "breet_platform_account_name",
    ]);
    const touchedPlatformBankField = entries.some(([key]) => platformBankFields.has(key));
    const explicitlySetValidated = entries.some(([key]) => key === "breet_platform_bank_validated");
    if (touchedPlatformBankField && !explicitlySetValidated) {
      payload.push({ key: "breet_platform_bank_validated", value: "false" });
    }
    const { error } = await supabase.from("platform_settings").upsert(payload, { onConflict: "key" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  if (body.action === "validate_platform_breet_bank") {
    const runtimeConfig = await loadBreetRuntimeConfig(supabase);
    if (!providerHealth.configured) {
      return NextResponse.json({ error: "Breet credentials are incomplete." }, { status: 409 });
    }

    const bankId = String(body.bankId || "").trim();
    const accountNumber = String(body.accountNumber || "").trim();
    if (!bankId || !accountNumber) {
      return NextResponse.json({ error: "Bank and account number are required." }, { status: 400 });
    }

    try {
      const [banks, validation] = await Promise.all([
        fetchBreetBanks("ngn", runtimeConfig.apiEnvironment),
        validateBreetBankAccount({ bankId, accountNumber }, runtimeConfig.apiEnvironment),
      ]);
    const matchedBank = banks.find((bank) => bank.id === bankId);
    const payload = [
      { key: "breet_platform_bank_id", value: bankId },
      { key: "breet_platform_bank_name", value: validation.bankName || matchedBank?.name || "" },
      { key: "breet_platform_account_number", value: validation.accountNumber || accountNumber },
      { key: "breet_platform_account_name", value: validation.accountName || "" },
      { key: "breet_platform_bank_validated", value: "true" },
    ];

    const { error } = await supabase.from("platform_settings").upsert(payload, { onConflict: "key" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from("audit_logs").insert({
      event_type: "breet_platform_bank_validated",
      actor_id: null,
      actor_role: "admin",
      target_id: bankId,
      target_type: "platform_setting",
      metadata: {
        bank_id: bankId,
        bank_name: validation.bankName || matchedBank?.name || null,
        account_number_masked: maskAccountNumber(accountNumber),
        validation_payload: validation.raw,
      },
    });

    return NextResponse.json({
      success: true,
      validation,
      bank: matchedBank || null,
    });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to validate Breet bank account.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (body.action === "add_platform_breet_integration_bank") {
    const runtimeConfig = await loadBreetRuntimeConfig(supabase);
    if (!providerHealth.configured) {
      return NextResponse.json({ error: "Breet credentials are incomplete." }, { status: 409 });
    }

    const bankId = String(body.bankId || "").trim();
    const accountNumber = String(body.accountNumber || "").trim();
    const narration = String(body.narration || "DeraLedger platform settlement").trim();
    if (!bankId || !accountNumber) {
      return NextResponse.json({ error: "Bank and account number are required." }, { status: 400 });
    }

    try {
      const result = await addBreetIntegrationBank({
        bankId,
        accountNumber,
        narration,
      }, runtimeConfig.apiEnvironment);

      await supabase.from("platform_settings").upsert([
        { key: "breet_platform_bank_id", value: bankId },
        { key: "breet_platform_bank_name", value: result.bankName || "" },
        { key: "breet_platform_account_number", value: result.accountNumber || accountNumber },
        { key: "breet_platform_account_name", value: result.accountName || "" },
        { key: "breet_platform_bank_validated", value: "true" },
      ], { onConflict: "key" });

      await supabase.from("audit_logs").insert({
        event_type: "breet_platform_integration_bank_added",
        actor_id: null,
        actor_role: "admin",
        target_id: result.id || bankId,
        target_type: "platform_setting",
        metadata: {
          bank_id: bankId,
          bank_name: result.bankName || null,
          account_number_masked: maskAccountNumber(accountNumber),
          narration,
          integration_payload: result.raw,
        },
      });

      return NextResponse.json({
        success: true,
        integrationBank: result,
        savedIntegrationBanks: await fetchSavedBreetIntegrationBanks(runtimeConfig.apiEnvironment).catch(() => []),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add Breet integration bank.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  if (body.action === "confirm_merchant_breet_mapping") {
    const merchantId = String(body.merchantId || "").trim();
    const bankId = String(body.bankId || "").trim();
    if (!merchantId || !bankId) {
      return NextResponse.json({ error: "Merchant and Breet bank are required." }, { status: 400 });
    }

    const runtimeConfig = await loadBreetRuntimeConfig(supabase);
    const merchantContext = await loadMerchantAccountContext(merchantId);
    if (!merchantContext) {
      return NextResponse.json({ error: "Merchant settlement account not found." }, { status: 404 });
    }
    const existingMappingState = getMerchantBreetMappingState(
      {
        bank_name: merchantContext.account.bank_name,
        bank_code: merchantContext.account.bank_code,
        bank_id: merchantContext.mapping?.provider_account_reference || null,
        account_number: merchantContext.account.account_number,
        account_name: merchantContext.account.account_name,
        raw_verification_payload: {
          ...(merchantContext.account.raw_verification_payload || {}),
          ...(merchantContext.mapping?.raw_provider_response || {}),
        },
      },
      merchantContext.mapping || null,
      runtimeConfig.apiEnvironment
    );

    const banks = providerHealth.configured
      ? await withBreetTimeout(fetchBreetBanks("ngn", runtimeConfig.apiEnvironment).catch(() => []), "Breet bank lookup timed out.")
      : [];
    const matchedBank = banks.find((bank) => bank.id === bankId) || null;
    const bankChanged = existingMappingState.mappedBankId !== bankId;
    const nextRawPayload = {
      ...(merchantContext.account.raw_verification_payload || {}),
      breet_bank_id: bankId,
      breet_bank_name: matchedBank?.name || merchantContext.account.bank_name,
      breet_mapping_confirmed: true,
      mapping_confirmed_by_admin: true,
      breet_mapping_confirmed_at: new Date().toISOString(),
      ...(bankChanged ? {
        breet_bank_validation_payload: null,
        breet_bank_validation_passed: false,
        breet_validation_passed: false,
        breet_validation_reason_code: "breet_validation_pending",
        breet_validation_warning_code: null,
      } : {}),
    };

    await supabase
      .from("merchant_settlement_accounts")
      .update({
        raw_verification_payload: nextRawPayload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", merchantContext.account.id);

    await supabase
      .from("merchant_provider_settlement_accounts")
      .upsert({
        merchant_id: merchantId,
        settlement_account_id: merchantContext.account.id,
        provider_name: "breet",
        provider_account_reference: bankId,
        status: !bankChanged && existingMappingState.validationPassed ? "connected" : "requires_action",
        environment: merchantContext.environment,
        raw_provider_response: {
          ...(merchantContext.mapping?.raw_provider_response || {}),
          breet_bank_id: bankId,
          breet_bank_name: matchedBank?.name || merchantContext.account.bank_name,
          breet_mapping_confirmed: true,
          mapping_confirmed_by_admin: true,
          breet_mapping_confirmed_at: new Date().toISOString(),
          ...(bankChanged ? {
            status: "requires_action",
            reason_code: "breet_validation_pending",
            merchant_message: "Crypto payments are not yet connected to this payout account.",
            admin_note: "Bank mapping was updated. Run Breet account validation before allowing crypto collections.",
            recommended_action: "Validate the merchant account against Breet for the active payout account.",
            breet_bank_validation_payload: null,
            breet_bank_validation_passed: false,
            breet_validation_passed: false,
            breet_validation_reason_code: "breet_validation_pending",
            breet_validation_warning_code: null,
            last_failure_at: new Date().toISOString(),
          } : {}),
        },
        last_sync_at: new Date().toISOString(),
      }, { onConflict: "settlement_account_id,provider_name,environment" });

    await supabase.from("audit_logs").insert({
      event_type: "breet_merchant_bank_mapping_confirmed",
      actor_id: null,
      actor_role: "admin",
      target_id: merchantId,
      target_type: "merchant_settlement_account",
      metadata: {
        merchant_id: merchantId,
        settlement_account_id: merchantContext.account.id,
        bank_id: bankId,
        bank_name: matchedBank?.name || merchantContext.account.bank_name,
        account_number_masked: maskAccountNumber(merchantContext.account.account_number),
      },
    });

    return NextResponse.json(await buildCryptoActionResponse({
      merchantId,
      environment: merchantContext.environment,
      success: true,
      fallbackStatus: bankChanged || !existingMappingState.validationPassed ? "setup_required" : "ready",
      fallbackReasonCode: bankChanged ? "breet_validation_pending" : null,
      fallbackMerchantMessage: "Crypto payments are not yet connected to this payout account.",
      fallbackAdminMessage: bankChanged
        ? "Bank mapping saved. Account validation is still required."
        : (existingMappingState.validationPassed
          ? "Bank mapping saved. Existing Breet account validation remains active."
          : "Bank mapping saved. Account validation is still required."),
    }));
  }

  if (body.action === "validate_merchant_breet_bank") {
    const merchantId = String(body.merchantId || "").trim();
    const bankId = String(body.bankId || "").trim();
    if (!merchantId || !bankId) {
      return NextResponse.json({ error: "Merchant and Breet bank are required." }, { status: 400 });
    }

    const runtimeConfig = await loadBreetRuntimeConfig(supabase);
    const merchantContext = await loadMerchantAccountContext(merchantId);
    if (!merchantContext) {
      return NextResponse.json({ error: "Merchant settlement account not found." }, { status: 404 });
    }

    try {
      const [banks, validation] = await Promise.all([
        withBreetTimeout(fetchBreetBanks("ngn", runtimeConfig.apiEnvironment), "Breet bank lookup timed out."),
        withBreetTimeout(validateBreetBankAccount({
          bankId,
          accountNumber: merchantContext.account.account_number,
        }, runtimeConfig.apiEnvironment), "Breet validation timed out."),
      ]);
      const matchedBank = banks.find((bank) => bank.id === bankId) || null;
      const validatedAt = new Date().toISOString();
      const assessment = assessBreetValidationForSettlementAccount(
        {
          bank_name: merchantContext.account.bank_name,
          bank_code: merchantContext.account.bank_code,
          bank_id: bankId,
          account_number: merchantContext.account.account_number,
          account_name: merchantContext.account.account_name,
          raw_verification_payload: merchantContext.account.raw_verification_payload || {},
        },
        {
          env: runtimeConfig.apiEnvironment,
          expectedBankId: bankId,
          validation,
          mapping: merchantContext.mapping || null,
        }
      );
      const nextRawPayload = {
        ...(merchantContext.account.raw_verification_payload || {}),
        breet_bank_id: bankId,
        breet_bank_name: matchedBank?.name || merchantContext.account.bank_name,
        breet_bank_validation_payload: validation.raw,
        breet_bank_validation_passed: assessment.passed,
        breet_validation_passed: assessment.passed,
        breet_bank_validation_at: validatedAt,
        validated_account_number: validation.accountNumber || merchantContext.account.account_number,
        breet_returned_account_name: validation.accountName || null,
        breet_validation_reason_code: assessment.reasonCode,
        breet_validation_warning_code: assessment.warningReasonCode,
        breet_mapping_confirmed: true,
        mapping_confirmed_by_admin: true,
      };

      await supabase
      .from("merchant_settlement_accounts")
      .update({
          raw_verification_payload: nextRawPayload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", merchantContext.account.id);

      await supabase
        .from("merchant_provider_settlement_accounts")
        .upsert({
          merchant_id: merchantId,
          settlement_account_id: merchantContext.account.id,
          provider_name: "breet",
          provider_account_reference: bankId,
          status: assessment.passed ? "connected" : "requires_action",
          environment: merchantContext.environment,
          raw_provider_response: {
            ...(merchantContext.mapping?.raw_provider_response || {}),
            breet_bank_id: bankId,
            breet_bank_name: matchedBank?.name || merchantContext.account.bank_name,
            breet_bank_validation_payload: validation.raw,
            breet_bank_validation_passed: assessment.passed,
            breet_validation_passed: assessment.passed,
            breet_bank_validation_at: validatedAt,
            breet_mapping_confirmed: true,
            mapping_confirmed_by_admin: true,
            status: assessment.passed ? "connected" : "requires_action",
            reason_code: assessment.reasonCode,
            warning_reason_code: assessment.warningReasonCode,
            merchant_message: assessment.passed ? null : "Crypto payments are not yet connected to this payout account.",
            admin_note: assessment.passed
              ? null
              : "Breet account validation did not confirm the active payout account. Re-run validation after fixing the mapped bank or account details.",
            recommended_action: assessment.passed
              ? null
              : "Validate the merchant account against Breet again after confirming the mapped bank and payout account details.",
            retryable: true,
            last_checked_at: validatedAt,
            last_success_at: assessment.passed ? validatedAt : null,
            last_failure_at: assessment.passed ? null : validatedAt,
            lastError: assessment.passed ? null : "Breet validation did not confirm the active payout account.",
            source: "breet_account_validation",
          },
          last_sync_at: new Date().toISOString(),
        }, { onConflict: "settlement_account_id,provider_name,environment" });

      await supabase.from("audit_logs").insert({
        event_type: "breet_merchant_bank_validated",
        actor_id: null,
        actor_role: "admin",
        target_id: merchantId,
        target_type: "merchant_settlement_account",
        metadata: {
          merchant_id: merchantId,
          settlement_account_id: merchantContext.account.id,
          bank_id: bankId,
          bank_name: validation.bankName || matchedBank?.name || null,
          account_number_masked: maskAccountNumber(merchantContext.account.account_number),
          validation_payload: validation.raw,
        },
      });

      return NextResponse.json(await buildCryptoActionResponse({
        merchantId,
        environment: merchantContext.environment,
        success: true,
        fallbackStatus: assessment.passed ? "ready" : "requires_action",
        fallbackReasonCode: assessment.reasonCode,
        fallbackMerchantMessage: assessment.passed
          ? "Crypto payouts are now connected to this payout account."
          : "Crypto payouts could not be activated for this account. Please try again or contact support.",
        fallbackAdminMessage: assessment.passed
          ? (assessment.note || "Breet account validation passed.")
          : `Breet account validation failed: ${assessment.reasonCode || "breet_validation_failed"}.`,
      }));
    } catch (error) {
      const failedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "Failed to validate merchant Breet bank account.";
      const reasonCode = message.toLowerCase().includes("timed out")
        ? "breet_validation_timeout"
        : "breet_validation_failed";
      await supabase
        .from("merchant_provider_settlement_accounts")
        .upsert({
          merchant_id: merchantId,
          settlement_account_id: merchantContext.account.id,
          provider_name: "breet",
          provider_account_reference: bankId,
          status: "requires_action",
          environment: merchantContext.environment,
          raw_provider_response: {
            ...(merchantContext.mapping?.raw_provider_response || {}),
            breet_bank_id: bankId,
            breet_bank_name: merchantContext.account.bank_name,
            breet_mapping_confirmed: true,
            mapping_confirmed_by_admin: true,
            breet_bank_validation_passed: false,
            breet_validation_passed: false,
            status: "requires_action",
            source: "breet_account_validation",
            reason_code: reasonCode,
            merchant_message: "Crypto payments are not yet connected to this payout account.",
            admin_note: reasonCode === "breet_validation_timeout"
              ? "Breet account validation timed out before confirming the active payout account."
              : "Breet account validation failed before confirming the active payout account.",
            recommended_action: "Retry Breet account validation for the active payout account.",
            retryable: true,
            last_checked_at: failedAt,
            last_failure_at: failedAt,
            lastError: message,
          },
          last_sync_at: failedAt,
        }, { onConflict: "settlement_account_id,provider_name,environment" });

      return NextResponse.json(await buildCryptoActionResponse({
        merchantId,
        environment: merchantContext.environment,
        success: false,
        fallbackStatus: reasonCode === "breet_validation_timeout" ? "timeout" : "failed",
        fallbackReasonCode: reasonCode,
        fallbackMerchantMessage: reasonCode === "breet_validation_timeout"
          ? "Crypto setup is taking longer than expected. Please try again."
          : "Crypto payouts could not be activated for this account. Please try again or contact support.",
        fallbackAdminMessage: reasonCode === "breet_validation_timeout"
          ? "Breet validation timed out. Please retry."
          : `Breet account validation failed: ${message}`,
      }));
    }
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}

function isManualPayoutProvider(value: unknown): value is ManualPayoutProvider {
  return typeof value === "string" && MANUAL_PAYOUT_PROVIDERS.includes(value as ManualPayoutProvider);
}

async function hasManualQueueFunction() {
  const { data, error } = await supabase
    .schema("information_schema")
    .from("routines")
    .select("routine_name")
    .eq("routine_schema", "public")
    .eq("routine_name", "queue_pending_crypto_settlements")
    .limit(1);

  if (error) {
    console.error("Failed to check queue_pending_crypto_settlements availability:", error.message);
    return false;
  }

  return Boolean(data && data.length > 0);
}

function maskAccountNumber(accountNumber?: string | null) {
  const value = String(accountNumber || "").trim();
  if (!value) return null;
  return `****${value.slice(-4)}`;
}

async function buildCryptoActionResponse(input: {
  merchantId: string;
  environment: "sandbox" | "live";
  success: boolean;
  fallbackStatus: CryptoActionResponse["status"];
  fallbackReasonCode?: string | null;
  fallbackMerchantMessage: string;
  fallbackAdminMessage: string | null;
}) {
  const readinessSnapshot = await getMerchantPaymentMethodReadiness(supabase, {
    merchantId: input.merchantId,
    environment: input.environment,
    purpose: "invoice_payment",
  });
  const cryptoReadiness = readinessSnapshot.methods.find((entry) => entry.method === "crypto");
  const ready = Boolean(cryptoReadiness?.ready);
  let status: CryptoActionResponse["status"] = input.fallbackStatus;
  if (ready) {
    status = "ready";
  } else {
    const reasonCode = String(cryptoReadiness?.reason_code || input.fallbackReasonCode || "");
    if (reasonCode === "breet_validation_timeout") status = "timeout";
    else if (reasonCode === "breet_validation_failed") status = "failed";
    else if (["needs_attention", "temporarily_unavailable"].includes(String(cryptoReadiness?.status || ""))) status = "requires_action";
    else status = "setup_required";
  }

  return {
    success: input.success,
    method: "crypto" as const,
    status,
    ready,
    reason_code: cryptoReadiness?.reason_code || input.fallbackReasonCode || null,
    merchant_message: ready
      ? "Crypto payouts are now connected to this payout account."
      : (cryptoReadiness?.message || input.fallbackMerchantMessage),
    admin_message: ready
      ? (input.fallbackAdminMessage || "Breet account validation passed.")
      : input.fallbackAdminMessage,
    readiness: {
      method: "crypto" as const,
      label: cryptoReadiness?.label || "Crypto payments",
      status: cryptoReadiness?.display_status || (ready ? "Ready" : "Setup required"),
      ready,
    },
  };
}

async function loadMerchantReadiness(
  merchantId: string,
  merchantName: string | null,
  banks: BreetBankListItem[]
): Promise<MerchantReadinessStatus | null> {
  const merchantContext = await loadMerchantAccountContext(merchantId);

  if (!merchantContext) {
    return {
      merchantId,
      merchantName,
      hasVerifiedSettlementAccount: false,
      hasMappedBreetBankId: false,
      validationConfirmed: false,
      mappingConfirmedByAdmin: false,
      validationPassed: false,
      amountThresholdEnforced: true,
      merchantSettlementAccount: null,
      currentBreetBank: null,
      matchedBreetBank: null,
      mappingEnvironment: null,
      validationNote: null,
    };
  }

  const { account, mapping, environment } = merchantContext;
  const mergedAccount = {
    bank_name: account.bank_name,
    bank_code: account.bank_code,
    bank_id:
      resolveBreetBankId({
        bank_name: account.bank_name,
        bank_code: account.bank_code,
        bank_id: typeof mapping?.provider_account_reference === "string" ? mapping.provider_account_reference : null,
        account_number: account.account_number,
        account_name: account.account_name,
        raw_verification_payload: {
          ...(account.raw_verification_payload || {}),
          ...(mapping?.raw_provider_response || {}),
        },
      }) || null,
    account_number: account.account_number,
    account_name: account.account_name,
    raw_verification_payload: {
      ...(account.raw_verification_payload || {}),
      ...(mapping?.raw_provider_response || {}),
    },
  };
  const mappingState = getMerchantBreetMappingState(mergedAccount, mapping || null, environment === "live" ? "production" : "development");
  const matchedBank = matchBreetBank(mergedAccount, banks) || null;

  const hasVerifiedSettlementAccount =
    account.verification_status === "verified" &&
    account.status === "active" &&
    Boolean(account.account_number);
  const hasMappedBreetBankId = mappingState.hasMappedBankId;
  const validationConfirmed = hasMappedBreetBankId && mappingState.validationPassed;

  return {
    merchantId,
    merchantName,
    hasVerifiedSettlementAccount,
    hasMappedBreetBankId,
    validationConfirmed,
    mappingConfirmedByAdmin: mappingState.mappingConfirmed,
    validationPassed: mappingState.validationPassed,
    amountThresholdEnforced: true,
    merchantSettlementAccount: {
      id: account.id,
      bankName: account.bank_name,
      bankCode: account.bank_code,
      maskedAccountNumber: maskAccountNumber(account.account_number),
      accountName: account.account_name,
      verificationStatus: account.verification_status,
      status: account.status,
    },
    currentBreetBank: mappingState.mappedBankId
      ? {
          bankId: mappingState.mappedBankId,
          bankName: String(
            mergedAccount.raw_verification_payload?.breet_bank_name ||
            mergedAccount.raw_verification_payload?.bank_name ||
            matchedBank?.name ||
            ""
          ) || null,
        }
      : null,
    matchedBreetBank: matchedBank ? { bankId: matchedBank.id, bankName: matchedBank.name } : null,
    mappingEnvironment: environment,
    validationNote: mappingState.validationNote,
  };
}

async function loadMerchantAccountContext(merchantId: string) {
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id, email")
    .eq("id", merchantId)
    .maybeSingle();

  if (!merchant) return null;

  const environment = getPaymentEnvironmentForMerchantEmail(merchant.email);
  const { data: account } = await supabase
    .from("merchant_settlement_accounts")
    .select("id, bank_name, bank_code, account_number, account_name, verification_status, status, raw_verification_payload")
    .eq("merchant_id", merchantId)
    .eq("is_default", true)
    .maybeSingle();

  if (!account) return null;

  const { data: mapping } = await supabase
    .from("merchant_provider_settlement_accounts")
    .select("provider_account_reference, raw_provider_response, status")
    .eq("merchant_id", merchantId)
    .eq("settlement_account_id", account.id)
    .eq("provider_name", "breet")
    .eq("environment", environment)
    .maybeSingle();

  return {
    merchant,
    environment,
    account,
    mapping,
  };
}

function normalizeSettingValue(key: string, value: string) {
  const trimmed = String(value || "").trim();
  if (key === "breet_api_environment") {
    return trimmed.toLowerCase() === "production" ? "production" : "development";
  }
  if ([
    "breet_live_enabled",
    "breet_invoice_crypto_enabled",
    "breet_subscription_crypto_enabled",
    "breet_merchant_auto_settlement_enabled",
    "breet_auto_settlement_enabled",
    "breet_sandbox_force_platform_settlement",
    "breet_allow_pending_as_completed_in_development",
  ].includes(key)) {
    return trimmed === "true" ? "true" : "false";
  }
  if (key === "breet_supported_assets" || key === "breet_supported_networks") {
    return trimmed
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
      .join(",");
  }
  return trimmed;
}

function validateWebhookUrl(value: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!normalized.startsWith("https://")) {
    return "Breet webhook URL must start with https://";
  }
  if (!normalized.endsWith("/api/webhooks/breet")) {
    return "Breet webhook URL must end with /api/webhooks/breet";
  }
  return null;
}
