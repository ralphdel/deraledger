"use client";

import { ShieldCheck, UserCheck, Building2, KeyRound } from "lucide-react";

export function TrustSection() {
  return (
    <section className="bg-[#12061F] py-20 border-t border-white/5 relative overflow-hidden">
      
      {/* Background Glow */}
      <div className="absolute left-0 bottom-0 h-[400px] w-[600px] -translate-x-1/2 translate-y-1/2 rounded-full bg-[#3D0B66]/20 blur-[120px] pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-[#B58CFF] mb-3">
              Trust & Verification
            </p>
            <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight mb-6">
              Compliant infrastructure designed for Nigerian businesses.
            </h2>
            <p className="text-lg text-white/60 mb-8 leading-relaxed">
              We keep the ecosystem safe by ensuring every merchant collecting funds online is strictly verified. Protect your collections with bank-grade infrastructure.
            </p>

            <div className="grid sm:grid-cols-2 gap-6">
              <div className="flex gap-3">
                <UserCheck className="h-5 w-5 text-[#7B2FF7] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-white text-sm">Identity Verification</h4>
                  <p className="text-xs text-white/50 mt-1">Strict BVN & Selfie validation.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Building2 className="h-5 w-5 text-[#7B2FF7] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-white text-sm">Business Verification</h4>
                  <p className="text-xs text-white/50 mt-1">CAC & Director validation workflows.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <KeyRound className="h-5 w-5 text-[#7B2FF7] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-white text-sm">Protected Access</h4>
                  <p className="text-xs text-white/50 mt-1">Secure links and RBAC controls.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <ShieldCheck className="h-5 w-5 text-[#7B2FF7] flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-white text-sm">Audit Trails</h4>
                  <p className="text-xs text-white/50 mt-1">Every action is securely logged.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-[#7B2FF7]/20 to-transparent blur-xl" />
            <div className="relative rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm">
              <ShieldCheck className="h-12 w-12 text-[#B58CFF] mb-6" />
              <blockquote className="text-xl font-medium text-white leading-relaxed">
                "We stopped sending multiple random invoices for one job. DeraLedger gives us a single, trusted collections pipeline that our clients feel safe paying into."
              </blockquote>
              <div className="mt-6 border-t border-white/10 pt-6">
                <p className="text-sm font-bold text-white">Collections powered securely via Paystack</p>
                <p className="text-xs text-white/50 mt-1">Enterprise-grade payment processing.</p>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
