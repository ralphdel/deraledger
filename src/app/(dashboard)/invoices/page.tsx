"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Search, Filter, BookOpen, CreditCard, Banknote, FileText, PieChart, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getInvoices, getMerchant } from "@/lib/data";
import { formatNaira, getStatusColor, getStatusLabel } from "@/lib/calculations";
import type { InvoiceWithClient, Merchant } from "@/lib/types";

export default function InvoicesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "record" | "collection">("all");
  const [invoices, setInvoices] = useState<InvoiceWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchant, setMerchant] = useState<Merchant | null>(null);

  useEffect(() => {
    // Restore filter from localStorage if available
    const savedType = localStorage.getItem("purpledger_invoice_type_filter");
    if (savedType === "collection" || savedType === "record" || savedType === "all") {
      setTypeFilter(savedType as any);
    }

    const sb = createClient();
    Promise.all([
      getInvoices(),
      getMerchant()
    ]).then(([invoiceData, merchantResult]) => {
      setInvoices(invoiceData);
      if (merchantResult) setMerchant(merchantResult);
      
      // If Starter tier or unverified, force back to Record filter and don't allow Collection
      if (merchantResult?.subscription_plan === "starter" || merchantResult?.verification_status !== "verified") {
        if (savedType === "collection") setTypeFilter("all");
      }
      
      setLoading(false);
    });
  }, []);

  const handleTypeChange = (value: "all" | "record" | "collection") => {
    if ((merchant?.subscription_plan === "starter" || merchant?.verification_status !== "verified") && value === "collection") return;
    setTypeFilter(value);
    localStorage.setItem("purpledger_invoice_type_filter", value);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isOverdue = (inv: InvoiceWithClient) => {
    if (inv.status === "expired" || inv.status === "overdue") return true;
    if ((inv.status === "open" || inv.status === "partially_paid") && inv.pay_by_date) {
      return new Date(inv.pay_by_date) < today;
    }
    return false;
  };

  const filteredInvoices = invoices.filter((inv) => {
    const matchesType = typeFilter === "all" ? true : (inv.invoice_type === typeFilter || (!inv.invoice_type && typeFilter === "collection"));
    const matchesSearch =
      inv.invoice_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (inv.clients?.full_name || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all"
      ? true
      : statusFilter === "overdue"
        ? isOverdue(inv)
        : inv.status === statusFilter;
    return matchesType && matchesSearch && matchesStatus;
  });

  const totalInvoiced = filteredInvoices.reduce((acc, inv) => acc + Number(inv.grand_total), 0);
  const totalCollected = filteredInvoices.reduce((acc, inv) => acc + Number(inv.amount_paid), 0);
  const totalOutstanding = filteredInvoices.reduce((acc, inv) => acc + Number(inv.outstanding_balance), 0);

  if (loading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold text-purp-900">Invoices</h1></div>
        <Card className="border-2 border-purp-200 shadow-none animate-pulse">
          <CardContent className="p-6"><div className="h-64 bg-purp-50 rounded" /></CardContent>
        </Card>
      </div>
    );
  }

  const isRestricted = merchant?.subscription_plan === "starter" || merchant?.verification_status !== "verified";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Invoices</h1>
          <p className="text-neutral-500 text-sm mt-1">
            {filteredInvoices.length} invoices found · {filteredInvoices.filter(i => !isOverdue(i) && (i.status === "open" || i.status === "partially_paid")).length} active
            {filteredInvoices.filter(isOverdue).length > 0 && (
              <span className="ml-2 text-amber-600 font-semibold">· {filteredInvoices.filter(isOverdue).length} overdue</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/invoices/bulk">
            <Button variant="outline" className="border-2 border-purp-200 text-purp-700 font-semibold bg-white hover:bg-purp-50">
              Bulk Upload
            </Button>
          </Link>
          <Link href="/invoices/create">
            <Button className="bg-purp-900 hover:bg-purp-700 text-white font-semibold">
              <Plus className="mr-2 h-4 w-4" /> New Invoice
            </Button>
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-2 border-purp-200 shadow-none bg-white">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-purp-100 flex items-center justify-center border-2 border-purp-200">
              <FileText className="h-6 w-6 text-purp-700" />
            </div>
            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Total Invoiced</p>
              <p className="text-2xl font-bold text-purp-900">{formatNaira(totalInvoiced)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-2 border-emerald-200 shadow-none bg-white">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center border-2 border-emerald-200">
              <Banknote className="h-6 w-6 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Total Collected</p>
              <p className="text-2xl font-bold text-emerald-700">{formatNaira(totalCollected)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-2 border-amber-200 shadow-none bg-white">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center border-2 border-amber-200">
              <PieChart className="h-6 w-6 text-amber-700" />
            </div>
            <div>
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Outstanding Balance</p>
              <p className="text-2xl font-bold text-amber-700">{formatNaira(totalOutstanding)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col xl:flex-row xl:items-center gap-3">
        {/* Type Toggle */}
        <div className="flex items-center bg-purp-50 border-2 border-purp-200 rounded-lg p-1 shrink-0 overflow-x-auto w-full xl:w-auto">
          <button
            onClick={() => handleTypeChange("all")}
            className={`flex-1 xl:flex-none px-4 py-2 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-2 ${typeFilter === "all" ? "bg-purp-900 text-white shadow-md" : "text-purp-600 hover:text-purp-900"}`}
          >
            <Layers className="h-4 w-4" /> All
          </button>
          <button
            onClick={() => handleTypeChange("record")}
            className={`flex-1 xl:flex-none px-4 py-2 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-2 ${typeFilter === "record" ? "bg-purp-900 text-white shadow-md" : "text-purp-600 hover:text-purp-900"}`}
          >
            <BookOpen className="h-4 w-4" /> Record
          </button>
          <button
            onClick={() => handleTypeChange("collection")}
            disabled={isRestricted}
            className={`flex-1 xl:flex-none px-4 py-2 rounded-md text-sm font-semibold transition-all flex items-center justify-center gap-2 relative ${typeFilter === "collection" ? "bg-purp-900 text-white shadow-md" : "text-purp-600 hover:text-purp-900"} ${isRestricted ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <CreditCard className="h-4 w-4" /> Collection
            {merchant?.subscription_plan === "starter" ? (
              <span className="absolute -top-2 -right-2 bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-amber-300 z-10">PRO</span>
            ) : merchant?.verification_status !== "verified" ? (
              <span className="absolute -top-2 -right-2 bg-amber-100 text-amber-800 text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-amber-300 z-10">KYC</span>
            ) : null}
          </button>
        </div>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <Input
            placeholder="Search invoice # or client name..."
            className="pl-10 border-2 border-purp-200 bg-white focus:border-purp-700 h-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>


        <div className="relative shrink-0 w-full xl:w-52">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500 pointer-events-none z-10" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full h-10 pl-9 pr-4 border-2 border-purp-200 bg-white rounded-lg text-sm text-neutral-700 font-medium appearance-none focus:outline-none focus:border-purp-500 cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="partially_paid">Partially Paid</option>
            <option value="overdue">⚠ Overdue / Expired</option>
            <option value="closed">Closed</option>
            <option value="manually_closed">Manually Closed</option>
            <option value="void">Void</option>
          </select>
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>

      </div>

      {/* Type Info Note */}
      {typeFilter === "record" && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 rounded-lg flex items-start gap-2">
          <BookOpen className="h-4 w-4 mt-0.5 shrink-0" />
          <p><strong>Record Invoices:</strong> For offline bookkeeping only. These invoices do not generate a live payment portal.</p>
        </div>
      )}
      {typeFilter === "collection" && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm p-3 rounded-lg flex items-start gap-2">
          <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
          <p><strong>Collection Invoices:</strong> Live invoices that include a secure Paystack payment portal for your clients to pay online.</p>
        </div>
      )}

      {/* Unified Invoice Table */}
      <Card className="border-2 border-purp-200 shadow-none">
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-purp-50 border-b-2 border-purp-200 hover:bg-purp-50">
                <TableHead className="font-bold text-purp-900 text-xs uppercase">Invoice #</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase">Type</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase">Client</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase">Status</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase text-right">Grand Total</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase text-right">Paid</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase text-right">Outstanding</TableHead>
                <TableHead className="font-bold text-purp-900 text-xs uppercase">Due Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvoices.map((inv) => {
                const isRecord = inv.invoice_type === "record";
                return (
                  <TableRow key={inv.id} className="border-b border-purp-200 hover:bg-purp-50 cursor-pointer">
                    <TableCell>
                      <Link href={`/invoices/${inv.id}`} className="font-mono font-semibold text-purp-700 hover:text-purp-900 text-sm">
                        {inv.invoice_number}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`border text-[10px] font-bold ${isRecord ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                        {isRecord ? <BookOpen className="mr-1 h-3 w-3 inline-block" /> : <CreditCard className="mr-1 h-3 w-3 inline-block" />}
                        {isRecord ? "Record" : "Collection"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>
                        <p className="font-medium">{inv.clients?.full_name || "Unknown"}</p>
                        <p className="text-xs text-neutral-500">{inv.clients?.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`${getStatusColor(inv.status)} border-2 font-semibold text-xs`}>
                        {getStatusLabel(inv.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-sm">{formatNaira(Number(inv.grand_total))}</TableCell>
                    <TableCell className="text-right text-sm text-emerald-600 font-medium">{formatNaira(Number(inv.amount_paid))}</TableCell>
                    <TableCell className="text-right text-sm text-amber-600 font-medium">{formatNaira(Number(inv.outstanding_balance))}</TableCell>
                    <TableCell className="text-sm text-neutral-500">
                      {inv.pay_by_date ? new Date(inv.pay_by_date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filteredInvoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-16">
                    <div className="flex flex-col items-center justify-center text-neutral-500">
                      <div className="w-16 h-16 bg-purp-50 border-2 border-purp-200 rounded-full flex items-center justify-center mb-4">
                        <Search className="h-6 w-6 text-purp-400" />
                      </div>
                      <p className="text-lg font-bold text-purp-900">No invoices found</p>
                      <p className="text-sm mt-1 max-w-sm">
                        {invoices.length === 0 
                          ? "You haven't created any invoices yet. Click 'New Invoice' to get started." 
                          : "Try adjusting your filters or search query to find what you're looking for."}
                      </p>
                      {invoices.length > 0 && (
                        <Button 
                          variant="outline" 
                          onClick={() => { setSearchQuery(""); setStatusFilter("all"); setTypeFilter("all"); }}
                          className="mt-4 border-2 border-purp-200 text-purp-700"
                        >
                          Clear Filters
                        </Button>
                      )}
                    </div>
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
