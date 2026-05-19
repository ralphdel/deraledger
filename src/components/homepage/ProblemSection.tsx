"use client";

import { ArrowRight, FileCheck, ArrowDownToLine, Users, CheckSquare, Sparkles } from "lucide-react";

export function ProblemSection() {
  const steps = [
    {
      title: "Invoice Issued",
      description: "₦1,000,000 sent to client",
      icon: FileCheck,
      color: "border-[#6D28FF] bg-[#6D28FF]/5 text-[#A78BFA]",
    },
    {
      title: "Deposit Applied",
      description: "₦300,000 initial payment received",
      icon: ArrowDownToLine,
      color: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
    },
    {
      title: "Team Verification",
      description: "Accounts team confirms & logs cash record",
      icon: Users,
      color: "border-amber-500/30 bg-amber-500/5 text-amber-400",
    },
    {
      title: "Balance Payment",
      description: "₦700,000 final outstanding settled",
      icon: CheckSquare,
      color: "border-[#C4B5FD]/30 bg-[#C4B5FD]/5 text-[#C4B5FD]",
    },
  ];

  return (
    <section id="workflow" className="bg-[#0B0615] py-20 md:py-28 border-t border-white/[0.06] relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[450px] w-[700px] rounded-full bg-[#6D28FF]/5 blur-[120px] pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 mb-4">
            <Sparkles className="h-3 w-3 text-[#A78BFA]" />
            <span className="text-[10px] font-bold text-white/70 tracking-widest uppercase">Operations Timeline</span>
          </div>
          <h2 className="text-3xl md:text-[44px] font-black text-white tracking-tight leading-[1.15] mb-6">
            Business payments are rarely one simple transaction.
          </h2>
          <p className="text-base md:text-lg text-white/60 leading-relaxed">
            Invoices, deposits, balances, offline payments, and multiple team members often exist inside the same workflow. DeraLedger keeps everything organized in one operational timeline.
          </p>
        </div>

        {/* Visual Flow Timeline */}
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6 max-w-5xl mx-auto mt-12 bg-[#12061F]/40 p-4 sm:p-6 md:p-8 rounded-2xl border border-white/[0.06] backdrop-blur-sm">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div key={step.title} className="flex-1 flex flex-col lg:flex-row items-center w-full">
                {/* Step Block */}
                <div className="flex flex-col items-center text-center lg:text-left lg:items-start p-4 rounded-xl border border-white/[0.04] bg-[#12061F]/60 w-full hover:border-[#A78BFA]/20 transition-all duration-300">
                  <div className={`h-10 w-10 rounded-lg border flex items-center justify-center mb-3 ${step.color}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h4 className="text-sm font-bold text-white tracking-tight">{step.title}</h4>
                  <p className="text-xs text-white/50 mt-1.5">{step.description}</p>
                </div>

                {/* Arrow Connector */}
                {idx < steps.length - 1 && (
                  <div className="my-3 lg:my-0 lg:mx-4 flex items-center justify-center flex-shrink-0 text-white/20">
                    <ArrowRight className="h-5 w-5 rotate-90 lg:rotate-0" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-16 text-center">
          <div className="inline-block rounded-2xl bg-white/[0.03] border border-white/[0.06] px-8 py-6 backdrop-blur-sm max-w-2xl">
            <h3 className="text-lg font-bold text-white mb-2 tracking-tight">
              DeraLedger organizes the entire collection process.
            </h3>
            <p className="text-white/60 text-xs leading-relaxed">
              Instead of manually stitching deposits and offline bank alerts, give your operations team a unified workspace to track invoices and verify balances easily.
            </p>
          </div>
        </div>

      </div>
    </section>
  );
}
