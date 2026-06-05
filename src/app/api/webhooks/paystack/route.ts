import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { processSuccessfulFiatPayment } from "@/lib/services/fiat-payment-confirmation.service";
import {
  upsertWebhookAuditEvent,
  updatePlanPaymentRecord,
} from "@/lib/services/plan-payment-recovery.service";
import { getPaymentEnvironment } from "@/lib/services/payment-routing.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type PaystackWebhookPayload = {
  event?: string;
  data?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-paystack-signature") ?? "";
  const verification = PaymentService.verifyWebhook(body, signature, "paystack");

  let payload: PaystackWebhookPayload;
  try {
    payload = JSON.parse(body) as PaystackWebhookPayload;
  } catch {
    await recordWebhookHealth("failed");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizePaystackWebhook(payload);
  if (normalized) {
    await upsertWebhookAuditEvent(supabase, {
      provider: "paystack",
      eventType: payload.event || "paystack.webhook",
      paymentMethod: normalized.paymentMethod,
      paymentPurpose: normalized.paymentPurpose,
      paymentReference: normalized.reference,
      providerReference: normalized.providerReference,
      expectedAmount: normalized.expectedAmount,
      paidAmount: normalized.paidAmount,
      currency: normalized.currency,
      fee: normalized.fee,
      planId: normalized.planId,
      merchantId: normalized.merchantId,
      invoiceId: normalized.invoiceId,
      customerEmail: normalized.customerEmail,
      rawPayload: payload as Record<string, unknown>,
      processingStatus: verification.valid ? "received" : "failed",
      failureReason: verification.valid ? null : verification.error || "Signature mismatch",
      idempotencyKey: `paystack:${normalized.providerReference || normalized.reference}:${payload.event || "event"}:received`,
      settlementDestinationSource: normalized.settlementDestinationSource,
    });
  }

  if (process.env.NODE_ENV === "production" && !verification.valid) {
    await recordWebhookHealth("failed");
    return new NextResponse("Invalid signature", { status: 401 });
  }

  if (!normalized) {
    return NextResponse.json({ received: true, ignored: true });
  }

  if (payload.event !== "charge.success") {
    await recordWebhookHealth("success");
    return NextResponse.json({ received: true, ignored: true, event: payload.event || null });
  }

  try {
    const result = await processSuccessfulFiatPayment(supabase, {
      provider: "paystack",
      metadata: normalized.metadata,
      amountKobo: Math.round(normalized.paidAmount * 100),
      reference: normalized.reference,
      providerReference: normalized.providerReference,
      channel: normalized.channel,
      feesKobo: normalized.fee !== null ? Math.round(normalized.fee * 100) : null,
      rawProviderPayload: payload as Record<string, unknown>,
    });

    await upsertWebhookAuditEvent(supabase, {
      provider: "paystack",
      eventType: payload.event || "charge.success",
      paymentMethod: normalized.paymentMethod,
      paymentPurpose: normalized.paymentPurpose,
      paymentReference: normalized.reference,
      providerReference: normalized.providerReference,
      expectedAmount: normalized.expectedAmount,
      paidAmount: normalized.paidAmount,
      currency: normalized.currency,
      fee: normalized.fee,
      planId: normalized.planId,
      merchantId: normalized.merchantId,
      invoiceId: normalized.invoiceId,
      customerEmail: normalized.customerEmail,
      rawPayload: payload as Record<string, unknown>,
      processingStatus: "needs_review" in result && result.needs_review ? "manual_review" : "processed",
      failureReason: "needs_review" in result && result.needs_review ? "Amount mismatch requires manual review." : null,
      idempotencyKey: `paystack:${normalized.providerReference || normalized.reference}:${payload.event || "event"}:processed`,
      settlementDestinationSource: normalized.settlementDestinationSource,
      reconciliationStatus: "needs_review" in result && result.needs_review ? "needs_review" : "pending_reconciliation",
    });
    await recordWebhookHealth("success");

    return NextResponse.json({
      ...result,
      received: true,
      provider: "paystack",
      reference: normalized.reference,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    console.error("Paystack webhook processing failed:", error);
    await recordWebhookHealth("failed");
    await upsertWebhookAuditEvent(supabase, {
      provider: "paystack",
      eventType: payload.event || "charge.success",
      paymentMethod: normalized.paymentMethod,
      paymentPurpose: normalized.paymentPurpose,
      paymentReference: normalized.reference,
      providerReference: normalized.providerReference,
      expectedAmount: normalized.expectedAmount,
      paidAmount: normalized.paidAmount,
      currency: normalized.currency,
      fee: normalized.fee,
      planId: normalized.planId,
      merchantId: normalized.merchantId,
      invoiceId: normalized.invoiceId,
      customerEmail: normalized.customerEmail,
      rawPayload: payload as Record<string, unknown>,
      processingStatus: "failed",
      failureReason: message,
      idempotencyKey: `paystack:${normalized.providerReference || normalized.reference}:${payload.event || "event"}:failed`,
      settlementDestinationSource: normalized.settlementDestinationSource,
      reconciliationStatus: "needs_review",
    });

    if (normalized.paymentPurpose === "plan_subscription" || normalized.paymentPurpose === "plan_upgrade") {
      await updatePlanPaymentRecord(supabase, normalized.reference, {
        provider_reference: normalized.providerReference,
        amount_paid: normalized.paidAmount,
        payment_status: "failed",
        processing_status: "failed",
        account_setup_status: "manual_review",
        failure_reason: message,
        raw_provider_payload: payload as Record<string, unknown>,
      }, "paystack");
    }

    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

async function recordWebhookHealth(status: "success" | "failed") {
  const environment = getPaymentEnvironment();
  const now = new Date().toISOString();
  await supabase
    .from("payment_providers")
    .update(
      status === "success"
        ? { last_successful_webhook_at: now, updated_at: now }
        : { last_failed_webhook_at: now, updated_at: now }
    )
    .eq("provider_name", "paystack")
    .eq("environment", environment);
}

function normalizePaystackWebhook(payload: PaystackWebhookPayload) {
  const data = asRecord(payload.data);
  if (!data) {
    return null;
  }

  const metadata = asRecord(data.metadata) || {};
  const reference = stringValue(data.reference);
  const providerReference = stringValue(data.id) || reference;
  const amountKobo = numericValue(data.amount);
  const paidAmount = amountKobo !== null ? amountKobo / 100 : null;

  if (!reference || paidAmount === null) {
    return null;
  }

  const paymentType = stringValue(metadata.payment_purpose) ||
    normalizePaymentPurpose(stringValue(metadata.type));

  return {
    metadata,
    reference,
    providerReference,
    paymentPurpose: paymentType,
    paymentMethod:
      stringValue(metadata.payment_method_requested) ||
      stringValue(metadata.payment_method) ||
      stringValue(data.channel) ||
      "card",
    expectedAmount: numericValue(metadata.amount_expected_kobo) !== null
      ? Number(metadata.amount_expected_kobo) / 100
      : null,
    paidAmount,
    fee: numericValue(data.fees) !== null ? Number(data.fees) / 100 : null,
    currency: stringValue(data.currency) || "NGN",
    merchantId: stringValue(metadata.merchant_id),
    invoiceId: stringValue(metadata.invoice_id),
    customerEmail: stringValue(metadata.email) || stringValue(asRecord(data.customer)?.email),
    planId: stringValue(metadata.new_plan) || stringValue(metadata.plan),
    channel: stringValue(data.channel) || "card",
    settlementDestinationSource:
      paymentType === "plan_subscription" || paymentType === "plan_upgrade"
        ? "provider_dashboard"
        : null,
  };
}

function normalizePaymentPurpose(type: string | null) {
  if (type === "subscription" || type === "subscription_renewal") {
    return "plan_subscription";
  }
  if (type === "subscription_upgrade") {
    return "plan_upgrade";
  }
  return type || "invoice_payment";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numericValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
