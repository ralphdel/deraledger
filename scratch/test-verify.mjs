import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const email = "instaverifyai@gmail.com";
  console.log("Generating magic link...");
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error) {
    console.error("Error generating link:", error);
    return;
  }

  const otp = data.properties.email_otp;
  console.log("Generated OTP:", otp);

  console.log("Verifying OTP with client-side client...");
  const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: otp,
    type: "magiclink",
  });

  if (verifyError) {
    console.error("Verify Error:", verifyError);
  } else {
    console.log("Verify successful!");
    console.log("Verify session user email:", verifyData.user?.email);
  }
}

test();
