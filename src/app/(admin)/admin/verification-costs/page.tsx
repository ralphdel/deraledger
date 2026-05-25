"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Banknote, RefreshCw, BarChart2, TrendingUp, Users,
  AlertTriangle, DollarSign, Calendar
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface CostSummary {
  totalRequests: number;
  successfulVerifications: number;
  failedVerifications: number;
  duplicatesPrevented: number;
  totalCostNaira: number;
  sandboxRequests: number;
}

interface CostByProvider {
  provider: string;
  totalCost: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
}

interface CostByMerchant {
  merchantId: string;
  merchantName: string;
  totalCost: number;
  requestCount: number;
}

interface CostByPeriod {
  period: string;
  totalCost: number;
  requestCount: number;
}

interface CostSpike {
  spikeDetected: boolean;
  last24hCost: number;
  sevenDayAvgCost: number;
  multiplier: number;
}

export default function VerificationCostsPage() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [byProvider, setByProvider] = useState<CostByProvider[]>([]);
  const [byMerchant, setByMerchant] = useState<CostByMerchant[]>([]);
  const [byPeriod, setByPeriod] = useState<CostByPeriod[]>([]);
  const [spike, setSpike] = useState<CostSpike | null>(null);
  const [loading, setLoading] = useState(true);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");

  const loadCosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("granularity", granularity);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());

      const res = await fetch(`/api/admin/verification-costs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary || null);
        setByProvider(data.byProvider || []);
        setByMerchant(data.byMerchant || []);
        setByPeriod(data.byPeriod || []);
        setSpike(data.spike || null);
      }
    } catch (err) {
      console.error("Failed to load costs", err);
    } finally {
      setLoading(false);
    }
  }, [granularity, from, to]);

  useEffect(() => {
    loadCosts();
  }, [loadCosts]);

  if (loading && summary === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
        <RefreshCw className="h-8 w-8 text-[#7B2FF7] animate-spin" />
        <span className="text-sm text-neutral-500 font-medium">Loading cost insights...</span>
      </div>
    );
  }

  // Calculate percentages/maxes for CSS bar graphs
  const maxProviderCost = Math.max(...byProvider.map((p) => p.totalCost), 1);
  const maxPeriodCost = Math.max(...byPeriod.map((p) => p.totalCost), 1);

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
            <Banknote className="h-6 w-6 text-[#7B2FF7]" />
            KYC Financial & Cost Monitor
          </h1>
          <p className="text-neutral-500 text-xs mt-1">
            Track and aggregate overall naira expenses spent on KYC BVN face match and CAC lookup APIs.
          </p>
        </div>
        <Button onClick={loadCosts} variant="outline" size="sm" className="gap-2 shrink-0">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Financials
        </Button>
      </div>

      {/* Cost Spike Alert Banner */}
      {spike?.spikeDetected && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-xs text-red-900 flex items-start gap-3 max-w-4xl shadow-sm animate-pulse">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <strong className="font-extrabold text-sm block">CRITICAL WARNING: Anomalous Spend Spike Detected!</strong>
            <p className="mt-1 leading-relaxed">
              Spend in the last 24 hours has reached <span className="font-bold">₦{spike.last24hCost.toLocaleString()}</span>, which exceeds your 7-day average daily cost of <span className="font-bold">₦{spike.sevenDayAvgCost.toFixed(2)}</span> by <span className="font-extrabold text-red-700">{spike.multiplier}x</span>! This could indicate a credential breach, brute forcing attempt, or developer abuse.
            </p>
          </div>
        </div>
      )}

      {/* Filters Card */}
      <Card className="border shadow-none bg-white">
        <CardContent className="p-4 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Granularity:</span>
            <select
              value={granularity}
              onChange={(e: any) => setGranularity(e.target.value)}
              className="text-xs rounded-lg border border-neutral-200 p-2 bg-white font-medium"
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">From:</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="text-xs rounded-lg border border-neutral-200 p-1.5 bg-white font-medium"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">To:</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="text-xs rounded-lg border border-neutral-200 p-1.5 bg-white font-medium"
            />
          </div>

          <Button onClick={loadCosts} variant="outline" size="xs" className="ml-auto bg-neutral-900 text-white hover:bg-neutral-800 text-[11px] font-bold py-2 border-0 shadow-sm px-3 rounded-lg">
            Apply Filters
          </Button>
        </CardContent>
      </Card>

      {/* Summary grid cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border shadow-sm bg-white overflow-hidden relative">
          <CardContent className="p-4 space-y-1">
            <span className="text-[10px] text-neutral-500 font-bold block uppercase tracking-wider">Total Naira Spent</span>
            <span className="text-2xl font-black text-neutral-900">₦{summary?.totalCostNaira.toLocaleString() || 0}</span>
            <Badge className="bg-purple-100 text-[#7B2FF7] border-0 text-[10px] py-0.5 px-1.5 font-bold tracking-wide">
              {summary?.sandboxRequests} sandbox calls excluded
            </Badge>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-white overflow-hidden relative">
          <CardContent className="p-4 space-y-1">
            <span className="text-[10px] text-neutral-500 font-bold block uppercase tracking-wider">Total API Requests</span>
            <span className="text-2xl font-black text-neutral-900">{summary?.totalRequests.toLocaleString() || 0}</span>
            <span className="text-[10px] text-neutral-400 block font-medium">Includes failovers & retries</span>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-white overflow-hidden relative">
          <CardContent className="p-4 space-y-1">
            <span className="text-[10px] text-neutral-500 font-bold block uppercase tracking-wider">Verified Rates</span>
            <span className="text-2xl font-black text-emerald-600">
              {summary && summary.totalRequests > 0
                ? ((summary.successfulVerifications / summary.totalRequests) * 100).toFixed(1)
                : 0}%
            </span>
            <span className="text-[10px] text-neutral-400 block font-medium">Success count: {summary?.successfulVerifications}</span>
          </CardContent>
        </Card>

        <Card className="border shadow-sm bg-white overflow-hidden relative">
          <CardContent className="p-4 space-y-1">
            <span className="text-[10px] text-neutral-500 font-bold block uppercase tracking-wider">Duplicates Prevented</span>
            <span className="text-2xl font-black text-blue-600">{summary?.duplicatesPrevented || 0}</span>
            <Badge className="bg-blue-50 text-blue-700 border-0 text-[9px] py-0.5 px-1.5 font-bold">
              ₦0 caching tier saved
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Visual Aggregations charts using Premium CSS/SVG */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost by provider card */}
        <Card className="border shadow-sm bg-white">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-bold text-neutral-900 flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-[#7B2FF7]" />
              Expenses by Provider Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {byProvider.length === 0 ? (
              <div className="text-center text-xs text-neutral-400 p-6">No historical costs recorded by provider.</div>
            ) : (
              byProvider.map((p) => {
                const percent = (p.totalCost / maxProviderCost) * 100;
                return (
                  <div key={p.provider} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-neutral-900">{p.provider}</span>
                      <span className="font-extrabold text-neutral-950">₦{p.totalCost.toLocaleString()} <span className="text-neutral-400 font-normal">({p.requestCount} calls)</span></span>
                    </div>
                    {/* Visual Bar representation */}
                    <div className="w-full h-3.5 bg-neutral-100 rounded-full overflow-hidden shadow-inner border border-neutral-200/50">
                      <div
                        style={{ width: `${percent}%` }}
                        className="h-full bg-gradient-to-r from-[#7B2FF7] to-[#9B4FFF] rounded-full transition-all duration-500 shadow-sm"
                      />
                    </div>
                    <div className="flex gap-3 text-[10px] text-neutral-400 font-semibold">
                      <span>Success rate: {p.requestCount > 0 ? ((p.successCount / p.requestCount) * 100).toFixed(0) : 0}%</span>
                      <span>•</span>
                      <span>Failures: {p.failureCount}</span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Cost over time card */}
        <Card className="border shadow-sm bg-white">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-bold text-neutral-900 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#7B2FF7]" />
              Spend Over Time ({granularity === "day" ? "Daily" : granularity === "week" ? "Weekly" : "Monthly"})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {byPeriod.length === 0 ? (
              <div className="text-center text-xs text-neutral-400 p-6">No historical costs recorded in selected period.</div>
            ) : (
              <div className="space-y-3">
                {byPeriod.slice(-7).map((p) => {
                  const percent = (p.totalCost / maxPeriodCost) * 100;
                  return (
                    <div key={p.period} className="flex items-center gap-3 text-xs">
                      <span className="w-20 font-bold text-neutral-600 font-mono text-[11px] shrink-0">{p.period}</span>
                      {/* Horizonal Chart bar */}
                      <div className="flex-1 h-3.5 bg-neutral-100 rounded-full overflow-hidden shadow-inner border border-neutral-200/50">
                        <div
                          style={{ width: `${percent}%` }}
                          className="h-full bg-gradient-to-r from-emerald-500 to-[#7B2FF7] rounded-full transition-all duration-500"
                        />
                      </div>
                      <span className="w-20 font-black text-neutral-950 text-right shrink-0 font-mono">₦{p.totalCost.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top 10 merchants by cost table */}
      <Card className="border shadow-sm bg-white overflow-hidden">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base font-bold text-neutral-900 flex items-center gap-2">
            <Users className="h-4 w-4 text-[#7B2FF7]" />
            Top 10 Merchants by KYC Naira Cost
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {byMerchant.length === 0 ? (
            <div className="p-6 text-center text-xs text-neutral-400">
              No merchant costs aggregated for current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-neutral-50 border-b">
                  <tr>
                    <th className="p-3 font-semibold text-neutral-500">Merchant Business Name</th>
                    <th className="p-3 font-semibold text-neutral-500">Merchant Profile ID</th>
                    <th className="p-3 font-semibold text-neutral-500">Requests Logged</th>
                    <th className="p-3 text-right font-semibold text-neutral-500">Accumulated Cost (₦)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {byMerchant.map((m) => (
                    <tr key={m.merchantId} className="hover:bg-neutral-50/50 transition-colors">
                      <td className="p-3 font-bold text-neutral-900">{m.merchantName}</td>
                      <td className="p-3 font-mono text-[10px] text-neutral-400">{m.merchantId}</td>
                      <td className="p-3 font-semibold text-neutral-700">{m.requestCount.toLocaleString()} calls</td>
                      <td className="p-3 text-right font-black text-neutral-900 text-sm">
                        ₦{m.totalCost.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
