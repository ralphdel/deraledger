import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";
import {
  getBreetProviderHealth,
  loadBreetRuntimeConfig,
} from "@/lib/services/breet-crypto.service";

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
  "breet_auto_settlement_enabled",
  "breet_merchant_auto_settlement_enabled",
  "breet_invoice_crypto_enabled",
  "breet_subscription_crypto_enabled",
  "breet_min_auto_settlement_ngn",
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
];

export async function GET() {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const runtimeConfig = await loadBreetRuntimeConfig(supabase);
  const providerHealth = getBreetProviderHealth();
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
  ]);

  const merchants = merchantRes.data || [];
  const merchantMap = Object.fromEntries(merchants.map((merchant) => [merchant.id, merchant.business_name]));
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
    settings,
    configStatus: {
      settlementMode: runtimeConfig.settlementMode,
      liveEnabled: runtimeConfig.liveEnabled,
      webhookConfigured: providerHealth.webhookConfigured,
      invoiceCryptoEnabled: runtimeConfig.invoiceCryptoEnabled,
      subscriptionCryptoEnabled: runtimeConfig.subscriptionCryptoEnabled,
      minimumAutoSettlementNgn: runtimeConfig.minimumAutoSettlementNgn,
      merchantAutoSettlementEnabled: runtimeConfig.merchantAutoSettlementEnabled,
      platformAutoSettlementEnabled: runtimeConfig.platformAutoSettlementEnabled,
      platformSettlementBankAccount: runtimeConfig.platformSettlementBankAccount,
      supportedAssets: runtimeConfig.supportedAssets,
      supportedNetworks: runtimeConfig.supportedNetworks,
      manualTreasuryEnabled,
      manualQueueFunctionAvailable,
      manualPayoutProviders: manualTreasuryEnabled ? [...MANUAL_PAYOUT_PROVIDERS] : [],
    },
    providerHealth,
  });
}

export async function POST(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: string; merchantId?: string | null; payoutProvider?: string; settings?: Record<string, string> }
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

    const payload = entries.map(([key, value]) => ({ key, value }));
    const { error } = await supabase.from("platform_settings").upsert(payload, { onConflict: "key" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
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
