"use client";

import { use, useState } from "react";
import Link from "next/link";
import { 
  ArrowLeft, Landmark, CreditCard, Bitcoin, Wallet, Clock, 
  CheckCircle2, AlertOctagon, UserCheck, ShieldAlert, ShieldCheck, 
  Coins, ArrowRight, Activity, AlertTriangle, AlertCircle, FileText
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Seed detailed database for case review (matching Sections 10.2 & 10.3)
const MOCK_ADMIN_REFUND_DETAILS: Record<string, any> = {
  "ref-9012-n28": {
    id: "ref-9012-n28",
    reference: "REF_0091827",
    merchant_name: "Tech-Forge Ltd",
    merchant_id: "mch-9028",
    payment_reference: "PAY-BKTRF-902182",
    invoice_id: "inv-88129-tech",
    payment_rail: "BANK_TRANSFER",
    refund_type: "FULL",
    amount: 75000,
    currency: "NGN",
    settlement_status: "UNSETTLED", // Settlement cycle matches Section 6.3
    payout_status: "PENDING",
    status: "APPROVED",
    risk_score: 12,
    internal_note: "Duplicate bank credit confirmed by processor.",
    reason: "Duplicate Payment Reversal Request",
    reserve_balance: 450000,
    settlement_exposure: 0,
    offset_impact: 0,
    processor_status: "PENDING_REVERSAL_CLEARING",
    wallet_address: null,
    network: null,
    tx_hash: null,
    confirmations: 0,
    breet_reference: null,
    timeline: [
      { event: "Refund Request Created", actor: "Merchant (Tech-Forge Ltd)", date: "2026-05-18T10:00:00Z", note: "Created with status REQUESTED." },
      { event: "Eligibility Check Completed", actor: "System Engine", date: "2026-05-18T10:02:10Z", note: "Passed duplicate check and currency match validations." },
      { event: "Risk Review Logged", actor: "Risk Service", date: "2026-05-18T10:05:00Z", note: "Low risk index score of 12/100." },
    ]
  },
  "ref-1028-c92": {
    id: "ref-1028-c92",
    reference: "REF_7710293",
    merchant_name: "Apex Retailers Ltd",
    merchant_id: "mch-1028",
    payment_reference: "PAY-USDT-771029",
    invoice_id: "inv-90129-usdt",
    payment_rail: "BREET_CRYPTO",
    refund_type: "FULL",
    amount: 450000,
    currency: "USDT",
    settlement_status: "SETTLED_TO_MERCHANT", // Payout completed triggers Section 7.2 Offsets
    payout_status: "DISBURSED",
    status: "REVIEWING",
    risk_score: 75, // Stablecoin velocity flags
    internal_note: "Large USDT amount refund request. Client claims wallet destination override.",
    reason: "Destination Wallet Address Mismatch Override",
    reserve_balance: 15000, // Insufficient reserves
    settlement_exposure: 435000, // Dangerous exposure
    offset_impact: 450000,
    processor_status: "BREET_HOLD_AML",
    wallet_address: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    network: "ETH_ERC20",
    tx_hash: "0x8fae3256fb7d102e3b6a9a0e817cfa29a1b802611e9a26374a8109d9e6e8e811",
    confirmations: 42,
    breet_reference: "BREET-REF-88290-X",
    timeline: [
      { event: "Refund Request Created", actor: "Merchant (Apex Retailers Ltd)", date: "2026-05-20T11:00:00Z", note: "Status flagged as REQUESTED." },
      { event: "Settlement Impact Calculated", actor: "Settlement Protection Service", date: "2026-05-20T11:01:05Z", note: "Original payout settled. Negative reserve balance offset calculation required." },
      { event: "Crypto Compliance Review", actor: "Crypto Engine", date: "2026-05-20T11:02:00Z", note: "Breet confirmations: 42. Dest address validated. Risk flagged due to reserve variance." },
    ]
  }
};

export default function AdminRefundDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const detail = MOCK_ADMIN_REFUND_DETAILS[id] || MOCK_ADMIN_REFUND_DETAILS["ref-1028-c92"];
  
  const [status, setStatus] = useState(detail.status);
  const [timeline, setTimeline] = useState(detail.timeline);
  const [payoutFrozen, setPayoutFrozen] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState("");

  const handleApprove = () => {
    const newEvent = {
      event: "Refund Approved",
      actor: "SuperAdmin Desk",
      date: new Date().toISOString(),
      note: "Refund approved for execution. Processor channels dispatched."
    };
    setTimeline([...timeline, newEvent]);
    setStatus("APPROVED");
    setActionSuccessMsg("Refund request status converted to APPROVED. Processing engine has been instructed.");
  };

  const handleReject = () => {
    const newEvent = {
      event: "Refund Denied",
      actor: "SuperAdmin Desk",
      date: new Date().toISOString(),
      note: "Treasury audit failed. Insufficient matching transaction proof."
    };
    setTimeline([...timeline, newEvent]);
    setStatus("REJECTED");
    setActionSuccessMsg("Refund request successfully REJECTED. Merchant has been notified.");
  };

  const handleFreezePayout = () => {
    setPayoutFrozen(true);
    const newEvent = {
      event: "Payout Frozen",
      actor: "SuperAdmin Treasury Desk",
      date: new Date().toISOString(),
      note: "Merchant payout channel frozen for treasury protection."
    };
    setTimeline([...timeline, newEvent]);
    setActionSuccessMsg("Warning: Payout channels for merchant have been locked. No settlement cycle runs allowed.");
  };

  const handleApplyOffset = () => {
    const newEvent = {
      event: "Negative Offset Applied",
      actor: "Settlement Protection Service",
      date: new Date().toISOString(),
      note: `Negative reserve offset of ₦${detail.amount} applied against next settlement cycle.`
    };
    setTimeline([...timeline, newEvent]);
    setStatus("OFFSET_APPLIED");
    setActionSuccessMsg(`Reserve offset executed. ₦${detail.amount} will be deducted from future merchant disbursements.`);
  };

  const formatNaira = (amt: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);
  };

  return (
    <div className="space-y-6">
      {/* Header back button */}
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
          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Transaction Details, Treasury Reserves, Crypto Details */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Section 10.2: Transaction Details */}
          <Card className="bg-white border-neutral-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-neutral-100">
              <CardTitle className="text-sm font-bold text-neutral-900">Transaction Details</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-neutral-400">Merchant Name</Label>
                  <p className="font-semibold text-neutral-800">{detail.merchant_name} (ID: {detail.merchant_id})</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Payment Reference</Label>
                  <p className="font-mono text-sm font-semibold text-neutral-800">{detail.payment_reference}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Original Invoice ID</Label>
                  <p className="font-semibold text-neutral-800">{detail.invoice_id}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Disputed Refund Type &amp; Amount</Label>
                  <p className="text-lg font-bold text-[#6F2CFF]">
                    {formatNaira(detail.amount)} ({detail.currency})
                  </p>
                  <span className="text-xs text-neutral-400">Refund Type: {detail.refund_type}</span>
                </div>
                <div>
                  <Label className="text-neutral-400">Settlement Status</Label>
                  <p className="font-semibold text-neutral-800">{detail.settlement_status}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Disbursement / Payout Status</Label>
                  <p className="font-semibold text-neutral-800">{detail.payout_status}</p>
                </div>
              </div>
              <div className="pt-2 border-t border-neutral-100">
                <Label className="text-neutral-400">Refund Request Reason</Label>
                <p className="text-xs text-neutral-700 bg-neutral-50 rounded-xl p-3 leading-relaxed mt-1">
                  "{detail.reason}"
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Section 10.2: Treasury Details */}
          <Card className="bg-white border-neutral-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-neutral-100">
              <CardTitle className="text-sm font-bold text-neutral-900">Treasury Reserve Verification</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-neutral-400">Available Merchant Reserves</Label>
                  <p className="font-semibold text-neutral-800">{formatNaira(detail.reserve_balance)}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Settlement Exposure Ratio</Label>
                  <p className="font-semibold text-red-600">{formatNaira(detail.settlement_exposure)}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Offset Impact Deductions</Label>
                  <p className="font-semibold text-neutral-800">{formatNaira(detail.offset_impact)}</p>
                </div>
                <div>
                  <Label className="text-neutral-400">Processor Status</Label>
                  <p className="font-semibold text-neutral-800">{detail.processor_status}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 10.2: Crypto Details (If Applicable) */}
          {detail.payment_rail === "BREET_CRYPTO" && (
            <Card className="bg-white border-neutral-200 shadow-sm">
              <CardHeader className="pb-3 border-b border-neutral-100">
                <CardTitle className="text-sm font-bold text-neutral-900 flex items-center gap-1.5">
                  <Bitcoin className="w-4 h-4 text-amber-500" /> Breet Blockchain Parameters
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-neutral-400">Transaction Hash</Label>
                    <p className="font-mono text-xs text-amber-600 truncate w-60" title={detail.tx_hash}>{detail.tx_hash}</p>
                  </div>
                  <div>
                    <Label className="text-neutral-400">Destination Wallet Address</Label>
                    <p className="font-mono text-xs text-neutral-700 truncate w-60" title={detail.wallet_address}>{detail.wallet_address}</p>
                  </div>
                  <div>
                    <Label className="text-neutral-400">Network &amp; Confirmations</Label>
                    <p className="font-semibold text-neutral-800">{detail.network} ({detail.confirmations} confirmations)</p>
                  </div>
                  <div>
                    <Label className="text-neutral-400">Breet RPC Reference</Label>
                    <p className="font-semibold text-neutral-800">{detail.breet_reference}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Status parameters, timelines, and ADMIN ACTIONS */}
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
                    status === "APPROVED" || status === "COMPLETED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
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
              </div>

              {payoutFrozen && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-800 text-xs font-semibold flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-red-600" />
                  <span>Payout frozen for compliance review.</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 10.3: SuperAdmin Actions Trigger */}
          <Card className="bg-white border-neutral-200 shadow-sm">
            <CardHeader className="pb-3 border-b border-neutral-100">
              <CardTitle className="text-sm font-bold text-neutral-900">Treasury Decision Controls</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-2">
              <Button onClick={handleApprove} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs">
                Approve Refund (Disburse Reversal)
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
            </CardContent>
          </Card>

          {/* Section 10.2: Timeline Auditing */}
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
                    <p className="text-xs text-neutral-500 leading-relaxed">
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
