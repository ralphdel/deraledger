"use client";

import { ShieldCheck, UserCheck, ShieldAlert, KeyRound, Sparkles } from "lucide-react";

export function TrustSection() {
  return (
    <section className="bg-[#12061F] py-20 md:py-28 border-t border-white/[0.06] relative overflow-hidden">
      
      {/* Background Glow */}
      <div className="absolute left-0 bottom-0 h-[400px] w-[600px] -translate-x-1/2 translate-y-1/2 rounded-full bg-[#6D28FF]/5 blur-[120px] pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 mb-4">
              <ShieldCheck className="h-3 w-3 text-[#A78BFA]" />
              <span className="text-[10px] font-bold text-white/70 tracking-widest uppercase">Trust & Security</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight leading-tight mb-6">
              Compliant infrastructure designed for verified operations.
            </h2>
            <p className="text-sm md:text-base text-white/60 mb-8 leading-relaxed">
              We keep your operational receivables safe by enforcing clear, secure structures. Verify your corporate profile to unlock online collections powered securely by bank-grade standards.
            </p>

            <div className="grid sm:grid-cols-2 gap-6">
              <div className="flex gap-3">
                <UserCheck className="h-5 w-5 text-[#A78BFA] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-white text-sm tracking-tight">Identity Vetting</h4>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">Secure BVN & corporate CAC validation structures.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <ShieldAlert className="h-5 w-5 text-[#A78BFA] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-white text-sm tracking-tight">Controlled Access</h4>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">Role-based controls prevent unauthorized bank updates.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <KeyRound className="h-5 w-5 text-[#A78BFA] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-white text-sm tracking-tight">Protected Links</h4>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">Tamperproof collection links with secure checkout.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <ShieldCheck className="h-5 w-5 text-[#A78BFA] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-white text-sm tracking-tight">Audit Trail Ledgers</h4>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">Every invoice action and payment log is securely recorded.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-[#6D28FF]/10 to-transparent blur-xl" />
            <div className="relative rounded-2xl border border-white/[0.08] bg-[#0B0615]/80 p-8 backdrop-blur-sm shadow-xl">
              <ShieldCheck className="h-10 w-10 text-[#A78BFA] mb-6" />
              <blockquote className="text-lg md:text-xl font-medium text-white/90 leading-relaxed italic">
                &ldquo;We stopped sending multiple random invoices for one job. DeraLedger gives us a single, trusted collections pipeline that our clients feel safe paying into.&rdquo;
              </blockquote>
              <div className="mt-6 border-t border-white/[0.06] pt-6 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-white uppercase tracking-wider">Collections Powered via Paystack</p>
                  <p className="text-[10px] text-white/40 mt-0.5">Enterprise-grade secure processing.</p>
                </div>
                <span className="rounded bg-white/5 border border-white/10 px-2.5 py-1 text-[10px] font-bold text-white/70 tracking-wide font-mono uppercase">
                  PCI-DSS
                </span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
