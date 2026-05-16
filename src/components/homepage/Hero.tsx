"use client";

import Link from "next/link";
import { ArrowRight, ChevronRight, CheckCircle2, ShieldCheck, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";

function AbstractMockup() {
  return (
    <div className="relative mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-[#12061F]/80 p-6 shadow-2xl backdrop-blur-xl transform transition-transform duration-700 hover:scale-[1.02]">
      {/* Glow layer */}
      <div className="absolute -inset-1 -z-10 rounded-3xl bg-gradient-to-br from-[#7B2FF7]/30 to-[#3D0B66]/50 opacity-50 blur-xl" />
      
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#B58CFF]">Project Collection</p>
          <h3 className="mt-1 text-lg font-bold text-white">Adaeze Wedding</h3>
        </div>
        <div className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-400">
          Active
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-medium text-white/50">Total Project Value</p>
            <p className="font-mono text-2xl font-bold text-white">{"\u20A6"}1,150,000</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-[#B58CFF]">30% Collected</span>
            <span className="text-white/50">Outstanding: {"\u20A6"}800,000</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div className="h-full w-[30%] rounded-full bg-[#7B2FF7] shadow-[0_0_10px_rgba(123,47,247,0.8)]" />
          </div>
        </div>

        {/* Invoice List */}
        <div className="mt-6 space-y-2 rounded-xl bg-white/5 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">Linked Invoices</p>
          
          <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-white">Initial Deposit</p>
                <p className="text-xs text-white/50">INV-001</p>
              </div>
            </div>
            <p className="font-mono text-sm font-bold text-emerald-400">{"\u20A6"}350,000</p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded-full border-2 border-white/20" />
              <div>
                <p className="text-sm font-semibold text-white">Final Balance</p>
                <p className="text-xs text-white/50">Pending generation</p>
              </div>
            </div>
            <p className="font-mono text-sm font-bold text-white/70">{"\u20A6"}800,000</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#12061F] pt-24 pb-16 md:pt-32 md:pb-24">
      {/* Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[800px] rounded-full bg-[#3D0B66]/40 blur-[120px] pointer-events-none" />
      <div className="absolute right-0 bottom-0 translate-x-1/3 translate-y-1/3 h-[500px] w-[500px] rounded-full bg-[#7B2FF7]/20 blur-[100px] pointer-events-none" />
      
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8 items-center">
          
          {/* Left Side Copy */}
          <div className="max-w-2xl text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 mb-6 backdrop-blur-md">
              <ShieldCheck className="h-4 w-4 text-[#B58CFF]" />
              <span className="text-xs font-semibold text-white/80">Premium collections infrastructure</span>
            </div>
            
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
              Track Every Business Payment From Deposit To Final Balance.
            </h1>
            
            <p className="mt-6 text-lg leading-relaxed text-white/60">
              DeraLedger helps African businesses manage deposits, installment payments, outstanding balances, and collections workflows in one clear system.
            </p>
            
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
              <Link href="/onboarding" className="w-full sm:w-auto">
                <Button className="h-12 w-full sm:w-auto bg-[#7B2FF7] px-8 text-base font-semibold text-white hover:bg-[#B58CFF] hover:text-[#12061F] transition-all shadow-[0_0_20px_rgba(123,47,247,0.4)] hover:shadow-[0_0_30px_rgba(181,140,255,0.6)] border-0">
                  Start Collecting Smarter
                </Button>
              </Link>
              <a href="#workflow" className="w-full sm:w-auto">
                <Button variant="outline" className="h-12 w-full sm:w-auto border-white/20 bg-white/5 px-8 text-base font-semibold text-white hover:bg-white/10 hover:text-white backdrop-blur-sm transition-all">
                  See How It Works
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center lg:justify-start gap-6 text-xs font-medium text-white/40">
              <div className="flex items-center gap-2">
                <LockKeyhole className="h-4 w-4 text-[#B58CFF]" />
                Secure Collections
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#B58CFF]" />
                Role-Based Access
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#B58CFF]" />
                Audit Tracking
              </div>
            </div>
          </div>

          {/* Right Side Visual */}
          <div className="relative mx-auto w-full max-w-lg lg:max-w-none lg:pl-12 perspective-1000">
            <AbstractMockup />
          </div>

        </div>
      </div>
    </section>
  );
}
