import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const mId = "c07210d4-67c3-4a14-8e67-2c3294ee1fd3";

  const { data: m, error: mErr } = await supabaseAdmin
    .from("merchants")
    .select("verification_status")
    .eq("id", mId)
    .single();

  console.log("Merchant verification:", m?.verification_status, mErr);

  const { data: subs, error: sErr } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("merchant_id", mId)
    .order("created_at", { ascending: false });

  console.log("Subscriptions:", subs, sErr);
}

check();
