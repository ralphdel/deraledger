import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { processSuccessfulFiatPayment } from "@/lib/services/fiat-payment-confirmation.service";
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

function positiveNumberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function estimateNgnFromBreetUsd(payload: WebhookPayload) {
  const amountUsd = positiveNumberValue(payload.amountInUSD);
  const rate = positiveNumberValue(payload.rate);
  return amountUsd && rate ? Number((amountUsd * rate).toFixed(2)) : undefined;
}

function confirmedBreetNgnAmount(payload: WebhookPayload, fallback: number) {
  return (
    positiveNumberValue(payload.amountSettled) ||
    positiveNumberValue(payload.amount_ngn) ||
    positiveNumberValue(payload.amountInNGN) ||
    positiveNumberValue(payload.ngnAmount) ||
    positiveNumberValue(payload.convertedNgnAmount) ||
    positiveNumberValue(eventDataValue(payload, ["converted_ngn_amount"])) ||
    estimateNgnFromBreetUsd(payload) ||
    fallback
  );
}

function extractSessionContext(payload: WebhookPayload) {
  const metadata = asRecord(payload.metadata);
  const label = stringValue(payload.label) || stringValue(metadata.label) || "";

  return {
    label,
    walletAddress:
      stringValue(payload.address) ||
      stringValue(payload.destinationAddress) ||
      stringValue(metadata.wallet_address) ||
      stringValue(metadata.walletAddress) ||
      null,
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

function buildPendingObservation(payload: WebhookPayload, eventType: string) {
  const confirmations =
    numberValue(payload.confirmations) ||
    numberValue(payload.confirmation_count) ||
    numberValue(payload.confirmationCount) ||
    0;
  const amountInUSD = positiveNumberValue(payload.amountInUSD) || null;
  const rate =
    positiveNumberValue(payload.rate) ||
    positiveNumberValue(payload.conversionRate) ||
    null;
  const estimatedNgn =
    amountInUSD && rate ? Number((amountInUSD * rate).toFixed(2)) : null;

  return {
    latest_event: eventType,
    latest_provider_status: stringValue(payload.status) || null,
    latest_tx_hash: stringValue(payload.txHash) || stringValue(payload.tx_hash) || null,
    latest_confirmation_count: confirmations,
    latest_asset: stringValue(payload.asset) || null,
    latest_amount_in_usd: amountInUSD,
    latest_rate: rate,
    latest_estimated_ngn: estimatedNgn,
    latest_amount_settled: positiveNumberValue(payload.amountSettled) || null,
  };
}

function getNonTerminalProcessingStatus(eventType: string, lifecycleStatus: string) {
  const event = eventType.toLowerCase();
  if (event === "trade.pending" || lifecycleStatus === "crypto_payment_detected" || lifecycleStatus === "crypto_payment_confirming") {
    return "awaiting_provider_completion";
  }

  return "waiting_for_payment";
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeFeePayer(value: unknown): "business" | "customer" {
  return value === "customer" ? "customer" : "business";
}

function getInvoiceSessionAccounting(
  session: Record<string, unknown>,
  invoice: Record<string, unknown> | null,
  payload: WebhookPayload,
  fallbackAmountSettled: number
) {
  const metadata = asRecord(session.metadata);
  const selectedInvoiceAmount = roundCurrency(
    positiveNumberValue(metadata.selected_invoice_amount) ||
      positiveNumberValue(session.amount_ngn) ||
      0
  );
  const feePayer = normalizeFeePayer(
    stringValue(metadata.fee_payer) ||
      stringValue(metadata.invoice_fee_absorption) ||
      stringValue(invoice?.fee_absorption)
  );
  const configuredFeeAmount = roundCurrency(
    positiveNumberValue(metadata.fee_amount) || 0
  );
  const customerPayableAmount = roundCurrency(
    positiveNumberValue(metadata.customer_payable_amount) ||
      (feePayer === "customer" ? selectedInvoiceAmount + configuredFeeAmount : selectedInvoiceAmount)
  );
  const grossProviderValueNgn = roundCurrency(
    estimateNgnFromBreetUsd(payload) || customerPayableAmount || selectedInvoiceAmount
  );
  const amountSettledNgn = roundCurrency(
    positiveNumberValue(payload.amountSettled) || fallbackAmountSettled || 0
  );
  const providerFeeAmount = roundCurrency(
    Math.max(
      0,
      (feePayer === "customer" ? customerPayableAmount : selectedInvoiceAmount) - amountSettledNgn
    )
  );

  return {
    feePayer,
    selectedInvoiceAmount,
    customerPayableAmount,
    grossProviderValueNgn,
    amountSettledNgn,
    providerFeeAmount,
  };
}

function extractSettlementSnapshot(session: Record<string, unknown>) {
  const directSnapshot = asRecord(session.settlement_account_snapshot);
  const metadataSnapshot = asRecord(asRecord(session.metadata).settlement_account_snapshot);
  const snapshot = Object.keys(directSnapshot).length > 0 ? directSnapshot : metadataSnapshot;
  const bankId =
    stringValue(snapshot.bank_id) ||
    stringValue(asRecord(session.metadata).settlement_bank_id_used) ||
    null;

  return {
    snapshot: Object.keys(snapshot).length > 0 ? snapshot : null,
    bankId,
    bankName: stringValue(snapshot.bank_name) || null,
    accountName: stringValue(snapshot.account_name) || null,
    accountNumberMasked:
      stringValue(snapshot.account_number_masked) ||
      stringValue(snapshot.account_number) ||
      stringValue(asRecord(session.metadata).settlement_account_masked) ||
      null,
  };
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
  const { error } = await supabase.from("treasury_webhook_logs").insert({
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

  if (error) {
    console.warn("Breet webhook auxiliary log failed:", {
      eventType: input.eventType,
      processorReference: input.processorReference,
      paymentSessionId: input.paymentSessionId,
      reason: error.message,
      responseCode: input.responseCode ?? 200,
    });
  }
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
  walletAddress?: string | null;
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

  if (context.walletAddress) {
    const byWallet = await supabase
      .from("payment_sessions")
      .select("*")
      .eq("wallet_address", context.walletAddress)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byWallet.data) return byWallet.data;
  }

  return null;
}

async function findPlanSession(context: {
  paymentSessionId?: string;
  internalReference?: string;
  providerReference?: string;
  walletAddress?: string | null;
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

  if (context.walletAddress) {
    const byWallet = await supabase
      .from("crypto_payment_sessions")
      .select("*")
      .eq("metadata->>wallet_address", context.walletAddress)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byWallet.data) return byWallet.data;
  }

  return null;
}

function isBreetTerminalSuccessEvent(eventType: string, rawStatus?: string | null, payload?: WebhookPayload) {
  const event = String(eventType || "").toLowerCase();
  const status = String(rawStatus || "").toLowerCase();
  const payloadStatus = String(payload?.status || "").toLowerCase();

  return (
    event.includes("completed") ||
    event.includes("success") ||
    event.includes("settlement.completed") ||
    status === "completed" ||
    status === "successful" ||
    status === "paid" ||
    payloadStatus === "completed" ||
    payloadStatus === "successful" ||
    payloadStatus === "paid"
  );
}

function isBreetFlaggedEvent(eventType: string, rawStatus?: string | null, payload?: WebhookPayload) {
  const event = String(eventType || "").toLowerCase();
  const status = String(rawStatus || "").toLowerCase();
  const payloadStatus = String(payload?.status || "").toLowerCase();

  return event.includes("flagged") || status.includes("flagged") || payloadStatus.includes("flagged");
}

async function recordNonTerminalEvent(input: {
  payload: WebhookPayload;
  eventType: string;
  providerReference: string | null;
  txHash: string | null;
  session: Record<string, unknown>;
  idempotencyKey: string | null;
  merchantId: string | null;
  invoiceId: string | null;
  paymentSessionId: string;
  sessionTable: "payment_sessions" | "crypto_payment_sessions";
}) {
  const lifecycleStatus = normalizeCryptoLifecycleStatus(
    mapBreetEventToCryptoStatus(input.eventType, stringValue(input.payload.status), input.payload)
  );
  const now = new Date().toISOString();
  const isFlagged = isBreetFlaggedEvent(input.eventType, stringValue(input.payload.status), input.payload);
  const pendingObservation = buildPendingObservation(input.payload, input.eventType);
  const mergedMetadata = {
    ...asRecord(input.session.metadata),
    ...pendingObservation,
  };
  const confirmationCount = pendingObservation.latest_confirmation_count;
  const convertedNgN =
    pendingObservation.latest_amount_settled ||
    confirmedBreetNgnAmount(input.payload, Number(input.session.converted_ngn_amount || input.session.amount_ngn || 0));
  const cryptoAmountReceived =
    positiveNumberValue(input.payload.cryptoAmount) ||
    positiveNumberValue(eventDataValue(input.payload, ["crypto_amount"])) ||
    positiveNumberValue(input.session.crypto_amount_received) ||
    null;
  const processingStatus = getNonTerminalProcessingStatus(input.eventType, lifecycleStatus);
  const updateBase = {
    provider_reference: input.providerReference || input.session.provider_reference || null,
    crypto_status: isFlagged ? "manual_review" : lifecycleStatus,
    webhook_status: "processed",
    raw_webhook_payload: input.payload,
    metadata: mergedMetadata,
    manual_review_reason: isFlagged ? "Breet flagged the transaction for review." : String(input.session.manual_review_reason || "") || null,
    updated_at: now,
  };

  const updatePayload =
    input.sessionTable === "crypto_payment_sessions"
      ? {
          ...updateBase,
          provider_reference: input.providerReference || input.session.provider_reference || null,
          converted_ngn_amount: convertedNgN,
          crypto_amount_received: cryptoAmountReceived,
          settlement_status: isFlagged ? "manual_review" : String(input.session.settlement_status || "pending"),
          processed_at: isFlagged ? now : input.session.processed_at || null,
        }
      : {
          ...updateBase,
          status: isFlagged
            ? "UNDER_REVIEW"
            : processingStatus === "awaiting_provider_completion"
              ? "AWAITING_CONFIRMATION"
              : String(input.session.status || "PENDING"),
          confirmation_count: confirmationCount,
          converted_ngn_amount: convertedNgN,
          crypto_amount_received: cryptoAmountReceived,
          tx_hash: input.txHash || input.session.tx_hash || null,
        };

  await supabase
    .from(input.sessionTable)
    .update(updatePayload)
    .eq("id", input.paymentSessionId);

  await supabase.from("payment_events").insert({
    merchant_id: input.merchantId,
    invoice_id: input.invoiceId,
    transaction_id: null,
    event_type: input.eventType,
    processor: "breet",
    processor_ref: input.providerReference || input.txHash || null,
    amount_kobo: Math.round(Number(convertedNgN || 0) * 100),
    raw_payload: input.payload,
    idempotency_key: input.idempotencyKey || null,
    payment_method: "crypto",
    payment_purpose:
      String(input.session.payment_purpose || input.session.payment_method || "") === "invoice_payment"
        ? "invoice_payment"
        : String(input.session.payment_purpose || "crypto_payment"),
    payment_reference: String(input.session.reference || input.session.internal_reference || input.paymentSessionId),
    provider_reference: input.providerReference || input.txHash || null,
    expected_amount: Number(input.session.amount_ngn || input.session.expected_ngn_amount || 0) || null,
    paid_amount: convertedNgN || null,
    currency: "NGN",
    plan_id: stringValue(input.session.plan_id) || null,
    customer_email: stringValue(asRecord(input.session.metadata).email) || null,
    processing_status: isFlagged ? "manual_review" : processingStatus,
    failure_reason: isFlagged ? "breet_flagged" : null,
    reconciliation_status: isFlagged ? "under_review" : "awaiting_terminal_breet_event",
  });

  await recordWebhookLog({
    eventType: input.eventType,
    status: isFlagged ? "under_review" : "processed",
    processorReference: input.providerReference,
    merchantId: input.merchantId,
    invoiceId: input.invoiceId,
    paymentSessionId: input.paymentSessionId,
    errorMessage: isFlagged ? "breet_flagged" : null,
    rawPayload: input.payload,
  });
  await updateProviderWebhookHealth("success");

  return NextResponse.json({
    received: true,
    mapped: true,
    terminal: false,
    status: isFlagged ? "manual_review" : lifecycleStatus,
  });
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
    walletAddress: context.walletAddress,
  });
  const planSession = invoiceSession ? null : await findPlanSession({
    paymentSessionId: context.paymentSessionId,
    internalReference: context.internalReference,
    providerReference: providerReference || undefined,
    walletAddress: context.walletAddress,
  });

  if (!invoiceSession && !planSession) {
    const { error: eventError } = await supabase.from("payment_events").insert({
      merchant_id: context.merchantId || null,
      invoice_id: context.invoiceId || null,
      transaction_id: null,
      event_type: eventType,
      processor: "breet",
      processor_ref: providerReference || txHash || null,
      amount_kobo: 0,
      raw_payload: payload,
      idempotency_key: idempotencyKey || null,
    });

    if (eventError) {
      console.warn("Breet unmatched webhook payment event failed:", {
        eventType,
        providerReference,
        walletAddress: context.walletAddress,
        reason: eventError.message,
      });
    }

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
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, merchant_id, invoice_number, outstanding_balance, amount_paid, fee_absorption, status, payment_status, grand_total, tax_value, discount_value")
    .eq("id", String(session.invoice_id || context.invoiceId || ""))
    .maybeSingle();

  if (invoiceError || !invoice) {
    await recordWebhookLog({
      eventType,
      status: "failed",
      processorReference: providerReference,
      merchantId: stringValue(session.merchant_id) || context.merchantId || null,
      invoiceId: stringValue(session.invoice_id) || context.invoiceId || null,
      paymentSessionId: String(session.id),
      errorMessage: invoiceError?.message || "Invoice not found for Breet session",
      rawPayload: payload,
    });
    await updateProviderWebhookHealth("failed");
    return NextResponse.json({ error: "Breet invoice mapping failed" }, { status: 500 });
  }

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
  const receivedNgN = confirmedBreetNgnAmount(payload, Number(session.amount_ngn || 0));
  const confirmationCount =
    numberValue(payload.confirmations) ||
    numberValue(payload.confirmation_count) ||
    numberValue(payload.confirmationCount) ||
    0;
  const settings = await readSettings([
    `crypto_${rail.toLowerCase()}_confirmations`,
    "crypto_platform_fee_bps",
    "crypto_overpayment_action",
  ]);
  const expectedConfirmations = Number(settings.get(`crypto_${rail.toLowerCase()}_confirmations`) || "12");
  const toleranceBps = Number(settings.get("crypto_underpayment_tolerance_bps") || "100");
  const settlementMode = normalizeBreetSettlementMode(String(session.settlement_mode || "treasury_manual"));
  const lifecycleStatus = normalizeCryptoLifecycleStatus(
    mapBreetEventToCryptoStatus(eventType, stringValue(payload.status), payload)
  );
  const pendingObservation = buildPendingObservation(payload, eventType);
  const accounting = getInvoiceSessionAccounting(session, invoice, payload, receivedNgN);
  const expectedCryptoAmount = Number(session.amount_crypto || 0);
  const hasExpectedCryptoAmount = expectedCryptoAmount > 0 && amountCrypto > 0;
  const coverageAmount = hasExpectedCryptoAmount ? amountCrypto : accounting.grossProviderValueNgn;
  const expectedCoverageAmount = hasExpectedCryptoAmount ? expectedCryptoAmount : accounting.customerPayableAmount;
  const paymentCoverageConfirmed =
    expectedCoverageAmount <= 0 ||
    withinTolerance(expectedCoverageAmount, coverageAmount, toleranceBps);

  if (!isBreetTerminalSuccessEvent(eventType, stringValue(payload.status), payload)) {
    return recordNonTerminalEvent({
      payload,
      eventType,
      providerReference,
      txHash,
      session,
      idempotencyKey,
      merchantId: stringValue(session.merchant_id) || context.merchantId || null,
      invoiceId: stringValue(session.invoice_id) || context.invoiceId || null,
      paymentSessionId: String(session.id),
      sessionTable: "payment_sessions",
    });
  }

  if (!paymentCoverageConfirmed) {
    const underpaidAmount = roundCurrency(Math.max(0, expectedCoverageAmount - coverageAmount));
    const underpaymentReason =
      coverageAmount < expectedCoverageAmount
        ? `Breet completed event confirmed less than the expected customer payment amount by ${underpaidAmount.toFixed(2)}.`
        : "Breet completed event requires manual review before invoice credit.";
    const accountingPayload = {
      ...payload,
      deraledger_accounting: {
        fee_payer: accounting.feePayer,
        selected_invoice_amount: accounting.selectedInvoiceAmount,
        customer_payable_amount: accounting.customerPayableAmount,
        gross_provider_value_ngn: accounting.grossProviderValueNgn,
        amount_settled_ngn: accounting.amountSettledNgn,
        provider_fee_amount: accounting.providerFeeAmount,
        invoice_credit_amount: 0,
        coverage_amount: coverageAmount,
        expected_coverage_amount: expectedCoverageAmount,
      },
    };

    await supabase
      .from("payment_sessions")
      .update({
        provider_reference: providerReference || session.provider_reference || null,
        tx_hash: txHash || session.tx_hash || null,
        crypto_amount_received: amountCrypto || null,
        converted_ngn_amount: accounting.grossProviderValueNgn,
        provider_fee: accounting.providerFeeAmount,
        settlement_fee: 0,
        expected_settlement_ngn: accounting.customerPayableAmount,
        actual_settlement_ngn: accounting.amountSettledNgn,
        amount_settled: accounting.amountSettledNgn,
        settlement_currency: "NGN",
        settlement_mode: settlementMode,
        status: "UNDER_REVIEW",
        crypto_status: "manual_review",
        confirmation_count: pendingObservation.latest_confirmation_count,
        manual_review_reason: underpaymentReason,
        metadata: {
          ...asRecord(session.metadata),
          ...pendingObservation,
          latest_invoice_credit_amount: 0,
          latest_customer_payable_amount: accounting.customerPayableAmount,
          latest_gross_provider_value_ngn: accounting.grossProviderValueNgn,
          latest_amount_settled: accounting.amountSettledNgn,
          latest_provider_fee_amount: accounting.providerFeeAmount,
          latest_fee_payer: accounting.feePayer,
        },
        webhook_status: "processed",
        raw_webhook_payload: accountingPayload,
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
      amount_kobo: Math.round(accounting.selectedInvoiceAmount * 100),
      raw_payload: accountingPayload,
      idempotency_key: idempotencyKey || null,
      payment_method: "crypto",
      payment_purpose: "invoice_payment",
      payment_reference: String(session.reference || session.id),
      provider_reference: providerReference || txHash || null,
      expected_amount: accounting.selectedInvoiceAmount,
      paid_amount: 0,
      currency: "NGN",
      fee: accounting.providerFeeAmount,
      customer_email: stringValue(asRecord(session.metadata).client_email) || null,
      processing_status: "manual_review",
      failure_reason: "amount_mismatch",
      reconciliation_status: "underpaid",
    });

    await recordWebhookLog({
      eventType,
      status: "under_review",
      processorReference: providerReference,
      merchantId: stringValue(session.merchant_id) || context.merchantId || null,
      invoiceId: stringValue(session.invoice_id) || context.invoiceId || null,
      paymentSessionId: String(session.id),
      errorMessage: underpaymentReason,
      rawPayload: accountingPayload,
    });
    await updateProviderWebhookHealth("success");

    return NextResponse.json({
      received: true,
      mapped: true,
      underReview: true,
      reason: "amount_mismatch",
    });
  }

  const accountingPayload = {
    ...payload,
    deraledger_accounting: {
      fee_payer: accounting.feePayer,
      selected_invoice_amount: accounting.selectedInvoiceAmount,
      customer_payable_amount: accounting.customerPayableAmount,
      gross_provider_value_ngn: accounting.grossProviderValueNgn,
      amount_settled_ngn: accounting.amountSettledNgn,
      provider_fee_amount: accounting.providerFeeAmount,
      invoice_credit_amount: accounting.selectedInvoiceAmount,
      destination_address: stringValue(payload.destinationAddress) || stringValue(payload.address) || stringValue(session.wallet_address),
      tx_hash: txHash || null,
    },
  };

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
    p_gross_ngn: accounting.selectedInvoiceAmount,
    p_platform_fee: accounting.providerFeeAmount,
    p_network_fee: 0,
    p_merchant_net_ngn: accounting.amountSettledNgn,
    p_confirmation_count: confirmationCount,
    p_expected_confirmations: expectedConfirmations,
    p_raw_payload: accountingPayload,
  });

  if (rpcResult.error || !rpcResult.data?.ok) {
    await recordWebhookLog({
      eventType,
      status: "failed",
      processorReference: providerReference,
      merchantId: stringValue(session.merchant_id) || context.merchantId || null,
      invoiceId: stringValue(session.invoice_id) || context.invoiceId || null,
      paymentSessionId: String(session.id),
      errorMessage: rpcResult.error?.message || "Breet invoice confirmation failed",
      rawPayload: payload,
    });
    await updateProviderWebhookHealth("failed");
    return NextResponse.json({ error: "Breet invoice confirmation failed" }, { status: 500 });
  }

  const { error: paymentSessionUpdateError } = await supabase
    .from("payment_sessions")
    .update({
      provider_reference: providerReference || session.provider_reference || null,
      tx_hash: txHash || session.tx_hash || null,
      crypto_amount_received: amountCrypto || null,
      converted_ngn_amount: accounting.grossProviderValueNgn,
      provider_fee: accounting.providerFeeAmount,
      settlement_fee: 0,
      expected_settlement_ngn: accounting.amountSettledNgn,
      actual_settlement_ngn: accounting.amountSettledNgn,
      amount_settled: accounting.amountSettledNgn,
      settlement_currency: "NGN",
      settlement_mode: settlementMode,
      status: "CONFIRMED",
      crypto_status: lifecycleStatus,
      confirmation_count: pendingObservation.latest_confirmation_count,
      metadata: {
        ...asRecord(session.metadata),
        ...pendingObservation,
        latest_invoice_credit_amount: accounting.selectedInvoiceAmount,
        latest_customer_payable_amount: accounting.customerPayableAmount,
        latest_gross_provider_value_ngn: accounting.grossProviderValueNgn,
        latest_amount_settled: accounting.amountSettledNgn,
        latest_provider_fee_amount: accounting.providerFeeAmount,
        latest_fee_payer: accounting.feePayer,
      },
      webhook_status: "processed",
      raw_webhook_payload: accountingPayload,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", session.id);

  if (paymentSessionUpdateError) {
    await recordWebhookLog({
      eventType,
      status: "failed",
      processorReference: providerReference,
      merchantId: stringValue(session.merchant_id) || context.merchantId || null,
      invoiceId: stringValue(session.invoice_id) || context.invoiceId || null,
      paymentSessionId: String(session.id),
      errorMessage: paymentSessionUpdateError.message,
      rawPayload: payload,
    });
    await updateProviderWebhookHealth("failed");
    return NextResponse.json({ error: "Breet invoice session finalization failed" }, { status: 500 });
  }

  await supabase.from("payment_events").insert({
    merchant_id: session.merchant_id,
    invoice_id: session.invoice_id,
    transaction_id: null,
    event_type: eventType,
    processor: "breet",
    processor_ref: providerReference || txHash || null,
    amount_kobo: Math.round(accounting.selectedInvoiceAmount * 100),
    raw_payload: accountingPayload,
    idempotency_key: idempotencyKey || null,
    payment_method: "crypto",
    payment_purpose: "invoice_payment",
    payment_reference: String(session.reference || session.id),
    provider_reference: providerReference || txHash || null,
    expected_amount: accounting.selectedInvoiceAmount,
    paid_amount: accounting.selectedInvoiceAmount,
    currency: "NGN",
    fee: accounting.providerFeeAmount,
    customer_email: stringValue(asRecord(session.metadata).client_email) || null,
    processing_status: "completed",
    reconciliation_status: "invoice_credited",
  });

  const { data: transactionRow } = await supabase
    .from("transactions")
    .select("id")
    .eq("processor_reference", providerReference || txHash || session.reference)
    .maybeSingle();

  if (transactionRow?.id) {
    await supabase
      .from("transactions")
      .update({
        amount_paid: accounting.selectedInvoiceAmount,
        paystack_fee: accounting.providerFeeAmount,
        fee_absorbed_by: accounting.feePayer,
        merchant_net_amount: accounting.amountSettledNgn,
        settlement_status: "settlement_pending",
        processor_reference: providerReference || txHash || session.reference,
        source_currency: rail,
        source_amount: amountCrypto || Number(session.amount_crypto || 0) || null,
        fx_rate: Number(session.exchange_rate || 0) || null,
      })
      .eq("id", transactionRow.id);
  }

  await supabase
    .from("invoices")
    .update({
      payment_provider: "breet",
      payment_method: "crypto",
      crypto_asset: rail,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(session.invoice_id));

  await supabase
    .from("treasury_transactions")
    .update({
      gross_ngn: accounting.customerPayableAmount,
      platform_fee: accounting.providerFeeAmount,
      network_fee: 0,
      merchant_net_ngn: accounting.amountSettledNgn,
      blockchain_tx_hash: txHash || null,
      breet_reference: providerReference || session.reference || null,
      raw_payload: accountingPayload,
      updated_at: new Date().toISOString(),
    })
    .eq("payment_session_id", String(session.id));

  const paymentRecordResult = await supabase
    .from("payment_records")
    .upsert(
      {
        merchant_id: session.merchant_id,
        invoice_id: session.invoice_id,
        legacy_transaction_id: transactionRow?.id || null,
        payment_purpose: "invoice_payment",
        payment_method: "crypto",
        provider_name: "breet",
        internal_reference: String(session.reference || session.id),
        provider_reference: providerReference || txHash || null,
        expected_amount: accounting.selectedInvoiceAmount,
        amount_paid: accounting.selectedInvoiceAmount,
        currency: "NGN",
        payment_status: "successful",
        customer_email: stringValue(asRecord(session.metadata).client_email) || null,
        raw_provider_payload: accountingPayload,
        paid_at: new Date().toISOString(),
      },
      { onConflict: "internal_reference" }
    )
    .select("id")
    .single();

  if (!paymentRecordResult.error && paymentRecordResult.data?.id) {
    const settlementSnapshot = extractSettlementSnapshot(session);
    await supabase.from("settlement_records").upsert(
      {
        payment_record_id: paymentRecordResult.data.id,
        legacy_transaction_id: transactionRow?.id || null,
        merchant_id: session.merchant_id,
        settlement_account_id: null,
        provider_settlement_account_id: null,
        provider_name: "breet",
        payment_method: "crypto",
        settlement_recipient_type: "merchant",
        settlement_currency: "NGN",
        gross_amount: accounting.customerPayableAmount,
        provider_fee: accounting.providerFeeAmount,
        platform_fee: 0,
        customer_fee: accounting.feePayer === "customer" ? accounting.providerFeeAmount : 0,
        merchant_fee: accounting.feePayer === "business" ? accounting.providerFeeAmount : 0,
        expected_settlement: accounting.amountSettledNgn,
        actual_settlement: accounting.amountSettledNgn,
        settlement_difference: 0,
        fee_payer: accounting.feePayer === "customer" ? "customer_pays_fee" : "merchant_pays_fee",
        settlement_status: "completed",
        settlement_mode: settlementMode,
        settlement_owner: "provider",
        payout_action_required: false,
        provider_settlement_reference: providerReference || txHash || String(session.reference || session.id),
        provider_fee_source: "breet_payload",
        expected_settlement_source: "breet_trade_completed",
        settlement_account_snapshot: settlementSnapshot.snapshot,
        settlement_bank_name: settlementSnapshot.bankName,
        settlement_account_name: settlementSnapshot.accountName,
        settlement_account_number_masked: settlementSnapshot.accountNumberMasked,
        provider_bank_id: settlementSnapshot.bankId,
        wallet_address: stringValue(session.wallet_address) || stringValue(payload.destinationAddress) || null,
        tx_hash: txHash || null,
        raw_settlement_payload: accountingPayload,
      },
      { onConflict: "payment_record_id" }
    );
  }

  await recordWebhookLog({
    eventType,
    status: "processed",
    processorReference: providerReference,
    merchantId: stringValue(session.merchant_id) || context.merchantId || null,
    invoiceId: stringValue(session.invoice_id) || context.invoiceId || null,
    paymentSessionId: String(session.id),
    rawPayload: accountingPayload,
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
  const convertedNgN = confirmedBreetNgnAmount(payload, expectedNgN);
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

  if (!isBreetTerminalSuccessEvent(eventType, stringValue(payload.status), payload)) {
    return recordNonTerminalEvent({
      payload,
      eventType,
      providerReference,
      txHash,
      session,
      idempotencyKey,
      merchantId: stringValue(session.merchant_id) || null,
      invoiceId: null,
      paymentSessionId: String(session.id),
      sessionTable: "crypto_payment_sessions",
    });
  }

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
