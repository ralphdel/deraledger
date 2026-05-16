"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FinalCTA() {
  return (
    <section className="bg-[#12061F] py-24 border-t border-white/5 relative overflow-hidden">
      
      {/* Background Gradients */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[800px] rounded-full bg-[#3D0B66]/30 blur-[150px] pointer-events-none" />

      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        
        <h2 className="text-4xl md:text-6xl font-extrabold text-white tracking-tight mb-6 leading-tight">
          Stop Losing Track Of <br className="hidden md:block" />
          <span className="text-[#7B2FF7]">Business Payments.</span>
        </h2>
        
        <p className="text-xl text-white/60 mb-10 leading-relaxed max-w-2xl mx-auto">
          Track deposits, balances, installment payments, and collections clearly with DeraLedger.
        </p>
        
        <div className="flex justify-center">
          <Link href="/onboarding">
            <Button className="h-14 px-10 text-lg font-semibold bg-[#7B2FF7] text-white hover:bg-[#B58CFF] hover:text-[#12061F] transition-all shadow-[0_0_20px_rgba(123,47,247,0.3)] hover:shadow-[0_0_30px_rgba(181,140,255,0.5)] border-0">
              Start Collecting Smarter
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>

      </div>
    </section>
  );
}
