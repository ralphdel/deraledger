import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import {
  confirmationSettingKeyForRail,
  defaultConfirmationsForRail,
  normalizeCryptoRail,
  withinTolerance,
} from "@/lib/treasury";

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

function extractSessionContext(payload: Record<string, unknown>) {
  const metadata = (payload.metadata || {}) as Record<string, unknown>;
  const label = stringValue(payload.label) || stringValue(metadata.label) || "";

  return {
    label,
    merchantId:
      stringValue(payload.merchant_id) ||
      stringValue(payload.merchantId) ||
      stringValue(metadata.merchant_id) ||
      stringValue(metadata.merchantId) ||
      label.match(/merchant:([0-9a-f-]{36})/i)?.[1],
    invoiceId:
      stringValue(payload.invoice_id) ||
      stringValue(payload.invoiceId) ||
      stringValue(metadata.invoice_id) ||
      stringValue(metadata.invoiceId) ||
      label.match(/invoice:([0-9a-f-]{36})/i)?.[1],
    paymentSessionId:
      stringValue(payload.payment_session_id) ||
      stringValue(payload.paymentSessionId) ||
      stringValue(metadata.payment_session_id) ||
      stringValue(metadata.paymentSessionId) ||
      label.match(/session:([0-9a-f-]{36})/i)?.[1],
  };
}

async function readSettings(keys: string[]) {
  const { data } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", keys);

  return new Map((data || []).map((row) => [row.key, row.value]));
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-webhook-secret");
  const verification = PaymentService.verifyBreetWebhook(secret);

  if (!verification.valid) {
    return new NextResponse("Invalid Breet webhook secret", { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ received: true });
  }

  const eventType = stringValue(payload.event) || stringValue(payload.status) || "payment.detected";
  const processorRef =
    stringValue(payload.id) ||
    stringValue(payload.reference) ||
    stringValue(payload.transactionId) ||
    stringValue(payload.txHash);
  const txHash = stringValue(payload.tx_hash) || stringValue(payload.txHash);
  const idempotencyKey = processorRef || txHash ? `${processorRef || txHash}:${eventType}` : undefined;
  const { merchantId, invoiceId, paymentSessionId, label } = extractSessionContext(payload);

  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("payment_events")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      await supabase.from("treasury_webhook_logs").insert({
        provider: "breet",
        event_type: eventType,
        status: "duplicate",
        processor_reference: processorRef || txHash || null,
        merchant_id: merchantId || null,
        invoice_id: invoiceId || null,
        payment_session_id: paymentSessionId || null,
        response_code: 200,
        raw_payload: payload,
      });
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  if (!paymentSessionId || !merchantId || !invoiceId) {
    await supabase.from("treasury_webhook_logs").insert({
      provider: "breet",
      event_type: eventType,
      status: "failed",
      processor_reference: processorRef || txHash || null,
      merchant_id: merchantId || null,
      invoice_id: invoiceId || null,
      payment_session_id: paymentSessionId || null,
      response_code: 200,
      error_message: "Webhook missing treasury mapping fields",
      raw_payload: payload,
    });

    await supabase.from("audit_logs").insert({
      event_type: "breet_webhook_unmapped",
      actor_id: null,
      actor_role: "system",
      target_id: invoiceId || merchantId || null,
      target_type: invoiceId ? "invoice" : "payment_event",
      metadata: {
        actor_name: "System (Breet Webhook)",
        event_type: eventType,
        processor_ref: processorRef,
        tx_hash: txHash,
        label,
        note: "Webhook missing treasury mapping fields.",
      },
    });

    return NextResponse.json({ received: true, mapped: false });
  }

  const { data: session } = await supabase
    .from("payment_sessions")
    .select("*")
    .eq("id", paymentSessionId)
    .eq("merchant_id", merchantId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  if (!session) {
    await supabase.from("treasury_webhook_logs").insert({
      provider: "breet",
      event_type: eventType,
      status: "failed",
      processor_reference: processorRef || txHash || null,
      merchant_id: merchantId,
      invoice_id: invoiceId,
      payment_session_id: paymentSessionId,
      response_code: 200,
      error_message: "payment_session_not_found",
      raw_payload: payload,
    });
    return NextResponse.json({ received: true, mapped: false, reason: "session_not_found" });
  }

  const rail = normalizeCryptoRail(
    stringValue(payload.currency) ||
      stringValue(payload.asset) ||
      stringValue(session.payment_rail)
  );
  const amountCrypto = numberValue(payload.amount_crypto) || numberValue(payload.cryptoAmount) || 0;
  const confirmationCount =
    numberValue(payload.confirmations) ||
    numberValue(payload.confirmation_count) ||
    numberValue(payload.confirmationCount) ||
    0;
  const settings = await readSettings([
    confirmationSettingKeyForRail(rail),
    "crypto_underpayment_tolerance_bps",
    "crypto_platform_fee_bps",
  ]);

  const expectedConfirmations = Number(
    settings.get(confirmationSettingKeyForRail(rail)) || defaultConfirmationsForRail(rail)
  );
  const toleranceBps = Number(settings.get("crypto_underpayment_tolerance_bps") || "100");
  const platformFeeBps = Number(settings.get("crypto_platform_fee_bps") || "0");

  if (!withinTolerance(Number(session.amount_crypto), amountCrypto, toleranceBps)) {
    await supabase
      .from("payment_sessions")
      .update({
        status: "UNDER_REVIEW",
        confirmation_count: confirmationCount,
        tx_hash: txHash || session.tx_hash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    await supabase.from("payment_events").insert({
      merchant_id: merchantId,
      invoice_id: invoiceId,
      transaction_id: null,
      event_type: eventType,
      processor: "breet",
      processor_ref: processorRef || txHash || null,
      amount_kobo: Math.round(Number(session.amount_ngn) * 100),
      raw_payload: payload,
      idempotency_key: idempotencyKey || null,
    });

    await supabase.from("audit_logs").insert({
      event_type: "crypto_payment_under_review",
      actor_id: null,
      actor_role: "system",
      target_id: invoiceId,
      target_type: "invoice",
      metadata: {
        actor_name: "System (Breet Webhook)",
        actor_merchant_id: merchantId,
        payment_session_id: session.id,
        expected_amount_crypto: session.amount_crypto,
        received_amount_crypto: amountCrypto,
        tolerance_bps: toleranceBps,
        tx_hash: txHash,
      },
    });

    await supabase.from("treasury_webhook_logs").insert({
      provider: "breet",
      event_type: eventType,
      status: "under_review",
      processor_reference: processorRef || txHash || null,
      merchant_id: merchantId,
      invoice_id: invoiceId,
      payment_session_id: session.id,
      response_code: 200,
      error_message: "amount_outside_tolerance",
      raw_payload: payload,
    });

    return NextResponse.json({ received: true, mapped: true, underReview: true });
  }

  const grossNgn = Number(session.amount_ngn);
  const platformFee = Number(((grossNgn * platformFeeBps) / 10_000).toFixed(2));
  const networkFee = 0;
  const merchantNetNgn = Number((grossNgn - platformFee - networkFee).toFixed(2));

  const { data: rpcResult, error: rpcError } = await supabase.rpc(
    "process_breet_invoice_confirmation",
    {
      p_payment_session_id: session.id,
      p_event_type: eventType,
      p_processor_reference: processorRef || txHash || session.reference,
      p_blockchain_tx_hash: txHash || null,
      p_breet_reference: processorRef || session.reference,
      p_source_amount: amountCrypto,
      p_exchange_rate: Number(session.exchange_rate),
      p_payment_rail: rail,
      p_source_currency: rail,
      p_gross_ngn: grossNgn,
      p_platform_fee: platformFee,
      p_network_fee: networkFee,
      p_merchant_net_ngn: merchantNetNgn,
      p_confirmation_count: confirmationCount,
      p_expected_confirmations: expectedConfirmations,
      p_raw_payload: payload,
    }
  );

  if (rpcError || !rpcResult?.ok) {
    console.error("Breet treasury processing failed:", rpcError?.message || rpcResult);
    await supabase.from("treasury_webhook_logs").insert({
      provider: "breet",
      event_type: eventType,
      status: "failed",
      processor_reference: processorRef || txHash || null,
      merchant_id: merchantId,
      invoice_id: invoiceId,
      payment_session_id: session.id,
      response_code: 500,
      error_message: rpcError?.message || "Treasury processing failed",
      raw_payload: payload,
    });
    return NextResponse.json({ error: "Treasury processing failed" }, { status: 500 });
  }

  await supabase.from("payment_events").insert({
    merchant_id: merchantId,
    invoice_id: invoiceId,
    transaction_id: null,
    event_type: eventType,
    processor: "breet",
    processor_ref: processorRef || txHash || null,
    amount_kobo: Math.round(grossNgn * 100),
    raw_payload: payload,
    idempotency_key: idempotencyKey || null,
  });

  await supabase.from("audit_logs").insert({
    event_type: "crypto_payment_confirmed",
    actor_id: null,
    actor_role: "system",
    target_id: invoiceId,
    target_type: "invoice",
    metadata: {
      actor_name: "System (Breet Webhook)",
      actor_merchant_id: merchantId,
      payment_session_id: session.id,
      payment_rail: rail,
      tx_hash: txHash,
      gross_ngn: grossNgn,
      merchant_net_ngn: merchantNetNgn,
      settlement_status: rpcResult.payment_status,
    },
  });

  await supabase.from("treasury_webhook_logs").insert({
    provider: "breet",
    event_type: eventType,
    status: Boolean(rpcResult.duplicate) ? "duplicate" : "processed",
    processor_reference: processorRef || txHash || null,
    merchant_id: merchantId,
    invoice_id: invoiceId,
    payment_session_id: session.id,
    response_code: 200,
    raw_payload: payload,
  });

  return NextResponse.json({
    received: true,
    mapped: true,
    settlementStatus: rpcResult.payment_status,
    duplicate: Boolean(rpcResult.duplicate),
  });
}
