"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  Shield,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMerchant } from "@/lib/data";
import type { Merchant } from "@/lib/types";

type UpgradePlanId = "individual" | "corporate";

type UpgradePlanConfig = {
  label: string;
  routeLabel: string;
  price: string;
  interval: string;
  workflow: string;
  collectionLimit: string;
  verification: string;
  icon: typeof User;
  features: string[];
  requirements: string[];
};

interface UpgradePageProps {
  params: Promise<{ plan: string }>;
}

const PLAN_CONFIG: Record<UpgradePlanId, UpgradePlanConfig> = {
  individual: {
    label: "Individual",
    routeLabel: "individual",
    price: "NGN 5,000",
    interval: "/month",
    workflow: "For verified online collections",
    collectionLimit: "₦5M monthly collection limit",
    verification: "BVN & Selfie required",
    icon: User,
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
    requirements: [
      "Bank Verification Number (BVN) for payment collection activation.",
      "A valid settlement bank account.",
    ],
  },
  corporate: {
    label: "Business",
    routeLabel: "corporate",
    price: "NGN 20,000",
    interval: "/month",
    workflow: "Operational collections infrastructure for growing businesses",
    collectionLimit: "Unlimited monthly collections",
    verification: "CAC & Director required",
    icon: Building2,
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
    requirements: [
      "CAC registration details and supporting business documents.",
      "Director or highest shareholder verification.",
      "A valid business settlement bank account.",
    ],
  },
};

function isUpgradePlanId(value: string): value is UpgradePlanId {
  return value === "individual" || value === "corporate";
}

export default function UpgradePlanPage({ params }: UpgradePageProps) {
  const { plan } = use(params);
  const [loading, setLoading] = useState(false);
  const [loadingMerchant, setLoadingMerchant] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [sameOwner, setSameOwner] = useState(true);
  // Lock owner_name once BVN or selfie has been identity-verified
  const isOwnerNameLocked = merchant?.bvn_status === "verified" || merchant?.selfie_status === "verified";

  useEffect(() => {
    let active = true;

    getMerchant()
      .then((m) => {
        if (!active) return;
        setMerchant(m);
        setOwnerName(m?.owner_name || "");
      })
      .finally(() => {
        if (active) setLoadingMerchant(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (!isUpgradePlanId(plan)) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-white/10 bg-[#12061F] p-8 text-white shadow-xl">
        <Link
          href="/settings"
          className="inline-flex items-center text-sm font-medium text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Settings
        </Link>
        <Card className="border-0 bg-white/5 backdrop-blur-sm shadow-none">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-white">Upgrade plan not found</h1>
            <p className="mt-2 text-sm text-white/60">
              Choose Individual / Collections or Business to continue.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const config = PLAN_CONFIG[plan];
  const Icon = config.icon;

  const router = useRouter();

  const handleUpgrade = async () => {
    if (!ownerName.trim()) {
      setError("Please provide the owner or shareholder name before upgrading.");
      return;
    }
    // Save owner name then navigate to the checkout page
    sessionStorage.setItem("upgradeCheckout", JSON.stringify({ ownerName: ownerName.trim() }));
    router.push(`/checkout/upgrade/${plan}`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 rounded-2xl border border-white/10 bg-[#12061F] p-8 md:p-10 text-white shadow-[0_0_40px_rgba(123,47,247,0.1)]">
      <Link
        href="/settings"
        className="inline-flex items-center text-sm font-medium text-white/60 hover:text-white transition-colors"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back to Settings
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-white">Upgrade to {config.label}</h1>
        <p className="mt-2 text-sm text-white/60">
          Review the workflow, collection access, and verification requirements before subscribing.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="border border-[#7B2FF7] bg-[#3D0B66]/30 py-0 text-white shadow-[0_0_30px_rgba(123,47,247,0.15)] backdrop-blur-sm">
          <CardHeader className="px-8 pb-0 pt-8">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-white/10 text-[#B58CFF]">
              <Icon className="h-6 w-6" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#B58CFF]">
              {config.verification}
            </p>
            <CardTitle className="mt-1 text-3xl font-bold text-white">{config.label}</CardTitle>
            <p className="mt-2 text-sm leading-relaxed text-white/80">{config.workflow}</p>
            <div className="pt-5">
              <span className="text-4xl font-bold text-white">{config.price}</span>
              <span className="ml-1 text-sm text-white/60">{config.interval}</span>
            </div>
          </CardHeader>
          <CardContent className="px-8 pb-8 pt-6">
            <div className="rounded-xl border border-white/10 bg-[#12061F]/50 p-4 text-sm font-semibold text-white/80">
              {config.collectionLimit}
            </div>
            <h2 className="mt-8 text-sm font-bold text-white">Included</h2>
            <ul className="mt-4 space-y-4">
              {config.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#B58CFF]" />
                  <span className="text-white/80">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border border-[#7B2FF7]/30 bg-[#7B2FF7]/5 shadow-none backdrop-blur-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-bold text-white">
                <Shield className="h-5 w-5 text-[#B58CFF]" />
                Verification Requirements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm leading-relaxed text-white/60">
                Payment collection is activated after the required checks for this workflow.
              </p>
              <ul className="space-y-3">
                {config.requirements.map((requirement) => (
                  <li key={requirement} className="flex items-start gap-3 text-sm text-white/80">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#B58CFF]" />
                    <span>{requirement}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border border-white/10 bg-white/5 backdrop-blur-sm shadow-none">
            <CardContent className="space-y-5 p-8">
              {loadingMerchant ? (
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#12061F]/50 p-5 text-sm text-white/80">
                  <Loader2 className="h-4 w-4 animate-spin text-[#B58CFF]" />
                  Loading workspace details...
                </div>
              ) : merchant?.subscription_plan === "individual" && plan === "corporate" ? (
                <div className="space-y-4">
                  <Label className="text-sm font-medium text-white">
                    Director or Highest Shareholder Full Name
                  </Label>
                  <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#12061F]/50 p-4">
                    <input
                      type="checkbox"
                      checked={sameOwner}
                      onChange={(e) => {
                        setSameOwner(e.target.checked);
                        if (e.target.checked) {
                          setOwnerName(merchant?.owner_name || "");
                        } else {
                          setOwnerName("");
                        }
                      }}
                      className="h-4 w-4 accent-[#7B2FF7]"
                    />
                    <span className="text-sm text-white/80">
                      Same as current owner ({merchant?.owner_name || "not set"})
                    </span>
                  </label>
                  {!sameOwner && (
                    <div className="space-y-2">
                      <Input
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        placeholder="Enter director or shareholder name"
                        className="h-11 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
                      />
                      <p className="text-xs text-amber-400">
                        A new verification check will be required for this name.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <Label className="text-sm font-medium text-white">
                      {plan === "corporate" ? "Director or Highest Shareholder Full Name" : "Owner Full Name"}
                    </Label>
                    {isOwnerNameLocked && (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-2.5 py-0.5">
                        🔒 Identity Verified
                      </span>
                    )}
                  </div>
                  <Input
                    value={ownerName}
                    onChange={(e) => !isOwnerNameLocked && setOwnerName(e.target.value)}
                    placeholder="e.g. Adebayo Olanrewaju"
                    disabled={isOwnerNameLocked}
                    className={`h-11 border ${
                      isOwnerNameLocked
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 cursor-not-allowed opacity-80"
                        : "border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
                    }`}
                  />
                  <p className="text-xs text-white/50">
                    {isOwnerNameLocked
                      ? "Name is locked — matched and verified against your BVN identity."
                      : plan === "corporate"
                      ? "This name supports director or shareholder verification."
                      : "This name should match your BVN verification details."}
                  </p>
                </div>
              )}

              {plan === "corporate" && (
                <div className="space-y-2 pt-2">
                  <Label className="text-sm font-medium text-white">Registered Business Name</Label>
                  <Input
                    value={merchant?.business_name || ""}
                    disabled
                    className="h-11 border-white/10 bg-[#12061F] text-white/70 opacity-80 cursor-not-allowed"
                  />
                  <p className="text-xs text-white/50">
                    Your CAC-registered business name can be updated from Settings after upgrade.
                  </p>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-medium text-red-400 mt-6">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  {error}
                </div>
              )}

              <Button
                onClick={handleUpgrade}
                disabled={loadingMerchant}
                className="mt-6 h-12 w-full bg-[#7B2FF7] hover:bg-[#B58CFF] hover:text-[#12061F] text-base font-bold text-white transition-all border-0"
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Continue to Checkout
                  <ArrowRight className="h-4 w-4 ml-1" />
                </span>
              </Button>
              <p className="text-center text-xs text-white/40 pt-2">
                Secured by Paystack. You will be redirected to complete payment.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
