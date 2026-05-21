"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { 
  ShieldAlert, ShieldCheck, Clock, Search, Filter, ArrowRight,
  Bitcoin, CreditCard, Landmark, Wallet, AlertOctagon, UserCheck, 
  Coins, Landmark as TreasuryIcon, AlertTriangle, RefreshCw
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminFetchAllRefundRequestsAction } from "@/lib/actions";



export default function AdminRefundsQueue() {
  const [search, setSearch] = useState("");
  const [selectedFilter, setSelectedFilter] = useState("ALL");
  const [requestsList, setRequestsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAllRefunds() {
    setLoading(true);
    try {
      const res = await adminFetchAllRefundRequestsAction();
      if (res.success && res.migrated) {
        const mapped = (res.refunds || []).map((r: any) => ({
          id: r.id,
          reference: r.refund_reference,
          merchant_name: r.merchants?.business_name || "Merchant Partner",
          payment_rail: r.payment_rail,
          refund_type: r.refund_type,
          amount: Number(r.amount),
          status: r.status,
          risk_score: r.risk_score,
          requires_manual_review: r.requires_manual_review,
          sla_time: r.status === "COMPLETED" || r.status === "REJECTED" ? "Resolved" : "SLA Active (24h)",
          created_at: r.created_at
        }));
        setRequestsList(mapped);
      } else {
        setRequestsList([]);
      }
    } catch (err) {
      console.error("Failed loading all refunds:", err);
      setRequestsList([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAllRefunds();
  }, []);

  const filteredRequests = useMemo(() => {
    return requestsList.filter(r => {
      const matchesSearch = r.reference.toLowerCase().includes(search.toLowerCase()) ||
                            r.merchant_name.toLowerCase().includes(search.toLowerCase()) ||
                            r.customer_email.toLowerCase().includes(search.toLowerCase());
      
      if (selectedFilter === "ALL") return matchesSearch;
      if (selectedFilter === "PENDING_REVIEW") return matchesSearch && (r.status === "REQUESTED" || r.status === "REVIEWING");
      if (selectedFilter === "CRYPTO") return matchesSearch && r.payment_rail === "BREET_CRYPTO";
      if (selectedFilter === "OFFSET_APPLIED") return matchesSearch && r.status === "OFFSET_APPLIED";
      if (selectedFilter === "FRAUD_REVIEW") return matchesSearch && r.risk_score >= 60;
      return matchesSearch && r.status === selectedFilter;
    });
  }, [search, selectedFilter, requestsList]);

  const metrics = useMemo(() => {
    const total = requestsList.length;
    const pendingReview = requestsList.filter(r => r.status === "REQUESTED" || r.status === "REVIEWING").length;
    const cryptoCount = requestsList.filter(r => r.payment_rail === "BREET_CRYPTO").length;
    const offsetsCount = requestsList.filter(r => r.status === "OFFSET_APPLIED").length;
    const totalExposure = requestsList.reduce((sum, r) => sum + r.amount, 0);
    return { total, pendingReview, cryptoCount, offsetsCount, totalExposure };
  }, [requestsList]);

  const formatNaira = (amt: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Refund Operations Queue</h1>
          <p className="text-neutral-500 text-sm mt-1">
            SuperAdmin Treasury console for manual approval validation, settlement offset calculations, and crypto wallet audits.
          </p>
        </div>
        <Button onClick={loadAllRefunds} disabled={loading} variant="outline" className="border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50">
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh Queue
        </Button>
      </div>

      {/* SLA Risk Header Alerts */}
      <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex gap-3 text-xs leading-relaxed">
        <AlertOctagon className="w-5 h-5 shrink-0 text-red-600 mt-0.5" />
        <div>
          <span className="font-bold block mb-1">Treasury Settlement Protection Lock Active</span>
          Under platform rule sets, merchants are restricted from executing instant money transfers. All refund requests are queued for multi-signature verification to protect reserve balances.
        </div>
      </div>

      {/* Metrics Row (Section 10.1) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white border-neutral-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Pending Review Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-neutral-900">{metrics.pendingReview}</span>
              <span className="text-xs text-amber-500 font-semibold">manual approval needed</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-[#6F2CFF] uppercase tracking-wider">Active Settlement Exposure</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-2xl font-extrabold text-neutral-900">{formatNaira(metrics.totalExposure)}</span>
              <span className="text-xs text-neutral-500">global reserves</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-amber-500 uppercase tracking-wider">Crypto Compliance Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-amber-600">{metrics.cryptoCount}</span>
              <span className="text-xs text-amber-500 font-semibold">Breet manual validations</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white border-neutral-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Applied Reserve Offsets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-extrabold text-emerald-600">{metrics.offsetsCount}</span>
              <span className="text-xs text-emerald-500 font-semibold">negative balance deductions</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table search & filters */}
      <Card className="bg-white border-neutral-200 shadow-sm">
        <CardHeader className="pb-4 border-b border-neutral-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <Input
                type="text"
                placeholder="Search refund reference, merchant, customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-neutral-50 border-neutral-200 text-xs"
              />
            </div>

            {/* Filter selectors matching Section 10.1 */}
            <div className="flex flex-wrap gap-2 items-center">
              <Filter className="w-4 h-4 text-neutral-400 mr-1" />
              <select
                value={selectedFilter}
                onChange={(e) => setSelectedFilter(e.target.value)}
                className="bg-neutral-50 border border-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
              >
                <option value="ALL">All Requests</option>
                <option value="PENDING_REVIEW">Pending Review</option>
                <option value="CRYPTO">Crypto Refunds Only</option>
                <option value="OFFSET_APPLIED">Offset Applied</option>
                <option value="FRAUD_REVIEW">Fraud / High Risk (&gt;60)</option>
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-xs font-bold text-neutral-400 uppercase tracking-wider">
                  <th className="px-6 py-4">Request Ref</th>
                  <th className="px-6 py-4">Merchant</th>
                  <th className="px-6 py-4">Rail / Type</th>
                  <th className="px-6 py-4 text-right">Amount (NGN)</th>
                  <th className="px-6 py-4">Risk Index</th>
                  <th className="px-6 py-4">SLA</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-neutral-400">
                      Loading refund queue from ledger...
                    </td>
                  </tr>
                ) : filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <ShieldCheck className="w-10 h-10 text-neutral-300" />
                        <p className="font-semibold text-neutral-500">No refund requests in the queue</p>
                        <p className="text-xs text-neutral-400">All merchant refund requests will appear here for compliance review.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req) => {
                    const getRiskColor = (score: number) => {
                      if (score >= 70) return "text-red-600 bg-red-50 border-red-200";
                      if (score >= 40) return "text-amber-600 bg-amber-50 border-amber-200";
                      return "text-emerald-600 bg-emerald-50 border-emerald-200";
                    };

                    const getStatusStyles = (status: string) => {
                      switch (status) {
                        case "APPROVED": return "bg-emerald-50 text-emerald-700 border-emerald-200";
                        case "OFFSET_APPLIED": return "bg-purple-50 text-purple-700 border-purple-200";
                        case "REVIEWING": return "bg-amber-50 text-amber-700 border-amber-200";
                        case "REJECTED": return "bg-red-50 text-red-700 border-red-200";
                        default: return "bg-blue-50 text-blue-700 border-blue-200";
                      }
                    };

                    return (
                      <tr key={req.id} className="hover:bg-neutral-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="font-mono font-bold text-neutral-900">{req.reference}</span>
                          <span className="block text-[10px] text-neutral-400 font-semibold mt-0.5">{req.payment_rail}</span>
                        </td>
                        <td className="px-6 py-4 space-y-0.5">
                          <div className="font-semibold text-neutral-800">{req.merchant_name}</div>
                          <div className="text-xs text-neutral-400 font-mono">{req.payment_rail}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-xs font-semibold text-neutral-700">{req.refund_type}</div>
                        </td>
                        <td className="px-6 py-4 text-right font-bold text-neutral-900">
                          {formatNaira(req.amount)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-2 py-0.5 border rounded-full text-xs font-semibold ${getRiskColor(req.risk_score)}`}>
                            {req.risk_score}/100 Risk
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs font-bold text-neutral-500">
                          <span className={req.sla_time.includes("Overdue") ? "text-red-500" : req.sla_time.includes("ALERT") ? "text-amber-500" : "text-neutral-400"}>
                            {req.sla_time}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-block px-2 py-0.5 border rounded-full text-xs font-semibold uppercase ${getStatusStyles(req.status)}`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link href={`/admin/refunds/${req.id}`}>
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
