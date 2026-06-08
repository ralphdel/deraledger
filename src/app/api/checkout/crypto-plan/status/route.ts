import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type CryptoPlanSessionRow = {
  id: string;
  merchant_id: string | null;
  user_id: string | null;
  plan_id: string | null;
  payment_purpose: string | null;
  provider_name: string | null;
  internal_reference: string | null;
  provider_reference: string | null;
  payment_method: string | null;
  expected_ngn_amount: number | string | null;
  crypto_asset: string | null;
  crypto_network: string | null;
  crypto_amount_expected: number | string | null;
  crypto_amount_received: number | string | null;
  converted_ngn_amount: number | string | null;
  provider_fee: number | string | null;
  amount_settled: number | string | null;
  expected_settlement_ngn: number | string | null;
  actual_settlement_ngn: number | string | null;
  settlement_mode: string | null;
  settlement_recipient_type: string | null;
  crypto_status: string | null;
  settlement_status: string | null;
  webhook_status: string | null;
  payment_status: string | null;
  payment_session_reference: string | null;
  tx_hash?: string | null;
  expires_at: string | null;
  paid_at: string | null;
  processed_at: string | null;
  raw_webhook_payload: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type CheckoutStatus =
  | "waiting_for_payment"
  | "awaiting_provider_completion"
  | "completed"
  | "failed"
  | "expired"
  | "manual_review";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function getAmountReview(session: CryptoPlanSessionRow) {
  const payload = asRecord(session.raw_webhook_payload);
  const metadata = asRecord(session.metadata);
  const accounting = asRecord(payload.deraledger_accounting);
  const latestEvent =
    stringValue(metadata.latest_event) ||
    stringValue(payload.event) ||
    stringValue(metadata.latest_provider_event);
  const expectedAmount = numberValue(session.expected_ngn_amount) ?? 0;
  const explicitShortfallAmount =
    numberValue(accounting.shortfall_amount_ngn) ??
    (latestEvent === "trade.pending" ? numberValue(metadata.pending_shortfall_amount_ngn) : null);
  const explicitOverpaymentAmount =
    numberValue(accounting.overpayment_amount_ngn) ??
    (latestEvent === "trade.pending" ? numberValue(metadata.pending_overpayment_amount_ngn) : null);
  const detectedAmount =
    numberValue(accounting.gross_provider_value_ngn) ??
    numberValue(metadata.latest_estimated_ngn) ??
    numberValue(metadata.latest_amount_settled) ??
    numberValue(session.converted_ngn_amount) ??
    0;
  const hasDetectedAmount = detectedAmount > 0;
  const shortfallAmount =
    explicitShortfallAmount ??
    (hasDetectedAmount ? Math.max(0, expectedAmount - detectedAmount) : 0);
  const overpaymentAmount =
    explicitOverpaymentAmount ??
    (hasDetectedAmount ? Math.max(0, detectedAmount - expectedAmount) : 0);

  return {
    expectedAmount,
    detectedAmount,
    shortfallAmount: Number(shortfallAmount.toFixed(2)),
    overpaymentAmount: Number(overpaymentAmount.toFixed(2)),
  };
}

function statusMessage(session: CryptoPlanSessionRow, status: CheckoutStatus) {
  const purpose = String(session.payment_purpose || "");
  const metadata = asRecord(session.metadata);
  const paymentType = String(metadata.type || "");
  const amountReview = getAmountReview(session);

  if (status === "completed") {
    if (purpose === "plan_renewal" || paymentType === "subscription_renewal") {
      return "Payment confirmed. Your subscription renewal has been applied.";
    }
    if (purpose === "plan_upgrade" || paymentType === "subscription_upgrade") {
      return "Payment confirmed. Your upgrade has been applied.";
    }
    return "Payment confirmed. Continue account setup from the email we sent you.";
  }

  if (status === "awaiting_provider_completion") {
    if (amountReview.shortfallAmount > 0) {
      return `Payment detected, but the confirmed amount is below the expected plan amount by NGN ${amountReview.shortfallAmount.toLocaleString()}. Awaiting final Breet confirmation and admin review.`;
    }
    return "Payment detected. Awaiting final confirmation from Breet.";
  }

  if (status === "manual_review") {
    if (amountReview.shortfallAmount > 0) {
      return `Payment is under review because the confirmed amount is short by NGN ${amountReview.shortfallAmount.toLocaleString()}.`;
    }
    return "Payment is under review. We could not complete this automatically yet.";
  }

  if (status === "failed" || status === "expired") {
    return "Payment could not be completed. Please generate a new payment address or contact support.";
  }

  return "Waiting for crypto payment. Send the exact amount to the wallet address below.";
}

function toCheckoutStatus(session: CryptoPlanSessionRow) {
  const paymentStatus = String(session.payment_status || "").toLowerCase();
  const cryptoStatus = String(session.crypto_status || "").toLowerCase();
  const settlementStatus = String(session.settlement_status || "").toLowerCase();
  const payload = asRecord(session.raw_webhook_payload);
  const metadata = asRecord(session.metadata);
  const latestEvent =
    stringValue(metadata.latest_event) ||
    stringValue(payload.event) ||
    stringValue(metadata.latest_provider_event);
  const latestProviderStatus =
    stringValue(metadata.latest_provider_status) ||
    stringValue(payload.status);

  const isExpired =
    !session.paid_at &&
    !!session.expires_at &&
    new Date(session.expires_at).getTime() < Date.now();

  let status: CheckoutStatus = "waiting_for_payment";

  if (isExpired || cryptoStatus === "crypto_expired") {
    status = "expired";
  } else if (cryptoStatus === "manual_review" || settlementStatus === "manual_review" || cryptoStatus === "crypto_underpaid" || cryptoStatus === "crypto_overpaid") {
    status = "manual_review";
  } else if (paymentStatus === "successful" || settlementStatus === "completed" || Boolean(session.paid_at) || cryptoStatus === "crypto_payment_confirmed" || cryptoStatus === "crypto_settlement_completed") {
    status = "completed";
  } else if (cryptoStatus === "failed" || settlementStatus === "failed" || paymentStatus === "failed") {
    status = "failed";
  } else if (
    latestEvent === "trade.pending" ||
    cryptoStatus === "crypto_payment_detected" ||
    cryptoStatus === "crypto_payment_confirming"
  ) {
    status = "awaiting_provider_completion";
  }

  return {
    status,
    latestEvent,
    latestProviderStatus,
    message: statusMessage(session, status),
  };
}

async function findPlanSession(params: {
  sessionId: string | null;
  reference: string | null;
  providerReference: string | null;
  paymentSessionReference: string | null;
}) {
  if (params.sessionId) {
    const { data } = await supabase
      .from("crypto_payment_sessions")
      .select("*")
      .eq("id", params.sessionId)
      .eq("provider_name", "breet")
      .eq("payment_method", "crypto")
      .maybeSingle();
    if (data) return data as CryptoPlanSessionRow;
  }

  if (params.reference) {
    const { data } = await supabase
      .from("crypto_payment_sessions")
      .select("*")
      .eq("internal_reference", params.reference)
      .eq("provider_name", "breet")
      .eq("payment_method", "crypto")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as CryptoPlanSessionRow;
  }

  if (params.providerReference) {
    const { data } = await supabase
      .from("crypto_payment_sessions")
      .select("*")
      .eq("provider_reference", params.providerReference)
      .eq("provider_name", "breet")
      .eq("payment_method", "crypto")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as CryptoPlanSessionRow;
  }

  if (params.paymentSessionReference) {
    const { data } = await supabase
      .from("crypto_payment_sessions")
      .select("*")
      .eq("payment_session_reference", params.paymentSessionReference)
      .eq("provider_name", "breet")
      .eq("payment_method", "crypto")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as CryptoPlanSessionRow;
  }

  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const reference = url.searchParams.get("reference");
  const providerReference = url.searchParams.get("providerReference");
  const paymentSessionReference = url.searchParams.get("paymentSessionReference");

  if (!sessionId && !reference && !providerReference && !paymentSessionReference) {
    return NextResponse.json({ error: "Missing session lookup parameter" }, { status: 400 });
  }

  const session = await findPlanSession({ sessionId, reference, providerReference, paymentSessionReference });
  if (!session) {
    return NextResponse.json({ error: "Crypto payment session not found" }, { status: 404 });
  }

  const payload = asRecord(session.raw_webhook_payload);
  const metadata = asRecord(session.metadata);
  const accounting = asRecord(payload.deraledger_accounting);
  const statusInfo = toCheckoutStatus(session);
  const amountReview = getAmountReview(session);

  return NextResponse.json({
    sessionId: session.id,
    paymentSessionReference: session.payment_session_reference,
    provider: "breet",
    providerReference: session.provider_reference,
    reference: session.internal_reference,
    paymentPurpose: session.payment_purpose,
    paymentMethod: session.payment_method || "crypto",
    planId: session.plan_id,
    status: statusInfo.status,
    message: statusInfo.message,
    event: statusInfo.latestEvent,
    latestProviderStatus: statusInfo.latestProviderStatus,
    walletAddress:
      stringValue(metadata.wallet_address) ||
      stringValue(payload.destinationAddress) ||
      stringValue(payload.address),
    network: session.crypto_network,
    asset: session.crypto_asset,
    fiatAmount: numberValue(session.expected_ngn_amount),
    cryptoAmount:
      numberValue(session.crypto_amount_received) ??
      numberValue(payload.cryptoAmount) ??
      numberValue(session.crypto_amount_expected),
    exchangeRate:
      numberValue(metadata.exchange_rate) ??
      numberValue(payload.rate),
    expectedAmount: numberValue(session.expected_ngn_amount),
    shortfallAmount: amountReview.shortfallAmount,
    overpaymentAmount: amountReview.overpaymentAmount,
    customerPayableAmount:
      numberValue(accounting.customer_payable_amount) ??
      numberValue(session.expected_ngn_amount),
    grossProviderValueNgn:
      numberValue(accounting.gross_provider_value_ngn) ??
      numberValue(session.converted_ngn_amount),
    amountSettled:
      numberValue(accounting.amount_settled_ngn) ??
      numberValue(session.amount_settled) ??
      numberValue(session.actual_settlement_ngn),
    providerFeeAmount:
      numberValue(accounting.provider_fee_amount) ??
      numberValue(session.provider_fee),
    feePayer:
      stringValue(accounting.fee_payer) ??
      "business",
    settlementMode: session.settlement_mode,
    settlementRecipientType: session.settlement_recipient_type,
    settlementAccountSnapshot: asRecord(session.metadata).settlement_account_snapshot || null,
    txHash:
      stringValue(accounting.tx_hash) ||
      stringValue(payload.txHash) ||
      stringValue(payload.tx_hash),
    expiresAt: session.expires_at,
    paidAt: session.paid_at,
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
