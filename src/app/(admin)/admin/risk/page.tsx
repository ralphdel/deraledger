"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { 
  ShieldAlert, ShieldCheck, AlertOctagon, Users, BarChart3, 
  HelpCircle, CheckCircle2, TrendingUp, AlertCircle, RefreshCw
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function AdminRiskDashboard() {
  const [merchants, setMerchants] = useState<any[]>([]);
  const [globalStats, setGlobalStats] = useState({
    avgDisputeRatio: "0.00%",
    suspiciousMerchants: 0,
    duplicateInvoiceFlags: 0,
    cryptoAnomalyIndex: "Low",
    cbnCompliance: "Compliant"
  });
  const [loading, setLoading] = useState(true);

  async function loadRiskAnalytics() {
    setLoading(true);
    try {
      const sb = createClient();
      
      // 1. Fetch live merchants
      const { data: merchantsData } = await sb
        .from("merchants")
        .select("id, business_name, verification_status");
      
      // 2. Fetch live disputes
      const { data: disputesData } = await sb
        .from("payment_disputes")
        .select("id, merchant_id, status, risk_score, payment_rail");

      // 3. Fetch live invoices
      const { data: invoicesData } = await sb
        .from("invoices")
        .select("id, merchant_id, grand_total, customer_email, created_at");

      const mList = merchantsData || [];
      const dList = disputesData || [];
      const iList = invoicesData || [];

      // Calculate duplicate invoices (same email, same grand_total, within 5 minutes)
      let duplicateFlags = 0;
      const sortedInvoices = [...iList].sort((a, b) => {
        if (a.customer_email !== b.customer_email) return (a.customer_email || "").localeCompare(b.customer_email || "");
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      for (let idx = 0; idx < sortedInvoices.length - 1; idx++) {
        const cur = sortedInvoices[idx];
        const next = sortedInvoices[idx + 1];
        if (
          cur.customer_email && 
          cur.customer_email === next.customer_email && 
          Number(cur.grand_total) === Number(next.grand_total) &&
          Math.abs(new Date(cur.created_at).getTime() - new Date(next.created_at).getTime()) <= 300000
        ) {
          duplicateFlags++;
        }
      }

      // Calculate merchant specific ratios
      let suspiciousCount = 0;
      const processedMerchants = mList.map((m: any) => {
        const mDisputes = dList.filter(d => d.merchant_id === m.id);
        const mInvoices = iList.filter(inv => inv.merchant_id === m.id);
        
        const disputesCount = mDisputes.length;
        const totalTxs = mInvoices.length;
        
        // Calculate ratio
        const ratioNum = totalTxs > 0 ? (disputesCount / totalTxs) * 100 : 0;
        const dispute_ratio = `${ratioNum.toFixed(2)}%`;
        
        // Dynamic Risk score
        const risk_score = disputesCount > 0 
          ? Math.min(100, Math.round(mDisputes.reduce((sum, d) => sum + (d.risk_score || 0), 0) / disputesCount)) 
          : 0;

        // Status threshold mapping
        const status = ratioNum > 2.0 ? "SUSPICIOUS" : ratioNum > 1.0 ? "MONITORING" : "HEALTHY";
        if (status === "SUSPICIOUS") suspiciousCount++;

        return {
          id: m.id,
          name: m.business_name || "Unnamed Merchant",
          disputes: disputesCount,
          total_txs: totalTxs,
          dispute_ratio,
          risk_score,
          status
        };
      });

      // Calculate overall platform dispute ratio
      const platformRatio = iList.length > 0 ? (dList.length / iList.length) * 100 : 0;
      
      // Crypto anomaly evaluation
      const cryptoAlerts = dList.filter(d => d.payment_rail === "BREET_CRYPTO" && d.risk_score > 60);
      const cryptoAnomalyIndex = cryptoAlerts.length > 2 ? "High" : cryptoAlerts.length > 0 ? "Medium" : "Low";

      setMerchants(processedMerchants);
      setGlobalStats({
        avgDisputeRatio: `${platformRatio.toFixed(2)}%`,
        suspiciousMerchants: suspiciousCount,
        duplicateInvoiceFlags: duplicateFlags,
        cryptoAnomalyIndex,
        cbnCompliance: platformRatio <= 2.00 ? "Compliant" : "Breached"
      });
    } catch (err) {
      console.error("Failed loading risk metrics:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRiskAnalytics();
  }, []);

  const handleUpdateScore = (id: string, newScore: number) => {
    setMerchants(prev => prev.map(m => {
      if (m.id === id) {
        const status = newScore >= 65 ? "SUSPICIOUS" : newScore >= 45 ? "MONITORING" : "HEALTHY";
        return { ...m, risk_score: newScore, status };
      }
      return m;
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Risk &amp; Fraud Dashboard</h1>
          <p className="text-neutral-500 text-sm mt-1">
            Perform analytical reviews on chargeback ratios, duplicate invoice detection, and flag suspicious merchants.
          </p>
        </div>
        <Button 
          onClick={loadRiskAnalytics} 
          disabled={loading} 
          variant="outline" 
          className="border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh Audit
        </Button>
      </div>

      {/* Grid of stats panels */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Average Dispute Ratio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-neutral-900">
                {loading ? "..." : globalStats.avgDisputeRatio}
              </span>
              <span className={`text-xs font-semibold ${globalStats.cbnCompliance === "Compliant" ? "text-emerald-500" : "text-red-500"}`}>
                {globalStats.cbnCompliance === "Compliant" ? "well below CBN threshold" : "cbn compliance warning"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-red-500 uppercase tracking-wider">Suspicious Merchants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className={`text-3xl font-extrabold ${globalStats.suspiciousMerchants > 0 ? "text-red-600" : "text-neutral-900"}`}>
                {loading ? "..." : globalStats.suspiciousMerchants}
              </span>
              <span className="text-xs text-neutral-400 font-semibold">requires audit freeze</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-amber-500 uppercase tracking-wider">Duplicate invoice flags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className={`text-3xl font-extrabold ${globalStats.duplicateInvoiceFlags > 0 ? "text-amber-600" : "text-neutral-900"}`}>
                {loading ? "..." : globalStats.duplicateInvoiceFlags}
              </span>
              <span className="text-xs text-neutral-400 font-semibold">
                {globalStats.duplicateInvoiceFlags} flags matched
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Crypto Anomaly Index</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-emerald-600">
                {loading ? "..." : globalStats.cryptoAnomalyIndex}
              </span>
              <span className="text-xs text-emerald-500 font-semibold">multi-signature operational</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Columns: Merchant Dispute ratios */}
        <div className="lg:col-span-2">
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200 flex flex-row justify-between items-center">
              <CardTitle className="text-base text-neutral-900">Merchant Chargeback &amp; Dispute Ratios</CardTitle>
              <Users className="w-5 h-5 text-neutral-400" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200 text-xs font-bold text-neutral-400 uppercase tracking-wider">
                      <th className="px-6 py-4">Merchant Name</th>
                      <th className="px-6 py-4">Disputes / Total</th>
                      <th className="px-6 py-4">Dispute Ratio</th>
                      <th className="px-6 py-4">Risk Index</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-neutral-400">
                          Fetching live transaction risk analytics...
                        </td>
                      </tr>
                    ) : merchants.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-neutral-400">
                          No active merchant records registered in system.
                        </td>
                      </tr>
                    ) : (
                      merchants.map((m) => {
                        const getStatusStyles = (status: string) => {
                          switch (status) {
                            case "HEALTHY": return "bg-emerald-50 text-emerald-700 border-emerald-200";
                            case "SUSPICIOUS": return "bg-red-50 text-red-700 border-red-200";
                            default: return "bg-amber-50 text-amber-700 border-amber-200";
                          }
                        };

                        return (
                          <tr key={m.id} className="hover:bg-neutral-50/50">
                            <td className="px-6 py-4 font-bold text-neutral-900">
                              {m.name}
                            </td>
                            <td className="px-6 py-4 font-medium text-neutral-600">
                              {m.disputes} disputes / {m.total_txs} invoices
                            </td>
                            <td className="px-6 py-4 font-bold text-neutral-700">
                              {m.dispute_ratio}
                            </td>
                            <td className="px-6 py-4 space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-neutral-800">{m.risk_score}/100</span>
                                <span className="text-[9px] text-neutral-400 font-bold tracking-wider uppercase bg-neutral-100 dark:bg-white/5 px-1.5 py-0.5 rounded">Auto</span>
                              </div>
                              <div className="w-28 h-1.5 bg-neutral-100 dark:bg-white/10 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    m.risk_score >= 65 ? "bg-red-500" : 
                                    m.risk_score >= 45 ? "bg-amber-500" : 
                                    "bg-emerald-500"
                                  }`}
                                  style={{ width: `${m.risk_score}%` }}
                                />
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-block px-2.5 py-0.5 border rounded-full text-xs font-semibold ${getStatusStyles(m.status)}`}>
                                {m.status}
                              </span>
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

        {/* Right Column: Platform Risk Parameters */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Platform Risk parameters</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4 text-xs text-neutral-600">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 space-y-2">
                <p className="font-bold flex items-center gap-1">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  CBN Threshold Warning
                </p>
                <p className="leading-relaxed">Platform dispute ratios must remain strictly below <strong>2.00%</strong> of overall volume under Central Bank of Nigeria operational compliance models. Flagged suspicious accounts have their payouts frozen instantly.</p>
              </div>

              <div className="space-y-2 pt-2">
                <span className="font-bold block text-neutral-800 uppercase tracking-wider text-[10px]">Auto risk rules</span>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Invoice generation patterns flagged above ₦5,000,000.</li>
                  <li>Multi-signatures required on all crypto reversals.</li>
                  <li>Device fingerprint mismatches logged on checkout logs.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
