"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, Download, Filter, FileText, ArrowRightLeft, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { getInvoices, getClients, getAllTransactions, getAllManualPayments } from "@/lib/data";
import { formatNaira } from "@/lib/calculations";
import type { InvoiceWithClient, Client, Transaction } from "@/lib/types";

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
    Promise.all([getInvoices(), getClients(), getAllTransactions(), getAllManualPayments()]).then(([invData, clientData, txData, manualData]) => {
      setInvoices(invData);
      setClients(clientData);
      setTransactions(txData as TransactionWithInvoice[]);
      setManualPayments(manualData as ManualPaymentWithInvoice[]);
      setLoading(false);
    });
  }, []);

  const dateInRange = (value: string | null | undefined) => {
    if (!value) return false;
    const itemDate = new Date(value);
    const isAfterFrom = dateFrom ? itemDate >= new Date(dateFrom + "T00:00:00") : true;
    const isBeforeTo = dateTo ? itemDate <= new Date(dateTo + "T23:59:59") : true;
    return isAfterFrom && isBeforeTo;
  };

  const invoiceMatchesFilters = (inv: InvoiceWithClient | null | undefined) => {
    if (!inv) return false;
    const matchesType = typeFilter === "all" || inv.invoice_type === typeFilter;
    const matchesClient = clientIdFilter === "all" || inv.client_id === clientIdFilter;
    return matchesType && matchesClient;
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      return dateInRange(inv.created_at) && invoiceMatchesFilters(inv);
    });
  }, [invoices, dateFrom, dateTo, typeFilter, clientIdFilter]);

  const paymentsByInvoice = useMemo(() => {
    const map = new Map<string, number>();
    transactions.filter((tx) => tx.status === "success").forEach((tx) => {
      map.set(tx.invoice_id, (map.get(tx.invoice_id) || 0) + Number(tx.amount_paid || 0));
    });
    manualPayments.forEach((payment) => {
      map.set(payment.invoice_id, (map.get(payment.invoice_id) || 0) + Number(payment.amount || 0));
    });
    return map;
  }, [transactions, manualPayments]);

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
      totalOutstanding: number;
    }>();

    const ensureClient = (inv: InvoiceWithClient) => {
      const clientId = inv.client_id;
      if (!map.has(clientId)) {
        map.set(clientId, {
          clientName: inv.clients?.full_name || "Unknown Client",
          email: inv.clients?.email || "",
          invoiceCount: 0,
          totalRaised: 0,
          totalPaid: 0,
          totalOutstanding: 0,
        });
      }
      return map.get(clientId)!;
    };

    filteredInvoices.forEach((inv) => {
      ensureClient(inv);
    });

    filteredInvoices.forEach((inv) => {
      const clientStat = ensureClient(inv);
      const metrics = getInvoiceMetrics(inv);

      clientStat.invoiceCount += 1;
      clientStat.totalRaised += metrics.grandTotal;
      clientStat.totalPaid += metrics.paid;
      clientStat.totalOutstanding += metrics.outstanding;
    });

    // Apply search filter to aggregated table
    let result = Array.from(map.values());
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => r.clientName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
    }

    return result.sort((a, b) => (b.totalRaised + b.totalPaid) - (a.totalRaised + a.totalPaid));
  }, [filteredInvoices, paymentsByInvoice, searchQuery]);

  const totals = useMemo(() => {
    return aggregatedData.reduce((acc, curr) => ({
      invoices: acc.invoices + curr.invoiceCount,
      raised: acc.raised + curr.totalRaised,
      paid: acc.paid + curr.totalPaid,
      outstanding: acc.outstanding + curr.totalOutstanding,
    }), { invoices: 0, raised: 0, paid: 0, outstanding: 0 });
  }, [aggregatedData]);

  const handleExportCsv = () => {
    if (aggregatedData.length === 0) return;

    const headers = ["Client Name", "Email", "Invoices Raised", "Total Amount (NGN)", "Amount Paid (NGN)", "Outstanding (NGN)"];
    
    const rows = aggregatedData.map(row => [
      `"${row.clientName.replace(/"/g, '""')}"`,
      `"${row.email}"`,
      row.invoiceCount,
      row.totalRaised.toFixed(2),
      row.totalPaid.toFixed(2),
      row.totalOutstanding.toFixed(2)
    ]);

    // Add totals row
    rows.push([
      '"TOTAL"',
      '""',
      totals.invoices,
      totals.raised.toFixed(2),
      totals.paid.toFixed(2),
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
        <div><h1 className="text-2xl font-bold text-purp-900">Accounting Report</h1></div>
        <Card className="border-2 border-purp-200 shadow-none animate-pulse">
          <CardContent className="p-6"><div className="h-64 bg-purp-50 rounded" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Accounting Report</h1>
          <p className="text-neutral-500 text-sm mt-1">
            Analyze revenue, outstanding balances, and client performance
          </p>
        </div>
        <Button onClick={handleExportCsv} className="bg-purp-900 hover:bg-purp-700 text-white font-semibold self-start sm:self-auto">
          <Download className="mr-2 h-4 w-4" /> Download CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="border-2 border-purp-200 shadow-none bg-white">
        <CardContent className="p-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">Date From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border-2 border-purp-200 bg-purp-50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">Date To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border-2 border-purp-200 bg-purp-50"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">Client</label>
              <Select value={clientIdFilter} onValueChange={(v) => setClientIdFilter(v ?? "all")}>
                <SelectTrigger className="border-2 border-purp-200 bg-purp-50">
                  <SelectValue placeholder="All Clients" />
                </SelectTrigger>
                <SelectContent className="border-2 border-purp-200">
                  <SelectItem value="all">All Clients</SelectItem>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-neutral-600 uppercase tracking-wider">Invoice Type</label>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
                <SelectTrigger className="border-2 border-purp-200 bg-purp-50">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent className="border-2 border-purp-200">
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="record">Record Invoices</SelectItem>
                  <SelectItem value="collection">Collection Invoices</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="border-2 border-purp-200 shadow-none">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-purp-600 mb-2">
              <FileText className="h-5 w-5" />
              <h3 className="font-semibold">Total Raised</h3>
            </div>
            <p className="text-2xl font-bold text-purp-900">{formatNaira(totals.raised)}</p>
            <p className="text-sm text-neutral-500 mt-1">From {totals.invoices} invoice(s)</p>
          </CardContent>
        </Card>
        <Card className="border-2 border-emerald-200 shadow-none bg-emerald-50/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-emerald-600 mb-2">
              <TrendingUp className="h-5 w-5" />
              <h3 className="font-semibold">Amount Paid</h3>
            </div>
            <p className="text-2xl font-bold text-emerald-900">{formatNaira(totals.paid)}</p>
            <p className="text-sm text-emerald-600/80 mt-1">Successfully collected</p>
          </CardContent>
        </Card>
        <Card className="border-2 border-amber-200 shadow-none bg-amber-50/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-amber-600 mb-2">
              <ArrowRightLeft className="h-5 w-5" />
              <h3 className="font-semibold">Outstanding</h3>
            </div>
            <p className="text-2xl font-bold text-amber-900">{formatNaira(totals.outstanding)}</p>
            <p className="text-sm text-amber-700/80 mt-1">Pending payment</p>
          </CardContent>
        </Card>
      </div>

      {/* Table Section */}
      <Card className="border-2 border-purp-200 shadow-none">
        <div className="p-4 border-b border-purp-200 flex flex-col sm:flex-row gap-3 justify-between items-center bg-purp-50/50">
          <h2 className="font-bold text-purp-900">Client Breakdown</h2>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
            <Input
              placeholder="Search clients..."
              className="pl-9 h-9 border-purp-200 bg-white"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-purp-50 border-b-2 border-purp-200 hover:bg-purp-50">
                <TableHead className="font-bold text-purp-900 text-xs uppercase tracking-wider">Client</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase tracking-wider text-center">Invoices</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase tracking-wider text-right">Total Raised</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase tracking-wider text-right">Paid</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase tracking-wider text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aggregatedData.map((row) => (
                <TableRow key={row.clientName} className="border-b border-purp-100 hover:bg-purp-50/50">
                  <TableCell>
                    <p className="font-semibold text-purp-900">{row.clientName}</p>
                    <p className="text-xs text-neutral-500">{row.email}</p>
                  </TableCell>
                  <TableCell className="text-center font-medium text-neutral-600">{row.invoiceCount}</TableCell>
                  <TableCell className="text-right font-medium">{formatNaira(row.totalRaised)}</TableCell>
                  <TableCell className="text-right font-semibold text-emerald-600">{formatNaira(row.totalPaid)}</TableCell>
                  <TableCell className="text-right font-semibold text-amber-600">{formatNaira(row.totalOutstanding)}</TableCell>
                </TableRow>
              ))}
              {aggregatedData.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-neutral-500">
                    No transactions found for the selected filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
