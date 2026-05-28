"use client";

import { Shield, Layers, Landmark, UserCheck, CheckCircle } from "lucide-react";

export function TrustBar() {
  const trustItems = [
    {
      label: "Secure Collections",
      sub: "End-to-end encryption",
      icon: Shield,
    },
    {
      label: "Audit Trail Ledger",
      sub: "100% tamperproof history",
      icon: Layers,
    },
    {
      label: "Payment Integrated",
      sub: "PCI-DSS compliant payments",
      icon: Landmark,
    },
    {
      label: "Verified Merchants",
      sub: "KYC & KYB vetted operations",
      icon: UserCheck,
    },
    {
      label: "99.99% Reliability",
      sub: "High-uptime infrastructure",
      icon: CheckCircle,
    },
  ];

  return (
    <section className="bg-[#F8FAFC] py-10 border-y border-neutral-200/60 relative">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-center gap-y-8 gap-x-10 md:gap-x-16">
          {trustItems.map((item) => {
            const Icon = item.icon;
            return (
              <div 
                key={item.label} 
                className="flex items-center gap-3 text-left min-w-[200px] justify-center sm:justify-start"
              >
                <div className="h-9 w-9 rounded-xl bg-[#6D28FF]/10 flex items-center justify-center text-[#6D28FF] flex-shrink-0">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-neutral-900 tracking-tight leading-none mb-1">{item.label}</h4>
                  <span className="text-[10px] font-semibold text-neutral-500">{item.sub}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
