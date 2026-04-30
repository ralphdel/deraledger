"use client";

import { useEffect, useState } from "react";
import {
  DollarSign, Download, CalendarDays, TrendingUp, Minus, Banknote,
  Loader2, Search, Building2,
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
  paystack_reference: string | null;
}

interface MerchantOption {
  id: string;
  business_name: string;
}

export default function AdminAccountingPage() {
  const [transactions, setTransactions] = useState<AdminTx[]>([]);
  const [merchants, setMerchants] = useState<MerchantOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [merchantFilter, setMerchantFilter] = useState("all");
  const [merchantSearch, setMerchantSearch] = useState("");

  // Load merchant list once
  useEffect(() => {
    const sb = createClient();
    sb.from("merchants")
      .select("id, business_name")
      .order("business_name")
      .then(({ data }) => setMerchants((data || []) as MerchantOption[]));
  }, []);

  // Load transactions for selected date
  useEffect(() => {
    const fetchTx = async () => {
      setLoading(true);
      const sb = createClient();
      const dayStart = `${selectedDate}T00:00:00.000Z`;
      const dayEnd = `${selectedDate}T23:59:59.999Z`;

      let query = sb
        .from("transactions")
        .select("id, created_at, merchant_id, invoice_id, amount_paid, paystack_fee, fee_absorbed_by, payment_method, paystack_reference")
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
        // Fetch invoice numbers
        const invoiceIds = [...new Set(txRows.map((t) => t.invoice_id))];
        const { data: invoices } = await sb.from("invoices").select("id, invoice_number").in("id", invoiceIds);
        const invoiceMap: Record<string, string> = {};
        (invoices || []).forEach((inv: any) => { invoiceMap[inv.id] = inv.invoice_number; });

        // Map merchant names
        const merchantMap: Record<string, string> = {};
        merchants.forEach((m) => { merchantMap[m.id] = m.business_name; });

        txRows.forEach((t) => {
          t.invoice_number = invoiceMap[t.invoice_id] || "—";
          t.merchant_name = merchantMap[t.merchant_id] || t.merchant_id.slice(0, 8);
        });
      }

      setTransactions(txRows);
      setLoading(false);
    };
    fetchTx();
  }, [selectedDate, merchantFilter, merchants]);

  const totalGMV = transactions.reduce((s, t) => s + Number(t.amount_paid), 0);
  const totalFees = transactions.reduce((s, t) => s + Number(t.paystack_fee), 0);
  const totalMerchantFees = transactions.reduce((s, t) => s + (t.fee_absorbed_by === "business" ? Number(t.paystack_fee) : 0), 0);
  const totalSettlement = totalGMV - totalMerchantFees;

  const getNetAmount = (t: AdminTx) => {
    const fee = t.fee_absorbed_by === "business" ? Number(t.paystack_fee) : 0;
    return Number(t.amount_paid) - fee;
  };

  const handleDownload = () => {
    const dateStr = new Date(selectedDate).toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-");
    const suffix = merchantFilter !== "all" ? `_${merchants.find((m) => m.id === merchantFilter)?.business_name?.replace(/\s+/g, "_") || merchantFilter.slice(0, 8)}` : "_Global";
    const csvData = transactions.map((t) => ({
      Date: new Date(t.created_at).toLocaleString("en-NG"),
      Merchant: t.merchant_name,
      Invoice: t.invoice_number,
      Method: t.payment_method,
      "Gross Amount (₦)": Number(t.amount_paid).toFixed(2),
      "Paystack Fee (₦)": Number(t.paystack_fee).toFixed(2),
      "Fee Payer": t.fee_absorbed_by === "business" ? "Business" : "Customer",
      "Net Settlement (₦)": getNetAmount(t).toFixed(2),
      Reference: t.paystack_reference || "",
    }));
    downloadCSV(csvData, `PurpLedger_Accounting${suffix}_${dateStr}`);
  };

  const isToday = selectedDate === new Date().toISOString().split("T")[0];
  const filteredMerchantList = merchants.filter((m) =>
    m.business_name.toLowerCase().includes(merchantSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Accounting & Settlements</h1>
          <p className="text-neutral-500 text-sm mt-1">Platform-wide settlement tracking and reports</p>
        </div>
        <Button
          variant="outline"
          className="border-2 gap-2"
          onClick={handleDownload}
          disabled={transactions.length === 0}
        >
          <Download className="h-4 w-4" /> Download CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-neutral-500" />
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-[180px] border-2 bg-white"
          />
          {isToday && (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 border-2 text-xs">Live</Badge>
          )}
        </div>
        <Select value={merchantFilter} onValueChange={(v) => v && setMerchantFilter(v)}>
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
            {filteredMerchantList.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.business_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Metrics */}
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
            <p className="text-xs text-neutral-500 mt-1">Total Paystack Fees</p>
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

      {/* Table */}
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
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Method</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Gross</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Fee</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Fee Payer</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id} className="border-b hover:bg-neutral-50">
                    <TableCell className="text-sm text-neutral-600">
                      {new Date(t.created_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-neutral-900">{t.merchant_name}</TableCell>
                    <TableCell className="text-sm text-neutral-600">{t.invoice_number}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize border-2 bg-neutral-50">
                        {t.payment_method === "bank_transfer" ? "Bank" : t.payment_method}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right font-medium">{formatNaira(Number(t.amount_paid))}</TableCell>
                    <TableCell className="text-sm text-right text-red-600">{formatNaira(Number(t.paystack_fee))}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs border-2 ${t.fee_absorbed_by === "business" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-neutral-50 text-neutral-500 border-neutral-200"}`}>
                        {t.fee_absorbed_by === "business" ? "Merchant" : "Customer"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right font-bold text-emerald-700">{formatNaira(getNetAmount(t))}</TableCell>
                  </TableRow>
                ))}
                {/* Totals */}
                <TableRow className="bg-neutral-50 border-t-2 hover:bg-neutral-50">
                  <TableCell colSpan={4} className="font-bold text-sm text-neutral-900">Total</TableCell>
                  <TableCell className="text-right font-bold text-sm">{formatNaira(totalGMV)}</TableCell>
                  <TableCell className="text-right font-bold text-sm text-red-600">{formatNaira(totalFees)}</TableCell>
                  <TableCell></TableCell>
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
