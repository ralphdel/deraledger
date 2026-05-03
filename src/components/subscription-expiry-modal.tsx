"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function SubscriptionExpiryModal({
  status,
  expiryDate,
}: {
  status: string;
  expiryDate: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    if (status === "expired" || status === "cancelled") {
      const expiry = new Date(expiryDate);
      const now = new Date();
      
      // Calculate Grace Period
      const hoursSinceExpiry = (now.getTime() - expiry.getTime()) / (1000 * 60 * 60);
      
      // If cancelled OR past 24h grace period, show the hard modal.
      const hasSeenSession = sessionStorage.getItem("purpledger_expiry_seen");
      
      if (status === "cancelled" || hoursSinceExpiry > 24) {
        setIsOpen(true); // Hard lock
      } else if (!hasSeenSession) {
        setIsOpen(true); // Show once if in grace period
        sessionStorage.setItem("purpledger_expiry_seen", "true");
      }
    }
  }, [status, expiryDate]);

  if (!mounted || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 sm:p-8 animate-in zoom-in-95 relative">
        <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="w-6 h-6" />
        </div>
        
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {status === "cancelled" ? "Subscription Deactivated" : "Subscription Expired"}
        </h2>
        
        <p className="text-gray-600 mb-8 leading-relaxed">
          {status === "cancelled" 
            ? "Your PurpLedger subscription has been deactivated by an administrator. You no longer have access to invoicing, PurpBot AI, or team management tools." 
            : "Your PurpLedger subscription has expired. You currently have restricted access to your dashboard and cannot create new invoices or accept payments."
          }
          Please renew your plan to restore full access.
        </p>

        <div className="flex flex-col gap-3">
          <Link 
            href="/settings/billing" 
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg text-center transition-colors shadow-sm"
            onClick={() => setIsOpen(false)}
          >
            Renew / Upgrade Plan
          </Link>
          {status !== "cancelled" && (
            <button 
              onClick={() => setIsOpen(false)}
              className="w-full bg-white hover:bg-gray-50 text-gray-600 font-medium py-3 px-4 rounded-lg text-center transition-colors border border-gray-200"
            >
              View Dashboard (Read-Only)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
