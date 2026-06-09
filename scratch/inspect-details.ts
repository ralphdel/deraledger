import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const merchantId = "bfd66cab-3de2-4493-ad6f-ffdd9289f376";
  
  // 1. Fetch Verification Logs columns and raw response
  const { data: logs } = await supabase
    .from("verification_logs")
    .select("*")
    .eq("merchant_id", merchantId);
    
  console.log("=== VERIFICATION LOGS ===");
  logs?.forEach(l => {
    console.log(`Log ID: ${l.id}, Type: ${l.verification_type}`);
    console.log("Keys:", Object.keys(l));
    console.log("provider:", l.provider, "provider_name:", l.provider_name);
    console.log("raw_response keys:", l.raw_response ? Object.keys(l.raw_response) : null);
    if (l.raw_response) {
      console.log("raw_response excerpt:", JSON.stringify(l.raw_response).substring(0, 500));
    }
  });

  // 2. Fetch Business Director Verifications columns and responses
  const { data: dirVerifications } = await supabase
    .from("business_director_verifications")
    .select("*")
    .eq("merchant_id", merchantId);

  console.log("\n=== DIRECTOR VERIFICATIONS ===");
  dirVerifications?.forEach(d => {
    console.log(`Dir Verification ID: ${d.id}`);
    console.log("Keys:", Object.keys(d));
    console.log("director_name:", d.director_name, "invitation_id:", d.invitation_id);
    console.log("normalized_response keys:", d.normalized_response ? Object.keys(d.normalized_response) : null);
    if (d.normalized_response) {
      console.log("normalized_response excerpt:", JSON.stringify(d.normalized_response).substring(0, 500));
    }
  });
}

run().catch(console.error);
