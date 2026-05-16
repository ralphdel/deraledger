"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PlanId = "starter" | "individual" | "corporate";

type PlanConfig = {
  label: string;
  workflow: string;
  price: string;
  checkoutLabel: string;
  priceKobo: number;
  verification: string;
  formDescription: string;
  footnote: string;
  successTitle: string;
  successMessage: string;
  features: string[];
};

interface OnboardingPageProps {
  params: Promise<{ plan: string }>;
}

const PLAN_CONFIG: Record<PlanId, PlanConfig> = {
  starter: {
    label: "Starter",
    workflow: "For testing and offline invoice tracking",
    price: "Free",
    checkoutLabel: "Create Free Account",
    priceKobo: 0,
    verification: "No KYC required",
    formDescription:
      "Create a free workspace for testing and offline tracking.",
    footnote:
      "Collection invoices, payment links, QR collections, and partial payment controls unlock after verification.",
    successTitle: "Starter workspace created",
    successMessage:
      "Your free workspace is ready for record invoices, offline collections, and balance tracking.",
    features: [
      "10 lifetime record invoices",
      "No collection invoices",
      "No payment links",
      "1 additional team member",
      "Predefined roles only",
      "Watermark enabled",
    ],
  },
  individual: {
    label: "Individual",
    workflow: "For verified online collections",
    price: "NGN 5,000/month",
    checkoutLabel: "Pay NGN 5,000",
    priceKobo: 500000,
    verification: "BVN & Selfie required",
    formDescription:
      "Set up online collections with BVN verification, payment links, and automatic balance tracking.",
    footnote:
      "Designed for growing businesses with a ₦5M monthly collection limit.",
    successTitle: "Collections workspace started",
    successMessage:
      "After payment, complete BVN verification to activate payment links and collection invoices.",
    features: [
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
  corporate: {
    label: "Business",
    workflow: "Operational collections infrastructure for growing businesses",
    price: "NGN 20,000/month",
    checkoutLabel: "Pay NGN 20,000",
    priceKobo: 2000000,
    verification: "CAC & Director required",
    formDescription:
      "Create a verified business workspace for unlimited collections, advanced access control, and audit visibility.",
    footnote:
      "Built for operational businesses that need custom roles, audit logs, and organizational controls.",
    successTitle: "Business workspace started",
    successMessage:
      "After payment, complete business verification to activate unlimited collections and governance controls.",
    features: [
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
};

function isPlanId(value: string): value is PlanId {
  return value === "starter" || value === "individual" || value === "corporate";
}

function BrandHeader() {
  return (
    <header className="border-b border-white/5 bg-[#12061F]/80 backdrop-blur-md px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2" aria-label="DeraLedger home">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#7B2FF7] text-sm font-bold text-white shadow-[0_0_10px_rgba(123,47,247,0.4)]">
            D
          </div>
          <span className="text-xl font-bold text-white">DeraLedger</span>
        </Link>
        <Link href="/login" className="text-sm font-semibold text-white/80 hover:text-white">
          Sign in
        </Link>
      </div>
    </header>
  );
}

export default function OnboardingPlanPage({ params }: OnboardingPageProps) {
  const { plan } = use(params);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [registeredName, setRegisteredName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);


  if (!isPlanId(plan)) {
    return (
      <div className="min-h-screen bg-[#12061F] text-white">
        <BrandHeader />
        <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 text-center">
          <h1 className="text-3xl font-bold text-white">Plan not found</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            Choose a valid DeraLedger workflow to continue onboarding.
          </p>
          <Link href="/onboarding" className="mt-6">
            <Button className="bg-[#7B2FF7] text-white hover:bg-[#B58CFF] hover:text-[#12061F]">
              Back to plans
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </main>
      </div>
    );
  }

  const planId = plan;
  const config = PLAN_CONFIG[planId];
  const Icon = planId === "corporate" ? Building2 : planId === "starter" ? Sparkles : User;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const checkRes = await fetch("/api/onboarding/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const checkData = await checkRes.json();

      if (checkData.exists) {
        setError("This email already has an account. Log in to upgrade your plan.");
        setLoading(false);
        return;
      }

      if (planId === "starter") {
        const provisionRes = await fetch("/api/onboarding/provision-starter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            tradingName: businessName,
            registeredName: registeredName || businessName,
            ownerName,
          }),
        });

        const provisionData = await provisionRes.json();

        if (provisionData.success) {
          setIsSuccess(true);
        } else {
          setError(provisionData.error || "Failed to create account.");
        }
        setLoading(false);
        return;
      }

      const sessionRes = await fetch("/api/onboarding/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          businessName: registeredName || businessName,
          plan: planId,
        }),
      });
      const sessionData = await sessionRes.json();

      if (!sessionData.sessionId) {
        setError("Failed to create session. Please try again.");
        setLoading(false);
        return;
      }

      // Store checkout data and navigate to the checkout page
      sessionStorage.setItem("subscriptionCheckout", JSON.stringify({
        email,
        businessName,
        registeredName: registeredName || businessName,
        ownerName,
        plan: planId,
        sessionId: sessionData.sessionId,
        amountKobo: config.priceKobo,
      }));
      router.push(`/checkout/subscription?plan=${planId}`);
    } catch (err: unknown) {
      setError("Something went wrong. Please try again.");
      console.error(err);
      setLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-[#12061F] text-white">
        <BrandHeader />
        <main className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-2 md:py-16">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center shadow-sm backdrop-blur-sm">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#7B2FF7]/20">
              <CheckCircle2 className="h-10 w-10 text-[#B58CFF]" />
            </div>
            <h1 className="mt-6 text-3xl font-bold text-white">{config.successTitle}</h1>
            <p className="mt-3 text-white/60">
              {config.successMessage} Workspace: <strong>{businessName}</strong>.
            </p>
            <div className="mt-6 rounded-lg border border-[#7B2FF7]/30 bg-[#7B2FF7]/10 p-4 text-sm text-[#B58CFF]">
              <strong>Next step:</strong> Check your inbox at {email}. We have sent a secure
              link to set your password and log into your dashboard.
            </div>
          </section>

          <section className="rounded-2xl border border-[#7B2FF7] bg-[#3D0B66]/30 p-8 text-white shadow-[0_0_30px_rgba(123,47,247,0.15)] backdrop-blur-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-[#B58CFF]">
              Built for businesses that get paid in parts
            </p>
            <h2 className="mt-3 text-3xl font-bold text-white">Track every payment clearly.</h2>
            <p className="mt-4 leading-relaxed text-white/80">
              DeraLedger helps you keep one invoice connected to every deposit, installment,
              transfer, and remaining balance.
            </p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#12061F] text-white">
      <BrandHeader />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:py-12 lg:px-8">
        <Link
          href="/onboarding"
          className="mb-6 inline-flex items-center text-sm font-medium text-white/60 hover:text-white"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to plans
        </Link>

        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-2xl border border-[#7B2FF7] bg-[#3D0B66]/30 p-6 text-white md:p-8 shadow-[0_0_30px_rgba(123,47,247,0.15)] backdrop-blur-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#B58CFF]">
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#B58CFF]">
                  {config.verification}
                </p>
                <h1 className="mt-1 text-3xl font-bold text-white">{config.label}</h1>
                <p className="mt-2 text-sm text-white/80">{config.workflow}</p>
              </div>
            </div>

            <div className="mt-8 rounded-xl border border-white/10 bg-[#12061F]/50 p-5">
              <p className="text-sm text-white/60">Plan cost</p>
              <p className="mt-1 text-4xl font-bold text-white">{config.price}</p>
            </div>

            <ul className="mt-8 space-y-4">
              {config.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#B58CFF]" />
                  <span className="text-white/80">{feature}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 rounded-xl border border-white/10 bg-[#12061F]/50 p-4 text-sm leading-relaxed text-white/60">
              <ShieldCheck className="mb-3 h-5 w-5 text-[#B58CFF]" />
              {config.footnote}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm md:p-8 backdrop-blur-sm">
            <h2 className="text-2xl font-bold text-white">Start onboarding</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{config.formDescription}</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="businessName" className="text-white">Trading Name</Label>
                <Input
                  id="businessName"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Adebayo Consulting"
                  required
                  className="h-11 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
                />
              </div>

              {planId === "corporate" && (
                <div className="space-y-1.5">
                  <Label htmlFor="registeredName" className="text-white">Registered Business Name</Label>
                  <p className="text-xs text-white/50">
                    Official CAC-registered name for business verification.
                  </p>
                  <label className="flex items-center gap-3 rounded-lg border border-white/10 bg-[#12061F]/50 p-3">
                    <input
                      type="checkbox"
                      checked={
                        registeredName.trim() !== "" &&
                        registeredName.trim() === businessName.trim()
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setRegisteredName(businessName);
                        } else {
                          setRegisteredName("");
                        }
                      }}
                      className="h-4 w-4 accent-[#7B2FF7]"
                    />
                    <span className="text-sm text-white/80">Same as Trading Name</span>
                  </label>
                  {registeredName.trim() !== businessName.trim() && (
                    <Input
                      id="registeredName"
                      value={registeredName}
                      onChange={(e) => setRegisteredName(e.target.value)}
                      placeholder="e.g. Adebayo Consulting Limited"
                      required
                      className="h-11 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
                    />
                  )}
                </div>
              )}

              {planId !== "starter" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ownerName" className="text-white">
                    {planId === "corporate" ? "Director or Highest Shareholder Full Name" : "Owner Full Name"}
                  </Label>
                  <Input
                    id="ownerName"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="e.g. Adebayo Olanrewaju"
                    required
                    className="h-11 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
                  />
                  <p className="text-xs text-white/50">
                    {planId === "corporate"
                      ? "This name supports director or shareholder verification."
                      : "This name should match your BVN verification details."}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-white">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@business.com"
                  required
                  className="h-11 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
                />
                <p className="text-xs text-white/50">
                  Use the email you want as the workspace login. You will set your password after setup.
                </p>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="mt-4 h-12 w-full bg-[#7B2FF7] text-base font-bold text-white hover:bg-[#B58CFF] hover:text-[#12061F] transition-all border-0"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Setting up...
                  </span>
                ) : (
                  <span className="flex w-full items-center justify-between px-2">
                    <span>{config.checkoutLabel}</span>
                    <ArrowRight className="h-5 w-5" />
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-8 border-t border-white/10 pt-6 text-center">
              {planId === "starter" ? (
                <p className="text-sm text-white/60">
                  Need online collections?{" "}
                  <Link href="/onboarding/individual" className="font-medium text-[#B58CFF] hover:text-white transition-colors">
                    Choose Individual / Collections
                  </Link>
                </p>
              ) : (
                <p className="text-sm text-white/60">
                  Prefer to begin with offline tracking?{" "}
                  <Link href="/onboarding/starter" className="font-medium text-[#B58CFF] hover:text-white transition-colors">
                    Start with Starter
                  </Link>
                </p>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
