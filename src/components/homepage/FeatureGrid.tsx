"use client";

import { FileText, Activity, BookOpen, Users, CheckSquare, Layers, ArrowDownToLine, PieChart, Sparkles } from "lucide-react";

export function FeatureGrid() {
  const features = [
    {
      title: "Smart Invoicing",
      description: "Generate professional invoices in seconds, complete with automated reminders and instant payment triggers.",
      icon: FileText,
    },
    {
      title: "Collections Tracking",
      description: "Monitor real-time progress on exactly how much of a project or total contract has been funded.",
      icon: Activity,
    },
    {
      title: "Offline Payment Records",
      description: "Log bank transfers, checks, or cash payments alongside online collections in one unified timeline.",
      icon: BookOpen,
    },
    {
      title: "Team Access Control",
      description: "Give staff role-based permissions (RBAC) to generate invoice links and verify payments without exposing banking details.",
      icon: Users,
    },
    {
      title: "Payment Reconciliation",
      description: "Automatically reconcile deposits, installments, and final balances against corresponding invoices.",
      icon: CheckSquare,
    },
    {
      title: "Grouped Receivables",
      description: "Consolidate multiple related invoices and milestone requests into a single, clean client folder.",
      icon: Layers,
    },
    {
      title: "Deposit Allocation",
      description: "Apply previously paid deposits directly to final balances automatically, eliminating double counting.",
      icon: ArrowDownToLine,
    },
    {
      title: "Partial Payments",
      description: "Enforce payment thresholds and accept partial collection amounts against active invoices.",
      icon: PieChart,
    },
  ];

  return (
    <section id="features" className="bg-[#F8FAFC] py-20 md:py-28 border-t border-neutral-200/80 relative">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-[#6D28FF]/10 px-3 py-1 mb-4">
            <Sparkles className="h-3 w-3 text-[#6D28FF]" />
            <span className="text-[10px] font-bold text-[#6D28FF] tracking-widest uppercase">Product Capabilities</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-neutral-900 tracking-tight leading-tight">
            Infrastructure designed for receivables visibility.
          </h2>
          <p className="text-sm md:text-base text-neutral-600 mt-4 leading-relaxed">
            From smart digital invoices to custom team workflows, DeraLedger gives African businesses all the capabilities needed to secure and monitor revenue.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div 
                key={feature.title} 
                className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm hover:shadow-md hover:border-[#6D28FF]/30 transition-all duration-300 group"
              >
                <div className="h-10 w-10 rounded-lg bg-[#6D28FF]/10 flex items-center justify-center mb-4 transition-colors group-hover:bg-[#6D28FF] group-hover:text-white text-[#6D28FF]">
                  <Icon className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
                </div>
                <h3 className="text-base font-bold text-neutral-900 mb-2 tracking-tight">{feature.title}</h3>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
