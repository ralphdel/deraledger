import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPlanPriceKobo,
  getStoragePlanCode,
  parsePaidPlanCode,
  type CanonicalPlanCode,
} from "@/lib/plans";
import {
  findFullPaymentRecordByReference,
  type PendingPlanPaymentRecord,
} from "@/lib/services/plan-payment-recovery.service";

type UpgradeProvider = "paystack" | "monnify" | "breet";
type UpgradePlan = Exclude<CanonicalPlanCode, "starter" | "solo_plus">;

export type PaidUpgradeIntent = {
  paymentRecordId: string;
  userId: string;
  merchantId: string;
  plan: UpgradePlan;
  storagePlan: "individual" | "business";
  expectedAmountKobo: number;
  purpose: "plan_upgrade";
  provider: UpgradeProvider;
  currency: "NGN";
  email: string;
  internalReference: string;
  existingProviderReference: string | null;
  status: "pending" | "processed";
  record: PendingPlanPaymentRecord;
};

export type PaidUpgradeProviderObservation = {
  provider: UpgradeProvider;
  reference: string;
  providerReference: string | null;
  amountKobo: number;
  currency: string | null;
  customerEmail: string | null;
  metadata: Record<string, unknown>;
  rawProviderPayload?: Record<string, unknown> | null;
};

export type PaidUpgradeConfirmationCode =
  | "PAYMENT_RECORD_NOT_FOUND"
  | "PAYMENT_RECORD_NOT_PENDING"
  | "PAYMENT_RECORD_IDENTITY_MISMATCH"
  | "INVALID_PAYMENT_PURPOSE"
  | "INVALID_UPGRADE_PLAN"
  | "INVALID_EXPECTED_AMOUNT"
  | "INVALID_PAYMENT_PROVIDER"
  | "INVALID_PAYMENT_CURRENCY"
  | "INVALID_CUSTOMER_EMAIL"
  | "PROVIDER_MISMATCH"
  | "REFERENCE_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "EMAIL_MISMATCH"
  | "MERCHANT_MISMATCH"
  | "PLAN_MISMATCH"
  | "PURPOSE_MISMATCH"
  | "ATOMIC_ACTIVATION_FAILED";

export class PaidUpgradeConfirmationError extends Error {
  constructor(
    public readonly code: PaidUpgradeConfirmationCode,
    message: string,
  ) {
    super(message);
    this.name = "PaidUpgradeConfirmationError";
  }
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedEmail(value: unknown) {
  return textValue(value)?.toLowerCase() || null;
}

function normalizedProvider(value: unknown): UpgradeProvider | null {
  const provider = textValue(value)?.toLowerCase();
  return provider === "paystack" || provider === "monnify" || provider === "breet"
    ? provider
    : null;
}

function canonicalRecordPlan(record: PendingPlanPaymentRecord): UpgradePlan | null {
  const planId = parsePaidPlanCode(record.plan_id);
  const planName = parsePaidPlanCode(record.plan_name);
  if (!planId || !planName || planId !== planName || planId === "solo_plus") {
    return null;
  }
  return planId;
}

function isProcessedRecord(record: PendingPlanPaymentRecord) {
  return record.payment_status === "successful" &&
    record.processing_status === "processed" &&
    record.account_setup_status === "paid_pending_setup";
}

export function validatePaidUpgradeIntent(
  record: PendingPlanPaymentRecord,
  authenticatedUser?: { id: string; email?: string | null },
): PaidUpgradeIntent {
  if (record.payment_purpose !== "plan_upgrade") {
    throw new PaidUpgradeConfirmationError(
      "INVALID_PAYMENT_PURPOSE",
      "The payment record is not a paid upgrade intent.",
    );
  }

  const plan = canonicalRecordPlan(record);
  if (!plan) {
    throw new PaidUpgradeConfirmationError(
      "INVALID_UPGRADE_PLAN",
      "The payment record does not contain a supported paid upgrade plan.",
    );
  }

  const expectedAmountKobo = Math.round(Number(record.expected_amount) * 100);
  const canonicalAmountKobo = getPlanPriceKobo(plan);
  if (
    !Number.isFinite(expectedAmountKobo) ||
    expectedAmountKobo <= 0 ||
    canonicalAmountKobo <= 0 ||
    expectedAmountKobo !== canonicalAmountKobo
  ) {
    throw new PaidUpgradeConfirmationError(
      "INVALID_EXPECTED_AMOUNT",
      "The payment record expected amount is missing or does not match server pricing.",
    );
  }

  const provider = normalizedProvider(record.provider_name);
  if (!provider) {
    throw new PaidUpgradeConfirmationError(
      "INVALID_PAYMENT_PROVIDER",
      "The payment record does not contain a supported provider.",
    );
  }

  if (textValue(record.currency)?.toUpperCase() !== "NGN") {
    throw new PaidUpgradeConfirmationError(
      "INVALID_PAYMENT_CURRENCY",
      "The payment record currency is not NGN.",
    );
  }

  const email = normalizedEmail(record.customer_email);
  if (!email) {
    throw new PaidUpgradeConfirmationError(
      "INVALID_CUSTOMER_EMAIL",
      "The payment record customer email is missing.",
    );
  }

  if (!record.user_id || !record.merchant_id || !textValue(record.internal_reference)) {
    throw new PaidUpgradeConfirmationError(
      "PAYMENT_RECORD_IDENTITY_MISMATCH",
      "The payment record is not bound to a user, merchant, and reference.",
    );
  }

  const pending = record.payment_status === "pending" &&
    record.processing_status === "pending_payment" &&
    record.account_setup_status === "pending_payment";
  const processed = isProcessedRecord(record);
  if (!pending && !processed) {
    throw new PaidUpgradeConfirmationError(
      "PAYMENT_RECORD_NOT_PENDING",
      "The payment record is not in a confirmable pending state.",
    );
  }

  if (authenticatedUser) {
    if (
      authenticatedUser.id !== record.user_id ||
      normalizedEmail(authenticatedUser.email) !== email
    ) {
      throw new PaidUpgradeConfirmationError(
        "PAYMENT_RECORD_IDENTITY_MISMATCH",
        "The authenticated user does not own this paid upgrade intent.",
      );
    }
  }

  return {
    paymentRecordId: record.id,
    userId: record.user_id,
    merchantId: record.merchant_id,
    plan,
    storagePlan: getStoragePlanCode(plan) as "individual" | "business",
    expectedAmountKobo,
    purpose: "plan_upgrade",
    provider,
    currency: "NGN",
    email,
    internalReference: record.internal_reference,
    existingProviderReference: record.provider_reference,
    status: processed ? "processed" : "pending",
    record,
  };
}

function requireMetadataMatch(
  condition: boolean,
  code: PaidUpgradeConfirmationCode,
  message: string,
) {
  if (!condition) {
    throw new PaidUpgradeConfirmationError(code, message);
  }
}

export function validatePaidUpgradeProviderObservation(
  intent: PaidUpgradeIntent,
  observed: PaidUpgradeProviderObservation,
) {
  requireMetadataMatch(
    observed.provider === intent.provider,
    "PROVIDER_MISMATCH",
    "The confirming provider does not match the pending payment record.",
  );
  requireMetadataMatch(
    textValue(observed.reference) === intent.internalReference,
    "REFERENCE_MISMATCH",
    "The confirmed payment reference does not match the pending payment record.",
  );
  requireMetadataMatch(
    Boolean(textValue(observed.providerReference)),
    "REFERENCE_MISMATCH",
    "The provider confirmation did not include a transaction reference.",
  );
  if (
    intent.existingProviderReference &&
    intent.existingProviderReference !== intent.internalReference
  ) {
    requireMetadataMatch(
      intent.existingProviderReference === observed.providerReference,
      "REFERENCE_MISMATCH",
      "The provider transaction reference does not match the initialized payment record.",
    );
  }
  requireMetadataMatch(
    Number.isInteger(observed.amountKobo) &&
      observed.amountKobo > 0 &&
      observed.amountKobo === intent.expectedAmountKobo,
    "AMOUNT_MISMATCH",
    "The confirmed amount does not match the pending payment record.",
  );
  requireMetadataMatch(
    textValue(observed.currency)?.toUpperCase() === intent.currency,
    "CURRENCY_MISMATCH",
    "The confirmed currency does not match the pending payment record.",
  );
  requireMetadataMatch(
    normalizedEmail(observed.customerEmail) === intent.email,
    "EMAIL_MISMATCH",
    "The confirmed customer email does not match the pending payment record.",
  );

  const metadata = observed.metadata;
  requireMetadataMatch(
    textValue(metadata.merchant_id) === intent.merchantId,
    "MERCHANT_MISMATCH",
    "The confirmed merchant does not match the pending payment record.",
  );
  const observedPlan = parsePaidPlanCode(textValue(metadata.new_plan));
  requireMetadataMatch(
    observedPlan === intent.plan,
    "PLAN_MISMATCH",
    "The confirmed plan does not match the pending payment record.",
  );
  requireMetadataMatch(
    textValue(metadata.type) === "subscription_upgrade" &&
      textValue(metadata.payment_purpose) === intent.purpose,
    "PURPOSE_MISMATCH",
    "The confirmed payment purpose does not match the pending payment record.",
  );
  requireMetadataMatch(
    normalizedProvider(metadata.resolved_provider) === intent.provider,
    "PROVIDER_MISMATCH",
    "The confirmed provider metadata does not match the pending payment record.",
  );
  requireMetadataMatch(
    normalizedEmail(metadata.email) === intent.email,
    "EMAIL_MISMATCH",
    "The confirmed email metadata does not match the pending payment record.",
  );
  requireMetadataMatch(
    Math.round(Number(metadata.amount_expected_kobo)) === intent.expectedAmountKobo,
    "AMOUNT_MISMATCH",
    "The confirmed expected amount metadata does not match the pending payment record.",
  );
}

export async function loadPaidUpgradeIntent(
  supabase: SupabaseClient,
  reference: string,
  authenticatedUser?: { id: string; email?: string | null },
) {
  const record = await findFullPaymentRecordByReference(supabase, reference);
  if (!record) {
    throw new PaidUpgradeConfirmationError(
      "PAYMENT_RECORD_NOT_FOUND",
      "The pending paid upgrade intent could not be found.",
    );
  }
  return validatePaidUpgradeIntent(record, authenticatedUser);
}

export async function confirmPaidUpgradeAtomically(
  supabase: SupabaseClient,
  observed: PaidUpgradeProviderObservation,
) {
  const intent = await loadPaidUpgradeIntent(supabase, observed.reference);
  validatePaidUpgradeProviderObservation(intent, observed);

  const { data, error } = await supabase.rpc("confirm_paid_upgrade_v1", {
    p_payment_record_id: intent.paymentRecordId,
    p_provider: observed.provider,
    p_internal_reference: observed.reference,
    p_provider_reference: observed.providerReference,
    p_amount_kobo: observed.amountKobo,
    p_currency: observed.currency,
    p_customer_email: observed.customerEmail,
    p_provider_metadata: observed.metadata,
    p_raw_provider_payload: observed.rawProviderPayload || observed.metadata,
  });

  if (error) {
    throw new PaidUpgradeConfirmationError(
      "ATOMIC_ACTIVATION_FAILED",
      `Paid upgrade activation failed atomically: ${error.message}`,
    );
  }

  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;
  if (result?.kind !== "applied" && result?.kind !== "idempotent_replay") {
    throw new PaidUpgradeConfirmationError(
      "ATOMIC_ACTIVATION_FAILED",
      `Paid upgrade activation was rejected: ${textValue(result?.reason) || "state conflict"}.`,
    );
  }

  return {
    intent,
    applied: result.kind === "applied",
    alreadyProcessed: result.kind === "idempotent_replay",
  };
}
