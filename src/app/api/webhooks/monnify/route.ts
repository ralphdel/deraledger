import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { processSuccessfulFiatPayment } from "@/lib/services/fiat-payment-confirmation.service";
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
    await recordWebhookAttempt({
      status: verification.valid ? "received" : "signature_failed",
      reference: normalized.reference,
      eventType: payload.eventType || "monnify.webhook",
      amountKobo: normalized.amountKobo,
      payload,
      metadata: normalized.metadata,
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
      channel: normalized.channel,
      feesKobo: normalized.feesKobo,
    });
    await recordWebhookHealth("success");
    await recordWebhookAttempt({
      status: "processed",
      reference: normalized.reference,
      eventType: payload.eventType || "SUCCESSFUL_TRANSACTION",
      amountKobo: normalized.amountKobo,
      payload,
      metadata: normalized.metadata,
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
      await recordWebhookAttempt({
        status: "processing_failed",
        reference: normalized.reference,
        eventType: payload.eventType || "SUCCESSFUL_TRANSACTION",
        amountKobo: normalized.amountKobo,
        payload,
        metadata: normalized.metadata,
      });
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

async function recordWebhookAttempt(input: {
  status: string;
  reference: string;
  eventType: string;
  amountKobo: number;
  payload: unknown;
  metadata: Record<string, unknown>;
}) {
  const merchantId = typeof input.metadata.merchant_id === "string" ? input.metadata.merchant_id : null;
  const invoiceId = typeof input.metadata.invoice_id === "string" ? input.metadata.invoice_id : null;
  await supabase.from("payment_events").upsert(
    {
      merchant_id: merchantId,
      invoice_id: invoiceId,
      event_type: `${input.eventType}:${input.status}`,
      processor: "monnify",
      processor_ref: input.reference,
      amount_kobo: input.amountKobo,
      raw_payload: input.payload,
      idempotency_key: `monnify:${input.reference}:${input.status}`,
    },
    { onConflict: "idempotency_key" }
  );
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

  return {
    successful,
    reference,
    amountKobo: Math.round(amountPaid * 100),
    channel: paymentMethod,
    feesKobo,
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
