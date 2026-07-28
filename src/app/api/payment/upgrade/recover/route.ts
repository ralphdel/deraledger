import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { UpgradeCheckoutResponse } from "@/lib/checkout/provider-completion";
import { PaymentService } from "@/lib/payment";
import { getAppUrl } from "@/lib/server-utils";
import {
  hasReusablePaymentInitialization,
  mergePaymentInitializationSnapshot,
  readPaymentInitializationSnapshot,
  updatePlanPaymentRecordById,
  type PendingPlanPaymentRecord,
} from "@/lib/services/plan-payment-recovery.service";
import { createClient } from "@/lib/supabase/server";
import {
  assertPlanAvailable,
  getPlanPriceKobo,
  getStoragePlanCode,
  normalizePlanCode,
} from "@/lib/plans";
import {
  getPaymentEnvironmentForMerchantEmail,
  resolvePaymentRoute,
  type PaymentMethod,
} from "@/lib/services/payment-routing.service";
import {
  recoverSoloPlusUpgradePayment,
  SoloPlusPaymentRecoveryError,
} from "@/lib/solo-plus/server/payment-recovery";
import { SoloPlusPaymentLifecycleError } from "@/lib/solo-plus/server/payment-lifecycle";
import { mapUpgradeInitializationError } from "../error-mapping";
import {
  createPaymentUpgradeLogger,
  createPaymentUpgradeRequestId,
  describeError,
} from "../diagnostics";

const trustedSupabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function buildUpgradeCheckoutResponse(input: {
  provider: "paystack" | "monnify";
  paymentRecordId: string;
  reference: string;
  replay: boolean;
  providerInitializationReused: boolean;
  requestId: string;
  initialization: {
    accessCode?: string | null;
    authorizationUrl?: string | null;
    checkoutUrl?: string | null;
    providerTransactionReference?: string | null;
  };
}): UpgradeCheckoutResponse {
  if (input.provider === "paystack") {
    if (!input.initialization.accessCode) {
      throw new SoloPlusPaymentLifecycleError(
        "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED",
        "Paystack checkout session is missing its access code.",
      );
    }

    return {
      provider: "paystack",
      completionMode: "paystack_resume",
      paymentRecordId: input.paymentRecordId,
      reference: input.reference,
      accessCode: input.initialization.accessCode,
      authorizationUrl: input.initialization.authorizationUrl || undefined,
      replay: input.replay,
      providerInitializationReused: input.providerInitializationReused,
      requestId: input.requestId,
    };
  }

  if (!input.initialization.checkoutUrl) {
    throw new SoloPlusPaymentLifecycleError(
      "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED",
      "Monnify checkout session is missing its checkout URL.",
    );
  }

  return {
    provider: "monnify",
    completionMode: "hosted_checkout_redirect",
    paymentRecordId: input.paymentRecordId,
    reference: input.reference,
    checkoutUrl: input.initialization.checkoutUrl,
    providerTransactionReference:
      input.initialization.providerTransactionReference || undefined,
    replay: input.replay,
    providerInitializationReused: input.providerInitializationReused,
    requestId: input.requestId,
  };
}

function resolveFiatProvider(provider: string) {
  if (provider === "paystack") {
    return "paystack" as const;
  }

  if (provider === "monnify") {
    return "monnify" as const;
  }

  return null;
}

export async function POST(request: Request) {
  const requestId = createPaymentUpgradeRequestId();
  const logStage = createPaymentUpgradeLogger(
    requestId,
    "payment_upgrade_recover",
  );
  let userId: string | null = null;
  let merchantId: string | null = null;
  let planCode: string | null = null;
  let providerName: string | null = null;
  let paymentRecord: PendingPlanPaymentRecord | null = null;

  try {
    logStage("request_received");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", code: "UNAUTHORIZED", requestId },
        { status: 401 },
      );
    }
    userId = user.id;
    logStage("auth_resolved", { userId });

    const {
      newPlan,
      paymentMethod,
      recoveryRequestIdempotencyKey,
    } = await request.json();
    const normalizedPlan = normalizePlanCode(newPlan);
    planCode = normalizedPlan;

    if (normalizedPlan !== "solo_plus") {
      throw new SoloPlusPaymentRecoveryError(
        "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED",
        "Solo Plus payment recovery is available only for Solo Plus upgrade attempts.",
      );
    }

    if (
      typeof recoveryRequestIdempotencyKey !== "string" ||
      !recoveryRequestIdempotencyKey.trim()
    ) {
      return NextResponse.json(
        {
          error: "A recovery request key is required.",
          code: "INVALID_REQUEST",
          requestId,
        },
        { status: 400 },
      );
    }

    await assertPlanAvailable(supabase, normalizedPlan);

    const { data: merchant, error: merchantError } = await supabase
      .from("merchants")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json(
        {
          error: "Merchant not found for this owner.",
          code: "FORBIDDEN",
          requestId,
        },
        { status: 403 },
      );
    }

    merchantId = merchant.id;
    logStage("merchant_resolved", {
      userId,
      merchantId,
      planCode,
    });

    const method =
      paymentMethod === "bank_transfer" ||
      paymentMethod === "ussd" ||
      paymentMethod === "card"
        ? (paymentMethod as PaymentMethod)
        : "card";

    logStage("recovery_requested", {
      userId,
      merchantId,
      planCode,
      metadata: {
        method,
      },
    });

    const route = await resolvePaymentRoute(
      "plan_upgrade",
      method,
      getPaymentEnvironmentForMerchantEmail(user.email || merchant.email),
    );
    const fiatProvider = resolveFiatProvider(route.provider);

    if (!fiatProvider) {
      throw new SoloPlusPaymentRecoveryError(
        "SOLO_PLUS_PAYMENT_RECOVERY_NOT_ALLOWED",
        "Unsupported checkout provider was selected for this Solo Plus recovery flow.",
      );
    }

    providerName = fiatProvider;
    logStage("provider_route_selected", {
      userId,
      merchantId,
      planCode,
      provider: fiatProvider,
      metadata: {
        method,
        environment: route.environment,
        fallbackProvider: route.fallbackProvider || null,
      },
    });
    logStage("provider_configuration_validated", {
      userId,
      merchantId,
      planCode,
      provider: fiatProvider,
    });

    const recovery = await recoverSoloPlusUpgradePayment({
      merchantId: merchant.id,
      recoveryIdempotencyKey: recoveryRequestIdempotencyKey.trim(),
      newProvider: fiatProvider,
      newPaymentMethod: method as "card" | "bank_transfer" | "ussd",
      serviceClient: trustedSupabase,
      diagnostics: (stage, event) =>
        logStage(stage, {
          userId,
          merchantId,
          planCode,
          provider: providerName,
          ...event,
        }),
    });

    paymentRecord = recovery.paymentRecord;

    if (recovery.kind === "resume_existing") {
      logStage("provider_session_reused", {
        userId,
        merchantId,
        planCode,
        provider: paymentRecord.provider_name,
        paymentRecordId: paymentRecord.id,
        metadata: {
          replay: recovery.replay,
          providerInitializationReused: true,
          completionMode: recovery.initialization.completionMode,
          hasAuthorizationUrl: Boolean(recovery.initialization.authorizationUrl),
          hasAccessCode: Boolean(recovery.initialization.accessCode),
          hasCheckoutUrl: Boolean(recovery.initialization.checkoutUrl),
          hasProviderTransactionReference: Boolean(
            recovery.initialization.providerTransactionReference,
          ),
        },
      });

      const response = buildUpgradeCheckoutResponse({
        provider: paymentRecord.provider_name as "paystack" | "monnify",
        paymentRecordId: paymentRecord.id,
        reference: recovery.reference,
        replay: true,
        providerInitializationReused: true,
        requestId,
        initialization: {
          accessCode: recovery.initialization.accessCode,
          authorizationUrl: recovery.initialization.authorizationUrl,
          checkoutUrl:
            recovery.initialization.checkoutUrl ||
            recovery.initialization.authorizationUrl,
          providerTransactionReference:
            recovery.initialization.providerTransactionReference,
        },
      });

      logStage("response_ready", {
        userId,
        merchantId,
        planCode,
        provider: paymentRecord.provider_name,
        paymentRecordId: paymentRecord.id,
        metadata: {
          completionMode: response.completionMode,
          replay: true,
          providerInitializationReused: true,
        },
      });

      return NextResponse.json(response);
    }

    const reusableInitialization =
      paymentRecord.provider_name === "paystack" ||
      paymentRecord.provider_name === "monnify"
        ? hasReusablePaymentInitialization(
            paymentRecord,
            paymentRecord.provider_name,
          )
        : null;

    if (reusableInitialization) {
      logStage("provider_session_reused", {
        userId,
        merchantId,
        planCode,
        provider: paymentRecord.provider_name,
        paymentRecordId: paymentRecord.id,
        metadata: {
          replay: recovery.replay,
          providerInitializationReused: true,
          completionMode: reusableInitialization.completionMode,
        },
      });

      const response = buildUpgradeCheckoutResponse({
        provider: paymentRecord.provider_name as "paystack" | "monnify",
        paymentRecordId: paymentRecord.id,
        reference:
          reusableInitialization.providerReference ||
          paymentRecord.provider_reference ||
          paymentRecord.internal_reference,
        replay: true,
        providerInitializationReused: true,
        requestId,
        initialization: {
          accessCode: reusableInitialization.accessCode,
          authorizationUrl: reusableInitialization.authorizationUrl,
          checkoutUrl:
            reusableInitialization.checkoutUrl ||
            reusableInitialization.authorizationUrl,
          providerTransactionReference:
            reusableInitialization.providerTransactionReference,
        },
      });

      logStage("response_ready", {
        userId,
        merchantId,
        planCode,
        provider: paymentRecord.provider_name,
        paymentRecordId: paymentRecord.id,
        metadata: {
          completionMode: response.completionMode,
          replay: true,
          providerInitializationReused: true,
        },
      });

      return NextResponse.json(response);
    }

    const resolvedReference =
      paymentRecord.provider_reference || paymentRecord.internal_reference;
    const previousInitialization = readPaymentInitializationSnapshot(
      paymentRecord.metadata,
    );
    await updatePlanPaymentRecordById(trustedSupabase, paymentRecord.id, {
      provider_reference: resolvedReference,
      metadata: mergePaymentInitializationSnapshot(paymentRecord.metadata, {
        status: "initializing",
        provider: fiatProvider,
        completionMode:
          fiatProvider === "paystack"
            ? "paystack_resume"
            : "hosted_checkout_redirect",
        providerReference: resolvedReference,
        authorizationUrl: previousInitialization?.authorizationUrl ?? null,
        accessCode: previousInitialization?.accessCode ?? null,
        checkoutUrl: previousInitialization?.checkoutUrl ?? null,
        providerTransactionReference:
          previousInitialization?.providerTransactionReference ?? null,
        failureCode: null,
        failureMessage: null,
        initializedAt: previousInitialization?.initializedAt ?? null,
        lastUpdatedAt: new Date().toISOString(),
      }),
    });

    const callback = new URL(`${getAppUrl()}/settings/upgrade-success`);
    callback.searchParams.set("reference", resolvedReference);
    callback.searchParams.set("plan", getStoragePlanCode("solo_plus"));
    callback.searchParams.set("provider", fiatProvider);

    logStage("provider_initialization_started", {
      userId,
      merchantId,
      planCode,
      provider: fiatProvider,
      paymentRecordId: paymentRecord.id,
      metadata: {
        reference: resolvedReference,
        replay: recovery.replay,
      },
    });

    let result;
    try {
      result = await PaymentService.initializeTransaction(
        {
          email:
            user.email ||
            paymentRecord.customer_email ||
            merchant.email ||
            "billing@deraledger.app",
          amountKobo: getPlanPriceKobo("solo_plus"),
          reference: resolvedReference,
          callbackUrl: callback.toString(),
          metadata: {
            ...(typeof paymentRecord.metadata === "object" &&
            paymentRecord.metadata !== null &&
            !Array.isArray(paymentRecord.metadata)
              ? paymentRecord.metadata
              : {}),
            resolved_provider: fiatProvider,
            payment_method_requested: method,
            payment_purpose: "plan_upgrade",
            new_plan: getStoragePlanCode("solo_plus"),
            new_plan_display_code: "solo_plus",
          },
          paymentMethod: method,
        },
        fiatProvider,
      );
    } catch (error) {
      await updatePlanPaymentRecordById(trustedSupabase, paymentRecord.id, {
        provider_reference: resolvedReference,
        metadata: mergePaymentInitializationSnapshot(paymentRecord.metadata, {
          status: "initialization_failed",
          provider: fiatProvider,
          completionMode:
            fiatProvider === "paystack"
              ? "paystack_resume"
              : "hosted_checkout_redirect",
          providerReference: resolvedReference,
          authorizationUrl: null,
          accessCode: null,
          checkoutUrl: null,
          providerTransactionReference: null,
          failureCode:
            error instanceof Error &&
            /duplicate transaction reference/i.test(error.message)
              ? "duplicate_reference"
              : "provider_initialization_failed",
          failureMessage:
            error instanceof Error
              ? error.message
              : "Provider initialization failed.",
          initializedAt: null,
          lastUpdatedAt: new Date().toISOString(),
        }),
        failure_reason:
          error instanceof Error
            ? error.message
            : "Provider initialization failed.",
      });

      if (
        error instanceof Error &&
        /duplicate transaction reference/i.test(error.message)
      ) {
        throw new SoloPlusPaymentLifecycleError(
          "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED",
          "Solo Plus payment already has an unrecoverable provider checkout reference for this attempt. Resume the existing checkout if available or recover the current payment record before creating a new attempt.",
        );
      }

      throw error;
    }

    const completionMode =
      fiatProvider === "paystack"
        ? "paystack_resume"
        : "hosted_checkout_redirect";
    const providerTransactionReference =
      fiatProvider === "monnify" ? result.accessCode : null;
    const checkoutUrl =
      fiatProvider === "monnify" ? result.authorizationUrl : null;

    await updatePlanPaymentRecordById(trustedSupabase, paymentRecord.id, {
      provider_reference: result.reference || resolvedReference,
      metadata: mergePaymentInitializationSnapshot(paymentRecord.metadata, {
        status: "initialized",
        provider: fiatProvider,
        completionMode,
        providerReference: result.reference || resolvedReference,
        authorizationUrl: result.authorizationUrl,
        accessCode: result.accessCode,
        checkoutUrl,
        providerTransactionReference,
        failureCode: null,
        failureMessage: null,
        initializedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      }),
      failure_reason: null,
    });

    logStage("provider_session_persisted", {
      userId,
      merchantId,
      planCode,
      provider: fiatProvider,
      paymentRecordId: paymentRecord.id,
      metadata: {
        completionMode,
      },
    });
    logStage("provider_initialization_completed", {
      userId,
      merchantId,
      planCode,
      provider: fiatProvider,
      paymentRecordId: paymentRecord.id,
      metadata: {
        completionMode,
        hasAuthorizationUrl: Boolean(result.authorizationUrl),
        hasAccessCode: Boolean(result.accessCode),
        hasCheckoutUrl: Boolean(checkoutUrl),
        hasProviderTransactionReference: Boolean(providerTransactionReference),
        returnedReferenceMatches: result.reference === resolvedReference,
        replay: recovery.replay,
        providerInitializationReused: false,
      },
    });

    const response = buildUpgradeCheckoutResponse({
      provider: fiatProvider,
      paymentRecordId: paymentRecord.id,
      reference: result.reference || resolvedReference,
      replay: recovery.replay,
      providerInitializationReused: false,
      requestId,
      initialization: {
        accessCode: fiatProvider === "paystack" ? result.accessCode : null,
        authorizationUrl:
          fiatProvider === "paystack" ? result.authorizationUrl : undefined,
        checkoutUrl: fiatProvider === "monnify" ? result.authorizationUrl : null,
        providerTransactionReference:
          fiatProvider === "monnify" ? result.accessCode : null,
      },
    });

    logStage("response_ready", {
      userId,
      merchantId,
      planCode,
      provider: fiatProvider,
      paymentRecordId: paymentRecord.id,
      metadata: {
        completionMode: response.completionMode,
        replay: recovery.replay,
        providerInitializationReused: false,
      },
    });

    return NextResponse.json(response);
  } catch (error: unknown) {
    const mapped = mapUpgradeInitializationError(error);
    logStage("request_failed", {
      userId,
      merchantId,
      planCode,
      provider: providerName,
      ...describeError(error),
    });
    console.error("Upgrade recovery failed:", {
      requestId,
      userId,
      merchantId,
      planCode,
      provider: providerName,
      ...describeError(error),
    });
    return NextResponse.json(
      { error: mapped.error, code: mapped.code, requestId },
      { status: mapped.status },
    );
  }
}
