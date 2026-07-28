"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Copy,
  Info,
} from "lucide-react";

import { formatNaira } from "@/lib/calculations";
import {
  getActiveSubscription,
  getMerchant,
  getSubscriptionPayments,
  type SubscriptionPayment,
} from "@/lib/data";
import type { Merchant, Subscription } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PermissionGuard } from "@/components/PermissionGuard";
import {
  getPlanDisplayName,
  getPlanPriceLabel,
  getStoragePlanCode,
  normalizePlanCode,
} from "@/lib/plans";
import { getSoloPlusBillingActionPresentation } from "@/lib/solo-plus/ui";

type MerchantWithAccess = Merchant & {
  permissions?: Record<string, boolean>;
  currentUserRole?: string;
};

export default function BillingSettingsPage() {
  const [merchant, setMerchant] = useState<MerchantWithAccess | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [history, setHistory] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedRef, setCopiedRef] = useState<string | null>(null);
  const [soloPlusAvailable, setSoloPlusAvailable] = useState(false);
  const [soloPlusAvailabilityLoaded, setSoloPlusAvailabilityLoaded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;

    (async () => {
      const nextMerchant = await getMerchant();
      if (!active) {
        return;
      }

      setMerchant(nextMerchant);

      if (!nextMerchant) {
        setHistory([]);
        setLoading(false);
        return;
      }

      const currentPlan = normalizePlanCode(
        nextMerchant.subscription_plan || nextMerchant.merchant_tier || "starter",
      );

      if (currentPlan !== "starter") {
        const nextSubscription = await getActiveSubscription(nextMerchant.id);
        if (!active) {
          return;
        }
        setSubscription(nextSubscription);

        const nextHistory = await getSubscriptionPayments(nextMerchant.id);
        if (!active) {
          return;
        }
        setHistory(nextHistory);
      } else {
        setSubscription(null);
        setHistory([]);
      }

      setLoading(false);
    })().catch((error) => {
      console.error("Failed to load billing settings:", error);
      if (active) {
        setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetch("/api/plans/availability?plan=solo_plus")
      .then((response) => response.json())
      .then((payload) => {
        if (!active) {
          return;
        }

        setSoloPlusAvailable(payload?.available === true);
        setSoloPlusAvailabilityLoaded(true);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setSoloPlusAvailable(false);
        setSoloPlusAvailabilityLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  function handleRenew() {
    if (!merchant || !subscription) {
      return;
    }

    if (merchant.currentUserRole !== "owner") {
      return;
    }

    const plan = getStoragePlanCode(
      merchant.subscription_plan || subscription.plan_type || "individual",
    );
    if (plan === "starter") {
      return;
    }

    router.push(`/checkout/subscription?plan=${plan}&context=renewal`);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedRef(text);
    setTimeout(() => setCopiedRef(null), 2000);
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 rounded bg-purp-200" />
        <div className="h-4 w-96 rounded bg-purp-100" />
        <div className="h-64 w-full rounded border border-purp-100 bg-purp-50" />
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="py-12 text-center">
        <p className="text-neutral-500">Merchant data not found.</p>
      </div>
    );
  }

  const effectiveSubscription =
    subscription ||
    (merchant.subscription_plan === "starter"
      ? ({
          id: "starter-default",
          merchant_id: merchant.id,
          plan_type: "starter",
          amount_paid: 0,
          start_date: merchant.created_at || new Date().toISOString(),
          expiry_date: new Date(
            Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          status: "active",
          last_notified_at: null,
          is_banner_dismissed: true,
          created_at: merchant.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Subscription)
      : null);

  if (!effectiveSubscription) {
    return (
      <div className="py-12 text-center">
        <p className="text-neutral-500">
          Subscription data not found. Please contact support.
        </p>
      </div>
    );
  }

  const currentPlan = normalizePlanCode(
    merchant.subscription_plan || effectiveSubscription.plan_type || "starter",
  );
  const isStarter = currentPlan === "starter";
  const isSoloLite = currentPlan === "solo_lite";
  const isSoloPlus = currentPlan === "solo_plus";

  const isAccountOwner = merchant.currentUserRole === "owner";
  const planLabel = `${getPlanDisplayName(currentPlan)} Plan`;
  const planPrice = getPlanPriceLabel(currentPlan);
  const soloPlusAction = getSoloPlusBillingActionPresentation({
    currentPlan,
    currentUserRole: merchant.currentUserRole,
    soloPlusAvailable,
    soloPlusAvailabilityLoaded,
  });

  const now = new Date();
  const expiryDate = new Date(effectiveSubscription.expiry_date);
  const daysRemaining = Math.max(
    0,
    Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );

  let statusStr = "Active";
  let statusBadge = (
    <Badge className="border-green-200 bg-green-100 text-green-800">Active</Badge>
  );
  let showUrgency = false;

  if (effectiveSubscription.status === "cancelled") {
    statusStr = "Cancelled";
    statusBadge = (
      <Badge className="border-neutral-200 bg-neutral-100 text-neutral-800">
        Cancelled
      </Badge>
    );
    showUrgency = true;
  } else if (effectiveSubscription.status === "expired") {
    statusStr = "Expired";
    statusBadge = (
      <Badge className="border-red-200 bg-red-100 text-red-800">Expired</Badge>
    );
    showUrgency = true;
  } else if (daysRemaining <= 7) {
    statusStr = "Expiring Soon";
    statusBadge = (
      <Badge className="border-amber-200 bg-amber-100 text-amber-800">
        Expiring Soon
      </Badge>
    );
    showUrgency = true;
  }

  return (
    <PermissionGuard
      permission="manage_billing"
      merchant={merchant}
      featureLabel="Billing & Subscription"
    >
      <div className="max-w-4xl space-y-6 pb-20">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Billing &amp; Subscription</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Manage your subscription plan and view payment history.
          </p>
        </div>

        <Card className="overflow-hidden border-2 border-purp-200 shadow-none">
          <div className="flex flex-col items-start justify-between gap-4 border-b border-purp-200 bg-purp-50 p-6 md:flex-row md:items-center">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <h2 className="text-2xl font-bold text-purp-900">{planLabel}</h2>
                {!isStarter ? statusBadge : null}
              </div>
              {isStarter ? (
                <p className="text-neutral-600">Upgrade to a paid plan to manage billing.</p>
              ) : (
                <p className="text-lg text-neutral-600">
                  {planPrice} <span className="text-sm text-neutral-400">/ month</span>
                </p>
              )}
            </div>

            <div className="flex w-full flex-col gap-3 md:w-auto">
              {isStarter ? (
                <>
                  <Link
                    href="/settings/upgrade/individual"
                    className={cn(
                      buttonVariants({ variant: "default" }),
                      "w-full bg-purp-900 text-white hover:bg-purp-800 md:w-auto",
                    )}
                  >
                    Upgrade to Solo Lite
                  </Link>
                  {soloPlusAction ? (
                    soloPlusAction.kind === "link" ? (
                      <Link
                        href={soloPlusAction.href}
                        className={cn(
                          buttonVariants({ variant: "outline" }),
                          "w-full border-purp-200 text-purp-900 md:w-auto",
                        )}
                      >
                        {soloPlusAction.label}
                      </Link>
                    ) : (
                      <div className="flex w-full flex-col gap-2 md:w-auto">
                        <Button
                          disabled
                          variant="outline"
                          className="w-full border-neutral-200 text-neutral-500 md:w-auto"
                        >
                          {soloPlusAction.label}
                        </Button>
                        <p className="text-xs text-neutral-500">{soloPlusAction.helperText}</p>
                      </div>
                    )
                  ) : null}
                  {isAccountOwner ? (
                    <Link
                      href="/settings/upgrade/business"
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        "w-full border-purp-200 text-purp-900 md:w-auto",
                      )}
                    >
                      Upgrade to Business - NGN 20,000
                    </Link>
                  ) : null}
                </>
              ) : merchant.currentUserRole !== "owner" ? (
                <div className="flex w-full flex-col gap-2 md:w-auto">
                  <Button disabled className="w-full bg-neutral-200 font-bold text-neutral-500 md:w-auto">
                    Owner Only
                  </Button>
                  {(isSoloLite || isSoloPlus) ? (
                    <p className="text-xs text-neutral-500">
                      This upgrade is available only to the account owner.
                    </p>
                  ) : null}
                </div>
              ) : (
                <>
                  <Button
                    onClick={handleRenew}
                    className="w-full bg-purp-900 font-bold text-white hover:bg-purp-800 md:w-auto"
                  >
                    Renew Now - {planPrice}
                  </Button>
                  {soloPlusAction ? (
                    soloPlusAction.kind === "link" ? (
                      <Link
                        href={soloPlusAction.href}
                        className={cn(
                          buttonVariants({ variant: "outline" }),
                          "w-full border-purp-200 text-purp-900 md:w-auto",
                        )}
                      >
                        {soloPlusAction.label}
                      </Link>
                    ) : (
                      <div className="flex w-full flex-col gap-2 md:w-auto">
                        <Button
                          disabled
                          variant="outline"
                          className="w-full border-neutral-200 text-neutral-500 md:w-auto"
                        >
                          {soloPlusAction.label}
                        </Button>
                        <p className="text-xs text-neutral-500">{soloPlusAction.helperText}</p>
                      </div>
                    )
                  ) : null}
                  {(isSoloLite || isSoloPlus || isStarter) ? (
                    <Link
                      href="/settings/upgrade/business"
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        "w-full border-purp-200 text-purp-900 md:w-auto",
                      )}
                    >
                      Upgrade to Business - NGN 20,000
                    </Link>
                  ) : null}
                </>
              )}
            </div>
          </div>

          {!isStarter ? (
            <CardContent className="p-6">
              <div className="mb-4 flex items-center gap-2">
                {statusStr === "Expired" ? (
                  <AlertCircle className="h-5 w-5 text-red-500" />
                ) : statusStr === "Expiring Soon" ? (
                  <Clock className="h-5 w-5 text-amber-500" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                )}
                <span className="font-medium text-neutral-800">
                  {statusStr === "Expired" ? "Expired on:" : "Renews on:"}{" "}
                  {expiryDate.toLocaleDateString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>

              {showUrgency ? (
                <div
                  className={`rounded-lg p-4 ${
                    statusStr === "Cancelled"
                      ? "border border-neutral-200 bg-neutral-50 text-neutral-800"
                      : statusStr === "Expired"
                      ? "border border-red-200 bg-red-50 text-red-800"
                      : "border border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <p className="flex items-center gap-2 font-semibold">
                    <Info className="h-4 w-4" />
                    {statusStr === "Cancelled"
                      ? "Your subscription has been cancelled."
                      : statusStr === "Expired"
                      ? "Your subscription has expired."
                      : `${daysRemaining} days until renewal.`}
                  </p>
                  <p className="mt-1 text-sm opacity-90">
                    {statusStr === "Cancelled"
                      ? "Your access has been deactivated by an administrator. Please renew your plan or contact support to restore access."
                      : statusStr === "Expired"
                      ? "Renew now to restore access to DeraLedger's premium features including payment links and automated reminders."
                      : "Please renew your subscription soon to avoid any interruption in your invoicing and collection services."}
                  </p>
                </div>
              ) : null}
            </CardContent>
          ) : null}
        </Card>

        {!isStarter ? (
          <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-bold text-purp-900">Billing History</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 py-8 text-center">
                  <p className="text-neutral-500">No payment history found.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-purp-50 text-xs uppercase text-neutral-500">
                      <tr>
                        <th className="rounded-tl-lg px-4 py-3">Date</th>
                        <th className="px-4 py-3">Plan</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Period</th>
                        <th className="px-4 py-3">Reference</th>
                        <th className="rounded-tr-lg px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((record) => (
                        <tr
                          key={record.id}
                          className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                        >
                          <td className="px-4 py-4 font-medium text-neutral-900">
                            {new Date(record.created_at).toLocaleDateString("en-NG", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-4">{getPlanDisplayName(record.plan)}</td>
                          <td className="px-4 py-4">{formatNaira(record.amount_ngn)}</td>
                          <td className="px-4 py-4 text-xs text-neutral-600">
                            {new Date(record.period_start).toLocaleDateString("en-NG", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}{" "}
                            - <br />
                            {new Date(record.period_end).toLocaleDateString("en-NG", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-4">
                            <button
                              onClick={() => copyToClipboard(record.paystack_ref)}
                              className="flex items-center gap-1 rounded bg-purp-50 px-2 py-1 font-mono text-xs text-purp-600 transition-colors hover:text-purp-900"
                            >
                              {record.paystack_ref.substring(0, 8)}...
                              <Copy className="h-3 w-3" />
                              {copiedRef === record.paystack_ref ? (
                                <span className="ml-1 text-[10px] text-green-600">Copied!</span>
                              ) : null}
                            </button>
                          </td>
                          <td className="px-4 py-4">
                            {record.status === "paid" ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                                Paid
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                Refunded
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PermissionGuard>
  );
}
