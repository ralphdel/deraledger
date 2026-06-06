import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { processSuccessfulFiatPayment } from "@/lib/services/fiat-payment-confirmation.service";
import {
  findPaymentRecordByReference,
  upsertWebhookAuditEvent,
} from "@/lib/services/plan-payment-recovery.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const { reference, provider } = await request.json();

  if (!reference) {
    return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  }

  const verification = await verifyProviderTransaction(reference, provider);
  if (!verification) {
    return NextResponse.json({ error: "Payment not verified" }, { status: 400 });
  }

  if (!verification.success) {
    await recordUnsuccessfulVerificationAttempt(reference, verification);
    return NextResponse.json({
      success: false,
      status: verification.processingStatus,
      message:
        verification.processingStatus === "manual_review"
          ? "Payment could not be completed automatically and needs manual review before activation."
          : "We could not confirm your setup automatically yet.",
      paymentReference: reference,
    }, { status: verification.processingStatus === "manual_review" ? 200 : 400 });
  }

  const payload = verification.raw;
  const metadata = asRecord(payload.metadata) || asRecord(payload.metaData) || {};
  const amountKobo = normalizeAmountKobo(payload);
  if (amountKobo <= 0) {
    return NextResponse.json({ error: "Payment amount missing from provider verification." }, { status: 400 });
  }

  const result = await processSuccessfulFiatPayment(supabase, {
    provider: verification.provider,
    metadata,
    amountKobo,
    reference,
    providerReference:
      stringValue(payload.provider_reference) ||
      stringValue(payload.transactionReference) ||
      stringValue(payload.id) ||
      reference,
    channel:
      stringValue(payload.channel) ||
      stringValue(payload.paymentMethod) ||
      stringValue(metadata.payment_method_requested) ||
      "card",
    feesKobo: normalizeOptionalKobo(payload.fees),
    settlementAmountKobo: normalizeOptionalKobo(payload.settlementAmount),
    rawProviderPayload: payload,
  });

  const paymentRecord = await findPaymentRecordByReference(supabase, reference, verification.provider);
  const accountSetupStatus = paymentRecord?.account_setup_status || null;

  if (("needs_review" in result && result.needs_review) || accountSetupStatus === "manual_review") {
    return NextResponse.json({
      success: false,
      status: "manual_review",
      message: "Payment was received, but the amount did not match the expected subscription amount. Our team will review it before activation.",
      paymentReference: reference,
    });
  }

  return NextResponse.json({
    success: true,
    status: accountSetupStatus || "paid_pending_setup",
    message:
      accountSetupStatus === "active"
        ? "Payment already processed and account setup is complete."
        : "Payment received. Continue account setup from the email we sent you.",
    paymentReference: reference,
    already_processed: result?.already_processed === true,
  });
}

async function verifyProviderTransaction(reference: string, provider?: string) {
  const providersToTry: Array<"paystack" | "monnify"> =
    provider === "monnify" ? ["monnify"] : provider === "paystack" ? ["paystack"] : ["paystack", "monnify"];

  for (const providerName of providersToTry) {
    try {
      const verified = await PaymentService.verifyTransaction(reference, providerName);
      const verifiedRecord = verified as Record<string, unknown>;
      const raw = asRecord(verifiedRecord.data) || verifiedRecord;
      const status =
        stringValue(verifiedRecord.status) ||
        stringValue(asRecord(verifiedRecord.data)?.status) ||
        stringValue(verifiedRecord.paymentStatus);
      if (status === "success" || status === "PAID") {
        return {
          provider: providerName,
          raw,
          success: true as const,
          processingStatus: "processed" as const,
        };
      }

      return {
        provider: providerName,
        raw,
        success: false as const,
        processingStatus: getVerificationProcessingStatus(raw, status),
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function recordUnsuccessfulVerificationAttempt(
  reference: string,
  verification: {
    provider: "paystack" | "monnify";
    raw: Record<string, unknown>;
    processingStatus: "received" | "manual_review" | "failed";
  }
) {
  const payload = verification.raw;
  const metadata = asRecord(payload.metadata) || asRecord(payload.metaData) || {};
  const paymentRecord = await findPaymentRecordByReference(supabase, reference, verification.provider);
  const paymentPurpose =
    stringValue(metadata.payment_purpose) ||
    normalizePaymentPurpose(stringValue(metadata.type)) ||
    paymentRecord?.payment_purpose ||
    null;
  const paymentMethod =
    stringValue(payload.channel) ||
    stringValue(payload.paymentMethod) ||
    stringValue(metadata.payment_method_requested) ||
    stringValue(metadata.payment_method);
  const paidAmount = normalizeAmountKobo(payload) / 100;
  const expectedAmount =
    normalizeOptionalKobo(metadata.amount_expected_kobo) !== null
      ? Number(metadata.amount_expected_kobo) / 100
      : null;
  const providerReference =
    stringValue(payload.provider_reference) ||
    stringValue(payload.transactionReference) ||
    stringValue(payload.id) ||
    reference;

  await upsertWebhookAuditEvent(supabase, {
    provider: verification.provider,
    eventType: `${verification.provider}.verification.${verification.processingStatus}`,
    paymentMethod,
    paymentPurpose,
    paymentReference: reference,
    providerReference,
    expectedAmount,
    paidAmount,
    currency: stringValue(payload.currency) || "NGN",
    fee: normalizeOptionalKobo(payload.fees) !== null ? Number(payload.fees) / 100 : null,
    planId: stringValue(metadata.new_plan) || stringValue(metadata.plan),
    merchantId: stringValue(metadata.merchant_id) || paymentRecord?.merchant_id || null,
    invoiceId: stringValue(metadata.invoice_id),
    customerEmail:
      stringValue(metadata.email) ||
      stringValue(asRecord(payload.customer)?.email) ||
      paymentRecord?.customer_email ||
      null,
    rawPayload: payload,
    processingStatus: verification.processingStatus,
    failureReason: getVerificationFailureReason(payload),
    idempotencyKey: `${verification.provider}:${providerReference || reference}:verification:${verification.processingStatus}`,
    settlementDestinationSource:
      paymentPurpose === "plan_subscription" || paymentPurpose === "plan_upgrade"
        ? "provider_dashboard"
        : null,
    reconciliationStatus: verification.processingStatus === "manual_review" ? "needs_review" : null,
  });
}

function getVerificationProcessingStatus(payload: Record<string, unknown>, status: string | null) {
  const normalized = `${status || ""} ${payload.paymentStatus || ""} ${payload.status || ""}`.toLowerCase();
  if (normalized.includes("under") || normalized.includes("partial") || normalized.includes("refund") || normalized.includes("reversed")) {
    return "manual_review" as const;
  }
  if (normalized.includes("fail") || normalized.includes("cancel") || normalized.includes("expire")) {
    return "failed" as const;
  }
  return "received" as const;
}

function getVerificationFailureReason(payload: Record<string, unknown>) {
  const status = stringValue(payload.paymentStatus) || stringValue(payload.status);
  if (!status) return "Provider verification did not confirm a successful payment.";
  return `Provider verification status: ${status}.`;
}

function normalizePaymentPurpose(type: string | null) {
  if (type === "subscription" || type === "subscription_renewal") return "plan_subscription";
  if (type === "subscription_upgrade") return "plan_upgrade";
  return type;
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeAmountKobo(payload: Record<string, unknown>) {
  const raw = payload.amount ?? payload.amountPaid;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed > 1000 ? Math.round(parsed) : Math.round(parsed * 100);
}

function normalizeOptionalKobo(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? (parsed > 1000 ? Math.round(parsed) : Math.round(parsed * 100)) : null;
}
