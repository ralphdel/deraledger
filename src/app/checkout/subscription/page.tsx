"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, CreditCard, ArrowRightLeft, Bitcoin,
  Loader2, ShieldCheck, Lock, Copy, Check, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMerchant } from "@/lib/data";

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
      "Collection invoices enabled",
      "Online payment collection",
      "Grouped references & deposits",
      "Partial payment controls",
      "₦5M monthly collection limit",
      "20 active collection invoices",
    ],
    color: "from-[#1A0B2E] to-[#3D0B66]",
  },
  corporate: {
    label: "Business",
    price: "NGN 20,000", priceKobo: 2000000, interval: "/month",
    features: [
      "Unlimited collection invoices",
      "Custom Role-Based Access (RBAC)",
      "Grouped receivables",
      "Advanced analytics",
      "No watermark",
      "White-label invoices",
    ],
    color: "from-[#0B0314] to-[#12061F]",
  },
};

type Tab = "card" | "transfer" | "crypto";

// ─── Context: 'onboarding' (new subscription) | 'renewal' (existing merchant) ─
type CheckoutContext = "onboarding" | "renewal";

interface CheckoutData {
  email: string;
  businessName: string;
  registeredName: string;
  ownerName: string;
  plan: string;
  sessionId: string;
  amountKobo: number;
  context?: CheckoutContext;
}

function SubscriptionCheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan") || "individual";
  const context = (searchParams.get("context") || "onboarding") as CheckoutContext;
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

  // ── Load checkout data based on context ────────────────────────────────────
  useEffect(() => {
    if (context === "renewal") {
      // Renewal context: load merchant data directly from API (authenticated user)
      getMerchant().then((merchant) => {
        if (!merchant) {
          router.replace("/settings/billing");
          return;
        }
        const renewalData: CheckoutData = {
          email: merchant.email || "",
          businessName: merchant.business_name || merchant.trading_name || "",
          registeredName: merchant.business_name || "",
          ownerName: merchant.owner_name || "",
          plan,
          sessionId: `renewal_${merchant.id}_${Date.now()}`,
          amountKobo: config?.priceKobo ?? 0,
          context: "renewal",
        };
        // Store renewal context so callback knows where to redirect
        sessionStorage.setItem("renewalCheckout", JSON.stringify({
          merchantId: merchant.id,
          plan,
        }));
        setCheckoutData(renewalData);
      });
    } else {
      // Onboarding context: read session data from sessionStorage (set by onboarding pages)
      const raw = sessionStorage.getItem("subscriptionCheckout");
      if (raw) {
        try {
          setCheckoutData({ ...JSON.parse(raw), context: "onboarding" });
        } catch {
          router.replace("/onboarding");
        }
      } else {
        router.replace("/onboarding");
      }
    }
  }, [context, plan, router, config]);

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#12061F]">
        <p className="text-white/60">Invalid plan. <Link href="/onboarding" className="text-[#B58CFF] underline">Go back</Link></p>
      </div>
    );
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Determines the success callback URL based on context
  const getCallbackUrl = () => {
    const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    if (context === "renewal") {
      return `${base}/settings/billing/renew-callback`;
    }
    return `${base}/onboarding/payment-callback`;
  };

  // Determines the API endpoint based on context
  const getApiEndpoint = () => {
    if (context === "renewal") {
      return "/api/payment/renew-initialize";
    }
    return "/api/onboarding/initialize-payment";
  };

  const handleCardPayment = async () => {
    if (!checkoutData) return;
    setError(null);
    setLoading(true);
    try {
      const endpoint = getApiEndpoint();
      const callbackUrl = getCallbackUrl();

      const body = context === "renewal"
        ? {
          plan: checkoutData.plan,
          email: checkoutData.email,
          callbackUrl,
        }
        : {
          email: checkoutData.email,
          tradingName: checkoutData.businessName,
          registeredName: checkoutData.registeredName,
          ownerName: checkoutData.ownerName,
          plan: checkoutData.plan,
          sessionId: checkoutData.sessionId,
          amountKobo: checkoutData.amountKobo,
          callbackUrl,
        };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.accessCode) {
        throw new Error(data.error || "Failed to initialize payment.");
      }

      const pop = (window as Window & { PaystackPop?: { setup: (opts: Record<string, unknown>) => { openIframe: () => void } } }).PaystackPop;
      if (!pop) throw new Error("Paystack not loaded. Please refresh.");

      const handler = pop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email: checkoutData.email,
        amount: checkoutData.amountKobo,
        ref: data.reference,
        access_code: data.accessCode,
        metadata: {
          type: context === "renewal" ? "subscription_renewal" : "subscription",
          plan: checkoutData.plan,
          email: checkoutData.email,
          business_name: checkoutData.registeredName,
          trading_name: checkoutData.businessName,
          owner_name: checkoutData.ownerName || null,
          session_id: checkoutData.sessionId,
          context,
        },
        callback: (response: { reference: string }) => {
          if (context === "renewal") {
            sessionStorage.removeItem("renewalCheckout");
          } else {
            sessionStorage.removeItem("subscriptionCheckout");
          }
          const cbUrl = context === "renewal"
            ? `/settings/billing/renew-callback?reference=${response.reference}`
            : `/onboarding/payment-callback?reference=${response.reference}`;
          router.push(cbUrl);
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

  // Back link destination based on context
  const backHref = context === "renewal" ? "/settings/billing" : `/onboarding/${plan}`;
  const backLabel = context === "renewal" ? "Back to Billing" : "Back";
  const pageTitle = context === "renewal" ? "Renewing to" : "Subscribing to";

  return (
    <div className="min-h-screen bg-[#12061F] flex flex-col">
      {/* Header */}
      <header className="bg-[#1A0B2E] border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <Link href={backHref} className="text-white/60 hover:text-white flex items-center gap-1.5 text-sm font-medium transition-colors">
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
        {context === "renewal" && (
          <span className="ml-2 text-xs font-semibold bg-[#7B2FF7]/20 text-[#B58CFF] px-2.5 py-0.5 rounded-full border border-[#7B2FF7]/30">
            <RefreshCw className="h-3 w-3 inline mr-1" />Renewal
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto text-xs text-white/40">
          <Lock className="h-3.5 w-3.5" /> Secured by DeraLedger
        </div>
      </header>

      <main className="flex flex-col md:flex-row flex-1 max-w-5xl mx-auto w-full md:gap-0 gap-0">
        {/* ── Left: Plan Summary ── */}
        <div className={`bg-gradient-to-br ${config.color} border-r border-white/5 text-white w-full md:w-5/12 p-8 md:min-h-[calc(100vh-53px)] flex flex-col`}>
          <div className="mb-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#B58CFF] mb-1">{pageTitle}</p>
            <h1 className="text-2xl font-bold text-white">{config.label}</h1>
          </div>
          <div className="mt-4 mb-6">
            <span className="text-4xl font-bold">{config.price}</span>
            <span className="text-white/60 text-sm ml-1">{config.interval}</span>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-6">
            <p className="text-xs text-white/50 mb-1 font-medium">Billing to</p>
            <p className="font-semibold text-sm truncate">{checkoutData?.businessName || "—"}</p>
            <p className="text-white/50 text-xs truncate">{checkoutData?.email || "—"}</p>
          </div>

          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#B58CFF] mb-3">What&apos;s included</p>
            <ul className="space-y-2.5">
              {config.features.map(f => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-[#B58CFF] mt-0.5 flex-shrink-0" />
                  <span className="text-white/80">{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 flex items-center gap-2 text-white/40 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            Payments powered by Paystack &amp; Breet
          </div>
        </div>

        {/* ── Right: Payment Methods ── */}
        <div className="flex-1 bg-[#12061F] border-l border-white/5 p-6 md:p-10 flex flex-col">
          <h2 className="text-lg font-bold text-white mb-1">Choose payment method</h2>
          <p className="text-sm text-white/60 mb-6">Select how you&apos;d like to pay for your subscription.</p>

          {/* Tab selector */}
          <div className="flex gap-2 mb-6 border-b border-white/10 pb-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setError(null); setCryptoDetails(null); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-[#7B2FF7] text-white shadow-sm"
                    : "text-white/50 hover:text-white hover:bg-white/5"
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
                <div className="rounded-xl border border-[#7B2FF7]/30 bg-[#7B2FF7]/5 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-[#7B2FF7] flex items-center justify-center">
                      <CreditCard className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold text-white text-sm">Paystack</p>
                      <p className="text-xs text-white/50">Debit/credit card, USSD, or bank account</p>
                    </div>
                  </div>
                  <p className="text-xs text-white/50 mb-4">
                    A secure Paystack window will open for payment. Your card details are never stored by DeraLedger.
                  </p>
                  <Button
                    onClick={handleCardPayment}
                    disabled={loading || !checkoutData}
                    className="w-full h-12 bg-[#7B2FF7] hover:bg-[#B58CFF] hover:text-[#12061F] text-white font-bold text-base border-0 transition-all"
                  >
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Opening Paystack...</> : <>Pay {config.price} <CreditCard className="ml-2 h-4 w-4" /></>}
                  </Button>
                </div>
              )}
              {PROVIDER_FLAGS.monnify && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
                  <p className="text-sm font-semibold text-emerald-300 mb-1">Monnify</p>
                  <p className="text-xs text-emerald-400">Dynamic virtual accounts via Monnify.</p>
                </div>
              )}
            </div>
          )}

          {/* ── Bank Transfer tab ── */}
          {tab === "transfer" && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                    <ArrowRightLeft className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white text-sm">Bank Transfer via Paystack</p>
                    <p className="text-xs text-blue-400">Pay from your Nigerian bank account</p>
                  </div>
                </div>
                <p className="text-xs text-white/50 mb-4">
                  Click below — Paystack will generate a dedicated virtual account number for this transaction.
                </p>
                <Button
                  onClick={handleCardPayment}
                  disabled={loading || !checkoutData}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold text-base border-0"
                >
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Opening...</> : <>Get Transfer Details <ArrowRightLeft className="ml-2 h-4 w-4" /></>}
                </Button>
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
                    Use Card &amp; Bank or Bank Transfer for now.
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
                    {copied ? <><Check className="h-3.5 w-3.5 mr-1" />Copied</> : <><Copy className="h-3.5 w-3.5 mr-1" />Copy Address</>}
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
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Generating address...</> : "Generate Crypto Address"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>
          )}

          <p className="mt-auto pt-6 text-center text-xs text-white/40">
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
      <div className="min-h-screen flex items-center justify-center bg-[#12061F]">
        <Loader2 className="h-8 w-8 animate-spin text-[#B58CFF]" />
      </div>
    }>
      <SubscriptionCheckoutContent />
    </Suspense>
  );
}
