import { adminGetVerificationDetailsAction } from "../src/lib/actions";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// Since requireSuperAdmin uses auth.getUser(), and server actions run in a Next.js context with cookies,
// we should check if requireSuperAdmin bypasses/errors in standalone node or if we need to mock it.
// Let's print the result or see if it throws/returns error.
async function run() {
  try {
    const result = await adminGetVerificationDetailsAction("bfd66cab-3de2-4493-ad6f-ffdd9289f376");
    console.log("Result:", result);
  } catch (err) {
    console.error("Action error:", err);
  }
}

run();
