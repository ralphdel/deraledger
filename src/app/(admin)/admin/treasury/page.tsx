"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  Coins,
  Loader2,
  RefreshCcw,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  liveEnabled: boolean;
  webhookConfigured: boolean;
  invoiceCryptoEnabled: boolean;
  subscriptionCryptoEnabled: boolean;
  minimumAutoSettlementNgn: number;
  merchantAutoSettlementEnabled: boolean;
  platformAutoSettlementEnabled: boolean;
  platformSettlementBankAccount: {
    bank_name?: string | null;
    bank_code?: string | null;
    account_number?: string | null;
    account_name?: string | null;
    currency?: string | null;
  } | null;
  supportedAssets: string[];
  supportedNetworks: string[];
  manualTreasuryEnabled: boolean;
  manualQueueFunctionAvailable: boolean;
  manualPayoutProviders: string[];
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
  breet_auto_settlement_enabled: "Platform Auto-Settlement Enabled",
  breet_merchant_auto_settlement_enabled: "Merchant Auto-Settlement Enabled",
  breet_invoice_crypto_enabled: "Invoice Crypto Enabled",
  breet_subscription_crypto_enabled: "Subscription Crypto Enabled",
  breet_min_auto_settlement_ngn: "Minimum Auto-Settlement Amount (NGN)",
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
};

export default function AdminTreasuryPage() {
  const [data, setData] = useState<TreasuryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [merchantFilter, setMerchantFilter] = useState("all");
  const [payoutProvider, setPayoutProvider] = useState("paystack");
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  async function loadTreasury() {
    setLoading(true);
    setFeedback(null);
    const res = await fetch("/api/admin/treasury");
    const payload = (await res.json()) as TreasuryPayload | { error?: string };
    if (!res.ok || !("summary" in payload)) {
      setFeedback((payload as { error?: string }).error || "Failed to load treasury console.");
      setLoading(false);
      return;
    }

    setData(payload);
    setSettingsDraft(payload.settings);
    setPayoutProvider(payload.configStatus.manualPayoutProviders[0] || "paystack");
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTreasury();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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

  const summaryCards = [
    { label: "Crypto Inflow", value: formatNaira(data.summary.totalCryptoInflow), icon: Coins, tone: "bg-blue-100 text-blue-700 border-blue-200" },
    { label: pendingLabel, value: String(data.summary.pendingAutoSettlements), icon: Clock3, tone: "bg-amber-100 text-amber-700 border-amber-200" },
    { label: "Settled", value: formatNaira(data.summary.settledAmount), icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    { label: "Failed Settlements", value: String(data.summary.failedSettlements), icon: AlertTriangle, tone: "bg-red-100 text-red-700 border-red-200" },
    { label: "Webhook Failures", value: String(data.summary.webhookFailures), icon: ShieldAlert, tone: "bg-red-100 text-red-700 border-red-200" },
    { label: "Under Review", value: String(data.summary.underReviewCount), icon: ShieldAlert, tone: "bg-amber-100 text-amber-700 border-amber-200" },
    { label: "Reconciliation Delta", value: formatNaira(data.summary.reconciliationDelta), icon: Coins, tone: "bg-slate-100 text-slate-700 border-slate-200" },
    ...(manualTreasuryEnabled
      ? [{ label: "Queue Depth", value: String(data.summary.queueDepth), icon: ArrowRightLeft, tone: "bg-purple-100 text-purple-700 border-purple-200" }]
      : []),
  ];

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
            Monitor Breet crypto collections, auto-settlement status, webhook events, and reconciliation.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={merchantFilter} onValueChange={(val) => setMerchantFilter(val || "all")}>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Breet Mode Status</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Info label="Breet Settlement Mode" value={labelMode(mode)} />
            <Info label="Breet Live Enabled" value={boolLabel(data.configStatus.liveEnabled)} />
            <Info label="Webhook Configured" value={boolLabel(data.configStatus.webhookConfigured)} />
            <Info label="Invoice Crypto Enabled" value={boolLabel(data.configStatus.invoiceCryptoEnabled)} />
            <Info label="Subscription Crypto Enabled" value={boolLabel(data.configStatus.subscriptionCryptoEnabled)} />
            <Info label="Minimum Auto-Settlement Amount" value={formatNaira(data.configStatus.minimumAutoSettlementNgn || 0)} />
            <Info label="Merchant Auto-Settlement" value={boolLabel(data.configStatus.merchantAutoSettlementEnabled)} />
            <Info label="Platform Auto-Settlement" value={boolLabel(data.configStatus.platformAutoSettlementEnabled)} />
            <Info label="Provider Runtime" value={`${data.providerHealth.configured ? "Configured" : "Missing"} (${data.providerHealth.env})`} />
          </CardContent>
        </Card>

        <Card className="border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Settlement Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Info label="Supported Assets" value={data.configStatus.supportedAssets.join(", ") || "Not set"} />
            <Info label="Supported Networks" value={data.configStatus.supportedNetworks.join(", ") || "Not set"} />
            <Info label="Platform Settlement Bank" value={formatBankSnapshot(data.configStatus.platformSettlementBankAccount)} />
            <Info label="Webhook Secret Path" value={data.configStatus.webhookConfigured ? "Shared-secret request verification active" : "Missing"} />
          </CardContent>
        </Card>
      </div>

      {mode === "disabled" ? (
        <Card className="border shadow-none">
          <CardContent className="p-5 text-sm text-neutral-600">
            Breet crypto is currently disabled. No operational actions are available until Breet is enabled.
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="sessions" className="space-y-4">
        <TabsList className="bg-white border">
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="fallback">Fallback</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="space-y-4">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Recent Breet Crypto Sessions</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
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
                  ) : filteredSessions.map((session) => (
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
            </CardContent>
          </Card>

          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Manual Review Queue</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
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
                  ) : reviewSessions.map((session) => (
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settlements" className="space-y-4">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Settlement Records</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-neutral-50">
                    <TableHead>Merchant</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead>Delta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSettlements.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-neutral-500">No Breet settlement records yet.</TableCell></TableRow>
                  ) : filteredSettlements.map((row) => (
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
            </CardContent>
          </Card>

          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Treasury Ledger</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
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
                  ) : filteredTransactions.map((tx) => (
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Recent Breet Webhook Events</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
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
                  ) : filteredWebhooks.map((log) => (
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="fallback" className="space-y-4">
          {!manualTreasuryEnabled ? (
            <Card className="border shadow-none">
              <CardContent className="p-5 text-sm text-neutral-600">
                Manual treasury settlement is disabled. Breet payments are expected to auto-settle through Breet.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="border-amber-200 bg-amber-50 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base text-amber-900">Manual Treasury Fallback</CardTitle>
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
                  <Table>
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
                      ) : filteredBatches.map((batch) => (
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
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="config">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Treasury Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Object.entries(SETTING_LABELS).map(([key, label]) => (
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
                  Configure Breet rates, assets, settlement mode, webhook endpoint, and platform settlement account details here.
                </div>
                <Button onClick={() => void saveSettings()} disabled={busy === "settings"} className="bg-purp-900 hover:bg-purp-800">
                  {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Settings"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
