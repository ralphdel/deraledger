"use client";

import { FileText, Clock, BarChart3 } from "lucide-react";

const steps = [
  {
    id: "01",
    title: "Create Collections",
    description: "Group related invoices using references, set up partial payments, and issue collection requests in seconds.",
    icon: FileText,
  },
  {
    id: "02",
    title: "Track Payments",
    description: "Monitor initial deposits, track installment workflows, and view real-time outstanding balances.",
    icon: Clock,
  },
  {
    id: "03",
    title: "Reconcile Clearly",
    description: "See the full payment history at a glance. Understand exactly what has been collected and what is pending.",
    icon: BarChart3,
  },
];

export function WorkflowSection() {
  return (
    <section className="bg-[#12061F] py-20 md:py-32 border-t border-white/5 relative">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#7B2FF7] mb-3">
            How DeraLedger Works
          </p>
          <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight">
            From deposit to final balance.
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.id} className="relative group rounded-2xl bg-white/5 border border-white/10 p-8 hover:bg-white/10 transition-colors duration-300">
                {/* Subtle top glow on hover */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#7B2FF7]/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                
                <div className="flex items-center justify-between mb-8">
                  <div className="h-12 w-12 rounded-xl bg-[#3D0B66]/50 border border-[#7B2FF7]/30 flex items-center justify-center text-[#B58CFF]">
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className="text-4xl font-black text-white/5 font-mono">{step.id}</span>
                </div>
                
                <h3 className="text-xl font-bold text-white mb-3">{step.title}</h3>
                <p className="text-white/60 leading-relaxed text-sm">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
