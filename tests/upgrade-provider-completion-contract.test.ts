import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseUpgradeCheckoutResponse,
  UnsupportedCheckoutCompletionModeError,
} from "../src/lib/checkout/provider-completion";

async function run() {
  const paystack = parseUpgradeCheckoutResponse({
    provider: "paystack",
    completionMode: "paystack_resume",
    paymentRecordId: "425fa617-d714-4d1c-9db8-4f46cb98bff1",
    reference: "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1",
    accessCode: "ACCESS_CODE",
    authorizationUrl: "https://checkout.paystack.test/authorize",
    replay: true,
    providerInitializationReused: true,
    requestId: "662424c4-91ae-4eca-b178-7cfcac4340bc",
  });
  assert.equal(paystack.provider, "paystack");
  assert.equal(paystack.completionMode, "paystack_resume");
  assert.equal(paystack.accessCode, "ACCESS_CODE");

  const monnify = parseUpgradeCheckoutResponse({
    provider: "monnify",
    completionMode: "hosted_checkout_redirect",
    paymentRecordId: "425fa617-d714-4d1c-9db8-4f46cb98bff1",
    reference: "SPL-UPG-425FA617D7144D1C9DB84F46CB98BFF1",
    checkoutUrl: "https://sandbox.monnify.com/checkout/abc",
    providerTransactionReference: "MNFY-TXN-1",
    replay: false,
    providerInitializationReused: false,
    requestId: "662424c4-91ae-4eca-b178-7cfcac4340bc",
  });
  assert.equal(monnify.provider, "monnify");
  assert.equal(monnify.completionMode, "hosted_checkout_redirect");
  assert.equal(monnify.checkoutUrl, "https://sandbox.monnify.com/checkout/abc");

  assert.throws(
    () =>
      parseUpgradeCheckoutResponse({
        provider: "paystack",
        completionMode: "paystack_resume",
        paymentRecordId: "payment-1",
        reference: "ref-1",
        access_code: "ACCESS_CODE",
        replay: false,
        providerInitializationReused: false,
        requestId: "request-1",
      }),
    UnsupportedCheckoutCompletionModeError,
    "The frontend should not guess snake_case provider fields.",
  );

  assert.throws(
    () =>
      parseUpgradeCheckoutResponse({
        provider: "monnify",
        completionMode: "paystack_resume",
        paymentRecordId: "payment-1",
        reference: "ref-1",
        accessCode: "ACCESS_CODE",
        replay: false,
        providerInitializationReused: false,
        requestId: "request-1",
      }),
    UnsupportedCheckoutCompletionModeError,
    "Invalid provider/completion-mode pairs must fail closed.",
  );

  const checkoutPageSource = readFileSync(
    "src/app/checkout/upgrade/[plan]/page.tsx",
    "utf8",
  );
  assert.match(
    checkoutPageSource,
    /parseUpgradeCheckoutResponse\(data\)/,
    "Checkout page should parse one normalized provider response contract.",
  );
  assert.match(
    checkoutPageSource,
    /switch \(normalizedResponse\.completionMode\)/,
    "Checkout page should dispatch explicitly by completion mode.",
  );
  assert.match(
    checkoutPageSource,
    /resumePaystackCheckout\(normalizedResponse\.accessCode/,
    "Paystack checkout should resume the initialized transaction through the client-only SDK adapter with the saved access code.",
  );
  assert.match(
    checkoutPageSource,
    /window\.location\.assign\(normalizedResponse\.checkoutUrl\)/,
    "Monnify checkout should redirect to the exact provider-returned checkout URL.",
  );
  assert.doesNotMatch(
    checkoutPageSource,
    /pop\.setup\(/,
    "Upgrade checkout must not create a second Paystack transaction after backend initialization.",
  );
  assert.doesNotMatch(
    checkoutPageSource,
    /openIframe\(/,
    "Upgrade checkout must not reopen Paystack using openIframe after backend initialization.",
  );
  assert.doesNotMatch(
    checkoutPageSource,
    /window\.PaystackPop|new PaystackPop/,
    "Upgrade checkout must not use the legacy Paystack global constructor.",
  );
  assert.match(
    checkoutPageSource,
    /Open checkout again/,
    "A popup-open failure should keep the session resumable locally.",
  );
  assert.match(
    checkoutPageSource,
    /Your payment session is ready, but the checkout window could not open/,
    "Checkout-open failures should show friendly customer copy.",
  );
  assert.doesNotMatch(
    checkoutPageSource,
    /PaystackPop is not a constructor|unrecoverable provider checkout reference/,
    "Raw SDK/provider recovery internals should not be rendered in checkout UI copy.",
  );

  const paystackAdapterSource = readFileSync(
    "src/lib/checkout/paystack-inline.ts",
    "utf8",
  );
  assert.match(
    paystackAdapterSource,
    /import\("@paystack\/inline-js"\)/,
    "Paystack InlineJS should be loaded only through a browser-time dynamic import.",
  );
  assert.match(
    paystackAdapterSource,
    /typeof moduleValue === "function"[\s\S]*"default" in moduleValue/,
    "The adapter should unwrap the package default export and never construct the module namespace object.",
  );
  assert.match(
    paystackAdapterSource,
    /new PaystackInline\(\)/,
    "The adapter should construct the verified Paystack InlineJS constructor.",
  );
  assert.match(
    paystackAdapterSource,
    /popup\.resumeTransaction\(normalizedAccessCode, callbacks\)/,
    "The adapter should resume the initialized provider session with the backend access code only.",
  );
  assert.doesNotMatch(
    paystackAdapterSource,
    /newTransaction\(|setup\(|openIframe\(/,
    "The adapter must not initialize a second Paystack transaction.",
  );

  const routeSource = readFileSync(
    "src/app/api/payment/upgrade/route.ts",
    "utf8",
  );
  assert.match(
    routeSource,
    /completionMode:\s*"paystack_resume"/,
    "Route should return the explicit Paystack completion mode.",
  );
  assert.match(
    routeSource,
    /completionMode:\s*"hosted_checkout_redirect"/,
    "Route should return the explicit Monnify completion mode.",
  );
  assert.match(
    routeSource,
    /provider_session_reused/,
    "Route should log provider session reuse without reinitializing the provider.",
  );

  console.log("upgrade-provider-completion-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
