import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data: payments, error: pErr } = await supabaseAdmin
    .from("subscription_payments")
    .select("*")
    .like("paystack_ref", "upg_c072%");
    
  console.log("Payments:", payments, pErr);

  const { data: m, error: mErr } = await supabaseAdmin
    .from("merchants")
    .select("*")
    .eq("id", "c07210d4-67c3-4a14-8e67-2c3294ee1fd3")
    .single();

  console.log("Merchant:", m?.subscription_plan, m?.merchant_tier, m?.monthly_collection_limit, mErr);
}

check();
