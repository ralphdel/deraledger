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
  Wallet,
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
import type { MerchantWallet, PaymentSession, SettlementBatch, TreasuryTransaction, TreasuryWebhookLog } from "@/lib/types";

type TreasurySummary = {
  totalCryptoInflow: number;
  pendingSettlements: number;
  lockedSettlements: number;
  settledAmount: number;
  failedPayouts: number;
  webhookFailures: number;
  underReviewCount: number;
  queueDepth: number;
};

type TreasuryPayload = {
  summary: TreasurySummary;
  merchants: { id: string; business_name: string }[];
  wallets: MerchantWallet[];
  treasuryTransactions: (TreasuryTransaction & { merchant_name?: string })[];
  settlementBatches: (SettlementBatch & { merchant_name?: string })[];
  paymentSessions: (PaymentSession & { merchant_name?: string })[];
  webhookLogs: (TreasuryWebhookLog & { merchant_name?: string | null })[];
  settings: Record<string, string>;
};

const SETTING_LABELS: Record<string, string> = {
  crypto_usdt_ngn_rate: "USDT / NGN Rate",
  crypto_usdc_ngn_rate: "USDC / NGN Rate",
  crypto_btc_ngn_rate: "BTC / NGN Rate",
  crypto_eth_ngn_rate: "ETH / NGN Rate",
  crypto_session_ttl_minutes: "Session TTL Minutes",
  crypto_rate_slippage_bps: "FX Slippage BPS",
  crypto_underpayment_tolerance_bps: "Underpayment Tolerance BPS",
  crypto_platform_fee_bps: "Platform Fee BPS",
  crypto_btc_confirmations: "BTC Confirmations",
  crypto_eth_confirmations: "ETH Confirmations",
  crypto_usdt_confirmations: "USDT Confirmations",
  crypto_usdc_confirmations: "USDC Confirmations",
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
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTreasury();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredBatches = useMemo(() => {
    if (!data) return [];
    if (merchantFilter === "all") return data.settlementBatches;
    return data.settlementBatches.filter((batch) => batch.merchant_id === merchantFilter);
  }, [data, merchantFilter]);

  const filteredSessions = useMemo(() => {
    if (!data) return [];
    if (merchantFilter === "all") return data.paymentSessions;
    return data.paymentSessions.filter((session) => session.merchant_id === merchantFilter);
  }, [data, merchantFilter]);

  const filteredTransactions = useMemo(() => {
    if (!data) return [];
    if (merchantFilter === "all") return data.treasuryTransactions;
    return data.treasuryTransactions.filter((tx) => tx.merchant_id === merchantFilter);
  }, [data, merchantFilter]);

  const filteredWebhooks = useMemo(() => {
    if (!data) return [];
    if (merchantFilter === "all") return data.webhookLogs;
    return data.webhookLogs.filter((log) => log.merchant_id === merchantFilter);
  }, [data, merchantFilter]);

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
      setFeedback(`Queued ${payload.result?.created_batches ?? 0} settlement batch(es).`);
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

  const summaryCards = [
    { label: "Crypto Inflow", value: formatNaira(data.summary.totalCryptoInflow), icon: Coins, tone: "bg-blue-100 text-blue-700 border-blue-200" },
    { label: "Pending Settlements", value: formatNaira(data.summary.pendingSettlements), icon: Clock3, tone: "bg-amber-100 text-amber-700 border-amber-200" },
    { label: "Locked Payouts", value: formatNaira(data.summary.lockedSettlements), icon: Wallet, tone: "bg-purple-100 text-purple-700 border-purple-200" },
    { label: "Settled", value: formatNaira(data.summary.settledAmount), icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Treasury Console</h1>
          <p className="text-neutral-500 text-sm mt-1">Operate Breet-backed collections, payout queues, webhook monitoring, and treasury controls.</p>
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
          <Select value={payoutProvider} onValueChange={(val) => setPayoutProvider(val || "paystack")}>
            <SelectTrigger className="w-[160px] border-2 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paystack">Paystack</SelectItem>
              <SelectItem value="fincra">Fincra</SelectItem>
              <SelectItem value="monnify">Monnify</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" className="gap-2 border-2" onClick={() => void loadTreasury()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          <Button className="gap-2 bg-purp-900 hover:bg-purp-800" disabled={busy === "queue"} onClick={() => void queueSettlements()}>
            {busy === "queue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            Queue Settlements
          </Button>
        </div>
      </div>

      {feedback ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">{feedback}</div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border shadow-none">
          <CardContent className="p-4">
            <p className="text-xs uppercase text-neutral-500 font-medium">Queue Depth</p>
            <p className="text-xl font-bold text-neutral-900 mt-2">{data.summary.queueDepth}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardContent className="p-4">
            <p className="text-xs uppercase text-neutral-500 font-medium">Failed Payouts</p>
            <p className="text-xl font-bold text-red-600 mt-2">{data.summary.failedPayouts}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardContent className="p-4">
            <p className="text-xs uppercase text-neutral-500 font-medium">Webhook Failures</p>
            <p className="text-xl font-bold text-red-600 mt-2">{data.summary.webhookFailures}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardContent className="p-4">
            <p className="text-xs uppercase text-neutral-500 font-medium">Under Review</p>
            <p className="text-xl font-bold text-amber-600 mt-2">{data.summary.underReviewCount}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList className="bg-white border">
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          <Card className="border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Settlement Queue Manager</CardTitle>
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
                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-neutral-500">No settlement batches yet.</TableCell></TableRow>
                  ) : filteredBatches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="font-medium">{batch.merchant_name || batch.merchant_id}</TableCell>
                      <TableCell className="capitalize">{batch.payout_provider || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase border-2 bg-neutral-50">{batch.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{formatNaira(Number(batch.total_amount))}</TableCell>
                      <TableCell>{new Date(batch.created_at).toLocaleString("en-NG")}</TableCell>
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

          <Card className="border shadow-none mt-4">
            <CardHeader>
              <CardTitle className="text-base">Merchant Wallets</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {data.wallets.map((wallet) => (
                <div key={wallet.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-neutral-900">{data.merchants.find((merchant) => merchant.id === wallet.merchant_id)?.business_name || wallet.merchant_id}</p>
                    <Badge variant="outline">{wallet.currency}</Badge>
                  </div>
                  <div className="space-y-2 mt-4 text-sm">
                    <div className="flex justify-between"><span className="text-neutral-500">Available</span><span>{formatNaira(Number(wallet.available_balance))}</span></div>
                    <div className="flex justify-between"><span className="text-neutral-500">Pending</span><span>{formatNaira(Number(wallet.pending_balance))}</span></div>
                    <div className="flex justify-between"><span className="text-neutral-500">Locked</span><span>{formatNaira(Number(wallet.locked_balance))}</span></div>
                    <div className="flex justify-between font-semibold"><span className="text-neutral-500">Settled Total</span><span>{formatNaira(Number(wallet.total_settled))}</span></div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger">
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
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-neutral-500">No treasury transactions yet.</TableCell></TableRow>
                  ) : filteredTransactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-medium">{tx.merchant_name || tx.merchant_id}</TableCell>
                      <TableCell className="uppercase">{tx.payment_rail || "-"}</TableCell>
                      <TableCell><Badge variant="outline" className="uppercase border-2 bg-neutral-50">{tx.status}</Badge></TableCell>
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

          <Card className="border shadow-none mt-4">
            <CardHeader>
              <CardTitle className="text-base">Payment Sessions</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-neutral-50">
                    <TableHead>Merchant</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Confirmations</TableHead>
                    <TableHead>Expiry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSessions.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-neutral-500">No payment sessions yet.</TableCell></TableRow>
                  ) : filteredSessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell className="font-medium">{session.merchant_name || session.merchant_id}</TableCell>
                      <TableCell className="text-xs">{session.reference}</TableCell>
                      <TableCell><Badge variant="outline" className="uppercase border-2 bg-neutral-50">{session.status}</Badge></TableCell>
                      <TableCell className="text-xs">{session.wallet_address}</TableCell>
                      <TableCell>{session.confirmation_count}/{session.expected_confirmations}</TableCell>
                      <TableCell>{new Date(session.expires_at).toLocaleString("en-NG")}</TableCell>
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
              <CardTitle className="text-base">Webhook Monitoring</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-red-700 font-semibold"><AlertTriangle className="h-4 w-4" /> Failures</div>
                  <p className="text-2xl font-bold text-red-700 mt-2">{data.summary.webhookFailures}</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-amber-700 font-semibold"><ShieldAlert className="h-4 w-4" /> Under Review</div>
                  <p className="text-2xl font-bold text-amber-700 mt-2">{data.summary.underReviewCount}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 text-emerald-700 font-semibold"><CheckCircle2 className="h-4 w-4" /> Processed</div>
                  <p className="text-2xl font-bold text-emerald-700 mt-2">{filteredWebhooks.filter((log) => log.status === "processed").length}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
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
                      <TableRow><TableCell colSpan={6} className="text-center py-10 text-neutral-500">No webhook logs yet.</TableCell></TableRow>
                    ) : filteredWebhooks.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>{new Date(log.created_at).toLocaleString("en-NG")}</TableCell>
                        <TableCell><Badge variant="outline" className="uppercase border-2 bg-neutral-50">{log.status}</Badge></TableCell>
                        <TableCell>{log.merchant_name || "-"}</TableCell>
                        <TableCell>{log.event_type}</TableCell>
                        <TableCell className="text-xs">{log.processor_reference || "-"}</TableCell>
                        <TableCell className="text-xs text-red-600">{log.error_message || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
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
                  Use these placeholders now, then replace them with your live Breet rate/signature settings as soon as the account review is approved.
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
