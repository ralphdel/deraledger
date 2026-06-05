"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

function PaymentCallbackContent() {
  const params = useSearchParams();
  const ref =
    params.get("reference") ||
    params.get("trxref") ||
    params.get("paymentReference") ||
    params.get("transactionReference");
  const provider = params.get("provider") || undefined;
  const [status, setStatus] = useState<"verifying" | "success" | "manual_review" | "error">("verifying");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!ref) {
      queueMicrotask(() => {
        setStatus("error");
        setMessage("We could not find your payment reference. If you already paid, use the continuation email or request a new setup link.");
      });
      return;
    }

    const verifyPayment = async () => {
      try {
        const res = await fetch("/api/onboarding/verify-and-provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: ref, provider }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setStatus("success");
          setMessage(data.message || "Payment received. Continue account setup from the email we sent you.");
        } else if (data.status === "manual_review") {
          setStatus("manual_review");
          setMessage(data.message || "Payment was received but needs manual review before activation.");
        } else {
          setStatus("error");
          setMessage(data.error || data.message || "We could not confirm your setup automatically yet.");
        }
      } catch (err) {
        console.error("Provisioning error:", err);
        setStatus("error");
        setMessage("We could not confirm your setup automatically yet. If payment was completed, use the continuation email or request a new setup link.");
      }
    };

    void verifyPayment();
  }, [provider, ref]);

  if (status === "verifying") {
    return (
      <div className="min-h-screen flex flex-col gap-3 items-center justify-center bg-purp-50">
        <Loader2 className="w-8 h-8 animate-spin text-purp-700" />
        <p className="text-sm text-purp-700 font-medium">Verifying your payment...</p>
      </div>
    );
  }

  const iconClasses =
    status === "success"
      ? "bg-emerald-100 text-emerald-600"
      : status === "manual_review"
        ? "bg-amber-100 text-amber-600"
        : "bg-red-100 text-red-600";

  return (
    <div className="min-h-screen bg-purp-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl p-10 shadow-sm border border-purp-100 max-w-md w-full text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${iconClasses}`}>
          {status === "success" ? <CheckCircle2 className="w-8 h-8" /> : <AlertCircle className="w-8 h-8" />}
        </div>

        {status === "success" ? (
          <>
            <h1 className="text-2xl font-bold text-purp-900 mb-2">Payment Received!</h1>
            <p className="text-neutral-500 text-sm mb-6">
              {message || "Your subscription is confirmed. We&apos;ve sent a welcome email to your inbox with a link to set your password and activate your account."}
            </p>
            <div className="bg-purp-50 border border-purp-100 rounded-lg p-4 mb-6 text-sm text-purp-700">
              <p className="font-medium">Check your email inbox</p>
              <p className="text-xs text-purp-500 mt-1">
                The email may take 1-2 minutes to arrive. Check your spam folder if you do not see it.
              </p>
            </div>
            <Link href="/login">
              <Button className="w-full bg-purp-900 hover:bg-purp-700 text-white">
                Go to Login
              </Button>
            </Link>
          </>
        ) : status === "manual_review" ? (
          <>
            <h1 className="text-2xl font-bold text-purp-900 mb-2">Payment Under Review</h1>
            <p className="text-neutral-500 text-sm mb-6">
              {message}
            </p>
            <Link href="/onboarding/resend">
              <Button className="w-full bg-purp-900 hover:bg-purp-700 text-white">
                Request Setup Link
              </Button>
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-purp-900 mb-2">Setup Needs Attention</h1>
            <p className="text-neutral-500 text-sm mb-6">
              {message}
            </p>
            <Link href="/onboarding/resend">
              <Button className="w-full bg-purp-900 hover:bg-purp-700 text-white">
                Continue Setup
              </Button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-purp-50">
          <Loader2 className="w-8 h-8 animate-spin text-purp-700" />
        </div>
      }
    >
      <PaymentCallbackContent />
    </Suspense>
  );
}
