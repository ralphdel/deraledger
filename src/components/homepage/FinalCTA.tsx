"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FinalCTA() {
  return (
    <section className="bg-[#0B0615] py-24 border-t border-white/[0.06] relative overflow-hidden">
      
      {/* Background Gradients */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[800px] rounded-full bg-[#6D28FF]/5 blur-[120px] pointer-events-none" />

      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        
        <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 mb-6">
          <Sparkles className="h-3 w-3 text-[#A78BFA]" />
          <span className="text-[10px] font-bold text-white/70 tracking-widest uppercase">Start Today</span>
        </div>

        <h2 className="text-4xl md:text-6xl font-black text-white tracking-tight mb-6 leading-tight">
          Stop Losing Track Of <br className="hidden md:block" />
          <span className="text-[#A78BFA]">Business Payments.</span>
        </h2>
        
        <p className="text-base md:text-lg text-white/60 mb-10 leading-relaxed max-w-2xl mx-auto">
          Track deposits, balances, installment payments, and collections clearly with DeraLedger.
        </p>
        
        <div className="flex justify-center">
          <Link href="/onboarding">
            <Button className="h-13 px-8 text-sm uppercase tracking-wider font-bold bg-[#6D28FF] text-white hover:bg-[#6D28FF]/95 transition-all shadow-[0_4px_20px_rgba(109,40,255,0.4)] border-0">
              Start Collecting Smarter
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>

      </div>
    </section>
  );
}
