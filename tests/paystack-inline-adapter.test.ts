import assert from "node:assert/strict";

import {
  PaystackCheckoutSdkError,
  resumePaystackCheckout,
  type PaystackResumeCallbacks,
} from "../src/lib/checkout/paystack-inline";

async function run() {
  const previousWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};

  try {
    let constructed = 0;
    let resumeCalls = 0;
    let receivedAccessCode: string | null = null;
    const receivedCallbacks: PaystackResumeCallbacks[] = [];

    class FakePaystackInline {
      constructor() {
        constructed += 1;
      }

      resumeTransaction(
        accessCode: string,
        callbacks?: PaystackResumeCallbacks,
      ) {
        resumeCalls += 1;
        receivedAccessCode = accessCode;
        if (callbacks) {
          receivedCallbacks.push(callbacks);
        }
      }
    }

    await resumePaystackCheckout(
      "  ACCESS_FROM_BACKEND  ",
      {
        onSuccess: () => undefined,
      },
      async () => ({
        default: FakePaystackInline,
        moduleNamespaceMustNotBeConstructed: true,
      }),
    );

    assert.equal(constructed, 1);
    assert.equal(resumeCalls, 1);
    assert.equal(
      receivedAccessCode,
      "ACCESS_FROM_BACKEND",
      "Paystack resume should receive the exact backend access code after trimming.",
    );
    assert.equal(receivedCallbacks.length, 1);
    assert.equal(typeof receivedCallbacks[0]?.onSuccess, "function");

    await assert.rejects(
      () =>
        resumePaystackCheckout(
          "",
          {},
          async () => ({ default: FakePaystackInline }),
        ),
      (error: unknown) =>
        error instanceof PaystackCheckoutSdkError &&
        error.code === "PAYSTACK_CHECKOUT_ACCESS_CODE_MISSING",
      "Missing access codes should fail with a controlled SDK error.",
    );

    await assert.rejects(
      () =>
        resumePaystackCheckout(
          "ACCESS_FROM_BACKEND",
          {},
          async () => ({ default: { not: "constructable" } }),
        ),
      (error: unknown) =>
        error instanceof PaystackCheckoutSdkError &&
        error.code === "PAYSTACK_CHECKOUT_SDK_UNAVAILABLE",
      "A non-constructable default export should become a controlled SDK error.",
    );

    class ThrowingPaystackInline {
      resumeTransaction() {
        throw new Error("PaystackPop is not a constructor");
      }
    }

    await assert.rejects(
      () =>
        resumePaystackCheckout(
          "ACCESS_FROM_BACKEND",
          {},
          async () => ({ default: ThrowingPaystackInline }),
        ),
      (error: unknown) =>
        error instanceof PaystackCheckoutSdkError &&
        error.code === "PAYSTACK_CHECKOUT_OPEN_FAILED" &&
        !error.message.includes("PaystackPop is not a constructor"),
      "Raw SDK errors should be wrapped before the UI sees them.",
    );

    delete (globalThis as { window?: unknown }).window;
    await assert.rejects(
      () =>
        resumePaystackCheckout(
          "ACCESS_FROM_BACKEND",
          {},
          async () => ({ default: FakePaystackInline }),
        ),
      (error: unknown) =>
        error instanceof PaystackCheckoutSdkError &&
        error.code === "PAYSTACK_CHECKOUT_BROWSER_ONLY",
      "The Paystack adapter should execute only in the browser.",
    );
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
  }

  console.log("paystack-inline-adapter.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
