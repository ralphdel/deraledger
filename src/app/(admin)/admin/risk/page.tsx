"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  ShieldAlert, ShieldCheck, AlertOctagon, Users, BarChart3, 
  HelpCircle, CheckCircle2, TrendingUp, AlertCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const MOCK_RISK_MERCHANTS = [
  {
    id: "m-1",
    name: "Tech-Forge Ltd",
    disputes: 2,
    total_txs: 240,
    dispute_ratio: "0.83%",
    risk_score: 32,
    status: "HEALTHY"
  },
  {
    id: "m-2",
    name: "Apex Retailers Ltd",
    disputes: 5,
    total_txs: 78,
    dispute_ratio: "6.41%", // High ratio!
    risk_score: 68,
    status: "SUSPICIOUS"
  },
  {
    id: "m-3",
    name: "Nexa Innovations",
    disputes: 4,
    total_txs: 380,
    dispute_ratio: "1.05%",
    risk_score: 45,
    status: "HEALTHY"
  },
  {
    id: "m-4",
    name: "Deca Builders",
    disputes: 1,
    total_txs: 15,
    dispute_ratio: "6.67%",
    risk_score: 55,
    status: "MONITORING"
  }
];

export default function AdminRiskDashboard() {
  const [merchants, setMerchants] = useState(MOCK_RISK_MERCHANTS);

  const handleUpdateScore = (id: string, newScore: number) => {
    setMerchants(merchants.map(m => {
      if (m.id === id) {
        const status = newScore >= 65 ? "SUSPICIOUS" : newScore >= 45 ? "MONITORING" : "HEALTHY";
        return { ...m, risk_score: newScore, status };
      }
      return m;
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Risk &amp; Fraud Dashboard</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Perform analytical reviews on chargeback ratios, duplicate invoice detection, and flag suspicious merchants.
        </p>
      </div>

      {/* Grid of stats panels */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Average Dispute Ratio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-neutral-900">1.24%</span>
              <span className="text-xs text-emerald-500 font-semibold">well below CBN threshold</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-red-500 uppercase tracking-wider">Suspicious Merchants</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-red-600">1</span>
              <span className="text-xs text-red-500 font-semibold">requires audit freeze</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-amber-500 uppercase tracking-wider">Duplicate invoice flags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-amber-600">0</span>
              <span className="text-xs text-emerald-500 font-semibold">0 flags matched</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Crypto Anomaly Index</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-emerald-600">Low</span>
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
                    {merchants.map((m) => {
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
                            {m.disputes} disputes / {m.total_txs} transactions
                          </td>
                          <td className="px-6 py-4 font-bold text-neutral-700">
                            {m.dispute_ratio}
                          </td>
                          <td className="px-6 py-4 space-y-1">
                            <span className="font-semibold text-neutral-600 mr-2">{m.risk_score}/100</span>
                            <input 
                              type="range" 
                              min="0" 
                              max="100" 
                              value={m.risk_score} 
                              onChange={(e) => handleUpdateScore(m.id, Number(e.target.value))}
                              className="w-24 accent-[#6F2CFF] align-middle"
                            />
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-block px-2.5 py-0.5 border rounded-full text-xs font-semibold ${getStatusStyles(m.status)}`}>
                              {m.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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
