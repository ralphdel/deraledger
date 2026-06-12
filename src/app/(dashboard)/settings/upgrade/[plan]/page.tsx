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

// CAMA 2020 Nigeria — 7 official business registration structures
const CAMA_TYPES = [
  { value: "sole_proprietorship", label: "Sole Proprietorship / Registered Business Name", ownerLabel: "Sole Proprietor / Business Owner Full Name" },
  { value: "ltd",                 label: "Private Limited Company (LTD)",             ownerLabel: "Director or Shareholder Full Name" },
  { value: "plc",                 label: "Public Limited Company (PLC)",              ownerLabel: "Director or Shareholder Full Name" },
  { value: "llp",                 label: "Limited Liability Partnership (LLP)",        ownerLabel: "Designated Partner or Partner Full Name" },
  { value: "lp",                  label: "Limited Partnership (LP)",                  ownerLabel: "Designated Partner or Partner Full Name" },
  { value: "incorporated_trustees", label: "Incorporated Trustees (IT)",             ownerLabel: "Trustee or Chairperson Full Name" },
  { value: "cooperative",         label: "Cooperative Society",                       ownerLabel: "President or Trustee Full Name" },
];

function getOwnerLabel(businessType: string, plan: string, relationshipClaim?: string): string {
  if (plan !== "corporate") return "Business Owner Full Name";
  if (relationshipClaim === "representative_claim") return "Account Representative Full Name";
  return CAMA_TYPES.find(t => t.value === businessType)?.ownerLabel ?? "Director or Shareholder Full Name";
}

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
    verification: "Business & authority checks required",
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
      "Business registration details and supporting business documents.",
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
  const [loadingMerchant, setLoadingMerchant] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [sameOwner, setSameOwner] = useState(true);
  // Business type — relevant for corporate plan, defaults to sole_proprietorship
  const [businessType, setBusinessType] = useState("sole_proprietorship");
  const [relationshipClaim, setRelationshipClaim] = useState<"owner_affiliated_claim" | "representative_claim">("owner_affiliated_claim");
  const [verificationDisclosureAccepted, setVerificationDisclosureAccepted] = useState(false);
  const router = useRouter();

  // NOTE: owner_name is NOT locked during any upgrade flow.
  // When upgrading (starter→individual, individual→corporate, starter→corporate),
  // the operator may need to enter a different director/shareholder name which
  // will be verified against the new plan's KYC requirements AFTER upgrade.
  // Locking here would cause a deadlock for legitimate corporate director changes.

  useEffect(() => {
    let active = true;

    getMerchant()
      .then((m) => {
        if (!active) return;
        setMerchant(m);
        // Pre-fill owner name from existing merchant data
        setOwnerName(m?.owner_name || "");
        // Pre-fill business type if already set on merchant
        if (m?.business_type) setBusinessType(m.business_type);
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
      <div className="mx-auto max-w-3xl space-y-6 rounded-2xl border border-border bg-background p-8 text-foreground shadow-xl dark:bg-[#10081D] dark:text-white">
        <Link
          href="/settings"
          className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors dark:hover:text-white"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Settings
        </Link>
        <Card className="border-0 bg-card backdrop-blur-sm shadow-none dark:bg-white/5">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-foreground dark:text-white">Upgrade plan not found</h1>
            <p className="mt-2 text-sm text-muted-foreground dark:text-white/70">
              Choose Individual / Collections or Business to continue.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const config = PLAN_CONFIG[plan];
  const Icon = config.icon;

  const handleUpgrade = async () => {
    if (!ownerName.trim()) {
      setError("Please provide the owner or representative name before upgrading.");
      return;
    }
    if (plan === "corporate" && !businessType) {
      setError("Please select your business registration type before upgrading.");
      return;
    }
    if (!verificationDisclosureAccepted) {
      setError("Please acknowledge that live payment collection remains disabled until verification is complete.");
      return;
    }
    // Save owner name + business type then navigate to the checkout page
    sessionStorage.setItem(
      "upgradeCheckout",
      JSON.stringify({
        ownerName: ownerName.trim(),
        businessType: plan === "corporate" ? businessType : null,
        relationshipClaim: plan === "corporate" ? relationshipClaim : "owner_affiliated_claim",
        verificationDisclosureAccepted,
        disclosureVersion: "1.0",
      })
    );
    router.push(`/checkout/upgrade/${plan}`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 rounded-2xl border border-border bg-background p-6 text-foreground shadow-[0_0_40px_rgba(123,47,247,0.07)] md:p-10 dark:bg-[#20112F]">
      <Link
        href="/settings"
        className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back to Settings
      </Link>

      <div>
        <h1 className="text-3xl font-bold text-foreground dark:text-white">Upgrade to {config.label}</h1>
        <p className="mt-2 text-sm text-muted-foreground dark:text-white/72">
          Review the workflow, collection access, and verification requirements before subscribing.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <Card className="border border-[#CDBBFF]/70 bg-card py-0 text-card-foreground shadow-[0_0_24px_rgba(205,187,255,0.11)] backdrop-blur-sm dark:bg-white/8">
          <CardHeader className="px-8 pb-0 pt-8">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-[#B58CFF] dark:bg-white/10">
              <Icon className="h-6 w-6" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#B58CFF]">
              {config.verification}
            </p>
            <CardTitle className="mt-1 text-3xl font-bold text-foreground dark:text-white">{config.label}</CardTitle>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground dark:text-white/78">{config.workflow}</p>
            <div className="pt-5">
              <span className="text-4xl font-bold text-foreground dark:text-white">{config.price}</span>
              <span className="ml-1 text-sm text-muted-foreground dark:text-white/70">{config.interval}</span>
            </div>
          </CardHeader>
          <CardContent className="px-8 pb-8 pt-6">
            <div className="rounded-xl border border-border bg-muted p-4 text-sm font-semibold text-foreground dark:text-white/85">
              {config.collectionLimit}
            </div>
            <h2 className="mt-8 text-sm font-bold text-foreground dark:text-white">Included</h2>
            <ul className="mt-4 space-y-4">
              {config.features.map((feature) => (
                <li key={feature} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#B58CFF]" />
                  <span className="text-foreground dark:text-white/82">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border border-[#CDBBFF]/40 bg-card shadow-none backdrop-blur-sm dark:bg-white/5">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-bold text-foreground dark:text-white">
                <Shield className="h-5 w-5 text-[#B58CFF]" />
                Verification Requirements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm leading-relaxed text-muted-foreground dark:text-white/70">
                Payment collection is activated after the required checks for this workflow.
              </p>
              <ul className="space-y-3">
                {config.requirements.map((requirement) => (
                  <li key={requirement} className="flex items-start gap-3 text-sm text-foreground dark:text-white/82">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#B58CFF]" />
                    <span>{requirement}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card className="border border-border bg-card backdrop-blur-sm shadow-none dark:bg-white/5">
            <CardContent className="space-y-5 p-8">
              {loadingMerchant ? (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-muted p-5 text-sm text-foreground dark:bg-[#12061F]/50 dark:text-white/82">
                  <Loader2 className="h-4 w-4 animate-spin text-[#B58CFF]" />
                  Loading workspace details...
                </div>
              ) : (
                <>
                  {/* ── Business Type Selector (Corporate only) ── */}
                  {plan === "corporate" && (
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-white">
                        Business Registration Type <span className="text-red-400">*</span>
                      </Label>
                      <p className="text-xs text-white/50">
                        Select your business registration structure. This determines the verification documents required.
                      </p>
                      <select
                        value={businessType}
                        onChange={(e) => setBusinessType(e.target.value)}
                        className="w-full h-11 rounded-lg border border-white/10 bg-[#12061F] px-3 text-sm text-white focus:border-[#7B2FF7] focus:outline-none cursor-pointer"
                      >
                        {CAMA_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* ── Owner / Director Name — ALWAYS editable during upgrade ── */}
                  {plan === "corporate" && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-white">
                        What is your relationship with this business? <span className="text-red-400">*</span>
                      </Label>
                      <p className="text-xs text-white/50">
                        This helps us confirm that the business account is being created by an authorized person.
                      </p>
                      <div className="grid gap-3">
                        <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                          relationshipClaim === "owner_affiliated_claim"
                            ? "border-[#7B2FF7] bg-[#7B2FF7]/15"
                            : "border-white/10 bg-[#12061F]/50 hover:border-white/20"
                        }`}>
                          <input
                            type="radio"
                            name="relationshipClaim"
                            checked={relationshipClaim === "owner_affiliated_claim"}
                            onChange={() => setRelationshipClaim("owner_affiliated_claim")}
                            className="mt-1 h-4 w-4 accent-[#7B2FF7]"
                          />
                          <span>
                            <span className="block text-sm font-semibold text-white">I am a Director, Owner, Shareholder, or Proprietor</span>
                            <span className="mt-1 block text-xs text-white/50">We will match your verified identity against the business registry record.</span>
                          </span>
                        </label>
                        <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                          relationshipClaim === "representative_claim"
                            ? "border-[#7B2FF7] bg-[#7B2FF7]/15"
                            : "border-white/10 bg-[#12061F]/50 hover:border-white/20"
                        }`}>
                          <input
                            type="radio"
                            name="relationshipClaim"
                            checked={relationshipClaim === "representative_claim"}
                            onChange={() => setRelationshipClaim("representative_claim")}
                            className="mt-1 h-4 w-4 accent-[#7B2FF7]"
                          />
                          <span>
                            <span className="block text-sm font-semibold text-white">I am setting this up on behalf of the business</span>
                            <span className="mt-1 block text-xs text-white/50">A listed director or owner will need to verify and approve activation.</span>
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Label className="text-sm font-medium text-white">
                        {getOwnerLabel(businessType, plan, relationshipClaim)} <span className="text-red-400">*</span>
                      </Label>
                      {(merchant?.bvn_status === "verified" || merchant?.selfie_status === "verified") && (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-2.5 py-0.5">
                          ⚠ Re-verification may be required
                        </span>
                      )}
                    </div>

                    {/* For individual→corporate: quick checkbox to reuse existing owner */}
                    {merchant?.subscription_plan === "individual" && plan === "corporate" && merchant.owner_name && (
                      <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#12061F]/50 px-4 py-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sameOwner}
                          onChange={(e) => {
                            setSameOwner(e.target.checked);
                            setOwnerName(e.target.checked ? (merchant?.owner_name || "") : "");
                          }}
                          className="h-4 w-4 accent-[#7B2FF7]"
                        />
                        <span className="text-sm text-white/80">
                          Same as current owner — <strong className="text-white">{merchant.owner_name}</strong>
                        </span>
                      </label>
                    )}

                    <Input
                      value={ownerName}
                      onChange={(e) => {
                        setOwnerName(e.target.value);
                        // Uncheck "same owner" if user starts typing a different name
                        if (merchant?.subscription_plan === "individual" && plan === "corporate") {
                          setSameOwner(e.target.value === (merchant?.owner_name || ""));
                        }
                      }}
                      placeholder={`e.g. ${plan === "corporate" ? "Adebayo Olanrewaju (Director)" : "Adebayo Olanrewaju"}`}
                      className="h-11 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
                    />
                    <p className="text-xs text-white/50">
                      {plan === "corporate"
                        ? relationshipClaim === "representative_claim"
                          ? "Enter your own legal name. A listed director or owner will verify and approve the business separately."
                          : `This name will be used for ${getOwnerLabel(businessType, plan, relationshipClaim).toLowerCase()} verification against official business and identity records.`
                        : "This name should match your BVN details. Verification will be completed in your account settings after upgrade."}
                    </p>
                  </div>

                  {/* ── Registered Business Name (display only for corporate) ── */}
                  {plan === "corporate" && (
                    <div className="space-y-2 pt-2">
                      <Label className="text-sm font-medium text-white">Registered Business Name</Label>
                      <Input
                        value={merchant?.business_name || ""}
                        disabled
                        className="h-11 border-white/10 bg-[#12061F] text-white/70 opacity-80 cursor-not-allowed"
                      />
                      <p className="text-xs text-white/50">
                        Your registered business name can be updated from Settings after upgrade.
                      </p>
                    </div>
                  )}
                </>
              )}

              {error && (
                <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-medium text-red-400 mt-6">
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  {error}
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                <input
                  type="checkbox"
                  checked={verificationDisclosureAccepted}
                  onChange={(event) => setVerificationDisclosureAccepted(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-[#7B2FF7]"
                />
                <span className="text-sm leading-relaxed text-amber-100">
                  I understand that my subscription gives setup access only, and live payment collection will remain disabled until successful verification.
                </span>
              </label>

              <Button
                onClick={handleUpgrade}
                disabled={loadingMerchant || !verificationDisclosureAccepted}
                className="mt-6 h-12 w-full bg-[#7B2FF7] hover:bg-[#B58CFF] hover:text-[#12061F] text-base font-bold text-white transition-all border-0"
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" />
                  Continue to Checkout
                  <ArrowRight className="h-4 w-4 ml-1" />
                </span>
              </Button>
              <p className="text-center text-xs text-white/40 pt-2">
                Secure checkout. You will be redirected to complete payment.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
