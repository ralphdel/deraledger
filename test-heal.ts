import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function heal() {
  const mId = "c07210d4-67c3-4a14-8e67-2c3294ee1fd3";

  // Upsert the subscription correctly to corporate and active
  const expiryDate = new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error: subUpsertError } = await supabaseAdmin.from("subscriptions").upsert({
    merchant_id: mId,
    plan_type: "corporate",
    amount_paid: 20000,
    start_date: new Date().toISOString(),
    expiry_date: expiryDate,
    status: "active",
    last_notified_at: null,
    is_banner_dismissed: false,
    updated_at: new Date().toISOString()
  }, { onConflict: 'merchant_id' });

  console.log("Healed subscription:", subUpsertError || "Success");
}

heal();
