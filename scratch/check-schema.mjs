import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSchema() {
  console.log("Checking DeraLedger schema state...");
  
  // 1. Check merchants columns
  const { data: cols, error: colsErr } = await supabaseAdmin
    .from("merchants")
    .select("identity_verified, identity_verified_at, active_verification_provider")
    .limit(1);

  if (colsErr) {
    console.log("❌ New merchant columns do NOT exist yet:", colsErr.message);
  } else {
    console.log("✅ New merchant columns exist in the database!");
  }

  // 2. Check platform_settings values
  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from("platform_settings")
    .select("key, value")
    .in("key", ["active_verification_provider", "verification_sandbox_mode", "verification_provider_health"]);

  if (settingsErr) {
    console.log("❌ platform_settings checks failed:", settingsErr.message);
  } else {
    console.log("✅ platform_settings keys found:", settings);
  }

  // 3. Check verification_records table
  const { data: records, error: recordsErr } = await supabaseAdmin
    .from("verification_records")
    .select("id")
    .limit(1);

  if (recordsErr) {
    console.log("❌ verification_records table does NOT exist yet:", recordsErr.message);
  } else {
    console.log("✅ verification_records table exists in the database!");
  }
}

checkSchema();
