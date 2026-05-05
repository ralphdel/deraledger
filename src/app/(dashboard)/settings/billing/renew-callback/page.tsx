"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

function RenewCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("Verifying your payment...");

  useEffect(() => {
    const reference = searchParams.get("reference") || searchParams.get("trxref");

    if (!reference) {
      setStatus("error");
      setMessage("No payment reference found. Redirecting to billing...");
      setTimeout(() => { window.location.href = "/settings/billing"; }, 2500);
      return;
    }

    // Call verify-renew to provision the subscription
    fetch("/api/payment/verify-renew", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setStatus("success");
          if (data.already_processed) {
            setMessage("Payment already processed. Your subscription is active!");
          } else {
            setMessage(
              `Subscription renewed successfully! Your plan is active until ${data.expiry_date ? new Date(data.expiry_date).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" }) : "your next billing date"}.`
            );
          }
          // Use window.location.href (NOT router.replace) to force a FULL PAGE RELOAD.
          // This is critical — router.replace is a client-side nav that keeps the
          // DashboardLayout mounted with its stale 'expired' subscription state.
          // A hard reload forces the layout to re-fetch and get the new 'active' status.
          setTimeout(() => { window.location.href = "/settings/billing"; }, 2800);
        } else {
          setStatus("error");
          setMessage(data.error || "Payment verification failed. Please contact support.");
          setTimeout(() => { window.location.href = "/settings/billing"; }, 4000);
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("An unexpected error occurred. Redirecting to billing...");
        setTimeout(() => { window.location.href = "/settings/billing"; }, 3000);
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="text-center max-w-md mx-auto px-6">
        {status === "verifying" && (
          <>
            <div className="h-16 w-16 rounded-full bg-purp-100 flex items-center justify-center mx-auto mb-5">
              <Loader2 className="h-8 w-8 text-purp-600 animate-spin" />
            </div>
            <h1 className="text-xl font-bold text-neutral-900 mb-2">Confirming Payment</h1>
            <p className="text-neutral-500 text-sm">{message}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <h1 className="text-xl font-bold text-neutral-900 mb-2">Renewal Confirmed!</h1>
            <p className="text-neutral-600 text-sm leading-relaxed">{message}</p>
            <p className="text-xs text-neutral-400 mt-4">Redirecting you to your dashboard...</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-5">
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
            <h1 className="text-xl font-bold text-neutral-900 mb-2">Verification Issue</h1>
            <p className="text-neutral-600 text-sm leading-relaxed">{message}</p>
            <p className="text-xs text-neutral-400 mt-4">Redirecting to billing page...</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function RenewCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purp-600" />
      </div>
    }>
      <RenewCallbackContent />
    </Suspense>
  );
}
