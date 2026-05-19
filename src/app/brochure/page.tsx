"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  ChevronLeft, ChevronRight, Printer, Sparkles, CheckCircle2, 
  ShieldCheck, Layers, Users, Wallet, ArrowRight, Clock, FileText,
  Mail, Globe, Phone, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";

const slides = [
  // Slide 1: Cover
  {
    id: 1,
    type: "dark",
    title: "Business payment operations made clear.",
    subtitle: "DeraLedger — Product Presentation & Infrastructure Overview",
    description: "Manage invoices, track collections, deposits, and record offline payments in one intelligent, collaborative operational workspace.",
    content: (
      <div className="relative w-full h-full flex flex-col justify-between p-8 sm:p-12 overflow-hidden">
        {/* Glow Effects */}
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-[#6D28FF]/20 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-[#A78BFA]/10 blur-[120px] pointer-events-none" />
        
        {/* Header */}
        <div className="flex justify-between items-center z-10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#6D28FF] flex items-center justify-center font-bold text-white shadow-lg shadow-[#6D28FF]/30">D</div>
            <span className="text-xl font-bold tracking-tight text-white">DeraLedger</span>
          </div>
          <span className="text-xs uppercase tracking-widest text-[#A78BFA] font-semibold bg-[#6D28FF]/10 px-3 py-1 rounded-full border border-[#6D28FF]/20">v2.0 Brochure</span>
        </div>

        {/* Hero Copy */}
        <div className="max-w-2xl my-auto z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-[#A78BFA] mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Modern Collections Infrastructure</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight leading-[1.1] mb-6">
            Business payment operations <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#A78BFA] to-[#C4B5FD]">made clear.</span>
          </h1>
          <p className="text-neutral-400 text-lg leading-relaxed mb-8">
            Create invoices, track collections, manage deposits, record offline payments, and organize business payment workflows inside one intelligent workspace.
          </p>
        </div>

        {/* Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-t border-white/5 pt-6 text-xs text-neutral-500 z-10 gap-4">
          <div>Built for growing SMEs, professional businesses, and agencies.</div>
          <div className="flex items-center gap-2 text-[#A78BFA]">
            <span>deraledger.vercel.app</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    )
  },
  // Slide 2: The Problem
  {
    id: 2,
    type: "light",
    title: "Business payments rarely happen in one step.",
    subtitle: "The Complexity of Staged Collections",
    description: "Most tools assume an instant Invoice-to-Paid transaction. DeraLedger embraces the reality of multiple, complex operational phases.",
    content: (
      <div className="w-full h-full flex flex-col justify-between p-8 sm:p-12 text-neutral-900">
        <div>
          <div className="flex items-center justify-between mb-8">
            <span className="text-xs font-bold uppercase tracking-widest text-[#6D28FF]">The Operational Challenge</span>
            <span className="text-xs text-neutral-400">02 / 07</span>
          </div>
          <h2 className="text-3xl font-bold text-neutral-900 tracking-tight mb-4">
            Business payments rarely happen in one step.
          </h2>
          <p className="text-neutral-600 max-w-2xl text-sm mb-8">
            Most invoicing systems force a rigid workflow. In reality, businesses manage retainers, progressive deposits, manual bank transfers, and custom client payment schedules.
          </p>
        </div>

        {/* Comparison Graphic */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 my-auto">
          {/* Old way */}
          <div className="bg-red-50/50 border border-red-100 rounded-2xl p-6">
            <span className="text-xs font-bold uppercase text-red-600 tracking-wider">The Standard Static Model</span>
            <h3 className="font-bold text-lg mt-2 mb-4 text-red-900">Invoice → Paid → Done</h3>
            <ul className="space-y-2.5 text-xs text-neutral-600">
              <li className="flex items-center gap-2">❌ No native retainer deposit tracking</li>
              <li className="flex items-center gap-2">❌ Leads to manual spreadsheets dependency</li>
              <li className="flex items-center gap-2">❌ High friction follow-ups for outstanding balances</li>
              <li className="flex items-center gap-2">❌ Static payment links fail on partial payments</li>
            </ul>
          </div>

          {/* New way */}
          <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl" />
            <span className="text-xs font-bold uppercase text-emerald-600 tracking-wider">The DeraLedger Timeline</span>
            <h3 className="font-bold text-lg mt-2 mb-4 text-emerald-900">Structured Progressive Billing</h3>
            <ul className="space-y-2.5 text-xs text-neutral-700">
              <li className="flex items-center gap-2 text-emerald-800 font-medium">✓ Secure upfront collection of deposits</li>
              <li className="flex items-center gap-2 text-emerald-800 font-medium">✓ Real-time outstanding ledger balance visibility</li>
              <li className="flex items-center gap-2 text-emerald-800 font-medium">✓ Automatic payment reconciliation & tracking</li>
              <li className="flex items-center gap-2 text-emerald-800 font-medium">✓ Automated professional balance reminder delivery</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-neutral-100 pt-6 text-xs text-neutral-400">
          Unifies structured invoicing, deposits management, and progressive project settlements.
        </div>
      </div>
    )
  },
  // Slide 3: Why Choose Us (The Core Advantage)
  {
    id: 3,
    type: "dark",
    title: "The first infrastructure built natively for partial payments.",
    subtitle: "Why Choose Us: Staged Collections & Automated Reminders",
    description: "Standard invoicing platforms force users to pay the entire bill at once. DeraLedger is built from the ground up to allow milestone-based collections.",
    content: (
      <div className="relative w-full h-full flex flex-col justify-between p-8 sm:p-12 overflow-hidden">
        {/* Ambient Glow */}
        <div className="absolute top-[40%] right-[-10%] w-[40%] h-[40%] rounded-full bg-[#6D28FF]/10 blur-[90px] pointer-events-none" />

        <div className="z-10">
          <div className="flex items-center justify-between mb-8">
            <span className="text-xs font-bold uppercase tracking-widest text-[#A78BFA]">Strategic Advantage</span>
            <span className="text-xs text-neutral-500">03 / 07</span>
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight mb-4">
            The first infrastructure built natively for partial payments.
          </h2>
          <p className="text-neutral-400 max-w-2xl text-sm">
            We solve the cash flow tracking problem. Standard invoicing platforms force you to request full payments. DeraLedger lets you define structured payment stages and automates the tracking.
          </p>
        </div>

        {/* Unique Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-auto z-10">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 hover:border-[#6D28FF]/40 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-[#6D28FF]/20 flex items-center justify-center mb-4 text-[#A78BFA]">
              <Wallet className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-base mb-2">Partial Payment Engine</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Define upfront deposits, milestone schedules, and final balances directly on client invoices.
            </p>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-5 hover:border-[#6D28FF]/40 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-[#6D28FF]/20 flex items-center justify-center mb-4 text-[#A78BFA]">
              <Clock className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-base mb-2">Automated Balance Mails</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Once deposits are verified, our system instantly triggers automated, professional balance invoices straight to client inboxes.
            </p>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-xl p-5 hover:border-[#6D28FF]/40 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-[#6D28FF]/20 flex items-center justify-center mb-4 text-[#A78BFA]">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-white text-base mb-2">Project References</h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Group multiple invoices, manual adjustments, and milestone transactions under a single project reference code.
            </p>
          </div>
        </div>

        <div className="border-t border-white/5 pt-6 text-xs text-neutral-500 z-10">
          No more awkward follow-ups. No more manual math. Just seamless cash flow.
        </div>
      </div>
    )
  },
  // Slide 4: Capabilities
  {
    id: 4,
    type: "light",
    title: "An intelligent operational workspace.",
    subtitle: "Core Capabilities Built for Business Growth",
    description: "Every feature you need to invoice clients, track deposits, record offline bank transfers, and collaborate with your finance personnel.",
    content: (
      <div className="w-full h-full flex flex-col justify-between p-8 sm:p-12 text-neutral-900">
        <div>
          <div className="flex items-center justify-between mb-8">
            <span className="text-xs font-bold uppercase tracking-widest text-[#6D28FF]">Core Capabilities</span>
            <span className="text-xs text-neutral-400">04 / 07</span>
          </div>
          <h2 className="text-3xl font-bold text-neutral-900 tracking-tight mb-4">
            An intelligent operational workspace.
          </h2>
        </div>

        {/* Feature List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 my-auto">
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-lg bg-[#6D28FF]/10 flex items-center justify-center text-[#6D28FF] flex-shrink-0 mt-0.5">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-neutral-950">Smart Invoicing & Catalog</h3>
                <p className="text-xs text-neutral-600 leading-relaxed mt-1">
                  Draft professional billing requests with pre-saved discount templates and item catalogs.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-lg bg-[#6D28FF]/10 flex items-center justify-center text-[#6D28FF] flex-shrink-0 mt-0.5">
                <Wallet className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-neutral-950">Offline Payment Records</h3>
                <p className="text-xs text-neutral-600 leading-relaxed mt-1">
                  Log bank transfers, cash payments, or cheques instantly to reconcile balances seamlessly.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-lg bg-[#6D28FF]/10 flex items-center justify-center text-[#6D28FF] flex-shrink-0 mt-0.5">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-neutral-950">Outstanding Balance Visibility</h3>
                <p className="text-xs text-neutral-600 leading-relaxed mt-1">
                  Reconciliation tracking shows what has been billed, what has been collected, and exactly what remains.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="h-8 w-8 rounded-lg bg-[#6D28FF]/10 flex items-center justify-center text-[#6D28FF] flex-shrink-0 mt-0.5">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-neutral-950">Unified Client Timeline</h3>
                <p className="text-xs text-neutral-600 leading-relaxed mt-1">
                  Provide a single reference interface for clients to inspect total project progress and settle balances.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-neutral-100 pt-6 text-xs text-neutral-400">
          Designed strictly to support verified business invoicing and payments infrastructure.
        </div>
      </div>
    )
  },
  // Slide 5: Workspace Showcase
  {
    id: 5,
    type: "dark",
    title: "See everything. Track everything.",
    subtitle: "High-Fidelity Dashboard Workspace Preview",
    description: "Our elegant interface unifies collection feeds, outstanding timelines, and deposit allocations under real-time monitoring structures.",
    content: (
      <div className="relative w-full h-full flex flex-col justify-between p-8 sm:p-12 overflow-hidden">
        {/* Glow */}
        <div className="absolute top-[20%] left-[20%] w-[50%] h-[50%] rounded-full bg-[#6D28FF]/10 blur-[100px] pointer-events-none" />

        <div className="z-10">
          <div className="flex items-center justify-between mb-6">
            <span className="text-xs font-bold uppercase tracking-widest text-[#A78BFA]">Product Interface</span>
            <span className="text-xs text-neutral-500">05 / 07</span>
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight mb-2">
            See everything. Track everything.
          </h2>
        </div>

        {/* Dashboard Mockup Representation */}
        <div className="bg-[#12061F]/90 border border-white/10 rounded-xl p-4 sm:p-6 my-auto max-w-4xl mx-auto w-full z-10 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-500/80" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/80" />
              <span className="h-3 w-3 rounded-full bg-green-500/80" />
              <span className="text-xs text-neutral-500 ml-2 font-mono">workspace_dashboard</span>
            </div>
            <div className="px-3 py-1 rounded bg-[#6D28FF]/10 border border-[#6D28FF]/20 text-[10px] text-[#A78BFA] font-semibold">Active Timeline</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Widget 1 */}
            <div className="bg-white/5 rounded-lg p-3.5 border border-white/5">
              <div className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Outstanding Balance</div>
              <div className="text-xl font-bold text-white mt-1">₦4,250,000</div>
              <div className="text-[10px] text-amber-400 mt-2 font-medium">⚡ Reconciled dynamically</div>
            </div>

            {/* Widget 2 */}
            <div className="bg-white/5 rounded-lg p-3.5 border border-white/5">
              <div className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Milestone Progress</div>
              <div className="w-full bg-white/10 rounded-full h-1.5 mt-3 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full w-[65%]" />
              </div>
              <div className="flex justify-between text-[10px] text-neutral-400 mt-2">
                <span>Billed: ₦6.5M</span>
                <span className="text-emerald-400">65% paid</span>
              </div>
            </div>

            {/* Widget 3 */}
            <div className="bg-white/5 rounded-lg p-3.5 border border-white/5">
              <div className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider">Staged Deposits</div>
              <div className="text-xs text-neutral-300 font-medium mt-2 leading-relaxed">
                ✅ Deposit Applied: <span className="text-emerald-400">₦2,250,000</span>
              </div>
              <div className="text-[10px] text-neutral-500 mt-1">Verified: 2 hours ago</div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/5 pt-6 text-xs text-neutral-500 z-10">
          Integrated visual layout provides live accounting audits with zero guesswork.
        </div>
      </div>
    )
  },
  // Slide 6: Team Operations
  {
    id: 6,
    type: "light",
    title: "Scale your finance operations securely.",
    subtitle: "Enterprise-Grade Role-Based Access Control (RBAC)",
    description: "Collaborate seamlessly without exposing billing secrets. Restrict views, manage access permissions, and generate immutable audits logs.",
    content: (
      <div className="w-full h-full flex flex-col justify-between p-8 sm:p-12 text-neutral-900">
        <div>
          <div className="flex items-center justify-between mb-8">
            <span className="text-xs font-bold uppercase tracking-widest text-[#6D28FF]">Team Operations</span>
            <span className="text-xs text-neutral-400">06 / 07</span>
          </div>
          <h2 className="text-3xl font-bold text-neutral-900 tracking-tight mb-4">
            Scale your finance operations securely.
          </h2>
          <p className="text-neutral-600 max-w-2xl text-sm">
            Sharing logins exposes credentials and compromises audit integrity. DeraLedger introduces secure predefined and custom RBAC permissions.
          </p>
        </div>

        {/* Roles details */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-auto">
          <div className="bg-neutral-50 border border-neutral-200/60 rounded-xl p-5">
            <div className="h-8 w-8 rounded-lg bg-[#6D28FF]/10 flex items-center justify-center text-[#6D28FF] mb-3">
              <Users className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-sm text-neutral-950">Finance Managers</h3>
            <p className="text-xs text-neutral-600 leading-relaxed mt-2">
              Full collection authority. Can manage billing cycles, verify payment deposits, and invite team members.
            </p>
          </div>

          <div className="bg-neutral-50 border border-neutral-200/60 rounded-xl p-5">
            <div className="h-8 w-8 rounded-lg bg-[#6D28FF]/10 flex items-center justify-center text-[#6D28FF] mb-3">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-sm text-neutral-950">Collections Officers</h3>
            <p className="text-xs text-neutral-600 leading-relaxed mt-2">
              Can draft invoices, log offline payment requests, and track balances. Zero permission to delete records or edit payment methods.
            </p>
          </div>

          <div className="bg-neutral-50 border border-neutral-200/60 rounded-xl p-5">
            <div className="h-8 w-8 rounded-lg bg-[#6D28FF]/10 flex items-center justify-center text-[#6D28FF] mb-3">
              <Clock className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-sm text-neutral-950">Immutable Ledger Audits</h3>
            <p className="text-xs text-neutral-600 leading-relaxed mt-2">
              Every single operational modification (creation, verification, adjustments) generates a secure audit entry tracking the user.
            </p>
          </div>
        </div>

        <div className="border-t border-neutral-100 pt-6 text-xs text-neutral-400">
          Provides corporate and individual tiers complete operational transparency.
        </div>
      </div>
    )
  },
  // Slide 7: Built for Growth, Backed by Trust
  {
    id: 7,
    type: "dark",
    title: "Built for growth. Designed for trust.",
    subtitle: "Audience, Security & Call To Action",
    description: "Start collecting smarter today with DeraLedger's verified payment infrastructure.",
    content: (
      <div className="relative w-full h-full flex flex-col justify-between p-8 sm:p-12 overflow-hidden">
        {/* Glow */}
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#6D28FF]/10 blur-[120px] pointer-events-none" />

        <div className="z-10">
          <div className="flex items-center justify-between mb-8">
            <span className="text-xs font-bold uppercase tracking-widest text-[#A78BFA]">Growth & Trust</span>
            <span className="text-xs text-neutral-500">07 / 07</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 my-auto z-10 items-center">
          <div>
            <h2 className="text-3xl font-extrabold text-white tracking-tight leading-tight mb-4">
              Built for growth. <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#A78BFA] to-[#C4B5FD]">Designed for trust.</span>
            </h2>
            
            {/* Target markets */}
            <div className="flex flex-wrap gap-2.5 mt-6">
              {["🏢 SMEs", "👥 Professional Businesses", "🎨 Agencies", "🏫 Schools", "🎪 Event Vendors", "🏗️ Contractors"].map((tag, idx) => (
                <span key={idx} className="text-xs bg-white/5 border border-white/10 px-3 py-1.5 rounded-lg text-neutral-300 font-medium">
                  {tag}
                </span>
              ))}
            </div>
            
            <div className="space-y-3.5 mt-8">
              <div className="flex items-center gap-3 text-xs text-neutral-400">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Secure payments processed via Paystack integration</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-neutral-400">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Verified business profiles ensuring zero transaction spam</span>
              </div>
            </div>
          </div>

          {/* CTA Box */}
          <div className="bg-[#12061F] border border-white/10 p-8 rounded-2xl text-center relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-[#6D28FF]/15 rounded-full blur-xl" />
            <h3 className="text-xl font-bold text-white mb-2">Stop losing track of business payments.</h3>
            <p className="text-xs text-neutral-400 mb-6 max-w-sm mx-auto">
              Reconcile staged milestones, manage project references, and collaborate securely with DeraLedger.
            </p>
            
            <Link href="/onboarding">
              <Button className="w-full bg-[#6D28FF] hover:bg-[#6D28FF]/80 text-white font-bold py-5 rounded-xl shadow-lg shadow-[#6D28FF]/20 flex items-center justify-center gap-2">
                <span>Start Collecting Smarter</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>

            {/* Contacts Info */}
            <div className="mt-8 pt-6 border-t border-white/5 grid grid-cols-2 gap-4 text-[10px] text-neutral-500 text-left">
              <div className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-[#A78BFA]" />
                <span>deraledger.vercel.app</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-[#A78BFA]" />
                <span>hello@deraledger.com</span>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/5 pt-6 text-xs text-neutral-500 z-10 flex justify-between">
          <span>DeraLedger Invoicing Workspace © 2026</span>
          <span>Compliance & Trust first</span>
        </div>
      </div>
    )
  }
];

export default function BrochurePage() {
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);

  const nextSlide = () => {
    setCurrentSlideIdx((prev) => (prev + 1) % slides.length);
  };

  const prevSlide = () => {
    setCurrentSlideIdx((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const currentSlide = slides[currentSlideIdx];

  return (
    <div className="min-h-screen bg-[#06030c] text-white flex flex-col justify-between relative overflow-hidden select-none">
      {/* Top Banner Control Panel (Hidden during Print) */}
      <header className="bg-[#0B0615]/80 border-b border-white/10 backdrop-blur-md px-6 py-4 flex items-center justify-between z-40 print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="h-8 w-8 rounded-lg bg-[#6D28FF] flex items-center justify-center font-bold text-white hover:bg-[#6D28FF]/80 transition-colors">D</Link>
          <div>
            <span className="text-sm font-bold text-white tracking-tight">DeraLedger Product Brochure</span>
            <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full ml-3 font-semibold">Interactive Presentation Mode</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => window.print()}
            className="border-white/10 text-neutral-300 hover:bg-white/5 hover:text-white flex items-center gap-2 text-xs bg-transparent"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / Save as PDF</span>
          </Button>

          <Link href="/dashboard">
            <Button size="sm" className="bg-[#6D28FF] hover:bg-[#6D28FF]/80 text-white font-semibold text-xs px-4">
              <span>Go to Dashboard</span>
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Slide Deck Canvas Container */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8 z-30">
        {/* Slides Presentation Card */}
        <div 
          className={`w-full max-w-5xl aspect-[16/10] sm:aspect-[16/9.5] rounded-3xl border shadow-2xl transition-all duration-500 relative overflow-hidden ${
            currentSlide.type === "dark" 
              ? "bg-[#0B0615] border-white/10 shadow-[#0B0615]/80" 
              : "bg-white border-neutral-200/80 shadow-neutral-200/30"
          }`}
        >
          {/* Animated Slide Content transition wrapper */}
          <div className="w-full h-full relative transition-all duration-300">
            {currentSlide.content}
          </div>
        </div>
      </main>

      {/* Slide Navigation controls */}
      <footer className="bg-[#0B0615]/80 border-t border-white/10 px-6 py-4 flex items-center justify-between z-40 print:hidden backdrop-blur-md">
        {/* Slide Counter Dots */}
        <div className="flex items-center gap-2">
          {slides.map((slide, idx) => (
            <button
              key={slide.id}
              onClick={() => setCurrentSlideIdx(idx)}
              className={`h-2 rounded-full transition-all duration-300 ${
                currentSlideIdx === idx 
                  ? "w-8 bg-[#6D28FF]" 
                  : "w-2 bg-white/20 hover:bg-white/40"
              }`}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>

        {/* Action Arrows */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400 mr-2 font-mono">
            Slide {currentSlideIdx + 1} of {slides.length}
          </span>
          
          <Button
            onClick={prevSlide}
            variant="outline"
            className="border-white/10 text-white hover:bg-white/5 hover:text-white p-2 rounded-xl bg-transparent"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>

          <Button
            onClick={nextSlide}
            variant="outline"
            className="border-white/10 text-white hover:bg-white/5 hover:text-white p-2 rounded-xl bg-transparent"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>
      </footer>

      {/* Global Atmospheric Ambient lighting */}
      <div className="absolute top-[30%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-[#6D28FF]/5 blur-[120px] pointer-events-none z-10" />
      <div className="absolute bottom-[20%] right-[-10%] w-[35vw] h-[35vw] rounded-full bg-[#A78BFA]/5 blur-[100px] pointer-events-none z-10" />

      {/* CSS overrides strictly for PDF printing support */}
      <style jsx global>{`
        @media print {
          body, html, .min-h-screen {
            background: white !important;
            color: black !important;
            height: auto !important;
            min-h-screen: 0 !important;
          }
          header, footer {
            display: none !important;
          }
          main {
            padding: 0 !important;
          }
          .max-w-5xl {
            max-width: 100% !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            aspect-ratio: auto !important;
          }
        }
      `}</style>
    </div>
  );
}
