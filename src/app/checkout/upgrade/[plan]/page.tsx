"use client";

import { useEffect, useState, useRef } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, CreditCard, ArrowRightLeft, Bitcoin,
  Loader2, ShieldCheck, Lock, Copy, Check, Building2, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMerchant } from "@/lib/data";
import type { Merchant } from "@/lib/types";

const PROVIDER_FLAGS = {
  paystack: true,
  monnify: false,
  breet: false,
};

const PLAN_CONFIG: Record<string, {
  label: string; price: string; priceKobo: number; interval: string;
  verification: string; features: string[];
  icon: typeof User; color: string;
}> = {
  individual: {
    label: "Individual / Collections", price: "NGN 5,000", priceKobo: 500000, interval: "/month",
    verification: "BVN & Selfie required",
    features: ["Collection invoices enabled", "Online payment collection", "Grouped references & deposits", "Partial payment controls", "₦5M monthly collection limit", "20 active collection invoices"],
    icon: User, color: "from-[#1A0B2E] to-[#3D0B66]",
  },
  corporate: {
    label: "Business", price: "NGN 20,000", priceKobo: 2000000, interval: "/month",
    verification: "CAC & Director required",
    features: ["Unlimited collection invoices", "Custom Role-Based Access (RBAC)", "Grouped receivables", "Advanced analytics", "No watermark", "White-label invoices"],
    icon: Building2, color: "from-[#0B0314] to-[#12061F]",
  },
};

type Tab = "card" | "transfer" | "crypto";

interface UpgradeCheckoutPageProps {
  params: Promise<{ plan: string }>;
}

function UpgradeCheckoutContent({ plan }: { plan: string }) {
  const router = useRouter();
  const config = PLAN_CONFIG[plan];
  const Icon = config?.icon ?? User;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loadingMerchant, setLoadingMerchant] = useState(true);
  const [tab, setTab] = useState<Tab>("card");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cryptoDetails, setCryptoDetails] = useState<{
    address: string; network: string; coin: string; fiatAmount: number; reference: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const paystackLoaded = useRef(false);
  // ownerName is read from sessionStorage (set by upgrade page)
  const [ownerName, setOwnerName] = useState("");

  useEffect(() => {
    if (paystackLoaded.current) return;
    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.async = true;
    document.body.appendChild(script);
    paystackLoaded.current = true;
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem("upgradeCheckout");
    if (stored) {
      try { setOwnerName(JSON.parse(stored).ownerName || ""); } catch { /* ignore */ }
    }
    getMerchant()
      .then(m => setMerchant(m))
      .finally(() => setLoadingMerchant(false));
  }, []);

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#12061F]">
        <p className="text-white/60">Invalid plan. <Link href="/settings" className="text-[#B58CFF] underline">Go back</Link></p>
      </div>
    );
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCardPayment = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/payment/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPlan: plan, ownerName }),
      });
      const data = await res.json();
      if (!data.accessCode) throw new Error(data.error || "Failed to initialize payment.");

      const pop = (window as Window & { PaystackPop?: { setup: (opts: Record<string, unknown>) => { openIframe: () => void } } }).PaystackPop;
      if (!pop) throw new Error("Paystack not loaded. Please refresh and try again.");

      const reference = data.reference;
      const handler = pop.setup({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY,
        email: merchant?.email || "billing@deraledger.app",
        amount: config.priceKobo,
        ref: data.reference,
        access_code: data.accessCode,
        metadata: {
          type: "subscription_upgrade",
          merchant_id: merchant?.id,
          new_plan: plan,
          owner_name: ownerName || null,
        },
        callback: (response: { reference: string }) => {
          sessionStorage.removeItem("upgradeCheckout");
          router.push(`/settings/upgrade-success?reference=${response.reference}&plan=${plan}`);
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
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/checkout/crypto-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPlan: plan, ownerName }),
      });
      const data = await res.json();
      if (!data.cryptoAddress) throw new Error(data.error || "Failed to generate address.");
      setCryptoDetails({ address: data.cryptoAddress, network: data.cryptoNetwork, coin: data.cryptoCoin, fiatAmount: data.fiatAmount, reference: data.reference });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "card", label: "Card & Bank", icon: <CreditCard className="h-4 w-4" /> },
    { id: "transfer", label: "Bank Transfer", icon: <ArrowRightLeft className="h-4 w-4" /> },
    { id: "crypto", label: "Crypto", icon: <Bitcoin className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#12061F] flex flex-col">
      {/* Header */}
      <header className="bg-[#1A0B2E] border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <Link href={`/settings/upgrade/${plan}`} className="text-white/60 hover:text-white flex items-center gap-1.5 text-sm font-medium transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-2 ml-auto text-xs text-white/40">
          <Lock className="h-3.5 w-3.5" /> Secured by DeraLedger
        </div>
      </header>

      <main className="flex flex-col md:flex-row flex-1 max-w-5xl mx-auto w-full">
        {/* ── Left: Plan Summary ── */}
        <div className={`bg-gradient-to-br ${config.color} border-r border-white/5 text-white w-full md:w-5/12 p-8 md:min-h-[calc(100vh-53px)] flex flex-col`}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
              <Icon className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs text-[#B58CFF] font-semibold uppercase tracking-wider">{config.verification}</p>
              <h1 className="text-xl font-bold text-white">{config.label}</h1>
            </div>
          </div>

          <div className="mb-6">
            <span className="text-4xl font-bold">{config.price}</span>
            <span className="text-white/60 text-sm ml-1">{config.interval}</span>
          </div>

          {loadingMerchant ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-6 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#B58CFF]" />
              <p className="text-white/60 text-sm">Loading workspace...</p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-6">
              <p className="text-xs text-white/50 mb-1 font-medium">Upgrading workspace</p>
              <p className="font-semibold text-sm truncate">{merchant?.trading_name || merchant?.business_name || "—"}</p>
              <p className="text-white/50 text-xs truncate">{merchant?.email || "—"}</p>
            </div>
          )}

          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#B58CFF] mb-3">What you&apos;ll unlock</p>
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
          <p className="text-sm text-white/60 mb-6">Select how you&apos;d like to pay for your upgrade.</p>

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

          {/* Card & Bank */}
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
                    A secure Paystack window will open. Your card details are never stored by DeraLedger.
                  </p>
                  <Button onClick={handleCardPayment} disabled={loading || loadingMerchant}
                    className="w-full h-12 bg-[#7B2FF7] hover:bg-[#B58CFF] hover:text-[#12061F] text-white font-bold text-base border-0 transition-all">
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Opening Paystack...</> : <>Pay {config.price} <CreditCard className="ml-2 h-4 w-4" /></>}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Bank Transfer */}
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
                  Paystack will generate a virtual account number. Transfer the exact amount to activate your plan.
                </p>
                <Button onClick={handleCardPayment} disabled={loading || loadingMerchant}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold text-base border-0">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Opening...</> : <>Get Transfer Details <ArrowRightLeft className="ml-2 h-4 w-4" /></>}
                </Button>
              </div>
            </div>
          )}

          {/* Crypto */}
          {tab === "crypto" && (
            <div className="flex-1 flex flex-col gap-4">
              {!PROVIDER_FLAGS.breet ? (
                <div className="rounded-xl border-2 border-amber-100 bg-amber-50 p-6 text-center">
                  <Bitcoin className="h-10 w-10 text-amber-500 mx-auto mb-3" />
                  <p className="font-semibold text-amber-900 mb-1">Crypto Payments — Coming Soon</p>
                  <p className="text-xs text-amber-700">BTC, USDT, and ETH via Breet are being activated. Use Card & Bank or Bank Transfer for now.</p>
                </div>
              ) : cryptoDetails ? (
                <div className="rounded-xl border-2 border-orange-100 bg-orange-50 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-orange-900 text-sm">Send {cryptoDetails.coin}</p>
                    <span className="text-xs bg-orange-200 text-orange-900 rounded px-2 py-0.5 font-medium">{cryptoDetails.network}</span>
                  </div>
                  <div className="bg-white rounded-lg border border-orange-200 p-3 font-mono text-xs text-neutral-700 break-all">{cryptoDetails.address}</div>
                  <Button variant="outline" size="sm" onClick={() => handleCopy(cryptoDetails.address)} className="w-full border-orange-300 text-orange-700">
                    {copied ? <><Check className="h-3.5 w-3.5 mr-1" /> Copied</> : <><Copy className="h-3.5 w-3.5 mr-1" /> Copy Address</>}
                  </Button>
                  <p className="text-xs text-orange-700 text-center">Send equivalent of <strong>NGN {cryptoDetails.fiatAmount.toLocaleString()}</strong></p>
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
                  <Button onClick={handleCryptoPayment} disabled={loading} className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white font-bold">
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating...</> : "Generate Crypto Address"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>
          )}

          <p className="mt-auto pt-6 text-center text-xs text-white/40">
            Subscription renews monthly. You can manage it from Settings &gt; Billing.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function UpgradeCheckoutPage({ params }: UpgradeCheckoutPageProps) {
  const { plan } = use(params);
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#12061F]">
        <Loader2 className="h-8 w-8 animate-spin text-[#B58CFF]" />
      </div>
    }>
      <UpgradeCheckoutContent plan={plan} />
    </Suspense>
  );
}
