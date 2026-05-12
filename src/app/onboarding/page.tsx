"use client";

import Link from "next/link";
import { CheckCircle2, XCircle, ArrowRight, Shield, Zap, Building2, User, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const plans = [
  {
    id: "starter",
    name: "Starter",
    price: "Free",
    priceNote: "No credit card required",
    icon: Sparkles,
    highlight: false,
    cta: "Get Started Free",
    href: "/onboarding/starter",
    badge: null,
    features: [
      { text: "Unlimited Record-only Invoices", included: true },
      { text: "DeraBot AI analyst", included: true },
      { text: "Invoice sharing (WhatsApp, Email, QR)", included: true },
      { text: "Basic audit log", included: true },
      { text: "Online payment collection", included: false },
      { text: "Team members", included: false },
      { text: "Automated reminders", included: false },
    ],
  },
  {
    id: "individual",
    name: "Individual",
    price: "₦5,000",
    priceNote: "/month",
    icon: User,
    highlight: true,
    cta: "Start with Individual",
    href: "/onboarding/individual",
    badge: "Most Popular",
    features: [
      { text: "Everything in Starter", included: true },
      { text: "Collection Invoices (accept payments)", included: true },
      { text: "BVN verification for instant activation", included: true },
      { text: "Owner + 1 team member", included: true },
      { text: "₦5,000,000 monthly collection limit", included: true },
      { text: "Automated email & WhatsApp reminders", included: true },
      { text: "Unlimited collections", included: false },
    ],
  },
  {
    id: "corporate",
    name: "Corporate",
    price: "₦20,000",
    priceNote: "/month",
    icon: Building2,
    highlight: false,
    cta: "Start with Corporate",
    href: "/onboarding/corporate",
    badge: "Unlimited",
    features: [
      { text: "Everything in Individual", included: true },
      { text: "Unlimited team members", included: true },
      { text: "Unlimited monthly collections", included: true },
      { text: "Full business verification (CAC + BVN)", included: true },
      { text: "Priority support", included: true },
      { text: "Advanced audit trail", included: true },
      { text: "Custom invoice branding", included: true },
    ],
  },
];

export default function OnboardingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-purp-50 via-white to-purp-50">
      {/* Header */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-10 h-10 bg-purp-900 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">D</span>
          </div>
          <span className="text-2xl font-bold text-purp-900">Deraledger</span>
        </Link>
      </div>

      {/* Hero */}
      <div className="max-w-4xl mx-auto text-center px-4 pt-8 pb-12">
        <Badge className="bg-purp-100 text-purp-700 border-purp-200 text-xs font-semibold px-3 py-1 mb-4">
          <Zap className="w-3 h-3 mr-1" />
          Start invoicing in under 2 minutes
        </Badge>
        <h1 className="text-4xl md:text-5xl font-bold text-purp-900 leading-tight">
          Choose your plan
        </h1>
        <p className="mt-4 text-lg text-neutral-500 max-w-2xl mx-auto">
          Simple, transparent pricing. Start free with Record Invoices, or unlock online payment 
          collection with our paid plans. Upgrade or downgrade anytime.
        </p>
      </div>

      {/* Pricing Grid */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <div className="grid md:grid-cols-3 gap-6 items-start">
          {plans.map((plan) => {
            const Icon = plan.icon;
            return (
              <Card
                key={plan.id}
                className={`relative border-2 shadow-none transition-all ${
                  plan.highlight
                    ? "border-purp-600 ring-2 ring-purp-200 scale-[1.02]"
                    : "border-purp-200 hover:border-purp-400"
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className={`text-xs font-bold px-3 py-1 ${
                      plan.highlight 
                        ? "bg-purp-900 text-white border-purp-900"
                        : "bg-purp-100 text-purp-700 border-purp-200"
                    }`}>
                      {plan.badge}
                    </Badge>
                  </div>
                )}

                <CardHeader className="text-center pb-2 pt-6">
                  <div className={`w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-3 ${
                    plan.highlight ? "bg-purp-900 text-white" : "bg-purp-100 text-purp-700"
                  }`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-bold text-purp-900">{plan.name}</h3>
                  <div className="mt-2">
                    <span className="text-3xl font-bold text-purp-900">{plan.price}</span>
                    {plan.priceNote && (
                      <span className="text-sm text-neutral-500 ml-1">{plan.priceNote}</span>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-4 pt-4">
                  <ul className="space-y-3">
                    {plan.features.map((f) => (
                      <li key={f.text} className="flex items-start gap-2 text-sm">
                        {f.included ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-neutral-300 mt-0.5 shrink-0" />
                        )}
                        <span className={f.included ? "text-neutral-700" : "text-neutral-400"}>
                          {f.text}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Link href={plan.href} className="block pt-2">
                    <Button
                      className={`w-full h-12 font-semibold text-base ${
                        plan.highlight
                          ? "bg-purp-900 hover:bg-purp-700 text-white"
                          : "bg-white border-2 border-purp-200 text-purp-900 hover:bg-purp-50"
                      }`}
                    >
                      {plan.cta}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Trust strip */}
      <div className="max-w-4xl mx-auto px-4 pb-16">
        <div className="bg-purp-900 rounded-2xl p-8 text-center text-white">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-lg">Enterprise-grade security</span>
          </div>
          <p className="text-purp-200 text-sm max-w-xl mx-auto">
            Payments processed securely via Paystack. Row-level security on all data.
            Full audit trail. Your financial data never leaves your account.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-6xl mx-auto px-4 pb-8 text-center">
        <p className="text-sm text-neutral-500">
          Already have an account?{" "}
          <Link href="/login" className="text-purp-700 font-semibold hover:underline">
            Sign in
          </Link>
        </p>
        <p className="text-xs text-neutral-400 mt-4">
          © 2026 Deraledger. All rights reserved.
        </p>
      </div>
    </div>
  );
}
