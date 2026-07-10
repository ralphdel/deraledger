import { NextResponse } from "next/server";
import { PaymentService } from "@/lib/payment";
import crypto from "crypto";
import { getAppUrl } from "@/lib/server-utils";
import { requiresVerificationDisclosure, VERIFICATION_DISCLOSURE_VERSION } from "@/lib/services/onboarding-flow.service";
import { getPaymentEnvironmentForMerchantEmail, resolvePaymentRoute, type PaymentMethod } from "@/lib/services/payment-routing.service";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createPendingPlanPaymentRecord } from "@/lib/services/plan-payment-recovery.service";
import { assertPlanAvailable, getStoragePlanCode, normalizePlanCode } from "@/lib/plans";
import {
  prepareSoloPlusOnboardingPayment,
  SoloPlusPaymentLifecycleError,
} from "@/lib/solo-plus/server/payment-lifecycle";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const {
    email,
    tradingName,
    registeredName,
    ownerName,
    businessType,
    relationshipClaim,
    plan,
    sessionId,
    amountKobo,
    verificationDisclosureAccepted,
    disclosureVersion,
    paymentMethod,
  } = await request.json();

  if (!email || !tradingName || !registeredName || !plan || !sessionId || !amountKobo) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const normalizedPlan = normalizePlanCode(plan);
  const availability = await assertPlanAvailable(supabase, normalizedPlan);
  if (!availability.ok) {
    return NextResponse.json({ error: "This plan is not available right now." }, { status: 403 });
  }

  if (requiresVerificationDisclosure(normalizedPlan) && verificationDisclosureAccepted !== true) {
    return NextResponse.json(
      { error: "Please acknowledge the verification disclosure before payment." },
      { status: 400 }
    );
  }

  const storagePlan = getStoragePlanCode(normalizedPlan);

  const appUrl = getAppUrl();
  // Unique reference per transaction
  const reference = `SUB-${storagePlan.toUpperCase()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

  try {
    const method = (paymentMethod || "card") as PaymentMethod;
    const route = await resolvePaymentRoute("plan_subscription", method, getPaymentEnvironmentForMerchantEmail(email));
    const metadata = {
      type: "subscription",
      plan: storagePlan,
      plan_display_code: normalizedPlan,
      email,
      business_name: registeredName,
      trading_name: tradingName,
      owner_name: ownerName || null,
      business_type: businessType || null,
      relationship_claim: relationshipClaim || null,
      verification_disclosure_accepted: verificationDisclosureAccepted === true,
      verification_disclosure_version: disclosureVersion || VERIFICATION_DISCLOSURE_VERSION,
      session_id: sessionId,
      amount_expected_kobo: amountKobo,
      payment_method_requested: method,
      resolved_provider: route.provider,
      payment_purpose: "plan_subscription",
    };

    const resolvedReference = normalizedPlan === "solo_plus"
      ? (await prepareSoloPlusOnboardingPayment({
          onboardingSessionId: sessionId,
          customerEmail: email,
          amountKobo: Number(amountKobo),
          paymentMethod: method,
          provider: route.provider,
          metadata,
          serviceClient: supabase,
        })).reference
      : reference;

    if (normalizedPlan !== "solo_plus") {
      await createPendingPlanPaymentRecord(supabase, {
        internalReference: reference,
        provider: route.provider,
        paymentMethod: method,
        paymentPurpose: "plan_subscription",
        customerEmail: email,
        expectedAmount: Number(amountKobo) / 100,
        planName: normalizedPlan,
        planId: storagePlan,
        passwordSetupRequired: true,
        metadata,
      });
    }
    const callback = new URL(`${appUrl}/onboarding/payment-callback`);
    callback.searchParams.set("provider", route.provider);
    const result = await PaymentService.initializeTransaction({
      email,
      amountKobo,
      reference: resolvedReference,
      callbackUrl: callback.toString(),
      metadata,
      paymentMethod: method,
    }, route.provider === "monnify" ? "monnify" : "paystack");

    return NextResponse.json({
      authorizationUrl: result.authorizationUrl,
      accessCode: result.accessCode,
      reference: resolvedReference,
      provider: route.provider,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Payment initialization failed";
    console.error("Payment init error:", message);
    const status =
      err instanceof SoloPlusPaymentLifecycleError &&
      (err.code === "SOLO_PLUS_PAYMENT_INIT_CONFLICT" ||
        err.code === "SOLO_PLUS_PAYMENT_ALREADY_CONFIRMED")
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
