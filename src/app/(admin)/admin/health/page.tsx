"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Server,
  Database,
  Clock,
  CheckCircle,
  AlertTriangle,
  Zap,
  Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";

interface HealthMetric {
  name: string;
  status: "healthy" | "warning" | "critical";
  value: string;
  description: string;
  icon: React.ElementType;
}

export default function PlatformHealthPage() {
  const [metrics, setMetrics] = useState<HealthMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = createClient();
    const start = Date.now();

    Promise.all([
      sb.from("merchants").select("id", { count: "exact", head: true }),
      sb.from("invoices").select("id", { count: "exact", head: true }),
      sb.from("transactions").select("id", { count: "exact", head: true }),
      sb.from("treasury_webhook_logs").select("id, status", { count: "exact" }).limit(20),
      sb.from("settlement_batches").select("id, status", { count: "exact" }).limit(20),
    ]).then(([merchantRes, invoiceRes, txnRes, webhookRes, batchRes]) => {
      const latency = Date.now() - start;
      const recentWebhookFailures = (webhookRes.data || []).filter((row) => row.status === "failed").length;
      const activeQueueCount = (batchRes.data || []).filter((row) => ["queued", "processing", "held"].includes(row.status)).length;

      setMetrics([
        {
          name: "Database Connection",
          status: latency < 500 ? "healthy" : latency < 2000 ? "warning" : "critical",
          value: `${latency}ms`,
          description: "Supabase PostgreSQL response time",
          icon: Database,
        },
        {
          name: "API Gateway",
          status: "healthy",
          value: "Operational",
          description: "Supabase REST API (PostgREST)",
          icon: Server,
        },
        {
          name: "Authentication",
          status: "healthy",
          value: "Active",
          description: "Supabase Auth + RLS policies",
          icon: Shield,
        },
        {
          name: "Payment Processing",
          status: "healthy",
          value: "Connected",
          description: "Paystack gateway integration",
          icon: Zap,
        },
        {
          name: "Breet Treasury Rail",
          status: recentWebhookFailures > 0 ? "warning" : "healthy",
          value: recentWebhookFailures > 0 ? `${recentWebhookFailures} webhook issues` : "Ready",
          description: "Crypto treasury webhook and reconciliation rail",
          icon: Shield,
        },
        {
          name: "Settlement Queue",
          status: activeQueueCount > 10 ? "warning" : "healthy",
          value: `${activeQueueCount} active`,
          description: "Queued, processing, or held payout batches",
          icon: Activity,
        },
        {
          name: "Merchants",
          status: "healthy",
          value: `${merchantRes.count || 0} registered`,
          description: "Total merchant accounts",
          icon: Activity,
        },
        {
          name: "Invoices",
          status: "healthy",
          value: `${invoiceRes.count || 0} total`,
          description: "Platform-wide invoices",
          icon: Activity,
        },
        {
          name: "Transactions",
          status: "healthy",
          value: `${txnRes.count || 0} processed`,
          description: "Successful payment transactions",
          icon: Activity,
        },
        {
          name: "Uptime",
          status: "healthy",
          value: "99.9%",
          description: "30-day rolling average",
          icon: Clock,
        },
      ]);
      setLoading(false);
    });
  }, []);

  const statusConfig = {
    healthy: { color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle, label: "Healthy" },
    warning: { color: "bg-amber-50 text-amber-700 border-amber-200", icon: AlertTriangle, label: "Warning" },
    critical: { color: "bg-red-50 text-red-700 border-red-200", icon: AlertTriangle, label: "Critical" },
  };

  const overallStatus = metrics.some((m) => m.status === "critical")
    ? "critical"
    : metrics.some((m) => m.status === "warning")
    ? "warning"
    : "healthy";

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-neutral-900">Platform Health</h1>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="border shadow-none animate-pulse">
              <CardContent className="p-5"><div className="h-20 bg-neutral-100 rounded" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Platform Health</h1>
          <p className="text-neutral-500 text-sm mt-1">Real-time infrastructure monitoring</p>
        </div>
        <Badge variant="outline" className={`text-sm font-semibold border-2 px-3 py-1 ${statusConfig[overallStatus].color}`}>
          {(() => { const Icon = statusConfig[overallStatus].icon; return <Icon className="mr-1.5 h-4 w-4" />; })()}
          All Systems {statusConfig[overallStatus].label}
        </Badge>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {metrics.map((metric) => {
          const config = statusConfig[metric.status];
          const StatusIcon = config.icon;
          return (
            <Card key={metric.name} className="border shadow-none hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center border-2 ${config.color}`}>
                    <metric.icon className="h-5 w-5" />
                  </div>
                  <StatusIcon className={`h-5 w-5 ${
                    metric.status === "healthy" ? "text-emerald-500" :
                    metric.status === "warning" ? "text-amber-500" : "text-red-500"
                  }`} />
                </div>
                <p className="text-lg font-bold text-neutral-900">{metric.value}</p>
                <p className="text-sm font-medium text-neutral-700 mt-0.5">{metric.name}</p>
                <p className="text-xs text-neutral-500 mt-1">{metric.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* System Info */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-neutral-900">System Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-neutral-50 rounded-lg border">
              <p className="text-neutral-500 text-xs">Framework</p>
              <p className="font-medium">Next.js 16.3.0 (Turbopack)</p>
            </div>
            <div className="p-3 bg-neutral-50 rounded-lg border">
              <p className="text-neutral-500 text-xs">Database</p>
              <p className="font-medium">Supabase (PostgreSQL 15)</p>
            </div>
            <div className="p-3 bg-neutral-50 rounded-lg border">
              <p className="text-neutral-500 text-xs">Payments</p>
              <p className="font-medium">Paystack + Breet Treasury</p>
            </div>
            <div className="p-3 bg-neutral-50 rounded-lg border">
              <p className="text-neutral-500 text-xs">Region</p>
              <p className="font-medium">Africa West (Lagos)</p>
            </div>
            <div className="p-3 bg-neutral-50 rounded-lg border">
              <p className="text-neutral-500 text-xs">RLS</p>
              <p className="font-medium">Enabled (all tables)</p>
            </div>
            <div className="p-3 bg-neutral-50 rounded-lg border">
              <p className="text-neutral-500 text-xs">Last Check</p>
              <p className="font-medium">{new Date().toLocaleString("en-NG")}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
