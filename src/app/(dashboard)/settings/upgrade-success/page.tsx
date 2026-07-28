"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPlanDisplayName, normalizePlanCode } from "@/lib/plans";

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
  const normalizedPlan = normalizePlanCode(plan);
  const soloPlusFlow = normalizedPlan === "solo_plus";
  const planLabel = plan ? getPlanDisplayName(normalizedPlan) : "your selected";

  const [verifying, setVerifying] = useState(true);
  const [message, setMessage] = useState(
    soloPlusFlow
      ? "We are confirming your Solo Plus payment."
      : "We are confirming your upgrade payment.",
  );
  const [state, setState] = useState<"success" | "manual_review" | "error">("success");

  useEffect(() => {
    if (!reference) {
      setState("error");
      setMessage("We could not find your payment reference.");
      setVerifying(false);
      return;
    }

    const verifyUpgrade = async () => {
      try {
        const response = await fetch("/api/payment/verify-upgrade", {
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

        if (!response.ok || data.success === false) {
          setState(data.status === "manual_review" ? "manual_review" : "error");
          setMessage(data.message || data.error || "We could not confirm the upgrade automatically yet.");
          return;
        }

        setState("success");
        setMessage(
          data.message ||
            (soloPlusFlow
              ? "Payment received. Your Solo Plus case is now waiting for verification steps and review."
              : `Your account has been upgraded to the ${planLabel} plan.`),
        );
      } catch {
        setState("error");
        setMessage("We could not confirm the upgrade automatically yet.");
      } finally {
        setVerifying(false);
      }
    };

    void verifyUpgrade();
  }, [planLabel, provider, reference, soloPlusFlow]);

  const destination = soloPlusFlow ? "/settings/upgrade/solo_plus/status" : "/settings";

  return (
    <div className="max-w-md w-full rounded-2xl border border-purp-100 bg-white p-8 text-center shadow-xl">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
        <CheckCircle2 className="h-10 w-10 text-emerald-600" />
      </div>
      <h2 className="mt-6 text-2xl font-bold text-purp-900">
        {verifying
          ? "Confirming payment"
          : state === "manual_review"
          ? "Payment under review"
          : state === "error"
          ? "Upgrade verification needed"
          : soloPlusFlow
          ? "Payment received"
          : "Upgrade successful"}
      </h2>
      <p className="mt-3 text-lg text-neutral-600">{message}</p>
      <div className="mt-6 rounded-xl border border-purp-100 bg-purp-50 p-4 text-sm text-purp-800">
        {soloPlusFlow
          ? "Solo Plus still requires verification review after payment. Approval does not activate Solo Plus immediately."
          : "Your workflow, collection limits, and verification steps have been updated."}
      </div>
      <Button
        onClick={() => router.replace(destination)}
        className="mt-6 w-full bg-purp-900 text-white hover:bg-purp-800"
        disabled={verifying}
      >
        {soloPlusFlow ? "Open Solo Plus status" : "Return to settings"}
        {verifying ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <ArrowRight className="ml-2 h-4 w-4" />}
      </Button>
    </div>
  );
}

export default function UpgradeSuccessPage() {
  return (
    <div className="min-h-screen bg-purp-50 flex items-center justify-center p-4">
      <Suspense
        fallback={<Loader2 className="h-8 w-8 animate-spin text-purp-700" />}
      >
        <UpgradeSuccessContent />
      </Suspense>
    </div>
  );
}
