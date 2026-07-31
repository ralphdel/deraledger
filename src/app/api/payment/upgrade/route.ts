import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { UpgradeCheckoutResponse } from "@/lib/checkout/provider-completion";
import { PaymentService } from "@/lib/payment";
import { getAppUrl } from "@/lib/server-utils";
import {
  recordVerificationDisclosure,
  requiresVerificationDisclosure,
  VERIFICATION_DISCLOSURE_VERSION,
  type RelationshipClaim,
} from "@/lib/services/onboarding-flow.service";
import { getPaymentEnvironmentForMerchantEmail, resolvePaymentRoute, type PaymentMethod } from "@/lib/services/payment-routing.service";
import { createPendingPlanPaymentRecord } from "@/lib/services/plan-payment-recovery.service";
import {
  hasReusablePaymentInitialization,
  mergePaymentInitializationSnapshot,
  type PendingPlanPaymentRecord,
  readPaymentInitializationSnapshot,
  updatePlanPaymentRecordById,
} from "@/lib/services/plan-payment-recovery.service";
import {
  assertPlanAvailable,
  getPlanPriceKobo,
  getStoragePlanCode,
  normalizePlanCode,
} from "@/lib/plans";
import {
  prepareSoloPlusUpgradePayment,
  SoloPlusPaymentLifecycleError,
} from "@/lib/solo-plus/server/payment-lifecycle";
import { mapUpgradeInitializationError } from "./error-mapping";
import {
  createPaymentUpgradeLogger,
  createPaymentUpgradeRequestId,
  describeError,
} from "./diagnostics";

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

export async function POST(request: Request) {
  const requestId = createPaymentUpgradeRequestId();
  const logStage = createPaymentUpgradeLogger(requestId);
  let userId: string | null = null;
  let merchantId: string | null = null;
  let planCode: string | null = null;
  let providerName: string | null = null;
  let paymentRecord: PendingPlanPaymentRecord | null = null;

  try {
    logStage("request_received");
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = user.id;
    logStage("auth_resolved", { userId });

    const {
      newPlan,
      ownerName,
      businessType,
      relationshipClaim,
      verificationDisclosureAccepted,
      paymentMethod,
    } = await request.json();

    const normalizedPlan = normalizePlanCode(newPlan);
    planCode = normalizedPlan;
    const availability = await assertPlanAvailable(supabase, normalizedPlan);
    if (!availability.ok) {
      return NextResponse.json({ error: "This plan is not available right now." }, { status: 403 });
    }
    const storagePlan = getStoragePlanCode(normalizedPlan);

    if (requiresVerificationDisclosure(normalizedPlan) && verificationDisclosureAccepted !== true) {
      return NextResponse.json(
        { error: "Please acknowledge the verification disclosure before payment." },
        { status: 400 }
      );
    }
    logStage("request_validated", {
      userId,
      planCode,
      metadata: {
        hasOwnerName: typeof ownerName === "string" && ownerName.trim() !== "",
        businessTypeProvided: businessType != null,
        paymentMethod: String(paymentMethod || "card"),
        relationshipClaimProvided: relationshipClaim != null,
      },
    });

    // Get merchant
    const { data: merchant, error: merchantError } = await supabase
      .from("merchants")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }
    merchantId = merchant.id;
    logStage("merchant_resolved", {
      userId,
      merchantId,
      planCode,
      metadata: {
        merchantPlan: String(merchant.subscription_plan || "starter"),
      },
    });

    // Determine price
    const amountKobo = getPlanPriceKobo(normalizedPlan);
    const reference = `upg_${merchant.id.substring(0, 8)}_${Date.now()}`;

    const appUrl = getAppUrl();
    const method = (paymentMethod || "card") as PaymentMethod;
    const route = await resolvePaymentRoute("plan_upgrade", method, getPaymentEnvironmentForMerchantEmail(user.email || merchant.email));
    const fiatProvider =
      route.provider === "paystack"
        ? "paystack"
        : route.provider === "monnify"
          ? "monnify"
          : null;
    if (!fiatProvider) {
      throw new SoloPlusPaymentLifecycleError(
        "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED",
        "Unsupported checkout provider was selected for this fiat upgrade flow.",
      );
    }
    providerName = route.provider;
    logStage("provider_route_selected", {
      userId,
      merchantId,
      planCode,
      provider: route.provider,
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
      provider: route.provider,
    });
    const callback = new URL(`${appUrl}/settings/upgrade-success`);
    callback.searchParams.set("reference", reference);
    callback.searchParams.set("plan", storagePlan);
    callback.searchParams.set("provider", route.provider);
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip");
    const disclosureVersionToStore = VERIFICATION_DISCLOSURE_VERSION;

    await recordVerificationDisclosure(trustedSupabase, {
      planType: normalizedPlan,
      context: "upgrade",
      userId: user.id,
      merchantId: merchant.id,
      ipAddress,
      userAgent: request.headers.get("user-agent"),
      disclosureVersion: disclosureVersionToStore,
      deviceMetadata: { source: "upgrade_checkout" },
    });

    const metadata = {
      type: "subscription_upgrade",
      merchant_id: merchant.id,
      new_plan: storagePlan,
      new_plan_display_code: normalizedPlan,
      owner_name: ownerName || null,
      business_type: businessType || null,
      relationship_claim: (relationshipClaim as RelationshipClaim) || null,
      verification_disclosure_accepted: verificationDisclosureAccepted === true,
      verification_disclosure_version: disclosureVersionToStore,
      amount_expected_kobo: amountKobo,
      payment_method_requested: method,
      resolved_provider: route.provider,
      payment_purpose: "plan_upgrade",
    };

    const soloPlusPreparation = normalizedPlan === "solo_plus"
      ? await (async () => {
          logStage("solo_plus_preparation_started", {
            userId,
            merchantId,
            planCode,
            provider: route.provider,
          });
          const preparation = await prepareSoloPlusUpgradePayment({
            merchantId: merchant.id,
            customerEmail: user.email || merchant.email || "billing@deraledger.app",
            amountKobo,
            paymentMethod: method,
            provider: route.provider,
            metadata,
            serviceClient: trustedSupabase,
            diagnostics: (stage, event) => logStage(stage, {
              userId,
              merchantId,
              planCode,
              provider: route.provider,
              ...event,
            }),
          });
          return preparation;
        })()
      : null;
    const resolvedReference = soloPlusPreparation?.reference || reference;

    if (normalizedPlan !== "solo_plus") {
      paymentRecord = await createPendingPlanPaymentRecord(trustedSupabase, {
        internalReference: reference,
        provider: route.provider,
        paymentMethod: method,
        paymentPurpose: "plan_upgrade",
        customerEmail: user.email || merchant.email || "billing@deraledger.app",
        expectedAmount: amountKobo / 100,
        planName: normalizedPlan,
        planId: storagePlan,
        userId: user.id,
        merchantId: merchant.id,
        metadata,
      });
    }

    if (soloPlusPreparation) {
      paymentRecord = soloPlusPreparation.paymentRecord;
      const reusableInitialization = hasReusablePaymentInitialization(
        soloPlusPreparation.paymentRecord,
        fiatProvider,
      );

      if (reusableInitialization) {
        logStage("provider_session_reused", {
          userId,
          merchantId,
          planCode,
          provider: route.provider,
          paymentRecordId: soloPlusPreparation.paymentRecord.id,
          metadata: {
            replay: true,
            providerInitializationReused: true,
            completionMode: reusableInitialization.completionMode,
            hasAuthorizationUrl: Boolean(reusableInitialization.authorizationUrl),
            hasAccessCode: Boolean(reusableInitialization.accessCode),
            hasCheckoutUrl: Boolean(reusableInitialization.checkoutUrl),
            hasProviderTransactionReference: Boolean(
              reusableInitialization.providerTransactionReference,
            ),
          },
        });
        const response = buildUpgradeCheckoutResponse({
          provider: fiatProvider,
          paymentRecordId: soloPlusPreparation.paymentRecord.id,
          reference:
            reusableInitialization.providerReference || resolvedReference,
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
          provider: route.provider,
          paymentRecordId: soloPlusPreparation.paymentRecord.id,
          metadata: {
            completionMode: response.completionMode,
          },
        });

        return NextResponse.json(response);
      }

      const previousInitialization = readPaymentInitializationSnapshot(
        soloPlusPreparation.paymentRecord.metadata,
      );
      await updatePlanPaymentRecordById(
        trustedSupabase,
        soloPlusPreparation.paymentRecord.id,
        {
          provider_reference: resolvedReference,
          metadata: mergePaymentInitializationSnapshot(
            soloPlusPreparation.paymentRecord.metadata,
            {
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
            },
          ),
        },
      );
    }

    logStage("provider_initialization_started", {
      userId,
      merchantId,
      planCode,
      provider: route.provider,
      metadata: {
        reference: resolvedReference,
        method,
      },
    });
    let result;
    try {
      result = await PaymentService.initializeTransaction({
        email: user.email || merchant.email || "billing@deraledger.app",
        amountKobo,
        reference: resolvedReference,
        callbackUrl: callback.toString(),
        metadata,
        paymentMethod: method,
      }, fiatProvider);
    } catch (error) {
      if (soloPlusPreparation) {
        await updatePlanPaymentRecordById(
          trustedSupabase,
          soloPlusPreparation.paymentRecord.id,
          {
            provider_reference: resolvedReference,
            metadata: mergePaymentInitializationSnapshot(
              soloPlusPreparation.paymentRecord.metadata,
              {
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
                  error instanceof Error ? error.message : "Provider initialization failed.",
                initializedAt: null,
                lastUpdatedAt: new Date().toISOString(),
              },
            ),
            failure_reason:
              error instanceof Error ? error.message : "Provider initialization failed.",
          },
        );

        if (
          error instanceof Error &&
          /duplicate transaction reference/i.test(error.message)
        ) {
          throw new SoloPlusPaymentLifecycleError(
            "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED",
            "Solo Plus payment already has an unrecoverable provider checkout reference for this attempt. Resume the existing checkout if available or recover the current payment record before creating a new attempt.",
          );
        }
      }

      throw error;
    }

    if (soloPlusPreparation) {
      const completionMode =
        fiatProvider === "paystack"
          ? "paystack_resume"
          : "hosted_checkout_redirect";
      const providerTransactionReference =
        fiatProvider === "monnify" ? result.accessCode : null;
      const checkoutUrl =
        fiatProvider === "monnify" ? result.authorizationUrl : null;
      await updatePlanPaymentRecordById(
        trustedSupabase,
        soloPlusPreparation.paymentRecord.id,
        {
          provider_reference: result.reference || resolvedReference,
          metadata: mergePaymentInitializationSnapshot(
            soloPlusPreparation.paymentRecord.metadata,
            {
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
            },
          ),
          failure_reason: null,
        },
      );
    }
    logStage("provider_initialization_completed", {
      userId,
      merchantId,
      planCode,
      provider: route.provider,
      paymentRecordId:
        paymentRecord?.id || soloPlusPreparation?.paymentRecord.id || null,
      metadata: {
        completionMode:
          fiatProvider === "paystack"
            ? "paystack_resume"
            : "hosted_checkout_redirect",
        hasAuthorizationUrl: Boolean(result.authorizationUrl),
        hasAccessCode: Boolean(result.accessCode),
        hasCheckoutUrl:
          fiatProvider === "monnify"
            ? Boolean(result.authorizationUrl)
            : false,
        hasProviderTransactionReference:
          fiatProvider === "monnify"
            ? Boolean(result.accessCode)
            : false,
        returnedReferenceMatches: result.reference === resolvedReference,
        replay: Boolean(soloPlusPreparation?.replay),
        providerInitializationReused: false,
      },
    });
    const response = buildUpgradeCheckoutResponse({
      provider: fiatProvider,
      paymentRecordId:
        paymentRecord?.id ||
        soloPlusPreparation?.paymentRecord.id ||
        resolvedReference,
      reference: result.reference || resolvedReference,
      replay: Boolean(soloPlusPreparation?.replay),
      providerInitializationReused: false,
      requestId,
      initialization: {
        accessCode: fiatProvider === "paystack" ? result.accessCode : null,
        authorizationUrl:
          fiatProvider === "paystack" ? result.authorizationUrl : undefined,
        checkoutUrl:
          fiatProvider === "monnify" ? result.authorizationUrl : null,
        providerTransactionReference:
          fiatProvider === "monnify" ? result.accessCode : null,
      },
    });
    logStage("response_ready", {
      userId,
      merchantId,
      planCode,
      provider: route.provider,
      paymentRecordId:
        paymentRecord?.id || soloPlusPreparation?.paymentRecord.id || null,
      metadata: {
        completionMode: response.completionMode,
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
    console.error("Upgrade initialization failed:", {
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
