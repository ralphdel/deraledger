"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { 
  ArrowLeft, Bitcoin, Clock, 
  CheckCircle2, AlertOctagon, ShieldAlert, ShieldCheck, 
  RefreshCw
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function AdminRefundDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  
  const [detail, setDetail] = useState<any>(null);
  const [status, setStatus] = useState("REQUESTED");
  const [timeline, setTimeline] = useState<any[]>([]);
  const [payoutFrozen, setPayoutFrozen] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function fetchRefundDetail() {
      try {
        const sb = createClient();
        const { data } = await sb
          .from("refund_requests")
          .select("*, merchants(business_name)")
          .eq("id", id)
          .maybeSingle();

        if (data) {
          const mapped = {
            id: data.id,
            reference: data.refund_reference,
            merchant_name: data.merchants?.business_name || "Merchant Partner",
            merchant_id: data.merchant_id,
            payment_reference: data.payment_reference,
            invoice_id: data.invoice_id || "—",
            payment_rail: data.payment_rail,
            refund_type: data.refund_type,
            amount: Number(data.amount),
            currency: "NGN", // All amounts in NGN per spec
            status: data.status,
            risk_score: data.risk_score || 15,
            internal_note: data.internal_note || null,
            reason: data.reason,
            requires_manual_review: data.requires_manual_review,
            created_at: data.created_at,
          };
          setDetail(mapped);
          setStatus(mapped.status);
          setTimeline([
            { event: "Refund Request Created", actor: `Merchant (${data.merchants?.business_name || "Partner"})`, date: data.created_at, note: "Request created with status REQUESTED. Awaiting compliance review." },
            { event: "Eligibility Check", actor: "System Engine", date: data.created_at, note: "Passed duplicate check and currency match validations." }
          ]);
        } else {
          setNotFound(true);
        }
      } catch (err) {
        console.error("Failed to load admin refund detail:", err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    fetchRefundDetail();
  }, [id]);

  const handleApprove = async () => {
    const sb = createClient();
    await sb.from("refund_requests").update({ status: "APPROVED", updated_at: new Date().toISOString() }).eq("id", id);
    setStatus("APPROVED");
    setTimeline(prev => [...prev, {
      event: "Refund Approved",
      actor: "SuperAdmin Desk",
      date: new Date().toISOString(),
      note: "Refund approved for execution. Processor channels dispatched."
    }]);
    setActionSuccessMsg("Refund request status updated to APPROVED. Processing engine instructed.");
  };

  const handleReject = async () => {
    const sb = createClient();
    await sb.from("refund_requests").update({ status: "REJECTED", updated_at: new Date().toISOString() }).eq("id", id);
    setStatus("REJECTED");
    setTimeline(prev => [...prev, {
      event: "Refund Denied",
      actor: "SuperAdmin Desk",
      date: new Date().toISOString(),
      note: "Treasury audit failed. Insufficient matching transaction proof."
    }]);
    setActionSuccessMsg("Refund request REJECTED. Merchant has been notified.");
  };

  const handleFreezePayout = () => {
    setPayoutFrozen(true);
    setTimeline(prev => [...prev, {
      event: "Payout Frozen",
      actor: "SuperAdmin Treasury Desk",
      date: new Date().toISOString(),
      note: "Merchant payout channel frozen for treasury protection."
    }]);
    setActionSuccessMsg("Warning: Payout channels for merchant have been locked. No settlement cycle runs allowed.");
  };

  const handleApplyOffset = async () => {
    const sb = createClient();
    await sb.from("refund_requests").update({ status: "OFFSET_APPLIED", updated_at: new Date().toISOString() }).eq("id", id);
    setStatus("OFFSET_APPLIED");
    setTimeline(prev => [...prev, {
      event: "Negative Offset Applied",
      actor: "Settlement Protection Service",
      date: new Date().toISOString(),
      note: `Negative reserve offset of ${formatNaira(detail.amount)} applied against next settlement cycle.`
    }]);
    setActionSuccessMsg(`Reserve offset executed. ${formatNaira(detail.amount)} will be deducted from future merchant disbursements.`);
  };

  const formatNaira = (amt: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading refund details...
      </div>
    );
  }

  if (notFound || !detail) {
    return (
      <div className="space-y-4">
        <Link href="/admin/refunds">
          <Button variant="outline" className="border-neutral-200 text-neutral-800">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Queue
          </Button>
        </Link>
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-8 text-center space-y-2">
          <ShieldAlert className="w-10 h-10 text-neutral-300 mx-auto" />
          <p className="font-semibold text-neutral-600">Refund request not found</p>
          <p className="text-xs text-neutral-400">ID: {id}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/refunds">
          <Button variant="outline" className="border-neutral-200 text-neutral-800">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Queue
          </Button>
        </Link>
        <div>
          <span className="text-xs text-neutral-400 font-bold uppercase tracking-wider">Refund Reference</span>
          <h1 className="text-xl font-extrabold tracking-tight text-neutral-900 mt-0.5">{detail.reference}</h1>
        </div>
      </div>

      {actionSuccessMsg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Transaction Details */}
          <Card className="bg-white border-neutral-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-neutral-100">
              <CardTitle className="text-sm font-bold text-neutral-900">Transaction Details</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-neutral-400">Merchant Name</Label>
                  <p className="font-semibold text-neutral-800">{detail.merchant_name}</p>
                  <p className="font-mono text-[11px] text-neutral-400 mt-0.5">ID: {detail.merchant_id}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Payment Reference</Label>
                  <p className="font-mono text-sm font-semibold text-neutral-800">{detail.payment_reference}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Original Invoice ID</Label>
                  <p className="font-mono text-sm font-semibold text-neutral-800">{detail.invoice_id}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Refund Type &amp; Amount</Label>
                  <p className="text-lg font-bold text-[#6F2CFF]">{formatNaira(detail.amount)} (NGN)</p>
                  <span className="text-xs text-neutral-400">Type: {detail.refund_type}</span>
                </div>
                <div>
                  <Label className="text-neutral-400">Payment Rail</Label>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold bg-neutral-100 text-neutral-600 uppercase">{detail.payment_rail}</span>
                </div>
                <div>
                  <Label className="text-neutral-400">Manual Review Required</Label>
                  <p className="font-semibold text-neutral-800">{detail.requires_manual_review ? "YES — Compliance Review" : "Standard Queue"}</p>
                </div>
              </div>
              <div className="pt-2 border-t border-neutral-100">
                <Label className="text-neutral-400">Refund Reason</Label>
                <p className="text-xs text-neutral-700 bg-neutral-50 rounded-xl p-3 leading-relaxed mt-1">"{detail.reason}"</p>
              </div>
              {detail.internal_note && (
                <div className="pt-2 border-t border-neutral-100">
                  <Label className="text-neutral-400">Internal Note</Label>
                  <p className="text-xs text-neutral-700 bg-blue-50 border border-blue-100 rounded-xl p-3 leading-relaxed mt-1">{detail.internal_note}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Crypto Compliance Block — only for BREET_CRYPTO, shows spec-compliant advisory */}
          {detail.payment_rail === "BREET_CRYPTO" && (
            <Card className="bg-white border-neutral-200 shadow-sm">
              <CardHeader className="pb-3 border-b border-neutral-100">
                <CardTitle className="text-sm font-bold text-neutral-900 flex items-center gap-1.5">
                  <Bitcoin className="w-4 h-4 text-amber-500" /> Breet Crypto Refund Compliance Review
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-800 text-xs space-y-2">
                  <p className="font-bold">⚠ Crypto Refund — Manual Compliance Required</p>
                  <p>Crypto refunds must always require wallet verification, compliance review, and admin approval before execution. Deraledger does not execute crypto reversals directly — all on-chain actions are performed via Breet.</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs space-y-2">
                  <p className="font-semibold text-neutral-700">Compliance Checklist</p>
                  <ul className="space-y-1 text-neutral-600 list-disc pl-4">
                    <li>Verify customer wallet address ownership via KYC records</li>
                    <li>Cross-reference original Breet transaction in the Crypto Operations Center</li>
                    <li>Confirm AML/CFT clearance before approving any on-chain reversal</li>
                    <li>All crypto refunds must be processed through Breet API only — no internal ledger adjustments</li>
                  </ul>
                </div>
                <p className="text-[10px] text-neutral-400">
                  Note: Settlement amount is always expressed in NGN. The crypto equivalent amount depends on the exchange rate at the time of the original transaction.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Status, Actions, Timeline */}
        <div className="space-y-6">
          <Card className="bg-white border-neutral-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-neutral-100">
              <CardTitle className="text-sm font-bold text-neutral-900">Request Attributes</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div>
                <Label className="text-neutral-400">Status</Label>
                <div className="mt-1">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full border text-xs font-bold uppercase ${
                    status === "APPROVED" || status === "COMPLETED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    status === "REJECTED" ? "bg-red-50 text-red-700 border-red-200" :
                    status === "OFFSET_APPLIED" ? "bg-purple-50 text-purple-700 border-purple-200" :
                    "bg-amber-50 text-amber-700 border-amber-200"
                  }`}>
                    {status}
                  </span>
                </div>
              </div>

              <div>
                <Label className="text-neutral-400">Global Risk Score</Label>
                <p className={`font-bold text-sm mt-0.5 ${detail.risk_score >= 60 ? "text-red-600" : "text-emerald-600"}`}>
                  {detail.risk_score}/100 Risk Score
                </p>
                <div className="w-full bg-neutral-100 rounded-full h-1.5 mt-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${detail.risk_score >= 60 ? "bg-red-500" : detail.risk_score >= 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${detail.risk_score}%` }}
                  />
                </div>
              </div>

              {payoutFrozen && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 text-xs font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-red-600" />
                  <span>Payout frozen for compliance review.</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white border-neutral-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-neutral-100">
              <CardTitle className="text-sm font-bold text-neutral-900">Treasury Decision Controls</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-2">
              {status === "APPROVED" || status === "COMPLETED" || status === "REJECTED" || status === "OFFSET_APPLIED" ? (
                <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 text-center space-y-2">
                  <ShieldCheck className="w-8 h-8 text-emerald-600 mx-auto" />
                  <p className="text-xs font-bold text-neutral-800">Case Resolved</p>
                  <p className="text-[11px] text-neutral-400">Status: <strong className="uppercase">{status}</strong>. Ledger audit trail locked.</p>
                </div>
              ) : (
                <>
                  <Button onClick={handleApprove} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs">
                    Approve Refund
                  </Button>
                  <Button onClick={handleReject} variant="outline" className="w-full border-red-200 text-red-700 hover:bg-red-50 text-xs">
                    Reject Refund
                  </Button>
                  <Button onClick={handleApplyOffset} className="w-full bg-[#6F2CFF] hover:bg-[#5B21B6] text-white font-bold text-xs">
                    Apply Settlement Offset
                  </Button>
                  <Button onClick={handleFreezePayout} className="w-full bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-xs">
                    Freeze Merchant Payout
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card className="bg-white border-neutral-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-neutral-100">
              <CardTitle className="text-sm font-bold text-neutral-900">Audit History Timeline</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-4 relative pl-4 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-neutral-100">
                {timeline.map((event: any, idx: number) => (
                  <div key={idx} className="relative space-y-0.5">
                    <div className="absolute -left-[17px] top-1.5 w-2 h-2 rounded-full bg-[#6F2CFF] ring-4 ring-white" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-neutral-800">{event.event}</span>
                      <span className="text-[9px] text-neutral-400">{new Date(event.date).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-[10px] text-neutral-400 uppercase tracking-wider font-semibold">Actor: {event.actor}</p>
                    <p className="text-xs text-neutral-500 leading-relaxed">"{event.note}"</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
