"use client";

export type PaystackResumeTransaction = {
  reference?: string;
};

export type PaystackResumeCallbacks = {
  onSuccess?: (transaction: PaystackResumeTransaction) => void;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
};

type PaystackInlineInstance = {
  resumeTransaction: (
    accessCode: string,
    callbacks?: PaystackResumeCallbacks,
  ) => unknown;
};

type PaystackInlineConstructor = new () => PaystackInlineInstance;

export type PaystackInlineModuleLoader = () => Promise<unknown>;

export class PaystackCheckoutSdkError extends Error {
  readonly code:
    | "PAYSTACK_CHECKOUT_ACCESS_CODE_MISSING"
    | "PAYSTACK_CHECKOUT_BROWSER_ONLY"
    | "PAYSTACK_CHECKOUT_OPEN_FAILED"
    | "PAYSTACK_CHECKOUT_SDK_UNAVAILABLE";

  constructor(
    code: PaystackCheckoutSdkError["code"],
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PaystackCheckoutSdkError";
    this.code = code;
  }
}

function unwrapPaystackInlineConstructor(
  moduleValue: unknown,
): PaystackInlineConstructor {
  const candidate =
    typeof moduleValue === "function"
      ? moduleValue
      : moduleValue &&
          typeof moduleValue === "object" &&
          "default" in moduleValue
        ? (moduleValue as { default?: unknown }).default
        : null;

  if (typeof candidate !== "function") {
    throw new PaystackCheckoutSdkError(
      "PAYSTACK_CHECKOUT_SDK_UNAVAILABLE",
      "Paystack checkout SDK could not be loaded.",
    );
  }

  return candidate as PaystackInlineConstructor;
}

async function loadPaystackInlineModule() {
  return import("@paystack/inline-js");
}

export async function resumePaystackCheckout(
  accessCode: string,
  callbacks: PaystackResumeCallbacks,
  loadModule: PaystackInlineModuleLoader = loadPaystackInlineModule,
) {
  const normalizedAccessCode = accessCode.trim();
  if (!normalizedAccessCode) {
    throw new PaystackCheckoutSdkError(
      "PAYSTACK_CHECKOUT_ACCESS_CODE_MISSING",
      "Paystack checkout access code is missing.",
    );
  }

  if (typeof window === "undefined") {
    throw new PaystackCheckoutSdkError(
      "PAYSTACK_CHECKOUT_BROWSER_ONLY",
      "Paystack checkout can only open in the browser.",
    );
  }

  let PaystackInline: PaystackInlineConstructor;
  try {
    PaystackInline = unwrapPaystackInlineConstructor(await loadModule());
  } catch (error) {
    if (error instanceof PaystackCheckoutSdkError) {
      throw error;
    }
    throw new PaystackCheckoutSdkError(
      "PAYSTACK_CHECKOUT_SDK_UNAVAILABLE",
      "Paystack checkout SDK could not be loaded.",
      { cause: error },
    );
  }

  let popup: PaystackInlineInstance;
  try {
    popup = new PaystackInline();
  } catch (error) {
    throw new PaystackCheckoutSdkError(
      "PAYSTACK_CHECKOUT_SDK_UNAVAILABLE",
      "Paystack checkout SDK could not be started.",
      { cause: error },
    );
  }

  if (typeof popup.resumeTransaction !== "function") {
    throw new PaystackCheckoutSdkError(
      "PAYSTACK_CHECKOUT_SDK_UNAVAILABLE",
      "Paystack checkout SDK does not support transaction resume.",
    );
  }

  try {
    return popup.resumeTransaction(normalizedAccessCode, callbacks);
  } catch (error) {
    throw new PaystackCheckoutSdkError(
      "PAYSTACK_CHECKOUT_OPEN_FAILED",
      "Paystack checkout could not open.",
      { cause: error },
    );
  }
}
