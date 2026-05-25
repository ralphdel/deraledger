import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const { data, error } = await supabaseAdmin
    .from("verification_providers")
    .select("*")
    .limit(1);

  if (error) {
    console.log("verification_providers check failed:", error.message);
  } else {
    console.log("verification_providers check succeeded, data:", data);
  }
}

check();
