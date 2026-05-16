"use client";

import { Activity, ArrowDownToLine, PieChart, Layers, Users, ShieldCheck, CheckSquare, FolderTree } from "lucide-react";

const features = [
  {
    title: "Collection References",
    description: "Track every payment tied to the same project or client under one unified reference.",
    icon: FolderTree,
  },
  {
    title: "Deposit Allocation",
    description: "Deduct paid deposits automatically from final balances so you never double-bill.",
    icon: ArrowDownToLine,
  },
  {
    title: "Partial Payments",
    description: "Accept installment payments against larger invoices while enforcing minimum thresholds.",
    icon: PieChart,
  },
  {
    title: "Grouped Receivables",
    description: "Consolidate multiple related invoices into a single payment pipeline.",
    icon: Layers,
  },
  {
    title: "Collections Tracking",
    description: "Monitor real-time progress on exactly how much of a project has been funded.",
    icon: Activity,
  },
  {
    title: "Payment Reconciliation",
    description: "Instantly know which invoices are open, partially paid, or completely settled.",
    icon: CheckSquare,
  },
  {
    title: "Team Access",
    description: "Give operational staff controlled access to generate links and verify payments.",
    icon: Users,
  },
  {
    title: "Verification & Trust",
    description: "Keep bad actors out with strict BVN and Business verification workflows.",
    icon: ShieldCheck,
  },
];

export function FeatureGrid() {
  return (
    <section className="bg-[#12061F] py-20 md:py-32 border-t border-white/5 relative">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#7B2FF7] mb-3">
            Operational Capabilities
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            Infrastructure designed for receivables visibility.
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="rounded-2xl border border-white/10 bg-white/5 p-6 hover:bg-white/10 transition-colors">
                <div className="h-10 w-10 rounded-lg bg-[#3D0B66] border border-[#7B2FF7]/30 flex items-center justify-center mb-4">
                  <Icon className="h-5 w-5 text-[#B58CFF]" />
                </div>
                <h3 className="text-base font-bold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-white/60 leading-relaxed">
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
