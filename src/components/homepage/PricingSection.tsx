"use client";

import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const plans = [
  {
    name: "Starter",
    href: "/onboarding/starter",
    price: "Free",
    bestFor: "For testing and offline invoice tracking",
    verification: "No KYC required",
    cta: "Start tracking free",
    featured: false,
    included: [
      "10 lifetime record invoices",
      "No collection invoices",
      "No payment links",
      "1 additional team member",
      "Predefined roles only",
      "Watermark enabled",
    ],
  },
  {
    name: "Individual",
    href: "/onboarding/individual",
    price: "BVN Verified",
    bestFor: "For verified online collections",
    verification: "Identity validation required",
    cta: "Start collecting",
    featured: true,
    included: [
      "Collection invoices enabled",
      "Grouped references",
      "Deposit allocations",
      "Partial payments",
      "₦5M monthly collection limit",
      "Predefined roles only",
    ],
  },
  {
    name: "Business",
    href: "/onboarding/corporate",
    price: "Business Verified",
    bestFor: "Collections infrastructure for growing teams",
    verification: "Corporate vetting required",
    cta: "Set up business",
    featured: false,
    included: [
      "Unlimited collections",
      "Custom RBAC setup",
      "Advanced analytics dashboard",
      "Grouped receivables timeline",
      "No watermark",
      "White-label invoices",
    ],
  },
];

export function PricingSection() {
  return (
    <section className="bg-[#0B0615] py-20 md:py-28 border-t border-white/[0.06] relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-xs font-bold uppercase tracking-widest text-[#A78BFA] mb-3">
            Simple, scalable pricing
          </p>
          <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight mb-6">
            Scale your operations.
          </h2>
          <p className="text-sm md:text-base text-white/60 leading-relaxed">
            Start tracking offline payments for free, or verify your identity to unlock complete online collection and automated reconciliation tools.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 items-start max-w-6xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border transition-all duration-300 ${
                plan.featured
                  ? "border-[#6D28FF] bg-[#12061F]/60 shadow-[0_4px_30px_rgba(109,40,255,0.15)]"
                  : "border-white/[0.06] bg-[#12061F]/30"
              } p-6 md:p-8 backdrop-blur-sm hover:border-[#A78BFA]/30`}
            >
              {plan.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#6D28FF] to-[#A78BFA] px-3.5 py-1 text-[9px] font-bold uppercase tracking-widest text-white border border-[#6D28FF]/50">
                  Most Popular
                </div>
              )}

              <div className="mb-6">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#A78BFA] mb-2">
                  {plan.verification}
                </p>
                <h3 className="text-xl font-bold text-white tracking-tight">{plan.name}</h3>
                <p className="mt-2 text-xs text-white/50 leading-relaxed min-h-[40px]">
                  {plan.bestFor}
                </p>
              </div>

              <div className="mb-6 pb-6 border-b border-white/[0.06]">
                <div className="text-2xl md:text-3xl font-black text-white tracking-tight">{plan.price}</div>
              </div>

              <ul className="mb-8 space-y-3.5 flex-1">
                {plan.included.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-xs leading-relaxed">
                    <CheckCircle2 className={`h-4 w-4 mt-0.5 flex-shrink-0 ${plan.featured ? "text-[#A78BFA]" : "text-[#6D28FF]"}`} />
                    <span className="text-white/80">{item}</span>
                  </li>
                ))}
              </ul>

              <Link href={plan.href} className="mt-auto block w-full">
                <Button
                  className={`w-full h-11 font-bold text-xs uppercase tracking-wider transition-all border-0 ${
                    plan.featured
                      ? "bg-[#6D28FF] text-white hover:bg-[#6D28FF]/90"
                      : "bg-white/[0.06] text-white hover:bg-white/[0.12]"
                  }`}
                >
                  {plan.cta}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
