import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PaidOnboardingPaymentError,
  validatePaidOnboardingSessionBinding,
} from "../src/lib/services/paid-onboarding-payment.service";

const validSession = {
  id: "session-1",
  email: "owner@example.com",
  business_name: "Example Limited",
  plan: "individual",
  status: "awaiting_payment",
  expires_at: "2099-01-01T00:00:00.000Z",
};

function expectCode(fn: () => unknown, code: PaidOnboardingPaymentError["code"]) {
  assert.throws(fn, (error: unknown) =>
    error instanceof PaidOnboardingPaymentError && error.code === code);
}

async function run() {
  expectCode(() => validatePaidOnboardingSessionBinding({
    session: validSession,
    email: validSession.email,
    plan: "solo_lite",
    amountKobo: 100,
    mode: "initialize",
  }), "INVALID_AMOUNT");

  expectCode(() => validatePaidOnboardingSessionBinding({
    session: validSession,
    email: "attacker@example.com",
    plan: "solo_lite",
    amountKobo: 500_000,
    mode: "initialize",
  }), "SESSION_EMAIL_MISMATCH");

  expectCode(() => validatePaidOnboardingSessionBinding({
    session: validSession,
    email: validSession.email,
    plan: "business",
    amountKobo: 2_000_000,
    mode: "initialize",
  }), "SESSION_PLAN_MISMATCH");

  expectCode(() => validatePaidOnboardingSessionBinding({
    session: { ...validSession, expires_at: "2020-01-01T00:00:00.000Z" },
    email: validSession.email,
    plan: "solo_lite",
    amountKobo: 500_000,
    mode: "initialize",
  }), "SESSION_EXPIRED");

  expectCode(() => validatePaidOnboardingSessionBinding({
    session: { ...validSession, status: "payment_confirmed" },
    email: validSession.email,
    plan: "solo_lite",
    amountKobo: 500_000,
    mode: "initialize",
  }), "SESSION_NOT_PAYABLE");

  expectCode(() => validatePaidOnboardingSessionBinding({
    session: { ...validSession, plan: "starter" },
    email: validSession.email,
    plan: "starter",
    amountKobo: 0,
    mode: "initialize",
  }), "INVALID_PAID_PLAN");

  const correct = validatePaidOnboardingSessionBinding({
    session: validSession,
    email: " OWNER@example.com ",
    plan: "solo_lite",
    amountKobo: 500_000,
    mode: "initialize",
  });
  assert.equal(correct.amountKobo, 500_000);
  assert.equal(correct.storagePlan, "individual");

  const fiatRoute = readFileSync("src/app/api/onboarding/initialize-payment/route.ts", "utf8");
  const cryptoRoute = readFileSync("src/app/api/checkout/crypto-subscription/route.ts", "utf8");
  const checkoutPage = readFileSync("src/app/checkout/subscription/page.tsx", "utf8");
  const confirmation = readFileSync("src/lib/services/fiat-payment-confirmation.service.ts", "utf8");
  assert.match(fiatRoute, /loadAndValidatePaidOnboardingSession/);
  assert.match(fiatRoute, /amountKobo: canonicalAmountKobo/);
  assert.match(cryptoRoute, /assertCanonicalPaidAmount/);
  assert.match(cryptoRoute, /amount_expected_kobo: canonicalAmountKobo/);
  assert.match(checkoutPage, /amount: data\.amountKobo \?\? checkoutData\.amountKobo/);

  const initialConfirmation = confirmation.slice(
    confirmation.indexOf("async function confirmInitialSubscription"),
    confirmation.indexOf("async function confirmInvoicePayment"),
  );
  assert.ok(
    initialConfirmation.indexOf("loadAndValidatePaidOnboardingSession") <
      initialConfirmation.indexOf("supabase.auth.admin.createUser"),
    "Session binding must be verified before any user or paid workspace activation.",
  );
  assert.ok(
    initialConfirmation.indexOf("const mismatch = classifyAmountMismatch") <
      initialConfirmation.indexOf("supabase.auth.admin.createUser"),
    "Amount mismatch must enter manual review before provisioning.",
  );
  assert.match(confirmation, /processing_status: "manual_review"[\s\S]+account_setup_status: "manual_review"/);

  console.log("paid-onboarding-safety tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
