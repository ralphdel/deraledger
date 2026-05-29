"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  Minus,
  RefreshCw,
  Search,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatNaira } from "@/lib/calculations";
import { downloadCSV } from "@/lib/csv";

type SettlementRow = {
  id: string;
  created_at: string;
  provider_name: string;
  payment_method: string | null;
  gross_amount: number | null;
  provider_fee: number | null;
  platform_fee: number | null;
  expected_settlement: number | null;
  actual_settlement: number | null;
  settlement_difference: number | null;
  fee_payer: string | null;
  settlement_status: string;
  settlement_mode?: string | null;
  settlement_owner?: string | null;
  payout_action_required?: boolean | null;
  provider_settlement_batch_id?: string | null;
  provider_fee_source?: string | null;
  expected_settlement_source?: string | null;
  provider_settlement_reference?: string | null;
  settled_at?: string | null;
  reconciliation_notes?: string | null;
  payment_records?: {
    provider_reference?: string | null;
    internal_reference?: string | null;
    payment_purpose?: string | null;
  } | null;
  merchants?: {
    business_name?: string | null;
    email?: string | null;
  } | null;
  merchant_settlement_accounts?: {
    bank_name?: string | null;
    account_number?: string | null;
    account_name?: string | null;
    currency?: string | null;
  } | null;
  merchant_provider_settlement_accounts?: {
    status?: string | null;
    environment?: string | null;
    provider_subaccount_code?: string | null;
    provider_split_reference?: string | null;
  } | null;
  provider_settlement_batches?: {
    provider_batch_reference?: string | null;
    actual_settlement_total?: number | null;
    settlement_status?: string | null;
    settled_at?: string | null;
    provider_reported_settled_at?: string | null;
  } | null;
};

type ApiResponse = {
  rows: SettlementRow[];
  summary: {
    grossAmount: number;
    providerFees: number;
    platformFees: number;
    expectedSettlement: number;
    actualSettlement: number;
    manualReviewCount: number;
  };
};

const STATUS_OPTIONS = ["all", "pending", "processing", "completed", "manual_review", "failed", "disputed"];
const PROVIDERS = ["all", "paystack", "monnify", "breet"];

export default function AdminAccountingPage() {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [summary, setSummary] = useState<ApiResponse["summary"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SettlementRow | null>(null);
  const [actualSettlement, setActualSettlement] = useState("");
  const [providerReference, setProviderReference] = useState("");
  const [notes, setNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchSettledAt, setBatchSettledAt] = useState(() => new Date().toISOString().slice(0, 16));

  const fetchRows = async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "250" });
    if (provider !== "all") params.set("provider", provider);
    if (status !== "all") params.set("settlement_status", status);
    const res = await fetch(`/api/admin/payments-settlements?${params.toString()}`, { cache: "no-store" });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || "Failed to load settlements.");
    setRows(payload.rows || []);
    setSummary(payload.summary || null);
    setLoading(false);
  };

  useEffect(() => {
    fetchRows().catch((error) => {
      console.error(error);
      setLoading(false);
    });
  }, [provider, status]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const values = [
        row.merchants?.business_name,
        row.merchants?.email,
        row.payment_records?.provider_reference,
        row.provider_settlement_reference,
        row.merchant_settlement_accounts?.account_name,
        row.merchant_settlement_accounts?.bank_name,
      ];
      return values.some((value) => String(value || "").toLowerCase().includes(needle));
    });
  }, [rows, search]);

  const selectedRows = useMemo(
    () => filteredRows.filter((row) => checkedIds.includes(row.id)),
    [filteredRows, checkedIds]
  );

  const selectedExpectedTotal = useMemo(
    () => selectedRows.reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
    [selectedRows]
  );

  const toggleChecked = (row: SettlementRow) => {
    if (row.provider_settlement_batch_id) return;
    setCheckedIds((current) => current.includes(row.id)
      ? current.filter((id) => id !== row.id)
      : [...current, row.id]);
  };

  const openBatchModal = () => {
    setProviderReference("");
    setActualSettlement(selectedExpectedTotal ? String(selectedExpectedTotal) : "");
    setNotes("");
    setBatchSettledAt(new Date().toISOString().slice(0, 16));
    setBatchModalOpen(true);
  };

  const openRow = (row: SettlementRow) => {
    setSelected(row);
    setActualSettlement(row.actual_settlement !== null && row.actual_settlement !== undefined ? String(row.actual_settlement) : "");
    setProviderReference(row.provider_settlement_reference || "");
    setNotes(row.reconciliation_notes || "");
  };

  const runAction = async (action: "mark_manual_review" | "record_actual_settlement" | "mark_completed") => {
    if (!selected) return;
    setActionLoading(true);
    const res = await fetch("/api/admin/payments-settlements", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settlementId: selected.id,
        action,
        actualSettlement,
        providerSettlementReference: providerReference,
        notes,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    setActionLoading(false);
    if (!res.ok) {
      alert(payload.error || "Settlement action failed.");
      return;
    }
    setSelected(null);
    await fetchRows();
  };

  const handleDownload = () => {
    downloadCSV(filteredRows.map((row) => ({
      Date: new Date(row.created_at).toLocaleString("en-NG"),
      Merchant: row.merchants?.business_name || row.merchants?.email || "",
      Provider: row.provider_name,
      Method: row.payment_method || "",
      "Gross Amount": row.gross_amount ?? "",
      "Provider Fee": row.provider_fee ?? "",
      "Expected Settlement": row.expected_settlement ?? "",
      "Actual Settlement": row.actual_settlement ?? "",
      Difference: row.settlement_difference ?? "",
      Status: row.settlement_status,
      Owner: row.settlement_owner || "",
      Mode: row.settlement_mode || "",
      "Settlement Account": maskAccount(row.merchant_settlement_accounts),
      "Provider Batch": row.provider_settlement_batches?.provider_batch_reference || "",
      "Batch Settled At": row.provider_settlement_batches?.settled_at || row.provider_settlement_batches?.provider_reported_settled_at || "",
      Reference: row.provider_settlement_reference || row.payment_records?.provider_reference || "",
    })), "Deraledger_Payments_Settlements");
  };

  const runBatchAction = async () => {
    setActionLoading(true);
    const res = await fetch("/api/admin/payments-settlements", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record_provider_batch",
        settlementIds: checkedIds,
        actualSettlement,
        providerSettlementReference: providerReference,
        settledAt: batchSettledAt ? new Date(batchSettledAt).toISOString() : undefined,
        notes,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    setActionLoading(false);
    if (!res.ok) {
      alert(payload.error || "Provider batch action failed.");
      return;
    }
    setBatchModalOpen(false);
    setCheckedIds([]);
    await fetchRows();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Payments & Settlements</h1>
          <p className="text-neutral-500 text-sm mt-1">Track payment success, expected settlement, provider ownership, and reconciliation status.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="border-2 gap-2" onClick={() => fetchRows()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" className="border-2 gap-2" onClick={handleDownload} disabled={filteredRows.length === 0}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button className="bg-neutral-900 hover:bg-neutral-800 text-white gap-2" onClick={openBatchModal} disabled={selectedRows.length === 0}>
            <Banknote className="h-4 w-4" /> Record Batch
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <SummaryCard icon={TrendingUp} label="Gross Collected" value={formatNaira(summary?.grossAmount || 0)} />
        <SummaryCard icon={Minus} label="Provider Fees" value={formatNaira(summary?.providerFees || 0)} />
        <SummaryCard icon={Banknote} label="Expected Settlement" value={formatNaira(summary?.expectedSettlement || 0)} />
        <SummaryCard icon={CheckCircle2} label="Actual Settled" value={formatNaira(summary?.actualSettlement || 0)} />
        <SummaryCard icon={AlertTriangle} label="Manual Review" value={String(summary?.manualReviewCount || 0)} />
      </div>

      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <CardTitle className="text-base font-bold text-neutral-900">Settlement Operations</CardTitle>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search merchant/reference" className="pl-9 border-2 w-full sm:w-[260px]" />
              </div>
              <Select value={provider} onValueChange={(value) => value && setProvider(value)}>
                <SelectTrigger className="border-2 w-full sm:w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>{PROVIDERS.map((item) => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={status} onValueChange={(value) => value && setStatus(value)}>
                <SelectTrigger className="border-2 w-full sm:w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_OPTIONS.map((item) => <SelectItem key={item} value={item}>{label(item)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading settlements...
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="text-center py-12 text-neutral-500">No settlement records found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-neutral-50">
                  <TableHead className="w-[44px]" />
                  <TableHead>Merchant</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Settlement Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-neutral-300"
                        checked={checkedIds.includes(row.id)}
                        disabled={Boolean(row.provider_settlement_batch_id)}
                        onChange={() => toggleChecked(row)}
                        aria-label="Select settlement for provider batch"
                      />
                    </TableCell>
                    <TableCell>
                      <p className="font-semibold text-sm text-neutral-900">{row.merchants?.business_name || "Unknown"}</p>
                      <p className="text-xs text-neutral-500">{row.payment_records?.provider_reference || row.provider_settlement_reference}</p>
                      {row.provider_settlement_batches?.provider_batch_reference && (
                        <p className="text-xs text-emerald-700 mt-1">Batch {row.provider_settlement_batches.provider_batch_reference}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize border-2">{row.provider_name}</Badge>
                      <p className="text-xs text-neutral-500 mt-1">{row.payment_method || "method unknown"}</p>
                    </TableCell>
                    <TableCell className="text-sm">{maskAccount(row.merchant_settlement_accounts)}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.settlement_status} />
                      {row.provider_settlement_batches?.settled_at && (
                        <p className="text-xs text-emerald-700 mt-1">
                          Settled {new Date(row.provider_settlement_batches.settled_at).toLocaleDateString("en-NG")}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-2 text-xs">{label(row.settlement_owner || "provider")}</Badge>
                      {row.settlement_mode === "treasury_payout_required" && <p className="text-xs text-amber-700 mt-1">Treasury action required</p>}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatNaira(Number(row.gross_amount || 0))}</TableCell>
                    <TableCell className="text-right font-medium">
                      {row.expected_settlement === null || row.expected_settlement === undefined ? "Review" : formatNaira(Number(row.expected_settlement))}
                      <p className="text-[10px] text-neutral-400">{label(row.expected_settlement_source || "")}</p>
                    </TableCell>
                    <TableCell className="text-right font-medium">{row.actual_settlement === null || row.actual_settlement === undefined ? "-" : formatNaira(Number(row.actual_settlement))}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" className="border-2 gap-1" onClick={() => openRow(row)}>
                        <Eye className="h-3.5 w-3.5" /> Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b">
              <h2 className="font-bold text-lg">Settlement Review</h2>
              <p className="text-sm text-neutral-500">{selected.merchants?.business_name} · {selected.provider_name}</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Info label="Gross" value={formatNaira(Number(selected.gross_amount || 0))} />
                <Info label="Expected" value={selected.expected_settlement === null || selected.expected_settlement === undefined ? "Manual review" : formatNaira(Number(selected.expected_settlement))} />
                <Info label="Fee source" value={label(selected.provider_fee_source || "provider_missing")} />
                <Info label="Settlement account" value={maskAccount(selected.merchant_settlement_accounts)} />
              </div>
              <Input value={actualSettlement} onChange={(event) => setActualSettlement(event.target.value)} placeholder="Actual settlement amount" className="border-2" />
              <Input value={providerReference} onChange={(event) => setProviderReference(event.target.value)} placeholder="Provider settlement reference" className="border-2" />
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Reconciliation notes" className="border-2 min-h-[100px]" />
              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="outline" className="border-2" onClick={() => setSelected(null)}>Cancel</Button>
                <Button variant="outline" className="border-2 border-amber-300 text-amber-700" disabled={actionLoading} onClick={() => runAction("mark_manual_review")}>Manual Review</Button>
                <Button variant="outline" className="border-2 border-blue-300 text-blue-700" disabled={actionLoading} onClick={() => runAction("record_actual_settlement")}>Record Actual</Button>
                <Button className="bg-emerald-700 hover:bg-emerald-800 text-white" disabled={actionLoading} onClick={() => runAction("mark_completed")}>Mark Completed</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {batchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b">
              <h2 className="font-bold text-lg">Record Provider Settlement Batch</h2>
              <p className="text-sm text-neutral-500">{selectedRows.length} settlement records selected</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Info label="Selected expected total" value={formatNaira(selectedExpectedTotal)} />
                <Info label="Settlement account" value={selectedRows[0] ? maskAccount(selectedRows[0].merchant_settlement_accounts) : "No account"} />
              </div>
              <Input value={actualSettlement} onChange={(event) => setActualSettlement(event.target.value)} placeholder="Actual batch amount credited" className="border-2" />
              <Input value={providerReference} onChange={(event) => setProviderReference(event.target.value)} placeholder="Provider batch/reference" className="border-2" />
              <Input type="datetime-local" value={batchSettledAt} onChange={(event) => setBatchSettledAt(event.target.value)} className="border-2" />
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Batch reconciliation notes" className="border-2 min-h-[100px]" />
              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="outline" className="border-2" onClick={() => setBatchModalOpen(false)}>Cancel</Button>
                <Button className="bg-neutral-900 hover:bg-neutral-800 text-white" disabled={actionLoading} onClick={runBatchAction}>Save Batch</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label: text, value }: { icon: any; label: string; value: string }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
        <Icon className="h-5 w-5 text-neutral-500 mb-3" />
        <p className="text-xl font-bold text-neutral-900">{value}</p>
        <p className="text-xs text-neutral-500 mt-1">{text}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const className =
    status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    status === "manual_review" ? "bg-amber-50 text-amber-700 border-amber-200" :
    status === "failed" || status === "disputed" ? "bg-red-50 text-red-700 border-red-200" :
    "bg-blue-50 text-blue-700 border-blue-200";
  return <Badge variant="outline" className={`border-2 capitalize ${className}`}>{label(status)}</Badge>;
}

function Info({ label: text, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md p-3">
      <p className="text-xs text-neutral-500">{text}</p>
      <p className="font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function maskAccount(account?: SettlementRow["merchant_settlement_accounts"]) {
  if (!account) return "No account";
  const last4 = account.account_number?.slice(-4) || "----";
  return `${account.bank_name || "Bank"} ****${last4} · ${account.account_name || "Account"}`;
}

function label(value: string) {
  if (!value) return "-";
  return value.replaceAll("_", " ");
}
