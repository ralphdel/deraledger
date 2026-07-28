"use client";

import { useEffect, useState, useRef } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, CreditCard, ArrowRightLeft, Bitcoin,
  Loader2, ShieldCheck, Lock, Copy, Check, Building2, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getUpgradeCheckoutSessionKey,
  parseUpgradeCheckoutResponse,
  UnsupportedCheckoutCompletionModeError,
  type UpgradeCheckoutResponse,
} from "@/lib/checkout/provider-completion";
import {
  PaystackCheckoutSdkError,
  resumePaystackCheckout,
} from "@/lib/checkout/paystack-inline";
import { getMerchant } from "@/lib/data";
import type { Merchant } from "@/lib/types";
import {
  getUpgradeCheckoutDisabledReason,
  isPlaceholderOwnerName,
  selectUpgradePaymentMethod,
} from "@/lib/checkout/upgrade-rules";
import { isSoloPlusOwnerEligible } from "@/lib/solo-plus/ui";

const PLAN_CONFIG: Record<string, {
  label: string; price: string; priceKobo: number; interval: string;
  verification: string; features: string[];
  icon: typeof User; color: string;
}> = {
  individual: {
    label: "Solo Lite", price: "NGN 5,000", priceKobo: 500000, interval: "/month",
    verification: "BVN & Selfie required",
    features: ["Collection invoices enabled", "Online payment collection", "Grouped references & deposits", "Partial payment controls", "₦5M monthly collection limit", "20 active collection invoices"],
    icon: User, color: "from-[#1A0B2E] to-[#3D0B66]",
  },
  solo_plus: {
    label: "Solo Plus", price: "NGN 13,000", priceKobo: 1300000, interval: "/month",
    verification: "Identity verification required",
    features: [
      "Higher reviewed collection capacity",
      "Requirement checklist and review-state tracking",
      "Structured activity profile submission",
      "Evidence reuse only in this launch",
      "No direct document uploads",
      "No activation controls",
    ],
    icon: User, color: "from-[#2A1033] to-[#5E1F66]",
  },
  corporate: {
    label: "Business", price: "NGN 20,000", priceKobo: 2000000, interval: "/month",
    verification: "Business & authority checks required",
    features: ["Unlimited collection invoices", "Custom Role-Based Access (RBAC)", "Grouped receivables", "Advanced analytics", "No watermark", "White-label invoices"],
    icon: Building2, color: "from-[#0B0314] to-[#12061F]",
  },
  business: {
    label: "Business", price: "NGN 20,000", priceKobo: 2000000, interval: "/month",
    verification: "Business & authority checks required",
    features: ["Unlimited collection invoices", "Custom Role-Based Access (RBAC)", "Grouped receivables", "Advanced analytics", "No watermark", "White-label invoices"],
    icon: Building2, color: "from-[#0B0314] to-[#12061F]",
  },
};

type Tab = "card" | "bank_transfer" | "ussd" | "crypto";
type AvailableMethod = {
  method: Tab;
  label: string;
  description: string;
  enabled: boolean;
  provider: "paystack" | "monnify" | "breet";
  fallbackProvider: "paystack" | "monnify" | "breet" | null;
};

type MerchantWithAccess = Merchant & {
  currentUserRole?: string;
};

type CryptoCheckoutStatus = {
  status: "waiting_for_payment" | "awaiting_provider_completion" | "completed" | "failed" | "expired" | "manual_review";
  message: string;
  providerReference?: string | null;
  paymentSessionId?: string | null;
  shortfallAmount?: number | null;
  overpaymentAmount?: number | null;
};

type CryptoCheckoutDetails = {
  address: string;
  network: string;
  coin: string;
  fiatAmount: number;
  cryptoAmount: number | null;
  exchangeRate: number | null;
  quoteSource: string | null;
  providerQuoteAvailable: boolean;
  reference: string;
  providerReference: string | null;
  paymentSessionId: string | null;
  expiresAt: string | null;
};

type UpgradeApiErrorPayload = {
  error?: unknown;
  code?: unknown;
  requestId?: unknown;
};

type RecoveryPromptState = {
  requestId: string | null;
  recoveryRequestIdempotencyKey: string;
};

type CheckoutNoticeState = {
  title: string;
  message: string;
  guidance?: string;
  requestId?: string | null;
  action?: "open_checkout_again";
};

interface UpgradeCheckoutPageProps {
  params: Promise<{ plan: string }>;
}

function UpgradeCheckoutContent({ plan }: { plan: string }) {
  const router = useRouter();
  const config = PLAN_CONFIG[plan];
  const Icon = config?.icon ?? User;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loadingMerchant, setLoadingMerchant] = useState(true);
  const [tab, setTab] = useState<Tab>("card");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cryptoDetails, setCryptoDetails] = useState<CryptoCheckoutDetails | null>(null);
  const [cryptoCheckoutStatus, setCryptoCheckoutStatus] = useState<CryptoCheckoutStatus | null>(null);
  const [availableMethods, setAvailableMethods] = useState<AvailableMethod[]>([]);
  const [paymentMethodsLoaded, setPaymentMethodsLoaded] = useState(false);
  const [paymentMethodsError, setPaymentMethodsError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recoveryPrompt, setRecoveryPrompt] = useState<RecoveryPromptState | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<CheckoutNoticeState | null>(null);
  const [preservedCheckoutSession, setPreservedCheckoutSession] = useState<Extract<
    UpgradeCheckoutResponse,
    { completionMode: "paystack_resume" }
  > | null>(null);
  const [soloPlusAvailable, setSoloPlusAvailable] = useState(false);
  const [soloPlusAvailabilityLoaded, setSoloPlusAvailabilityLoaded] = useState(plan !== "solo_plus");
  const submittingRef = useRef(false);
  const openedCheckoutSessionRef = useRef<string | null>(null);
  const redirectStartedRef = useRef(false);
  const cryptoStorageKey = `breet-upgrade-crypto:${plan}`;
  // ownerName + businessType are read from sessionStorage (set by upgrade settings page)
  const [ownerName, setOwnerName] = useState("");
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [relationshipClaim, setRelationshipClaim] = useState<"owner_affiliated_claim" | "representative_claim" | null>(null);
  const [verificationDisclosureAccepted, setVerificationDisclosureAccepted] = useState(false);
  const [disclosureVersion, setDisclosureVersion] = useState("1.0");
  const checkingPlanAvailability = plan === "solo_plus" && !soloPlusAvailabilityLoaded;
  const planAvailable = plan !== "solo_plus" || soloPlusAvailable;

  useEffect(() => {
    if (plan !== "solo_plus") {
      return;
    }

    let active = true;
    fetch(`/api/plans/availability?plan=${plan}`)
      .then((res) => res.json())
      .then((payload) => {
        if (!active) return;
        setSoloPlusAvailable(payload?.available === true);
        setSoloPlusAvailabilityLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setSoloPlusAvailable(false);
        setSoloPlusAvailabilityLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [plan]);

  useEffect(() => {
    if (plan === "solo_plus" && !soloPlusAvailabilityLoaded) {
      return;
    }
    if (plan === "solo_plus" && !soloPlusAvailable) {
      setLoadingMerchant(false);
      return;
    }

    let storedOwnerName: string | null = null;
    const stored = sessionStorage.getItem("upgradeCheckout");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        storedOwnerName = typeof parsed.ownerName === "string" ? parsed.ownerName : "";
        setOwnerName(storedOwnerName ?? "");
        setBusinessType(typeof parsed.businessType === "string" ? parsed.businessType : null);
        setRelationshipClaim(parsed.relationshipClaim || null);
        setVerificationDisclosureAccepted(parsed.verificationDisclosureAccepted === true);
        setDisclosureVersion(typeof parsed.disclosureVersion === "string" ? parsed.disclosureVersion : "1.0");
      } catch { /* ignore */ }
    }
    getMerchant()
      .then(m => {
        setMerchant(m);
        if (plan === "solo_plus" && !storedOwnerName?.trim() && m?.owner_name) {
          setOwnerName(m.owner_name);
        }
      })
      .finally(() => setLoadingMerchant(false));
    return () => {
    };
  }, [plan, soloPlusAvailabilityLoaded, soloPlusAvailable]);

  useEffect(() => {
    const raw = sessionStorage.getItem(cryptoStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        details?: CryptoCheckoutDetails | null;
        status?: CryptoCheckoutStatus | null;
      };
      const timer = window.setTimeout(() => {
        setCryptoDetails(parsed.details || null);
        setCryptoCheckoutStatus(parsed.status || null);
      }, 0);
      return () => window.clearTimeout(timer);
    } catch {
      sessionStorage.removeItem(cryptoStorageKey);
    }
  }, [cryptoStorageKey]);

  useEffect(() => {
    if (plan === "solo_plus" && !soloPlusAvailabilityLoaded) {
      return;
    }
    if (plan === "solo_plus" && !soloPlusAvailable) {
      setAvailableMethods([]);
      setPaymentMethodsLoaded(true);
      return;
    }

    const controller = new AbortController();
    setPaymentMethodsLoaded(false);
    setPaymentMethodsError(null);
    fetch(`/api/checkout/payment-methods?kind=upgrade&plan=${plan}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((payload) => {
        const methods = Array.isArray(payload?.availableMethods) ? payload.availableMethods as AvailableMethod[] : [];
        setAvailableMethods(methods);
        setTab((current) => selectUpgradePaymentMethod(current, methods) ?? current);
        setPaymentMethodsLoaded(true);
      })
      .catch(() => {
        setAvailableMethods([]);
        setPaymentMethodsError("Payment methods could not be loaded right now.");
        setPaymentMethodsLoaded(true);
      });
    return () => controller.abort();
  }, [plan, soloPlusAvailabilityLoaded, soloPlusAvailable]);

  useEffect(() => {
    if (!cryptoDetails) return;
    if (!availableMethods.some((method) => method.method === "crypto")) return;
    if (tab === "crypto") return;
    const timer = window.setTimeout(() => {
      setTab("crypto");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [availableMethods, cryptoDetails, tab]);

  useEffect(() => {
    if (!cryptoDetails) {
      sessionStorage.removeItem(cryptoStorageKey);
      return;
    }
    sessionStorage.setItem(cryptoStorageKey, JSON.stringify({
      details: cryptoDetails,
      status: cryptoCheckoutStatus,
    }));
  }, [cryptoCheckoutStatus, cryptoDetails, cryptoStorageKey]);

  useEffect(() => {
    if (cryptoCheckoutStatus?.status !== "completed" || !cryptoDetails) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(cryptoStorageKey);
      const reference = encodeURIComponent(cryptoDetails.reference || cryptoDetails.providerReference || "");
      router.replace(`/settings/upgrade-success?reference=${reference}&plan=${encodeURIComponent(plan)}&provider=breet`);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [cryptoCheckoutStatus?.status, cryptoDetails, cryptoStorageKey, plan, router]);

  useEffect(() => {
    if (!cryptoDetails?.reference && !cryptoDetails?.paymentSessionId) return;
    if (
      cryptoCheckoutStatus?.status === "completed" ||
      cryptoCheckoutStatus?.status === "failed" ||
      cryptoCheckoutStatus?.status === "expired" ||
      cryptoCheckoutStatus?.status === "manual_review"
    ) {
      return;
    }

    let active = true;
    const params = new URLSearchParams();
    if (cryptoDetails.paymentSessionId) {
      params.set("sessionId", cryptoDetails.paymentSessionId);
    } else if (cryptoDetails.reference) {
      params.set("reference", cryptoDetails.reference);
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/checkout/crypto-plan/status?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !active) return;
        setCryptoCheckoutStatus({
          status: payload.status,
          message: payload.message,
          providerReference: payload.providerReference || null,
          paymentSessionId: payload.sessionId || null,
          shortfallAmount: payload.shortfallAmount ?? null,
          overpaymentAmount: payload.overpaymentAmount ?? null,
        });
        setCryptoDetails((current) => current ? {
          ...current,
          address: payload.walletAddress || current.address,
          network: payload.network || current.network,
          coin: payload.asset || current.coin,
          fiatAmount: payload.expectedAmount ?? current.fiatAmount,
          cryptoAmount: payload.cryptoAmount ?? current.cryptoAmount,
          exchangeRate: payload.exchangeRate ?? current.exchangeRate,
          quoteSource: payload.quoteSource || current.quoteSource,
          providerQuoteAvailable: payload.providerQuoteAvailable ?? current.providerQuoteAvailable,
          providerReference: payload.providerReference || current.providerReference,
          paymentSessionId: payload.sessionId || current.paymentSessionId,
          expiresAt: payload.expiresAt || current.expiresAt,
        } : current);
      } catch {
        // keep visible state; polling will retry
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [cryptoCheckoutStatus?.status, cryptoDetails?.paymentSessionId, cryptoDetails?.reference]);

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#12061F]">
        <p className="text-white/60">Invalid plan. <Link href="/settings" className="text-[#B58CFF] underline">Go back</Link></p>
      </div>
    );
  }

  if (checkingPlanAvailability) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#12061F]">
        <div className="flex items-center gap-3 text-white/70">
          <Loader2 className="h-5 w-5 animate-spin text-[#B58CFF]" />
          Checking plan availability...
        </div>
      </div>
    );
  }

  if (!planAvailable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#12061F] px-6">
        <div className="max-w-md rounded-2xl border border-amber-400/30 bg-amber-400/10 p-6 text-center text-amber-100">
          <p className="text-lg font-semibold">This plan is not available right now.</p>
          <p className="mt-2 text-sm text-amber-50/80">Solo Plus is currently hidden until its feature flag is enabled.</p>
          <Link href="/settings/billing" className="mt-5 inline-block text-sm font-semibold text-white underline">
            Back to billing
          </Link>
        </div>
      </div>
    );
  }

  const selectedMethod = availableMethods.find((method) => method.method === tab) ?? null;
  const currentUserIsOwner = plan !== "solo_plus"
    ? true
    : isSoloPlusOwnerEligible({
        currentUserRole: (merchant as MerchantWithAccess | null)?.currentUserRole ?? null,
        subscriptionPlan: merchant?.subscription_plan ?? null,
      });
  const paymentMethodsLoading = !paymentMethodsLoaded;
  const checkoutDisabledReason = getUpgradeCheckoutDisabledReason({
    loadingMerchant,
    paymentMethodsLoading,
    availableMethods,
    selectedPaymentMethod: selectedMethod?.method ?? null,
    ownerName,
    relationshipClaim,
    verificationDisclosureAccepted,
    disclosureVersion,
    currentUserIsOwner,
    isSubmitting: loading,
  });
  const canSubmitPayment = checkoutDisabledReason === null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const parseUpgradeApiError = (payload: unknown) => {
    const candidate =
      typeof payload === "object" && payload !== null
        ? (payload as UpgradeApiErrorPayload)
        : null;
    const message =
      typeof candidate?.error === "string" && candidate.error.trim()
        ? candidate.error
        : "Failed to initialize payment.";
    const code =
      typeof candidate?.code === "string" && candidate.code.trim()
        ? candidate.code
        : null;
    const requestId =
      typeof candidate?.requestId === "string" && candidate.requestId.trim()
        ? candidate.requestId
        : null;

    return { message, code, requestId };
  };

  const clearCheckoutMessaging = () => {
    setError(null);
    setRecoveryPrompt(null);
    setCheckoutNotice(null);
  };

  const showCheckoutOpenFailure = (
    normalizedResponse: Extract<
      UpgradeCheckoutResponse,
      { completionMode: "paystack_resume" }
    >,
    sdkError: PaystackCheckoutSdkError,
  ) => {
    setPreservedCheckoutSession(normalizedResponse);
    setError(null);
    if (
      sdkError.code === "PAYSTACK_CHECKOUT_SDK_UNAVAILABLE" ||
      sdkError.code === "PAYSTACK_CHECKOUT_BROWSER_ONLY" ||
      sdkError.code === "PAYSTACK_CHECKOUT_ACCESS_CODE_MISSING"
    ) {
      setCheckoutNotice({
        title: "Checkout is temporarily unavailable",
        message:
          "We could not open the secure payment window. Please refresh the page and try again. Your current payment session has been preserved.",
        requestId: normalizedResponse.requestId,
        action: "open_checkout_again",
      });
      return;
    }

    setCheckoutNotice({
      title: "Checkout could not open",
      message:
        "Your payment session is ready, but the checkout window could not open. Please try opening it again. You will not need to start another payment attempt.",
      guidance: "Do not create another payment while this session is pending.",
      requestId: normalizedResponse.requestId,
      action: "open_checkout_again",
    });
  };

  const handleCheckoutError = (errorValue: unknown) => {
    if (errorValue instanceof PaystackCheckoutSdkError) {
      setError(null);
      return;
    }

    setError(
      errorValue instanceof UnsupportedCheckoutCompletionModeError
        ? "Checkout is temporarily unavailable. Please refresh the page and try again."
        : errorValue instanceof Error
          ? errorValue.message
          : "Something went wrong.",
    );
  };

  const handleFiatPayment = async (paymentMethod: Extract<Tab, "card" | "bank_transfer" | "ussd">) => {
    if (submittingRef.current) {
      return;
    }

    if (checkoutDisabledReason) {
      setError(checkoutDisabledReason);
      return;
    }

    submittingRef.current = true;
    clearCheckoutMessaging();
    setLoading(true);
    try {
      const res = await fetch("/api/payment/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPlan: plan,
          ownerName,
          businessType,
          relationshipClaim,
          verificationDisclosureAccepted,
          disclosureVersion,
          paymentMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const parsedError = parseUpgradeApiError(data);
        if (
          plan === "solo_plus" &&
          parsedError.code === "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED"
        ) {
          setRecoveryPrompt({
            requestId: parsedError.requestId,
            recoveryRequestIdempotencyKey:
              crypto.randomUUID(),
          });
          setCheckoutNotice(null);
          setLoading(false);
          submittingRef.current = false;
          return;
        }
        throw new Error(parsedError.message);
      }

      setRecoveryPrompt(null);
      setCheckoutNotice(null);
      const normalizedResponse = parseUpgradeCheckoutResponse(data);
      await completeProviderCheckout(normalizedResponse);
    } catch (e: unknown) {
      handleCheckoutError(e);
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleSoloPlusRecovery = async (
    paymentMethod: Extract<Tab, "card" | "bank_transfer" | "ussd">,
  ) => {
    if (submittingRef.current) {
      return;
    }

    if (!recoveryPrompt) {
      setError("A recoverable Solo Plus payment attempt was not found.");
      return;
    }

    submittingRef.current = true;
    setError(null);
    setCheckoutNotice(null);
    setLoading(true);

    try {
      const res = await fetch("/api/payment/upgrade/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPlan: plan,
          paymentMethod,
          recoveryRequestIdempotencyKey:
            recoveryPrompt.recoveryRequestIdempotencyKey,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        const parsedError = parseUpgradeApiError(data);
        throw new Error(
          parsedError.requestId
            ? `${parsedError.message} Request ID: ${parsedError.requestId}.`
            : parsedError.message,
        );
      }

      setRecoveryPrompt(null);
      setCheckoutNotice(null);
      const normalizedResponse = parseUpgradeCheckoutResponse(data);
      await completeProviderCheckout(normalizedResponse);
    } catch (errorValue: unknown) {
      handleCheckoutError(errorValue);
      submittingRef.current = false;
      setLoading(false);
    }
  };

  async function completeProviderCheckout(
    normalizedResponse: UpgradeCheckoutResponse,
    options: { allowReopen?: boolean } = {},
  ) {
    const sessionKey = getUpgradeCheckoutSessionKey(normalizedResponse);
    if (!options.allowReopen && openedCheckoutSessionRef.current === sessionKey) {
      return;
    }
    openedCheckoutSessionRef.current = sessionKey;

    switch (normalizedResponse.completionMode) {
      case "paystack_resume":
        return openPaystackResume(normalizedResponse);
      case "hosted_checkout_redirect":
        if (redirectStartedRef.current) {
          return;
        }
        redirectStartedRef.current = true;
        window.location.assign(normalizedResponse.checkoutUrl);
        return;
      default:
        throw new UnsupportedCheckoutCompletionModeError(
          `Unsupported checkout completion mode: ${(normalizedResponse as { completionMode?: unknown }).completionMode ?? "unknown"}.`,
        );
    }
  }

  function openPaystackResume(
    normalizedResponse: Extract<
      UpgradeCheckoutResponse,
      { completionMode: "paystack_resume" }
    >,
  ) {
    setPreservedCheckoutSession(normalizedResponse);
    return resumePaystackCheckout(normalizedResponse.accessCode, {
      onSuccess: (transaction) => {
        const reference = transaction.reference || normalizedResponse.reference;
        setCheckoutNotice({
          title: "Payment is pending verification",
          message:
            "We received the checkout callback and will confirm it securely before updating your plan.",
          requestId: normalizedResponse.requestId,
        });
        sessionStorage.removeItem("upgradeCheckout");
        router.push(
          `/settings/upgrade-success?reference=${reference}&plan=${plan}&provider=${normalizedResponse.provider}`,
        );
      },
      onCancel: () => {
        setCheckoutNotice({
          title: "Payment was not completed",
          message:
            "Payment was not completed. You can reopen this checkout when ready.",
          requestId: normalizedResponse.requestId,
          action: "open_checkout_again",
        });
        submittingRef.current = false;
        setLoading(false);
      },
      onError: (error) => {
        const sdkError = new PaystackCheckoutSdkError(
          "PAYSTACK_CHECKOUT_OPEN_FAILED",
          "Paystack checkout could not open.",
          { cause: error },
        );
        showCheckoutOpenFailure(normalizedResponse, sdkError);
        submittingRef.current = false;
        setLoading(false);
      },
    }).then(
      () => {
        submittingRef.current = false;
        setLoading(false);
      },
      (errorValue) => {
        if (errorValue instanceof PaystackCheckoutSdkError) {
          showCheckoutOpenFailure(normalizedResponse, errorValue);
        }
        throw errorValue;
      },
    );
  }

  const handleOpenPreservedCheckout = async () => {
    if (submittingRef.current || !preservedCheckoutSession) {
      return;
    }

    submittingRef.current = true;
    setError(null);
    setLoading(true);
    try {
      await completeProviderCheckout(preservedCheckoutSession, {
        allowReopen: true,
      });
    } catch (errorValue: unknown) {
      handleCheckoutError(errorValue);
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleCryptoPayment = async () => {
    if (submittingRef.current) {
      return;
    }

    if (checkoutDisabledReason) {
      setError(checkoutDisabledReason);
      return;
    }

    submittingRef.current = true;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/checkout/crypto-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPlan: plan,
          ownerName,
          businessType,
          relationshipClaim,
          verificationDisclosureAccepted,
          disclosureVersion,
        }),
      });
      const data = await res.json();
      if (!data.cryptoAddress) throw new Error(data.error || "Failed to generate address.");
      setCryptoDetails({
        address: data.cryptoAddress,
        network: data.cryptoNetwork,
        coin: data.cryptoCoin,
        fiatAmount: data.fiatAmount,
        cryptoAmount: data.cryptoAmount ?? null,
        exchangeRate: data.exchangeRate ?? null,
        quoteSource: data.quoteSource || null,
        providerQuoteAvailable: data.providerQuoteAvailable === true,
        reference: data.reference,
        providerReference: data.providerReference || null,
        paymentSessionId: data.paymentSessionId || null,
        expiresAt: data.expiresAt || null,
      });
      setCryptoCheckoutStatus({
        status: "waiting_for_payment",
        message: "Waiting for crypto payment. Send the exact amount to the wallet address below.",
        providerReference: data.providerReference || null,
        paymentSessionId: data.paymentSessionId || null,
        shortfallAmount: null,
        overpaymentAmount: null,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "card", label: "Card", icon: <CreditCard className="h-4 w-4" /> },
    { id: "bank_transfer", label: "Bank Transfer", icon: <ArrowRightLeft className="h-4 w-4" /> },
    { id: "ussd", label: "USSD", icon: <ShieldCheck className="h-4 w-4" /> },
    { id: "crypto", label: "Crypto", icon: <Bitcoin className="h-4 w-4" /> },
  ];
  const visibleTabs = tabs.filter((entry) => availableMethods.some((method) => method.method === entry.id));
  const cryptoEnabled = availableMethods.some((method) => method.method === "crypto");

  return (
    <div className="min-h-screen bg-[#12061F] flex flex-col">
      {/* Header */}
      <header className="bg-[#1A0B2E] border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <Link href={`/settings/upgrade/${plan}`} className="text-white/60 hover:text-white flex items-center gap-1.5 text-sm font-medium transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="flex items-center gap-2 ml-auto text-xs text-white/40">
          <Lock className="h-3.5 w-3.5" /> Secured by DeraLedger
        </div>
      </header>

      <main className="flex flex-col md:flex-row flex-1 max-w-5xl mx-auto w-full">
        {/* ── Left: Plan Summary ── */}
        <div className={`bg-gradient-to-br ${config.color} border-r border-white/5 text-white w-full md:w-5/12 p-8 md:min-h-[calc(100vh-53px)] flex flex-col`}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center">
              <Icon className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs text-[#B58CFF] font-semibold uppercase tracking-wider">{config.verification}</p>
              <h1 className="text-xl font-bold text-white">{config.label}</h1>
            </div>
          </div>

          <div className="mb-6">
            <span className="text-4xl font-bold">{config.price}</span>
            <span className="text-white/60 text-sm ml-1">{config.interval}</span>
          </div>

          {loadingMerchant ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-6 flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#B58CFF]" />
              <p className="text-white/60 text-sm">Loading workspace...</p>
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 mb-6">
              <p className="text-xs text-white/50 mb-1 font-medium">Upgrading workspace</p>
              <p className="font-semibold text-sm truncate">{merchant?.trading_name || merchant?.business_name || "—"}</p>
              <p className="text-white/50 text-xs truncate">{merchant?.email || "—"}</p>
            </div>
          )}

          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#B58CFF] mb-3">What you&apos;ll unlock</p>
            <ul className="space-y-2.5">
              {config.features.map(f => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-[#B58CFF] mt-0.5 flex-shrink-0" />
                  <span className="text-white/80">{f}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 flex items-center gap-2 text-white/40 text-xs">
            <ShieldCheck className="h-3.5 w-3.5" />
            Payments routed securely by DeraLedger
          </div>
        </div>

        {/* ── Right: Payment Methods ── */}
        <div className="flex-1 bg-[#12061F] border-l border-white/5 p-6 md:p-10 flex flex-col">
          <h2 className="text-lg font-bold text-white mb-1">Choose payment method</h2>
          <p className="text-sm text-white/60 mb-4">Select how you&apos;d like to pay for your upgrade.</p>
          <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            {plan === "solo_plus"
              ? "Your Solo Plus payment starts a reviewed verification flow. Payment does not approve or activate Solo Plus by itself."
              : "Your payment moves this workspace into setup mode. Live payment links, checkout, settlement, and payment collection remain disabled until verification is completed."}
          </div>

          {plan === "solo_plus" ? (
            <div className="mb-6 space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <div>
                <label htmlFor="solo-plus-owner-name" className="text-sm font-semibold text-white">
                  Account owner name <span className="text-amber-300">*</span>
                </label>
                <input
                  id="solo-plus-owner-name"
                  value={ownerName}
                  onChange={(event) => {
                    setOwnerName(event.target.value);
                    clearCheckoutMessaging();
                  }}
                  placeholder="Enter the account owner's legal name"
                  className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-[#12061F] px-3 text-sm text-white outline-none transition focus:border-[#B58CFF] placeholder:text-white/30"
                />
                {isPlaceholderOwnerName(ownerName) ? (
                  <p className="mt-2 text-xs text-amber-200">
                    Replace this placeholder with the real account owner name before starting payment.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-white/45">
                    Use the real owner name for the reviewed Solo Plus request.
                  </p>
                )}
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-[#12061F]/50 p-4">
                <input
                  type="checkbox"
                  checked={relationshipClaim === "owner_affiliated_claim"}
                  onChange={(event) => {
                    setRelationshipClaim(event.target.checked ? "owner_affiliated_claim" : null);
                    clearCheckoutMessaging();
                  }}
                  className="mt-1 h-4 w-4 accent-[#7B2FF7]"
                />
                <span className="text-sm leading-relaxed text-white/75">
                  I confirm that I am the account owner or owner-affiliated operator responsible for this Solo Plus request.
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
                <input
                  type="checkbox"
                  checked={verificationDisclosureAccepted}
                  onChange={(event) => {
                    setVerificationDisclosureAccepted(event.target.checked);
                    clearCheckoutMessaging();
                  }}
                  className="mt-1 h-4 w-4 accent-[#7B2FF7]"
                />
                <span className="text-sm leading-relaxed text-amber-100">
                  I understand that payment starts Solo Plus review only. Requirements, approval, and activation remain separate.
                </span>
              </label>
            </div>
          ) : null}

          {/* Tab selector */}
          <div className="flex gap-2 mb-6 border-b border-white/10 pb-1">
            {visibleTabs.map(t => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  clearCheckoutMessaging();
                  setCryptoDetails(null);
                }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-[#7B2FF7] text-white shadow-sm"
                    : "text-white/50 hover:text-white hover:bg-white/5"
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          {paymentMethodsLoading ? (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/65">
              <Loader2 className="h-4 w-4 animate-spin text-[#B58CFF]" />
              Payment methods are still loading.
            </div>
          ) : visibleTabs.length === 0 ? (
            <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              {paymentMethodsError || "No supported payment method is currently available."}
            </div>
          ) : null}

          {/* Card & Bank */}
          {tab === "card" && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="rounded-xl border border-[#7B2FF7]/30 bg-[#7B2FF7]/5 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-[#7B2FF7] flex items-center justify-center">
                    <CreditCard className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white text-sm">Card Payment</p>
                    <p className="text-xs text-white/50">The active backend route decides which provider processes this payment.</p>
                  </div>
                </div>
                <p className="text-xs text-white/50 mb-4">
                  Your card details are handled by the selected payment provider, not stored by DeraLedger.
                </p>
                <Button onClick={() => void handleFiatPayment("card")} disabled={!canSubmitPayment}
                  className="w-full h-12 bg-[#7B2FF7] hover:bg-[#B58CFF] hover:text-[#12061F] text-white font-bold text-base border-0 transition-all">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Opening checkout...</> : <>Pay {config.price} <CreditCard className="ml-2 h-4 w-4" /></>}
                </Button>
              </div>
            </div>
          )}

          {/* Bank Transfer */}
          {tab === "bank_transfer" && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                    <ArrowRightLeft className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white text-sm">Bank Transfer</p>
                    <p className="text-xs text-blue-400">Pay from your Nigerian bank account</p>
                  </div>
                </div>
                <p className="text-xs text-white/50 mb-4">
                  The active backend route will generate the exact transfer flow for this upgrade.
                </p>
                <Button onClick={() => void handleFiatPayment("bank_transfer")} disabled={!canSubmitPayment}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold text-base border-0">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Opening...</> : <>Get Transfer Details <ArrowRightLeft className="ml-2 h-4 w-4" /></>}
                </Button>
              </div>
            </div>
          )}

          {tab === "ussd" && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center">
                    <ShieldCheck className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white text-sm">USSD Payment</p>
                    <p className="text-xs text-emerald-300">Generate bank-specific USSD instructions through the active provider.</p>
                  </div>
                </div>
                <p className="text-xs text-white/50 mb-4">
                  This opens the provider-hosted USSD flow for the exact upgrade amount.
                </p>
                <Button onClick={() => void handleFiatPayment("ussd")} disabled={!canSubmitPayment}
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base border-0">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Opening...</> : <>Generate USSD <ShieldCheck className="ml-2 h-4 w-4" /></>}
                </Button>
              </div>
            </div>
          )}

          {/* Crypto */}
          {tab === "crypto" && (
            <div className="flex-1 flex flex-col gap-4">
              {!cryptoEnabled ? (
                <div className="rounded-xl border-2 border-amber-100 bg-amber-50 p-6 text-center">
                  <Bitcoin className="h-10 w-10 text-amber-500 mx-auto mb-3" />
                  <p className="font-semibold text-amber-900 mb-1">Crypto Payments — Coming Soon</p>
                  <p className="text-xs text-amber-700">BTC, USDT, and ETH payments are being activated. Use Card & Bank or Bank Transfer for now.</p>
                </div>
              ) : cryptoDetails ? (
                <div className="rounded-xl border-2 border-orange-100 bg-orange-50 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-orange-900 text-sm">Send {cryptoDetails.coin}</p>
                    <span className="text-xs bg-orange-200 text-orange-900 rounded px-2 py-0.5 font-medium">{cryptoDetails.network}</span>
                  </div>
                  <div className="bg-white rounded-lg border border-orange-200 p-3 font-mono text-xs text-neutral-700 break-all">{cryptoDetails.address}</div>
                  <div className="grid gap-2 rounded-lg border border-orange-200 bg-white p-3 text-xs text-neutral-700">
                    <p><span className="font-semibold text-neutral-900">Reference:</span> <span className="font-mono break-all">{cryptoDetails.reference}</span></p>
                    {cryptoDetails.providerReference ? (
                      <p><span className="font-semibold text-neutral-900">Provider Reference:</span> <span className="font-mono break-all">{cryptoDetails.providerReference}</span></p>
                    ) : null}
                    {cryptoDetails.paymentSessionId ? (
                      <p><span className="font-semibold text-neutral-900">Payment Session:</span> <span className="font-mono break-all">{cryptoDetails.paymentSessionId}</span></p>
                    ) : null}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleCopy(cryptoDetails.address)} className="w-full border-orange-300 text-orange-700">
                    {copied ? <><Check className="h-3.5 w-3.5 mr-1" /> Copied</> : <><Copy className="h-3.5 w-3.5 mr-1" /> Copy Address</>}
                  </Button>
                  <p className="text-xs text-orange-700 text-center">
                    Send{" "}
                    <strong>
                      {cryptoDetails.cryptoAmount?.toFixed(8) || "the quoted amount"} {cryptoDetails.coin}
                    </strong>
                    {" "}for NGN {cryptoDetails.fiatAmount.toLocaleString()}
                    {cryptoDetails.exchangeRate ? ` at NGN ${cryptoDetails.exchangeRate.toLocaleString()} per ${cryptoDetails.coin}.` : "."}
                  </p>
                  {cryptoCheckoutStatus ? (
                    <div className="rounded-lg border border-orange-200 bg-white p-3 text-sm text-orange-900">
                      <p className="font-semibold">
                        {cryptoCheckoutStatus.status === "awaiting_provider_completion"
                          ? "Payment Detected"
                          : cryptoCheckoutStatus.status === "completed"
                            ? "Payment Confirmed"
                            : cryptoCheckoutStatus.status === "manual_review"
                              ? "Payment Under Review"
                              : cryptoCheckoutStatus.status === "failed" || cryptoCheckoutStatus.status === "expired"
                                ? "Payment Unavailable"
                                : "Waiting for Payment"}
                      </p>
                      <p className="mt-1 text-xs text-orange-800">{cryptoCheckoutStatus.message}</p>
                      {cryptoCheckoutStatus.shortfallAmount && cryptoCheckoutStatus.shortfallAmount > 0 ? (
                        <p className="mt-2 text-xs font-semibold text-orange-900">
                          Shortfall: NGN {cryptoCheckoutStatus.shortfallAmount.toLocaleString()}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border-2 border-orange-100 bg-orange-50 p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center">
                      <Bitcoin className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold text-orange-900 text-sm">Pay with Crypto</p>
                      <p className="text-xs text-orange-600">BTC, USDT, ETH</p>
                    </div>
                  </div>
                  <Button onClick={handleCryptoPayment} disabled={!canSubmitPayment} className="w-full h-11 bg-orange-500 hover:bg-orange-600 text-white font-bold">
                    {loading ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Generating...</> : "Generate Crypto Address"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>
          )}

          {checkoutNotice ? (
            <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
              <p className="font-semibold text-amber-50">{checkoutNotice.title}</p>
              <p className="mt-2">{checkoutNotice.message}</p>
              {checkoutNotice.guidance ? (
                <p className="mt-2 text-xs text-amber-50/75">{checkoutNotice.guidance}</p>
              ) : null}
              {checkoutNotice.requestId ? (
                <details className="mt-3 text-xs text-amber-50/65">
                  <summary className="cursor-pointer">Technical details</summary>
                  <p className="mt-1 font-mono break-all">Reference: {checkoutNotice.requestId}</p>
                </details>
              ) : null}
              {checkoutNotice.action === "open_checkout_again" && preservedCheckoutSession ? (
                <Button
                  type="button"
                  onClick={() => void handleOpenPreservedCheckout()}
                  disabled={loading}
                  className="mt-4 h-11 w-full bg-amber-400 text-[#12061F] hover:bg-amber-300"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Opening checkout...
                    </>
                  ) : (
                    "Open checkout again"
                  )}
                </Button>
              ) : null}
            </div>
          ) : null}

          {plan === "solo_plus" && recoveryPrompt ? (
            <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
              <p className="font-semibold text-amber-50">We need to check your previous payment</p>
              <p className="mt-2">
                Your previous checkout could not be reopened. We&rsquo;ll confirm its payment status before safely continuing with a new checkout.
              </p>
              {recoveryPrompt.requestId ? (
                <details className="mt-3 text-xs text-amber-50/65">
                  <summary className="cursor-pointer">Technical details</summary>
                  <p className="mt-1 font-mono break-all">Reference: {recoveryPrompt.requestId}</p>
                </details>
              ) : null}
              {selectedMethod && selectedMethod.method !== "crypto" ? (
                <Button
                  type="button"
                  onClick={() =>
                    void handleSoloPlusRecovery(
                      selectedMethod.method as "card" | "bank_transfer" | "ussd",
                    )
                  }
                  disabled={loading}
                  className="mt-4 h-11 w-full bg-amber-400 text-[#12061F] hover:bg-amber-300"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking payment status...
                    </>
                  ) : (
                    "Check status and continue"
                  )}
                </Button>
              ) : null}
            </div>
          ) : null}

          {checkoutDisabledReason ? (
            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/65" data-testid="upgrade-payment-disabled-reason">
              {checkoutDisabledReason}
            </div>
          ) : null}

          <p className="mt-auto pt-6 text-center text-xs text-white/40">
            Subscription renews monthly. You can manage it from Settings &gt; Billing.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function UpgradeCheckoutPage({ params }: UpgradeCheckoutPageProps) {
  const { plan } = use(params);
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#12061F]">
        <Loader2 className="h-8 w-8 animate-spin text-[#B58CFF]" />
      </div>
    }>
      <UpgradeCheckoutContent plan={plan} />
    </Suspense>
  );
}
