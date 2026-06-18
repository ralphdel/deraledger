"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  Coins,
  Copy,
  Loader2,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatNaira } from "@/lib/calculations";

type TreasurySummary = {
  totalCryptoInflow: number;
  pendingAutoSettlements: number;
  settledAmount: number;
  failedSettlements: number;
  webhookFailures: number;
  underReviewCount: number;
  queueDepth: number;
  reconciliationDelta: number;
};

type MerchantOption = { id: string; business_name: string };

type SessionRow = {
  id: string;
  merchant_id?: string | null;
  merchant_name?: string | null;
  reference?: string | null;
  internal_reference?: string | null;
  provider_reference?: string | null;
  payment_purpose?: string | null;
  settlement_mode?: string | null;
  settlement_recipient_type?: string | null;
  expected_settlement_ngn?: number | null;
  expected_ngn_amount?: number | null;
  settlement_account_snapshot?: {
    bank_name?: string | null;
    account_number?: string | null;
    account_name?: string | null;
    currency?: string | null;
  } | null;
  wallet_address?: string | null;
  webhook_status?: string | null;
  crypto_status?: string | null;
  payment_status?: string | null;
  status?: string | null;
  expires_at?: string | null;
  confirmation_count?: number | null;
  expected_confirmations?: number | null;
  created_at: string;
};

type WebhookRow = {
  id: string;
  merchant_id?: string | null;
  merchant_name?: string | null;
  event_type: string;
  status: string;
  processor_reference?: string | null;
  error_message?: string | null;
  created_at: string;
};

type SettlementRecordRow = {
  id: string;
  merchant_id?: string | null;
  merchant_name?: string | null;
  settlement_mode?: string | null;
  settlement_recipient_type?: string | null;
  settlement_status?: string | null;
  settlement_currency?: string | null;
  expected_settlement?: number | null;
  actual_settlement?: number | null;
  settlement_difference?: number | null;
  provider_settlement_reference?: string | null;
  created_at: string;
};

type TreasuryTransactionRow = {
  id: string;
  merchant_id?: string | null;
  merchant_name?: string | null;
  payment_rail?: string | null;
  source_currency?: string | null;
  source_amount?: number | null;
  gross_ngn?: number | null;
  merchant_net_ngn?: number | null;
  status?: string | null;
  settlement_reference?: string | null;
  created_at: string;
};

type SettlementBatchRow = {
  id: string;
  merchant_id?: string | null;
  merchant_name?: string | null;
  payout_provider?: string | null;
  status: string;
  total_amount?: number | null;
  created_at: string;
};

type ConfigStatus = {
  settlementMode: "breet_auto_settlement" | "platform_auto_settlement" | "treasury_manual" | "disabled";
  apiEnvironment: "development" | "production";
  appIdConfigured: boolean;
  appSecretConfigured: boolean;
  liveEnabled: boolean;
  webhookUrl: string | null;
  webhookConfigured: boolean;
  invoiceCryptoEnabled: boolean;
  subscriptionCryptoEnabled: boolean;
  minimumAutoSettlementNgn: number;
  platformSettlementBankValidated: boolean;
  merchantAutoSettlementEnabled: boolean;
  platformAutoSettlementEnabled: boolean;
  platformSettlementBankAccount: {
    bank_name?: string | null;
    bank_code?: string | null;
    bank_id?: string | null;
    account_number?: string | null;
    account_name?: string | null;
    currency?: string | null;
  } | null;
  defaultReceiveCurrency: string;
  forcePlatformSettlementInSandbox: boolean;
  supportedAssets: string[];
  supportedNetworks: string[];
  configWarnings: string[];
  manualTreasuryEnabled: boolean;
  manualQueueFunctionAvailable: boolean;
  manualPayoutProviders: string[];
};

type BreetBankRow = {
  id: string;
  name: string;
  currency?: string;
  monnifyCode?: string | null;
};

type BreetIntegrationBankRow = {
  id: string;
  bankId: string;
  bankName?: string | null;
  accountNumber: string;
  accountName?: string | null;
  narration?: string | null;
  autoSettlement?: boolean;
};

type TreasuryPayload = {
  summary: TreasurySummary;
  merchants: MerchantOption[];
  treasuryTransactions: TreasuryTransactionRow[];
  settlementBatches: SettlementBatchRow[];
  paymentSessions: SessionRow[];
  settlementRecords: SettlementRecordRow[];
  webhookLogs: WebhookRow[];
  settings: Record<string, string>;
  configStatus: ConfigStatus;
  breetBanks: BreetBankRow[];
  savedIntegrationBanks: BreetIntegrationBankRow[];
  merchantReadiness: {
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
  } | null;
  providerHealth: {
    configured: boolean;
    webhookConfigured: boolean;
    env: string;
    baseUrl: string;
  };
};

const SETTING_LABELS: Record<string, string> = {
  crypto_usdt_ngn_rate: "USDT / NGN Rate",
  crypto_usdc_ngn_rate: "USDC / NGN Rate",
  crypto_btc_ngn_rate: "BTC / NGN Rate",
  crypto_eth_ngn_rate: "ETH / NGN Rate",
  crypto_session_ttl_minutes: "Session TTL Minutes",
  crypto_rate_lock_minutes: "Rate Lock Minutes",
  crypto_rate_slippage_bps: "FX Slippage BPS",
  crypto_underpayment_tolerance_bps: "Underpayment Tolerance BPS",
  crypto_manual_review_threshold_bps: "Manual Review Threshold BPS",
  crypto_platform_fee_bps: "Platform Fee BPS",
  crypto_overpayment_action: "Overpayment Action",
  crypto_settlement_currency: "Settlement Currency",
  crypto_btc_confirmations: "BTC Confirmations",
  crypto_eth_confirmations: "ETH Confirmations",
  crypto_usdt_confirmations: "USDT Confirmations",
  crypto_usdc_confirmations: "USDC Confirmations",
  breet_settlement_mode: "Breet Settlement Mode",
  breet_api_environment: "Breet API Environment",
  breet_auto_settlement_enabled: "Platform Auto-Settlement Enabled",
  breet_merchant_auto_settlement_enabled: "Merchant Auto-Settlement Enabled",
  breet_invoice_crypto_enabled: "Invoice Crypto Enabled",
  breet_subscription_crypto_enabled: "Subscription Crypto Enabled",
  breet_min_auto_settlement_ngn: "Minimum Auto-Settlement Amount (NGN)",
  breet_platform_bank_validated: "Platform Bank Validated",
  breet_webhook_url: "Breet Webhook URL",
  breet_supported_assets: "Supported Assets",
  breet_supported_networks: "Supported Networks",
  breet_treasury_settlement_account_reference: "Treasury Settlement Ref",
  breet_treasury_settlement_account_label: "Treasury Settlement Label",
  breet_platform_bank_id: "Platform Bank ID",
  breet_platform_bank_code: "Platform Bank Code",
  breet_platform_bank_name: "Platform Bank Name",
  breet_platform_account_number: "Platform Account Number",
  breet_platform_account_name: "Platform Account Name",
  breet_default_receive_currency: "Default Receive Currency",
  breet_sandbox_force_platform_settlement: "Force Platform Settlement in Sandbox",
  breet_live_enabled: "Breet Live Enabled",
  breet_allow_pending_as_completed_in_development: "Allow Pending As Completed (Dev)",
};
const TREASURY_PAGE_SIZE = 10;

export default function AdminTreasuryPage() {
  const [data, setData] = useState<TreasuryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [merchantFilter, setMerchantFilter] = useState("all");
  const [payoutProvider, setPayoutProvider] = useState("paystack");
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [platformBankId, setPlatformBankId] = useState("");
  const [platformAccountNumber, setPlatformAccountNumber] = useState("");
  const [platformNarration, setPlatformNarration] = useState("DeraLedger platform settlement");
  const [platformAccountNamePreview, setPlatformAccountNamePreview] = useState<string | null>(null);
  const [merchantBreetBankId, setMerchantBreetBankId] = useState("");
  const [merchantValidationNote, setMerchantValidationNote] = useState<string | null>(null);
  const [showAdvancedFallback, setShowAdvancedFallback] = useState(false);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [settlementsPage, setSettlementsPage] = useState(1);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [webhooksPage, setWebhooksPage] = useState(1);
  const [reviewPage, setReviewPage] = useState(1);
  const [batchesPage, setBatchesPage] = useState(1);
  const [mockTradeDraft, setMockTradeDraft] = useState({
    walletAddress: "",
    asset: "USDT_TRX_TEST2",
    amountInUSD: "",
    cryptoReceived: "",
    reference: "",
    txHash: "",
  });
  const [mockTradeResult, setMockTradeResult] = useState<{
    status?: number;
    providerMessage?: string;
    webhookExpected?: boolean;
    error?: string;
  } | null>(null);

  const loadTreasury = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    const merchantParam = merchantFilter !== "all" ? `?merchantId=${encodeURIComponent(merchantFilter)}` : "";
    const res = await fetch(`/api/admin/treasury${merchantParam}`);
    const payload = (await res.json()) as TreasuryPayload | { error?: string };
    if (!res.ok || !("summary" in payload)) {
      setFeedback((payload as { error?: string }).error || "Failed to load treasury console.");
      setLoading(false);
      return;
    }

    setData(payload);
    setSettingsDraft(payload.settings);
    setPayoutProvider(payload.configStatus.manualPayoutProviders[0] || "paystack");
    setPlatformBankId(payload.configStatus.platformSettlementBankAccount?.bank_id || "");
    setPlatformAccountNumber(payload.configStatus.platformSettlementBankAccount?.account_number || "");
    setPlatformAccountNamePreview(payload.configStatus.platformSettlementBankAccount?.account_name || null);
    setMerchantBreetBankId(
      payload.merchantReadiness?.currentBreetBank?.bankId ||
      payload.merchantReadiness?.matchedBreetBank?.bankId ||
      ""
    );
    setMerchantValidationNote(payload.merchantReadiness?.validationNote || null);
    setLoading(false);
  }, [merchantFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTreasury();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTreasury]);

  const mode = data?.configStatus.settlementMode || "disabled";
  const manualTreasuryEnabled = data?.configStatus.manualTreasuryEnabled || false;

  const filteredSessions = useMemo(() => {
    if (!data) return [];
    if (merchantFilter === "all") return data.paymentSessions;
    return data.paymentSessions.filter((session) => session.merchant_id === merchantFilter);
  }, [data, merchantFilter]);

  const filteredWebhooks = useMemo(() => {
    if (!data) return [];
    if (merchantFilter === "all") return data.webhookLogs;
    return data.webhookLogs.filter((log) => log.merchant_id === merchantFilter);
  }, [data, merchantFilter]);

  const filteredTransactions = useMemo(() => {
    if (!data) return [];
    if (merchantFilter === "all") return data.treasuryTransactions;
    return data.treasuryTransactions.filter((tx) => tx.merchant_id === merchantFilter);
  }, [data, merchantFilter]);

  const filteredSettlements = useMemo(() => {
    if (!data) return [];
    if (merchantFilter === "all") return data.settlementRecords;
    return data.settlementRecords.filter((row) => row.merchant_id === merchantFilter);
  }, [data, merchantFilter]);

  const filteredBatches = useMemo(() => {
    if (!data) return [];
    if (merchantFilter === "all") return data.settlementBatches;
    return data.settlementBatches.filter((batch) => batch.merchant_id === merchantFilter);
  }, [data, merchantFilter]);

  const reviewSessions = useMemo(
    () => filteredSessions.filter((session) =>
      ["manual_review", "crypto_underpaid", "crypto_overpaid", "crypto_expired", "crypto_settlement_failed", "failed", "UNDER_REVIEW"]
        .includes(String(session.crypto_status || session.status || session.payment_status || ""))
    ),
    [filteredSessions]
  );
  const pagedSessions = paginateRows(filteredSessions, sessionsPage);
  const pagedSettlements = paginateRows(filteredSettlements, settlementsPage);
  const pagedTransactions = paginateRows(filteredTransactions, ledgerPage);
  const pagedWebhooks = paginateRows(filteredWebhooks, webhooksPage);
  const pagedReviewSessions = paginateRows(reviewSessions, reviewPage);
  const pagedBatches = paginateRows(filteredBatches, batchesPage);

  async function queueSettlements() {
    setBusy("queue");
    setFeedback(null);
    const res = await fetch("/api/admin/treasury", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "queue_settlements",
        merchantId: merchantFilter === "all" ? null : merchantFilter,
        payoutProvider,
      }),
    });
    const payload = (await res.json()) as { error?: string; result?: { created_batches?: number } };
    if (!res.ok) {
      setFeedback(payload.error || "Failed to queue settlements.");
    } else {
      setFeedback(`Queued ${payload.result?.created_batches ?? 0} manual settlement batch(es).`);
      await loadTreasury();
    }
    setBusy(null);
  }

  async function updateBatch(batchId: string, action: string) {
    setBusy(`${action}:${batchId}`);
    setFeedback(null);
    const res = await fetch(`/api/admin/treasury/batches/${batchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const payload = (await res.json()) as { error?: string };
    if (!res.ok) {
      setFeedback(payload.error || `Failed to ${action} batch.`);
    } else {
      setFeedback(`Batch ${action} completed.`);
      await loadTreasury();
    }
    setBusy(null);
  }

  async function saveSettings() {
    setBusy("settings");
    setFeedback(null);
    const res = await fetch("/api/admin/treasury", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save_settings",
        settings: settingsDraft,
      }),
    });
    const payload = (await res.json()) as { error?: string };
    if (!res.ok) {
      setFeedback(payload.error || "Failed to save treasury settings.");
    } else {
      setFeedback("Treasury settings saved.");
      await loadTreasury();
    }
    setBusy(null);
  }

  async function copyWebhookUrl() {
    const webhookUrl = settingsDraft.breet_webhook_url || data?.configStatus.webhookUrl || "";
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setFeedback("Breet webhook URL copied.");
  }

  async function validatePlatformBank() {
    setBusy("validate-platform-bank");
    setFeedback(null);
    const res = await fetch("/api/admin/treasury", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "validate_platform_breet_bank",
        bankId: platformBankId,
        accountNumber: platformAccountNumber,
      }),
    });
    const payload = await res.json() as {
      error?: string;
      validation?: { accountName?: string | null };
    };
    if (!res.ok) {
      setFeedback(payload.error || "Failed to validate platform bank account.");
    } else {
      setPlatformAccountNamePreview(payload.validation?.accountName || null);
      setFeedback("Platform Breet bank validated and saved.");
      await loadTreasury();
    }
    setBusy(null);
  }

  async function addPlatformIntegrationBank() {
    setBusy("add-platform-bank");
    setFeedback(null);
    const res = await fetch("/api/admin/treasury", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "add_platform_breet_integration_bank",
        bankId: platformBankId,
        accountNumber: platformAccountNumber,
        narration: platformNarration,
      }),
    });
    const payload = await res.json() as { error?: string };
    if (!res.ok) {
      setFeedback(payload.error || "Failed to add platform bank to Breet integration.");
    } else {
      setFeedback("Platform bank added to Breet integration.");
      await loadTreasury();
    }
    setBusy(null);
  }

  async function saveMerchantBreetMapping() {
    if (!data?.merchantReadiness || !merchantBreetBankId) return;
    setBusy("save-merchant-bank");
    setFeedback(null);
    setMerchantValidationNote(null);
    try {
      const res = await fetch("/api/admin/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm_merchant_breet_mapping",
          merchantId: data.merchantReadiness.merchantId,
          bankId: merchantBreetBankId,
        }),
      });
      const payload = await res.json().catch(() => ({})) as { error?: string; message?: string; note?: string | null };
      if (!res.ok || payload.error) {
        setFeedback(payload.error || "Failed to save merchant Breet bank mapping.");
      } else {
        setMerchantValidationNote(payload.note || "Bank mapping saved. Account validation is still required.");
        setFeedback(payload.message || "Bank mapping saved. Account validation is still required.");
        await loadTreasury();
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to save merchant Breet bank mapping.");
    } finally {
      setBusy(null);
    }
  }

  async function validateMerchantBreetBank() {
    if (!data?.merchantReadiness || !merchantBreetBankId) return;
    setBusy("validate-merchant-bank");
    setFeedback(null);
    setMerchantValidationNote(null);
    try {
      const res = await fetch("/api/admin/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "validate_merchant_breet_bank",
          merchantId: data.merchantReadiness.merchantId,
          bankId: merchantBreetBankId,
        }),
      });
      const payload = await res.json().catch(() => ({})) as {
        success?: boolean;
        error?: string;
        note?: string | null;
        message?: string;
      };
      if (!res.ok || payload.success === false) {
        setMerchantValidationNote(payload.note || null);
        setFeedback(payload.error || payload.message || "Failed to validate merchant account with Breet.");
      } else {
        setMerchantValidationNote(payload.note || null);
        setFeedback(payload.message || "Breet account validation passed.");
        await loadTreasury();
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to validate merchant account with Breet.");
    } finally {
      setBusy(null);
    }
  }

  async function triggerMockTrade() {
    setBusy("breet-mock-trade");
    setFeedback(null);
    setMockTradeResult(null);
    const res = await fetch("/api/admin/treasury/breet/mock-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: mockTradeDraft.walletAddress.trim(),
        asset: mockTradeDraft.asset.trim(),
        amountInUSD: Number(mockTradeDraft.amountInUSD),
        cryptoReceived: Number(mockTradeDraft.cryptoReceived),
        reference: mockTradeDraft.reference.trim(),
        txHash: mockTradeDraft.txHash.trim(),
      }),
    });
    const payload = await res.json().catch(() => ({})) as {
      error?: string;
      status?: number;
      providerMessage?: string;
      webhookExpected?: boolean;
    };
    if (!res.ok) {
      setMockTradeResult({ status: res.status, error: payload.error || "Failed to trigger Breet mock trade." });
    } else {
      setMockTradeResult({
        status: payload.status,
        providerMessage: payload.providerMessage,
        webhookExpected: payload.webhookExpected,
      });
      setFeedback("Breet sandbox mock trade triggered. Watch webhook events for the provider callback.");
    }
    setBusy(null);
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-neutral-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading treasury console...
      </div>
    );
  }

  if (!data) {
    return <div className="text-sm text-red-600">{feedback || "Treasury console unavailable."}</div>;
  }

  const pendingLabel =
    mode === "platform_auto_settlement"
      ? "Pending Platform Settlements"
      : "Pending Auto-Settlements";
  const checkoutSupportedAssets = data.configStatus.supportedAssets.filter((asset) => ["USDT", "USDC"].includes(asset));
  const showAdvancedTab = manualTreasuryEnabled || showAdvancedFallback;
  const mockTradeDisabled =
    data.configStatus.apiEnvironment !== "development" ||
    data.configStatus.liveEnabled ||
    !data.configStatus.appIdConfigured ||
    !data.configStatus.appSecretConfigured;
  const mockTradeInvalid =
    !mockTradeDraft.walletAddress.trim() ||
    !mockTradeDraft.asset.trim() ||
    Number(mockTradeDraft.amountInUSD) <= 0 ||
    Number(mockTradeDraft.cryptoReceived) <= 0 ||
    !mockTradeDraft.reference.trim() ||
    !mockTradeDraft.txHash.trim();
  const selectedPlatformBank = data.breetBanks.find((bank) => bank.id === platformBankId) || null;
  const selectedMerchantBank = data.breetBanks.find((bank) => bank.id === merchantBreetBankId) || null;
  const webhookUrlDraft = settingsDraft.breet_webhook_url || "";
  const webhookUrlError = webhookUrlDraft &&
    (!webhookUrlDraft.startsWith("https://") || !webhookUrlDraft.endsWith("/api/webhooks/breet"))
      ? "Webhook URL must start with https:// and end with /api/webhooks/breet."
      : null;
  const webhookUrlWarning = webhookUrlDraft.toLowerCase().includes("localhost")
    ? "Breet cannot send webhooks to localhost. Use a public tunnel or deployed URL."
    : null;
  const advancedSettingsKeys = [
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
    "crypto_btc_confirmations",
    "crypto_eth_confirmations",
    "crypto_usdt_confirmations",
    "crypto_usdc_confirmations",
    "breet_treasury_settlement_account_reference",
    "breet_treasury_settlement_account_label",
  ];
  const legacySettingsEntries = advancedSettingsKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(SETTING_LABELS, key))
    .map((key) => [key, SETTING_LABELS[key]] as const);
  const manualFallbackCards = manualTreasuryEnabled
    ? [
        { label: "Queue Depth", value: String(data.summary.queueDepth), icon: ArrowRightLeft, tone: "bg-purple-100 text-purple-700 border-purple-200" },
        { label: "Pending Manual Payouts", value: String(filteredBatches.filter((batch) => ["queued", "processing"].includes(batch.status)).length), icon: Clock3, tone: "bg-purple-100 text-purple-700 border-purple-200" },
        { label: "Locked Payouts", value: String(filteredBatches.filter((batch) => batch.status === "held").length), icon: ShieldAlert, tone: "bg-purple-100 text-purple-700 border-purple-200" },
      ]
    : [];

  const summaryCards = [
    { label: "Crypto Inflow", value: formatNaira(data.summary.totalCryptoInflow), icon: Coins, tone: "bg-blue-100 text-blue-700 border-blue-200" },
    { label: pendingLabel, value: String(data.summary.pendingAutoSettlements), icon: Clock3, tone: "bg-amber-100 text-amber-700 border-amber-200" },
    { label: "Settled", value: formatNaira(data.summary.settledAmount), icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    { label: "Failed Settlements", value: String(data.summary.failedSettlements), icon: AlertTriangle, tone: "bg-red-100 text-red-700 border-red-200" },
    { label: "Webhook Failures", value: String(data.summary.webhookFailures), icon: ShieldAlert, tone: "bg-red-100 text-red-700 border-red-200" },
    { label: "Under Review", value: String(data.summary.underReviewCount), icon: ShieldAlert, tone: "bg-amber-100 text-amber-700 border-amber-200" },
    { label: "Reconciliation Delta", value: formatNaira(data.summary.reconciliationDelta), icon: Coins, tone: "bg-slate-100 text-slate-700 border-slate-200" },
    ...manualFallbackCards,
  ];
  const mockTradeCard = (
    <Card className="border shadow-none">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Breet Sandbox Mock Trade</CardTitle>
          <Badge variant="outline" className="w-fit border-2 bg-neutral-50">
            {data.configStatus.apiEnvironment}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This admin-only tool calls Breet&apos;s development mock-trade endpoint using server-side credentials.
          It is disabled automatically when Breet live mode or production environment is active.
        </div>
        {mockTradeDisabled ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Mock trades are unavailable because Breet is not fully configured for development mode or live mode is enabled.
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-neutral-700">Wallet Address</label>
            <Input
              value={mockTradeDraft.walletAddress}
              onChange={(event) => setMockTradeDraft((current) => ({ ...current, walletAddress: event.target.value }))}
              className="border-2 bg-white font-mono text-xs"
              placeholder="Breet generated wallet address"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700">Asset</label>
            <Input
              value={mockTradeDraft.asset}
              onChange={(event) => setMockTradeDraft((current) => ({ ...current, asset: event.target.value }))}
              className="border-2 bg-white"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700">Amount In USD</label>
            <Input
              value={mockTradeDraft.amountInUSD}
              onChange={(event) => setMockTradeDraft((current) => ({ ...current, amountInUSD: event.target.value }))}
              className="border-2 bg-white"
              inputMode="decimal"
              placeholder="3.12"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700">Crypto Received</label>
            <Input
              value={mockTradeDraft.cryptoReceived}
              onChange={(event) => setMockTradeDraft((current) => ({ ...current, cryptoReceived: event.target.value }))}
              className="border-2 bg-white"
              inputMode="decimal"
              placeholder="3.12"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-700">Reference</label>
            <Input
              value={mockTradeDraft.reference}
              onChange={(event) => setMockTradeDraft((current) => ({ ...current, reference: event.target.value }))}
              className="border-2 bg-white font-mono text-xs"
              placeholder="plan-test-5000-001"
            />
          </div>
          <div className="space-y-2 xl:col-span-2">
            <label className="text-sm font-medium text-neutral-700">Transaction Hash</label>
            <Input
              value={mockTradeDraft.txHash}
              onChange={(event) => setMockTradeDraft((current) => ({ ...current, txHash: event.target.value }))}
              className="border-2 bg-white font-mono text-xs"
              placeholder="0xplan5000test001"
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-neutral-500">
            Reference and txHash must be unique. Secrets are never accepted from this form or shown in responses.
          </p>
          <Button
            onClick={() => void triggerMockTrade()}
            disabled={busy === "breet-mock-trade" || mockTradeDisabled || mockTradeInvalid}
            className="bg-purp-900 hover:bg-purp-800"
          >
            {busy === "breet-mock-trade" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Trigger Mock Trade"}
          </Button>
        </div>
        {mockTradeResult ? (
          <div className={`rounded-xl border p-4 text-sm ${
            mockTradeResult.error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Info label="Breet response status" value={mockTradeResult.status ? String(mockTradeResult.status) : "-"} />
              <Info label="Provider message" value={mockTradeResult.providerMessage || mockTradeResult.error || "-"} />
              <Info label="Webhook expected" value={mockTradeResult.webhookExpected ? "Yes" : "No"} />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-neutral-900">Treasury Console</h1>
            <Badge variant="outline" className="border-2 capitalize">
              {mode.replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="text-neutral-500 text-sm mt-1">
            Monitor Breet crypto collections, per-address auto-settlement, webhook events, and reconciliation.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={merchantFilter} onValueChange={(val) => {
            setMerchantFilter(val || "all");
            setSessionsPage(1);
            setSettlementsPage(1);
            setLedgerPage(1);
            setWebhooksPage(1);
            setReviewPage(1);
            setBatchesPage(1);
          }}>
            <SelectTrigger className="w-[220px] border-2 bg-white">
              <SelectValue placeholder="All Merchants" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Merchants</SelectItem>
              {data.merchants.map((merchant) => (
                <SelectItem key={merchant.id} value={merchant.id}>{merchant.business_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2 border-2" onClick={() => void loadTreasury()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {feedback ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">{feedback}</div>
      ) : null}

      <Card className="border shadow-none">
        <CardContent className="p-5 text-sm text-neutral-700">
          DeraLedger uses Breet per-address auto-settlement. Merchant invoice crypto payments settle directly to each merchant&apos;s linked bank account. Subscription and upgrade crypto payments settle to DeraLedger&apos;s platform account.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <Card key={card.label} className="border shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center ${card.tone}`}>
                  <card.icon className="h-5 w-5" />
                </div>
                <p className="text-xs text-neutral-500 font-medium uppercase">{card.label}</p>
              </div>
              <p className="text-2xl font-bold text-neutral-900">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {mode === "disabled" ? (
        <Card className="border shadow-none">
          <CardContent className="p-5 text-sm text-neutral-600">
            Breet crypto is currently disabled. No operational actions are available until Breet is enabled.
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="overview" className="space-y-4">
        <div className="overflow-x-auto pb-1">
        <TabsList className="inline-flex min-w-max bg-white border">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="mock-trade">Mock Trade</TabsTrigger>
          <TabsTrigger value="platform-bank">Platform Bank Setup</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="manual-review">Manual Review</TabsTrigger>
          {showAdvancedTab ? <TabsTrigger value="advanced">Advanced Fallback</TabsTrigger> : null}
        </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Breet Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <Info label="Breet Settlement Mode" value={labelMode(mode)} />
                  <Info label="Webhook Secret Configured" value={yesNoLabel(data.configStatus.webhookConfigured)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-700">Breet API Environment</label>
                    <Select
                      value={settingsDraft.breet_api_environment || data.configStatus.apiEnvironment}
                      onValueChange={(value) => setSettingsDraft((current) => ({ ...current, breet_api_environment: value ?? "development" }))}
                    >
                      <SelectTrigger className="bg-white border-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="development">Development / Sandbox</SelectItem>
                        <SelectItem value="production">Production / Live</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-neutral-700">Breet Webhook URL</label>
                    <div className="flex gap-2">
                      <Input
                        value={webhookUrlDraft}
                        onChange={(event) => setSettingsDraft((current) => ({ ...current, breet_webhook_url: event.target.value }))}
                        className="bg-white border-2"
                        placeholder="https://www.deraledger.com/api/webhooks/breet"
                      />
                      <Button variant="outline" onClick={() => void copyWebhookUrl()} disabled={!webhookUrlDraft}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    {webhookUrlError ? <p className="text-xs text-red-600">{webhookUrlError}</p> : null}
                    {webhookUrlWarning ? <p className="text-xs text-amber-700">{webhookUrlWarning}</p> : null}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-700">Default Receive Currency</label>
                    <Input
                      value={settingsDraft.breet_default_receive_currency || data.configStatus.defaultReceiveCurrency}
                      onChange={(event) => setSettingsDraft((current) => ({ ...current, breet_default_receive_currency: event.target.value.toUpperCase() }))}
                      className="bg-white border-2"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-700">Minimum Auto-Settlement Amount</label>
                    <Input
                      value={settingsDraft.breet_min_auto_settlement_ngn || String(data.configStatus.minimumAutoSettlementNgn)}
                      onChange={(event) => setSettingsDraft((current) => ({ ...current, breet_min_auto_settlement_ngn: event.target.value }))}
                      className="bg-white border-2"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-700">Supported Assets</label>
                    <Input
                      value={settingsDraft.breet_supported_assets || checkoutSupportedAssets.join(",")}
                      onChange={(event) => setSettingsDraft((current) => ({ ...current, breet_supported_assets: event.target.value }))}
                      className="bg-white border-2"
                    />
                    <p className="text-xs text-neutral-500">Keep first-test checkout assets to USDT and USDC.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-700">Supported Networks</label>
                    <Input
                      value={settingsDraft.breet_supported_networks || data.configStatus.supportedNetworks.join(",")}
                      onChange={(event) => setSettingsDraft((current) => ({ ...current, breet_supported_networks: event.target.value }))}
                      className="bg-white border-2"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  <ToggleRow
                    label="Invoice Crypto Enabled"
                    checked={readBoolSetting(settingsDraft.breet_invoice_crypto_enabled, data.configStatus.invoiceCryptoEnabled)}
                    onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, breet_invoice_crypto_enabled: String(checked) }))}
                  />
                  <ToggleRow
                    label="Subscription Crypto Enabled"
                    checked={readBoolSetting(settingsDraft.breet_subscription_crypto_enabled, data.configStatus.subscriptionCryptoEnabled)}
                    onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, breet_subscription_crypto_enabled: String(checked) }))}
                  />
                  <ToggleRow
                    label="Merchant Auto-Settlement Enabled"
                    checked={readBoolSetting(settingsDraft.breet_merchant_auto_settlement_enabled, data.configStatus.merchantAutoSettlementEnabled)}
                    onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, breet_merchant_auto_settlement_enabled: String(checked) }))}
                  />
                  <ToggleRow
                    label="Platform Auto-Settlement Enabled"
                    checked={readBoolSetting(settingsDraft.breet_auto_settlement_enabled, data.configStatus.platformAutoSettlementEnabled)}
                    onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, breet_auto_settlement_enabled: String(checked) }))}
                  />
                  <ToggleRow
                    label="Force Platform Settlement in Sandbox"
                    checked={readBoolSetting(settingsDraft.breet_sandbox_force_platform_settlement, data.configStatus.forcePlatformSettlementInSandbox)}
                    onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, breet_sandbox_force_platform_settlement: String(checked) }))}
                  />
                  <ToggleRow
                    label="Breet Live Enabled"
                    checked={readBoolSetting(settingsDraft.breet_live_enabled, data.configStatus.liveEnabled)}
                    onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, breet_live_enabled: String(checked) }))}
                    note={checkedWarning(readBoolSetting(settingsDraft.breet_live_enabled, data.configStatus.liveEnabled))}
                  />
                </div>
                {data.configStatus.configWarnings.length > 0 ? (
                  <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    {data.configStatus.configWarnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    onClick={() => void saveSettings()}
                    disabled={busy === "settings" || Boolean(webhookUrlError)}
                    className="bg-purp-900 hover:bg-purp-800"
                  >
                    {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Breet Configuration"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Sandbox Readiness</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <ChecklistItem label="App ID configured" ok={data.configStatus.appIdConfigured} />
                <ChecklistItem label="App Secret configured" ok={data.configStatus.appSecretConfigured} />
                <ChecklistItem label="Webhook Secret configured" ok={data.configStatus.webhookConfigured} />
                <ChecklistItem label="Webhook URL configured" ok={Boolean(data.configStatus.webhookUrl)} />
                <ChecklistItem label="Environment = development" ok={data.configStatus.apiEnvironment === "development"} />
                <ChecklistItem label="Platform Breet bank validated" ok={data.configStatus.platformSettlementBankValidated} />
                <ChecklistItem label="Minimum auto-settlement amount configured" ok={Boolean(data.configStatus.minimumAutoSettlementNgn)} />
                <ChecklistItem label="Invoice crypto enabled" ok={data.configStatus.invoiceCryptoEnabled} />
                <ChecklistItem label="Subscription crypto enabled" ok={data.configStatus.subscriptionCryptoEnabled} />
                <ChecklistItem label="Live disabled" ok={!data.configStatus.liveEnabled} />
              </CardContent>
            </Card>
          </div>

          {mockTradeCard}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Per-Address Auto-Settlement</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-neutral-700">
                <Info label="Platform Settlement Bank" value={formatBankSnapshot(data.configStatus.platformSettlementBankAccount)} />
                <Info label="Platform Bank Validated" value={boolLabel(data.configStatus.platformSettlementBankValidated)} />
                <Info label="Per-Address Mode" value={mode === "breet_auto_settlement" ? "Auto-settlement active" : labelMode(mode)} />
                <div className="rounded-lg border border-neutral-200 p-3 text-sm text-neutral-600">
                  {mode === "breet_auto_settlement"
                    ? "Merchant invoice payments settle to merchant bank accounts. Subscription and upgrade payments settle to the platform account."
                    : mode === "platform_auto_settlement"
                      ? "Platform settlement monitoring is active. Merchant payout queue controls remain hidden."
                      : mode === "treasury_manual"
                        ? "DeraLedger is temporarily responsible for treasury settlement in this mode."
                        : "Breet crypto is disabled until the configuration checklist is complete."}
                </div>
              </CardContent>
            </Card>

            <Card className="border shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Merchant Invoice Readiness</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.merchantReadiness ? (
                  <>
                    <p className="text-sm text-neutral-600">
                      Reviewing readiness for <span className="font-medium text-neutral-900">{data.merchantReadiness.merchantName || data.merchantReadiness.merchantId}</span>.
                    </p>
                    <ChecklistItem label="Merchant has verified settlement account" ok={data.merchantReadiness.hasVerifiedSettlementAccount} />
                    <ChecklistItem label="Merchant settlement account mapped to Breet bankId" ok={data.merchantReadiness.hasMappedBreetBankId} />
                    <ChecklistItem label="Merchant account validation passed" ok={data.merchantReadiness.validationConfirmed} />
                    <ChecklistItem label="Amount above minimum auto-settlement threshold" ok={data.merchantReadiness.amountThresholdEnforced} note="Enforced at checkout." />
                    <div className="rounded-xl border border-neutral-200 p-4 space-y-4">
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">Merchant Breet Bank Mapping</p>
                        <p className="text-xs text-neutral-500 mt-1">Map the merchant&apos;s verified settlement account to a Breet bankId, then validate it before invoice crypto checkout.</p>
                      </div>
                      {data.merchantReadiness.merchantSettlementAccount ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 text-sm">
                          <Info label="Bank Name" value={data.merchantReadiness.merchantSettlementAccount.bankName || "-"} />
                          <Info label="Local Bank Code" value={data.merchantReadiness.merchantSettlementAccount.bankCode || "-"} />
                          <Info label="Account Number" value={data.merchantReadiness.merchantSettlementAccount.maskedAccountNumber || "-"} />
                          <Info label="Account Name" value={data.merchantReadiness.merchantSettlementAccount.accountName || "-"} />
                          <Info label="Verification Status" value={labelValue(data.merchantReadiness.merchantSettlementAccount.verificationStatus)} />
                        </div>
                      ) : null}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                        <Info label="Matched Breet Bank" value={data.merchantReadiness.matchedBreetBank?.bankName || "No auto-match yet"} />
                        <Info label="Matched Breet bankId" value={data.merchantReadiness.matchedBreetBank?.bankId || "-"} />
                        <Info label="Current Breet Mapping" value={data.merchantReadiness.currentBreetBank ? `${data.merchantReadiness.currentBreetBank.bankName || "Mapped bank"} (${data.merchantReadiness.currentBreetBank.bankId})` : "Not saved"} />
                        <Info label="Mapping Environment" value={data.merchantReadiness.mappingEnvironment || "-"} />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_auto] gap-4 items-end">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-neutral-700">Select Breet bank</label>
                          <Select value={merchantBreetBankId || null} onValueChange={(value) => setMerchantBreetBankId(value ?? "")}>
                            <SelectTrigger className="bg-white border-2">
                              <SelectValue placeholder="Select Breet bank" />
                            </SelectTrigger>
                            <SelectContent>
                              {data.breetBanks.map((bank) => (
                                <SelectItem key={bank.id} value={bank.id}>
                                  {bank.name} ({bank.id})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => void saveMerchantBreetMapping()}
                          disabled={busy === "save-merchant-bank" || !merchantBreetBankId}
                        >
                          {busy === "save-merchant-bank"
                            ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving...</span>
                            : "Confirm / Save Mapping"}
                        </Button>
                        <Button
                          onClick={() => void validateMerchantBreetBank()}
                          disabled={busy === "validate-merchant-bank" || !merchantBreetBankId}
                          className="bg-purp-900 hover:bg-purp-800"
                        >
                          {busy === "validate-merchant-bank"
                            ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Validating...</span>
                            : "Validate Merchant Account With Breet"}
                        </Button>
                      </div>
                      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
                        {selectedMerchantBank ? `Selected Breet bank: ${selectedMerchantBank.name} (${selectedMerchantBank.id})` : "Select the correct Breet bank if auto-match is missing."}
                        {merchantValidationNote || data.merchantReadiness.validationNote ? (
                          <p className="mt-2 text-amber-700">{merchantValidationNote || data.merchantReadiness.validationNote}</p>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-neutral-200 p-3 text-sm text-neutral-600">
                    Select a merchant from the filter to inspect invoice settlement readiness.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="mock-trade" className="space-y-4">
          {mockTradeCard}
        </TabsContent>

        <TabsContent value="platform-bank">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Platform Breet Bank Setup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700">Fetch Breet Banks</label>
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                    {data.breetBanks.length} banks loaded
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700">Select Breet Bank</label>
                  <Select value={platformBankId || null} onValueChange={(value) => {
                    setPlatformBankId(value ?? "");
                    setPlatformAccountNamePreview(null);
                  }}>
                    <SelectTrigger className="bg-white border-2">
                      <SelectValue placeholder="Select Breet bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.breetBanks.map((bank) => (
                        <SelectItem key={bank.id} value={bank.id}>
                          {bank.name} ({bank.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700">Selected bankId</label>
                  <Input value={platformBankId} readOnly className="bg-neutral-50 border-2" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700">Bank name</label>
                  <Input value={selectedPlatformBank?.name || ""} readOnly className="bg-neutral-50 border-2" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700">Account number</label>
                  <Input
                    value={platformAccountNamePreview ? maskAccountDigits(platformAccountNumber) : platformAccountNumber}
                    onChange={(event) => {
                      setPlatformAccountNumber(event.target.value);
                      setPlatformAccountNamePreview(null);
                    }}
                    className="bg-white border-2"
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Info label="Resolved Account Name" value={platformAccountNamePreview || "Not validated"} />
                <Info label="Bank Validation Status" value={boolLabel(data.configStatus.platformSettlementBankValidated)} />
                <Info label="Platform Test Account" value="OPay - Paycom · bankId 25 · ******9714" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                <Info label="Platform bankId" value={data.configStatus.platformSettlementBankAccount?.bank_id || "-"} />
                <Info label="Platform bank name" value={data.configStatus.platformSettlementBankAccount?.bank_name || "-"} />
                <Info label="Platform account number" value={maskAccountDigits(data.configStatus.platformSettlementBankAccount?.account_number)} />
                <Info label="Platform account name" value={data.configStatus.platformSettlementBankAccount?.account_name || "-"} />
                <Info
                  label="Saved Integration Bank"
                  value={data.savedIntegrationBanks.some((bank) =>
                    bank.bankId === data.configStatus.platformSettlementBankAccount?.bank_id &&
                    bank.accountNumber.slice(-4) === (data.configStatus.platformSettlementBankAccount?.account_number || "").slice(-4)
                  ) ? "Saved in Breet" : "Not yet saved"}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-700">Add/save integration bank if needed</label>
                  <Input value={platformNarration} onChange={(event) => setPlatformNarration(event.target.value)} className="bg-white border-2" />
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                  <Button
                    onClick={() => void validatePlatformBank()}
                    disabled={busy === "validate-platform-bank" || !platformBankId || !platformAccountNumber}
                    className="bg-purp-900 hover:bg-purp-800"
                  >
                    {busy === "validate-platform-bank" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate Platform Bank"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void addPlatformIntegrationBank()}
                    disabled={busy === "add-platform-bank" || !platformBankId || !platformAccountNumber}
                  >
                    {busy === "add-platform-bank" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add / Save Integration Bank"}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-900">Saved Breet Integration Banks</h3>
                <div className="overflow-x-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow className="bg-neutral-50">
                        <TableHead>Bank</TableHead>
                        <TableHead>Bank ID</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead>Account Name</TableHead>
                        <TableHead>Narration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.savedIntegrationBanks.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8 text-neutral-500">No saved Breet integration banks yet.</TableCell>
                        </TableRow>
                      ) : data.savedIntegrationBanks.map((bank) => (
                        <TableRow key={`${bank.bankId}-${bank.accountNumber}`}>
                          <TableCell>{bank.bankName || "-"}</TableCell>
                          <TableCell>{bank.bankId}</TableCell>
                          <TableCell>{maskAccountDigits(bank.accountNumber)}</TableCell>
                          <TableCell>{bank.accountName || "-"}</TableCell>
                          <TableCell>{bank.narration || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="space-y-4">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Recent Breet Crypto Sessions</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[1000px]">
                <TableHeader>
                  <TableRow className="bg-neutral-50">
                    <TableHead>Merchant</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Expected NGN</TableHead>
                    <TableHead>Wallet / Ref</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSessions.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-neutral-500">No Breet crypto sessions yet.</TableCell></TableRow>
                  ) : pagedSessions.rows.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">{session.merchant_name || "-"}</TableCell>
                      <TableCell className="text-xs">{labelValue(session.payment_purpose)}</TableCell>
                      <TableCell>
                        <StatusBadge status={String(session.crypto_status || session.status || session.payment_status || "pending")} />
                        <p className="text-[11px] text-neutral-500 mt-1">{labelValue(session.settlement_mode)}</p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {labelValue(session.settlement_recipient_type)}
                        <p className="text-[11px] text-neutral-500 mt-1">{maskSettlementAccount(session.settlement_account_snapshot)}</p>
                      </TableCell>
                      <TableCell>{formatNaira(Number(session.expected_settlement_ngn || session.expected_ngn_amount || 0))}</TableCell>
                      <TableCell className="text-xs">
                        {session.wallet_address || "-"}
                        <p className="text-[11px] text-neutral-500 mt-1">{session.provider_reference || session.reference || session.internal_reference || "-"}</p>
                      </TableCell>
                      <TableCell className="text-xs">{new Date(session.created_at).toLocaleString("en-NG")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TreasuryPaginationControls label="sessions" pagination={pagedSessions} onPageChange={setSessionsPage} />
            </CardContent>
          </Card>

        </TabsContent>

        <TabsContent value="settlements" className="space-y-4">
          <Card className="border shadow-none">
            <CardHeader>
              <div className="space-y-1">
                <CardTitle className="text-base">Settlement Records</CardTitle>
                <p className="text-sm text-neutral-500">
                  This view reconciles settlement only. Invoice amount may be higher than settlement amount when the merchant bears provider fees.
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[1120px]">
                <TableHeader>
                  <TableRow className="bg-neutral-50">
                    <TableHead>Merchant</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expected Net Settlement</TableHead>
                    <TableHead>Actual Net Settlement</TableHead>
                    <TableHead>Settlement Delta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSettlements.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-neutral-500">No Breet settlement records yet.</TableCell></TableRow>
                  ) : pagedSettlements.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.merchant_name || "-"}</TableCell>
                      <TableCell className="text-xs">{labelValue(row.settlement_mode)}</TableCell>
                      <TableCell className="text-xs">{labelValue(row.settlement_recipient_type)}</TableCell>
                      <TableCell><StatusBadge status={String(row.settlement_status || "pending")} /></TableCell>
                      <TableCell>{formatNaira(Number(row.expected_settlement || 0))}</TableCell>
                      <TableCell>{row.actual_settlement === null || row.actual_settlement === undefined ? "-" : formatNaira(Number(row.actual_settlement))}</TableCell>
                      <TableCell>{row.settlement_difference === null || row.settlement_difference === undefined ? "-" : formatNaira(Number(row.settlement_difference))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TreasuryPaginationControls label="settlement records" pagination={pagedSettlements} onPageChange={setSettlementsPage} />
            </CardContent>
          </Card>

          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Treasury Ledger</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[940px]">
                <TableHeader>
                  <TableRow className="bg-neutral-50">
                    <TableHead>Merchant</TableHead>
                    <TableHead>Rail</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Settlement Ref</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-neutral-500">No Breet treasury transactions yet.</TableCell></TableRow>
                  ) : pagedTransactions.rows.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-medium">{tx.merchant_name || tx.merchant_id}</TableCell>
                      <TableCell className="uppercase">{tx.payment_rail || "-"}</TableCell>
                      <TableCell><StatusBadge status={String(tx.status || "pending")} /></TableCell>
                      <TableCell>{tx.source_amount || 0} {tx.source_currency || ""}</TableCell>
                      <TableCell className="text-right">{formatNaira(Number(tx.gross_ngn || 0))}</TableCell>
                      <TableCell className="text-right">{formatNaira(Number(tx.merchant_net_ngn || 0))}</TableCell>
                      <TableCell className="text-xs">{tx.settlement_reference || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TreasuryPaginationControls label="ledger entries" pagination={pagedTransactions} onPageChange={setLedgerPage} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Recent Breet Webhook Events</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow className="bg-neutral-50">
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Merchant</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWebhooks.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-neutral-500">No Breet webhook logs yet.</TableCell></TableRow>
                  ) : pagedWebhooks.rows.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs">{new Date(log.created_at).toLocaleString("en-NG")}</TableCell>
                      <TableCell><StatusBadge status={log.status} /></TableCell>
                      <TableCell>{log.merchant_name || "-"}</TableCell>
                      <TableCell>{log.event_type}</TableCell>
                      <TableCell className="text-xs">{log.processor_reference || "-"}</TableCell>
                      <TableCell className="text-xs text-red-600">{log.error_message || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TreasuryPaginationControls label="webhook events" pagination={pagedWebhooks} onPageChange={setWebhooksPage} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual-review" className="space-y-4">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Manual Review Queue</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[820px]">
                <TableHeader>
                  <TableRow className="bg-neutral-50">
                    <TableHead>Merchant</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reviewSessions.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-10 text-neutral-500">No sessions currently under manual review.</TableCell></TableRow>
                  ) : pagedReviewSessions.rows.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">{session.merchant_name || "-"}</TableCell>
                      <TableCell className="text-xs">{labelValue(session.payment_purpose)}</TableCell>
                      <TableCell><StatusBadge status={String(session.crypto_status || session.status || session.payment_status || "pending")} /></TableCell>
                      <TableCell className="text-xs">{labelValue(session.settlement_recipient_type)}</TableCell>
                      <TableCell className="text-xs">{session.provider_reference || session.reference || session.internal_reference || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TreasuryPaginationControls label="review sessions" pagination={pagedReviewSessions} onPageChange={setReviewPage} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4">
          {!manualTreasuryEnabled ? (
            <Card className="border shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Advanced / Legacy Treasury Manual Fallback</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
                  Manual treasury settlement is disabled. Breet payments are expected to auto-settle through Breet.
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {legacySettingsEntries.map(([key, label]) => (
                    <div key={key} className="space-y-2">
                      <label className="text-sm font-medium text-neutral-700">{label}</label>
                      <Input
                        value={settingsDraft[key] || ""}
                        onChange={(event) => setSettingsDraft((current) => ({ ...current, [key]: event.target.value }))}
                        className="bg-white border-2"
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                  <div className="text-sm text-neutral-600">
                    Legacy settlement thresholds and treasury-manual settings are hidden from the main Breet monitoring view.
                  </div>
                  <Button onClick={() => void saveSettings()} disabled={busy === "settings"} className="bg-purp-900 hover:bg-purp-800">
                    {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Legacy Settings"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="border-amber-200 bg-amber-50 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base text-amber-900">Advanced / Legacy Treasury Manual Fallback</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-amber-900">
                  <p>DeraLedger is temporarily responsible for treasury settlement in this mode.</p>
                  {!data.configStatus.manualQueueFunctionAvailable ? (
                    <p>The manual queue function is not available in this environment, so queue actions are blocked.</p>
                  ) : null}
                  <div className="flex items-center gap-2 flex-wrap">
                    {data.configStatus.manualQueueFunctionAvailable ? (
                      <>
                        <Select value={payoutProvider} onValueChange={(val) => setPayoutProvider(val || "paystack")}>
                          <SelectTrigger className="w-[180px] border-2 bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {data.configStatus.manualPayoutProviders.map((provider) => (
                              <SelectItem key={provider} value={provider}>{labelValue(provider)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button className="gap-2 bg-purp-900 hover:bg-purp-800" disabled={busy === "queue"} onClick={() => void queueSettlements()}>
                          {busy === "queue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
                          Queue Settlement
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              <Card className="border shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Manual Settlement Batches</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table className="min-w-[920px]">
                    <TableHeader>
                      <TableRow className="bg-neutral-50">
                        <TableHead>Merchant</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBatches.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-10 text-neutral-500">No manual settlement batches yet.</TableCell></TableRow>
                      ) : pagedBatches.rows.map((batch) => (
                        <TableRow key={batch.id}>
                          <TableCell className="font-medium">{batch.merchant_name || batch.merchant_id}</TableCell>
                          <TableCell className="capitalize">{batch.payout_provider || "-"}</TableCell>
                          <TableCell><StatusBadge status={batch.status} /></TableCell>
                          <TableCell className="text-right">{formatNaira(Number(batch.total_amount || 0))}</TableCell>
                          <TableCell className="text-xs">{new Date(batch.created_at).toLocaleString("en-NG")}</TableCell>
                          <TableCell>
                            <div className="flex gap-2 flex-wrap">
                              <Button size="sm" variant="outline" disabled={busy === `hold:${batch.id}`} onClick={() => void updateBatch(batch.id, "hold")}>Hold</Button>
                              <Button size="sm" variant="outline" disabled={busy === `release:${batch.id}`} onClick={() => void updateBatch(batch.id, "release")}>Release</Button>
                              <Button size="sm" variant="outline" disabled={busy === `retry:${batch.id}`} onClick={() => void updateBatch(batch.id, "retry")}>Retry</Button>
                              <Button size="sm" variant="outline" disabled={busy === `settled:${batch.id}`} onClick={() => void updateBatch(batch.id, "settled")}>Settle</Button>
                              <Button size="sm" variant="outline" disabled={busy === `fail:${batch.id}`} onClick={() => void updateBatch(batch.id, "fail")}>Fail</Button>
                              <Button size="sm" variant="outline" disabled={busy === `reverse:${batch.id}`} onClick={() => void updateBatch(batch.id, "reverse")}>Reverse</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <TreasuryPaginationControls label="manual batches" pagination={pagedBatches} onPageChange={setBatchesPage} />
                </CardContent>
              </Card>

              <Card className="border shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Legacy Treasury Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {legacySettingsEntries.map(([key, label]) => (
                      <div key={key} className="space-y-2">
                        <label className="text-sm font-medium text-neutral-700">{label}</label>
                        <Input
                          value={settingsDraft[key] || ""}
                          onChange={(event) => setSettingsDraft((current) => ({ ...current, [key]: event.target.value }))}
                          className="bg-white border-2"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                    <div className="text-sm text-neutral-600">
                      Legacy settlement and treasury-manual controls only apply while treasury manual mode is active.
                    </div>
                    <Button onClick={() => void saveSettings()} disabled={busy === "settings"} className="bg-purp-900 hover:bg-purp-800">
                      {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Legacy Settings"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {!showAdvancedTab ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setShowAdvancedFallback(true)}>
            Show advanced legacy fallback
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <p className="text-xs uppercase text-neutral-500">{label}</p>
      <p className="font-semibold text-neutral-900 mt-1">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className =
    normalized.includes("complete") || normalized.includes("settled") || normalized === "processed"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : normalized.includes("manual") || normalized.includes("review") || normalized.includes("underpaid") || normalized.includes("overpaid")
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : normalized.includes("fail") || normalized.includes("expired")
          ? "bg-red-50 text-red-700 border-red-200"
          : "bg-blue-50 text-blue-700 border-blue-200";

  return (
    <Badge variant="outline" className={`border-2 capitalize ${className}`}>
      {labelValue(status)}
    </Badge>
  );
}

function boolLabel(value: boolean) {
  return value ? "Enabled" : "Disabled";
}

function yesNoLabel(value: boolean) {
  return value ? "Yes" : "No";
}

function labelMode(value: string) {
  return value.replaceAll("_", " ");
}

function labelValue(value?: string | null) {
  if (!value) return "-";
  return value.replaceAll("_", " ");
}

function maskSettlementAccount(snapshot?: SessionRow["settlement_account_snapshot"] | null) {
  if (!snapshot?.account_number) return snapshot?.bank_name || "Settlement account";
  return `${snapshot.bank_name || "Bank"} ****${snapshot.account_number.slice(-4)}`;
}

function formatBankSnapshot(
  bank: ConfigStatus["platformSettlementBankAccount"]
) {
  if (!bank?.bank_name || !bank.account_number || !bank.account_name) return "Not configured";
  return `${bank.bank_name} ****${bank.account_number.slice(-4)} · ${bank.account_name} (${bank.currency || "NGN"})`;
}

function maskAccountDigits(accountNumber?: string | null) {
  const value = String(accountNumber || "").trim();
  if (!value) return "-";
  return `****${value.slice(-4)}`;
}

function ChecklistItem({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-700">{label}</p>
        <Badge
          variant="outline"
          className={`border-2 ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}
        >
          {ok ? "Ready" : "Needs attention"}
        </Badge>
      </div>
      {note ? <p className="mt-2 text-xs text-neutral-500">{note}</p> : null}
    </div>
  );
}

function paginateRows<T>(rows: T[], page: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / TREASURY_PAGE_SIZE));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * TREASURY_PAGE_SIZE;
  return {
    rows: rows.slice(start, start + TREASURY_PAGE_SIZE),
    page: currentPage,
    pageSize: TREASURY_PAGE_SIZE,
    total,
    totalPages,
  };
}

function TreasuryPaginationControls({
  label,
  pagination,
  onPageChange,
}: {
  label: string;
  pagination: ReturnType<typeof paginateRows>;
  onPageChange: (page: number) => void;
}) {
  const start = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const end = pagination.total === 0 ? 0 : Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <div className="flex flex-col gap-3 border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
      <span>Showing {start}-{end} of {pagination.total} {label}</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-2"
          disabled={pagination.page <= 1}
          onClick={() => onPageChange(pagination.page - 1)}
        >
          Previous
        </Button>
        <span className="min-w-[88px] text-center font-medium text-neutral-700">
          Page {pagination.page} of {pagination.totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-2"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => onPageChange(pagination.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
  note,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  note?: string | null;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-neutral-700">{label}</p>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
      {note ? <p className="mt-2 text-xs text-neutral-500">{note}</p> : null}
    </div>
  );
}

function readBoolSetting(value: string | undefined, fallback: boolean) {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function checkedWarning(enabled: boolean) {
  return enabled ? "Use this only after explicit live-readiness approval." : null;
}
