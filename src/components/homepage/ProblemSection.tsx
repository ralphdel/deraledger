"use client";

import { ArrowRight, Wallet, Percent, AlertTriangle, Scale, Activity } from "lucide-react";

export function ProblemSection() {
  return (
    <section className="bg-[#12061F] py-20 md:py-32 border-t border-white/5 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[600px] rounded-full bg-[#3D0B66]/20 blur-[100px] pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight mb-6">
            Most Businesses Don&apos;t Get Paid Once.
          </h2>
          <p className="text-lg text-white/60">
            Across Africa, businesses receive fragmented payments every day, but traditional tools expect a single transaction. This disconnect breaks your operations.
          </p>
        </div>

        {/* Visual Flow */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8 max-w-5xl mx-auto">
          
          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-lg">
              <Wallet className="h-6 w-6 text-[#B58CFF]" />
            </div>
            <p className="text-sm font-semibold text-white/80">Deposit</p>
          </div>

          <ArrowRight className="h-5 w-5 text-white/20 rotate-90 md:rotate-0" />

          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-lg">
              <Percent className="h-6 w-6 text-[#B58CFF]" />
            </div>
            <p className="text-sm font-semibold text-white/80">Installment</p>
          </div>

          <ArrowRight className="h-5 w-5 text-white/20 rotate-90 md:rotate-0" />

          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-lg">
              <Scale className="h-6 w-6 text-[#B58CFF]" />
            </div>
            <p className="text-sm font-semibold text-white/80">Balance</p>
          </div>

          <ArrowRight className="h-5 w-5 text-[#B58CFF]/40 rotate-90 md:rotate-0" />

          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-2xl bg-white/5 border border-red-500/20 flex items-center justify-center shadow-lg relative">
              <div className="absolute inset-0 bg-red-500/10 rounded-2xl blur-md" />
              <AlertTriangle className="h-6 w-6 text-red-400 relative z-10" />
            </div>
            <p className="text-sm font-semibold text-red-300">Manual Tracking</p>
          </div>

          <ArrowRight className="h-5 w-5 text-red-500/40 rotate-90 md:rotate-0" />

          <div className="flex flex-col items-center gap-3">
            <div className="h-16 w-16 rounded-2xl bg-[#3D0B66]/30 border border-[#7B2FF7]/30 flex items-center justify-center shadow-[0_0_20px_rgba(123,47,247,0.2)]">
              <Activity className="h-6 w-6 text-[#7B2FF7]" />
            </div>
            <p className="text-sm font-bold text-[#B58CFF]">Payment Confusion</p>
          </div>
          
        </div>

        <div className="mt-20 text-center">
          <div className="inline-block rounded-2xl bg-white/5 border border-white/10 px-8 py-6 backdrop-blur-sm">
            <h3 className="text-xl md:text-2xl font-bold text-white mb-2">
              DeraLedger organizes the entire collection process.
            </h3>
            <p className="text-white/60 text-sm">
              We turn fragmented receivables into a clean, operational timeline.
            </p>
          </div>
        </div>

      </div>
    </section>
  );
}
