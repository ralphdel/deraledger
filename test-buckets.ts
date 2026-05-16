import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkBuckets() {
  const { data, error } = await supabaseAdmin.storage.listBuckets();
  console.log("Buckets:", data?.map(b => b.name));
  console.log("Error:", error);
}

checkBuckets();
