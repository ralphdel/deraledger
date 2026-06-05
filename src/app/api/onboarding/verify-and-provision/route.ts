import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { processSuccessfulFiatPayment } from "@/lib/services/fiat-payment-confirmation.service";
import { findPaymentRecordByReference } from "@/lib/services/plan-payment-recovery.service";

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
      const status =
        stringValue((verified as Record<string, unknown>).status) ||
        stringValue(asRecord((verified as Record<string, unknown>).data)?.status) ||
        stringValue((verified as Record<string, unknown>).paymentStatus);
      if (status === "success" || status === "PAID") {
        const verifiedRecord = verified as Record<string, unknown>;
        return {
          provider: providerName,
          raw: asRecord(verifiedRecord.data) || verifiedRecord,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
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
