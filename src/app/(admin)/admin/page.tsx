"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Users,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  ArrowUpRight,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { formatNaira } from "@/lib/calculations";
import type { Merchant, Invoice } from "@/lib/types";

export default function AdminOverviewPage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [transactions, setTransactions] = useState<{ amount_paid: number }[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [recentInvoices, setRecentInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();
    Promise.all([
      sb.from("merchants").select("*").order("created_at", { ascending: false }),
      // GMV = sum of all successful transaction amounts across the platform
      sb.from("transactions").select("amount_paid").eq("status", "success"),
      // Active invoices = open or partially paid across all merchants
      sb.from("invoices").select("id, status").in("status", ["open", "partially_paid"]),
      // Recent activity (last 8 for display)
      sb.from("invoices").select("*").order("created_at", { ascending: false }).limit(8),
    ]).then(([merchantRes, txRes, activeRes, recentRes]) => {
      setMerchants((merchantRes.data || []) as Merchant[]);
      setTransactions((txRes.data || []) as { amount_paid: number }[]);
      setActiveCount((activeRes.data || []).length);
      setRecentInvoices((recentRes.data || []) as Invoice[]);
      setLoading(false);
    });
  }, []);

  const pendingVerifications = merchants.filter((m) => m.verification_status === "pending").length;
  const totalMerchants = merchants.length;
  // GMV = net amount collected via successful transactions (excludes Paystack fees)
  const totalGMV = transactions.reduce((s, t) => s + Number(t.amount_paid), 0);
  const activeInvoices = activeCount;

  const kpis = [
    { title: "Total Merchants", value: totalMerchants.toString(), icon: Users, color: "bg-blue-100 text-blue-700 border-blue-200" },
    { title: "Pending Verifications", value: pendingVerifications.toString(), icon: ShieldCheck, color: "bg-amber-100 text-amber-700 border-amber-200" },
    { title: "Platform GMV", value: formatNaira(totalGMV), icon: DollarSign, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    { title: "Active Invoices", value: activeInvoices.toString(), icon: TrendingUp, color: "bg-purple-100 text-purple-700 border-purple-200" },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-neutral-900">Admin Overview</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border shadow-none animate-pulse">
              <CardContent className="p-5"><div className="h-16 bg-neutral-100 rounded" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Admin Overview</h1>
        <p className="text-neutral-500 text-sm mt-1">Platform-wide metrics and monitoring</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title} className="border shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center border-2 ${kpi.color}`}>
                  <kpi.icon className="h-5 w-5" />
                </div>
              </div>
              <p className="text-2xl font-bold text-neutral-900">{kpi.value}</p>
              <p className="text-xs text-neutral-500 mt-1">{kpi.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Verification Queue Preview */}
        <Card className="border shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold text-neutral-900">Verification Queue</CardTitle>
              <Link href="/admin/verification" className="text-xs font-semibold text-purple-700 hover:underline">View All →</Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {merchants.filter(m => m.verification_status === "pending").length === 0 ? (
                <div className="text-center py-6 text-neutral-500 text-sm">
                  <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-neutral-300" />
                  No pending verifications
                </div>
              ) : (
                merchants.filter(m => m.verification_status === "pending").slice(0, 5).map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div>
                      <p className="font-medium text-sm text-neutral-900">{m.business_name}</p>
                      <p className="text-xs text-neutral-500">{m.email}</p>
                    </div>
                    <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
                      <Clock className="mr-1 h-3 w-3" />Pending
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Merchants */}
        <Card className="border shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold text-neutral-900">Recent Merchants</CardTitle>
              <Link href="/admin/merchants" className="text-xs font-semibold text-purple-700 hover:underline">View All →</Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {merchants.slice(0, 5).map((m) => {
                const statusColors: Record<string, string> = {
                  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
                  pending: "bg-amber-50 text-amber-700 border-amber-200",
                  unverified: "bg-neutral-50 text-neutral-600 border-neutral-200",
                  rejected: "bg-red-50 text-red-700 border-red-200",
                  suspended: "bg-red-50 text-red-700 border-red-200",
                };
                return (
                  <div key={m.id} className="flex items-center justify-between p-3 bg-neutral-50 border border-neutral-200 rounded-lg">
                    <div>
                      <p className="font-medium text-sm text-neutral-900">{m.business_name}</p>
                      <p className="text-xs text-neutral-500">{m.subscription_plan || m.merchant_tier || "starter"} tier · {m.email}</p>
                    </div>
                    <Badge variant="outline" className={`text-xs capitalize ${statusColors[m.verification_status] || ""}`}>
                      {m.verification_status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Ledger Activity */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-neutral-900">Global Ledger Activity</CardTitle>
          <p className="text-xs text-neutral-500">Recent invoices across all merchants</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentInvoices.slice(0, 8).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between p-3 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-purple-100 border border-purple-200 rounded-md flex items-center justify-center">
                    <DollarSign className="h-4 w-4 text-purple-700" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-neutral-900">{inv.invoice_number}</p>
                    <p className="text-xs text-neutral-500">
                      {new Date(inv.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-neutral-900">{formatNaira(Number(inv.grand_total))}</p>
                  <p className="text-xs text-emerald-600">Paid: {formatNaira(Number(inv.amount_paid))}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
