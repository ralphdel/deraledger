"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

function PaymentCallbackContent() {
  const params = useSearchParams();
  const reference =
    params.get("reference") ||
    params.get("trxref") ||
    params.get("paymentReference") ||
    params.get("transactionReference");
  const provider = params.get("provider") || undefined;

  const [status, setStatus] = useState<"verifying" | "success" | "manual_review" | "error">("verifying");
  const [message, setMessage] = useState("");
  const [soloPlusFlow, setSoloPlusFlow] = useState(false);

  useEffect(() => {
    if (!reference) {
      setStatus("error");
      setMessage("We could not find your payment reference. If you already paid, request a fresh continuation link.");
      return;
    }

    const verifyPayment = async () => {
      try {
        const response = await fetch("/api/onboarding/verify-and-provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference, provider }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          status?: string;
          message?: string;
          error?: string;
        };

        const isSoloPlus = data.status === "verification_pending";
        setSoloPlusFlow(isSoloPlus);

        if (response.ok && data.success) {
          setStatus("success");
          setMessage(
            data.message ||
              (isSoloPlus
                ? "Payment received. Your Solo Plus case is waiting for verification steps and review after you sign in."
                : "Payment received. Continue account setup from the email we sent you."),
          );
          return;
        }

        if (data.status === "manual_review") {
          setStatus("manual_review");
          setMessage(data.message || "Payment was received but needs manual review before activation.");
          return;
        }

        setStatus("error");
        setMessage(data.error || data.message || "We could not confirm your setup automatically yet.");
      } catch {
        setStatus("error");
        setMessage("We could not confirm your setup automatically yet. If payment was completed, request a fresh continuation link.");
      }
    };

    void verifyPayment();
  }, [provider, reference]);

  if (status === "verifying") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-purp-50">
        <Loader2 className="h-8 w-8 animate-spin text-purp-700" />
        <p className="text-sm font-medium text-purp-700">Verifying your payment...</p>
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
      <div className="max-w-md w-full rounded-2xl border border-purp-100 bg-white p-10 text-center shadow-sm">
        <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${iconClasses}`}>
          {status === "success" ? <CheckCircle2 className="h-8 w-8" /> : <AlertCircle className="h-8 w-8" />}
        </div>

        <h1 className="mb-2 text-2xl font-bold text-purp-900">
          {status === "success"
            ? soloPlusFlow
              ? "Payment received"
              : "Payment received"
            : status === "manual_review"
            ? "Payment under review"
            : "Setup needs attention"}
        </h1>

        <p className="mb-6 text-sm text-neutral-500">{message}</p>

        {status === "success" && soloPlusFlow ? (
          <div className="mb-6 rounded-lg border border-purp-100 bg-purp-50 p-4 text-left text-sm text-purp-800">
            <p className="font-medium">What happens next</p>
            <p className="mt-2 text-xs text-purp-600">
              Sign in after setting your password, then continue from the Solo Plus status experience in your workspace. Payment does not approve or activate Solo Plus by itself.
            </p>
          </div>
        ) : status === "success" ? (
          <div className="mb-6 rounded-lg border border-purp-100 bg-purp-50 p-4 text-sm text-purp-700">
            <p className="font-medium">Check your email inbox</p>
            <p className="mt-1 text-xs text-purp-500">
              The email may take 1-2 minutes to arrive. Check your spam folder if you do not see it.
            </p>
          </div>
        ) : null}

        <div className="space-y-3">
          <Link href="/login">
            <Button className="w-full bg-purp-900 text-white hover:bg-purp-700">
              Go to Login
            </Button>
          </Link>
          <Link href="/onboarding/resend">
            <Button variant="outline" className="w-full">
              Request continuation link
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-purp-50">
          <Loader2 className="h-8 w-8 animate-spin text-purp-700" />
        </div>
      }
    >
      <PaymentCallbackContent />
    </Suspense>
  );
}
