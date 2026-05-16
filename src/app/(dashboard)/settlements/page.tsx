"use client";

import { useEffect, useState } from "react";
import {
  DollarSign, Download, CalendarDays, TrendingUp, Minus, ArrowUpRight,
  CreditCard, Banknote, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { getMerchant } from "@/lib/data";
import { formatNaira } from "@/lib/calculations";
import { downloadCSV } from "@/lib/csv";
import type { Merchant } from "@/lib/types";
import { PermissionGuard } from "@/components/PermissionGuard";

interface SettlementTx {
  id: string;
  created_at: string;
  invoice_id: string;
  invoice_number: string;
  amount_paid: number;
  paystack_fee: number;
  fee_absorbed_by: string;
  payment_method: string;
  paystack_reference: string | null;
}

export default function MerchantSettlementsPage() {
  const [merchant, setMerchant] = useState<(Merchant & { permissions?: Record<string, boolean>; currentUserRole?: string }) | null>(null);
  const [transactions, setTransactions] = useState<SettlementTx[]>([]);
  const [loading, setLoading] = useState(true);

  const todayStr = new Date().toISOString().split("T")[0];
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);

  const applyPreset = (preset: string) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (preset === "today") { setFromDate(todayStr); setToDate(todayStr); }
    else if (preset === "week") {
      const start = new Date(now); start.setDate(now.getDate() - now.getDay());
      setFromDate(fmt(start)); setToDate(todayStr);
    } else if (preset === "month") {
      setFromDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`); setToDate(todayStr);
    } else if (preset === "last_month") {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lme = new Date(now.getFullYear(), now.getMonth(), 0);
      setFromDate(fmt(lm)); setToDate(fmt(lme));
    }
  };

  useEffect(() => {
    getMerchant().then((m) => setMerchant(m));
  }, []);

  useEffect(() => {
    if (!merchant) return;
    const fetchTx = async () => {
      setLoading(true);
      const sb = createClient();
      const dayStart = `${fromDate}T00:00:00.000Z`;
      const dayEnd = `${toDate}T23:59:59.999Z`;

      const { data } = await sb
        .from("transactions")
        .select("id, created_at, invoice_id, amount_paid, paystack_fee, fee_absorbed_by, payment_method, paystack_reference")
        .eq("merchant_id", merchant.id)
        .eq("status", "success")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd)
        .order("created_at", { ascending: false });

      // Fetch invoice numbers for display
      const txRows = (data || []) as SettlementTx[];
      if (txRows.length > 0) {
        const invoiceIds = [...new Set(txRows.map((t) => t.invoice_id))];
        const { data: invoices } = await sb
          .from("invoices")
          .select("id, invoice_number")
          .in("id", invoiceIds);

        const invoiceMap: Record<string, string> = {};
        (invoices || []).forEach((inv: any) => { invoiceMap[inv.id] = inv.invoice_number; });
        txRows.forEach((t) => { t.invoice_number = invoiceMap[t.invoice_id] || "—"; });
      }

      setTransactions(txRows);
      setLoading(false);
    };
    fetchTx();
  }, [merchant, fromDate, toDate]);

  // Compute metrics
  const totalCollected = transactions.reduce((s, t) => s + Number(t.amount_paid), 0);
  const totalFees = transactions.reduce((s, t) => {
    // Only count fees the business actually pays
    return s + (t.fee_absorbed_by === "business" ? Number(t.paystack_fee) : 0);
  }, 0);
  const expectedSettlement = totalCollected - totalFees;

  const getNetAmount = (t: SettlementTx) => {
    const fee = t.fee_absorbed_by === "business" ? Number(t.paystack_fee) : 0;
    return Number(t.amount_paid) - fee;
  };

  const handleDownload = () => {
    const label = fromDate === toDate ? fromDate : `${fromDate}_to_${toDate}`;
    const csvData = transactions.map((t) => ({
      Date: new Date(t.created_at).toLocaleString("en-NG"),
      Invoice: t.invoice_number,
      Method: t.payment_method,
      "Gross Amount (₦)": Number(t.amount_paid).toFixed(2),
      "Paystack Fee (₦)": Number(t.paystack_fee).toFixed(2),
      "Fee Payer": t.fee_absorbed_by === "business" ? "Business" : "Customer",
      "Net Settlement (₦)": getNetAmount(t).toFixed(2),
      Reference: t.paystack_reference || "",
    }));
    downloadCSV(csvData, `Deraledger_Settlement_${label}`);
  };

  const isToday = fromDate === todayStr && toDate === todayStr;

  return (
    <PermissionGuard permission="view_settlements" merchant={merchant} featureLabel="Settlements">
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Settlements</h1>
          <p className="text-neutral-500 text-sm mt-1">Track your collections and expected payouts</p>
        </div>
        <Button
          variant="outline"
          className="border-2 gap-2 text-purp-700 border-purp-200 hover:bg-purp-50"
          onClick={handleDownload}
          disabled={transactions.length === 0}
        >
          <Download className="h-4 w-4" /> Download CSV
        </Button>
      </div>

      {/* Date Range Picker */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-neutral-500" />
          <span className="text-sm text-neutral-600 font-medium">From</span>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px] border-2 bg-white" />
          <span className="text-sm text-neutral-600 font-medium">To</span>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px] border-2 bg-white" />
        </div>
        <div className="flex items-center gap-2">
          {(["today", "week", "month", "last_month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border-2 transition-colors ${
                (p === "today" && isToday)
                  ? "bg-purp-900 text-white border-purp-900"
                  : "border-purp-200 text-purp-700 hover:bg-purp-50"
              }`}
            >
              {p === "today" ? "Today" : p === "week" ? "This Week" : p === "month" ? "This Month" : "Last Month"}
            </button>
          ))}
          {isToday && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 border-2 text-xs">Live — Today</Badge>}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 border-2 border-emerald-200 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-emerald-700" />
              </div>
              <p className="text-xs text-neutral-500 font-medium uppercase">Collected</p>
            </div>
            <p className="text-2xl font-bold text-neutral-900">{formatNaira(totalCollected)}</p>
            <p className="text-xs text-neutral-400 mt-1">{transactions.length} transaction{transactions.length !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 border-2 border-red-200 flex items-center justify-center">
                <Minus className="h-5 w-5 text-red-700" />
              </div>
              <p className="text-xs text-neutral-500 font-medium uppercase">Platform Fees</p>
            </div>
            <p className="text-2xl font-bold text-neutral-900">{formatNaira(totalFees)}</p>
            <p className="text-xs text-neutral-400 mt-1">Deducted from your payout</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none border-purp-200">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-purp-100 border-2 border-purp-200 flex items-center justify-center">
                <Banknote className="h-5 w-5 text-purp-700" />
              </div>
              <p className="text-xs text-neutral-500 font-medium uppercase">Expected Settlement</p>
            </div>
            <p className="text-2xl font-bold text-purp-900">{formatNaira(expectedSettlement)}</p>
            <p className="text-xs text-neutral-400 mt-1">
              {merchant?.settlement_bank_name ? `→ ${merchant.settlement_bank_name} ****${merchant.settlement_account_number?.slice(-4)}` : "No bank set"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Transaction Table */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-neutral-900">Transaction Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading transactions...
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-12 text-neutral-500">
              <DollarSign className="h-10 w-10 mx-auto mb-2 text-neutral-300" />
              <p className="text-sm">No transactions on this date</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-neutral-50 hover:bg-neutral-50">
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Time</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Invoice</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Method</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Gross</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Fee</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Fee Payer</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Net Settlement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id} className="border-b hover:bg-neutral-50">
                    <TableCell className="text-sm text-neutral-600">
                      {new Date(t.created_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-neutral-900">{t.invoice_number}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize border-2 bg-neutral-50">
                        {t.payment_method === "bank_transfer" ? "Bank" : t.payment_method}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right font-medium">{formatNaira(Number(t.amount_paid))}</TableCell>
                    <TableCell className="text-sm text-right text-red-600">{formatNaira(Number(t.paystack_fee))}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs border-2 ${t.fee_absorbed_by === "business" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-neutral-50 text-neutral-500 border-neutral-200"}`}>
                        {t.fee_absorbed_by === "business" ? "Business" : "Customer"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right font-bold text-emerald-700">{formatNaira(getNetAmount(t))}</TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="bg-neutral-50 border-t-2 hover:bg-neutral-50">
                  <TableCell colSpan={3} className="font-bold text-sm text-neutral-900">Total</TableCell>
                  <TableCell className="text-right font-bold text-sm">{formatNaira(totalCollected)}</TableCell>
                  <TableCell className="text-right font-bold text-sm text-red-600">{formatNaira(totalFees)}</TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right font-bold text-sm text-emerald-700">{formatNaira(expectedSettlement)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
    </PermissionGuard>
  );
}
