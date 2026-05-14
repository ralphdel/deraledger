import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractIds(payload: Record<string, unknown>) {
  const metadata = (payload.metadata || {}) as Record<string, unknown>;
  const label = stringValue(payload.label) || stringValue(metadata.label) || "";

  const merchantId =
    stringValue(payload.merchant_id) ||
    stringValue(payload.merchantId) ||
    stringValue(metadata.merchant_id) ||
    stringValue(metadata.merchantId) ||
    label.match(/merchant:([0-9a-f-]{36})/i)?.[1];

  const invoiceId =
    stringValue(payload.invoice_id) ||
    stringValue(payload.invoiceId) ||
    stringValue(metadata.invoice_id) ||
    stringValue(metadata.invoiceId) ||
    label.match(/invoice:([0-9a-f-]{36})/i)?.[1];

  return { merchantId, invoiceId, label };
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret");
  const verification = PaymentService.verifyBreetWebhook(secret);

  if (!verification.valid) {
    return new NextResponse("Invalid Breet webhook secret", { status: 401 });
  }

  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ received: true });
  }

  const eventType = stringValue(payload.event) || stringValue(payload.status) || "breet.webhook";
  const processorRef = stringValue(payload.id) || stringValue(payload.txHash) || stringValue(payload.transactionId);
  const idempotencyKey = processorRef ? `${processorRef}:${eventType}` : undefined;
  const { merchantId, invoiceId, label } = extractIds(payload);

  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("payment_events")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .single();

    if (existing) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  if (!merchantId) {
    await supabase.from("audit_logs").insert({
      event_type: "breet_webhook_unmapped",
      actor_id: null,
      actor_role: "system",
      target_id: null,
      target_type: "payment_event",
      metadata: {
        actor_name: "System (Breet Webhook)",
        event_type: eventType,
        processor_ref: processorRef,
        label,
        note: "Breet scaffold received an event without a merchant mapping.",
      },
    });

    return NextResponse.json({ received: true, mapped: false });
  }

  const amountUsd = numberValue(payload.amountInUSD);
  const amountKobo = amountUsd !== undefined ? Math.round(amountUsd * 100 * 100) : null;

  await supabase.from("payment_events").insert({
    merchant_id: merchantId,
    invoice_id: invoiceId || null,
    transaction_id: null,
    event_type: eventType,
    processor: "breet",
    processor_ref: processorRef || null,
    amount_kobo: amountKobo,
    raw_payload: payload,
    idempotency_key: idempotencyKey || null,
  });

  await supabase.from("audit_logs").insert({
    event_type: "breet_webhook_received",
    actor_id: null,
    actor_role: "system",
    target_id: invoiceId || merchantId,
    target_type: invoiceId ? "invoice" : "merchant",
    metadata: {
      actor_name: "System (Breet Webhook)",
      actor_merchant_id: merchantId,
      event_type: eventType,
      processor_ref: processorRef,
      label,
      note: "Breet scaffold logged event only; invoice balances were not mutated.",
    },
  });

  return NextResponse.json({ received: true, mapped: true });
}
