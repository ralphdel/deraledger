"use client";

import { Briefcase, GraduationCap, Store, UserCheck, CalendarDays, Hammer, Sparkles } from "lucide-react";

export function WhoItIsFor() {
  const categories = [
    {
      title: "Agencies",
      description: "Group creative deposits, retainer milestones, and final campaign balances under unified references.",
      icon: Briefcase,
    },
    {
      title: "Schools",
      description: "Manage termly school fees and extracurricular charges in structured installment parts for parents.",
      icon: GraduationCap,
    },
    {
      title: "Vendors",
      description: "Secure initial material deposits and dispatch professional milestone collections to wholesale buyers.",
      icon: Store,
    },
    {
      title: "Consultants",
      description: "Automate billing cycles, handle retainers, and enforce minimum partial thresholds with professional ease.",
      icon: UserCheck,
    },
    {
      title: "Event Businesses",
      description: "Coordinate massive group receivables, wedding deposits, venue payments, and vendor disbursements clearly.",
      icon: CalendarDays,
    },
    {
      title: "Contractors",
      description: "Track progressive project milestone payments, field expenses, and final balances on one timeline.",
      icon: Hammer,
    },
  ];

  return (
    <section className="bg-[#0B0615] py-20 md:py-28 border-t border-white/[0.06] relative overflow-hidden">
      {/* Glow accents */}
      <div className="absolute left-1/2 bottom-0 -translate-x-1/2 h-[350px] w-[500px] bg-[#6D28FF]/5 blur-[120px] pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 mb-4">
            <Sparkles className="h-3 w-3 text-[#A78BFA]" />
            <span className="text-[10px] font-bold text-white/70 tracking-widest uppercase">Operational Workflows</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight">
            Built for structured billing. Designed for growth.
          </h2>
          <p className="text-sm md:text-base text-white/60 mt-4 leading-relaxed">
            From growing SMEs and professional services to industrial leaders and vendors, DeraLedger is built for any business that invoices clients, requests retainer deposits, and manages progressive payment collections.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {categories.map((cat) => {
            const Icon = cat.icon;
            return (
              <div 
                key={cat.title} 
                className="rounded-2xl border border-white/[0.06] bg-[#12061F]/40 p-6 hover:bg-[#12061F]/80 hover:border-[#A78BFA]/20 transition-all duration-300 group"
              >
                <div className="h-10 w-10 rounded-lg bg-[#6D28FF]/15 border border-[#6D28FF]/20 flex items-center justify-center mb-4 text-[#A78BFA] transition-colors group-hover:bg-[#6D28FF] group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-white mb-2 tracking-tight">{cat.title}</h3>
                <p className="text-xs text-white/50 leading-relaxed">
                  {cat.description}
                </p>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
