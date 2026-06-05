import { randomBytes, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type SupportedProvider = "paystack" | "monnify" | "breet";
type PlanPaymentPurpose = "plan_subscription" | "plan_upgrade";
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
  businessId?: string | null;
  metadata?: Record<string, unknown>;
  passwordSetupRequired?: boolean;
  expiresAt?: string | null;
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
  customer_email: string | null;
  setup_recovery_email_sent_at: string | null;
};

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

  const { error } = await supabase.from("payment_records").upsert(
    {
      user_id: input.userId || null,
      merchant_id: input.merchantId || null,
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
  );

  if (error) {
    throw new Error(`Failed to create pending payment record: ${error.message}`);
  }
}

export async function upsertWebhookAuditEvent(
  supabase: SupabaseClient,
  input: WebhookEventInput
) {
  const { error } = await supabase.from("payment_events").upsert(
    {
      merchant_id: input.merchantId || null,
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
    .select("internal_reference, provider_name, provider_reference, payment_purpose, payment_status, processing_status, account_setup_status, password_setup_required, merchant_id, customer_email, setup_recovery_email_sent_at")
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
