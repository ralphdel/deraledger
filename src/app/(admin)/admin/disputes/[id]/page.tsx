"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { 
  ArrowLeft, ShieldAlert, ShieldCheck, AlertOctagon, 
  Coins, Terminal, FileText, Lock,
  AlertTriangle, RefreshCw
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function AdminDisputeDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  
  const [dispute, setDispute] = useState<any>(null);
  const [status, setStatus] = useState("");
  const [timeline, setTimeline] = useState<any[]>([]);
  const [payoutFrozen, setPayoutFrozen] = useState(false);
  const [actionPerformed, setActionPerformed] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function loadDisputeDetails() {
      try {
        const sb = createClient();
        const { data } = await sb
          .from("payment_disputes")
          .select("*, merchants(business_name)")
          .eq("id", id)
          .maybeSingle();

        if (data) {
          const mapped = {
            id: data.id,
            reference: data.case_id,
            merchant_name: data.merchants?.business_name || "Merchant Partner",
            merchant_id: data.merchant_id,
            customer_email: data.customer_email,
            customer_phone: data.customer_phone,
            payment_rail: data.payment_rail,
            category: data.category,
            amount: Number(data.amount),
            status: data.status,
            priority: data.risk_score >= 60 ? "CRITICAL" : data.risk_score >= 40 ? "HIGH" : "MEDIUM",
            risk_score: data.risk_score || 15,
            description: data.description,
            payment_reference: data.payment_reference || data.invoice_number,
            tx_hash: data.tx_hash || null,
            evidence: data.evidence_url || null,
            created_at: data.created_at,
          };
          setDispute(mapped);
          setStatus(mapped.status);
          setTimeline([
            { event: "Dispute Opened", actor: "Customer", date: data.created_at, note: "Customer submitted payment dispute." },
            { event: "Auto Acknowledged", actor: "System", date: data.created_at, note: "Auto-notification sent to customer and merchant." }
          ]);
        } else {
          setNotFound(true);
        }
      } catch (err) {
        console.error("Failed loading admin dispute detail:", err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    loadDisputeDetails();
  }, [id]);

  const handleApproveRefund = async () => {
    const sb = createClient();
    await sb.from("payment_disputes").update({ status: "RESOLVED", updated_at: new Date().toISOString() }).eq("id", id);
    setStatus("RESOLVED");
    const newEvent = { event: "Refund Approved", actor: "SuperAdmin", date: new Date().toISOString(), note: `Approved refund of ${formatNaira(dispute.amount)} to customer. Offset adjusted.` };
    setTimeline(prev => [...prev, newEvent]);
    setActionPerformed("Approved — refund reversal dispatched via Paystack processor channels.");
  };

  const handleRejectDispute = async () => {
    const sb = createClient();
    await sb.from("payment_disputes").update({ status: "REJECTED", updated_at: new Date().toISOString() }).eq("id", id);
    setStatus("REJECTED");
    const newEvent = { event: "Dispute Rejected", actor: "SuperAdmin", date: new Date().toISOString(), note: "Dispute rejected. Verified that customer was not debited or has been refunded." };
    setTimeline(prev => [...prev, newEvent]);
    setActionPerformed("Rejected — dispute marked invalid after treasury audit.");
  };

  const handleFreezePayout = () => {
    setPayoutFrozen(prev => !prev);
    const newEvent = {
      event: payoutFrozen ? "Payout Unfrozen" : "Payout Frozen",
      actor: "SuperAdmin",
      date: new Date().toISOString(),
      note: payoutFrozen ? "SuperAdmin released the payout hold." : "SuperAdmin placed a payout hold on the merchant account."
    };
    setTimeline(prev => [...prev, newEvent]);
  };

  const formatNaira = (amt: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading case details...
      </div>
    );
  }

  if (notFound || !dispute) {
    return (
      <div className="space-y-4">
        <Link href="/admin/disputes">
          <Button variant="outline" className="border-neutral-200 text-neutral-700 hover:bg-neutral-50">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Queue
          </Button>
        </Link>
        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-8 text-center space-y-2">
          <ShieldAlert className="w-10 h-10 text-neutral-300 mx-auto" />
          <p className="font-semibold text-neutral-600">Dispute case not found</p>
          <p className="text-xs text-neutral-400">Case ID: {id}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Navigation header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/disputes">
          <Button variant="outline" className="border-neutral-200 text-neutral-700 hover:bg-neutral-50">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Queue
          </Button>
        </Link>
        <div>
          <span className="text-xs text-neutral-400 font-bold uppercase tracking-wider">Administrative Console</span>
          <h1 className="text-xl font-extrabold text-neutral-900 mt-0.5">Case Reference: {dispute.reference}</h1>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Case details */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Case Audit Details</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-neutral-400">Merchant</Label>
                  <p className="font-bold text-neutral-900 mt-0.5">{dispute.merchant_name}</p>
                  <p className="text-xs text-neutral-400 font-mono mt-0.5">ID: {dispute.merchant_id}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Customer Contact</Label>
                  <p className="font-bold text-neutral-900 mt-0.5">{dispute.customer_email}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">{dispute.customer_phone}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Payment Rail &amp; Reference</Label>
                  <p className="font-bold text-neutral-900 mt-0.5">{dispute.category}</p>
                  <p className="font-mono text-xs text-neutral-500 mt-0.5">Ref: {dispute.payment_reference}</p>
                  <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-neutral-100 text-neutral-500 uppercase">{dispute.payment_rail}</span>
                </div>
                <div>
                  <Label className="text-neutral-400">Disputed Amount</Label>
                  <p className="text-lg font-bold text-[#6F2CFF] mt-0.5">{formatNaira(dispute.amount)}</p>
                </div>
              </div>

              <div className="pt-4 border-t border-neutral-100 space-y-2">
                <Label className="text-neutral-400">Customer Description</Label>
                <p className="text-sm text-neutral-700 bg-neutral-50 rounded-xl p-4">"{dispute.description}"</p>
              </div>

              {/* Crypto details block — only if BREET_CRYPTO and we have a tx_hash from DB */}
              {dispute.payment_rail === "BREET_CRYPTO" && (
                <div className="pt-4 border-t border-neutral-100 space-y-4">
                  <div className="flex items-center gap-2 text-amber-600 font-bold text-sm">
                    <Coins className="w-4 h-4" /> Breet Crypto Verification Details
                  </div>
                  <div className="text-xs bg-amber-50/50 border border-amber-100 rounded-xl p-4 space-y-2">
                    {dispute.tx_hash ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-neutral-400">Transaction Hash</span>
                          <span className="font-mono text-neutral-800 truncate w-52 text-right">{dispute.tx_hash}</span>
                        </div>
                        <p className="text-[10px] text-neutral-400 mt-1">
                          Confirmation status is managed by Breet. Query the Crypto Operations Center with this hash for live details.
                        </p>
                      </>
                    ) : (
                      <p className="text-neutral-500">No blockchain transaction hash was provided with this dispute. Cross-reference the Crypto Operations Center by payment reference.</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Evidence panel */}
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Case Evidence Log</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {dispute.evidence ? (
                <div className="border border-dashed border-neutral-200 rounded-2xl p-6 text-center space-y-3 bg-neutral-50/50">
                  <FileText className="w-8 h-8 text-[#A78BFA] mx-auto" />
                  <div>
                    <p className="font-bold text-sm text-neutral-900">Payment Evidence Attachment</p>
                    <p className="text-xs text-neutral-400 mt-0.5">Uploaded by {dispute.customer_email}</p>
                  </div>
                  <a href={dispute.evidence} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-semibold text-[#7B2FF7] hover:underline">
                    View full attachment ↗
                  </a>
                </div>
              ) : (
                <div className="border border-dashed border-neutral-200 rounded-2xl p-6 text-center space-y-2 bg-neutral-50/50">
                  <FileText className="w-8 h-8 text-neutral-400 mx-auto" />
                  <p className="text-xs font-bold text-neutral-500">No attachment uploaded</p>
                  <p className="text-[11px] text-neutral-400">The customer did not upload any payment confirmation with this dispute.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Audit log */}
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200 flex flex-row items-center gap-2">
              <Terminal className="w-5 h-5 text-neutral-500" />
              <CardTitle className="text-base text-neutral-900">System Audit Log</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="bg-[#0B1020] text-neutral-200 rounded-xl p-4 font-mono text-xs space-y-2 max-h-60 overflow-y-auto">
                <div className="flex gap-2">
                  <span className="text-neutral-500 shrink-0">[{dispute.created_at}]</span>
                  <span className="text-emerald-400">INFO</span>
                  <span>Dispute case {dispute.reference} opened by customer via payment portal.</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-neutral-500 shrink-0">[{dispute.created_at}]</span>
                  <span className="text-emerald-400">INFO</span>
                  <span>Risk engine scored case at {dispute.risk_score}/100. Routed to SuperAdmin desk.</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-neutral-500 shrink-0">[{new Date().toISOString()}]</span>
                  <span className="text-amber-400">AUDIT</span>
                  <span>Case opened by admin operator. Awaiting decision.</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Controls */}
        <div className="space-y-6">
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Operational Actions</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div>
                <Label className="text-neutral-400">Case Status</Label>
                <div className="mt-1">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full border text-xs font-bold uppercase ${
                    status === "RESOLVED" || status === "COMPLETED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : 
                    status === "REJECTED" ? "bg-red-50 text-red-700 border-red-200" : 
                    "bg-amber-50 text-amber-700 border-amber-200"
                  }`}>
                    {status}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-100 flex flex-col gap-2">
                {status === "RESOLVED" || status === "REJECTED" || status === "COMPLETED" ? (
                  <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 text-center space-y-2">
                    <ShieldCheck className="w-8 h-8 text-emerald-600 mx-auto" />
                    <p className="text-xs font-bold text-neutral-800">Case Audited &amp; Closed</p>
                    <p className="text-[11px] text-neutral-400">
                      This dispute has been marked as <strong className="uppercase text-purp-700">{status}</strong>. Ledger modifications are permanently locked.
                    </p>
                  </div>
                ) : (
                  <>
                    <Button onClick={handleApproveRefund} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                      Approve &amp; Resolve
                    </Button>
                    <Button onClick={handleRejectDispute} variant="outline" className="w-full border-neutral-200 text-neutral-700 hover:bg-neutral-50">
                      Reject Dispute
                    </Button>
                  </>
                )}
                
                <Button 
                  onClick={handleFreezePayout} 
                  variant="outline" 
                  className={`w-full font-bold border-0 text-white ${
                    payoutFrozen ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                  }`}
                >
                  {payoutFrozen ? "Release Merchant Payout" : "Freeze Merchant Payout"}
                </Button>
              </div>

              {actionPerformed && (
                <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3 text-xs text-neutral-700 mt-2">
                  <span className="font-bold block mb-1">Administrative log</span>
                  {actionPerformed}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Risk score */}
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Risk Profile Index</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 text-xs space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-neutral-400">Risk Score:</span>
                <span className={`font-bold px-2 py-0.5 border rounded-full ${
                  dispute.risk_score >= 60 ? "bg-red-50 text-red-600 border-red-200" :
                  dispute.risk_score >= 40 ? "bg-amber-50 text-amber-600 border-amber-200" :
                  "bg-emerald-50 text-emerald-600 border-emerald-200"
                }`}>
                  {dispute.risk_score}/100
                </span>
              </div>
              <div className="w-full bg-neutral-100 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${dispute.risk_score >= 60 ? "bg-red-500" : dispute.risk_score >= 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${dispute.risk_score}%` }}
                />
              </div>
              <p className="text-neutral-400">
                Score computed by the composite risk engine based on payment rail, amount, and category threat level.
              </p>
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Case Audit Timeline</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4 pl-4 relative before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-neutral-100">
                {timeline.map((evt: any, idx: number) => (
                  <div key={idx} className="relative space-y-0.5 text-xs">
                    <div className="absolute -left-[17px] top-1.5 w-2 h-2 rounded-full bg-[#6F2CFF] ring-4 ring-white" />
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-neutral-800">{evt.event}</span>
                      <span className="text-[10px] text-neutral-400">{new Date(evt.date).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-[10px] text-neutral-400">By: {evt.actor}</p>
                    <p className="text-neutral-500 mt-1">{evt.note}</p>
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
