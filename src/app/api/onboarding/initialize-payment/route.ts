import { NextResponse } from "next/server";
import { PaymentService } from "@/lib/payment";
import crypto from "crypto";
import { getAppUrl } from "@/lib/server-utils";
import { requiresVerificationDisclosure, VERIFICATION_DISCLOSURE_VERSION } from "@/lib/services/onboarding-flow.service";
import { getPaymentEnvironmentForMerchantEmail, resolvePaymentRoute, type PaymentMethod } from "@/lib/services/payment-routing.service";

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

  if (requiresVerificationDisclosure(plan) && verificationDisclosureAccepted !== true) {
    return NextResponse.json(
      { error: "Please acknowledge the verification disclosure before payment." },
      { status: 400 }
    );
  }

  const appUrl = getAppUrl();
  // Unique reference per transaction
  const reference = `SUB-${plan.toUpperCase()}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

  try {
    const method = (paymentMethod || "card") as PaymentMethod;
    const route = await resolvePaymentRoute("plan_subscription", method, getPaymentEnvironmentForMerchantEmail(email));
    const callback = new URL(`${appUrl}/onboarding/payment-callback`);
    callback.searchParams.set("provider", route.provider);
    const result = await PaymentService.initializeTransaction({
      email,
      amountKobo,
      reference,
      callbackUrl: callback.toString(),
      metadata: {
        type: "subscription",
        plan,
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
      },
      paymentMethod: method,
    }, route.provider === "monnify" ? "monnify" : "paystack");

    return NextResponse.json({
      authorizationUrl: result.authorizationUrl,
      accessCode: result.accessCode,
      reference,
      provider: route.provider,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Payment initialization failed";
    console.error("Payment init error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
