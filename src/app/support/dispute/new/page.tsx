"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  ShieldCheck, ArrowLeft, Mail, Phone, AlertTriangle, 
  CheckCircle2, FileText, Sparkles, HelpCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DeraLedgerLogo } from "@/components/ui/deraledger-logo";

export default function CustomerDisputeLodging() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [disputeType, setDisputeType] = useState("Failed Payment");
  const [rail, setRail] = useState("BANK_TRANSFER");
  const [ref, setRef] = useState("");
  const [txHash, setTxHash] = useState("");
  const [description, setDescription] = useState("");
  
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    setTimeout(() => {
      setSubmitted(true);
      setSubmitting(false);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#F8F7FF] dark:bg-[#12061F] flex flex-col justify-between">
      {/* Top Header */}
      <header className="w-full bg-white dark:bg-[#12061F] border-b border-neutral-200 dark:border-white/5 py-4 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-purp-900 dark:bg-white rounded-lg flex items-center justify-center">
            <DeraLedgerLogo className="h-5 w-5" />
          </div>
          <span className="font-extrabold text-purp-950 dark:text-white text-lg tracking-tight">DeraLedger</span>
        </div>
        <Link href="/dispute-resolution">
          <Button variant="ghost" className="text-xs font-semibold text-purp-700 dark:text-[#A78BFA]">
            Dispute Policies ↗
          </Button>
        </Link>
      </header>

      {/* Main Form Area */}
      <main className="flex-1 max-w-xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col justify-center">
        {submitted ? (
          <Card className="border-2 border-emerald-200 bg-white dark:bg-white/5 p-8 text-center space-y-4 shadow-xl">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-purp-950 dark:text-white">Payment Issue Lodged</h1>
            <p className="text-sm text-neutral-500 max-w-sm mx-auto leading-relaxed">
              Your issue reference has been logged. Our integrity reconciliation system and merchant desk have been notified automatically.
            </p>
            <div className="bg-neutral-50 dark:bg-white/5 border rounded-xl p-4 text-xs font-mono text-left max-w-md mx-auto space-y-1">
              <div className="flex justify-between"><span className="text-neutral-400">Case ID:</span><strong>DSP_NEW_{Math.floor(Math.random() * 9000000 + 1000000)}</strong></div>
              <div className="flex justify-between"><span className="text-neutral-400">Category:</span><strong>{disputeType}</strong></div>
              <div className="flex justify-between"><span className="text-neutral-400">Email:</span><strong>{email}</strong></div>
              <div className="flex justify-between"><span className="text-neutral-400">Status:</span><strong className="text-amber-600">OPEN (SLA Auto-ACK)</strong></div>
            </div>
            <div className="pt-4 flex justify-center gap-2">
              <Link href="/dispute-resolution">
                <Button className="bg-[#7B2FF7] hover:bg-[#924CFF] text-white">
                  Learn About Protection SLAs
                </Button>
              </Link>
            </div>
          </Card>
        ) : (
          <Card className="border border-purp-100 dark:border-white/5 bg-white dark:bg-white/5 shadow-2xl rounded-2xl overflow-hidden">
            <CardHeader className="bg-purp-900 text-white p-6 relative">
              <div className="absolute top-4 right-4 flex items-center gap-1.5 bg-emerald-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full tracking-wide">
                <ShieldCheck className="w-3.5 h-3.5" /> SECURED INTEGRITY
              </div>
              <h2 className="text-xl font-bold">Report a Payment Issue</h2>
              <p className="text-xs text-purp-200 mt-1">
                Having double debits or uncredited invoice transfers? Lodge an instant audit trail.
              </p>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Email Address</Label>
                    <Input 
                      id="email"
                      type="email" 
                      placeholder="e.g. you@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="bg-neutral-50 dark:bg-white/5 border-purp-200 dark:border-white/10 text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="phone" className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Phone Number</Label>
                    <Input 
                      id="phone"
                      type="tel" 
                      placeholder="e.g. +234..."
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      className="bg-neutral-50 dark:bg-white/5 border-purp-200 dark:border-white/10 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="disputeType" className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Dispute Category</Label>
                    <select
                      id="disputeType"
                      value={disputeType}
                      onChange={(e) => setDisputeType(e.target.value)}
                      className="w-full bg-neutral-50 dark:bg-[#12061F] border border-purp-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none dark:text-white"
                    >
                      <option value="Failed Payment">Failed Payment</option>
                      <option value="Duplicate Charge">Duplicate Charge</option>
                      <option value="Crypto Payment Not Credited">Crypto Payment Not Credited</option>
                      <option value="Underpayment">Underpayment</option>
                      <option value="Overpayment">Overpayment</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rail" className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Payment Rail Used</Label>
                    <select
                      id="rail"
                      value={rail}
                      onChange={(e) => setRail(e.target.value)}
                      className="w-full bg-neutral-50 dark:bg-[#12061F] border border-purp-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none dark:text-white"
                    >
                      <option value="BANK_TRANSFER">Bank Transfer (Fiat)</option>
                      <option value="CARD">Card Payment (Fiat)</option>
                      <option value="BREET_CRYPTO">Crypto Settlement (Breet)</option>
                      <option value="WALLET">Internal Wallet Balance</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ref" className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Payment Reference / Invoice ID</Label>
                  <Input 
                    id="ref"
                    type="text" 
                    placeholder="e.g. INV-2026-081 or REF-BANK..."
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    required
                    className="bg-neutral-50 dark:bg-white/5 border-purp-200 dark:border-white/10 text-xs"
                  />
                </div>

                {rail === "BREET_CRYPTO" && (
                  <div className="space-y-1.5 animate-in fade-in duration-300">
                    <Label htmlFor="txHash" className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Blockchain Transaction Hash (Optional)</Label>
                    <Input 
                      id="txHash"
                      type="text" 
                      placeholder="e.g. 0x..."
                      value={txHash}
                      onChange={(e) => setTxHash(e.target.value)}
                      className="bg-neutral-50 dark:bg-white/5 border-purp-200 dark:border-white/10 text-xs font-mono"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="description" className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Provide Issue Description</Label>
                  <textarea
                    id="description"
                    rows={3}
                    placeholder="Provide details about debits, delayed confirmations, Breet wallet references..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                    className="w-full rounded-xl border border-purp-200 dark:border-white/10 bg-neutral-50 dark:bg-[#12061F] p-3 text-xs text-purp-900 dark:text-white focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-neutral-400 text-xs font-bold uppercase tracking-wider">Evidence screenshot</Label>
                  <Input type="file" className="bg-neutral-50 dark:bg-white/5 border-purp-200 dark:border-white/10 text-xs" />
                </div>

                <Button type="submit" disabled={submitting} className="w-full bg-[#7B2FF7] hover:bg-[#924CFF] text-white py-3 font-bold rounded-xl shadow-lg shadow-purp-900/10">
                  {submitting ? "Lodging Issue..." : "File Official Complaint"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Bottom Footer */}
      <footer className="w-full py-4 text-center text-xs text-neutral-400 border-t border-neutral-200 dark:border-white/5">
        © {new Date().getFullYear()} DeraLedger. All rights reserved.
      </footer>
    </div>
  );
}
