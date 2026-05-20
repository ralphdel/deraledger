"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { 
  ShieldAlert, ShieldCheck, Clock, Search, Filter, ArrowRight,
  Bitcoin, CreditCard, Landmark, Wallet, AlertOctagon, UserCheck, ShieldClose
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Global dispute seeds with Admin metadata (risk score, assigned agent, SLA timers)
const MOCK_ADMIN_DISPUTES = [
  {
    id: "dsp-4091-a83",
    reference: "DSP_9018274",
    merchant_name: "Tech-Forge Ltd",
    customer_email: "tunde@company.ng",
    payment_rail: "BANK_TRANSFER",
    category: "Failed Payment",
    amount: 150000,
    status: "OPEN",
    priority: "HIGH",
    sla_time: "4h remaining",
    sla_breach: false,
    risk_score: 32, // out of 100
    assigned_admin: "Agent Fatima",
    created_at: "2026-05-20T10:30:00Z"
  },
  {
    id: "dsp-1120-x92",
    reference: "DSP_8810231",
    merchant_name: "Apex Retailers Ltd",
    customer_email: "chioma.ezekiel@gmail.com",
    payment_rail: "BREET_CRYPTO",
    category: "Crypto Payment Not Credited",
    amount: 850000,
    status: "REVIEWING",
    priority: "CRITICAL",
    sla_time: "12m remaining",
    sla_breach: false,
    risk_score: 68,
    assigned_admin: "Agent Jude",
    created_at: "2026-05-20T14:45:00Z"
  },
  {
    id: "dsp-9081-k33",
    reference: "DSP_5671029",
    merchant_name: "Deca Builders",
    customer_email: "accounts@vanguard-tech.io",
    payment_rail: "CARD",
    category: "Duplicate Charge",
    amount: 45000,
    status: "RESOLVED",
    priority: "MEDIUM",
    sla_time: "Resolved",
    sla_breach: false,
    risk_score: 12,
    assigned_admin: "Agent Fatima",
    created_at: "2026-05-18T09:15:00Z"
  },
  {
    id: "dsp-5541-p08",
    reference: "DSP_4410928",
    merchant_name: "Nexa Innovations",
    customer_email: "collins.j@ventures.co",
    payment_rail: "WALLET",
    category: "Delayed Confirmation",
    amount: 120000,
    status: "ESCALATED",
    priority: "HIGH",
    sla_time: "Overdue 12h",
    sla_breach: true,
    risk_score: 85, // High risk
    assigned_admin: "Unassigned",
    created_at: "2026-05-19T11:00:00Z"
  }
];

export default function AdminDisputeQueue() {
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("ALL");

  const filteredDisputes = useMemo(() => {
    return MOCK_ADMIN_DISPUTES.filter(d => {
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
  }, [search, selectedFilter]);

  const stats = useMemo(() => {
    const total = MOCK_ADMIN_DISPUTES.length;
    const open = MOCK_ADMIN_DISPUTES.filter(d => d.status !== "RESOLVED").length;
    const overdue = MOCK_ADMIN_DISPUTES.filter(d => d.sla_breach).length;
    const highRisk = MOCK_ADMIN_DISPUTES.filter(d => d.risk_score >= 60).length;
    return { total, open, overdue, highRisk };
  }, []);

  const formatNaira = (amt: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Risk &amp; Dispute Operations Center</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Global administrative terminal for DeraLedger invoice disputes, Breet API monitoring, and fraud scoring logs.
        </p>
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
                  <th className="px-6 py-4">Agent</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filteredDisputes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                      No active global disputes match the criteria.
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
                        <td className="px-6 py-4 text-xs font-semibold text-neutral-600">
                          {dis.assigned_admin}
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
