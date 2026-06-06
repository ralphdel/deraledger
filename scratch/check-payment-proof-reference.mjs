import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const reference = process.argv[2];
if (!reference) {
  console.error("Usage: node scratch/check-payment-proof-reference.mjs <reference>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function maskEmail(email) {
  if (!email) return null;
  return email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  return Object.keys(payload);
}

const records = await supabase
  .from("payment_records")
  .select("created_at,provider_name,payment_method,payment_purpose,internal_reference,provider_reference,expected_amount,amount_paid,payment_status,processing_status,account_setup_status,password_setup_required,setup_recovery_email_sent_at,setup_recovery_email_count,customer_email,reconciliation_status,failure_reason,raw_provider_payload")
  .or(`internal_reference.eq.${reference},provider_reference.eq.${reference}`);

const events = await supabase
  .from("payment_events")
  .select("created_at,processor,event_type,processor_ref,payment_method,payment_purpose,payment_reference,provider_reference,expected_amount,paid_amount,fee,customer_email,processing_status,reconciliation_status,failure_reason,raw_payload")
  .or(`payment_reference.eq.${reference},provider_reference.eq.${reference},processor_ref.eq.${reference}`);

console.log(JSON.stringify({
  reference,
  record_error: records.error?.message || null,
  records: (records.data || []).map((row) => ({
    ...row,
    customer_email: maskEmail(row.customer_email),
    raw_provider_payload: summarizePayload(row.raw_provider_payload),
  })),
  event_error: events.error?.message || null,
  events: (events.data || []).map((row) => ({
    ...row,
    customer_email: maskEmail(row.customer_email),
    raw_payload: summarizePayload(row.raw_payload),
  })),
}, null, 2));
