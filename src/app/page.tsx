import Link from "next/link";
import {
  FileText,
  CreditCard,
  Calculator,
  Bot,
  QrCode,
  Settings,
  ArrowRight,
  CheckCircle2,
  Shield,
  Zap,
  ChevronRight,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    icon: FileText,
    title: "Smart Invoicing",
    description:
      "Create professional invoices with dynamic line items, auto-calculated totals, and custom numbering that matches your existing books.",
  },
  {
    icon: CreditCard,
    title: "Partial Payments",
    description:
      "Accept deposits, installments, and progressive payments on a single invoice. No more issuing multiple invoices for one job.",
  },
  {
    icon: Calculator,
    title: "Proportional Math Engine",
    description:
      "Every partial payment auto-allocates tax and discount proportionally. Percentages stay locked — only naira values scale.",
  },
  {
    icon: Bot,
    title: "PurpBot AI Analyst",
    description:
      "Ask natural language questions about your collections, aging reports, and client history. Read-only by design — your data stays safe.",
  },
  {
    icon: QrCode,
    title: "QR + Digital Links",
    description:
      "Every invoice generates a shareable payment link and a high-res QR code. Clients pay via WhatsApp, SMS, email, or scan.",
  },
  {
    icon: Settings,
    title: "Smart Fee Control",
    description:
      "Set a global Paystack fee absorption default, then override per invoice. Give premium clients special terms without changing settings.",
  },
];

const steps = [
  {
    step: "01",
    title: "Create Your Invoice",
    description: "Add line items, set discounts and tax. PurpLedger calculates everything and generates a payment link instantly.",
  },
  {
    step: "02",
    title: "Share & Collect",
    description: "Send the link or QR code via WhatsApp, email, or print. Your client opens it on any device — no account needed.",
  },
  {
    step: "03",
    title: "Track Every Naira",
    description: "Watch payments come in. PurpLedger updates balances in real time, allocates tax proportionally, and closes invoices automatically.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white border-b-2 border-purp-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purp-900 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">P</span>
              </div>
              <span className="text-xl font-bold text-purp-900">PurpLedger</span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-neutral-500 hover:text-purp-700 font-medium text-sm">
                Features
              </a>
              <a href="#how-it-works" className="text-neutral-500 hover:text-purp-700 font-medium text-sm">
                How It Works
              </a>
              <a href="#pricing" className="text-neutral-500 hover:text-purp-700 font-medium text-sm">
                Pricing
              </a>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/login">
                <Button variant="outline" className="border-2 border-purp-200 text-purp-900 hover:bg-purp-100 font-medium">
                  Log In
                </Button>
              </Link>
              <Link href="/register">
                <Button className="bg-purp-900 hover:bg-purp-700 text-white font-medium px-3 sm:px-4">
                  <span className="hidden sm:inline">Get Started Free</span>
                  <span className="sm:hidden">Start</span>
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="bg-white border-b-2 border-purp-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 bg-purp-100 border-2 border-purp-200 rounded-full px-4 py-1.5 mb-6">
              <Zap className="h-4 w-4 text-purp-700" />
              <span className="text-sm font-semibold text-purp-900">Built for Nigerian Businesses</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold text-purp-900 leading-tight tracking-tight">
              The Smart Ledger for{" "}
              <span className="text-purp-700">Modern Collections</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-neutral-500 leading-relaxed max-w-2xl mx-auto">
              Stop issuing multiple invoices for one job. PurpLedger handles partial payments,
              proportional tax allocation, and dynamic ledger tracking — so every naira is traceable.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/register">
                <Button size="lg" className="bg-purp-900 hover:bg-purp-700 text-white font-semibold px-8 h-12 text-base">
                  Start Invoicing Free
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link href="/pay/inv-001">
                <Button size="lg" variant="outline" className="border-2 border-purp-200 text-purp-900 hover:bg-purp-100 font-semibold px-8 h-12 text-base">
                  See Payment Portal Demo
                </Button>
              </Link>
            </div>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 text-sm text-neutral-500">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Bank-grade security</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Setup in 2 minutes</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-purp-50 border-b-2 border-purp-200 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-purp-900">
              Everything You Need to Collect Smarter
            </h2>
            <p className="mt-4 text-lg text-neutral-500 max-w-2xl mx-auto">
              PurpLedger replaces rigid invoicing with a living ledger that adapts to how your clients actually pay.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-white border-2 border-purp-200 rounded-lg p-6 hover:border-purp-700 transition-colors"
              >
                <div className="w-10 h-10 bg-purp-100 border-2 border-purp-200 rounded-lg flex items-center justify-center mb-4">
                  <feature.icon className="h-5 w-5 text-purp-700" />
                </div>
                <h3 className="text-lg font-bold text-purp-900 mb-2">{feature.title}</h3>
                <p className="text-neutral-500 text-sm leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-white border-b-2 border-purp-200 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-purp-900">
              How It Works
            </h2>
            <p className="mt-4 text-lg text-neutral-500">
              Three steps from invoice creation to cash collection.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {steps.map((step, index) => (
              <div key={step.step} className="relative">
                <div className="bg-purp-50 border-2 border-purp-200 rounded-lg p-8">
                  <span className="text-5xl font-bold text-purp-200">{step.step}</span>
                  <h3 className="mt-4 text-xl font-bold text-purp-900">{step.title}</h3>
                  <p className="mt-2 text-neutral-500 leading-relaxed">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <div className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10">
                    <ChevronRight className="h-8 w-8 text-purp-200" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tiers & Pricing */}
      <section id="pricing" className="bg-purp-50 border-b-2 border-purp-200 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-purp-900">
              Pricing & Verification Tiers
            </h2>
            <p className="mt-4 text-lg text-neutral-500 max-w-2xl mx-auto">
              Start for free with our Bookkeeping Mode. Verify your identity to unlock live Paystack payment collections.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white border-2 border-purp-200 rounded-lg p-8 relative flex flex-col">
              <h3 className="text-2xl font-bold text-purp-900 mb-2">Starter (Tier 0)</h3>
              <p className="text-neutral-500 mb-6">For basic bookkeeping.</p>
              <div className="text-3xl font-bold text-purp-900 mb-6">Free</div>
              <ul className="space-y-3 mb-8 flex-1">
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /><span className="text-neutral-600">Draft Invoicing Enabled</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /><span className="text-neutral-600">PurpBot AI Enabled</span></li>
                <li className="flex items-start gap-2"><XCircle className="h-5 w-5 text-red-500 shrink-0" /><span className="text-neutral-600">₦0 Monthly Collection Limit</span></li>
                <li className="flex items-start gap-2"><XCircle className="h-5 w-5 text-red-500 shrink-0" /><span className="text-neutral-600">Payment Links Locked</span></li>
              </ul>
              <Badge variant="outline" className="border-purp-200 bg-purp-50 text-purp-900 w-full justify-center py-2 text-sm">Instant Approval</Badge>
            </div>

            <div className="bg-purp-900 border-2 border-purp-900 rounded-lg p-8 relative shadow-lg transform md:-translate-y-4 flex flex-col">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-amber-400 text-amber-950 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                Most Popular
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Individual (Tier 1)</h3>
              <p className="text-purp-200 mb-6">For freelancers and sole traders.</p>
              <div className="text-3xl font-bold text-white mb-6">1.5% <span className="text-sm font-normal text-purp-200">per txn</span></div>
              <ul className="space-y-3 mb-8 flex-1">
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" /><span className="text-white">Draft Invoicing Enabled</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" /><span className="text-white">Payment Links Enabled</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" /><span className="text-white">₦5,000,000 / mo Limit</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" /><span className="text-white">PurpBot AI Enabled</span></li>
              </ul>
              <Badge variant="outline" className="border-purp-700 bg-purp-800 text-white w-full justify-center py-2 text-sm border-2">Auto-validation (BVN/NIN)</Badge>
            </div>

            <div className="bg-white border-2 border-purp-200 rounded-lg p-8 relative flex flex-col">
              <h3 className="text-2xl font-bold text-purp-900 mb-2">Corporate (Tier 2)</h3>
              <p className="text-neutral-500 mb-6">For registered businesses.</p>
              <div className="text-3xl font-bold text-purp-900 mb-6">1.5% <span className="text-sm font-normal text-neutral-500">per txn</span></div>
              <ul className="space-y-3 mb-8 flex-1">
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /><span className="text-neutral-600">Draft Invoicing Enabled</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /><span className="text-neutral-600">Payment Links Enabled</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /><span className="text-neutral-600">Unlimited Collection</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" /><span className="text-neutral-600">PurpBot AI Enabled</span></li>
              </ul>
              <Badge variant="outline" className="border-purp-200 bg-purp-50 text-purp-900 w-full justify-center py-2 text-sm">Manual Review (CAC Docs)</Badge>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-purp-900 py-20">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white">
            Ready to Transform Your Collections?
          </h2>
          <p className="mt-4 text-lg text-purp-200 leading-relaxed">
            Join hundreds of Nigerian businesses using PurpLedger to track every naira,
            honour every partial payment, and eliminate invoice chaos.
          </p>
          <div className="mt-10">
            <Link href="/register">
              <Button size="lg" className="bg-white text-purp-900 hover:bg-purp-100 font-semibold px-10 h-12 text-base">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t-2 border-purp-200 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purp-900 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">P</span>
              </div>
              <span className="text-lg font-bold text-purp-900">PurpLedger</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-sm text-neutral-500">
              <a href="#" className="hover:text-purp-700">Privacy</a>
              <a href="#" className="hover:text-purp-700">Terms</a>
              <a href="#" className="hover:text-purp-700">Support</a>
              <a href="#" className="hover:text-purp-700">Contact</a>
            </div>
            <p className="text-sm text-neutral-500">
              © 2025 PurpLedger. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
