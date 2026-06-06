import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const reference = process.argv[2];
if (!reference) {
  console.error("Usage: node scratch/insert-verification-audit-proof.mjs <reference>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: record, error: recordError } = await supabase
  .from("payment_records")
  .select("*")
  .eq("internal_reference", reference)
  .maybeSingle();

if (recordError || !record) {
  console.error(recordError || `No payment record for ${reference}`);
  process.exit(1);
}

const rawPayload = {
  paymentStatus: "PENDING",
  paymentReference: reference,
  transactionReference: "verification-probe",
  amountPaid: "0.00",
  currency: "NGN",
  paymentMethod: "ACCOUNT_TRANSFER",
  metaData: record.metadata,
};

const { error } = await supabase.from("payment_events").upsert(
  {
    merchant_id: record.merchant_id || null,
    invoice_id: null,
    event_type: "monnify.verification.received",
    processor: "monnify",
    processor_ref: reference,
    amount_kobo: 0,
    raw_payload: rawPayload,
    idempotency_key: `monnify:${reference}:verification:received:probe`,
    payment_method: "bank_transfer",
    payment_purpose: record.payment_purpose,
    payment_reference: reference,
    provider_reference: "verification-probe",
    expected_amount: Number(record.expected_amount || 0),
    paid_amount: 0,
    currency: "NGN",
    fee: null,
    plan_id: record.plan_id || null,
    subscription_id: null,
    business_id: record.business_id || null,
    customer_email: record.customer_email || null,
    processing_status: "received",
    failure_reason: "Provider verification status: PENDING.",
    settlement_destination_source: record.settlement_destination_source || "provider_dashboard",
    reconciliation_status: null,
  },
  { onConflict: "idempotency_key" }
);

console.log(JSON.stringify({ error: error?.message || null }, null, 2));
