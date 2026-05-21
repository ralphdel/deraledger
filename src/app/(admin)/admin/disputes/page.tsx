"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { 
  ShieldAlert, ShieldCheck, Clock, Search, Filter, ArrowRight,
  Bitcoin, CreditCard, Landmark, Wallet, AlertOctagon, UserCheck, RefreshCw
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminFetchAllDisputesAction } from "@/lib/actions";

export default function AdminDisputeQueue() {
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("ALL");
  const [disputesList, setDisputesList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAllDisputes() {
    setLoading(true);
    try {
      const res = await adminFetchAllDisputesAction();
      if (res.success && res.migrated) {
        const mapped = (res.disputes || []).map((d: any) => ({
          id: d.id,
          reference: d.case_id,
          merchant_name: d.merchants?.business_name || "Merchant Partner",
          customer_email: d.customer_email,
          payment_rail: d.payment_rail,
          category: d.category,
          amount: Number(d.amount),
          status: d.status,
          priority: d.risk_score >= 60 ? "CRITICAL" : d.risk_score >= 40 ? "HIGH" : "MEDIUM",
          sla_time: d.status === "RESOLVED" || d.status === "COMPLETED" ? "Resolved" : "SLA Active (12h)",
          sla_breach: d.risk_score >= 80,
          risk_score: d.risk_score,
          created_at: d.created_at
        }));
        setDisputesList(mapped);
      } else {
        // DB tables not yet provisioned — show empty state
        setDisputesList([]);
      }
    } catch (err) {
      console.error("Failed loading global disputes:", err);
      setDisputesList([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAllDisputes();
  }, []);

  const filteredDisputes = useMemo(() => {
    return disputesList.filter(d => {
      const matchesSearch = d.reference.toLowerCase().includes(search.toLowerCase()) ||
                            d.merchant_name.toLowerCase().includes(search.toLowerCase()) ||
                            d.customer_email.toLowerCase().includes(search.toLowerCase()) ||
                            d.category.toLowerCase().includes(search.toLowerCase());
      
      if (selectedFilter === "ALL") return matchesSearch;
      if (selectedFilter === "CRYPTO") return matchesSearch && d.payment_rail === "BREET_CRYPTO";
      if (selectedFilter === "OVERDUE") return matchesSearch && d.sla_breach;
      if (selectedFilter === "HIGH_RISK") return matchesSearch && d.risk_score >= 60;
      if (selectedFilter === "ESCALATED") return matchesSearch && d.status === "ESCALATED";
      return matchesSearch && d.status === selectedFilter;
    });
  }, [search, selectedFilter, disputesList]);

  const stats = useMemo(() => {
    const total = disputesList.length;
    const open = disputesList.filter(d => d.status !== "RESOLVED" && d.status !== "COMPLETED" && d.status !== "REJECTED").length;
    const overdue = disputesList.filter(d => d.sla_breach).length;
    const highRisk = disputesList.filter(d => d.risk_score >= 60).length;
    return { total, open, overdue, highRisk };
  }, [disputesList]);

  const formatNaira = (amt: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Risk &amp; Dispute Operations Center</h1>
          <p className="text-neutral-500 text-sm mt-1">
            Global administrative terminal for DeraLedger invoice disputes, Breet API monitoring, and fraud scoring logs.
          </p>
        </div>
        <Button onClick={loadAllDisputes} disabled={loading} variant="outline" className="border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh Queue
        </Button>
      </div>

      {/* Admin stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Active Disputes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-neutral-900">{stats.open}</span>
              <span className="text-xs text-neutral-500">global queue</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-red-500 uppercase tracking-wider">SLA Breaches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-red-600">{stats.overdue}</span>
              <span className="text-xs text-red-500 font-semibold">requires escalation</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-amber-500 uppercase tracking-wider">High Risk Cases</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-amber-600">{stats.highRisk}</span>
              <span className="text-xs text-neutral-500">score &gt; 60</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Total Handled</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-emerald-600">{stats.total}</span>
              <span className="text-xs text-emerald-500 font-semibold">100% audited</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grid of list filters */}
      <Card className="bg-white border-neutral-200 shadow-sm">
        <CardHeader className="pb-4 border-b border-neutral-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <Input
                type="text"
                placeholder="Search reference, merchant, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-neutral-50 border-neutral-200"
              />
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <Filter className="w-4 h-4 text-neutral-400 mr-1" />
              <select
                value={selectedFilter}
                onChange={(e) => setSelectedFilter(e.target.value)}
                className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
              >
                <option value="ALL">All Global Cases</option>
                <option value="OPEN">Open Queues</option>
                <option value="ESCALATED">Escalated</option>
                <option value="CRYPTO">Crypto Only</option>
                <option value="OVERDUE">SLA Breached</option>
                <option value="HIGH_RISK">High Risk (&gt;60)</option>
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-xs font-bold text-neutral-400 uppercase tracking-wider">
                  <th className="px-6 py-4">Reference</th>
                  <th className="px-6 py-4">Merchant &amp; Customer</th>
                  <th className="px-6 py-4">Dispute Category</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                  <th className="px-6 py-4">Risk Index</th>
                  <th className="px-6 py-4">SLA Count</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                      Loading dispute queue from ledger...
                    </td>
                  </tr>
                ) : filteredDisputes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <ShieldCheck className="w-10 h-10 text-neutral-300" />
                        <p className="font-semibold text-neutral-500">No disputes in the queue</p>
                        <p className="text-xs text-neutral-400">All payment dispute submissions from customers will appear here for review.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredDisputes.map((dis) => {
                    const getRiskColor = (score: number) => {
                      if (score >= 70) return "text-red-600 bg-red-50 border-red-200";
                      if (score >= 40) return "text-amber-600 bg-amber-50 border-amber-200";
                      return "text-emerald-600 bg-emerald-50 border-emerald-200";
                    };

                    const getPriorityStyles = (priority: string) => {
                      switch (priority) {
                        case "CRITICAL": return "text-red-700 font-bold bg-red-100";
                        case "HIGH": return "text-amber-700 font-semibold bg-amber-100";
                        default: return "text-neutral-600 bg-neutral-100";
                      }
                    };

                    const getStatusStyles = (status: string) => {
                      switch (status) {
                        case "RESOLVED": case "COMPLETED": return "bg-emerald-50 text-emerald-700 border-emerald-200";
                        case "REJECTED": return "bg-red-50 text-red-700 border-red-200";
                        case "REVIEWING": return "bg-amber-50 text-amber-700 border-amber-200";
                        default: return "bg-blue-50 text-blue-700 border-blue-200";
                      }
                    };

                    return (
                      <tr key={dis.id} className="hover:bg-neutral-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-mono font-bold text-neutral-900">{dis.reference}</span>
                          <div className="flex gap-1.5 mt-1">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide ${getPriorityStyles(dis.priority)}`}>
                              {dis.priority}
                            </span>
                            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-neutral-100 text-neutral-500 uppercase tracking-wide">
                              {dis.payment_rail}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 space-y-0.5">
                          <div className="font-semibold text-neutral-800">{dis.merchant_name}</div>
                          <div className="text-xs text-neutral-400">{dis.customer_email}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-semibold text-neutral-700">{dis.category}</span>
                        </td>
                        <td className="px-6 py-4 text-right font-bold text-neutral-900">
                          {formatNaira(dis.amount)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-2 py-0.5 border rounded-full text-xs font-semibold ${getRiskColor(dis.risk_score)}`}>
                            {dis.risk_score}/100 Score
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs font-bold ${dis.sla_breach ? "text-red-600" : "text-neutral-500"}`}>
                            {dis.sla_time}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-2 py-0.5 border rounded-full text-xs font-semibold uppercase ${getStatusStyles(dis.status)}`}>
                            {dis.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link href={`/admin/disputes/${dis.id}`}>
                            <Button variant="ghost" className="h-8 w-8 p-0 text-[#6F2CFF] hover:text-[#5B21B6] hover:bg-[#F3E8FF]">
                              <ArrowRight className="w-4 h-4" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
