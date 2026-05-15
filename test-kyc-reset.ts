import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resetKyc() {
  const mId = "c07210d4-67c3-4a14-8e67-2c3294ee1fd3";

  // Force reset BVN and Selfie so the user can verify their new director
  const { error: resetError } = await supabaseAdmin.from("merchants").update({
    bvn: null,
    bvn_status: "unverified",
    selfie_url: null,
    selfie_status: "unverified",
    verification_status: "unverified"
  }).eq("id", mId);

  console.log("KYC Reset:", resetError || "Success");
}

resetKyc();
