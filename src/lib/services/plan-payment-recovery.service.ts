import { randomBytes, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type SupportedProvider = "paystack" | "monnify" | "breet";
type PlanPaymentPurpose = "plan_subscription" | "plan_upgrade" | "plan_renewal";
type PaymentMethod = "card" | "bank_transfer" | "ussd" | "crypto";
type ProcessingStatus =
  | "pending_payment"
  | "received"
  | "processed"
  | "paid_pending_setup"
  | "active_pending_password"
  | "account_setup_completed"
  | "active"
  | "underpaid"
  | "overpaid"
  | "amount_mismatch"
  | "manual_review"
  | "failed";

type PendingPlanPaymentInput = {
  internalReference: string;
  provider: SupportedProvider;
  paymentMethod: PaymentMethod;
  paymentPurpose: PlanPaymentPurpose;
  customerEmail: string;
  expectedAmount: number;
  planName: string;
  planId?: string | null;
  userId?: string | null;
  merchantId?: string | null;
  onboardingSessionId?: string | null;
  soloPlusCaseId?: string | null;
  businessId?: string | null;
  metadata?: Record<string, unknown>;
  passwordSetupRequired?: boolean;
  expiresAt?: string | null;
};

export type PaymentInitializationStatus =
  | "created"
  | "initializing"
  | "initialized"
  | "initialization_failed"
  | "superseded";

export type PaymentInitializationSnapshot = {
  status: PaymentInitializationStatus;
  provider: SupportedProvider | null;
  completionMode: "paystack_resume" | "hosted_checkout_redirect" | null;
  providerReference: string | null;
  authorizationUrl: string | null;
  accessCode: string | null;
  checkoutUrl: string | null;
  providerTransactionReference: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  initializedAt: string | null;
  lastUpdatedAt: string | null;
};

export type PaymentRecoverySnapshot = {
  recoveryOfPaymentRecordId: string | null;
  replacementPaymentRecordId: string | null;
  idempotencyKey: string | null;
  recoveryCategory: string | null;
  recoveryReason: string | null;
  recoveredAt: string | null;
  supersededAt: string | null;
};

export type PendingPlanPaymentRecord = {
  id: string;
  internal_reference: string;
  provider_name: SupportedProvider | null;
  provider_reference: string | null;
  payment_purpose: string;
  payment_method: string | null;
  payment_status: string;
  processing_status: string | null;
  account_setup_status: string | null;
  merchant_id: string | null;
  onboarding_session_id: string | null;
  solo_plus_case_id: string | null;
  expected_amount: number | null;
  amount_paid: number | null;
  currency: string | null;
  customer_email: string | null;
  metadata: Record<string, unknown> | null;
  raw_provider_payload: Record<string, unknown> | null;
  failure_reason: string | null;
};

export type RecoverSoloPlusPendingPaymentInput = {
  oldPaymentRecordId: string;
  caseId: string;
  merchantId: string;
  recoveryIdempotencyKey: string;
  providerVerificationCategory: string;
  recoveryReason: string;
  newProvider: SupportedProvider;
  newPaymentMethod: PaymentMethod;
};

export type RecoverSoloPlusPendingPaymentResult = {
  kind: "applied" | "idempotent_replay";
  oldPayment: PendingPlanPaymentRecord;
  newPayment: PendingPlanPaymentRecord;
};

type WebhookEventInput = {
  provider: SupportedProvider;
  eventType: string;
  paymentMethod: PaymentMethod | string | null;
  paymentPurpose: string | null;
  paymentReference: string | null;
  providerReference: string | null;
  expectedAmount?: number | null;
  paidAmount?: number | null;
  currency?: string | null;
  fee?: number | null;
  planId?: string | null;
  subscriptionId?: string | null;
  merchantId?: string | null;
  businessId?: string | null;
  invoiceId?: string | null;
  customerEmail?: string | null;
  rawPayload: Record<string, unknown>;
  processingStatus: ProcessingStatus;
  failureReason?: string | null;
  idempotencyKey: string;
  settlementDestinationSource?: string | null;
  reconciliationStatus?: string | null;
};

type PaymentRecordLookup = {
  internal_reference: string;
  provider_name: SupportedProvider | null;
  provider_reference: string | null;
  payment_purpose: string;
  payment_status: string;
  processing_status: string | null;
  account_setup_status: string | null;
  password_setup_required: boolean | null;
  merchant_id: string | null;
  onboarding_session_id: string | null;
  solo_plus_case_id: string | null;
  customer_email: string | null;
  setup_recovery_email_sent_at: string | null;
  metadata: Record<string, unknown> | null;
  raw_provider_payload: Record<string, unknown> | null;
  failure_reason: string | null;
};

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeMetadata(value: unknown) {
  return asRecord(value) ?? {};
}

export function buildSoloPlusPaymentReference(
  paymentRecordId: string,
  purpose: Extract<PlanPaymentPurpose, "plan_subscription" | "plan_upgrade">,
) {
  const prefix = purpose === "plan_upgrade" ? "SPL-UPG" : "SPL-SUB";
  return `${prefix}-${paymentRecordId.replace(/-/g, "").toUpperCase()}`;
}

export function readPaymentInitializationSnapshot(
  metadata: Record<string, unknown> | null | undefined,
): PaymentInitializationSnapshot | null {
  const initialization = asRecord(metadata?.payment_initialization);
  const status = stringValue(initialization?.status);

  if (
    status !== "created" &&
    status !== "initializing" &&
    status !== "initialized" &&
    status !== "initialization_failed" &&
    status !== "superseded"
  ) {
    return null;
  }

  return {
    status,
    provider: stringValue(initialization?.provider) as SupportedProvider | null,
    completionMode:
      stringValue(initialization?.completionMode) === "paystack_resume" ||
      stringValue(initialization?.completionMode) === "hosted_checkout_redirect"
        ? (stringValue(initialization?.completionMode) as
            | "paystack_resume"
            | "hosted_checkout_redirect")
        : null,
    providerReference: stringValue(initialization?.providerReference),
    authorizationUrl: stringValue(initialization?.authorizationUrl),
    accessCode: stringValue(initialization?.accessCode),
    checkoutUrl: stringValue(initialization?.checkoutUrl),
    providerTransactionReference: stringValue(
      initialization?.providerTransactionReference,
    ),
    failureCode: stringValue(initialization?.failureCode),
    failureMessage: stringValue(initialization?.failureMessage),
    initializedAt: stringValue(initialization?.initializedAt),
    lastUpdatedAt: stringValue(initialization?.lastUpdatedAt),
  };
}

export function readPaymentRecoverySnapshot(
  metadata: Record<string, unknown> | null | undefined,
): PaymentRecoverySnapshot | null {
  const recovery = asRecord(metadata?.payment_recovery);

  if (!recovery) {
    return null;
  }

  return {
    recoveryOfPaymentRecordId: stringValue(recovery.recoveryOfPaymentRecordId),
    replacementPaymentRecordId: stringValue(recovery.replacementPaymentRecordId),
    idempotencyKey: stringValue(recovery.idempotencyKey),
    recoveryCategory: stringValue(recovery.recoveryCategory),
    recoveryReason: stringValue(recovery.recoveryReason),
    recoveredAt: stringValue(recovery.recoveredAt),
    supersededAt: stringValue(recovery.supersededAt),
  };
}

export function mergePaymentInitializationSnapshot(
  metadata: Record<string, unknown> | null | undefined,
  snapshot: PaymentInitializationSnapshot,
) {
  return {
    ...normalizeMetadata(metadata),
    payment_initialization: {
      status: snapshot.status,
      provider: snapshot.provider,
      completionMode: snapshot.completionMode,
      providerReference: snapshot.providerReference,
      authorizationUrl: snapshot.authorizationUrl,
      accessCode: snapshot.accessCode,
      checkoutUrl: snapshot.checkoutUrl,
      providerTransactionReference: snapshot.providerTransactionReference,
      failureCode: snapshot.failureCode,
      failureMessage: snapshot.failureMessage,
      initializedAt: snapshot.initializedAt,
      lastUpdatedAt: snapshot.lastUpdatedAt,
    },
  };
}

export function hasReusablePaymentInitialization(
  record: Pick<PendingPlanPaymentRecord, "metadata" | "provider_reference">,
  provider: SupportedProvider,
) {
  const snapshot = readPaymentInitializationSnapshot(record.metadata);

  if (!snapshot || snapshot.status !== "initialized") {
    return null;
  }

  if (snapshot.provider !== provider || !snapshot.providerReference) {
    return null;
  }

  if (provider === "paystack") {
    if (snapshot.completionMode !== "paystack_resume" || !snapshot.accessCode) {
      return null;
    }

    return snapshot;
  }

  if (provider === "monnify") {
    if (
      snapshot.completionMode !== "hosted_checkout_redirect" ||
      !snapshot.checkoutUrl
    ) {
      return null;
    }

    return snapshot;
  }

  return snapshot;
}

function settlementDestinationSourceFor(provider: SupportedProvider) {
  return provider === "breet" ? "per_address_api" : "provider_dashboard";
}

export async function createPendingPlanPaymentRecord(
  supabase: SupabaseClient,
  input: PendingPlanPaymentInput
) {
  const metadata = input.metadata || {};
  const expectedAmount = Number(input.expectedAmount || 0);
  const planName = input.planName;

  const { data, error } = await supabase.from("payment_records").upsert(
    {
      user_id: input.userId || null,
      merchant_id: input.merchantId || null,
      onboarding_session_id: input.onboardingSessionId || null,
      solo_plus_case_id: input.soloPlusCaseId || null,
      business_id: input.businessId || null,
      payment_purpose: input.paymentPurpose,
      payment_method: input.paymentMethod,
      provider_name: input.provider,
      internal_reference: input.internalReference,
      provider_reference: null,
      amount_paid: 0,
      expected_amount: expectedAmount,
      currency: "NGN",
      payment_status: "pending",
      processing_status: "pending_payment",
      account_setup_status: "pending_payment",
      password_setup_required: input.passwordSetupRequired === true,
      customer_email: input.customerEmail,
      plan_id: input.planId || planName,
      plan_name: planName,
      metadata,
      expires_at: input.expiresAt || null,
      settlement_destination_source: settlementDestinationSourceFor(input.provider),
      reconciliation_status: "pending_reconciliation",
      raw_provider_payload: metadata,
    },
    { onConflict: "internal_reference" }
  )
    .select("id, internal_reference, provider_name, provider_reference, payment_purpose, payment_method, payment_status, processing_status, account_setup_status, merchant_id, onboarding_session_id, solo_plus_case_id, expected_amount, amount_paid, currency, customer_email, metadata, raw_provider_payload, failure_reason")
    .single<PendingPlanPaymentRecord>();

  if (error || !data) {
    throw new Error(`Failed to create pending payment record: ${error?.message || "unknown error"}`);
  }

  if (
    data.solo_plus_case_id &&
    (data.payment_purpose === "plan_subscription" || data.payment_purpose === "plan_upgrade")
  ) {
    const canonicalReference = buildSoloPlusPaymentReference(data.id, data.payment_purpose);
    const nextMetadata = mergePaymentInitializationSnapshot(data.metadata, {
      status: "created",
      provider: data.provider_name,
      completionMode: data.provider_name === "paystack"
        ? "paystack_resume"
        : data.provider_name === "monnify"
          ? "hosted_checkout_redirect"
          : null,
      providerReference: canonicalReference,
      authorizationUrl: null,
      accessCode: null,
      checkoutUrl: null,
      providerTransactionReference: null,
      failureCode: null,
      failureMessage: null,
      initializedAt: null,
      lastUpdatedAt: new Date().toISOString(),
    });

    if (
      data.internal_reference !== canonicalReference ||
      data.provider_reference !== canonicalReference ||
      readPaymentInitializationSnapshot(data.metadata) == null
    ) {
      await updatePlanPaymentRecordById(supabase, data.id, {
        internal_reference: canonicalReference,
        provider_reference: canonicalReference,
        metadata: nextMetadata,
      });

      return {
        ...data,
        internal_reference: canonicalReference,
        provider_reference: canonicalReference,
        metadata: nextMetadata,
      };
    }
  }

  return data;
}

export async function upsertWebhookAuditEvent(
  supabase: SupabaseClient,
  input: WebhookEventInput
) {
  if (!input.merchantId) {
    throw new Error(
      `Merchant-owned payment_events audit requires merchantId for ${input.provider}:${input.eventType}:${input.paymentReference || input.providerReference || "unknown-reference"}.`,
    );
  }

  const { error } = await supabase.from("payment_events").upsert(
    {
      merchant_id: input.merchantId,
      invoice_id: input.invoiceId || null,
      event_type: input.eventType,
      processor: input.provider,
      processor_ref: input.providerReference || input.paymentReference,
      amount_kobo:
        input.paidAmount !== null && input.paidAmount !== undefined
          ? Math.round(Number(input.paidAmount) * 100)
          : null,
      raw_payload: input.rawPayload,
      idempotency_key: input.idempotencyKey,
      payment_method: input.paymentMethod,
      payment_purpose: input.paymentPurpose,
      payment_reference: input.paymentReference,
      provider_reference: input.providerReference,
      expected_amount: input.expectedAmount ?? null,
      paid_amount: input.paidAmount ?? null,
      currency: input.currency || "NGN",
      fee: input.fee ?? null,
      plan_id: input.planId || null,
      subscription_id: input.subscriptionId || null,
      business_id: input.businessId || null,
      customer_email: input.customerEmail || null,
      processing_status: input.processingStatus,
      failure_reason: input.failureReason || null,
      settlement_destination_source: input.settlementDestinationSource || settlementDestinationSourceFor(input.provider),
      reconciliation_status: input.reconciliationStatus || null,
    },
    { onConflict: "idempotency_key" }
  );

  if (error) {
    throw new Error(`Failed to record webhook audit event: ${error.message}`);
  }
}

export async function findPaymentRecordByReference(
  supabase: SupabaseClient,
  reference: string,
  provider?: SupportedProvider
) {
  let query = supabase
    .from("payment_records")
    .select("internal_reference, provider_name, provider_reference, payment_purpose, payment_status, processing_status, account_setup_status, password_setup_required, merchant_id, onboarding_session_id, solo_plus_case_id, customer_email, setup_recovery_email_sent_at, metadata, raw_provider_payload, failure_reason")
    .or(`internal_reference.eq.${reference},provider_reference.eq.${reference}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (provider) {
    query = query.eq("provider_name", provider);
  }

  const { data, error } = await query.maybeSingle<PaymentRecordLookup>();
  if (error) {
    throw new Error(`Failed to load payment record: ${error.message}`);
  }
  return data || null;
}

export async function findPendingSoloPlusPaymentByCaseId(
  supabase: SupabaseClient,
  soloPlusCaseId: string,
) {
  const { data, error } = await supabase
    .from("payment_records")
    .select("id, internal_reference, provider_name, provider_reference, payment_purpose, payment_method, payment_status, processing_status, account_setup_status, merchant_id, onboarding_session_id, solo_plus_case_id, expected_amount, amount_paid, currency, customer_email, metadata, raw_provider_payload, failure_reason")
    .eq("solo_plus_case_id", soloPlusCaseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<PendingPlanPaymentRecord>();

  if (error) {
    throw new Error(`Failed to load Solo Plus payment record: ${error.message}`);
  }

  return data || null;
}

export async function findFullPaymentRecordByReference(
  supabase: SupabaseClient,
  reference: string,
  provider?: SupportedProvider,
) {
  let query = supabase
    .from("payment_records")
    .select("id, internal_reference, provider_name, provider_reference, payment_purpose, payment_method, payment_status, processing_status, account_setup_status, merchant_id, onboarding_session_id, solo_plus_case_id, expected_amount, amount_paid, currency, customer_email, metadata, raw_provider_payload, failure_reason")
    .or(`internal_reference.eq.${reference},provider_reference.eq.${reference}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (provider) {
    query = query.eq("provider_name", provider);
  }

  const { data, error } = await query.maybeSingle<PendingPlanPaymentRecord>();
  if (error) {
    throw new Error(`Failed to load payment record: ${error.message}`);
  }

  return data || null;
}

export async function updatePlanPaymentRecord(
  supabase: SupabaseClient,
  reference: string,
  updates: Record<string, unknown>,
  provider?: SupportedProvider
) {
  let query = supabase
    .from("payment_records")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .or(`internal_reference.eq.${reference},provider_reference.eq.${reference}`);

  if (provider) {
    query = query.eq("provider_name", provider);
  }

  const { error } = await query;
  if (error) {
    throw new Error(`Failed to update payment record: ${error.message}`);
  }
}

export async function updatePlanPaymentRecordById(
  supabase: SupabaseClient,
  paymentRecordId: string,
  updates: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("payment_records")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentRecordId);

  if (error) {
    throw new Error(`Failed to update payment record: ${error.message}`);
  }
}

function normalizePendingPlanPaymentRecordRow(value: unknown) {
  const record = asRecord(value);

  if (!record) {
    throw new Error("Failed to parse pending payment recovery result.");
  }

  return record as unknown as PendingPlanPaymentRecord;
}

export async function recoverSoloPlusPendingPaymentRecord(
  supabase: SupabaseClient,
  input: RecoverSoloPlusPendingPaymentInput,
): Promise<RecoverSoloPlusPendingPaymentResult> {
  const { data, error } = await supabase.rpc("recover_solo_plus_payment_attempt_v1", {
    p_old_payment_record_id: input.oldPaymentRecordId,
    p_case_id: input.caseId,
    p_merchant_id: input.merchantId,
    p_recovery_idempotency_key: input.recoveryIdempotencyKey,
    p_provider_verification_category: input.providerVerificationCategory,
    p_recovery_reason: input.recoveryReason,
    p_new_provider_name: input.newProvider,
    p_new_payment_method: input.newPaymentMethod,
  });

  if (error) {
    throw new Error(`Failed to recover Solo Plus payment record: ${error.message}`);
  }

  const payload = asRecord(data);
  const kind = stringValue(payload?.kind);
  const oldPayment = normalizePendingPlanPaymentRecordRow(payload?.old_payment);
  const newPayment = normalizePendingPlanPaymentRecordRow(payload?.new_payment);

  if (kind !== "applied" && kind !== "idempotent_replay") {
    throw new Error("Failed to parse Solo Plus payment recovery outcome.");
  }

  return {
    kind,
    oldPayment,
    newPayment,
  };
}

export function classifyAmountMismatch(expectedAmountKobo: number, paidAmountKobo: number) {
  if (!expectedAmountKobo || !paidAmountKobo) {
    return null;
  }

  if (Math.round(expectedAmountKobo) === Math.round(paidAmountKobo)) {
    return null;
  }

  if (Math.round(paidAmountKobo) < Math.round(expectedAmountKobo)) {
    return {
      processingStatus: "underpaid" as const,
      message: `Payment amount mismatch: expected ${Math.round(expectedAmountKobo)}, got ${Math.round(paidAmountKobo)}.`,
    };
  }

  return {
    processingStatus: "overpaid" as const,
    message: `Payment amount mismatch: expected ${Math.round(expectedAmountKobo)}, got ${Math.round(paidAmountKobo)}.`,
  };
}

export function buildSetupRecoveryToken() {
  const token = randomBytes(24).toString("hex");
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  };
}
