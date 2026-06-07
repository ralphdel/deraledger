import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const reference = process.argv[2];
if (!reference) {
  console.error("Usage: node scratch/check-proof-activation-safety.mjs <reference>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const recordResult = await supabase
  .from("payment_records")
  .select("id,user_id,merchant_id,business_id,customer_email,internal_reference,processing_status,account_setup_status")
  .eq("internal_reference", reference)
  .maybeSingle();

const record = recordResult.data;

const merchants = record?.customer_email
  ? await supabase
      .from("merchants")
      .select("id,user_id,business_name,subscription_plan,created_at")
      .eq("email", record.customer_email)
  : { data: [], error: null };

const subscriptions = record?.merchant_id
  ? await supabase
      .from("subscriptions")
      .select("id,merchant_id,plan_type,status,amount_paid,created_at")
      .eq("merchant_id", record.merchant_id)
  : { data: [], error: null };

console.log(
  JSON.stringify(
    {
      reference,
      record_error: recordResult.error?.message || null,
      record,
      matching_merchants_error: merchants.error?.message || null,
      matching_merchants: merchants.data || [],
      subscriptions_for_record_merchant_error: subscriptions.error?.message || null,
      subscriptions_for_record_merchant: subscriptions.data || [],
    },
    null,
    2
  )
);
