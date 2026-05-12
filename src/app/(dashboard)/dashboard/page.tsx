"use client";

import { useEffect, useState } from "react";
import {
  FileText,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Receipt,
  Clock,
  CheckCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { getDashboardStats, getMerchant, getMonthlyCollectionTotal } from "@/lib/data";
import { formatNaira } from "@/lib/calculations";
import type { Merchant } from "@/lib/types";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface DashboardData {
  totalInvoiced: number;
  totalCollected: number;
  totalOutstanding: number;
  overdueCount: number;
  paymentMethodData: { method: string; value: number; fill: string }[];
  agingData: { bucket: string; amount: number }[];
  monthlyData: { month: string; invoiced: number; collected: number }[];
  recentActivity: { id: string; type: string; description: string; time: string; icon: string }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardData | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [monthlyCollected, setMonthlyCollected] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();
    Promise.all([
      getDashboardStats(), 
      getMerchant(), 
      getMonthlyCollectionTotal(),
      sb.auth.getUser()
    ]).then(([dashData, merchantData, collected, { data: { user } }]) => {
      setStats(dashData);
      setMerchant(merchantData);
      setMonthlyCollected(collected);
      if (user) {
        setUserName(user.user_metadata?.full_name || null);
      }
      setLoading(false);
    });
  }, []);

  if (loading || !stats) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Dashboard</h1>
          <p className="text-neutral-500 text-sm mt-1">Loading your financial overview...</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border-2 border-purp-200 shadow-none animate-pulse">
              <CardContent className="p-5">
                <div className="h-10 w-10 bg-purp-100 rounded-lg mb-3" />
                <div className="h-8 bg-purp-100 rounded w-2/3 mb-2" />
                <div className="h-4 bg-purp-50 rounded w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const kpis = [
    {
      title: "Total Invoiced",
      value: formatNaira(stats.totalInvoiced),
      change: "+12.5%",
      trend: "up" as const,
      icon: FileText,
      description: "total to date",
    },
    {
      title: "Total Collected",
      value: formatNaira(stats.totalCollected),
      change: "+8.2%",
      trend: "up" as const,
      icon: DollarSign,
      description: "total to date",
    },
    {
      title: "Outstanding",
      value: formatNaira(stats.totalOutstanding),
      change: "-3.1%",
      trend: "down" as const,
      icon: TrendingUp,
      description: "across open invoices",
    },
    {
      title: "Overdue Invoices",
      value: stats.overdueCount.toString(),
      change: stats.overdueCount > 0 ? `+${stats.overdueCount}` : "0",
      trend: "up" as const,
      icon: AlertTriangle,
      description: "past pay-by date",
    },
  ];

  const activityIcons: Record<string, React.ElementType> = {
    receipt: Receipt,
    file: FileText,
    check: CheckCircle,
    clock: Clock,
  };

  const effectiveTier = merchant?.subscription_plan || merchant?.merchant_tier || "starter";
  const isStarter = effectiveTier === "starter";
  const limitExceeded = isStarter || (merchant?.monthly_collection_limit ? monthlyCollected >= merchant.monthly_collection_limit : false);
  const needsProfileUpdate = merchant && (merchant.platform_version === undefined || merchant.platform_version === null || merchant.platform_version < 1);

  return (
    <div className="space-y-6">
      {limitExceeded && (
        <div className="bg-red-600 text-white py-2 overflow-hidden relative">
          <div className="whitespace-nowrap inline-block animate-marquee font-bold text-sm">
            {isStarter
              ? "🚨 ATTENTION: You are on the Starter Tier. Payment links are currently inactive. Please upgrade your tier to start receiving live payments! 🚨"
              : "🚨 ATTENTION: You have reached your monthly collection limit. Your payment links are currently inactive. Please upgrade your tier to continue receiving payments. 🚨"}
          </div>
        </div>
      )}

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-purp-900">
          {userName ? `Welcome, ${userName}` : "Dashboard"}
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Here&apos;s your financial overview.
        </p>
      </div>

      {/* Platform Update Banner */}
      {needsProfileUpdate && (
        <Card className="border-2 border-blue-300 bg-blue-50/50 shadow-none">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-blue-100 border-2 border-blue-200 rounded-lg flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-blue-900">Profile Update Required</p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    We&apos;ve updated Deraledger! Please go to Settings to update your Trading Name{effectiveTier !== "starter" ? " and Owner's Name" : ""} for a smoother experience.
                  </p>
                </div>
              </div>
              <Link href="/settings">
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold whitespace-nowrap">
                  Go to Settings
                  <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Verification Banner */}
      {merchant && merchant.verification_status !== "verified" && merchant.subscription_plan !== "starter" && (
        <Card className={`border-2 shadow-none ${
          merchant.verification_status === "pending"
            ? "border-amber-300 bg-amber-50/50"
            : "border-purp-300 bg-gradient-to-r from-purp-50 to-purp-100/50"
        }`}>
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                {merchant.verification_status === "pending" ? (
                  <div className="w-10 h-10 bg-amber-100 border-2 border-amber-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Clock className="h-5 w-5 text-amber-600" />
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-purp-100 border-2 border-purp-200 rounded-lg flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="h-5 w-5 text-purp-700" />
                  </div>
                )}
                <div>
                  <p className="font-semibold text-sm text-purp-900">
                    {merchant.verification_status === "pending"
                      ? "Verification Under Review"
                      : "Complete Your Account Verification"}
                  </p>
                  <p className="text-xs text-neutral-600 mt-0.5">
                    {merchant.verification_status === "pending"
                      ? "Your documents are being reviewed by a platform admin. You'll be notified when approved."
                      : "Verify your business to unlock higher collection limits and full platform features."}
                  </p>
                </div>
              </div>
              {merchant.verification_status !== "pending" && (
                <Link href="/settings">
                  <Button size="sm" className="bg-purp-900 hover:bg-purp-700 text-white font-semibold whitespace-nowrap">
                    Verify Now
                    <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title} className="border-2 border-purp-200 shadow-none">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-purp-100 border-2 border-purp-200 rounded-lg flex items-center justify-center">
                  <kpi.icon className="h-5 w-5 text-purp-700" />
                </div>
                <span
                  title={`${kpi.trend === "up" ? "Increased" : "Decreased"} by ${kpi.change} from previous period`}
                  className={`flex items-center justify-center w-6 h-6 rounded-full border cursor-help ${
                    kpi.title === "Overdue Invoices"
                      ? "text-red-600 bg-red-50 border-red-200"
                      : kpi.trend === "up"
                      ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                      : "text-amber-600 bg-amber-50 border-amber-200"
                  }`}
                >
                  {kpi.trend === "up" ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-neutral-600 mb-1">{kpi.title}</h3>
              <p className="text-2xl font-bold text-purp-900">{kpi.value}</p>
              <p className="text-xs text-neutral-500 mt-1">{kpi.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Collection vs Inflow Line Chart */}
        <Card className="border-2 border-purp-200 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-purp-900">
              Collection vs. Inflow
            </CardTitle>
            <p className="text-xs text-neutral-500">
              Total invoiced vs. actual cash collected (6 months)
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EDE9FE" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={{ stroke: "#C4B5FD" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={{ stroke: "#C4B5FD" }} tickFormatter={(v) => `₦${(v / 1000000).toFixed(1)}M`} />
                  <Tooltip formatter={(value) => formatNaira(Number(value))} contentStyle={{ border: "2px solid #C4B5FD", borderRadius: "8px", fontSize: "12px" }} />
                  <Line type="monotone" dataKey="invoiced" stroke="#2D1B6B" strokeWidth={2} dot={{ fill: "#2D1B6B", r: 4 }} name="Invoiced" />
                  <Line type="monotone" dataKey="collected" stroke="#7B2FBE" strokeWidth={2} dot={{ fill: "#7B2FBE", r: 4 }} name="Collected" />
                  <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Aging Report Bar Chart */}
        <Card className="border-2 border-purp-200 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-purp-900">Outstanding Invoices</CardTitle>
            <p className="text-xs text-neutral-500">Outstanding balances by age bucket</p>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.agingData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EDE9FE" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={{ stroke: "#C4B5FD" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={{ stroke: "#C4B5FD" }} tickFormatter={(v) => `₦${(v / 1000000).toFixed(1)}M`} />
                  <Tooltip formatter={(value) => formatNaira(Number(value))} contentStyle={{ border: "2px solid #C4B5FD", borderRadius: "8px", fontSize: "12px" }} />
                  <Bar dataKey="amount" fill="#2D1B6B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Payment Method Breakdown */}
        <Card className="border-2 border-purp-200 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-purp-900">Payment Methods</CardTitle>
            <p className="text-xs text-neutral-500">Distribution of collections</p>
          </CardHeader>
          <CardContent>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.paymentMethodData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" nameKey="method" strokeWidth={2} stroke="#fff">
                    {stats.paymentMethodData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: "12px" }} formatter={(value) => <span className="text-neutral-900">{value}</span>} />
                  <Tooltip formatter={(value) => `${value}%`} contentStyle={{ border: "2px solid #C4B5FD", borderRadius: "8px", fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="lg:col-span-2 border-2 border-purp-200 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-purp-900">Recent Activity</CardTitle>
            <p className="text-xs text-neutral-500">Latest payment events</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.recentActivity.length === 0 ? (
                <p className="text-center text-neutral-500 py-8 text-sm">No recent activity yet.</p>
              ) : (
                stats.recentActivity.map((activity) => {
                  const IconComponent = activityIcons[activity.icon] || FileText;
                  return (
                    <div key={activity.id} className="flex items-start gap-3 p-3 bg-purp-50 border border-purp-200 rounded-lg">
                      <div className="w-8 h-8 bg-purp-100 border border-purp-200 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5">
                        <IconComponent className="h-4 w-4 text-purp-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-neutral-900">{activity.description}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">{activity.time}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
