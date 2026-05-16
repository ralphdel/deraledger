import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testUploadPdf() {
  const buffer = Buffer.from("test content", "utf8");
  const { data, error } = await supabaseAdmin.storage.from("kyc-documents").upload("test-upload.pdf", buffer, { contentType: "application/pdf", upsert: true });
  console.log("Upload Data:", data);
  console.log("Upload Error:", error);
}

testUploadPdf();
