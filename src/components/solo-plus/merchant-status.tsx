"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Merchant } from "@/lib/types";
import { getMerchant } from "@/lib/data";
import type { SoloPlusBrowserCaseDto } from "@/lib/solo-plus/server/route-contracts";
import {
  getSoloPlusCheckoutPath,
  getSoloPlusMerchantStatusPresentation,
  getSoloPlusStatusPath,
  isSoloPlusOwnerEligible,
  shouldPollSoloPlusCase,
} from "@/lib/solo-plus/ui";
import { RequirementsChecklist } from "./requirements-checklist";
import { cn } from "@/lib/utils";

type MerchantWithAccess = Merchant & {
  currentUserRole?: string;
  permissions?: Record<string, boolean>;
};

type MerchantStatusProps = {
  flowOrigin: "onboarding" | "upgrade";
};

type CaseResponsePayload = {
  kind: string;
  case: SoloPlusBrowserCaseDto;
};

const ONBOARDING_CHECKOUT_STORAGE_KEY = "subscriptionCheckout";

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `solo-plus-ui-${crypto.randomUUID()}`;
  }

  return `solo-plus-ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getCreateStorageKey(flowOrigin: "onboarding" | "upgrade", onboardingSessionId: string | null) {
  return flowOrigin === "upgrade"
    ? "solo-plus:create:upgrade"
    : `solo-plus:create:onboarding:${onboardingSessionId || "missing"}`;
}

function readOnboardingSessionId() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(ONBOARDING_CHECKOUT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { sessionId?: unknown };
    return typeof parsed.sessionId === "string" && parsed.sessionId.trim() !== ""
      ? parsed.sessionId.trim()
      : null;
  } catch {
    return null;
  }
}

function getStoredIdempotencyKey(storageKey: string) {
  if (typeof window === "undefined") {
    return createIdempotencyKey();
  }

  const existing = window.sessionStorage.getItem(storageKey);
  if (existing && existing.trim() !== "") {
    return existing;
  }

  const created = createIdempotencyKey();
  window.sessionStorage.setItem(storageKey, created);
  return created;
}

function clearStoredIdempotencyKey(storageKey: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(storageKey);
}

function mapStatusError(code: string | null, flowOrigin: "onboarding" | "upgrade") {
  switch (code) {
    case "UNAUTHORIZED":
      return "Sign in again to continue this Solo Plus request.";
    case "FORBIDDEN":
      return "This upgrade is available only to the account owner.";
    case "NOT_FOUND":
      return flowOrigin === "upgrade"
        ? "No Solo Plus request is available yet for this workspace."
        : "No Solo Plus request is available from this onboarding session yet.";
    case "FEATURE_DISABLED":
      return "Solo Plus is not available right now.";
    case "STATE_CONFLICT":
      return "This Solo Plus request changed while you were viewing it. Refresh to continue.";
    default:
      return "We could not load the latest Solo Plus status right now.";
  }
}

function toneClasses(tone: "neutral" | "warning" | "success" | "danger") {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "danger":
      return "border-red-200 bg-red-50 text-red-900";
    default:
      return "border-slate-200 bg-slate-50 text-slate-900";
  }
}

export function MerchantSoloPlusStatus({ flowOrigin }: MerchantStatusProps) {
  const router = useRouter();
  const [merchant, setMerchant] = useState<MerchantWithAccess | null>(null);
  const [merchantLoaded, setMerchantLoaded] = useState(flowOrigin === "onboarding");
  const [caseData, setCaseData] = useState<SoloPlusBrowserCaseDto | null>(null);
  const [loadingCase, setLoadingCase] = useState(true);
  const [refreshingCase, setRefreshingCase] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const onboardingSessionId = useMemo(
    () => (flowOrigin === "onboarding" ? readOnboardingSessionId() : null),
    [flowOrigin],
  );

  const ownerEligible = isSoloPlusOwnerEligible({
    currentUserRole: merchant?.currentUserRole ?? null,
    subscriptionPlan: merchant?.subscription_plan ?? null,
  });

  const checkoutPath = getSoloPlusCheckoutPath(flowOrigin);
  const statusPath = getSoloPlusStatusPath(flowOrigin);

  async function loadCase(options?: { silent?: boolean }) {
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    setError(null);
    if (options?.silent) {
      setRefreshingCase(true);
    } else {
      setLoadingCase(true);
    }

    try {
      const params = new URLSearchParams();
      if (flowOrigin === "onboarding" && onboardingSessionId) {
        params.set("onboardingSessionId", onboardingSessionId);
      }

      const requestUrl = params.size > 0
        ? `/api/solo-plus/case?${params.toString()}`
        : "/api/solo-plus/case";
      const response = await fetch(requestUrl, { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        case?: SoloPlusBrowserCaseDto;
      };

      if (response.status === 404) {
        setCaseData(null);
        return;
      }

      if (!response.ok || !payload.case) {
        setError(mapStatusError(typeof payload.code === "string" ? payload.code : null, flowOrigin));
        return;
      }

      setCaseData(payload.case);
    } catch {
      setError("We could not load the latest Solo Plus status right now.");
    } finally {
      inFlightRef.current = false;
      setLoadingCase(false);
      setRefreshingCase(false);
    }
  }

  async function createOrResumeCase() {
    const storageKey = getCreateStorageKey(flowOrigin, onboardingSessionId);

    if (flowOrigin === "upgrade" && !ownerEligible) {
      setError("This upgrade is available only to the account owner.");
      return;
    }

    if (flowOrigin === "onboarding" && !onboardingSessionId) {
      setError("Continue from the same browser session you used for Solo Plus onboarding.");
      return;
    }

    setCreatingCase(true);
    setError(null);

    try {
      const response = await fetch("/api/solo-plus/case", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          flowOrigin,
          requestIdempotencyKey: getStoredIdempotencyKey(storageKey),
          onboardingSessionId: flowOrigin === "onboarding" ? onboardingSessionId : undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        case?: SoloPlusBrowserCaseDto;
      };

      if (!response.ok || !payload.case) {
        setError(mapStatusError(typeof payload.code === "string" ? payload.code : null, flowOrigin));
        return;
      }

      setCaseData(payload.case);
      clearStoredIdempotencyKey(storageKey);
      await loadCase({ silent: true });
    } catch {
      setError("We could not prepare the Solo Plus request right now. Try again without refreshing so the same request can be recovered.");
    } finally {
      setCreatingCase(false);
    }
  }

  useEffect(() => {
    let active = true;

    if (flowOrigin === "upgrade") {
      getMerchant()
        .then((value) => {
          if (!active) {
            return;
          }
          setMerchant(value as MerchantWithAccess | null);
        })
        .finally(() => {
          if (active) {
            setMerchantLoaded(true);
          }
        });
      return () => {
        active = false;
      };
    }

    return () => {
      active = false;
    };
  }, [flowOrigin]);

  useEffect(() => {
    if (!merchantLoaded) {
      return;
    }

    if (flowOrigin === "upgrade" && merchant && !ownerEligible) {
      setLoadingCase(false);
      return;
    }

    void loadCase();
  }, [flowOrigin, merchant, merchantLoaded, ownerEligible]);

  useEffect(() => {
    if (!caseData || !shouldPollSoloPlusCase(caseData)) {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }

      void loadCase({ silent: true });
    }, 15000);

    return () => window.clearInterval(interval);
  }, [caseData]);

  const statusPresentation = caseData
    ? getSoloPlusMerchantStatusPresentation(caseData)
    : null;

  const showPaymentAction = caseData
    ? caseData.caseStatus === "awaiting_payment" || caseData.paymentStatus !== "paid"
    : false;

  if (!merchantLoaded || loadingCase) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading Solo Plus status...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (flowOrigin === "upgrade" && merchant && !ownerEligible) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3 text-amber-700">
            <ShieldAlert className="h-5 w-5" />
            <h1 className="text-xl font-semibold text-foreground">Solo Plus is owner only</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            This upgrade is available only to the account owner.
          </p>
          <Link href="/settings/billing">
            <Button variant="outline">Back to billing</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!caseData) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-violet-600" />
              Solo Plus review
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Solo Plus uses a reviewed setup flow. We create one case, reuse it safely if you return, and keep payment, verification, approval, and activation separate.
            </p>
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void createOrResumeCase()} disabled={creatingCase}>
                {creatingCase ? "Preparing Solo Plus review..." : "Start or resume Solo Plus review"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={() => router.push(checkoutPath)}>
                <CreditCard className="mr-2 h-4 w-4" />
                Continue to payment
              </Button>
            </div>
            {flowOrigin === "onboarding" && !onboardingSessionId ? (
              <p className="text-xs text-muted-foreground">
                Sign in from the same browser you used for Solo Plus onboarding to continue from the saved onboarding session.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className={cn("border-2", statusPresentation ? toneClasses(statusPresentation.tone) : "border-border")}>
        <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-2xl">{statusPresentation?.heading}</CardTitle>
              {statusPresentation ? (
                <span className="inline-flex rounded-full border border-current/20 bg-white/70 px-2.5 py-1 text-xs font-semibold">
                  {statusPresentation.badge}
                </span>
              ) : null}
            </div>
            <p className="max-w-2xl text-sm text-current/80" aria-live="polite">
              {statusPresentation?.description}
            </p>
            {statusPresentation?.showReason && caseData.merchantVisibleReason ? (
              <div className="rounded-xl border border-current/20 bg-white/70 px-4 py-3 text-sm text-current">
                {caseData.merchantVisibleReason}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {showPaymentAction ? (
              <Button onClick={() => router.push(checkoutPath)}>
                <CreditCard className="mr-2 h-4 w-4" />
                Continue to payment
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void loadCase({ silent: true })}
              disabled={refreshingCase}
            >
              {refreshingCase ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh status
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-white/60 bg-white/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Payment
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {caseData.paymentStatus === "paid"
                ? "Payment received"
                : caseData.paymentStatus === "failed"
                ? "Payment required"
                : "Payment pending"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Review
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {statusPresentation?.badge}
            </p>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Activation
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {caseData.activationState === "activated"
                ? "Active"
                : caseData.activationState === "approved_pending_activation"
                ? "Activation pending"
                : "Not active"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/60 bg-white/70 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Updated
            </p>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {new Date(caseData.statusChangedAt || caseData.updatedAt).toLocaleString("en-NG", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <RequirementsChecklist caseData={caseData} onCaseRefresh={() => loadCase({ silent: true })} />

      <Card>
        <CardHeader>
          <CardTitle>What happens next?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Solo Plus keeps payment, verification, approval, and activation separate. Payment does not approve the request, and approval does not activate Solo Plus immediately.
          </p>
          <p>
            If you need to return later, open this page again from{" "}
            <Link href={statusPath} className="font-medium text-foreground underline">
              your Solo Plus status
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
