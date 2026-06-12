"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Banknote,
  CalendarDays,
  CheckCircle2,
  Download,
  Loader2,
  Minus,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getMerchant } from "@/lib/data";
import { formatNaira } from "@/lib/calculations";
import { downloadCSV } from "@/lib/csv";
import type { Merchant } from "@/lib/types";
import { PermissionGuard } from "@/components/PermissionGuard";

type SettlementRow = {
  id: string;
  created_at: string;
  provider_name: string;
  payment_method: string | null;
  gross_amount: number | null;
  provider_fee: number | null;
  expected_settlement: number | null;
  actual_settlement: number | null;
  settlement_status: string;
  settlement_mode?: string | null;
  settlement_owner?: string | null;
  provider_settlement_batch_id?: string | null;
  provider_fee_source?: string | null;
  expected_settlement_source?: string | null;
  provider_settlement_reference?: string | null;
  settled_at?: string | null;
  payment_records?: {
    provider_reference?: string | null;
    payment_purpose?: string | null;
    paid_at?: string | null;
  } | null;
  merchant_settlement_accounts?: {
    bank_name?: string | null;
    account_number?: string | null;
    account_name?: string | null;
    currency?: string | null;
  } | null;
  provider_settlement_batches?: {
    provider_batch_reference?: string | null;
    actual_settlement_total?: number | null;
    settlement_status?: string | null;
    settled_at?: string | null;
    provider_reported_settled_at?: string | null;
  } | null;
};

export default function MerchantSettlementsPage() {
  const [merchant, setMerchant] = useState<(Merchant & { permissions?: Record<string, boolean>; currentUserRole?: string }) | null>(null);
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const todayStr = formatDateInput(new Date());
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);
  const [error, setError] = useState("");

  useEffect(() => {
    getMerchant().then((m) => setMerchant(m));
  }, []);

  useEffect(() => {
    const fetchRows = async () => {
      setLoading(true);
      const res = await fetch("/api/merchant/settlements", { cache: "no-store" });
      const payload = await res.json();
      if (res.ok) {
        setRows(payload.rows || []);
        setError("");
      } else {
        setRows([]);
        setError(payload.error || "Failed to load settlements.");
      }
      setLoading(false);
    };
    fetchRows();
  }, []);

  const visibleRows = useMemo(() => {
    const start = new Date(`${fromDate}T00:00:00`).getTime();
    const end = new Date(`${toDate}T23:59:59.999`).getTime();
    return rows.filter((row) => {
      const activityDate = getSettlementActivityDate(row);
      return activityDate >= start && activityDate <= end;
    });
  }, [rows, fromDate, toDate]);

  const visibleSummary = useMemo(() => ({
    totalCollected: visibleRows.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0),
    totalProviderFees: visibleRows.reduce((sum, row) => sum + Number(row.provider_fee || 0), 0),
    expectedSettlement: visibleRows.reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
    settledAmount: visibleRows.reduce((sum, row) => sum + Number(row.actual_settlement || 0), 0),
    pendingSettlement: visibleRows
      .filter((row) => ["pending", "processing", "manual_review"].includes(row.settlement_status))
      .reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
  }), [visibleRows]);

  const applyPreset = (preset: string) => {
    const now = new Date();
    if (preset === "today") { setFromDate(todayStr); setToDate(todayStr); }
    else if (preset === "week") {
      const start = new Date(now); start.setDate(now.getDate() - now.getDay());
      setFromDate(formatDateInput(start)); setToDate(todayStr);
    } else if (preset === "month") {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      setFromDate(formatDateInput(monthStart)); setToDate(todayStr);
    } else if (preset === "last_month") {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lme = new Date(now.getFullYear(), now.getMonth(), 0);
      setFromDate(formatDateInput(lm)); setToDate(formatDateInput(lme));
    }
  };

  const handleDownload = () => {
    const labelText = fromDate === toDate ? fromDate : `${fromDate}_to_${toDate}`;
    downloadCSV(visibleRows.map((row) => ({
      Date: new Date(getSettlementActivityDate(row)).toLocaleString("en-NG"),
      "Payment Method": labelPaymentMethod(row.payment_method),
      "Payment Reference": row.payment_records?.provider_reference || row.provider_settlement_reference || "",
      "Gross Amount": row.gross_amount ?? "",
      "Provider Fee": row.provider_fee ?? "",
      "Expected Settlement": row.expected_settlement ?? "",
      "Actual Settlement": row.actual_settlement ?? "",
      Status: row.settlement_status,
      "Provider Batch": row.provider_settlement_batches?.provider_batch_reference || "",
      "Batch Settled At": row.provider_settlement_batches?.settled_at || row.provider_settlement_batches?.provider_reported_settled_at || "",
      "Settlement Account": maskAccount(row.merchant_settlement_accounts),
    })), `Deraledger_Settlements_${labelText}`);
  };

  return (
    <PermissionGuard permission="view_settlements" merchant={merchant} featureLabel="Settlements">
      <div className="mx-auto max-w-6xl min-w-0 overflow-x-hidden space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-purp-900">Settlements</h1>
            <p className="text-neutral-500 text-sm mt-1">Payment received means your customer has paid. Settlement completed means funds have been confirmed for your settlement account.</p>
          </div>
          <Button
            variant="outline"
            className="border-2 gap-2 text-purp-700 border-purp-200 hover:bg-purp-50"
            onClick={handleDownload}
            disabled={visibleRows.length === 0}
          >
            <Download className="h-4 w-4" /> Download CSV
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <CalendarDays className="h-4 w-4 text-neutral-500" />
            <span className="text-sm text-neutral-600 font-medium">From</span>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full sm:w-[160px] border-2 bg-white" />
            <span className="text-sm text-neutral-600 font-medium">To</span>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full sm:w-[160px] border-2 bg-white" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["today", "week", "month", "last_month"] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => applyPreset(preset)}
                className="px-3 py-1.5 text-xs font-semibold rounded-full border-2 border-purp-200 text-purp-700 hover:bg-purp-50"
              >
                {preset === "today" ? "Today" : preset === "week" ? "This Week" : preset === "month" ? "This Month" : "Last Month"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <SummaryCard icon={TrendingUp} label="Collected" value={formatNaira(visibleSummary.totalCollected)} />
          <SummaryCard icon={Minus} label="Provider Fees" value={formatNaira(visibleSummary.totalProviderFees)} />
          <SummaryCard icon={Banknote} label="Expected Settlement" value={formatNaira(visibleSummary.expectedSettlement)} />
          <SummaryCard icon={CheckCircle2} label="Settled" value={formatNaira(visibleSummary.settledAmount)} />
        </div>

        <Card className="border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-neutral-900">Settlement History</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-neutral-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading settlements...
              </div>
            ) : error ? (
              <div className="text-center py-12 text-red-600">{error}</div>
            ) : visibleRows.length === 0 ? (
              <div className="text-center py-12 text-neutral-500">No settlements found for this period.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-neutral-50">
                    <TableHead>Time</TableHead>
                    <TableHead>Payment Method</TableHead>
                    <TableHead>Settlement Account</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Settled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-sm text-neutral-600">{new Date(getSettlementActivityDate(row)).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize border-2">{labelPaymentMethod(row.payment_method)}</Badge>
                        {row.provider_settlement_batches?.provider_batch_reference && (
                          <p className="text-xs text-emerald-700 mt-1">Batch {row.provider_settlement_batches.provider_batch_reference}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{maskAccount(row.merchant_settlement_accounts)}</TableCell>
                      <TableCell>
                        <StatusBadge status={row.settlement_status} />
                        {row.settlement_status === "manual_review" && <p className="text-xs text-amber-700 mt-1">Settlement is under review.</p>}
                        {row.provider_settlement_batches?.settled_at && (
                          <p className="text-xs text-emerald-700 mt-1">
                            Settled {new Date(row.provider_settlement_batches.settled_at).toLocaleDateString("en-NG")}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatNaira(Number(row.gross_amount || 0))}</TableCell>
                      <TableCell className="text-right font-medium">{formatNaira(Number(row.provider_fee || 0))}</TableCell>
                      <TableCell className="text-right font-medium">{row.expected_settlement === null || row.expected_settlement === undefined ? "Under review" : formatNaira(Number(row.expected_settlement))}</TableCell>
                      <TableCell className="text-right font-medium">{row.actual_settlement === null || row.actual_settlement === undefined ? "-" : formatNaira(Number(row.actual_settlement))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </PermissionGuard>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card className="border shadow-none">
      <CardContent className="p-5">
        <Icon className="h-5 w-5 text-purp-600 mb-3" />
        <p className="text-xl font-bold text-neutral-900">{value}</p>
        <p className="text-xs text-neutral-500 mt-1">{label}</p>
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
  return <Badge variant="outline" className={`border-2 capitalize ${className}`}>{status.replaceAll("_", " ")}</Badge>;
}

function maskAccount(account?: SettlementRow["merchant_settlement_accounts"]) {
  if (!account) return "Settlement account unavailable";
  const last4 = account.account_number?.slice(-4) || "----";
  return `${account.bank_name || "Bank"} ****${last4}`;
}

function formatDateInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function labelPaymentMethod(method?: string | null) {
  if (!method) return "Payment";
  const normalized = method.toLowerCase();
  if (["crypto", "usdt", "usdc", "btc", "eth"].includes(normalized)) return "Crypto";
  if (method === "bank_transfer") return "Bank transfer";
  return method.replaceAll("_", " ");
}

function getSettlementActivityDate(row: SettlementRow) {
  return new Date(
    row.payment_records?.paid_at ||
    row.settled_at ||
    row.created_at
  ).getTime();
}
