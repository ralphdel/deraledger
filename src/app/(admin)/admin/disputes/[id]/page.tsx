"use client";

import { use, useState } from "react";
import Link from "next/link";
import { 
  ArrowLeft, ShieldAlert, ShieldCheck, Clock, AlertOctagon, UserCheck, 
  Coins, Terminal, FileText, Lock, Globe, Smartphone, HelpCircle,
  AlertTriangle, RefreshCw
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MOCK_ADMIN_DETAIL_DISPUTES: Record<string, any> = {
  "dsp-4091-a83": {
    id: "dsp-4091-a83",
    reference: "DSP_9018274",
    merchant_name: "Tech-Forge Ltd",
    merchant_id: "m_tech_891",
    customer_email: "tunde@company.ng",
    payment_rail: "BANK_TRANSFER",
    category: "Failed Payment",
    amount: 150000,
    status: "OPEN",
    priority: "HIGH",
    sla: "4h remaining",
    risk_score: 32,
    assigned_admin: "Fatima",
    description: "Bank transfer made, account debited, invoice shows unpaid.",
    payment_reference: "REF-BKTRF-90281-NGA",
    logs: [
      { timestamp: "2026-05-20T10:30:10Z", level: "INFO", message: "Paystack initialization received for 150,000 NGN." },
      { timestamp: "2026-05-20T10:32:00Z", level: "WARN", message: "Webhook not received from Paystack channels." },
      { timestamp: "2026-05-20T10:35:00Z", level: "INFO", message: "Query dispatched to Paystack transaction API: Code 404 Transaction Pending." }
    ],
    metadata: {
      customer_ip: "102.89.44.112",
      customer_device: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      merchant_age: "1.2 years",
      merchant_total_disputes: 2
    },
    timeline: [
      { event: "Dispute Opened", actor: "Customer", date: "2026-05-20T10:30:00Z", note: "Customer submitted failed bank transfer complaint." },
      { event: "Auto Acknowledged", actor: "System", date: "2026-05-20T10:30:05Z", note: "Auto-notification emailed to customer & merchant." }
    ]
  },
  "dsp-1120-x92": {
    id: "dsp-1120-x92",
    reference: "DSP_8810231",
    merchant_name: "Apex Retailers Ltd",
    merchant_id: "m_apex_012",
    customer_email: "chioma.ezekiel@gmail.com",
    payment_rail: "BREET_CRYPTO",
    category: "Crypto Payment Not Credited",
    amount: 850000,
    status: "REVIEWING",
    priority: "CRITICAL",
    sla: "12m remaining",
    risk_score: 68,
    assigned_admin: "Jude",
    description: "Sent stablecoin USDT on Ethereum network. Blockchain TX shows over 35 confirmations, but DeraLedger is not verifying the invoice.",
    payment_reference: "BREET-TX-90281048",
    tx_hash: "0x8fae3256fb7d102e3b6a9a0e817cfa29a1b802611e9a26374a8109d9e6e8e811",
    crypto: {
      network: "Ethereum Mainnet (ERC20)",
      confirmations: 38,
      required_confirmations: 12,
      destination_wallet: "0x981bfda302810ab28dca99b0c2830f829c9910d2",
      breet_reference: "BRT-USDT-99180",
      exchange_rate: 1450,
      payout_status: "PENDING_TREASURY_OFFRAMP"
    },
    logs: [
      { timestamp: "2026-05-20T14:45:10Z", level: "INFO", message: "Breet callback triggered: Deposit detected." },
      { timestamp: "2026-05-20T14:46:00Z", level: "INFO", message: "USDT address balance matches requested invoice: 586.20 USDT." },
      { timestamp: "2026-05-20T14:48:00Z", level: "ERROR", message: "Settlement conversion failed: Breet API error 'Provider network mismatch'." }
    ],
    metadata: {
      customer_ip: "105.112.38.99",
      customer_device: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X)",
      merchant_age: "4 months",
      merchant_total_disputes: 5
    },
    timeline: [
      { event: "Dispute Opened", actor: "Customer", date: "2026-05-20T14:45:00Z", note: "Stablecoin payment verification failure logged." },
      { event: "Verification Started", actor: "Crypto Engine", date: "2026-05-20T14:46:10Z", note: "Breet blockchain API verification query initiated." },
      { event: "Reviewing State", actor: "Admin Agent", date: "2026-05-20T15:00:00Z", note: "Assigned to treasury representative for wallet match." }
    ]
  }
};

export default function AdminDisputeDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const dispute = MOCK_ADMIN_DETAIL_DISPUTES[id] || MOCK_ADMIN_DETAIL_DISPUTES["dsp-4091-a83"];

  const [status, setStatus] = useState(dispute.status);
  const [timeline, setTimeline] = useState(dispute.timeline);
  const [payoutFrozen, setPayoutFrozen] = useState(false);
  const [assignedAdmin, setAssignedAdmin] = useState(dispute.assigned_admin);
  const [actionPerformed, setActionPerformed] = useState("");

  const handleApproveRefund = () => {
    setStatus("RESOLVED");
    setTimeline([...timeline, {
      event: "Refund Approved",
      actor: "SuperAdmin",
      date: new Date().toISOString(),
      note: `Approved refund of ${formatNaira(dispute.amount)} to customer. Offset adjusted.`
    }]);
    setActionPerformed("Approved full refund reversing the payment via Paystack processor channels.");
  };

  const handleRejectDispute = () => {
    setStatus("REJECTED");
    setTimeline([...timeline, {
      event: "Dispute Rejected",
      actor: "SuperAdmin",
      date: new Date().toISOString(),
      note: "Dispute rejected. Verified that customer was either not debited or has been refunded."
    }]);
    setActionPerformed("Rejected the dispute case as invalid or double-debited log mismatch.");
  };

  const handleFreezePayout = () => {
    setPayoutFrozen(!payoutFrozen);
    setTimeline([...timeline, {
      event: payoutFrozen ? "Payout Unfrozen" : "Payout Frozen",
      actor: "SuperAdmin",
      date: new Date().toISOString(),
      note: payoutFrozen ? "SuperAdmin released the payout hold." : "SuperAdmin placed a payout hold on the merchant account."
    }]);
  };

  const formatNaira = (amt: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);
  };

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
        {/* Left Column: Transaction Metadata & Logs */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Case Audit Details</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-neutral-400">Merchant Info</Label>
                  <p className="font-bold text-neutral-900 mt-0.5">{dispute.merchant_name} (ID: {dispute.merchant_id})</p>
                  <p className="text-xs text-neutral-400 mt-0.5">Account Age: {dispute.metadata.merchant_age}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Customer Email</Label>
                  <p className="font-bold text-neutral-900 mt-0.5">{dispute.customer_email}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Payment Rail &amp; Reference</Label>
                  <p className="font-bold text-neutral-900 mt-0.5">{dispute.category}</p>
                  <p className="font-mono text-xs text-neutral-500 mt-0.5">Ref: {dispute.payment_reference}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Disputed Amount</Label>
                  <p className="text-lg font-bold text-[#6F2CFF] mt-0.5">{formatNaira(dispute.amount)}</p>
                </div>
              </div>

              <div className="pt-4 border-t border-neutral-100 space-y-2">
                <Label className="text-neutral-400">Customer Description</Label>
                <p className="text-sm text-neutral-700 bg-neutral-50 rounded-xl p-4">
                  "{dispute.description}"
                </p>
              </div>

              {/* Rail specific block (fiat or crypto) */}
              {dispute.payment_rail === "BREET_CRYPTO" && dispute.crypto && (
                <div className="pt-4 border-t border-neutral-100 space-y-4">
                  <div className="flex items-center gap-2 text-amber-600 font-bold text-sm">
                    <Coins className="w-4 h-4" /> Breet Crypto Verification Details
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 text-xs bg-amber-50/50 border border-amber-100 rounded-xl p-4">
                    <div>
                      <span className="text-neutral-400 block">Blockchain Network</span>
                      <strong className="text-neutral-800">{dispute.crypto.network}</strong>
                    </div>
                    <div>
                      <span className="text-neutral-400 block">Required vs Total Confirmations</span>
                      <strong className="text-neutral-800">{dispute.crypto.confirmations} / {dispute.crypto.required_confirmations} Confirmations</strong>
                    </div>
                    <div>
                      <span className="text-neutral-400 block">Destination wallet address</span>
                      <strong className="font-mono text-[11px] text-neutral-800 block truncate w-60">{dispute.crypto.destination_wallet}</strong>
                    </div>
                    <div>
                      <span className="text-neutral-400 block">Breet Payout Status</span>
                      <strong className="text-neutral-800">{dispute.crypto.payout_status}</strong>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Processor System Logs */}
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200 flex flex-row items-center gap-2">
              <Terminal className="w-5 h-5 text-neutral-500" />
              <CardTitle className="text-base text-neutral-900">Processor logs &amp; Callback payloads</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="bg-[#0B1020] text-neutral-200 rounded-xl p-4 font-mono text-xs space-y-2 max-h-60 overflow-y-auto">
                {dispute.logs.map((log: any, idx: number) => (
                  <div key={idx} className="flex gap-2">
                    <span className="text-neutral-500 shrink-0">[{log.timestamp}]</span>
                    <span className={log.level === "ERROR" ? "text-red-400 font-bold" : log.level === "WARN" ? "text-amber-400 font-bold" : "text-emerald-400"}>
                      {log.level}
                    </span>
                    <span>{log.message}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Case Controls & Timelines */}
        <div className="space-y-6">
          {/* Admin action card */}
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Operational Actions</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div>
                <Label className="text-neutral-400">Case status</Label>
                <div className="mt-1">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full border text-xs font-bold ${
                    status === "RESOLVED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
                  }`}>
                    {status}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-100 flex flex-col gap-2">
                <Button onClick={handleApproveRefund} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                  Approve Refund
                </Button>
                <Button onClick={handleRejectDispute} variant="outline" className="w-full border-neutral-200 text-neutral-700 hover:bg-neutral-50">
                  Reject Dispute
                </Button>
                
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

          {/* User Information & Risk Score */}
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Risk Profile Index</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-neutral-400">Risk Score:</span>
                <span className={`font-bold px-2 py-0.5 border rounded-full ${
                  dispute.risk_score >= 60 ? "bg-red-50 text-red-600 border-red-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"
                }`}>
                  {dispute.risk_score}/100
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-neutral-600">
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  <span>IP: {dispute.metadata.customer_ip}</span>
                </div>
                <div className="flex items-center gap-2 text-neutral-600">
                  <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate w-56" title={dispute.metadata.customer_device}>Device: {dispute.metadata.customer_device}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Timeline View */}
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
