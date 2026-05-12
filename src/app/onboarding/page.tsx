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
    label: "No verification required",
    bestFor: "Freelancers and small businesses tracking invoices and outstanding balances.",
    icon: Sparkles,
    highlight: false,
    badge: null,
    cta: "Start tracking free",
    included: [
      "10 record invoices monthly",
      "Offline payment tracking",
      "Outstanding balance tracking",
      "Basic dashboard",
      "Owner + 1 team member",
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
    name: "Individual / Collections",
    href: "/onboarding/individual",
    price: "NGN 5,000",
    priceNote: "/month",
    label: "BVN verification",
    bestFor: "Businesses collecting payments online with automatic balance tracking.",
    icon: User,
    highlight: true,
    badge: "Primary collection workflow",
    cta: "Start collecting",
    included: [
      "Unlimited record invoices",
      "Collection invoices and payment links",
      "QR collections",
      "Partial payment controls",
      "Automatic balance tracking",
      "5 team members",
      "NGN 5M monthly collection limit",
    ],
    locked: ["Full custom RBAC", "Audit logs"],
    footer: "Designed for growing businesses that get paid in parts.",
  },
  {
    id: "corporate",
    name: "Business",
    href: "/onboarding/corporate",
    price: "NGN 20,000",
    priceNote: "/month",
    label: "CAC verification",
    bestFor: "Operational businesses and finance teams managing structured workflows.",
    icon: Building2,
    highlight: false,
    badge: "Unlimited collections",
    cta: "Set up business",
    included: [
      "Unlimited record invoices",
      "Unlimited collection invoices",
      "Advanced team management",
      "Full custom RBAC",
      "Custom roles",
      "Audit logs",
      "Advanced reporting",
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
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purp-900 text-lg font-bold text-white">
        D
      </div>
      <span className="text-2xl font-bold text-purp-900">DeraLedger</span>
    </Link>
  );
}

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-purp-50">
      <header className="border-b border-purp-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
          <BrandLink />
          <Link href="/login" className="text-sm font-semibold text-purp-700 hover:text-purp-900">
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-4 pb-10 pt-12 text-center sm:px-6 md:pt-16">
          <Badge className="mb-4 border-purp-200 bg-purp-100 text-purp-900">
            Built for businesses that get paid in parts
          </Badge>
          <h1 className="text-4xl font-bold leading-tight text-purp-900 md:text-5xl">
            Choose How You Want To Use DeraLedger
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-neutral-500">
            Start with simple balance tracking, or verify your business workflow to unlock online
            collections, payment links, team access, and stronger controls.
          </p>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
          <div className="grid gap-5 md:grid-cols-3">
            {workflowNotes.map((note) => {
              const Icon = note.icon;
              return (
                <div key={note.title} className="rounded-lg border-2 border-purp-200 bg-white p-5">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-purp-100 text-purp-700">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="text-lg font-bold text-purp-900">{note.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-500">{note.description}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-3">
            {plans.map((plan) => {
              const Icon = plan.icon;
              return (
                <Card
                  key={plan.id}
                  className={`relative border-2 py-0 shadow-none ${
                    plan.highlight
                      ? "border-purp-900 bg-purp-900 text-white"
                      : "border-purp-200 bg-white"
                  }`}
                >
                  {plan.badge && (
                    <Badge
                      className={`absolute left-5 top-5 ${
                        plan.highlight
                          ? "border-amber-300 bg-amber-300 text-amber-950"
                          : "border-purp-200 bg-purp-100 text-purp-700"
                      }`}
                    >
                      {plan.badge}
                    </Badge>
                  )}

                  <CardHeader className="px-6 pb-0 pt-14">
                    <div
                      className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg ${
                        plan.highlight ? "bg-white/10 text-white" : "bg-purp-100 text-purp-700"
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <p
                      className={`text-xs font-semibold uppercase tracking-wide ${
                        plan.highlight ? "text-purp-200" : "text-purp-700"
                      }`}
                    >
                      {plan.label}
                    </p>
                    <h2 className={`text-2xl font-bold ${plan.highlight ? "text-white" : "text-purp-900"}`}>
                      {plan.name}
                    </h2>
                    <p className={`text-sm leading-relaxed ${plan.highlight ? "text-purp-100" : "text-neutral-500"}`}>
                      {plan.bestFor}
                    </p>
                    <div className={`pt-2 text-3xl font-bold ${plan.highlight ? "text-white" : "text-purp-900"}`}>
                      {plan.price}
                      {plan.priceNote && (
                        <span className={`ml-1 text-sm font-medium ${plan.highlight ? "text-purp-200" : "text-neutral-500"}`}>
                          {plan.priceNote}
                        </span>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-1 flex-col px-6 pb-6 pt-5">
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${plan.highlight ? "text-white" : "text-purp-900"}`}>
                        Included
                      </p>
                      <ul className="mt-3 space-y-3">
                        {plan.included.map((item) => (
                          <li key={item} className="flex items-start gap-2 text-sm">
                            <CheckCircle2
                              className={`mt-0.5 h-4 w-4 shrink-0 ${
                                plan.highlight ? "text-emerald-300" : "text-emerald-600"
                              }`}
                            />
                            <span className={plan.highlight ? "text-white" : "text-neutral-600"}>{item}</span>
                          </li>
                        ))}
                      </ul>

                      {plan.locked.length > 0 && (
                        <>
                          <p className={`mt-5 text-sm font-bold ${plan.highlight ? "text-purp-100" : "text-purp-900"}`}>
                            Unlock later
                          </p>
                          <ul className="mt-3 space-y-2">
                            {plan.locked.map((item) => (
                              <li key={item} className={`text-sm ${plan.highlight ? "text-purp-200" : "text-neutral-400"}`}>
                                {item}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>

                    <p className={`mt-6 text-sm ${plan.highlight ? "text-purp-200" : "text-neutral-500"}`}>
                      {plan.footer}
                    </p>
                    <Link href={plan.href} className="mt-5 block">
                      <Button
                        className={`h-12 w-full font-semibold ${
                          plan.highlight
                            ? "bg-white text-purp-900 hover:bg-purp-100"
                            : "border-2 border-purp-200 bg-white text-purp-900 hover:bg-purp-50"
                        }`}
                      >
                        {plan.cta}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
          <div className="rounded-lg border-2 border-purp-200 bg-white p-6 text-center md:p-8">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-bold text-purp-900">Verification follows the workflow.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-neutral-500">
              Starter opens immediately. Individual collections require BVN verification. Business
              workspaces use CAC and director verification for higher trust and unlimited collections.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3 text-sm font-semibold text-purp-900">
              <span className="inline-flex items-center gap-2 rounded-full bg-purp-50 px-4 py-2">
                <Users className="h-4 w-4 text-purp-700" />
                Simple team access
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-purp-50 px-4 py-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Paystack-powered payments
              </span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-purp-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
        <p>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-purp-700 hover:underline">
            Sign in
          </Link>
        </p>
        <p className="mt-3">© 2026 DeraLedger. All rights reserved.</p>
      </footer>
    </div>
  );
}
