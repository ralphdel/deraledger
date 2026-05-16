import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixCorruptedStatuses() {
  const { data, error } = await supabaseAdmin
    .from("merchants")
    .update({ cac_status: "unverified" })
    .eq("cac_status", "verified")
    .is("cac_document_url", null);
  console.log("Fixed merchants:", data, "Error:", error);
}

fixCorruptedStatuses();
