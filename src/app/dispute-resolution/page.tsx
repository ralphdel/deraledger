"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { 
  ShieldCheck, ShieldAlert, Clock, ArrowRight, CheckCircle2, 
  HelpCircle, Activity, FileText, Lock, RefreshCcw, DollarSign, 
  Bitcoin, Database, Search, ChevronDown, ChevronUp, AlertCircle,
  ExternalLink, Layers, ArrowDownUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeraLedgerLogo } from "@/components/ui/deraledger-logo";

// FAQ Questions & Answers
const FAQ_ITEMS = [
  {
    category: "crypto",
    question: "How long does a crypto payment take to reflect on my invoice?",
    answer: "Crypto transactions processed via the Breet-powered rail typically credit in under 30 minutes. DeraLedger requires a set number of blockchain confirmations (dependent on the network utilized, e.g., Bitcoin or stablecoins) before automatically confirming the invoice as paid."
  },
  {
    category: "crypto",
    question: "What happens if I send crypto on the wrong network/chain?",
    answer: "Assets transferred on unsupported networks are generally unrecoverable due to blockchain irreversibility. If a wrong-network transfer occurs, report it immediately with the Transaction Hash so our crypto reconciliation desk can audit if the asset can be retrieved manually from our secure treasury partners."
  },
  {
    category: "refunds",
    question: "How are refunds processed for card and bank transfer payments?",
    answer: "Fiat refunds can be initiated by the merchant or requested via admin dispute review. Once approved, the funds are reversed through our payment processors back to your original bank account or card. Fiat reversals typically settle within 24 to 72 hours, depending on banking clearing cycles."
  },
  {
    category: "refunds",
    question: "Can I get a refund for a crypto payment?",
    answer: "Yes, but crypto refunds are strictly processed manually under strict wallet verification procedures. Due to the irreversible nature of blockchain rails, our security team must manually verify the destination wallet address and secure merchant authorization. We will never auto-process or auto-send crypto refunds."
  },
  {
    category: "billing",
    question: "What is DeraLedger's subscription billing protection?",
    answer: "We guarantee transparent billing for DeraLedger workspace plans. If you complain about a duplicate plan charge, failed cancellation, or incorrect tier billing, our Billing Dispute desk will resolve the issue and reverse the incorrect charge within 24 hours."
  },
  {
    category: "transfers",
    question: "My bank account was debited, but the invoice still says 'Unpaid'. What should I do?",
    answer: "This is a 'Failed Payment' or 'Delayed Confirmation' dispute. Use the 'Report a Payment Issue' form on this page or from your invoice footer to submit your debit transaction reference. Our Fiat Reconciliation Engine will automatically query the processor logs and credit your invoice within 24 hours."
  }
];

export default function DisputeResolutionPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFaqCategory, setActiveFaqCategory] = useState("all");
  const [expandedFaqIndex, setExpandedFaqIndex] = useState<number | null>(null);

  // Filter FAQs based on search and category
  const filteredFaqs = useMemo(() => {
    return FAQ_ITEMS.filter((faq) => {
      const matchesCategory = activeFaqCategory === "all" || faq.category === activeFaqCategory;
      const matchesSearch = faq.question.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            faq.answer.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, activeFaqCategory]);

  const toggleFaq = (index: number) => {
    setExpandedFaqIndex(expandedFaqIndex === index ? null : index);
  };

  return (
    <div className="min-h-screen bg-[#0B0615] text-white selection:bg-[#6D28FF]/30 antialiased font-sans overflow-x-hidden w-full">
      {/* ── HEADER ── */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.04] bg-[#0B0615]/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5" aria-label="DeraLedger home">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-[0_0_10px_rgba(255,255,255,0.1)]">
              <DeraLedgerLogo className="h-5 w-5" />
            </div>
            <span className="text-base font-bold text-white tracking-tight">DeraLedger</span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            <Link href="/#workflow" className="text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white transition-colors">How it works</Link>
            <Link href="/#features" className="text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white transition-colors">Features</Link>
            <Link href="/#pricing" className="text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white transition-colors">Pricing</Link>
            <Link href="/dispute-resolution" className="text-xs font-bold uppercase tracking-wider text-[#A78BFA] hover:text-[#C4B5FD] transition-colors">Disputes</Link>
          </nav>

          {/* Auth Actions */}
          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden sm:block">
              <Button variant="ghost" className="h-9 px-4 text-xs font-bold uppercase tracking-wider text-white/80 hover:text-white hover:bg-white/5">
                Log in
              </Button>
            </Link>
            <Link href="/onboarding">
              <Button className="h-9 px-4 text-xs font-bold uppercase tracking-wider bg-white text-[#0B0615] hover:bg-gray-200 shadow-[0_0_10px_rgba(255,255,255,0.15)] border-0">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="pt-16 pb-20">
        
        {/* ── HERO SECTION ── */}
        <section className="relative py-24 sm:py-32 overflow-hidden border-b border-white/[0.04]">
          {/* Ambient Purple/Violet Blurs */}
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[60%] rounded-full bg-[#6D28FF]/15 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[60%] rounded-full bg-[#A78BFA]/10 blur-[130px] pointer-events-none" />

          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-[#A78BFA] mb-6 shadow-sm">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>DeraLedger Payment Integrity Framework</span>
            </div>
            
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.1] max-w-4xl mx-auto mb-6">
              Transparent Payment Protection <br className="hidden sm:inline" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#A78BFA] to-[#C4B5FD]">
                &amp; Dispute Resolution
              </span>
            </h1>
            
            <p className="text-neutral-400 text-base sm:text-lg lg:text-xl max-w-3xl mx-auto leading-relaxed mb-10">
              We provide structured transaction verification, instant billing reconciliation, and prompt refund operations across fiat, bank transfers, and Breet-powered crypto rails.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/support/dispute/new">
                <Button className="w-full sm:w-auto h-12 px-8 text-sm font-bold uppercase tracking-wider bg-[#7B2FF7] hover:bg-[#924CFF] text-white border-0 shadow-lg shadow-[#7B2FF7]/20 transition-all">
                  Report a Payment Issue
                </Button>
              </Link>
              <Link href="/support">
                <Button variant="outline" className="w-full sm:w-auto h-12 px-8 text-sm font-bold uppercase tracking-wider border-white/10 hover:bg-white/5 hover:text-white transition-all">
                  Contact Support
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ── HOW WE HANDLE DISPUTES (timeline flow) ── */}
        <section className="py-20 border-b border-white/[0.04] bg-[#0E071B]/30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-4">
                Structured Resolution Lifecycle
              </h2>
              <p className="text-sm text-neutral-400">
                Every payment discrepancy is tracked through our single unified dispute infrastructure, driving automated auditing or direct agent review to settlement.
              </p>
            </div>

            {/* Timelines and Steps */}
            <div className="grid gap-6 md:grid-cols-5 relative max-w-5xl mx-auto">
              {/* Connector line (desktop) */}
              <div className="hidden md:block absolute top-[44px] left-[5%] right-[5%] h-0.5 bg-gradient-to-r from-[#6D28FF]/50 to-[#A78BFA]/20 z-0" />
              
              {/* Step 1 */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative z-10 text-center flex flex-col items-center">
                <div className="w-12 h-12 rounded-xl bg-[#6D28FF]/20 text-[#A78BFA] flex items-center justify-center font-bold mb-4 border border-[#6D28FF]/30">
                  1
                </div>
                <h3 className="font-bold text-sm text-white mb-2">Issue Reported</h3>
                <p className="text-xs text-neutral-400">Merchant or customer logs payment discrepancy or failed credit.</p>
              </div>

              {/* Step 2 */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative z-10 text-center flex flex-col items-center">
                <div className="w-12 h-12 rounded-xl bg-[#6D28FF]/20 text-[#A78BFA] flex items-center justify-center font-bold mb-4 border border-[#6D28FF]/30">
                  2
                </div>
                <h3 className="font-bold text-sm text-white mb-2">Verification</h3>
                <p className="text-xs text-neutral-400">Reconciliation engines audit processor webhooks and block logs.</p>
              </div>

              {/* Step 3 */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative z-10 text-center flex flex-col items-center">
                <div className="w-12 h-12 rounded-xl bg-[#6D28FF]/20 text-[#A78BFA] flex items-center justify-center font-bold mb-4 border border-[#6D28FF]/30">
                  3
                </div>
                <h3 className="font-bold text-sm text-white mb-2">Evidence Review</h3>
                <p className="text-xs text-neutral-400">Security agents audit submitted screenshots, tx hashes, and details.</p>
              </div>

              {/* Step 4 */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative z-10 text-center flex flex-col items-center">
                <div className="w-12 h-12 rounded-xl bg-[#6D28FF]/20 text-[#A78BFA] flex items-center justify-center font-bold mb-4 border border-[#6D28FF]/30">
                  4
                </div>
                <h3 className="font-bold text-sm text-white mb-2">Resolution</h3>
                <p className="text-xs text-neutral-400">Initiate automated fiat refund or manual verified crypto return.</p>
              </div>

              {/* Step 5 */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 relative z-10 text-center flex flex-col items-center">
                <div className="w-12 h-12 rounded-xl bg-[#6D28FF]/20 text-[#A78BFA] flex items-center justify-center font-bold mb-4 border border-[#6D28FF]/30">
                  5
                </div>
                <h3 className="font-bold text-sm text-white mb-2">Audit Closure</h3>
                <p className="text-xs text-neutral-400">State is updated, ledger is balanced, and compliance logs saved.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── SUPPORTED & UNSUPPORTED DISPUTES ── */}
        <section className="py-20 border-b border-white/[0.04]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-2">
              
              {/* Left Column: Supported Disputes */}
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-white">Supported Payment Protection</h2>
                </div>
                
                <p className="text-sm text-neutral-400 mb-8">
                  We resolve all operational, technical, and processing discrepancies related to transactions and billing integrity on our infrastructure.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="font-semibold text-xs text-emerald-400 uppercase tracking-wider mb-1">Failed Payments</div>
                    <p className="text-xs text-neutral-400">User accounts debited but system invoices/metadata not updated.</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="font-semibold text-xs text-emerald-400 uppercase tracking-wider mb-1">Duplicate Charges</div>
                    <p className="text-xs text-neutral-400">Multiple charges occurring for the same invoice or workspace plan.</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="font-semibold text-xs text-emerald-400 uppercase tracking-wider mb-1">Crypto Not Credited</div>
                    <p className="text-xs text-neutral-400">On-chain blockchain transfers confirmed but unpaid on invoices.</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="font-semibold text-xs text-emerald-400 uppercase tracking-wider mb-1">Subscription Errors</div>
                    <p className="text-xs text-neutral-400">Billed for wrong subscription plans or after active cancellations.</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="font-semibold text-xs text-emerald-400 uppercase tracking-wider mb-1">Delayed Settlements</div>
                    <p className="text-xs text-neutral-400">Offramp or withdrawal delays from crypto conversions to local fiat.</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="font-semibold text-xs text-emerald-400 uppercase tracking-wider mb-1">Unauthorized Debits</div>
                    <p className="text-xs text-neutral-400">Suspected compromise of merchant profiles or API keys.</p>
                  </div>
                </div>
              </div>

              {/* Right Column: Unsupported Disputes */}
              <div className="space-y-6 lg:border-l lg:border-white/10 lg:pl-12">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-white">Explicitly Unsupported Disputes</h2>
                </div>

                <p className="text-sm text-neutral-400 mb-6">
                  Deraledger provides pure collections, receivables, and payment infrastructure. To maintain operational neutrality, we strictly do NOT arbitrate buyer-seller commercial agreements.
                </p>

                <div className="bg-[#1F0C1B] border border-red-500/20 rounded-2xl p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-xs text-white uppercase tracking-wider">Commercial Disclaimer</h4>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        “Deraledger facilitates billing and payment infrastructure but is not party to the underlying commercial agreement between merchants and customers.”
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-white/5 pt-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <span className="text-red-500 text-sm">✕</span>
                      <span>Product quality or service dissatisfaction</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <span className="text-red-500 text-sm">✕</span>
                      <span>Freelancer project scope conflicts</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <span className="text-red-500 text-sm">✕</span>
                      <span>Merchant contract delivery delays</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-neutral-400">
                      <span className="text-red-500 text-sm">✕</span>
                      <span>General contractual/arbitration disputes</span>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-neutral-500 leading-relaxed italic">
                  Customers who experience service-delivery failures must contact the merchant directly to resolve disagreements. Deraledger cannot reverse or escrow funds based on contractual disputes.
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* ── CRYPTO PAYMENT PROTECTION SECTION ── */}
        <section className="py-20 border-b border-white/[0.04] bg-[#0A0514]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="relative rounded-3xl border border-white/10 bg-gradient-to-r from-[#120826] to-[#0A0414] p-8 md:p-12 overflow-hidden shadow-2xl">
              <div className="absolute top-[-30%] right-[-10%] w-[350px] h-[350px] bg-[#6D28FF]/10 rounded-full blur-[80px] pointer-events-none" />
              
              <div className="max-w-3xl relative z-10 space-y-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 text-xs font-semibold text-[#A78BFA] rounded-full">
                  <Bitcoin className="w-3.5 h-3.5" />
                  <span>Breet Crypto Integration Partner</span>
                </div>

                <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-white leading-tight">
                  Breet-Powered Crypto Payment Protection
                </h2>

                <p className="text-neutral-300 text-sm sm:text-base leading-relaxed">
                  DeraLedger utilizes specialized crypto rails to track on-chain transfers. Our Crypto Verification Engine monitors ledger confirmations automatically to match your payment accurately against invoices.
                </p>

                <div className="grid gap-4 sm:grid-cols-3 pt-4">
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="font-semibold text-xs text-white uppercase tracking-wider mb-1">On-Chain Monitoring</div>
                    <p className="text-xs text-neutral-400">Verifying transaction hash, network confirmation metrics, and wallet destination addresses.</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="font-semibold text-xs text-white uppercase tracking-wider mb-1">Asset Offramping</div>
                    <p className="text-xs text-neutral-400">Secure automated fiat NGN offramping backed by verified market conversion rates.</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    <div className="font-semibold text-xs text-white uppercase tracking-wider mb-1">Discrepancy Alerts</div>
                    <p className="text-xs text-neutral-400">Detecting underpayments, overpayments, or network mismatches instantly.</p>
                  </div>
                </div>

                {/* Important notice banner */}
                <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-xs text-amber-400">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold uppercase tracking-wider block mb-1">Crypto Irreversibility Disclaimer</span>
                    <span>Cryptocurrency transactions are completely irreversible once confirmed on-chain. DeraLedger cannot guarantee blockchain reversals or retrievals for unsupported chain transfers. Address verification is mandatory for refunds.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── RESOLUTION TIMELINES & SLAS ── */}
        <section className="py-20 border-b border-white/[0.04]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-12">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-3">
                Resolution SLAs & Timelines
              </h2>
              <p className="text-sm text-neutral-400">
                We respect your business operations and adhere to public SLAs. If a case breaches these timelines, it is automatically escalated.
              </p>
            </div>

            <div className="max-w-4xl mx-auto overflow-hidden rounded-2xl border border-white/10 bg-white/5">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/10 text-xs font-semibold text-neutral-300 uppercase tracking-wider">
                      <th className="px-6 py-4">Dispute Category</th>
                      <th className="px-6 py-4">Core Issue</th>
                      <th className="px-6 py-4 text-right">Target Resolution SLA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    <tr>
                      <td className="px-6 py-4 font-semibold text-white">Duplicate Charges</td>
                      <td className="px-6 py-4 text-neutral-400">Double fiat debit for one invoice.</td>
                      <td className="px-6 py-4 text-right font-medium text-emerald-400">&lt; 24 Hours</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-semibold text-white">Failed Payments</td>
                      <td className="px-6 py-4 text-neutral-400">Bank debit completed but invoice uncredited.</td>
                      <td className="px-6 py-4 text-right font-medium text-emerald-400">&lt; 24 Hours</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-semibold text-white">Crypto Verification</td>
                      <td className="px-6 py-4 text-neutral-400">Tx hash matching after block confirmations.</td>
                      <td className="px-6 py-4 text-right font-medium text-[#A78BFA]">&lt; 30 Minutes</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-semibold text-white">Billing Disputes</td>
                      <td className="px-6 py-4 text-neutral-400">Workspace plan cancellation or incorrect tier charge.</td>
                      <td className="px-6 py-4 text-right font-medium text-[#A78BFA]">&lt; 24 Hours</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-semibold text-white">Standard Cases</td>
                      <td className="px-6 py-4 text-neutral-400">Complex reconciliation or mismatch audit.</td>
                      <td className="px-6 py-4 text-right font-medium text-amber-400">&lt; 72 Hours</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-semibold text-white">Fraud Investigations</td>
                      <td className="px-6 py-4 text-neutral-400">Unauthorized use, merchant abuse, identity check.</td>
                      <td className="px-6 py-4 text-right font-medium text-red-400">7 – 14 Days</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* ── INTERACTIVE FAQ SECTION ── */}
        <section className="py-20 border-b border-white/[0.04] bg-[#090412]">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-4">
                Frequently Answered Disputes
              </h2>
              <p className="text-sm text-neutral-400">
                Search or filter categories to quickly resolve common queries on payments, fiat refunds, and crypto assets.
              </p>
            </div>

            {/* Search & Filter controls */}
            <div className="space-y-4 mb-8">
              <div className="relative">
                <Search className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-white/40" />
                <input
                  type="text"
                  placeholder="Search disputes, refund workflows, transaction questions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-12 pl-11 pr-4 rounded-xl border border-white/10 bg-[#12061F] text-sm text-white focus:border-[#7B2FF7] focus:outline-none placeholder:text-white/30"
                />
              </div>

              {/* Category Buttons */}
              <div className="flex flex-wrap gap-2 justify-center">
                {[
                  { id: "all", label: "All Categories" },
                  { id: "crypto", label: "Crypto Payments" },
                  { id: "refunds", label: "Refund Procedures" },
                  { id: "billing", label: "Plan Billing" },
                  { id: "transfers", label: "Transfers & Debits" },
                ].map((category) => (
                  <button
                    key={category.id}
                    onClick={() => {
                      setActiveFaqCategory(category.id);
                      setExpandedFaqIndex(null);
                    }}
                    className={`px-4 py-2 rounded-full text-xs font-semibold uppercase tracking-wider transition-all ${
                      activeFaqCategory === category.id
                        ? "bg-[#7B2FF7] text-white"
                        : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Accordion Questions List */}
            <div className="space-y-3">
              {filteredFaqs.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-white/10 rounded-2xl text-neutral-500">
                  No matching questions found. Try search keywords or different category filters.
                </div>
              ) : (
                filteredFaqs.map((faq, index) => {
                  const isExpanded = expandedFaqIndex === index;
                  return (
                    <div 
                      key={index}
                      className="border border-white/10 rounded-xl bg-white/5 overflow-hidden transition-all duration-200"
                    >
                      <button
                        onClick={() => toggleFaq(index)}
                        className="w-full flex items-center justify-between p-5 text-left font-bold text-sm sm:text-base text-white hover:bg-white/[0.02] transition-colors"
                      >
                        <span>{faq.question}</span>
                        {isExpanded ? (
                          <ChevronUp className="w-5 h-5 text-[#A78BFA] shrink-0" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-white/40 shrink-0" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="px-5 pb-5 pt-1 text-sm text-neutral-300 border-t border-white/[0.04] bg-[#0E061A]/40 leading-relaxed">
                          {faq.answer}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* ── SECURITY & COMPLIANCE STATEMENTS ── */}
        <section className="py-16 bg-[#0E081F]/20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Database className="w-4 h-4 text-[#A78BFA]" />
                  <span>Immutable Audit Logging</span>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Every resolution step, merchant authorization, refund state, and Breet verification event is recorded permanently in our secure database for CBN-compliant trace retention.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Lock className="w-4 h-4 text-[#A78BFA]" />
                  <span>Encrypted Evidence Storage</span>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Documents, receipts, and blockchain screenshots uploaded during dispute intake are securely hashed and stored to maintain customer data confidentiality.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <Activity className="w-4 h-4 text-[#A78BFA]" />
                  <span>Continuous Fraud Auditing</span>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Our risk engines analyze transaction velocity and dispute ratios to identify suspicious merchant behaviors, protecting payment integrity from end to end.
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* ── FINAL CALL TO ACTION ── */}
        <section className="py-20">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center bg-gradient-to-b from-white/[0.02] to-transparent border border-white/10 rounded-3xl p-10 relative overflow-hidden">
            <div className="absolute top-[-50%] left-[-20%] w-[500px] h-[500px] bg-[#7B2FF7]/10 rounded-full blur-[90px] pointer-events-none" />
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-4">
              Need to Lodge a Payment Dispute?
            </h2>
            <p className="text-sm text-neutral-400 max-w-xl mx-auto mb-8">
              Click below to upload transaction evidence. Our team and engines will verify the transaction hash or processor reference promptly.
            </p>
            <Link href="/support/dispute/new">
              <Button className="h-12 px-8 text-sm font-bold uppercase tracking-wider bg-white text-[#0B0615] hover:bg-neutral-200 border-0 shadow-lg shadow-white/5 transition-all">
                Report a Payment Issue
              </Button>
            </Link>
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <footer className="bg-[#0B0615] pt-16 pb-10 border-t border-white/[0.06] relative">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4 lg:gap-8 mb-16 max-w-6xl mx-auto">
            
            {/* Brand Column */}
            <div className="lg:pr-8">
              <Link href="/" className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-[0_0_10px_rgba(255,255,255,0.1)]">
                  <DeraLedgerLogo className="h-5 w-5" />
                </div>
                <span className="text-base font-bold text-white tracking-tight">DeraLedger</span>
              </Link>
              <p className="mt-5 text-xs leading-relaxed text-white/50">
                Modern collections and payment infrastructure for growing African businesses.
              </p>
            </div>

            {/* Product Column */}
            <div>
              <h3 className="text-[10px] font-bold text-white tracking-widest uppercase mb-5">Product</h3>
              <ul className="space-y-3.5">
                <li><Link href="/#features" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Features</Link></li>
                <li><Link href="/#pricing" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Pricing</Link></li>
                <li><Link href="/dispute-resolution" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Disputes</Link></li>
                <li><Link href="/brochure" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">V2 Brochure</Link></li>
              </ul>
            </div>

            {/* Company Column */}
            <div>
              <h3 className="text-[10px] font-bold text-white tracking-widest uppercase mb-5">Company</h3>
              <ul className="space-y-3.5">
                <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">About</a></li>
                <li><a href="mailto:support@deraledger.com" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Contact</a></li>
                <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Terms of Service</a></li>
              </ul>
            </div>

            {/* Resources Column */}
            <div>
              <h3 className="text-[10px] font-bold text-white tracking-widest uppercase mb-5">Resources</h3>
              <ul className="space-y-3.5">
                <li><Link href="/support" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Help Center</Link></li>
                <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">API Docs</a></li>
                <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Guides</a></li>
                <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">System Status</a></li>
              </ul>
            </div>

          </div>

          {/* Bottom Line */}
          <div className="flex flex-col md:flex-row items-center justify-between border-t border-white/[0.06] pt-8 text-[11px] text-white/40 max-w-6xl mx-auto">
            <p>© {new Date().getFullYear()} DeraLedger by Deral Technologies Limited. All rights reserved.</p>
            <div className="flex gap-6 mt-4 md:mt-0">
              <Link href="#" className="hover:text-white transition-colors">Privacy</Link>
              <Link href="#" className="hover:text-white transition-colors">Terms</Link>
              <Link href="/dispute-resolution" className="hover:text-[#A78BFA] transition-colors">Disputes Resolution &amp; Protection</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
