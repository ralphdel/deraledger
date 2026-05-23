import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const email = "instaverifyai@gmail.com";
  console.log("Generating magic link for:", email);
  try {
    const { data, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error) {
      console.error("Error:", error);
    } else {
      console.log("Data properties:", Object.keys(data?.properties || {}));
      console.log("Full data.properties:", JSON.stringify(data?.properties, null, 2));
    }
  } catch (err) {
    console.error("Exception:", err);
  }
}

test();
