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
    label: "Individual / Collections",
    routeLabel: "individual",
    price: "NGN 5,000",
    interval: "/month",
    workflow: "Online collections with automatic balance tracking",
    collectionLimit: "NGN 5M monthly collection limit",
    verification: "BVN verification required",
    icon: User,
    features: [
      "Unlimited record invoices",
      "Collection invoices and payment links",
      "QR collections",
      "Partial payment controls",
      "Automatic balance tracking",
      "5 team members",
      "Predefined roles with limited permission controls",
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
    workflow: "Structured finance team workflows",
    collectionLimit: "Unlimited monthly collections",
    verification: "CAC and director verification required",
    icon: Building2,
    features: [
      "Unlimited record invoices",
      "Unlimited collection invoices",
      "Advanced team management",
      "Full custom RBAC",
      "Custom roles",
      "Audit logs",
      "Advanced reporting",
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
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          href="/settings"
          className="inline-flex items-center text-sm font-medium text-neutral-500 hover:text-purp-700"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Settings
        </Link>
        <Card className="border-2 border-purp-200 shadow-none">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-purp-900">Upgrade plan not found</h1>
            <p className="mt-2 text-sm text-neutral-500">
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
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center text-sm font-medium text-neutral-500 hover:text-purp-700"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back to Settings
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-purp-900">Upgrade to {config.label}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Review the workflow, collection access, and verification requirements before subscribing.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="border-2 border-purp-900 bg-purp-900 py-0 text-white shadow-none">
          <CardHeader className="px-6 pb-0 pt-6">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-white/10">
              <Icon className="h-6 w-6 text-white" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-purp-200">
              {config.verification}
            </p>
            <CardTitle className="text-2xl font-bold text-white">{config.label}</CardTitle>
            <p className="text-sm leading-relaxed text-purp-200">{config.workflow}</p>
            <div className="pt-3">
              <span className="text-4xl font-bold text-white">{config.price}</span>
              <span className="ml-1 text-sm text-purp-200">{config.interval}</span>
            </div>
          </CardHeader>
          <CardContent className="px-6 pb-6 pt-5">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm font-semibold text-purp-50">
              {config.collectionLimit}
            </div>
            <h2 className="mt-6 text-sm font-bold text-white">Included</h2>
            <ul className="mt-3 space-y-3">
              {config.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  <span className="text-purp-50">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-2 border-amber-200 bg-amber-50/40 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-bold text-amber-900">
                <Shield className="h-5 w-5 text-amber-600" />
                Verification Requirements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm leading-relaxed text-amber-800">
                Payment collection is activated after the required checks for this workflow.
              </p>
              <ul className="space-y-2">
                {config.requirements.map((requirement) => (
                  <li key={requirement} className="flex items-start gap-2 text-sm text-amber-800">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span>{requirement}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border-2 border-purp-200 shadow-none">
            <CardContent className="space-y-4 p-6">
              {loadingMerchant ? (
                <div className="flex items-center gap-2 rounded-lg bg-purp-50 p-4 text-sm text-purp-900">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading workspace details...
                </div>
              ) : merchant?.subscription_plan === "individual" && plan === "corporate" ? (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">
                    Director or Highest Shareholder Full Name
                  </Label>
                  <label className="flex items-center gap-3 rounded-lg border border-purp-200 bg-purp-50/60 p-3">
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
                      className="h-4 w-4 accent-purp-700"
                    />
                    <span className="text-sm text-neutral-700">
                      Same as current owner ({merchant?.owner_name || "not set"})
                    </span>
                  </label>
                  {!sameOwner && (
                    <div className="space-y-1">
                      <Input
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        placeholder="Enter director or shareholder name"
                        className="h-11 border-2 border-purp-200"
                      />
                      <p className="text-xs text-amber-600">
                        A new verification check will be required for this name.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">
                      {plan === "corporate" ? "Director or Highest Shareholder Full Name" : "Owner Full Name"}
                    </Label>
                    {isOwnerNameLocked && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5">
                        🔒 Identity Verified
                      </span>
                    )}
                  </div>
                  <Input
                    value={ownerName}
                    onChange={(e) => !isOwnerNameLocked && setOwnerName(e.target.value)}
                    placeholder="e.g. Adebayo Olanrewaju"
                    disabled={isOwnerNameLocked}
                    className={`h-11 border-2 ${
                      isOwnerNameLocked
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900 cursor-not-allowed"
                        : "border-purp-200"
                    }`}
                  />
                  <p className="text-xs text-neutral-500">
                    {isOwnerNameLocked
                      ? "Name is locked — matched and verified against your BVN identity."
                      : plan === "corporate"
                      ? "This name supports director or shareholder verification."
                      : "This name should match your BVN verification details."}
                  </p>
                </div>
              )}

              {plan === "corporate" && (
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Registered Business Name</Label>
                  <Input
                    value={merchant?.business_name || ""}
                    disabled
                    className="h-11 border-2 border-neutral-200 bg-neutral-50"
                  />
                  <p className="text-xs text-neutral-500">
                    Your CAC-registered business name can be updated from Settings after upgrade.
                  </p>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-medium text-red-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
                  {error}
                </div>
              )}

              <Button
                onClick={handleUpgrade}
                disabled={loadingMerchant}
                className="h-12 w-full bg-purp-900 text-base font-bold text-white hover:bg-purp-700"
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Continue to Checkout
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Button>
              <p className="text-center text-xs text-neutral-500">
                Secured by Paystack. You will be redirected to complete payment.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
