"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Search, Download, FileText, ArrowRightLeft, TrendingUp, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getInvoices, getClients, getAllTransactions, getAllManualPayments, getMerchant } from "@/lib/data";
import { formatNaira } from "@/lib/calculations";
import type { InvoiceWithClient, Client, Transaction, Merchant } from "@/lib/types";
import { PermissionGuard } from "@/components/PermissionGuard";

type TransactionWithInvoice = Transaction & {
  invoices?: InvoiceWithClient | null;
};

type ManualPaymentWithInvoice = {
  id: string;
  invoice_id: string;
  merchant_id: string;
  amount: number;
  payment_method: string;
  date_received: string;
  created_at: string;
  invoices?: InvoiceWithClient | null;
};

export default function AccountingReportPage() {
  const [merchant, setMerchant] = useState<(Merchant & { permissions?: Record<string, boolean>; currentUserRole?: string }) | null>(null);
  const [invoices, setInvoices] = useState<InvoiceWithClient[]>([]);
  const [transactions, setTransactions] = useState<TransactionWithInvoice[]>([]);
  const [manualPayments, setManualPayments] = useState<ManualPaymentWithInvoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [clientIdFilter, setClientIdFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Date filters - Default to this month
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth.toISOString().split("T")[0]);
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);

  useEffect(() => {
    Promise.all([getInvoices(), getClients(), getAllTransactions(), getAllManualPayments(), getMerchant()]).then(([invData, clientData, txData, manualData, m]) => {
      setInvoices(invData);
      setClients(clientData);
      setTransactions(txData as TransactionWithInvoice[]);
      setManualPayments(manualData as ManualPaymentWithInvoice[]);
      if (m) setMerchant(m);
      setLoading(false);
    });
  }, []);

  const dateInRange = useCallback((value: string | null | undefined) => {
    if (!value) return false;
    const itemDate = new Date(value);
    const isAfterFrom = dateFrom ? itemDate >= new Date(dateFrom + "T00:00:00") : true;
    const isBeforeTo = dateTo ? itemDate <= new Date(dateTo + "T23:59:59") : true;
    return isAfterFrom && isBeforeTo;
  }, [dateFrom, dateTo]);

  const invoiceMatchesFilters = useCallback((inv: InvoiceWithClient | null | undefined) => {
    if (!inv) return false;
    const matchesType = typeFilter === "all" || inv.invoice_type === typeFilter;
    const matchesClient = clientIdFilter === "all" || inv.client_id === clientIdFilter;
    return matchesType && matchesClient;
  }, [clientIdFilter, typeFilter]);

  const invoiceLookup = useMemo(() => {
    return new Map(invoices.map((inv) => [inv.id, inv]));
  }, [invoices]);

  const createdInvoicesInRange = useMemo(() => {
    return invoices.filter((inv) => {
      return dateInRange(inv.created_at) && invoiceMatchesFilters(inv);
    });
  }, [invoices, dateInRange, invoiceMatchesFilters]);

  const successfulTransactionsInRange = useMemo(() => {
    return transactions.filter((tx) => {
      const linkedInvoice = tx.invoices || (tx.invoice_id ? invoiceLookup.get(tx.invoice_id) : null);
      return tx.status === "success" && dateInRange(tx.created_at) && invoiceMatchesFilters(linkedInvoice);
    });
  }, [transactions, dateInRange, invoiceLookup, invoiceMatchesFilters]);

  const manualPaymentsInRange = useMemo(() => {
    return manualPayments.filter((payment) => {
      const linkedInvoice = payment.invoices || (payment.invoice_id ? invoiceLookup.get(payment.invoice_id) : null);
      return dateInRange(payment.date_received || payment.created_at) && invoiceMatchesFilters(linkedInvoice);
    });
  }, [manualPayments, dateInRange, invoiceLookup, invoiceMatchesFilters]);

  const relatedInvoices = useMemo(() => {
    const reportInvoiceMap = new Map<string, InvoiceWithClient>();

    createdInvoicesInRange.forEach((inv) => {
      reportInvoiceMap.set(inv.id, inv);
    });

    successfulTransactionsInRange.forEach((tx) => {
      const linkedInvoice = tx.invoices || (tx.invoice_id ? invoiceLookup.get(tx.invoice_id) : null);
      if (linkedInvoice) reportInvoiceMap.set(linkedInvoice.id, linkedInvoice);
    });

    manualPaymentsInRange.forEach((payment) => {
      const linkedInvoice = payment.invoices || (payment.invoice_id ? invoiceLookup.get(payment.invoice_id) : null);
      if (linkedInvoice) reportInvoiceMap.set(linkedInvoice.id, linkedInvoice);
    });

    return Array.from(reportInvoiceMap.values());
  }, [createdInvoicesInRange, successfulTransactionsInRange, manualPaymentsInRange, invoiceLookup]);

  const getInvoiceMetrics = (inv: InvoiceWithClient) => {
    const recordedPaid = Number(inv.amount_paid || 0);
    const dbOutstanding = Number(inv.outstanding_balance || 0);
    
    // Effective grand total = actual paid + actual outstanding.
    // This naturally subtracts any applied deposits (which don't appear in amount_paid or outstanding).
    const effectiveGrandTotal = recordedPaid + dbOutstanding;

    return { grandTotal: effectiveGrandTotal, paid: recordedPaid, outstanding: dbOutstanding };
  };

  const aggregatedData = useMemo(() => {
    const map = new Map<string, {
      clientName: string;
      email: string;
      invoiceCount: number;
      totalRaised: number;
      totalPaid: number;
      totalPaidToDate: number;
      totalOutstanding: number;
    }>();

    const ensureClient = (inv: InvoiceWithClient | null | undefined) => {
      if (!inv) return null;
      const clientId = inv.client_id || "deleted-client";
      if (!map.has(clientId)) {
        map.set(clientId, {
          clientName: inv.clients?.full_name || "[Deleted Client]",
          email: inv.clients?.email || "",
          invoiceCount: 0,
          totalRaised: 0,
          totalPaid: 0,
          totalPaidToDate: 0,
          totalOutstanding: 0,
        });
      }
      return map.get(clientId)!;
    };

    relatedInvoices.forEach((inv) => {
      ensureClient(inv);
    });

    successfulTransactionsInRange.forEach((tx) => {
      ensureClient(tx.invoices);
    });

    manualPaymentsInRange.forEach((payment) => {
      ensureClient(payment.invoices);
    });

    relatedInvoices.forEach((inv) => {
      const clientStat = ensureClient(inv);
      if (!clientStat) return;
      const metrics = getInvoiceMetrics(inv);

      clientStat.invoiceCount += 1;
      clientStat.totalRaised += metrics.grandTotal;
      clientStat.totalPaidToDate += metrics.paid;
      clientStat.totalOutstanding += metrics.outstanding;
    });

    successfulTransactionsInRange.forEach((tx) => {
      const clientStat = ensureClient(tx.invoices);
      if (!clientStat) return;
      clientStat.totalPaid += Number(tx.amount_paid || 0);
    });

    manualPaymentsInRange.forEach((payment) => {
      const clientStat = ensureClient(payment.invoices);
      if (!clientStat) return;
      clientStat.totalPaid += Number(payment.amount || 0);
    });

    // Apply search filter to aggregated table
    let result = Array.from(map.values());
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => r.clientName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
    }

    return result.sort((a, b) => (b.totalRaised + b.totalPaid) - (a.totalRaised + a.totalPaid));
  }, [relatedInvoices, successfulTransactionsInRange, manualPaymentsInRange, searchQuery]);

  const totals = useMemo(() => {
    return aggregatedData.reduce((acc, curr) => ({
      invoices: acc.invoices + curr.invoiceCount,
      raised: acc.raised + curr.totalRaised,
      paid: acc.paid + curr.totalPaid,
      paidToDate: acc.paidToDate + curr.totalPaidToDate,
      outstanding: acc.outstanding + curr.totalOutstanding,
    }), { invoices: 0, raised: 0, paid: 0, paidToDate: 0, outstanding: 0 });
  }, [aggregatedData]);

  const handleExportCsv = () => {
    if (aggregatedData.length === 0) return;

    const headers = ["Client Name", "Email", "Related Invoices", "Related Invoice Value (NGN)", "Payments in Period (NGN)", "Paid to Date (NGN)", "Current Outstanding (NGN)"];
    
    const rows = aggregatedData.map(row => [
      `"${row.clientName.replace(/"/g, '""')}"`,
      `"${row.email}"`,
      row.invoiceCount,
      row.totalRaised.toFixed(2),
      row.totalPaid.toFixed(2),
      row.totalPaidToDate.toFixed(2),
      row.totalOutstanding.toFixed(2)
    ]);

    // Add totals row
    rows.push([
      '"TOTAL"',
      '""',
      totals.invoices,
      totals.raised.toFixed(2),
      totals.paid.toFixed(2),
      totals.paidToDate.toFixed(2),
      totals.outstanding.toFixed(2)
    ]);

    const csvContent = [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Accounting_Report_${dateFrom}_to_${dateTo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold text-purp-900 dark:text-white">Accounting Report</h1></div>
        <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none animate-pulse dark:bg-[#1A0B2E]">
          <CardContent className="p-6"><div className="h-64 bg-purp-50 dark:bg-white/5 rounded" /></CardContent>
        </Card>
      </div>
    );
  }

  // ── Plan gate: Advanced analytics is Business plan only ───────────────────────
  const currentPlan = merchant?.subscription_plan || merchant?.merchant_tier || "starter";
  const isCorporate = currentPlan === "corporate";
  if (!isCorporate) {
    const isStarter = currentPlan === "starter";
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-purp-900 dark:text-white">Accounting Report</h1>
          <p className="text-neutral-500 dark:text-white/60 text-sm mt-1">Analyze revenue, outstanding balances, and client performance</p>
        </div>
        <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none">
          <CardContent className="p-10 flex flex-col items-center text-center gap-5">
            <div className="w-16 h-16 rounded-full bg-purp-100 dark:bg-[#7B2FF7]/20 border-2 border-purp-200 dark:border-[#7B2FF7]/30 flex items-center justify-center">
              <Lock className="w-7 h-7 text-purp-700 dark:text-[#B58CFF]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-purp-900 dark:text-white mb-2">Advanced Analytics — Business Plan</h2>
              <p className="text-neutral-600 dark:text-white/60 max-w-md text-sm leading-relaxed">
                The Accounting Report gives you a full breakdown of revenue, client performance, and outstanding balances. This feature is available exclusively on the <strong>Business</strong> plan.
                {isStarter && " Your current Starter plan includes basic invoice tracking only."}
              </p>
            </div>
            <a href="/settings/billing">
              <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-purp-900 hover:bg-purp-700 dark:bg-[#7B2FF7] dark:hover:bg-[#7B2FF7]/80 text-white text-sm font-bold rounded-lg transition-colors">
                Upgrade to Business <ArrowRight className="w-4 h-4" />
              </button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PermissionGuard permission="view_analytics" merchant={merchant} featureLabel="Accounting Reports">
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-purp-900 dark:text-white">Accounting Report</h1>
          <p className="text-neutral-500 dark:text-white/60 text-sm mt-1">
            Compare invoice and payment activity for the selected period
          </p>
        </div>
        <Button onClick={handleExportCsv} className="bg-purp-900 hover:bg-purp-700 dark:bg-[#7B2FF7] dark:hover:bg-[#7B2FF7]/80 text-white font-semibold self-start sm:self-auto">
          <Download className="mr-2 h-4 w-4" /> Download CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none bg-white dark:bg-[#1A0B2E]">
        <CardContent className="p-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-600 dark:text-white/60 uppercase tracking-wider">Date From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-[#12061F] dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-600 dark:text-white/60 uppercase tracking-wider">Date To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-[#12061F] dark:text-white [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-600 dark:text-white/60 uppercase tracking-wider">Client</label>
              <Select value={clientIdFilter} onValueChange={(v) => setClientIdFilter(v ?? "all")}>
                <SelectTrigger className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-[#12061F] dark:text-white">
                  <SelectValue placeholder="All Clients" />
                </SelectTrigger>
                <SelectContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                  <SelectItem value="all" className="dark:text-white dark:focus:bg-white/5">All Clients</SelectItem>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id} className="dark:text-white dark:focus:bg-white/5">{c.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-600 dark:text-white/60 uppercase tracking-wider">Invoice Type</label>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
                <SelectTrigger className="border-2 border-purp-200 dark:border-white/10 bg-purp-50 dark:bg-[#12061F] dark:text-white">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent className="border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E]">
                  <SelectItem value="all" className="dark:text-white dark:focus:bg-white/5">All Types</SelectItem>
                  <SelectItem value="record" className="dark:text-white dark:focus:bg-white/5">Record Invoices</SelectItem>
                  <SelectItem value="collection" className="dark:text-white dark:focus:bg-white/5">Collection Invoices</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="mt-4 text-xs text-neutral-500 dark:text-white/60">
            Payments in Period are grouped by payment date. Related Invoice Value and Current Outstanding are based on the related invoices. Current Outstanding is the balance today, so it may be zero if an invoice was fully paid outside the selected period.
          </p>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-purp-600 dark:text-[#B58CFF] mb-2">
              <FileText className="h-5 w-5" />
              <h3 className="font-semibold">Related Invoices</h3>
            </div>
            <p className="text-2xl font-bold text-purp-900 dark:text-white">{totals.invoices}</p>
            <p className="text-sm text-neutral-500 dark:text-white/60 mt-1">Invoices created or paid within this date range</p>
          </CardContent>
        </Card>
        <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-purp-600 dark:text-[#B58CFF] mb-2">
              <FileText className="h-5 w-5" />
              <h3 className="font-semibold">Related Invoice Value</h3>
            </div>
            <p className="text-2xl font-bold text-purp-900 dark:text-white">{formatNaira(totals.raised)}</p>
            <p className="text-sm text-neutral-500 dark:text-white/60 mt-1">Distinct related invoices counted once</p>
          </CardContent>
        </Card>
        <Card className="border-2 border-emerald-200 dark:border-emerald-500/20 shadow-none bg-emerald-50/50 dark:bg-[#1A0B2E]">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 mb-2">
              <TrendingUp className="h-5 w-5" />
              <h3 className="font-semibold">Payments in Period</h3>
            </div>
            <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-50">{formatNaira(totals.paid)}</p>
            <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80 mt-1">Successful payments received in this date range</p>
          </CardContent>
        </Card>
        <Card className="border-2 border-sky-200 dark:border-sky-500/20 shadow-none bg-sky-50/50 dark:bg-[#1A0B2E]">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-sky-600 dark:text-sky-400 mb-2">
              <TrendingUp className="h-5 w-5" />
              <h3 className="font-semibold">Paid to Date</h3>
            </div>
            <p className="text-2xl font-bold text-sky-900 dark:text-sky-50">{formatNaira(totals.paidToDate)}</p>
            <p className="text-sm text-sky-700/80 dark:text-sky-400/80 mt-1">Total paid on these related invoices across all time</p>
          </CardContent>
        </Card>
        <Card className="border-2 border-amber-200 dark:border-amber-500/20 shadow-none bg-amber-50/50 dark:bg-[#1A0B2E]">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400 mb-2">
              <ArrowRightLeft className="h-5 w-5" />
              <h3 className="font-semibold">Current Outstanding</h3>
            </div>
            <p className="text-2xl font-bold text-amber-900 dark:text-amber-50">{formatNaira(totals.outstanding)}</p>
            <p className="text-sm text-amber-700/80 dark:text-amber-400/80 mt-1">Current unpaid balance on these related invoices</p>
          </CardContent>
        </Card>
      </div>

      {/* Table Section */}
      <Card className="border-2 border-purp-200 dark:border-white/10 shadow-none dark:bg-[#1A0B2E]">
        <div className="p-4 border-b border-purp-200 dark:border-white/10 flex flex-col sm:flex-row gap-3 justify-between items-center bg-purp-50/50 dark:bg-white/5">
          <h2 className="font-bold text-purp-900 dark:text-white">Client Breakdown</h2>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500 dark:text-white/50" />
            <Input
              placeholder="Search clients..."
              className="pl-9 h-9 border-purp-200 dark:border-white/10 bg-white dark:bg-[#12061F] dark:text-white"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-purp-50 dark:bg-white/5 border-b-2 border-purp-200 dark:border-white/10 hover:bg-purp-50 dark:hover:bg-white/5">
                <TableHead className="font-bold text-purp-900 dark:text-white text-xs uppercase tracking-wider">Client</TableHead>
                <TableHead className="font-bold text-purp-900 dark:text-white text-xs uppercase tracking-wider text-center">Related Invoices</TableHead>
                <TableHead className="font-bold text-purp-900 dark:text-white text-xs uppercase tracking-wider text-right">Related Invoice Value</TableHead>
                <TableHead className="font-bold text-purp-900 dark:text-white text-xs uppercase tracking-wider text-right">Payments in Period</TableHead>
                <TableHead className="font-bold text-purp-900 dark:text-white text-xs uppercase tracking-wider text-right">Paid to Date</TableHead>
                <TableHead className="font-bold text-purp-900 dark:text-white text-xs uppercase tracking-wider text-right">Current Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aggregatedData.map((row) => (
                <TableRow key={row.clientName} className="border-b border-purp-100 dark:border-white/10 hover:bg-purp-50/50 dark:hover:bg-white/5">
                  <TableCell>
                    <p className="font-semibold text-purp-900 dark:text-white">{row.clientName}</p>
                    <p className="text-xs text-neutral-500 dark:text-white/60">{row.email}</p>
                  </TableCell>
                  <TableCell className="text-center font-medium text-neutral-600 dark:text-white/80">{row.invoiceCount}</TableCell>
                  <TableCell className="text-right font-medium dark:text-white/90">{formatNaira(row.totalRaised)}</TableCell>
                  <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatNaira(row.totalPaid)}</TableCell>
                  <TableCell className="text-right font-semibold text-sky-600 dark:text-sky-400">{formatNaira(row.totalPaidToDate)}</TableCell>
                  <TableCell className="text-right font-semibold text-amber-600 dark:text-amber-400">{formatNaira(row.totalOutstanding)}</TableCell>
                </TableRow>
              ))}
              {aggregatedData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-neutral-500 dark:text-white/50">
                    No invoice or payment activity found for the selected filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
    </PermissionGuard>
  );
}
