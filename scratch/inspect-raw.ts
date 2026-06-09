import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const merchantId = "bfd66cab-3de2-4493-ad6f-ffdd9289f376";

  const { data: dirVer } = await supabase
    .from("business_director_verifications")
    .select("*")
    .eq("merchant_id", merchantId);

  console.log("=== business_director_verifications ===");
  dirVer?.forEach(d => {
    console.log("ID:", d.id);
    console.log("Normalized Response:", JSON.stringify(d.normalized_response, null, 2));
  });

  const { data: logs } = await supabase
    .from("verification_logs")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("verification_type", "director");

  console.log("\n=== verification_logs ===");
  logs?.forEach(l => {
    console.log("Log ID:", l.id);
    console.log("Raw Response:", JSON.stringify(l.raw_response, null, 2));
  });
}

run().catch(console.error);
