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
    verification: "BVN & Selfie required",
    cta: "Start collecting",
    featured: true,
    included: [
      "Collection invoices enabled",
      "Online payment collection",
      "Grouped references & deposits",
      "Partial payment controls",
      "₦5M monthly collection limit",
      "20 active collection invoices",
      "Predefined team roles only",
      "Watermark enabled",
    ],
  },
  {
    name: "Business",
    href: "/onboarding/corporate",
    price: "CAC Verified",
    bestFor: "Operational collections infrastructure for growing businesses",
    verification: "CAC & Director required",
    cta: "Set up business",
    featured: false,
    included: [
      "Unlimited collections",
      "Unlimited collection invoices",
      "Custom Role-Based Access (RBAC)",
      "Grouped receivables",
      "Advanced analytics",
      "No watermark",
      "White-label invoices",
      "Advanced operational workflows",
    ],
  },
];

export function PricingSection() {
  return (
    <section className="bg-[#12061F] py-20 md:py-32 border-t border-white/5 relative">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-[#B58CFF] mb-3">
            Simple, scalable pricing
          </p>
          <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight mb-6">
            Scale your operations.
          </h2>
          <p className="text-lg text-white/60">
            Start tracking offline for free, or verify your identity to unlock powerful online payment collections.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8 items-start">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex flex-col rounded-2xl border ${
                plan.featured
                  ? "border-[#7B2FF7] bg-[#3D0B66]/30 shadow-[0_0_30px_rgba(123,47,247,0.15)]"
                  : "border-white/10 bg-white/5"
              } p-8 backdrop-blur-sm`}
            >
              {plan.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#7B2FF7] to-[#B58CFF] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                  Most Popular
                </div>
              )}

              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#B58CFF] mb-2">
                  {plan.verification}
                </p>
                <h3 className="text-2xl font-bold text-white">{plan.name}</h3>
                <p className="mt-2 text-sm text-white/60 h-10">
                  {plan.bestFor}
                </p>
              </div>

              <div className="mb-6">
                <div className="text-3xl font-bold text-white">{plan.price}</div>
              </div>

              <ul className="mb-8 space-y-4 flex-1">
                {plan.included.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm">
                    <CheckCircle2 className={`h-4 w-4 mt-0.5 flex-shrink-0 ${plan.featured ? "text-[#B58CFF]" : "text-[#7B2FF7]"}`} />
                    <span className="text-white/80">{item}</span>
                  </li>
                ))}
              </ul>

              <Link href={plan.href} className="mt-auto block w-full">
                <Button
                  className={`w-full h-12 font-semibold transition-all ${
                    plan.featured
                      ? "bg-[#7B2FF7] text-white hover:bg-[#B58CFF] hover:text-[#12061F] border-0"
                      : "bg-white/10 text-white hover:bg-white/20 border-0"
                  }`}
                >
                  {plan.cta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}
