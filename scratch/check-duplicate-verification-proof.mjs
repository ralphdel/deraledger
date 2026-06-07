import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const reference = process.argv[2];
const provider = process.argv[3] || "paystack";
if (!reference) {
  console.error("Usage: node scratch/check-duplicate-verification-proof.mjs <reference> [provider]");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function snapshot(label) {
  const record = await supabase
    .from("payment_records")
    .select("merchant_id,setup_recovery_email_sent_at,setup_recovery_email_count,processing_status,account_setup_status")
    .eq("internal_reference", reference)
    .maybeSingle();

  const merchantId = record.data?.merchant_id;
  const subscriptions = merchantId
    ? await supabase.from("subscriptions").select("id", { count: "exact" }).eq("merchant_id", merchantId)
    : { count: 0, error: null };
  const events = await supabase
    .from("payment_events")
    .select("id", { count: "exact" })
    .eq("payment_reference", reference);

  return {
    label,
    record_error: record.error?.message || null,
    record: record.data,
    subscriptions_error: subscriptions.error?.message || null,
    subscription_count: subscriptions.count,
    events_error: events.error?.message || null,
    event_count: events.count,
  };
}

const before = await snapshot("before");

const response = await fetch("https://www.deraledger.com/api/onboarding/verify-and-provision", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ reference, provider }),
});
const verificationPayload = await response.json().catch(() => ({}));

const after = await snapshot("after");

console.log(
  JSON.stringify(
    {
      reference,
      provider,
      before,
      duplicate_verification: {
        status: response.status,
        body: verificationPayload,
      },
      after,
    },
    null,
    2
  )
);
