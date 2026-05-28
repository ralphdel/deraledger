"use client";

import { useEffect, useState } from "react";
import {
  DollarSign, Download, CalendarDays, TrendingUp, Minus, Banknote, Loader2, Building2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { formatNaira } from "@/lib/calculations";
import { downloadCSV } from "@/lib/csv";

interface AdminTx {
  id: string;
  created_at: string;
  merchant_id: string;
  merchant_name: string;
  invoice_id: string;
  invoice_number: string;
  amount_paid: number;
  paystack_fee: number;
  fee_absorbed_by: string;
  payment_method: string;
  payment_rail?: string | null;
  settlement_status?: string | null;
  source_currency?: string | null;
  source_amount?: number | null;
  fx_rate?: number | null;
  merchant_net_amount?: number | null;
  paystack_reference: string | null;
  processor_reference?: string | null;
}

interface MerchantOption {
  id: string;
  business_name: string;
}

export default function AdminAccountingPage() {
  const [transactions, setTransactions] = useState<AdminTx[]>([]);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const todayStr = new Date().toISOString().split("T")[0];
  const [fromDate, setFromDate] = useState(todayStr);
  const [toDate, setToDate] = useState(todayStr);
  const [merchantFilter, setMerchantFilter] = useState("all");
  const [merchantSearch, setMerchantSearch] = useState("");

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
    const sb = createClient();
    sb.from("merchants")
      .select("id, business_name")
      .order("business_name")
      .then(({ data }) => setMerchants((data || []) as MerchantOption[]));
  }, []);

  useEffect(() => {
    const fetchTx = async () => {
      setLoading(true);
      const sb = createClient();
      const dayStart = `${fromDate}T00:00:00.000Z`;
      const dayEnd = `${toDate}T23:59:59.999Z`;

      let query = sb
        .from("transactions")
        .select("id, created_at, merchant_id, invoice_id, amount_paid, paystack_fee, fee_absorbed_by, payment_method, payment_rail, settlement_status, source_currency, source_amount, fx_rate, merchant_net_amount, paystack_reference, processor_reference")
        .eq("status", "success")
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd)
        .order("created_at", { ascending: false });

      if (merchantFilter !== "all") {
        query = query.eq("merchant_id", merchantFilter);
      }

      const { data } = await query;
      const txRows = (data || []) as AdminTx[];

      if (txRows.length > 0) {
        const invoiceIds = [...new Set(txRows.map((tx) => tx.invoice_id))];
        const { data: invoices } = await sb.from("invoices").select("id, invoice_number").in("id", invoiceIds);
        const invoiceMap: Record<string, string> = {};
        (invoices || []).forEach((inv) => { invoiceMap[String(inv.id)] = String(inv.invoice_number); });

        const merchantMap: Record<string, string> = {};
        merchants.forEach((merchant) => { merchantMap[merchant.id] = merchant.business_name; });

        txRows.forEach((tx) => {
          tx.invoice_number = invoiceMap[tx.invoice_id] || "-";
          tx.merchant_name = merchantMap[tx.merchant_id] || tx.merchant_id.slice(0, 8);
        });
      }

      setTransactions(txRows);
      setLoading(false);
    };
    fetchTx();
  }, [fromDate, toDate, merchantFilter, merchants]);

  function getNetAmount(tx: AdminTx) {
    if (typeof tx.merchant_net_amount === "number") {
      return Number(tx.merchant_net_amount);
    }
    const fee = tx.fee_absorbed_by === "business" ? Number(tx.paystack_fee) : 0;
    return Number(tx.amount_paid) - fee;
  }

  const totalGMV = transactions.reduce((sum, tx) => sum + Number(tx.amount_paid), 0);
  const totalFees = transactions.reduce((sum, tx) => sum + Number(tx.paystack_fee), 0);
  const totalMerchantFees = transactions.reduce((sum, tx) => {
    return sum + (tx.fee_absorbed_by === "business" ? Number(tx.paystack_fee) : 0);
  }, 0);
  const totalSettlement = transactions.reduce((sum, tx) => sum + getNetAmount(tx), 0);

  const handleDownload = () => {
    const label = fromDate === toDate ? fromDate : `${fromDate}_to_${toDate}`;
    const suffix = merchantFilter !== "all"
      ? `_${merchants.find((merchant) => merchant.id === merchantFilter)?.business_name?.replace(/\s+/g, "_") || merchantFilter.slice(0, 8)}`
      : "_Global";

    const csvData = transactions.map((tx) => ({
      Date: new Date(tx.created_at).toLocaleString("en-NG"),
      Merchant: tx.merchant_name,
      Invoice: tx.invoice_number,
      Method: tx.payment_method,
      "Payment Rail": (tx.payment_rail || tx.payment_method || "").toUpperCase(),
      "Settlement Status": tx.settlement_status || "settled",
      "Gross Amount (NGN)": Number(tx.amount_paid).toFixed(2),
      "Provider Fee (NGN)": Number(tx.paystack_fee).toFixed(2),
      "Fee Payer": tx.fee_absorbed_by === "business" ? "Business" : "Customer",
      "Net Settlement (NGN)": getNetAmount(tx).toFixed(2),
      "FX Details": tx.source_amount && tx.fx_rate ? `${tx.source_amount} ${tx.source_currency} @ ${tx.fx_rate}` : "",
      Reference: tx.processor_reference || tx.paystack_reference || "",
    }));
    downloadCSV(csvData, `Deraledger_Accounting${suffix}_${label}`);
  };

  const isToday = fromDate === todayStr && toDate === todayStr;
  const filteredMerchantList = merchants.filter((merchant) =>
    merchant.business_name.toLowerCase().includes(merchantSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Accounting & Settlements</h1>
          <p className="text-neutral-500 text-sm mt-1">Platform-wide treasury, collection, and settlement tracking.</p>
        </div>
        <Button variant="outline" className="border-2 gap-2" onClick={handleDownload} disabled={transactions.length === 0}>
          <Download className="h-4 w-4" /> Download CSV
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-neutral-500" />
            <span className="text-sm text-neutral-600 font-medium">From</span>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-[160px] border-2 bg-white" />
            <span className="text-sm text-neutral-600 font-medium">To</span>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-[160px] border-2 bg-white" />
          </div>
          <div className="flex items-center gap-2">
            {(["today", "week", "month", "last_month"] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => applyPreset(preset)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-full border-2 transition-colors ${
                  preset === "today" && isToday ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                {preset === "today" ? "Today" : preset === "week" ? "This Week" : preset === "month" ? "This Month" : "Last Month"}
              </button>
            ))}
            {isToday && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 border-2 text-xs">Live</Badge>}
          </div>
        </div>
        <Select value={merchantFilter} onValueChange={(value) => value && setMerchantFilter(value)}>
          <SelectTrigger className="w-[260px] border-2 bg-white text-sm">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-neutral-400" />
              <SelectValue placeholder="All Merchants" />
            </div>
          </SelectTrigger>
          <SelectContent className="max-h-[300px]">
            <div className="p-2 sticky top-0 bg-white border-b">
              <Input
                placeholder="Search merchants..."
                value={merchantSearch}
                onChange={(e) => setMerchantSearch(e.target.value)}
                className="h-8 text-sm border-2"
              />
            </div>
            <SelectItem value="all">All Merchants</SelectItem>
            {filteredMerchantList.map((merchant) => (
              <SelectItem key={merchant.id} value={merchant.id}>{merchant.business_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 border-2 border-blue-200 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-blue-700" />
              </div>
            </div>
            <p className="text-2xl font-bold text-neutral-900">{formatNaira(totalGMV)}</p>
            <p className="text-xs text-neutral-500 mt-1">Gross Volume ({transactions.length} txns)</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 border-2 border-red-200 flex items-center justify-center">
                <Minus className="h-5 w-5 text-red-700" />
              </div>
            </div>
            <p className="text-2xl font-bold text-neutral-900">{formatNaira(totalFees)}</p>
            <p className="text-xs text-neutral-500 mt-1">Total Provider Fees</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 border-2 border-amber-200 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-amber-700" />
              </div>
            </div>
            <p className="text-2xl font-bold text-neutral-900">{formatNaira(totalMerchantFees)}</p>
            <p className="text-xs text-neutral-500 mt-1">Merchant-Absorbed Fees</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none border-emerald-200">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 border-2 border-emerald-200 flex items-center justify-center">
                <Banknote className="h-5 w-5 text-emerald-700" />
              </div>
            </div>
            <p className="text-2xl font-bold text-emerald-700">{formatNaira(totalSettlement)}</p>
            <p className="text-xs text-neutral-500 mt-1">Expected Merchant Settlement</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-neutral-900">Transaction Ledger</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-neutral-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
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
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Merchant</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Invoice</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Payment Rail</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Settlement</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Gross</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Fee</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Fee Payer</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id} className="border-b hover:bg-neutral-50">
                    <TableCell className="text-sm text-neutral-600">
                      {new Date(tx.created_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-neutral-900">{tx.merchant_name}</TableCell>
                    <TableCell className="text-sm text-neutral-600">{tx.invoice_number}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize border-2 bg-neutral-50">
                        {(tx.payment_rail || tx.payment_method) === "bank_transfer" ? "Bank" : (tx.payment_rail || tx.payment_method)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-neutral-600">
                      <div className="space-y-1">
                        <Badge variant="outline" className="text-[10px] uppercase border-2 bg-neutral-50">
                          {(tx.settlement_status || "settled").replaceAll("_", " ")}
                        </Badge>
                        {tx.source_amount && tx.fx_rate ? (
                          <div>{tx.source_amount} {tx.source_currency} @ {formatNaira(Number(tx.fx_rate))}</div>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-right font-medium">{formatNaira(Number(tx.amount_paid))}</TableCell>
                    <TableCell className="text-sm text-right text-red-600">{formatNaira(Number(tx.paystack_fee))}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs border-2 ${tx.fee_absorbed_by === "business" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-neutral-50 text-neutral-500 border-neutral-200"}`}>
                        {tx.fee_absorbed_by === "business" ? "Merchant" : "Customer"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right font-bold text-emerald-700">{formatNaira(getNetAmount(tx))}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-neutral-50 border-t-2 hover:bg-neutral-50">
                  <TableCell colSpan={5} className="font-bold text-sm text-neutral-900">Total</TableCell>
                  <TableCell className="text-right font-bold text-sm">{formatNaira(totalGMV)}</TableCell>
                  <TableCell className="text-right font-bold text-sm text-red-600">{formatNaira(totalFees)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-bold text-sm text-emerald-700">{formatNaira(totalSettlement)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
