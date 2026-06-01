import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  "breet_invoice_crypto_enabled",
  "breet_subscription_crypto_enabled",
  "breet_webhook_url",
  "breet_supported_assets",
  "breet_supported_networks",
  "breet_treasury_settlement_account_reference",
  "breet_treasury_settlement_account_label",
  "breet_live_enabled",
];

export async function GET() {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const [
    walletRes,
    treasuryRes,
    batchesRes,
    webhooksRes,
    settingsRes,
    sessionsRes,
    cryptoSessionsRes,
    merchantRes,
  ] = await Promise.all([
    supabase.from("merchant_wallets").select("*").order("updated_at", { ascending: false }).limit(100),
    supabase.from("treasury_transactions").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("settlement_batches").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("treasury_webhook_logs").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("platform_settings").select("key, value").in("key", CONFIG_KEYS),
    supabase.from("payment_sessions").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("crypto_payment_sessions").select("*").order("created_at", { ascending: false }).limit(100),
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
    wallet_address:
      typeof session.raw_payload === "object" && session.raw_payload
        ? String((session.raw_payload as Record<string, unknown>).address || (session.raw_payload as Record<string, unknown>).destinationAddress || "")
        : "",
    confirmation_count: 0,
    expected_confirmations: 0,
    status: session.crypto_status || session.payment_status || "pending",
  }));
  const webhookLogs = (webhooksRes.data || []).map((log) => ({
    ...log,
    merchant_name: log.merchant_id ? merchantMap[log.merchant_id] || log.merchant_id : null,
  }));
  const settings = Object.fromEntries((settingsRes.data || []).map((row) => [row.key, row.value]));

  const summary = {
    totalCryptoInflow: treasuryTransactions.reduce((sum, tx) => sum + Number(tx.gross_ngn || 0), 0),
    pendingSettlements: wallets.reduce((sum, wallet) => sum + Number(wallet.pending_balance || 0), 0),
    lockedSettlements: wallets.reduce((sum, wallet) => sum + Number(wallet.locked_balance || 0), 0),
    settledAmount: wallets.reduce((sum, wallet) => sum + Number(wallet.total_settled || 0), 0),
    failedPayouts: settlementBatches.filter((batch) => batch.status === "failed").length,
    webhookFailures: webhookLogs.filter((log) => log.status === "failed").length,
    underReviewCount: [...paymentSessions, ...cryptoPaymentSessions].filter((session) =>
      ["UNDER_REVIEW", "manual_review", "crypto_underpaid", "crypto_overpaid"].includes(String(session.status || session.crypto_status || ""))
    ).length,
    queueDepth: settlementBatches.filter((batch) => ["queued", "processing", "held"].includes(batch.status)).length,
  };

  return NextResponse.json({
    summary,
    merchants,
    wallets,
    treasuryTransactions,
    settlementBatches,
    paymentSessions: [...paymentSessions, ...cryptoPaymentSessions],
    webhookLogs,
    settings,
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
    const { data, error } = await supabase.rpc("queue_pending_crypto_settlements", {
      p_merchant_id: body.merchantId || null,
      p_payout_provider: body.payoutProvider || "paystack",
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
