"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, CreditCard, ArrowRightLeft, Bitcoin,
  Loader2, ShieldCheck, Lock, Copy, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Provider flags (matching invoice portal pattern) ────────────────────────
const PROVIDER_FLAGS = {
  paystack: true,
  monnify: false, // Set true when Monnify credentials are configured
  breet: false,   // Set true when Breet crypto credentials are configured
};

const PLAN_CONFIG: Record<string, {
  label: string; price: string; priceKobo: number; interval: string;
  features: string[]; color: string;
}> = {
  individual: {
    label: "Individual / Collections",
    price: "NGN 5,000", priceKobo: 500000, interval: "/month",
    features: [
      "Unlimited record invoices",
      "Collection invoices & payment links",
      "QR collections",
      "Partial payment controls",
      "Automatic balance tracking",
      "5 team members",
      "NGN 5M monthly collection limit",
    ],
    color: "from-purp-900 to-purp-800",
  },
  corporate: {
    label: "Business",
    price: "NGN 20,000", priceKobo: 2000000, interval: "/month",
    features: [
      "Unlimited record & collection invoices",
      "Advanced team management",
      "Full custom RBAC & custom roles",
      "Audit logs",
      "Advanced reporting",
      "Unlimited monthly collections",
    ],
    color: "from-purp-900 to-emerald-900",
  },
};

type Tab = "card" | "transfer" | "crypto";

interface CheckoutData {
  email: string;
  businessName: string;
  registeredName: string;
  ownerName: string;
  plan: string;
  sessionId: string;
  amountKobo: number;
}

function SubscriptionCheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan") || "individual";
  const config = PLAN_CONFIG[plan];

  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null);
  const [tab, setTab] = useState<Tab>("card");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cryptoDetails, setCryptoDetails] = useState<{
    address: string; network: string; coin: string; fiatAmount: number; reference: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const paystackLoaded = useRef(false);

  // Load Paystack inline JS
  useEffect(() => {
    if (paystackLoaded.current) return;
    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.async = true;
    document.body.appendChild(script);
    paystackLoaded.current = true;
  }, []);

  // Read session data from sessionStorage
  useEffect(() => {
    const raw = sessionStorage.getItem("subscriptionCheckout");
    if (raw) {
      try {
        setCheckoutData(JSON.parse(raw));
      } catch {
        router.replace("/onboarding");
      }
    } else {
      router.replace("/onboarding");
    }
  }, [router]);

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-purp-50">
        <p className="text-neutral-500">Invalid plan. <Link href="/onboarding" className="text-purp-700 underline">Go back</Link></p>
      </div>
    );
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCardPayment = async () => {
    if (!checkoutData) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding/initialize-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: checkoutData.email,
          tradingName: checkoutData.businessName,
          registeredName: checkoutData.registeredName,
          ownerName: checkoutData.ownerName,
          plan: checkoutData.plan,
          sessionId: checkoutData.sessionId,
          amountKobo: checkoutData.amountKobo,
        }),
      });
      const data = await res.json();
      if (!data.accessCode) {
        throw new Error(data.error || "Failed to initialize payment.");
      }

      const pop = (window as Window & { PaystackPop?: { setup: (opts: Record<string, unknown>) => { openIframe: () => void } } }).PaystackPop;
      if (!pop) throw new Error("Paystack not loaded. Please refresh.");

      const handler = pop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        access_code: data.accessCode,
        callback: (response: { reference: string }) => {
          sessionStorage.removeItem("subscriptionCheckout");
          router.push(`/onboarding/payment-callback?reference=${response.reference}`);
        },
        onClose: () => setLoading(false),
      });
      handler.openIframe();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setLoading(false);
    }
  };

  const handleCryptoPayment = async () => {
    if (!checkoutData) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/checkout/crypto-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: checkoutData.email,
          plan: checkoutData.plan,
          sessionId: checkoutData.sessionId,
          amountKobo: checkoutData.amountKobo,
        }),
      });
      const data = await res.json();
      if (!data.cryptoAddress) throw new Error(data.error || "Failed to generate crypto address.");
      setCryptoDetails({
        address: data.cryptoAddress, network: data.cryptoNetwork,
        coin: data.cryptoCoin, fiatAmount: data.fiatAmount, reference: data.reference,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode; available: boolean }[] = [
    { id: "card", label: "Card & Bank", icon: <CreditCard className="h-4 w-4" />, available: PROVIDER_FLAGS.paystack || PROVIDER_FLAGS.monnify },
    { id: "transfer", label: "Bank Transfer", icon: <ArrowRightLeft className="h-4 w-4" />, available: PROVIDER_FLAGS.paystack },
    { id: "crypto", label: "Crypto", icon: <Bitcoin className="h-4 w-4" />, available: true },
  ];

  return (
    <div className="min-h-screen bg-purp-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-purp-100 px-4 py-3 flex items-center gap-3">
        <Link href={`/onboarding/${plan}`} className="text-neutral-500 hover:text-purp-700 flex items-center gap-1.5 text-sm font-medium">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-2 ml-auto text-xs text-neutral-400">
          <Lock className="h-3.5 w-3.5" /> Secured by DeraLedger
        </div>
      </header>

      <main className="flex flex-col md:flex-row flex-1 max-w-5xl mx-auto w-full md:gap-0 gap-0">
        {/* ── Left: Plan Summary ── */}
        <div className={`bg-gradient-to-br ${config.color} text-white w-full md:w-5/12 p-8 md:min-h-[calc(100vh-53px)] flex flex-col`}>
          <div className="mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-purp-200 mb-1">Subscribing to</p>
            <h1 className="text-2xl font-bold text-white">{config.label}</h1>
          </div>
          <div className="mt-4 mb-6">
            <span className="text-4xl font-bold">{config.price}</span>
            <span className="text-purp-200 text-sm ml-1">{config.interval}</span>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-6">
            <p className="text-xs text-purp-200 mb-1 font-medium">Billing to</p>
            <p className="font-semibold text-sm truncate">{checkoutData?.businessName || "—"}</p>
            <p className="text-purp-200 text-xs truncate">{checkoutData?.email || "—"}</p>
          </div>

          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-purp-200 mb-3">What&apos;s included</p>
            <ul className="space-y-2.5">
              {config.features.map(f => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300 mt-0.5 flex-shrink-0" />
                  <span className="text-purp-50">{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 flex items-center gap-2 text-purp-300 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            Payments powered by Paystack &amp; Breet
          </div>
        </div>

        {/* ── Right: Payment Methods ── */}
        <div className="flex-1 bg-white p-6 md:p-10 flex flex-col">
          <h2 className="text-lg font-bold text-purp-900 mb-1">Choose payment method</h2>
          <p className="text-sm text-neutral-500 mb-6">Select how you&apos;d like to pay for your subscription.</p>

          {/* Tab selector */}
          <div className="flex gap-2 mb-6 border-b border-neutral-100 pb-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setError(null); setCryptoDetails(null); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-purp-900 text-white shadow-sm"
                    : "text-neutral-500 hover:text-purp-700 hover:bg-purp-50"
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ── Card & Bank tab ── */}
          {tab === "card" && (
            <div className="flex-1 flex flex-col gap-4">
              {PROVIDER_FLAGS.paystack && (
                <div className="rounded-xl border-2 border-purp-100 bg-purp-50 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-purp-900 flex items-center justify-center">
                      <CreditCard className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold text-purp-900 text-sm">Paystack</p>
                      <p className="text-xs text-neutral-500">Debit/credit card, USSD, or bank account</p>
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500 mb-4">
                    A secure Paystack window will open for payment. Your card details are never stored by DeraLedger.
                  </p>
                  <Button
                    onClick={handleCardPayment}
                    disabled={loading || !checkoutData}
                    className="w-full h-12 bg-purp-900 hover:bg-purp-700 text-white font-bold text-base"
                  >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Opening Paystack...</> : <>Pay {config.price} <CreditCard className="ml-2 h-4 w-4" /></>}
                  </Button>
                </div>
              )}
              {PROVIDER_FLAGS.monnify && (
                <div className="rounded-xl border-2 border-emerald-100 bg-emerald-50 p-5">
                  <p className="text-sm font-semibold text-emerald-900 mb-1">Monnify</p>
                  <p className="text-xs text-emerald-700">Dynamic virtual accounts via Monnify.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Bank Transfer tab ── */}
          {tab === "transfer" && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="rounded-xl border-2 border-blue-100 bg-blue-50 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                    <ArrowRightLeft className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-blue-900 text-sm">Bank Transfer via Paystack</p>
                    <p className="text-xs text-blue-600">Pay from your Nigerian bank account</p>
                  </div>
                </div>
                <p className="text-xs text-neutral-500 mb-4">
                  Click below — Paystack will generate a dedicated virtual account number for this transaction. Transfer the exact amount to confirm.
                </p>
                <Button
                  onClick={handleCardPayment}
                  disabled={loading || !checkoutData}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold text-base"
                >
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Opening...</> : <>Get Transfer Details <ArrowRightLeft className="ml-2 h-4 w-4" /></>}
                </Button>
                <p className="text-[11px] text-neutral-400 mt-2 text-center">Paystack transfer window will open</p>
              </div>
            </div>
          )}

          {/* ── Crypto tab ── */}
          {tab === "crypto" && (
            <div className="flex-1 flex flex-col gap-4">
              {!PROVIDER_FLAGS.breet ? (
                <div className="rounded-xl border-2 border-amber-100 bg-amber-50 p-6 text-center">
                  <Bitcoin className="h-10 w-10 text-amber-500 mx-auto mb-3" />
                  <p className="font-semibold text-amber-900 mb-1">Crypto Payments — Coming Soon</p>
                  <p className="text-xs text-amber-700">
                    BTC, USDT, and ETH subscription payments via Breet are being activated.
                    Use Card & Bank or Bank Transfer for now.
                  </p>
                </div>
              ) : cryptoDetails ? (
                <div className="rounded-xl border-2 border-orange-100 bg-orange-50 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-orange-900 text-sm">Send {cryptoDetails.coin} to this address</p>
                    <span className="text-xs bg-orange-200 text-orange-900 rounded px-2 py-0.5 font-medium">{cryptoDetails.network}</span>
                  </div>
                  <div className="bg-white rounded-lg border border-orange-200 p-3 font-mono text-xs text-neutral-700 break-all">{cryptoDetails.address}</div>
                  <Button variant="outline" size="sm" onClick={() => handleCopy(cryptoDetails.address)} className="w-full border-orange-300 text-orange-700">
                    {copied ? <><Check className="h-3.5 w-3.5 mr-1" /> Copied</> : <><Copy className="h-3.5 w-3.5 mr-1" /> Copy Address</>}
                  </Button>
                  <p className="text-xs text-orange-700 text-center">
                    Send equivalent of <strong>NGN {cryptoDetails.fiatAmount.toLocaleString()}</strong> in {cryptoDetails.coin}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border-2 border-orange-100 bg-orange-50 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
                      <Bitcoin className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold text-orange-900 text-sm">Pay with Crypto (Breet)</p>
                      <p className="text-xs text-orange-600">BTC, USDT, ETH</p>
                    </div>
                  </div>
                  <Button onClick={handleCryptoPayment} disabled={loading || !checkoutData} className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white font-bold">
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating address...</> : "Generate Crypto Address"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
          )}

          <p className="mt-auto pt-6 text-center text-xs text-neutral-400">
            By paying, you agree to DeraLedger&apos;s terms of service. Subscription auto-renews monthly.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function SubscriptionCheckoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-purp-50">
        <Loader2 className="h-8 w-8 animate-spin text-purp-700" />
      </div>
    }>
      <SubscriptionCheckoutContent />
    </Suspense>
  );
}
