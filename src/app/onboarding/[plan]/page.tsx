"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Building2, User, ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";

interface OnboardingPageProps {
  params: Promise<{ plan: string }>;
}

const PLAN_CONFIG: Record<string, any> = {
  starter: {
    label: "Starter",
    price: "Free",
    priceKobo: 0,
    features: [
      "Unlimited Record-only Invoices",
      "DeraBot AI financial insights",
      "Invoice sharing (WhatsApp, Email, QR)",
      "Basic audit log",
    ],
  },
  individual: {
    label: "Individual",
    price: "₦5,000/month",
    priceKobo: 500000,
    features: [
      "Unlimited Record + Collection Invoices",
      "BVN verification for payment links",
      "DeraBot AI financial insights",
      "Automated reminders + monthly report",
      "Owner + 1 team member",
      "₦5M monthly collection limit",
    ],
  },
  corporate: {
    label: "Corporate",
    price: "₦20,000/month",
    priceKobo: 2000000,
    features: [
      "Everything in Individual",
      "Unlimited team members",
      "Unlimited collections — no limit",
      "Full business verification (CAC + BVN + Utility)",
      "Priority support",
    ],
  },
};

export default function OnboardingPlanPage({ params }: OnboardingPageProps) {
  const router = useRouter();
  const { plan } = use(params);
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [registeredName, setRegisteredName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate plan
  if (plan !== "starter" && plan !== "individual" && plan !== "corporate") {
    router.replace("/onboarding");
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-purp-700" />
      </div>
    );
  }

  const config = PLAN_CONFIG[plan as string];
  const Icon = plan === "corporate" ? Building2 : User;
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Check if email already has an account
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

      if (plan === "starter") {
        // Provision directly without Paystack and without session
        const provisionRes = await fetch("/api/onboarding/provision-starter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            email, 
            tradingName: businessName,
            registeredName: registeredName || businessName,
            ownerName 
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

      // 2. Create onboarding session (for paid plans)
      const sessionRes = await fetch("/api/onboarding/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email, 
          businessName: registeredName || businessName, 
          plan 
        }),
      });
      const sessionData = await sessionRes.json();

      if (!sessionData.sessionId) {
        setError("Failed to create session. Please try again.");
        setLoading(false);
        return;
      }

      // 3. Initialize Paystack subscription payment (for paid plans)
      const payRes = await fetch("/api/onboarding/initialize-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          tradingName: businessName,
          registeredName: registeredName || businessName,
          ownerName,
          plan,
          sessionId: sessionData.sessionId,
          amountKobo: config.priceKobo,
        }),
      });
      const payData = await payRes.json();

      if (!payData.authorizationUrl) {
        setError("Failed to initialize payment. Please try again.");
        setLoading(false);
        return;
      }

      // 4. Redirect to Paystack checkout
      window.location.href = payData.authorizationUrl;
    } catch (err: unknown) {
      setError("Something went wrong. Please try again.");
      console.error(err);
      setLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="flex flex-col min-h-screen">
        <header className="py-6 px-6 md:px-12 flex items-center gap-2 bg-white border-b border-neutral-100">
          <div className="w-8 h-8 bg-purp-900 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">D</span>
          </div>
            <span className="text-xl font-bold text-purp-900">Deraledger</span>
        </header>
        <div className="flex-1 flex flex-col md:flex-row">
          <div className="w-full md:w-1/2 p-6 md:p-12 lg:p-24 flex items-center justify-center bg-purp-50">
            <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-purp-100 p-8 text-center space-y-6">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
              <h2 className="text-2xl font-bold text-purp-900">Account Created!</h2>
              <p className="text-neutral-600 text-lg">
                Your free Starter workspace for <strong>{businessName}</strong> is ready.
              </p>
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-sm">
                <strong>Next Step:</strong> Check your inbox ({email}). We've sent you a secure link to set your password and log into your dashboard.
              </div>
            </div>
          </div>
          <div className="hidden md:flex w-1/2 bg-purp-900 p-12 lg:p-24 flex-col justify-between text-white">
            <div className="max-w-lg">
              <h2 className="text-4xl font-bold mb-6">Welcome to the future of invoicing.</h2>
              <p className="text-purp-200 text-lg">
                You're just one click away from smart ledger tracking and seamless record keeping.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-purp-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-4xl">
        <Link
          href="/onboarding"
          className="inline-flex items-center text-sm font-medium text-neutral-500 hover:text-purp-700 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Plans
        </Link>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Left — Plan summary */}
          <div className="bg-purp-900 rounded-2xl p-8 text-white flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-purp-300 text-sm font-medium uppercase tracking-wider">
                    Deraledger
                  </p>
                  <h1 className="text-xl font-bold">{config.label} Plan</h1>
                </div>
              </div>
              <div className="mb-8">
                <span className="text-4xl font-bold">{config.price}</span>
                <p className="text-purp-300 text-sm mt-1">
                  Deraledger absorbs the Paystack processing fee
                </p>
              </div>
              <ul className="space-y-3">
                {config.features.map((f: string) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-purp-100">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-purp-400 text-xs mt-8">
              Payment links require identity verification after setup. Free to verify.
            </p>
          </div>

          {/* Right — Intent capture form */}
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-purp-100">
            <h2 className="text-2xl font-bold text-purp-900 mb-2">Get Started</h2>
            <p className="text-neutral-500 text-sm mb-6">
              Enter your details to proceed to secure payment.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 text-sm p-3 rounded-lg">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="businessName">Trading Name</Label>
                <Input
                  id="businessName"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Adebayo Consulting"
                  required
                  className="h-11 border-2 border-purp-200 focus:border-purp-700"
                />
              </div>

              {plan === "corporate" && (
                <div className="space-y-1.5">
                  <Label htmlFor="registeredName">Registered Business Name</Label>
                  <p className="text-xs text-neutral-400">Official name registered with CAC. Used for RC Number verification.</p>
                  <div className="flex items-center gap-3 p-3 bg-purp-50/50 border border-purp-200 rounded-lg">
                    <input
                      type="checkbox"
                      checked={registeredName.trim() !== "" && registeredName.trim() === businessName.trim()}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setRegisteredName(businessName);
                        } else {
                          setRegisteredName("");
                        }
                      }}
                      className="w-4 h-4 accent-purp-700"
                    />
                    <span className="text-sm text-neutral-700">Same as Trading Name</span>
                  </div>
                  {!(registeredName.trim() !== "" && registeredName.trim() === businessName.trim()) && (
                    <Input
                      id="registeredName"
                      value={registeredName}
                      onChange={(e) => setRegisteredName(e.target.value)}
                      placeholder="e.g. Adebayo Consulting Limited"
                      required
                      className="h-11 border-2 border-purp-200 focus:border-purp-700"
                    />
                  )}
                </div>
              )}

              {plan !== "starter" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ownerName">
                    {plan === "corporate" ? "Highest Shareholder's Full Name" : "Owner's Full Name"}
                  </Label>
                  <Input
                    id="ownerName"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="e.g. Adebayo Olanrewaju"
                    required
                    className="h-11 border-2 border-purp-200 focus:border-purp-700"
                  />
                  <p className="text-xs text-neutral-400">
                    {plan === "corporate"
                      ? "This name will be used for BVN verification."
                      : "Must match your BVN for identity verification."}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@business.com"
                  required
                  className="h-11 border-2 border-purp-200 focus:border-purp-700"
                />
                <p className="text-xs text-neutral-400">
                  Your login email. No password needed here — you&apos;ll set it after payment.
                </p>
              </div>

              <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 bg-purp-900 hover:bg-purp-800 text-white font-bold text-base mt-2"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Setting up...
                    </span>
                  ) : (
                    <span className="flex items-center justify-between w-full px-2">
                      <span>{plan === "starter" ? "Create Free Account" : `Pay ${config.price.split("/")[0]}`}</span>
                      <ArrowRight className="w-5 h-5" />
                    </span>
                  )}
                </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-purp-100 text-center">
              <p className="text-sm text-neutral-500">
                Want the free plan instead?{" "}
                <Link href="/register" className="text-purp-700 font-medium hover:underline">
                  Start with Starter
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
