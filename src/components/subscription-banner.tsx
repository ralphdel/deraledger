"use client";

import { AlertTriangle, Clock, Rocket } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function SubscriptionBanner({ 
  daysRemaining, 
  planType,
  status
}: { 
  daysRemaining: number; 
  planType: string;
  status?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // ── Starter Plan Banner ─────────────────────────────────────────────────
  if (planType === "starter") {
    return (
      <div className="sticky top-0 z-[40] w-full px-4 py-3 flex items-center justify-between text-sm md:text-base font-medium shadow-lg bg-gradient-to-r from-purp-800 via-purp-900 to-indigo-900 text-white animate-in slide-in-from-top-2">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-amber-400 animate-pulse" />
          <span>
            You&apos;re on the <strong>Starter</strong> plan.{" "}
            <span className="hidden sm:inline">Upgrade to start receiving live payments and unlock premium features.</span>
          </span>
        </div>
        <Link 
          href="/settings/billing" 
          className="px-4 py-1.5 rounded-md text-sm font-bold transition-all shadow-sm whitespace-nowrap bg-amber-500 hover:bg-amber-400 text-neutral-900 hover:shadow-md"
        >
          Upgrade Now
        </Link>
      </div>
    );
  }

  // ── Expiry / Cancellation Banners ───────────────────────────────────────
  const isCancelled = status === "cancelled";
  const isExpired = status === "expired" || daysRemaining <= 0;
  const isUrgent = daysRemaining <= 3 && daysRemaining > 0;
  const isWarning = daysRemaining <= 7 && daysRemaining > 3;

  if (!isCancelled && !isExpired && !isUrgent && !isWarning) return null;

  const renewalDate = new Date();
  renewalDate.setDate(renewalDate.getDate() + Math.max(0, daysRemaining));
  const dateStr = renewalDate.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
  
  const planName = planType.charAt(0).toUpperCase() + planType.slice(1);

  let bgColor = "bg-amber-50 text-amber-900 border-b border-amber-200";
  let buttonColor = "bg-amber-600 hover:bg-amber-700 text-white";
  let message = `Your ${planName} plan renews in ${daysRemaining} days on ${dateStr}. Renew now to avoid interruption.`;
  let Icon = Clock;

  if (isCancelled) {
    bgColor = "bg-neutral-900 text-white border-b border-neutral-800";
    buttonColor = "bg-purp-600 hover:bg-purp-500 text-white";
    message = "Your Deraledger account is currently deactivated by an administrator.";
    Icon = AlertTriangle;
  } else if (isExpired) {
    bgColor = "bg-red-50 text-red-900 border-b border-red-200";
    buttonColor = "bg-red-600 hover:bg-red-700 text-white";
    message = "Your subscription has expired. Renew now to restore full access.";
    Icon = AlertTriangle;
  } else if (isUrgent) {
    bgColor = "bg-red-50 text-red-900 border-b border-red-200";
    buttonColor = "bg-red-600 hover:bg-red-700 text-white";
    message = `URGENT — Your subscription expires in ${daysRemaining} days on ${dateStr}. Renew now to keep your payment links and team access active.`;
    Icon = AlertTriangle;
  }

  return (
    <div className={`sticky top-0 z-[40] w-full px-4 py-3 flex items-center justify-between text-sm md:text-base font-medium shadow-md animate-in slide-in-from-top-2 ${bgColor}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-5 w-5 ${isCancelled ? "text-purp-400" : isWarning ? "text-amber-600" : "text-red-600"}`} />
        <span>{message}</span>
      </div>
      <Link 
        href="/settings/billing" 
        className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-colors shadow-sm whitespace-nowrap ${buttonColor}`}
      >
        {isCancelled ? "View Billing" : "Renew Now"}
      </Link>
    </div>
  );
}
