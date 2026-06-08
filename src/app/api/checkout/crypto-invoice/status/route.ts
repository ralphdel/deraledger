import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type SessionRow = {
  id: string;
  invoice_id: string;
  payment_rail: string | null;
  payment_method: string | null;
  amount_ngn: number | string | null;
  amount_crypto: number | string | null;
  crypto_amount_received: number | string | null;
  converted_ngn_amount: number | string | null;
  exchange_rate: number | string | null;
  wallet_address: string | null;
  network: string | null;
  status: string | null;
  crypto_status: string | null;
  confirmation_count: number | null;
  expected_confirmations: number | null;
  reference: string | null;
  provider_reference: string | null;
  tx_hash: string | null;
  metadata: Record<string, unknown> | null;
  raw_webhook_payload: Record<string, unknown> | null;
  webhook_status: string | null;
  expires_at: string | null;
  paid_at: string | null;
  created_at: string;
};

type AccountingMetadata = {
  latest_invoice_credit_amount?: unknown;
  invoice_credit_amount?: unknown;
  latest_customer_payable_amount?: unknown;
  customer_payable_amount?: unknown;
  latest_gross_provider_value_ngn?: unknown;
  gross_provider_value_ngn?: unknown;
  latest_provider_fee_amount?: unknown;
  provider_fee_amount?: unknown;
  latest_fee_payer?: unknown;
  fee_payer?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

type CheckoutStatusInfo = {
  status: "waiting_for_payment" | "awaiting_provider_completion" | "completed" | "failed" | "expired" | "manual_review";
  message: string;
  latestEvent?: string | null;
  latestProviderStatus?: string | null;
};

function getAmountReview(session: SessionRow) {
  const payload = asRecord(session.raw_webhook_payload);
  const metadata = asRecord(session.metadata);
  const accounting = asRecord(payload.deraledger_accounting);
  const expectedAmount =
    numberValue(accounting.expected_coverage_amount) ??
    numberValue(accounting.customer_payable_amount) ??
    numberValue(metadata.customer_payable_amount) ??
    numberValue(session.amount_ngn) ??
    0;
  const detectedAmount =
    numberValue(accounting.coverage_amount) ??
    numberValue(accounting.gross_provider_value_ngn) ??
    numberValue(metadata.latest_estimated_ngn) ??
    numberValue(metadata.latest_amount_settled) ??
    numberValue(session.converted_ngn_amount) ??
    0;
  const explicitShortfallAmount =
    numberValue(accounting.shortfall_amount_ngn) ??
    numberValue(metadata.pending_shortfall_amount_ngn);
  const explicitOverpaymentAmount =
    numberValue(accounting.overpayment_amount_ngn) ??
    numberValue(metadata.pending_overpayment_amount_ngn);
  const hasDetectedAmount = detectedAmount > 0;

  return {
    shortfallAmount: Number((explicitShortfallAmount ?? (hasDetectedAmount ? Math.max(0, expectedAmount - detectedAmount) : 0)).toFixed(2)),
    overpaymentAmount: Number((explicitOverpaymentAmount ?? (hasDetectedAmount ? Math.max(0, detectedAmount - expectedAmount) : 0)).toFixed(2)),
  };
}

function toCheckoutStatus(session: SessionRow): CheckoutStatusInfo {
  const status = String(session.status || "").toUpperCase();
  const cryptoStatus = String(session.crypto_status || "").toLowerCase();
  const payload = asRecord(session.raw_webhook_payload);
  const amountReview = getAmountReview(session);
  const latestEvent =
    stringValue(asRecord(session.metadata).latest_event) ||
    stringValue(payload.event) ||
    stringValue(asRecord(session.metadata).latest_provider_event);
  const latestProviderStatus =
    stringValue(asRecord(session.metadata).latest_provider_status) ||
    stringValue(payload.status);

  if (status === "EXPIRED" || cryptoStatus === "crypto_expired") {
    return {
      status: "expired" as const,
      message: "Payment could not be completed. Please generate a new payment address or contact support.",
    };
  }

  if (status === "FAILED" || cryptoStatus === "failed") {
    return {
      status: "failed" as const,
      message: "Payment could not be completed. Please generate a new payment address or contact support.",
    };
  }

  if (status === "UNDER_REVIEW" || cryptoStatus === "manual_review" || cryptoStatus === "crypto_underpaid" || cryptoStatus === "crypto_overpaid") {
    return {
      status: "manual_review" as const,
      message: amountReview.shortfallAmount > 0
        ? `Payment is under review because the confirmed amount is short by NGN ${amountReview.shortfallAmount.toLocaleString()}.`
        : "Payment is under review. We could not complete this automatically yet.",
      latestEvent,
      latestProviderStatus,
    };
  }

  if (status === "PAID" || status === "CONFIRMED" || status === "SETTLED" || Boolean(session.paid_at) || cryptoStatus === "crypto_payment_confirmed" || cryptoStatus === "crypto_settlement_completed") {
    return {
      status: "completed" as const,
      message: "Payment confirmed. Your invoice has been updated.",
    };
  }

  if (
    latestEvent === "trade.pending" ||
    cryptoStatus === "crypto_payment_detected" ||
    cryptoStatus === "crypto_payment_confirming" ||
    status === "AWAITING_CONFIRMATION"
  ) {
    return {
      status: "awaiting_provider_completion" as const,
      message: amountReview.shortfallAmount > 0
        ? `Crypto payment detected, but the amount is below the expected invoice payment by NGN ${amountReview.shortfallAmount.toLocaleString()}. Awaiting final Breet confirmation and admin review.`
        : "Crypto payment detected. Awaiting final confirmation from Breet.",
      latestEvent,
      latestProviderStatus,
    };
  }

  return {
    status: "waiting_for_payment" as const,
    message: "Waiting for crypto payment. Send the exact amount to the wallet address below.",
    latestEvent,
    latestProviderStatus,
  };
}

async function findSession(sessionId: string | null, invoiceId: string | null) {
  if (sessionId) {
    const { data } = await supabase
      .from("payment_sessions")
      .select("id, invoice_id, payment_rail, payment_method, amount_ngn, amount_crypto, crypto_amount_received, converted_ngn_amount, exchange_rate, wallet_address, network, status, crypto_status, confirmation_count, expected_confirmations, reference, provider_reference, tx_hash, metadata, raw_webhook_payload, webhook_status, expires_at, paid_at, created_at")
      .eq("id", sessionId)
      .eq("provider_name", "breet")
      .eq("payment_method", "crypto")
      .maybeSingle();

    return (data as SessionRow | null) || null;
  }

  if (!invoiceId) return null;

  const { data } = await supabase
    .from("payment_sessions")
    .select("id, invoice_id, payment_rail, payment_method, amount_ngn, amount_crypto, crypto_amount_received, converted_ngn_amount, exchange_rate, wallet_address, network, status, crypto_status, confirmation_count, expected_confirmations, reference, provider_reference, tx_hash, metadata, raw_webhook_payload, webhook_status, expires_at, paid_at, created_at")
    .eq("invoice_id", invoiceId)
    .eq("provider_name", "breet")
    .eq("payment_method", "crypto")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as SessionRow | null) || null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const invoiceId = url.searchParams.get("invoiceId");

  if (!sessionId && !invoiceId) {
    return NextResponse.json({ error: "Missing sessionId or invoiceId" }, { status: 400 });
  }

  const session = await findSession(sessionId, invoiceId);
  if (!session) {
    return NextResponse.json({ error: "Crypto payment session not found" }, { status: 404 });
  }

  const payload = asRecord(session.raw_webhook_payload);
  const metadata = asRecord(session.metadata);
  const statusInfo = toCheckoutStatus(session);
  const amountReview = getAmountReview(session);
  const confirmations =
    numberValue(metadata.latest_confirmation_count) ??
    numberValue(payload.confirmations) ??
    session.confirmation_count ??
    0;
  const rate =
    numberValue(metadata.latest_rate) ??
    numberValue(payload.rate) ??
    numberValue(session.exchange_rate);
  const amountInUSD =
    numberValue(metadata.latest_amount_in_usd) ??
    numberValue(payload.amountInUSD);
  const estimatedNgn =
    numberValue(metadata.latest_estimated_ngn) ??
    (amountInUSD !== null && rate !== null ? Number((amountInUSD * rate).toFixed(2)) : null);
  const amountSettled =
    numberValue(metadata.latest_amount_settled) ??
    numberValue(payload.amountSettled) ??
    numberValue(session.converted_ngn_amount);
  const accounting = asRecord(payload.deraledger_accounting) as AccountingMetadata;
  const invoiceCreditAmount =
    numberValue(accounting.latest_invoice_credit_amount) ??
    numberValue(accounting.invoice_credit_amount) ??
    numberValue(metadata.latest_invoice_credit_amount) ??
    numberValue(session.amount_ngn);
  const customerPayableAmount =
    numberValue(accounting.customer_payable_amount) ??
    numberValue(metadata.customer_payable_amount) ??
    numberValue(metadata.latest_customer_payable_amount) ??
    numberValue(session.amount_ngn);
  const grossProviderValueNgn =
    numberValue(accounting.gross_provider_value_ngn) ??
    numberValue(metadata.latest_gross_provider_value_ngn) ??
    estimatedNgn;
  const providerFeeAmount =
    numberValue(accounting.provider_fee_amount) ??
    numberValue(metadata.latest_provider_fee_amount);
  const feePayer =
    stringValue(accounting.fee_payer) ??
    stringValue(metadata.latest_fee_payer) ??
    stringValue(metadata.fee_payer) ??
    stringValue(metadata.invoice_fee_absorption);
  const txHash =
    session.tx_hash ||
    stringValue(metadata.latest_tx_hash) ||
    stringValue(payload.txHash) ||
    stringValue(payload.tx_hash);
  const latestEvent = statusInfo.latestEvent || stringValue(payload.event);

  return NextResponse.json({
    sessionId: session.id,
    invoiceId: session.invoice_id,
    status: statusInfo.status,
    event: latestEvent,
    provider: "breet",
    paymentMethod: session.payment_method || "crypto",
    txHash,
    confirmations,
    asset:
      stringValue(metadata.latest_asset) ||
      stringValue(payload.asset) ||
      session.payment_rail,
    amountInUSD,
    rate,
    estimatedNgn,
    invoiceCreditAmount,
    shortfallAmount: amountReview.shortfallAmount,
    overpaymentAmount: amountReview.overpaymentAmount,
    customerPayableAmount,
    grossProviderValueNgn,
    amountSettled,
    providerFeeAmount,
    feePayer,
    invoiceCredited: statusInfo.status === "completed",
    message: statusInfo.message,
    walletAddress: session.wallet_address,
    network: session.network,
    reference: session.reference,
    fiatAmount: numberValue(session.amount_ngn),
    cryptoAmount:
      numberValue(session.crypto_amount_received) ??
      numberValue(payload.cryptoAmount) ??
      numberValue(session.amount_crypto),
    expiresAt: session.expires_at,
    expectedConfirmations: session.expected_confirmations ?? null,
    latestProviderStatus: statusInfo.latestProviderStatus || null,
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
