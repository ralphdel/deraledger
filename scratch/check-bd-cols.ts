import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const columns = [
    "invitation_id",
    "business_affiliation_id",
    "invited_director_name",
    "invited_director_email",
    "returned_bvn_name",
    "name_match_status",
    "selfie_match",
    "provider_threshold",
    "sandbox_override",
    "verified_at"
  ];

  console.log("Checking business_director_verifications columns...");
  const { data, error } = await supabaseAdmin
    .from("business_director_verifications")
    .select(columns.join(","))
    .limit(0);

  if (error) {
    console.error("❌ Error querying columns:", error.message);
  } else {
    console.log("✅ All columns exist on business_director_verifications!");
  }
}

check();
