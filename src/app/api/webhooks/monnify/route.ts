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

type MonnifyWebhookPayload = {
  eventType?: string;
  eventData?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const signature =
    request.headers.get("monnify-signature") ||
    request.headers.get("x-monnify-signature") ||
    "";
  const body = await request.text();
  const verification = PaymentService.verifyWebhook(body, signature, "monnify");

  let payload: MonnifyWebhookPayload;
  try {
    payload = JSON.parse(body) as MonnifyWebhookPayload;
  } catch {
    await recordWebhookHealth("failed");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizeMonnifyWebhook(payload);

  if (normalized) {
    await upsertWebhookAuditEvent(supabase, {
      provider: "monnify",
      eventType: payload.eventType || "monnify.webhook",
      paymentMethod: normalized.paymentMethod,
      paymentPurpose: normalized.paymentPurpose,
      paymentReference: normalized.reference,
      providerReference: normalized.providerReference,
      expectedAmount: normalized.expectedAmount,
      paidAmount: normalized.amountKobo / 100,
      currency: "NGN",
      fee: normalized.feesKobo !== null ? normalized.feesKobo / 100 : null,
      planId: normalized.planId,
      merchantId: normalized.merchantId,
      invoiceId: normalized.invoiceId,
      customerEmail: normalized.customerEmail,
      rawPayload: payload as Record<string, unknown>,
      processingStatus: verification.valid ? "received" : "failed",
      failureReason: verification.valid ? null : verification.error || "Signature mismatch",
      idempotencyKey: `monnify:${normalized.providerReference || normalized.reference}:${payload.eventType || "event"}:received`,
      settlementDestinationSource: normalized.settlementDestinationSource,
    });
  }

  if (!normalized || !normalized.successful) {
    return NextResponse.json({
      received: true,
      provider: "monnify",
      ignored: true,
      eventType: payload.eventType || null,
    });
  }

  try {
    // Monnify sandbox webhook secrets are often misconfigured during setup.
    // Verify the paid reference directly with Monnify before rejecting a real
    // successful transaction due to signature mismatch.
    if (!verification.valid) {
      const tx = await PaymentService.verifyTransaction(normalized.reference, "monnify");
      if (tx.status !== "success") {
        await recordWebhookHealth("failed");
        return new NextResponse("Invalid signature", { status: 401 });
      }
    }

    const result = await processSuccessfulFiatPayment(supabase, {
      provider: "monnify",
      metadata: normalized.metadata,
      amountKobo: normalized.amountKobo,
      reference: normalized.reference,
      providerReference: normalized.providerReference,
      channel: normalized.channel,
      feesKobo: normalized.feesKobo,
      settlementAmountKobo: normalized.settlementAmountKobo,
      rawProviderPayload: payload as Record<string, unknown>,
    });
    await recordWebhookHealth("success");
    await upsertWebhookAuditEvent(supabase, {
      provider: "monnify",
      eventType: payload.eventType || "SUCCESSFUL_TRANSACTION",
      paymentMethod: normalized.paymentMethod,
      paymentPurpose: normalized.paymentPurpose,
      paymentReference: normalized.reference,
      providerReference: normalized.providerReference,
      expectedAmount: normalized.expectedAmount,
      paidAmount: normalized.amountKobo / 100,
      currency: "NGN",
      fee: normalized.feesKobo !== null ? normalized.feesKobo / 100 : null,
      planId: normalized.planId,
      merchantId: normalized.merchantId,
      invoiceId: normalized.invoiceId,
      customerEmail: normalized.customerEmail,
      rawPayload: payload as Record<string, unknown>,
      processingStatus: "needs_review" in result && result.needs_review ? "manual_review" : "processed",
      failureReason: "needs_review" in result && result.needs_review ? "Amount mismatch requires manual review." : null,
      idempotencyKey: `monnify:${normalized.providerReference || normalized.reference}:${payload.eventType || "event"}:processed`,
      settlementDestinationSource: normalized.settlementDestinationSource,
      reconciliationStatus: "needs_review" in result && result.needs_review ? "needs_review" : "pending_reconciliation",
    });

    return NextResponse.json({
      ...result,
      provider: "monnify",
      reference: normalized.reference,
    });
  } catch (error) {
    console.error("Monnify webhook processing failed:", error);
    await recordWebhookHealth("failed");
    if (normalized) {
      const message = error instanceof Error ? error.message : "Webhook processing failed";
      await upsertWebhookAuditEvent(supabase, {
        provider: "monnify",
        eventType: payload.eventType || "SUCCESSFUL_TRANSACTION",
        paymentMethod: normalized.paymentMethod,
        paymentPurpose: normalized.paymentPurpose,
        paymentReference: normalized.reference,
        providerReference: normalized.providerReference,
        expectedAmount: normalized.expectedAmount,
        paidAmount: normalized.amountKobo / 100,
        currency: "NGN",
        fee: normalized.feesKobo !== null ? normalized.feesKobo / 100 : null,
        planId: normalized.planId,
        merchantId: normalized.merchantId,
        invoiceId: normalized.invoiceId,
        customerEmail: normalized.customerEmail,
        rawPayload: payload as Record<string, unknown>,
        processingStatus: "failed",
        failureReason: message,
        idempotencyKey: `monnify:${normalized.providerReference || normalized.reference}:${payload.eventType || "event"}:failed`,
        settlementDestinationSource: normalized.settlementDestinationSource,
        reconciliationStatus: "needs_review",
      });
      if (normalized.paymentPurpose === "plan_subscription" || normalized.paymentPurpose === "plan_upgrade") {
        await updatePlanPaymentRecord(supabase, normalized.reference, {
          provider_reference: normalized.providerReference,
          amount_paid: normalized.amountKobo / 100,
          payment_status: "failed",
          processing_status: "failed",
          account_setup_status: "manual_review",
          failure_reason: message,
          raw_provider_payload: payload as Record<string, unknown>,
        }, "monnify");
      }
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
    .eq("provider_name", "monnify")
    .eq("environment", environment);
}

function normalizeMonnifyWebhook(payload: MonnifyWebhookPayload) {
  const eventData = payload.eventData || payload.data || {};
  const eventType = String(payload.eventType || eventData.eventType || "").toUpperCase();
  const paymentStatus = String(eventData.paymentStatus || eventData.status || "").toUpperCase();
  const currency = String(eventData.currency || eventData.currencyCode || "NGN").toUpperCase();
  const successful =
    eventType === "SUCCESSFUL_TRANSACTION" ||
    paymentStatus === "PAID" ||
    paymentStatus === "SUCCESS";

  if (!successful || currency !== "NGN") {
    return null;
  }

  const product = asRecord(eventData.product);
  const reference = String(
    eventData.paymentReference ||
      product?.reference ||
      eventData.transactionReference ||
      eventData.reference ||
      ""
  );

  if (!reference) {
    return null;
  }

  const amountPaid = Number(eventData.amountPaid ?? eventData.amount ?? eventData.totalPayable ?? 0);
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
    return null;
  }

  const settlementAmount = Number(eventData.settlementAmount ?? 0);
  const rawMetadata = eventData.metaData ?? eventData.metadata ?? {};
  const metadata = normalizeMetadata(rawMetadata);
  const paymentMethod = String(eventData.paymentMethod || metadata.payment_method_requested || "CARD");
  const feesKobo =
    settlementAmount > 0 && settlementAmount <= amountPaid
      ? Math.round((amountPaid - settlementAmount) * 100)
      : null;
  const paymentPurpose = normalizeMonnifyPurpose(metadata);

  return {
    successful,
    reference,
    providerReference:
      stringValue(eventData.transactionReference) ||
      stringValue(eventData.paymentReference) ||
      stringValue(eventData.transactionReference),
    amountKobo: Math.round(amountPaid * 100),
    channel: paymentMethod,
    paymentMethod: paymentMethod.toLowerCase(),
    paymentPurpose,
    feesKobo,
    settlementAmountKobo:
      settlementAmount > 0 && settlementAmount <= amountPaid
        ? Math.round(settlementAmount * 100)
        : null,
    expectedAmount: numericValue(metadata.amount_expected_kobo) !== null
      ? Number(metadata.amount_expected_kobo) / 100
      : null,
    planId: stringValue(metadata.new_plan) || stringValue(metadata.plan),
    merchantId: stringValue(metadata.merchant_id),
    invoiceId: stringValue(metadata.invoice_id),
    customerEmail: stringValue(metadata.email) || stringValue(eventData.customerEmail),
    settlementDestinationSource:
      paymentPurpose === "plan_subscription" || paymentPurpose === "plan_upgrade"
        ? "provider_dashboard"
        : null,
    metadata,
  };
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return asRecord(parsed) || {};
    } catch {
      return {};
    }
  }

  return asRecord(value) || {};
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

function normalizeMonnifyPurpose(metadata: Record<string, unknown>) {
  const explicitPurpose = stringValue(metadata.payment_purpose);
  if (explicitPurpose) {
    return explicitPurpose;
  }
  const type = stringValue(metadata.type);
  if (type === "subscription" || type === "subscription_renewal") {
    return "plan_subscription";
  }
  if (type === "subscription_upgrade") {
    return "plan_upgrade";
  }
  return type || "invoice_payment";
}
