import { PaymentService } from "./src/lib/payment/PaymentService";
import { config } from "dotenv";

config({ path: ".env.local" });

async function run() {
  console.log("Initializing test transaction...");
  const init = await PaymentService.initializeTransaction({
    email: "test@deraledger.app",
    amountKobo: 10000,
    reference: `test_${Date.now()}`,
    callbackUrl: "http://localhost",
    metadata: {
      type: "subscription_upgrade",
      merchant_id: "12345",
      new_plan: "corporate",
      owner_name: "John Doe",
    },
  });

  console.log("Init Result:", init);

  // We can't easily verify a non-paid transaction and see metadata, but let's see if verifyTransaction works on abandoned transactions.
  // Wait, Paystack returns metadata even for abandoned transactions.
  try {
    const tx = await PaymentService.verifyTransaction(init.reference);
    console.log("Verify Result Metadata:", JSON.stringify(tx.metadata, null, 2));
  } catch (err: any) {
    console.error("Verify Error:", err.message);
  }
}

run();
