"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatNaira } from "@/lib/calculations";
import { getMerchant, getActiveSubscription, getSubscriptionPayments, type SubscriptionPayment } from "@/lib/data";
import type { Merchant, Subscription } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertCircle, CheckCircle, Clock, Copy, Download, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function BillingSettingsPage() {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [history, setHistory] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState(false);
  const [copiedRef, setCopiedRef] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getMerchant(),
      getSubscriptionPayments()
    ]).then(async ([m, h]) => {
      setMerchant(m);
      if (m) {
        const sub = await getActiveSubscription(m.id);
        setSubscription(sub);
      }
      setHistory(h);
      setLoading(false);
    });
  }, []);

  const handleRenew = async () => {
    if (!merchant || !subscription) return;
    setRenewing(true);
    
    try {
      const res = await fetch("/api/payment/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: subscription.plan_type })
      });
      
      const data = await res.json();
      if (data.success && data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      } else {
        alert(data.error || "Failed to initialize payment");
        setRenewing(false);
      }
    } catch (err: any) {
      console.error(err);
      alert("An unexpected error occurred");
      setRenewing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRef(text);
    setTimeout(() => setCopiedRef(null), 2000);
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-purp-200 rounded"></div>
        <div className="h-4 w-96 bg-purp-100 rounded"></div>
        <div className="h-64 w-full bg-purp-50 rounded border border-purp-100"></div>
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">Merchant data not found.</p>
      </div>
    );
  }

  // For Starter plan merchants with no subscription record, synthesize a virtual one
  const effectiveSubscription = subscription || (merchant.subscription_plan === "starter" ? {
    id: "starter-default",
    merchant_id: merchant.id,
    plan_type: "starter" as const,
    amount_paid: 0,
    start_date: merchant.created_at || new Date().toISOString(),
    expiry_date: new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    status: "active",
    last_notified_at: null,
    is_banner_dismissed: true,
    created_at: merchant.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as Subscription : null);

  if (!effectiveSubscription) {
    return (
      <div className="text-center py-12">
        <p className="text-neutral-500">Subscription data not found. Please contact support.</p>
      </div>
    );
  }

  // Use merchant.subscription_plan as the authoritative source for the current plan.
  // The subscription row is used for dates/status, but the plan column on merchants is
  // always updated atomically during upgrade/renewal so it's the most reliable.
  const currentPlan = (merchant.subscription_plan || effectiveSubscription.plan_type || "starter") as string;
  const isStarter = currentPlan === "starter";
  const planLabel = isStarter ? "Starter Plan" : currentPlan === "individual" ? "Individual Plan" : "Corporate Plan";
  const planPrice = isStarter ? "Free" : currentPlan === "individual" ? "₦5,000" : "₦20,000";
  
  const now = new Date();
  const expiryDate = new Date(effectiveSubscription.expiry_date);
  const daysRemaining = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  
  let statusStr = "Active";
  let statusBadge = <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>;
  let showUrgency = false;
  
  if (effectiveSubscription.status === "cancelled") {
    statusStr = "Cancelled";
    statusBadge = <Badge className="bg-neutral-100 text-neutral-800 border-neutral-200">Cancelled</Badge>;
    showUrgency = true;
  } else if (effectiveSubscription.status === "expired") {
    statusStr = "Expired";
    statusBadge = <Badge className="bg-red-100 text-red-800 border-red-200">Expired</Badge>;
    showUrgency = true;
  } else if (daysRemaining <= 7) {
    statusStr = "Expiring Soon";
    statusBadge = <Badge className="bg-amber-100 text-amber-800 border-amber-200">Expiring Soon</Badge>;
    showUrgency = true;
  }

  return (
    <div className="max-w-4xl space-y-6 pb-20">
      <div>
        <h1 className="text-2xl font-bold text-purp-900">Billing &amp; Subscription</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Manage your subscription plan and view payment history.
        </p>
      </div>

      <Card className="border-2 border-purp-200 shadow-none overflow-hidden">
        <div className="bg-purp-50 p-6 border-b border-purp-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-purp-900">{planLabel}</h2>
              {!isStarter && statusBadge}
            </div>
            {isStarter ? (
              <p className="text-neutral-600">Upgrade to a paid plan to manage billing.</p>
            ) : (
              <p className="text-neutral-600 text-lg">
                {planPrice} <span className="text-sm text-neutral-400">/ month</span>
              </p>
            )}
          </div>
          
          <div className="flex flex-col gap-3 w-full md:w-auto">
            {isStarter ? (
              <Link href="/settings/upgrade/individual" className={cn(buttonVariants({ variant: "default" }), "bg-purp-900 hover:bg-purp-800 text-white w-full md:w-auto")}>
                Upgrade Plan
              </Link>
            ) : (
              <>
                <Button 
                  onClick={handleRenew} 
                  disabled={renewing}
                  className="bg-purp-900 hover:bg-purp-800 text-white w-full md:w-auto font-bold"
                >
                  {renewing ? "Initializing..." : `Renew Now — ${planPrice}`}
                </Button>
                {currentPlan === "individual" && (
                  <Link href="/settings/upgrade/corporate" className={cn(buttonVariants({ variant: "outline" }), "border-purp-200 text-purp-900 w-full md:w-auto")}>
                    Upgrade to Corporate — ₦20,000
                  </Link>
                )}
              </>
            )}
          </div>
        </div>

        {!isStarter && (
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              {statusStr === "Expired" ? (
                <AlertCircle className="text-red-500 w-5 h-5" />
              ) : statusStr === "Expiring Soon" ? (
                <Clock className="text-amber-500 w-5 h-5" />
              ) : (
                <CheckCircle className="text-green-500 w-5 h-5" />
              )}
              <span className="font-medium text-neutral-800">
                {statusStr === "Expired" ? "Expired on:" : "Renews on:"}{" "}
                {expiryDate.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
            
            {showUrgency && (
              <div className={`p-4 rounded-lg ${statusStr === "Cancelled" ? "bg-neutral-50 text-neutral-800 border border-neutral-200" : statusStr === "Expired" ? "bg-red-50 text-red-800 border border-red-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
                <p className="font-semibold flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  {statusStr === "Cancelled" ? "Your subscription has been cancelled." : statusStr === "Expired" ? "Your subscription has expired." : `${daysRemaining} days until renewal.`}
                </p>
                <p className="text-sm mt-1 opacity-90">
                  {statusStr === "Cancelled" 
                    ? "Your access has been deactivated by an administrator. Please renew your plan or contact support to restore access."
                    : statusStr === "Expired" 
                    ? "Renew now to restore access to PurpLedger's premium features including payment links and automated reminders." 
                    : "Please renew your subscription soon to avoid any interruption in your invoicing and collection services."}
                </p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {!isStarter && (
        <Card className="border-2 border-purp-200 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold text-purp-900">Billing History</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <div className="text-center py-8 bg-neutral-50 rounded-lg border border-dashed border-neutral-200">
                <p className="text-neutral-500">No payment history found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-neutral-500 uppercase bg-purp-50">
                    <tr>
                      <th className="px-4 py-3 rounded-tl-lg">Date</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Period</th>
                      <th className="px-4 py-3">Reference</th>
                      <th className="px-4 py-3 rounded-tr-lg">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((record) => (
                      <tr key={record.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                        <td className="px-4 py-4 font-medium text-neutral-900">
                          {new Date(record.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-4 capitalize">{record.plan}</td>
                        <td className="px-4 py-4">{formatNaira(record.amount_ngn)}</td>
                        <td className="px-4 py-4 text-neutral-600 text-xs">
                          {new Date(record.period_start).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })} – <br/>
                          {new Date(record.period_end).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-4">
                          <button 
                            onClick={() => copyToClipboard(record.paystack_ref)}
                            className="flex items-center gap-1 text-xs font-mono text-purp-600 hover:text-purp-900 bg-purp-50 px-2 py-1 rounded transition-colors"
                          >
                            {record.paystack_ref.substring(0, 8)}...
                            <Copy className="w-3 h-3" />
                            {copiedRef === record.paystack_ref && <span className="text-green-600 text-[10px] ml-1">Copied!</span>}
                          </button>
                        </td>
                        <td className="px-4 py-4">
                          {record.status === "paid" ? (
                            <span className="inline-flex items-center gap-1.5 py-1 px-2 rounded-full text-xs font-medium bg-green-50 text-green-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Paid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 py-1 px-2 rounded-full text-xs font-medium bg-red-50 text-red-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> Refunded
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
      )}
    </div>
  );
}
