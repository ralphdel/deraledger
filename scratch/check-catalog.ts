import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkCatalog() {
  console.log("Querying database catalog for column names...");
  
  // We can query information_schema.columns by making a RPC if we have one, 
  // or since we don't have a direct SQL runner or RPC, let's query the tables with a select that checks if they exist
  // Wait, let's try selecting column_name from a system view like pg_attribute via a custom select
  // Actually, we can use the PostgREST API to read from pg_catalog/pg_attribute if permitted,
  // but usually PostgREST only exposes public schema.
  // Let's test the columns one by one by calling a simple select on each column.
  
  const bdColumns = [
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

  console.log("\n--- Checking business_director_verifications columns ---");
  for (const col of bdColumns) {
    const { error } = await supabaseAdmin
      .from("business_director_verifications")
      .select(col)
      .limit(0);
    if (error) {
      console.log(`❌ Column "${col}" does NOT exist. Error: ${error.message}`);
    } else {
      console.log(`✅ Column "${col}" exists.`);
    }
  }

  const logColumns = [
    "verification_subject",
    "invitation_id",
    "business_affiliation_id",
    "invited_director_name",
    "returned_bvn_name",
    "name_match_status",
    "sandbox_override"
  ];

  console.log("\n--- Checking verification_logs columns ---");
  for (const col of logColumns) {
    const { error } = await supabaseAdmin
      .from("verification_logs")
      .select(col)
      .limit(0);
    if (error) {
      console.log(`❌ Column "${col}" does NOT exist. Error: ${error.message}`);
    } else {
      console.log(`✅ Column "${col}" exists.`);
    }
  }
}

checkCatalog();
