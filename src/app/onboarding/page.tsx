"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  ShieldCheck,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const plans = [
  {
    id: "starter",
    name: "Starter",
    href: "/onboarding/starter",
    price: "Free",
    verification: "No KYC required",
    bestFor: "For testing and offline invoice tracking",
    icon: Sparkles,
    highlight: false,
    badge: null,
    cta: "Start tracking free",
    included: [
      "10 lifetime record invoices",
      "No collection invoices",
      "No payment links",
      "Owner + 1 team member (2 seats total)",
      "Predefined roles only",
      "Watermark enabled",
    ],
    locked: [
      "Collection invoices",
      "Payment links and QR collections",
      "Partial payment controls",
      "Custom roles",
    ],
    footer: "Best for learning the workflow before collecting online.",
  },
  {
    id: "individual",
    name: "Individual",
    href: "/onboarding/individual",
    price: "BVN Verified",
    priceNote: "",
    verification: "BVN & Selfie required",
    bestFor: "For verified online collections",
    icon: User,
    highlight: true,
    badge: "Most Popular",
    cta: "Start collecting",
    included: [
      "Collection invoices enabled",
      "Online payment collection",
      "Grouped references & deposits",
      "Partial payment controls",
      "₦5M monthly collection limit",
      "20 active collection invoices",
      "Up to 4 invited team members (5 total)",
      "Predefined roles only",
      "Watermark enabled",
    ],
    locked: ["Full custom RBAC", "White-label invoices", "Advanced analytics"],
    footer: "Designed for growing businesses that get paid in parts.",
  },
  {
    id: "corporate",
    name: "Business",
    href: "/onboarding/corporate",
    price: "CAC Verified",
    priceNote: "",
    verification: "CAC & Director required",
    bestFor: "Operational collections infrastructure for growing businesses",
    icon: Building2,
    highlight: false,
    badge: "Unlimited collections",
    cta: "Set up business",
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
    locked: [],
    footer: "Built for organizational controls and higher collection confidence.",
  },
];

const workflowNotes = [
  {
    title: "Record payments offline",
    description: "Track transfers, cash, deposits, and manual collections without forcing online payment.",
    icon: ClipboardList,
  },
  {
    title: "Collect with payment links",
    description: "Enable Paystack-powered collection invoices after the right verification step.",
    icon: CreditCard,
  },
  {
    title: "See balances clearly",
    description: "Know what has been paid, what remains outstanding, and who still owes.",
    icon: BarChart3,
  },
];

function BrandLink() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="DeraLedger home">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#7B2FF7] text-sm font-bold text-white shadow-[0_0_10px_rgba(123,47,247,0.4)]">
        D
      </div>
      <span className="text-xl font-bold text-white">DeraLedger</span>
    </Link>
  );
}

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-[#12061F] text-white selection:bg-[#7B2FF7]/30">
      <header className="border-b border-white/5 bg-[#12061F]/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandLink />
          <Link href="/login" className="text-sm font-semibold text-white/80 hover:text-white">
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-4 pb-10 pt-12 text-center sm:px-6 md:pt-16">
          <Badge className="mb-4 border-[#7B2FF7]/30 bg-[#7B2FF7]/10 text-[#B58CFF]">
            Built for businesses that get paid in parts
          </Badge>
          <h1 className="text-4xl font-bold leading-tight text-white md:text-5xl">
            Choose How You Want To Use DeraLedger
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-white/60">
            Start with simple balance tracking, or verify your business workflow to unlock online
            collections, payment links, team access, and stronger controls.
          </p>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
          <div className="grid gap-5 md:grid-cols-3">
            {workflowNotes.map((note) => {
              const Icon = note.icon;
              return (
                <div key={note.title} className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#7B2FF7]/10 text-[#B58CFF]">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h2 className="text-xl font-bold text-white">{note.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{note.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-3">
            {plans.map((plan) => {
              const Icon = plan.icon;
              return (
                <Card
                  key={plan.id}
                  className={`relative flex flex-col rounded-2xl border shadow-none ${
                    plan.highlight
                      ? "border-[#7B2FF7] bg-[#3D0B66]/30 shadow-[0_0_30px_rgba(123,47,247,0.15)]"
                      : "border-white/10 bg-white/5"
                  } backdrop-blur-sm`}
                >
                  {plan.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#7B2FF7] to-[#B58CFF] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                      {plan.badge}
                    </div>
                  )}

                  <CardHeader className="px-8 pb-0 pt-10">
                    <div
                      className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg ${
                        plan.highlight ? "bg-white/10 text-white" : "bg-[#7B2FF7]/10 text-[#B58CFF]"
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <p
                      className="text-xs font-semibold uppercase tracking-wider text-[#B58CFF] mb-2"
                    >
                      {plan.verification}
                    </p>
                    <h2 className="text-2xl font-bold text-white">
                      {plan.name}
                    </h2>
                    <p className="mt-2 text-sm text-white/60 h-10">
                      {plan.bestFor}
                    </p>
                    <div className="pt-2 text-3xl font-bold text-white">
                      {plan.price}
                      {plan.priceNote && (
                        <span className="ml-1 text-sm font-medium text-white/60">
                          {plan.priceNote}
                        </span>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-1 flex-col px-8 pb-8 pt-6">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-white mb-4">
                        Included
                      </p>
                      <ul className="space-y-4">
                        {plan.included.map((item) => (
                          <li key={item} className="flex items-start gap-3 text-sm">
                            <CheckCircle2
                              className={`mt-0.5 h-4 w-4 shrink-0 ${
                                plan.highlight ? "text-[#B58CFF]" : "text-[#7B2FF7]"
                              }`}
                            />
                            <span className="text-white/80">{item}</span>
                          </li>
                        ))}
                      </ul>

                      {plan.locked.length > 0 && (
                        <>
                          <p className="mt-6 mb-3 text-sm font-bold text-white/60">
                            Unlock later
                          </p>
                          <ul className="space-y-2">
                            {plan.locked.map((item) => (
                              <li key={item} className="text-sm text-white/40">
                                {item}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>

                    <p className="mt-6 mb-6 text-sm text-white/50">
                      {plan.footer}
                    </p>
                    <Link href={plan.href} className="mt-auto block w-full">
                      <Button
                        className={`h-12 w-full font-semibold transition-all ${
                          plan.highlight
                            ? "bg-[#7B2FF7] text-white hover:bg-[#B58CFF] hover:text-[#12061F] border-0"
                            : "bg-white/10 text-white hover:bg-white/20 border-0"
                        }`}
                      >
                        {plan.cta}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <div className="rounded-2xl border border-[#7B2FF7]/30 bg-[#7B2FF7]/5 p-8 text-center md:p-10 backdrop-blur-sm shadow-[0_0_20px_rgba(123,47,247,0.05)]">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-[#7B2FF7]/20 text-[#B58CFF]">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <h2 className="text-3xl font-bold text-white">Verification follows the workflow.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/60">
              Starter opens immediately. Individual collections require BVN verification. Business
              workspaces use CAC and director verification for higher trust and unlimited collections.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm font-semibold text-white">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 backdrop-blur-sm">
                <Users className="h-4 w-4 text-[#B58CFF]" />
                Simple team access
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 backdrop-blur-sm">
                <ShieldCheck className="h-4 w-4 text-[#B58CFF]" />
                Paystack-powered payments
              </span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 bg-[#12061F] px-4 py-10 text-center text-sm text-white/50">
        <p>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-white hover:text-[#B58CFF] transition-colors">
            Sign in
          </Link>
        </p>
        <p className="mt-3">© 2026 DeraLedger. All rights reserved.</p>
      </footer>
    </div>
  );
}
