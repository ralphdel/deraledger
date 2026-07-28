export type UpgradeCheckoutCompletionMode =
  | "paystack_resume"
  | "hosted_checkout_redirect";

export type PaystackUpgradeCheckoutResponse = {
  provider: "paystack";
  completionMode: "paystack_resume";
  paymentRecordId: string;
  reference: string;
  accessCode: string;
  authorizationUrl?: string;
  replay: boolean;
  providerInitializationReused: boolean;
  requestId: string;
};

export type MonnifyUpgradeCheckoutResponse = {
  provider: "monnify";
  completionMode: "hosted_checkout_redirect";
  paymentRecordId: string;
  reference: string;
  checkoutUrl: string;
  providerTransactionReference?: string;
  replay: boolean;
  providerInitializationReused: boolean;
  requestId: string;
};

export type UpgradeCheckoutResponse =
  | PaystackUpgradeCheckoutResponse
  | MonnifyUpgradeCheckoutResponse;

export class UnsupportedCheckoutCompletionModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedCheckoutCompletionModeError";
  }
}

type CheckoutResponseRecord = Record<string, unknown>;

function asRecord(value: unknown): CheckoutResponseRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as CheckoutResponseRecord)
    : null;
}

function readRequiredText(
  candidate: CheckoutResponseRecord,
  key: string,
): string {
  const value = candidate[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new UnsupportedCheckoutCompletionModeError(
      `Upgrade checkout response is missing ${key}.`,
    );
  }

  return value;
}

function readOptionalText(
  candidate: CheckoutResponseRecord,
  key: string,
): string | undefined {
  const value = candidate[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readBoolean(candidate: CheckoutResponseRecord, key: string) {
  return candidate[key] === true;
}

export function parseUpgradeCheckoutResponse(
  value: unknown,
): UpgradeCheckoutResponse {
  const candidate = asRecord(value);

  if (!candidate) {
    throw new UnsupportedCheckoutCompletionModeError(
      "Upgrade checkout response is not an object.",
    );
  }

  const provider = readRequiredText(candidate, "provider");
  const completionMode = readRequiredText(candidate, "completionMode");
  const paymentRecordId = readRequiredText(candidate, "paymentRecordId");
  const reference = readRequiredText(candidate, "reference");
  const requestId = readRequiredText(candidate, "requestId");
  const replay = readBoolean(candidate, "replay");
  const providerInitializationReused = readBoolean(
    candidate,
    "providerInitializationReused",
  );

  if (provider === "paystack" && completionMode === "paystack_resume") {
    return {
      provider,
      completionMode,
      paymentRecordId,
      reference,
      accessCode: readRequiredText(candidate, "accessCode"),
      authorizationUrl: readOptionalText(candidate, "authorizationUrl"),
      replay,
      providerInitializationReused,
      requestId,
    };
  }

  if (provider === "monnify" && completionMode === "hosted_checkout_redirect") {
    return {
      provider,
      completionMode,
      paymentRecordId,
      reference,
      checkoutUrl: readRequiredText(candidate, "checkoutUrl"),
      providerTransactionReference: readOptionalText(
        candidate,
        "providerTransactionReference",
      ),
      replay,
      providerInitializationReused,
      requestId,
    };
  }

  throw new UnsupportedCheckoutCompletionModeError(
    `Unsupported upgrade checkout completion: ${provider}:${completionMode}.`,
  );
}

export function getUpgradeCheckoutSessionKey(
  response: UpgradeCheckoutResponse,
) {
  if (response.completionMode === "paystack_resume") {
    return `${response.paymentRecordId}:${response.completionMode}:${response.accessCode}`;
  }

  return `${response.paymentRecordId}:${response.completionMode}:${response.checkoutUrl}`;
}
