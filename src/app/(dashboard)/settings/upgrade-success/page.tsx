"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function UpgradeSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan");
  const reference =
    searchParams.get("reference") ||
    searchParams.get("trxref") ||
    searchParams.get("paymentReference") ||
    searchParams.get("transactionReference");
  const provider = searchParams.get("provider") || undefined;
  const planLabel =
    plan === "corporate"
      ? "Business"
      : plan === "individual"
        ? "Individual / Collections"
        : "your selected";
  
  const [countdown, setCountdown] = useState(5);
  const [verifying, setVerifying] = useState(true);
  const [state, setState] = useState<"success" | "manual_review" | "error">("success");
  const [message, setMessage] = useState("Your account has been upgraded to the selected plan.");

  useEffect(() => {
    if (!reference) {
      queueMicrotask(() => {
        setState("error");
        setMessage("We could not find your payment reference.");
        setVerifying(false);
      });
      return;
    }

    // Verify upgrade in case webhook delayed/missed (local testing especially)
    const verifyUpgrade = async () => {
      try {
        const response = await fetch("/api/payment/verify-upgrade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference, provider }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
          setState(data.status === "manual_review" ? "manual_review" : "error");
          setMessage(data.message || data.error || "We could not confirm the upgrade automatically yet.");
        } else {
          setState("success");
        }
      } catch (e) {
        console.error("Failed to proactively verify upgrade:", e);
        setState("error");
        setMessage("We could not confirm the upgrade automatically yet.");
      } finally {
        setVerifying(false);
      }
    };
    verifyUpgrade();

    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [provider, reference, router]);

  useEffect(() => {
    if (countdown === 0 && !verifying && state === "success") {
      router.replace("/settings");
    }
  }, [countdown, verifying, router, state]);

  if (!reference) return null;

  return (
    <div className="max-w-md w-full bg-white rounded-2xl shadow-xl border border-purp-100 p-8 text-center space-y-6">
      <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
        <CheckCircle2 className="w-10 h-10 text-emerald-600" />
      </div>
      <h2 className="text-2xl font-bold text-purp-900">
        {state === "manual_review" ? "Upgrade Under Review" : state === "error" ? "Upgrade Verification Needed" : "Upgrade Successful!"}
      </h2>
      <p className="text-neutral-600 text-lg">
        {state === "success"
          ? <>Your account has been upgraded to the <span className="font-bold text-purp-900">{planLabel}</span> plan.</>
          : message}
      </p>
      <div className="bg-purp-50 border border-purp-100 p-4 rounded-xl text-sm text-purp-800">
        {state === "success"
          ? "Your workflow, collection limits, and verification steps have been updated."
          : "We saved your payment reference and will continue from the recorded payment state instead of asking you to pay again."}
      </div>
      <Button 
        onClick={() => router.replace("/settings")}
        className="w-full bg-purp-900 hover:bg-purp-800 text-white"
      >
        {state === "success" ? `Return to Settings (${countdown}s)` : "Return to Settings"}
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}

export default function UpgradeSuccessPage() {
  return (
    <div className="min-h-screen bg-purp-50 flex items-center justify-center p-4">
      <Suspense fallback={
        <Loader2 className="w-8 h-8 animate-spin text-purp-700" />
      }>
        <UpgradeSuccessContent />
      </Suspense>
    </div>
  );
}
