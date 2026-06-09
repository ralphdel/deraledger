import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const merchantId = "bfd66cab-3de2-4493-ad6f-ffdd9289f376";
  
  // 1. Merchant tier and plan
  const { data: merchant } = await supabase
    .from("merchants")
    .select("subscription_plan, merchant_tier, business_registry_snapshot_id")
    .eq("id", merchantId)
    .single();
  console.log("Merchant plan/tier:", merchant);

  // 2. business_director_verifications full row
  const { data: dirVer } = await supabase
    .from("business_director_verifications")
    .select("*")
    .eq("merchant_id", merchantId);
  console.log("\nbusiness_director_verifications row:", dirVer);

  // 3. verification_logs with type = director
  const { data: logs } = await supabase
    .from("verification_logs")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("verification_type", "director");
  console.log("\nverification_logs (director):", logs);

  // 4. director_invitations
  const { data: invites } = await supabase
    .from("director_invitations")
    .select("*")
    .eq("merchant_id", merchantId);
  console.log("\ndirector_invitations:", invites);
}

run().catch(console.error);
