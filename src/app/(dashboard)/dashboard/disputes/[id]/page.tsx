"use client";

import { use, useState } from "react";
import Link from "next/link";
import { 
  ArrowLeft, ShieldAlert, Clock, CheckCircle2, Bitcoin, CreditCard, 
  Landmark, Wallet, Upload, Mail, Check, AlertCircle, AlertTriangle, FileText
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Mock data representing single detailed dispute
const MOCK_DETAIL_DISPUTES: Record<string, any> = {
  "dsp-4091-a83": {
    id: "dsp-4091-a83",
    reference: "DSP_9018274",
    invoice_number: "INV-2026-081",
    invoice_id: "inv_90182",
    customer_email: "tunde@company.ng",
    payment_rail: "BANK_TRANSFER",
    category: "Failed Payment",
    amount: 150000,
    status: "OPEN",
    priority: "HIGH",
    sla: "4h remaining",
    description: "I completed the NGN bank transfer to the virtual account provided on the DeraLedger invoice. My bank account was debited, but the invoice page continues to show 'Unpaid'. Please credit my account.",
    payment_reference: "REF-BKTRF-90281-NGA",
    tx_hash: null,
    created_at: "2026-05-20T10:30:00Z",
    evidence: "https://purpledger.vercel.app/demo-receipt-screenshot.jpg",
    timeline: [
      { event: "Dispute Opened", actor: "Customer", date: "2026-05-20T10:30:00Z", note: "Customer submitted failed bank transfer complaint." },
      { event: "Auto Acknowledged", actor: "System", date: "2026-05-20T10:30:05Z", note: "Auto-notification emailed to customer & merchant." },
    ]
  },
  "dsp-1120-x92": {
    id: "dsp-1120-x92",
    reference: "DSP_8810231",
    invoice_number: "INV-2026-092",
    invoice_id: "inv_10284",
    customer_email: "chioma.ezekiel@gmail.com",
    payment_rail: "BREET_CRYPTO",
    category: "Crypto Payment Not Credited",
    amount: 850000,
    status: "REVIEWING",
    priority: "CRITICAL",
    sla: "12m remaining",
    description: "Sent stablecoin USDT on Ethereum network. Blockchain TX shows over 35 confirmations, but DeraLedger is not verifying the invoice.",
    payment_reference: "BREET-TX-90281048",
    tx_hash: "0x8fae3256fb7d102e3b6a9a0e817cfa29a1b802611e9a26374a8109d9e6e8e811",
    created_at: "2026-05-20T14:45:00Z",
    evidence: "https://purpledger.vercel.app/demo-crypto-evidence.png",
    timeline: [
      { event: "Dispute Opened", actor: "Customer", date: "2026-05-20T14:45:00Z", note: "Stablecoin payment verification failure logged." },
      { event: "Verification Started", actor: "Crypto Engine", date: "2026-05-20T14:46:10Z", note: "Breet blockchain API verification query initiated." },
      { event: "Reviewing State", actor: "Admin Agent", date: "2026-05-20T15:00:00Z", note: "Assigned to treasury representative for wallet match." },
    ]
  }
};

export default function MerchantDisputeDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const dispute = MOCK_DETAIL_DISPUTES[id] || MOCK_DETAIL_DISPUTES["dsp-4091-a83"];
  
  const [responseMsg, setResponseMsg] = useState("");
  const [timeline, setTimeline] = useState(dispute.timeline);
  const [status, setStatus] = useState(dispute.status);
  const [evidenceSubmitted, setEvidenceSubmitted] = useState(false);

  const handleSubmitResponse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!responseMsg.trim()) return;

    const newEvent = {
      event: "Merchant Responded",
      actor: "Merchant",
      date: new Date().toISOString(),
      note: responseMsg
    };

    setTimeline([...timeline, newEvent]);
    setResponseMsg("");
  };

  const handleResolveDispute = () => {
    const newEvent = {
      event: "Resolved Successfully",
      actor: "Merchant",
      date: new Date().toISOString(),
      note: "Merchant confirmed payment credit and marked dispute as resolved."
    };
    setTimeline([...timeline, newEvent]);
    setStatus("RESOLVED");
  };

  const formatNaira = (amt: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);
  };

  return (
    <div className="space-y-6 p-1 sm:p-4">
      {/* Header navbar backbutton */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/disputes">
          <Button variant="outline" className="border-purp-200 text-purp-900 dark:text-white dark:border-white/10 dark:hover:bg-white/5">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Disputes
          </Button>
        </Link>
        <div>
          <span className="text-xs text-neutral-400 font-bold uppercase tracking-wider">Dispute Reference</span>
          <h1 className="text-xl font-extrabold tracking-tight dark:text-white mt-0.5">{dispute.reference}</h1>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Details Form & Case Info */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
            <CardHeader className="border-b border-purp-100 dark:border-white/5">
              <CardTitle className="text-base text-purp-900 dark:text-white">Case Overview</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-neutral-400">Invoice Number</Label>
                  <p className="font-semibold text-purp-900 dark:text-white mt-0.5">{dispute.invoice_number}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Customer Email</Label>
                  <p className="font-semibold text-purp-900 dark:text-white mt-0.5">{dispute.customer_email}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Payment Rail &amp; Category</Label>
                  <p className="font-semibold text-purp-900 dark:text-white mt-0.5">{dispute.category}</p>
                  <span className="text-xs text-neutral-400 mt-1 block">Rail: {dispute.payment_rail}</span>
                </div>
                <div>
                  <Label className="text-neutral-400">Disputed Amount</Label>
                  <p className="text-lg font-bold text-[#7B2FF7] mt-0.5">{formatNaira(dispute.amount)}</p>
                </div>
              </div>

              <div className="pt-4 border-t border-purp-50 dark:border-white/5 space-y-2">
                <Label className="text-neutral-400">Customer's Issue Statement</Label>
                <p className="text-sm text-neutral-700 dark:text-white/80 bg-neutral-50 dark:bg-white/5 rounded-xl p-4 leading-relaxed">
                  "{dispute.description}"
                </p>
              </div>

              {dispute.payment_reference && (
                <div className="grid gap-4 sm:grid-cols-2 pt-4 border-t border-purp-50 dark:border-white/5">
                  <div>
                    <Label className="text-neutral-400">Payment Reference</Label>
                    <p className="font-mono text-sm font-semibold text-purp-900 dark:text-white mt-0.5">{dispute.payment_reference}</p>
                  </div>
                  {dispute.tx_hash && (
                    <div>
                      <Label className="text-neutral-400">Blockchain Transaction Hash</Label>
                      <p className="font-mono text-xs text-amber-600 dark:text-amber-400 truncate mt-0.5 w-60" title={dispute.tx_hash}>{dispute.tx_hash}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Evidence review panel */}
          <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
            <CardHeader>
              <CardTitle className="text-base text-purp-900 dark:text-white">Case Evidence Log</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border border-dashed border-purp-100 dark:border-white/10 rounded-2xl p-6 text-center space-y-3 bg-neutral-50/50 dark:bg-white/5">
                <FileText className="w-8 h-8 text-[#A78BFA] mx-auto" />
                <div>
                  <p className="font-bold text-sm text-purp-900 dark:text-white">Transaction Screenshot</p>
                  <p className="text-xs text-neutral-400 mt-0.5">Uploaded by {dispute.customer_email}</p>
                </div>
                <a href={dispute.evidence} target="_blank" className="inline-block text-xs font-semibold text-[#7B2FF7] hover:underline">
                  View full high-res attachment ↗
                </a>
              </div>

              {/* Upload addition evidence widget */}
              <div className="pt-4 border-t border-purp-50 dark:border-white/5">
                <Label className="text-neutral-400 text-xs uppercase font-bold tracking-wider mb-2 block">Upload Rebuttal / Bank Log</Label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input type="file" className="bg-neutral-50 dark:bg-white/5 border-purp-200 dark:border-white/10 text-xs" />
                  <Button onClick={() => setEvidenceSubmitted(true)} className="bg-[#7B2FF7] hover:bg-[#924CFF] text-white">
                    <Upload className="w-4 h-4 mr-2" /> Upload
                  </Button>
                </div>
                {evidenceSubmitted && (
                  <p className="text-xs text-emerald-600 font-semibold mt-2">✓ Additional evidence file uploaded to audit database successfully.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action response submission */}
          {status !== "RESOLVED" && (
            <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
              <CardHeader>
                <CardTitle className="text-base text-purp-900 dark:text-white">Submit Case Response</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmitResponse} className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-neutral-400">Message to Customer &amp; DeraLedger Auditing Desk</Label>
                    <textarea
                      rows={4}
                      value={responseMsg}
                      onChange={(e) => setResponseMsg(e.target.value)}
                      placeholder="Provide processor clearing screenshots, confirm virtual account allocation, or confirm bank refund..."
                      className="w-full rounded-xl border border-purp-200 dark:border-white/10 bg-neutral-50 dark:bg-[#12061F] p-4 text-sm text-purp-900 dark:text-white focus:border-[#7B2FF7] focus:outline-none"
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <Button type="button" onClick={handleResolveDispute} className="bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow">
                      Mark as Reconciled
                    </Button>
                    <Button type="submit" className="bg-[#7B2FF7] hover:bg-[#924CFF] text-white">
                      Submit Response
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column - Status, SLA Countdown, Timelines */}
        <div className="space-y-6">
          <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
            <CardHeader className="border-b border-purp-100 dark:border-white/5">
              <CardTitle className="text-base text-purp-900 dark:text-white">Case Parameters</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div>
                <Label className="text-neutral-400">Case Status</Label>
                <div className="mt-1">
                  <span className={`inline-block px-3 py-1 rounded-full border text-sm font-semibold uppercase ${
                    status === "RESOLVED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
                  }`}>
                    {status}
                  </span>
                </div>
              </div>

              <div>
                <Label className="text-neutral-400">Priority Level</Label>
                <p className="font-bold text-sm text-red-600 mt-0.5">{dispute.priority}</p>
              </div>

              <div>
                <Label className="text-neutral-400">SLA Timer</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Clock className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-bold text-amber-500">{dispute.sla}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Case Timeline */}
          <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
            <CardHeader className="border-b border-purp-100 dark:border-white/5">
              <CardTitle className="text-base text-purp-900 dark:text-white">Dispute History Timeline</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6 relative pl-4 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-0.5 before:bg-purp-100 dark:before:bg-white/5">
                {timeline.map((event: any, index: number) => (
                  <div key={index} className="relative space-y-1">
                    {/* Event bullet */}
                    <div className="absolute -left-[17px] top-1.5 w-2 h-2 rounded-full bg-[#7B2FF7] ring-4 ring-white dark:ring-[#12061F]" />
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-purp-955 dark:text-white">{event.event}</span>
                      <span className="text-[10px] text-neutral-400">{new Date(event.date).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">Actor: {event.actor}</p>
                    <p className="text-xs text-neutral-600 dark:text-white/60 mt-1 leading-relaxed">
                      "{event.note}"
                    </p>
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
