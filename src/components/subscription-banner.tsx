"use client";

import { AlertTriangle, Clock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function SubscriptionBanner({ 
  daysRemaining, 
  planType 
}: { 
  daysRemaining: number; 
  planType: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || daysRemaining > 7) return null;

  const isUrgent = daysRemaining <= 2;

  return (
    <div className={`w-full text-white px-4 py-3 flex items-center justify-between text-sm md:text-base font-medium shadow-md animate-in slide-in-from-top-2 ${isUrgent ? "bg-red-600" : "bg-purple-600"}`}>
      <div className="flex items-center gap-2">
        {isUrgent ? <AlertTriangle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
        <span>
          {isUrgent 
            ? `Urgent: Your ${planType} plan expires in ${Math.max(1, daysRemaining)} days. Avoid service interruption.` 
            : `Your PurpLedger ${planType} plan expires in ${daysRemaining} days. Renew now to keep your team access.`}
        </span>
      </div>
      <Link 
        href="/settings/subscription" 
        className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
          isUrgent 
            ? "bg-white text-red-600 hover:bg-red-50" 
            : "bg-white text-purple-600 hover:bg-purple-50"
        }`}
      >
        Renew Now
      </Link>
    </div>
  );
}
