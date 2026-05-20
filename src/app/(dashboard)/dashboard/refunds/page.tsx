"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { 
  ArrowLeft, RefreshCw, Landmark, CreditCard, Bitcoin, Wallet,
  HelpCircle, CheckCircle2, AlertTriangle, ArrowRight, Sparkles, AlertCircle, FileText, Upload
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Seed active refund request database matching PRD status lifecycle
const INITIAL_REFUND_REQUESTS = [
  {
    id: "ref-9012-n28",
    reference: "REF_0091827",
    invoice_number: "INV-2026-061",
    payment_reference: "PAY-BKTRF-902182",
    customer_name: "Samuel Adebayo",
    customer_email: "samuel.adebayo@gmail.com",
    refund_type: "FULL",
    payment_rail: "BANK_TRANSFER",
    amount: 75000,
    status: "COMPLETED", // Status Lifecycle
    risk_score: 12,
    created_at: "2026-05-18T10:00:00Z"
  },
  {
    id: "ref-4431-b88",
    reference: "REF_8810231",
    invoice_number: "INV-2026-054",
    payment_reference: "PAY-CARD-881092",
    customer_name: "Khalid Mohammed",
    customer_email: "khalid.m@ventures-ng.com",
    refund_type: "PARTIAL",
    payment_rail: "CARD",
    amount: 120000,
    status: "OFFSET_APPLIED", // Status Lifecycle
    risk_score: 40,
    created_at: "2026-05-19T14:30:00Z"
  },
  {
    id: "ref-1028-c92",
    reference: "REF_7710293",
    invoice_number: "INV-2026-088",
    payment_reference: "PAY-USDT-771029",
    customer_name: "Alicia Jones",
    customer_email: "alicia.jones@outlook.com",
    refund_type: "FULL",
    payment_rail: "BREET_CRYPTO",
    amount: 450000,
    status: "REVIEWING", // Status Lifecycle
    risk_score: 75,
    created_at: "2026-05-20T11:00:00Z"
  }
];

// Helper to autofill customer names based on payment reference lookup
const PAYMENT_REFERENCE_DIRECTORY: Record<string, string> = {
  "PAY-BKTRF-902182": "Samuel Adebayo",
  "PAY-CARD-881092": "Khalid Mohammed",
  "PAY-USDT-771029": "Alicia Jones",
  "PAY-NG-9018": "Tunde Ezekiel",
  "PAY-BTC-0081": "Chioma Eze"
};

export default function MerchantRefundRequests() {
  const [requests, setRequests] = useState(INITIAL_REFUND_REQUESTS);
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [txRef, setTxRef] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundType, setRefundType] = useState("FULL");
  const [refundReason, setRefundReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [rail, setRail] = useState("BANK_TRANSFER");

  // Status logs
  const [actionSuccess, setActionSuccess] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // Customer Name Autofill derived from directory lookup
  const resolvedCustomerName = useMemo(() => {
    return PAYMENT_REFERENCE_DIRECTORY[txRef] || "Unidentified Transaction Reference";
  }, [txRef]);

  const handleCreateRefundRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!txRef || !refundAmount || !refundReason) return;

    const newRequest = {
      id: `ref-new-${Math.floor(Math.random() * 90000 + 10000)}`,
      reference: `REF_REQ_${Math.floor(Math.random() * 9000000 + 1000000)}`,
      invoice_number: "INV-2026-GEN",
      payment_reference: txRef,
      customer_name: resolvedCustomerName,
      customer_email: "customer@registered-ledger.ng",
      refund_type: refundType,
      payment_rail: rail,
      amount: Number(refundAmount),
      status: "REQUESTED", // All refunds start in REQUESTED status
      risk_score: rail === "BREET_CRYPTO" ? 65 : 22,
      created_at: new Date().toISOString()
    };

    setRequests([newRequest, ...requests]);
    setIsModalOpen(false);
    setActionSuccess(true);
    
    if (rail === "BREET_CRYPTO") {
      setSuccessMsg("Crypto refund request successfully queued as REQUESTED. Blockchain transaction matches are pending mandatory SuperAdmin AML and wallet confirmation validation.");
    } else {
      setSuccessMsg(`Refund request for ${formatNaira(Number(refundAmount))} submitted. Current status set to REQUESTED pending eligibility and treasury balance offsets.`);
    }

    // Reset fields
    setTxRef("");
    setRefundAmount("");
    setRefundReason("");
    setInternalNote("");
  };

  const formatNaira = (amt: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);
  };

  // Operational metrics calculated solely from mock database
  const metrics = useMemo(() => {
    const pending = requests.filter(r => r.status === "REQUESTED" || r.status === "REVIEWING").length;
    const approved = requests.filter(r => r.status === "APPROVED" || r.status === "COMPLETED").length;
    const offsets = requests.filter(r => r.status === "OFFSET_APPLIED").length;
    const crypto = requests.filter(r => r.payment_rail === "BREET_CRYPTO" && r.status === "REVIEWING").length;
    const duplicates = 1; // auto mock matched
    return { pending, approved, offsets, crypto, duplicates };
  }, [requests]);

  return (
    <div className="space-y-8 p-1 sm:p-4">
      {/* Upper header navbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/disputes">
            <Button variant="outline" className="border-purp-200 text-purp-900 dark:text-white dark:border-white/10 dark:hover:bg-white/5">
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to Disputes
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight dark:text-white">Refund Requests</h1>
            <p className="text-neutral-500 dark:text-white/40 text-sm mt-1">
              Treasury-safe refund management infrastructure. Reversals are subject to negative offsets and risk analysis audits.
            </p>
          </div>
        </div>
        
        {/* REQUEST REFUND TRIGGER - MERCHANTS CAN ONLY REQUEST */}
        <Button onClick={() => setIsModalOpen(true)} className="bg-[#7B2FF7] hover:bg-[#924CFF] text-white">
          <RefreshCw className="w-4 h-4 mr-2" /> Request Refund
        </Button>
      </div>

      {/* SLA and Compliance Notices (Section 17) */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-blue-50/50 border border-blue-200 dark:bg-white/5 dark:border-white/5 dark:text-white/80 rounded-2xl p-4 flex gap-3 text-xs text-blue-900 leading-relaxed">
          <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 dark:text-[#A78BFA]" />
          <div>
            <span className="font-bold block mb-1">Treasury notice (Section 17.1)</span>
            “Refund approvals may be subject to settlement verification and treasury review.”
          </div>
        </div>

        <div className="bg-amber-50/50 border border-amber-200 dark:bg-white/5 dark:border-white/5 dark:text-white/80 rounded-2xl p-4 flex gap-3 text-xs text-amber-900 leading-relaxed">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 dark:text-amber-400" />
          <div>
            <span className="font-bold block mb-1">Crypto notice (Section 17.2)</span>
            “Cryptocurrency refunds require manual verification and may be irreversible once executed.”
          </div>
        </div>
      </div>

      {/* Operational Metrics (Section 4.2) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Pending Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-extrabold text-purp-900 dark:text-white">{metrics.pending}</span>
            <span className="block text-[10px] text-neutral-500 mt-1">awaiting processing</span>
          </CardContent>
        </Card>

        <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Approved Refunds</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-extrabold text-purp-900 dark:text-white">{metrics.approved}</span>
            <span className="block text-[10px] text-neutral-500 mt-1">processed successfully</span>
          </CardContent>
        </Card>

        <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-red-500">Settlement Offsets</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-extrabold text-purp-900 dark:text-white">{metrics.offsets}</span>
            <span className="block text-[10px] text-neutral-500 mt-1">negative offsets applied</span>
          </CardContent>
        </Card>

        <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Crypto Reviews</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-extrabold text-purp-900 dark:text-white">{metrics.crypto}</span>
            <span className="block text-[10px] text-neutral-500 mt-1">awaiting compliance audit</span>
          </CardContent>
        </Card>

        <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Auto Reversals</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-extrabold text-purp-900 dark:text-white">{metrics.duplicates}</span>
            <span className="block text-[10px] text-neutral-500 mt-1">duplicate debit matches</span>
          </CardContent>
        </Card>
      </div>

      {actionSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-800 text-xs space-y-1">
          <p className="font-bold flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Refund Status Set to REQUESTED
          </p>
          <p>{successMsg}</p>
        </div>
      )}

      {/* Active Refund requests ledger table */}
      <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5">
        <CardHeader>
          <CardTitle className="text-base text-purp-900 dark:text-white">Active Refund Requests Ledger</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-neutral-50 dark:bg-white/5 border-b border-purp-100 dark:border-white/5 text-xs font-bold text-neutral-400 uppercase tracking-wider">
                  <th className="px-6 py-4">Refund Ref</th>
                  <th className="px-6 py-4">Invoice / Customer</th>
                  <th className="px-6 py-4">Payment Rail / Type</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-purp-50 dark:divide-white/5">
                {requests.map((ref) => {
                  const getStatusStyles = (status: string) => {
                    switch (status) {
                      case "COMPLETED": return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400";
                      case "OFFSET_APPLIED": return "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-400";
                      case "REVIEWING": return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400";
                      case "REJECTED": return "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400";
                      default: return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400";
                    }
                  };

                  return (
                    <tr key={ref.id} className="hover:bg-neutral-50/50 dark:hover:bg-white/[0.02]">
                      <td className="px-6 py-4 font-mono font-bold text-purp-900 dark:text-white">
                        {ref.reference}
                        <span className="block text-[10px] text-neutral-400 font-normal mt-0.5">TX Ref: {ref.payment_reference}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-neutral-700 dark:text-white/80">{ref.customer_name}</span>
                        <span className="block text-xs text-neutral-400 truncate mt-0.5 w-40">{ref.customer_email}</span>
                      </td>
                      <td className="px-6 py-4 space-y-1">
                        <div className="text-xs font-semibold text-neutral-600 dark:text-white/60">{ref.payment_rail}</div>
                        <span className="inline-block px-1.5 py-0.5 bg-neutral-100 dark:bg-white/5 rounded text-[9px] font-bold text-neutral-500 dark:text-white/60">
                          {ref.refund_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-bold text-purp-900 dark:text-white">
                        {formatNaira(ref.amount)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${getStatusStyles(ref.status)}`}>
                          {ref.status.replace(/_/g, " ")}
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

      {/* REQUEST REFUND MODAL (Section 5.2) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <Card className="max-w-md w-full bg-white dark:bg-[#1A0B2E] border border-purp-200 dark:border-white/10 shadow-2xl rounded-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <CardHeader className="bg-purp-900 text-white p-5">
              <h2 className="text-lg font-bold">Request a Refund</h2>
              <p className="text-xs text-purp-200 mt-0.5">Submissions route to eligibility evaluation. Instant payouts are disabled.</p>
            </CardHeader>
            <CardContent className="p-5">
              <form onSubmit={handleCreateRefundRequest} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Transaction Reference</Label>
                  <Input 
                    type="text" 
                    placeholder="Enter PAY- reference... (e.g. PAY-BKTRF-902182)" 
                    value={txRef}
                    onChange={(e) => setTxRef(e.target.value)}
                    required
                    className="bg-neutral-50 dark:bg-white/5 border-purp-200 dark:border-white/10 text-xs font-mono"
                  />
                  {txRef && (
                    <p className="text-[10px] text-emerald-600 font-bold">
                      ✓ Auto-filled Customer Name: {resolvedCustomerName}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Payment Rail Used</Label>
                  <select
                    value={rail}
                    onChange={(e) => setRail(e.target.value)}
                    className="w-full bg-neutral-50 dark:bg-[#12061F] border border-purp-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none dark:text-white"
                  >
                    <option value="BANK_TRANSFER">Bank Reversal (Paystack)</option>
                    <option value="CARD">Card Reversal (Paystack)</option>
                    <option value="BREET_CRYPTO">Crypto Reversal (Breet Compliance Queue)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Refund Type</Label>
                    <select
                      value={refundType}
                      onChange={(e) => setRefundType(e.target.value)}
                      className="w-full bg-neutral-50 dark:bg-[#12061F] border border-purp-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none dark:text-white"
                    >
                      <option value="FULL">Full Refund</option>
                      <option value="PARTIAL">Partial Refund</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Amount (₦)</Label>
                    <Input 
                      type="number" 
                      placeholder="e.g. 50000" 
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      required
                      className="bg-neutral-50 dark:bg-white/5 border-purp-200 dark:border-white/10 text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Refund Reason</Label>
                  <textarea
                    rows={2}
                    placeholder="Merchant duplicate credit, customer double transfer, cancelled service..."
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    required
                    className="w-full rounded-xl border border-purp-200 dark:border-white/10 bg-neutral-50 dark:bg-[#12061F] p-3 text-xs text-purp-900 dark:text-white focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Internal Note (Optional)</Label>
                  <Input 
                    type="text" 
                    placeholder="Add operational memo..." 
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    className="bg-neutral-50 dark:bg-white/5 border-purp-200 dark:border-white/10 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Supporting Evidence (Optional)</Label>
                  <div className="flex items-center justify-center border border-dashed border-purp-200 dark:border-white/10 rounded-xl p-3 bg-neutral-50 dark:bg-white/5">
                    <Upload className="w-4 h-4 text-neutral-400 mr-2" />
                    <span className="text-[10px] text-neutral-400">Click to upload receipts / screenshots</span>
                  </div>
                </div>

                {rail === "BREET_CRYPTO" && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[10px] text-amber-800 flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span><strong>Mandatory warning:</strong> Cryptocurrency refunds require manual verification and approval. Blockchain transactions may be irreversible once executed.</span>
                  </div>
                )}

                <div className="flex gap-2 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)} className="border-purp-200 text-xs">
                    Cancel
                  </Button>
                  {/* SUBMIT BUTTON - MUST BE Submit Refund Request */}
                  <Button type="submit" className="bg-[#7B2FF7] hover:bg-[#924CFF] text-white text-xs font-bold">
                    Submit Refund Request
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
