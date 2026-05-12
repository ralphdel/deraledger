import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  LockKeyhole,
  Mail,
  QrCode,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navLinks = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Capabilities", href: "#capabilities" },
  { label: "Pricing", href: "#pricing" },
];

const problemPoints = [
  "Deposits",
  "Installments",
  "Progressive balances",
  "Offline transfers",
  "Partial settlements",
];

const confusionPoints = [
  "Reconciliation confusion",
  "Multiple invoices for one job",
  "Spreadsheet dependency",
  "Inaccurate outstanding balances",
];

const workflowSteps = [
  {
    title: "Create an invoice",
    description: "Create collection invoices or bookkeeping invoices in seconds.",
    icon: FileText,
  },
  {
    title: "Share or record payments",
    description: "Send payment links online or manually record offline collections.",
    icon: CreditCard,
  },
  {
    title: "Track everything automatically",
    description: "Balances, collections, and payment progress update instantly.",
    icon: BarChart3,
  },
];

const capabilities = [
  {
    title: "Collection invoices",
    description: "Generate payment links and QR codes for online collections.",
    icon: QrCode,
  },
  {
    title: "Record invoices",
    description: "Track offline transfers, cash collections, and manual payments.",
    icon: ClipboardList,
  },
  {
    title: "Partial payment controls",
    description: "Allow partial payments and define minimum payment thresholds.",
    icon: Banknote,
  },
  {
    title: "Smart balance tracking",
    description: "Know what has been paid, what remains, and who still owes.",
    icon: BarChart3,
  },
  {
    title: "Team access",
    description: "Support finance staff and operational workflows with role-based access.",
    icon: Users,
  },
  {
    title: "DeraBot AI assistant",
    description: "Review balances, collections, payment history, and operational performance.",
    icon: Bot,
  },
];

const plans = [
  {
    name: "Starter",
    href: "/onboarding/starter",
    price: "Free",
    bestFor: "Freelancers and small businesses tracking invoices and outstanding balances.",
    verification: "No verification required",
    cta: "Start tracking free",
    featured: false,
    included: [
      "10 record invoices monthly",
      "Offline payment tracking",
      "Outstanding balance tracking",
      "Basic dashboard",
      "Owner + 1 team member",
    ],
    note: "Payment links unlock when you verify for collections.",
  },
  {
    name: "Individual / Collections",
    href: "/onboarding/individual",
    price: "BVN verified",
    bestFor: "Businesses collecting payments online with automatic balance tracking.",
    verification: "BVN verification",
    cta: "Start collecting",
    featured: true,
    included: [
      "Unlimited record invoices",
      "Collection invoices and payment links",
      "QR collections",
      "Partial payment controls",
      "5 team members",
      "NGN 5M monthly collection limit",
    ],
    note: "Designed for growing businesses that collect online.",
  },
  {
    name: "Business",
    href: "/onboarding/corporate",
    price: "CAC verified",
    bestFor: "Operational businesses and finance teams managing structured workflows.",
    verification: "CAC + director verification",
    cta: "Set up business",
    featured: false,
    included: [
      "Unlimited record invoices",
      "Unlimited collection invoices",
      "Advanced team management",
      "Full custom RBAC",
      "Audit logs",
      "Advanced reporting",
    ],
    note: "Built for organizational controls and higher collection confidence.",
  },
];

function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="DeraLedger home">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purp-900 text-sm font-bold text-white">
        D
      </div>
      <span className="text-lg font-bold text-purp-900">DeraLedger</span>
    </Link>
  );
}

function ProgressDemo() {
  return (
    <div className="rounded-lg border-2 border-purp-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4 border-b border-purp-100 pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-purp-700">
            Invoice progress
          </p>
          <h3 className="mt-1 text-xl font-bold text-neutral-900">Supply balance</h3>
        </div>
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
          Active
        </Badge>
      </div>

      <div className="py-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm text-neutral-500">Paid so far</p>
            <p className="mt-1 text-3xl font-bold text-purp-900">
              {"\u20A6"}50,000
            </p>
          </div>
          <p className="text-right text-sm font-semibold text-neutral-500">
            of {"\u20A6"}100,000
          </p>
        </div>

        <div className="mt-5 h-3 overflow-hidden rounded-full bg-purp-100">
          <div className="h-full w-1/2 rounded-full bg-purp-700" />
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="font-semibold text-purp-900">50% completed</span>
          <span className="text-neutral-500">Remaining: {"\u20A6"}50,000</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-purp-100 pt-4">
        {["Pay 25%", "Pay 50%", "Pay full"].map((label) => (
          <div
            key={label}
            className="rounded-lg border border-purp-200 bg-purp-50 px-3 py-2 text-center text-xs font-semibold text-purp-900"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mx-auto mb-10 max-w-3xl text-center">
      {eyebrow && (
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-purp-700">
          {eyebrow}
        </p>
      )}
      <h2 className="text-3xl font-bold leading-tight text-purp-900 md:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base leading-relaxed text-neutral-500 md:text-lg">
          {description}
        </p>
      )}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-purp-50 text-neutral-900">
      <header className="sticky top-0 z-50 border-b border-purp-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <BrandMark />

          <nav className="hidden items-center gap-7 md:flex" aria-label="Main navigation">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-neutral-500 hover:text-purp-700"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button
                variant="outline"
                className="h-10 border-2 border-purp-200 bg-white px-3 font-semibold text-purp-900 hover:bg-purp-50"
              >
                Log in
              </Button>
            </Link>
            <Link href="/onboarding">
              <Button className="h-10 bg-purp-900 px-3 font-semibold text-white hover:bg-purp-700 sm:px-4">
                <span className="hidden sm:inline">Start onboarding</span>
                <span className="sm:hidden">Start</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-purp-200 bg-white">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.02fr_0.98fr] lg:px-8">
            <div>
              <Badge className="mb-5 border-purp-200 bg-purp-100 text-purp-900">
                Collections infrastructure for African businesses
              </Badge>
              <h1 className="max-w-3xl text-4xl font-bold leading-tight text-purp-900 md:text-6xl">
                Get Paid in Parts. Without Losing Track.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-neutral-500">
                Accept deposits, installment payments, and progressive settlements while
                DeraLedger automatically tracks balances, collections, and outstanding amounts.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/onboarding">
                  <Button className="h-12 w-full bg-purp-900 px-6 text-base font-semibold text-white hover:bg-purp-700 sm:w-auto">
                    Start Tracking Payments
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
                <a href="#how-it-works">
                  <Button
                    variant="outline"
                    className="h-12 w-full border-2 border-purp-200 bg-white px-6 text-base font-semibold text-purp-900 hover:bg-purp-50 sm:w-auto"
                  >
                    See How It Works
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </a>
              </div>

              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-sm text-neutral-500">
                {["No setup fees", "No customer sign-up required", "Paystack-powered collections"].map(
                  (item) => (
                    <span key={item} className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      {item}
                    </span>
                  )
                )}
              </div>
            </div>

            <div className="lg:pl-8">
              <ProgressDemo />
            </div>
          </div>
        </section>

        <section id="problem" className="border-b border-purp-200 bg-purp-50 py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionIntro
              title="Your Customers Don't Pay Once. Most Financial Tools Expect Them To."
              description="Across Africa, businesses receive fragmented payments every day, but traditional invoicing software still assumes one invoice equals one payment."
            />
            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-lg border-2 border-purp-200 bg-white p-6">
                <h3 className="text-xl font-bold text-purp-900">Real payment behavior</h3>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {problemPoints.map((point) => (
                    <div
                      key={point}
                      className="rounded-lg border border-purp-200 bg-purp-50 px-3 py-3 text-sm font-semibold text-purp-900"
                    >
                      {point}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border-2 border-purp-200 bg-white p-6">
                <h3 className="text-xl font-bold text-purp-900">What breaks</h3>
                <ul className="mt-5 space-y-3">
                  {confusionPoints.map((point) => (
                    <li key={point} className="flex items-start gap-3 text-sm text-neutral-600">
                      <LockKeyhole className="mt-0.5 h-4 w-4 text-purp-700" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-purp-200 bg-white py-16 md:py-20">
          <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
            <p className="text-sm font-semibold uppercase tracking-wide text-purp-700">
              The DeraLedger difference
            </p>
            <h2 className="mt-3 text-3xl font-bold leading-tight text-purp-900 md:text-5xl">
              One Invoice. Multiple Payments. Zero Confusion.
            </h2>
            <p className="mx-auto mt-5 max-w-3xl text-lg leading-relaxed text-neutral-500">
              DeraLedger turns every invoice into a living ledger. Track every payment
              automatically while balances, payment history, and outstanding amounts update in real time.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 text-sm font-semibold text-purp-900">
              {["No spreadsheets", "No duplicate invoices", "No manual reconciliation"].map((item) => (
                <span key={item} className="rounded-full border border-purp-200 bg-purp-50 px-4 py-2">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-b border-purp-200 bg-purp-50 py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionIntro
              eyebrow="How it works"
              title="From invoice to balance visibility in three steps"
              description="Keep the workflow simple whether the payment happens online, offline, all at once, or in parts."
            />
            <div className="grid gap-5 md:grid-cols-3">
              {workflowSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="rounded-lg border-2 border-purp-200 bg-white p-6">
                    <div className="mb-5 flex items-center justify-between">
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-purp-100 text-purp-700">
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="text-sm font-bold text-purp-200">0{index + 1}</span>
                    </div>
                    <h3 className="text-xl font-bold text-purp-900">{step.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-neutral-500">{step.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="capabilities" className="border-b border-purp-200 bg-white py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionIntro
              eyebrow="Capabilities"
              title="Built for Real Payment Behavior"
              description="Practical tools for receivables teams, finance operators, founders, and support staff."
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {capabilities.map((capability) => {
                const Icon = capability.icon;
                return (
                  <div
                    key={capability.title}
                    className="rounded-lg border-2 border-purp-200 bg-purp-50 p-6"
                  >
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-white text-purp-700">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-lg font-bold text-purp-900">{capability.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-neutral-500">
                      {capability.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-b border-purp-200 bg-purp-50 py-16 md:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <SectionIntro
              eyebrow="Workflow-based pricing"
              title="Choose How You Want To Use DeraLedger"
              description="Different businesses manage payments differently. DeraLedger adapts to your workflow."
            />
            <div className="grid gap-6 lg:grid-cols-3">
              {plans.map((plan) => (
                <div
                  key={plan.name}
                  className={`relative flex flex-col rounded-lg border-2 p-6 ${
                    plan.featured
                      ? "border-purp-900 bg-purp-900 text-white shadow-lg"
                      : "border-purp-200 bg-white"
                  }`}
                >
                  {plan.featured && (
                    <Badge className="absolute -top-3 left-6 border-amber-300 bg-amber-300 text-amber-950">
                      Primary collection workflow
                    </Badge>
                  )}

                  <div className="flex-1 pt-2">
                    <p
                      className={`text-sm font-semibold uppercase tracking-wide ${
                        plan.featured ? "text-purp-200" : "text-purp-700"
                      }`}
                    >
                      {plan.verification}
                    </p>
                    <h3 className={`mt-2 text-2xl font-bold ${plan.featured ? "text-white" : "text-purp-900"}`}>
                      {plan.name}
                    </h3>
                    <p className={`mt-3 text-sm leading-relaxed ${plan.featured ? "text-purp-100" : "text-neutral-500"}`}>
                      {plan.bestFor}
                    </p>
                    <div className={`mt-6 text-2xl font-bold ${plan.featured ? "text-white" : "text-purp-900"}`}>
                      {plan.price}
                    </div>

                    <ul className="mt-6 space-y-3">
                      {plan.included.map((item) => (
                        <li key={item} className="flex items-start gap-3 text-sm">
                          <CheckCircle2
                            className={`mt-0.5 h-4 w-4 ${
                              plan.featured ? "text-emerald-300" : "text-emerald-600"
                            }`}
                          />
                          <span className={plan.featured ? "text-white" : "text-neutral-600"}>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p className={`mt-6 text-sm ${plan.featured ? "text-purp-200" : "text-neutral-500"}`}>
                    {plan.note}
                  </p>
                  <Link href={plan.href} className="mt-6 block">
                    <Button
                      className={`h-12 w-full font-semibold ${
                        plan.featured
                          ? "bg-white text-purp-900 hover:bg-purp-100"
                          : "border-2 border-purp-200 bg-white text-purp-900 hover:bg-purp-50"
                      }`}
                    >
                      {plan.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="trust" className="border-b border-purp-200 bg-white py-16 md:py-20">
          <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-purp-700">
                Trust and validation
              </p>
              <h2 className="mt-3 text-3xl font-bold leading-tight text-purp-900 md:text-4xl">
                Built for Growing African Businesses
              </h2>
            </div>
            <div className="rounded-lg border-2 border-purp-200 bg-purp-50 p-6">
              <ShieldCheck className="h-8 w-8 text-emerald-600" />
              <blockquote className="mt-5 text-xl font-semibold leading-relaxed text-purp-900">
                &ldquo;We stopped sending multiple invoices for one job. DeraLedger keeps everything organized.&rdquo;
              </blockquote>
              <p className="mt-5 text-sm text-neutral-500">
                Payment collection is powered by Paystack, with verification workflows designed for
                individuals, registered businesses, and operational finance teams.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-purp-900 py-16 text-white md:py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold leading-tight text-white md:text-4xl">
              Track Every Payment Clearly.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-purp-200">
              Start managing fragmented payments without confusion.
            </p>
            <Link href="/onboarding" className="mt-8 inline-block">
              <Button className="h-12 bg-white px-7 text-base font-semibold text-purp-900 hover:bg-purp-100">
                Create Your First Invoice
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="bg-white py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
            <div>
              <BrandMark />
              <p className="mt-4 max-w-md text-sm leading-relaxed text-neutral-500">
                DeraLedger by Deral Technologies Limited helps African businesses manage
                fragmented payments, collection invoices, and receivables visibility.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-bold text-purp-900">Product</h3>
              <div className="mt-3 flex flex-col gap-2 text-sm text-neutral-500">
                <a href="#how-it-works" className="hover:text-purp-700">How it works</a>
                <a href="#capabilities" className="hover:text-purp-700">Capabilities</a>
                <a href="#pricing" className="hover:text-purp-700">Pricing</a>
                <Link href="/onboarding" className="hover:text-purp-700">Start onboarding</Link>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-purp-900">Company</h3>
              <div className="mt-3 flex flex-col gap-2 text-sm text-neutral-500">
                <a href="mailto:support@deraledger.com" className="inline-flex items-center gap-2 hover:text-purp-700">
                  <Mail className="h-4 w-4" />
                  Contact
                </a>
                <Link href="/login" className="hover:text-purp-700">Log in</Link>
                <a href="#trust" className="hover:text-purp-700">Trust</a>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-3 border-t border-purp-200 pt-6 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
            <p>© 2026 DeraLedger. All rights reserved.</p>
            <div className="flex gap-5">
              <a href="mailto:support@deraledger.com?subject=Privacy%20request" className="hover:text-purp-700">
                Privacy
              </a>
              <a href="mailto:support@deraledger.com?subject=Terms%20request" className="hover:text-purp-700">
                Terms
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
