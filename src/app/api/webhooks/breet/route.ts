import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { processSuccessfulFiatPayment } from "@/lib/services/fiat-payment-confirmation.service";
import { upsertSettlementLedgerForTransaction } from "@/lib/services/settlement-ledger.service";
import {
  buildBreetWebhookIdempotencyKey,
  mapBreetEventToCryptoStatus,
  normalizeBreetSettlementMode,
  normalizeCryptoLifecycleStatus,
} from "@/lib/services/breet-crypto.service";
import { withinTolerance, normalizeCryptoRail } from "@/lib/treasury";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type WebhookPayload = Record<string, unknown>;

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractSessionContext(payload: WebhookPayload) {
  const metadata = asRecord(payload.metadata);
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
    internalReference:
      stringValue(payload.reference) ||
      stringValue(payload.provider_reference) ||
      stringValue(payload.id) ||
      stringValue(metadata.internal_reference) ||
      label.match(/ref:([A-Z0-9-]+)/i)?.[1] ||
      label,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function readSettings(keys: string[]) {
  const { data } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", keys);

  return new Map((data || []).map((row) => [row.key, String(row.value || "")]));
}

async function recordWebhookLog(input: {
  eventType: string;
  status: "received" | "processed" | "duplicate" | "failed" | "under_review";
  processorReference: string | null;
  merchantId: string | null;
  invoiceId: string | null;
  paymentSessionId: string | null;
  errorMessage?: string | null;
  responseCode?: number | null;
  rawPayload: WebhookPayload;
}) {
  await supabase.from("treasury_webhook_logs").insert({
    provider: "breet",
    event_type: input.eventType,
    status: input.status,
    processor_reference: input.processorReference,
    merchant_id: input.merchantId,
    invoice_id: input.invoiceId,
    payment_session_id: input.paymentSessionId,
    response_code: input.responseCode ?? 200,
    error_message: input.errorMessage || null,
    raw_payload: input.rawPayload,
  });
}

async function updateProviderWebhookHealth(status: "success" | "failed") {
  const now = new Date().toISOString();
  const environment = process.env.PAYMENT_ENVIRONMENT === "live" ? "live" : "sandbox";
  await supabase
    .from("payment_providers")
    .update(
      status === "success"
        ? { last_successful_webhook_at: now, updated_at: now }
        : { last_failed_webhook_at: now, updated_at: now }
    )
    .eq("provider_name", "breet")
    .eq("environment", environment);
}

async function findInvoiceSession(context: {
  paymentSessionId?: string;
  internalReference?: string;
  providerReference?: string;
}) {
  const candidates = [context.paymentSessionId, context.internalReference, context.providerReference]
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const byId = await supabase
      .from("payment_sessions")
      .select("*")
      .eq("id", candidate)
      .maybeSingle();
    if (byId.data) return byId.data;

    const byReference = await supabase
      .from("payment_sessions")
      .select("*")
      .eq("reference", candidate)
      .maybeSingle();
    if (byReference.data) return byReference.data;

    const byProviderReference = await supabase
      .from("payment_sessions")
      .select("*")
      .eq("provider_reference", candidate)
      .maybeSingle();
    if (byProviderReference.data) return byProviderReference.data;
  }

  return null;
}

async function findPlanSession(context: {
  paymentSessionId?: string;
  internalReference?: string;
  providerReference?: string;
}) {
  const candidates = [context.paymentSessionId, context.internalReference, context.providerReference]
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const byInternal = await supabase
      .from("crypto_payment_sessions")
      .select("*")
      .eq("internal_reference", candidate)
      .maybeSingle();
    if (byInternal.data) return byInternal.data;

    const byProvider = await supabase
      .from("crypto_payment_sessions")
      .select("*")
      .eq("provider_reference", candidate)
      .maybeSingle();
    if (byProvider.data) return byProvider.data;

    const bySessionRef = await supabase
      .from("crypto_payment_sessions")
      .select("*")
      .eq("payment_session_reference", candidate)
      .maybeSingle();
    if (bySessionRef.data) return bySessionRef.data;
  }

  return null;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const verification = PaymentService.verifyBreetWebhookSignature(request);

  if (!verification.valid) {
    await updateProviderWebhookHealth("failed");
    return new NextResponse("Invalid Breet webhook secret", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    await updateProviderWebhookHealth("failed");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = stringValue(payload.event) || stringValue(payload.status) || "payment.detected";
  const context = extractSessionContext(payload);
  const providerReference =
    stringValue(payload.id) ||
    stringValue(payload.reference) ||
    stringValue(payload.transactionId) ||
    stringValue(payload.txHash) ||
    stringValue(payload.tx_hash) ||
    context.internalReference ||
    context.paymentSessionId ||
    null;
  const txHash = stringValue(payload.tx_hash) || stringValue(payload.txHash) || null;
  const idempotencyKey = buildBreetWebhookIdempotencyKey(providerReference || "", eventType);

  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("payment_events")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      await recordWebhookLog({
        eventType,
        status: "duplicate",
        processorReference: providerReference,
        merchantId: context.merchantId || null,
        invoiceId: context.invoiceId || null,
        paymentSessionId: context.paymentSessionId || null,
        rawPayload: payload,
      });
      await updateProviderWebhookHealth("success");
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  const invoiceSession = await findInvoiceSession({
    paymentSessionId: context.paymentSessionId,
    internalReference: context.internalReference,
    providerReference: providerReference || undefined,
  });
  const planSession = invoiceSession ? null : await findPlanSession({
    paymentSessionId: context.paymentSessionId,
    internalReference: context.internalReference,
    providerReference: providerReference || undefined,
  });

  if (!invoiceSession && !planSession) {
    await recordWebhookLog({
      eventType,
      status: "failed",
      processorReference: providerReference,
      merchantId: context.merchantId || null,
      invoiceId: context.invoiceId || null,
      paymentSessionId: context.paymentSessionId || null,
      errorMessage: "Webhook missing session mapping fields",
      rawPayload: payload,
    });
    await updateProviderWebhookHealth("failed");
    return NextResponse.json({ received: true, mapped: false, reason: "session_not_found" });
  }

  if (invoiceSession) {
    return handleInvoiceWebhook({
      payload,
      eventType,
      providerReference,
      txHash,
      context,
      session: invoiceSession,
      idempotencyKey,
    });
  }

  return handlePlanWebhook({
    payload,
    eventType,
    providerReference,
    txHash,
    context,
    session: planSession!,
    idempotencyKey,
  });
}

async function handleInvoiceWebhook(input: {
  payload: WebhookPayload;
  eventType: string;
  providerReference: string | null;
  txHash: string | null;
  context: ReturnType<typeof extractSessionContext>;
  session: Record<string, unknown>;
  idempotencyKey: string | null;
}) {
  const { payload, eventType, providerReference, txHash, context, session, idempotencyKey } = input;
  const rail = normalizeCryptoRail(
    stringValue(payload.currency) ||
      stringValue(payload.asset) ||
      stringValue(session.payment_rail) ||
      stringValue(session.crypto_asset)
  );
  const amountCrypto =
    numberValue(payload.amount_crypto) ||
    numberValue(payload.cryptoAmount) ||
    numberValue(eventDataValue(payload, ["crypto_amount"])) ||
    0;
  const receivedNgN =
    numberValue(payload.amount_ngn) ||
    numberValue(payload.amountInNGN) ||
    numberValue(payload.ngnAmount) ||
    numberValue(payload.convertedNgnAmount) ||
    numberValue(eventDataValue(payload, ["converted_ngn_amount"])) ||
    Number(session.amount_ngn || 0);
  const expectedNgN = Number(session.amount_ngn || 0);
  const confirmationCount =
    numberValue(payload.confirmations) ||
    numberValue(payload.confirmation_count) ||
    numberValue(payload.confirmationCount) ||
    0;
  const settings = await readSettings([
    `crypto_${rail.toLowerCase()}_confirmations`,
    "crypto_underpayment_tolerance_bps",
    "crypto_platform_fee_bps",
    "crypto_overpayment_action",
  ]);
  const toleranceBps = Number(settings.get("crypto_underpayment_tolerance_bps") || "100");
  const expectedConfirmations = Number(settings.get(`crypto_${rail.toLowerCase()}_confirmations`) || "12");
  const platformFeeBps = Number(settings.get("crypto_platform_fee_bps") || "0");
  const platformFee = Number(((receivedNgN * platformFeeBps) / 10_000).toFixed(2));
  const settlementMode = normalizeBreetSettlementMode(String(session.settlement_mode || "treasury_manual"));
  const lifecycleStatus = normalizeCryptoLifecycleStatus(
    mapBreetEventToCryptoStatus(eventType, stringValue(payload.status), payload)
  );

  if (!withinTolerance(expectedNgN, receivedNgN, toleranceBps)) {
    await supabase
      .from("payment_sessions")
      .update({
        status: "UNDER_REVIEW",
        crypto_status:
          receivedNgN < expectedNgN ? "crypto_underpaid" : "crypto_overpaid",
        settlement_status: "manual_review",
        manual_review_reason: "Amount outside configured tolerance.",
        crypto_amount_received: amountCrypto || null,
        converted_ngn_amount: receivedNgN,
        webhook_status: "processed",
        raw_webhook_payload: payload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    await recordWebhookLog({
      eventType,
      status: "under_review",
      processorReference: providerReference,
      merchantId: stringValue(session.merchant_id) || context.merchantId || null,
      invoiceId: stringValue(session.invoice_id) || context.invoiceId || null,
      paymentSessionId: String(session.id),
      errorMessage: "amount_outside_tolerance",
      rawPayload: payload,
    });
    await updateProviderWebhookHealth("success");
    return NextResponse.json({ received: true, mapped: true, underReview: true });
  }

  const rpcResult = await supabase.rpc("process_breet_invoice_confirmation", {
    p_payment_session_id: session.id,
    p_event_type: eventType,
    p_processor_reference: providerReference || txHash || session.reference,
    p_blockchain_tx_hash: txHash || null,
    p_breet_reference: providerReference || session.reference,
    p_source_amount: amountCrypto || Number(session.amount_crypto || 0),
    p_exchange_rate: Number(session.exchange_rate || 0),
    p_payment_rail: rail,
    p_source_currency: rail,
    p_gross_ngn: receivedNgN,
    p_platform_fee: platformFee,
    p_network_fee: 0,
    p_merchant_net_ngn: Number((receivedNgN - platformFee).toFixed(2)),
    p_confirmation_count: confirmationCount,
    p_expected_confirmations: expectedConfirmations,
    p_raw_payload: payload,
  });

  if (rpcResult.error || !rpcResult.data?.ok) {
    await recordWebhookLog({
      eventType,
      status: "failed",
      processorReference: providerReference,
      merchantId: stringValue(session.merchant_id) || context.merchantId || null,
      invoiceId: stringValue(session.invoice_id) || context.invoiceId || null,
      paymentSessionId: String(session.id),
      errorMessage: rpcResult.error?.message || "Treasury processing failed",
      rawPayload: payload,
    });
    await updateProviderWebhookHealth("failed");
    return NextResponse.json({ error: "Treasury processing failed" }, { status: 500 });
  }

  await supabase
    .from("payment_sessions")
    .update({
      provider_reference: providerReference || session.provider_reference || null,
      tx_hash: txHash || session.tx_hash || null,
      crypto_amount_received: amountCrypto || null,
      converted_ngn_amount: receivedNgN,
      provider_fee: platformFee,
      settlement_fee: 0,
      expected_settlement_ngn: receivedNgN - platformFee,
      actual_settlement_ngn: receivedNgN - platformFee,
      settlement_mode: settlementMode,
      crypto_status: lifecycleStatus,
      settlement_status: rpcResult.data.payment_status || "pending",
      webhook_status: "processed",
      raw_webhook_payload: payload,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);

  await supabase.from("payment_events").insert({
    merchant_id: session.merchant_id,
    invoice_id: session.invoice_id,
    transaction_id: null,
    event_type: eventType,
    processor: "breet",
    processor_ref: providerReference || txHash || null,
    amount_kobo: Math.round(expectedNgN * 100),
    raw_payload: payload,
    idempotency_key: idempotencyKey || null,
  });

  const { data: transactionRow } = await supabase
    .from("transactions")
    .select("id")
    .eq("processor_reference", providerReference || txHash || session.reference)
    .maybeSingle();

  if (transactionRow?.id) {
    await upsertSettlementLedgerForTransaction(supabase, transactionRow.id, {
      provider: "breet",
      settlementMode,
      rawProviderPayload: payload,
    });
  }

  await recordWebhookLog({
    eventType,
    status: "processed",
    processorReference: providerReference,
    merchantId: stringValue(session.merchant_id) || context.merchantId || null,
    invoiceId: stringValue(session.invoice_id) || context.invoiceId || null,
    paymentSessionId: String(session.id),
    rawPayload: payload,
  });
  await updateProviderWebhookHealth("success");

  return NextResponse.json({
    received: true,
    mapped: true,
    settlementStatus: rpcResult.data.payment_status,
    duplicate: Boolean(rpcResult.data.duplicate),
  });
}

async function handlePlanWebhook(input: {
  payload: WebhookPayload;
  eventType: string;
  providerReference: string | null;
  txHash: string | null;
  context: ReturnType<typeof extractSessionContext>;
  session: Record<string, unknown>;
  idempotencyKey: string | null;
}) {
  const { payload, eventType, providerReference, txHash, session, idempotencyKey } = input;
  const expectedNgN = Number(session.expected_ngn_amount || 0);
  const convertedNgN =
    numberValue(payload.amount_ngn) ||
    numberValue(payload.amountInNGN) ||
    numberValue(payload.ngnAmount) ||
    numberValue(eventDataValue(payload, ["converted_ngn_amount"])) ||
    expectedNgN;
  const amountKobo = Math.round(convertedNgN * 100);
  const amountCrypto =
    numberValue(payload.amount_crypto) ||
    numberValue(payload.cryptoAmount) ||
    numberValue(eventDataValue(payload, ["crypto_amount"])) ||
    Number(session.crypto_amount_expected || 0);
  const settlementMode = normalizeBreetSettlementMode(String(session.settlement_mode || "treasury_manual"));
  const lifecycleStatus = normalizeCryptoLifecycleStatus(
    mapBreetEventToCryptoStatus(eventType, stringValue(payload.status), payload)
  );

  if (lifecycleStatus === "crypto_expired" || lifecycleStatus === "failed") {
    await supabase
      .from("crypto_payment_sessions")
      .update({
        crypto_status: lifecycleStatus,
        settlement_status: "failed",
        webhook_status: "processed",
        raw_webhook_payload: payload,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    await recordWebhookLog({
      eventType,
      status: "failed",
      processorReference: providerReference,
      merchantId: stringValue(session.merchant_id) || null,
      invoiceId: null,
      paymentSessionId: String(session.id),
      errorMessage: lifecycleStatus,
      rawPayload: payload,
    });
    await updateProviderWebhookHealth("success");
    return NextResponse.json({ received: true, mapped: true, skipped: true, reason: lifecycleStatus });
  }

  if (expectedNgN > 0 && !withinTolerance(expectedNgN, convertedNgN, Number((await readSettings(["crypto_underpayment_tolerance_bps"])).get("crypto_underpayment_tolerance_bps") || "100"))) {
    const cryptoStatus = convertedNgN < expectedNgN ? "crypto_underpaid" : "crypto_overpaid";
    await supabase
      .from("crypto_payment_sessions")
      .update({
        crypto_status: cryptoStatus,
        settlement_status: "manual_review",
        manual_review_reason: cryptoStatus === "crypto_underpaid" ? "Underpayment requires manual review." : "Overpayment requires manual review.",
        crypto_amount_received: amountCrypto || null,
        converted_ngn_amount: convertedNgN,
        webhook_status: "processed",
        raw_webhook_payload: payload,
        processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    await recordWebhookLog({
      eventType,
      status: "under_review",
      processorReference: providerReference,
      merchantId: stringValue(session.merchant_id) || null,
      invoiceId: null,
      paymentSessionId: String(session.id),
      errorMessage: cryptoStatus,
      rawPayload: payload,
    });
    await updateProviderWebhookHealth("success");
    return NextResponse.json({ received: true, mapped: true, underReview: true });
  }

  const metadata = asRecord(session.metadata);
  const onboardingSessionId = stringValue(session.payment_session_reference);
  const confirmation = await processSuccessfulFiatPayment(supabase, {
    provider: "breet",
    metadata: {
      ...metadata,
      type: metadata.type || (session.payment_purpose === "plan_upgrade" ? "subscription_upgrade" : "subscription"),
      merchant_id: session.merchant_id || metadata.merchant_id || null,
      session_id: onboardingSessionId || stringValue(metadata.session_id) || null,
      plan: session.plan_id || metadata.plan || null,
      new_plan: session.plan_id || metadata.new_plan || null,
      email: metadata.email || null,
      business_name: metadata.business_name || "DeraLedger",
    },
    amountKobo,
    reference: String(session.internal_reference),
    channel: "crypto",
    feesKobo: Math.round(Number(session.provider_fee || 0) * 100) || null,
    settlementAmountKobo: Math.round(convertedNgN * 100),
    rawProviderPayload: payload,
  });

  const merchantId =
    stringValue(session.merchant_id) ||
    stringValue(metadata.merchant_id) ||
    (await resolveMerchantFromOnboardingSession(onboardingSessionId)) ||
    null;

  const paymentRecord = await supabase
    .from("payment_records")
    .upsert(
      {
        merchant_id: merchantId,
        customer_id: null,
        payment_purpose: String(session.payment_purpose || "plan_subscription"),
        payment_method: "crypto",
        provider_name: "breet",
        internal_reference: String(session.internal_reference),
        provider_reference: providerReference || session.provider_reference || null,
        amount_paid: convertedNgN,
        currency: "NGN",
        payment_status: "successful",
        customer_email: metadata.email || null,
        raw_provider_payload: payload,
        paid_at: new Date().toISOString(),
      },
      { onConflict: "internal_reference" }
    )
    .select("id")
    .single();

  if (merchantId && !paymentRecord.error && paymentRecord.data?.id) {
    await supabase.from("settlement_records").upsert(
      {
        payment_record_id: paymentRecord.data.id,
        merchant_id: merchantId,
        settlement_account_id: null,
        provider_settlement_account_id: null,
        provider_name: "breet",
        payment_method: "crypto",
        settlement_recipient_type: "platform",
        settlement_currency: "NGN",
        gross_amount: convertedNgN,
        provider_fee: Number(session.provider_fee || 0),
        platform_fee: 0,
        customer_fee: 0,
        merchant_fee: 0,
        expected_settlement: convertedNgN,
        actual_settlement: convertedNgN,
        settlement_difference: null,
        fee_payer: "merchant_pays_fee",
        settlement_status: "completed",
        settlement_mode: settlementMode,
        settlement_owner: "provider",
        payout_action_required: false,
        provider_settlement_reference: providerReference || session.provider_reference || session.internal_reference,
        provider_fee_source: "breet_payload",
        expected_settlement_source: "crypto_session",
        raw_settlement_payload: payload,
      },
      { onConflict: "payment_record_id" }
    );
  }

  await supabase
    .from("crypto_payment_sessions")
    .update({
      provider_reference: providerReference || session.provider_reference || null,
      crypto_amount_received: amountCrypto || null,
      converted_ngn_amount: convertedNgN,
      settlement_mode: settlementMode,
      crypto_status: mapBreetEventToCryptoStatus(eventType, stringValue(payload.status), payload),
      settlement_status: "completed",
      webhook_status: "processed",
      raw_webhook_payload: payload,
      payment_status: "successful",
      paid_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);

  await supabase.from("payment_events").insert({
    merchant_id: merchantId,
    invoice_id: null,
    transaction_id: null,
    event_type: eventType,
    processor: "breet",
    processor_ref: providerReference || txHash || null,
    amount_kobo: amountKobo,
    raw_payload: payload,
    idempotency_key: idempotencyKey || null,
  });

  await recordWebhookLog({
    eventType,
    status: "processed",
    processorReference: providerReference,
    merchantId,
    invoiceId: null,
    paymentSessionId: String(session.id),
    rawPayload: payload,
  });
  await updateProviderWebhookHealth("success");

  return NextResponse.json({
    received: true,
    mapped: true,
    provider: "breet",
    confirmation,
    settlementMode,
  });
}

async function resolveMerchantFromOnboardingSession(sessionId?: string | null) {
  if (!sessionId) return null;
  const { data } = await supabase
    .from("onboarding_sessions")
    .select("merchant_id")
    .eq("id", sessionId)
    .maybeSingle();

  return typeof data?.merchant_id === "string" ? data.merchant_id : null;
}

function eventDataValue(payload: WebhookPayload, path: string[]) {
  let current: unknown = payload.data;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
