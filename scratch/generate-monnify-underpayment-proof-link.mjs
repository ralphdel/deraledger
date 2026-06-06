import crypto from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const monnifyBase = process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com";

async function getMonnifyToken() {
  const token = Buffer.from(`${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`).toString("base64");
  const response = await fetch(`${monnifyBase}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
    },
  });
  const payload = await response.json().catch(() => ({}));
  const accessToken = payload.responseBody?.accessToken;

  if (!response.ok || !accessToken) {
    throw new Error(payload.responseMessage || "Monnify authentication failed.");
  }

  return accessToken;
}

async function main() {
  const stamp = Date.now();
  const reference = `SUB-INDIVIDUAL-PROOF-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const email = `proof-monnify-underpay-${stamp}@deraledger.app`;
  const businessName = `Proof Monnify Underpay ${stamp}`;
  const metadata = {
    type: "subscription",
    plan: "individual",
    email,
    business_name: businessName,
    trading_name: businessName,
    owner_name: "Proof Test Owner",
    business_type: "sole_proprietorship",
    relationship_claim: "owner_affiliated_claim",
    verification_disclosure_accepted: true,
    verification_disclosure_version: "1.0",
    session_id: `proof_monnify_underpay_${stamp}`,
    amount_expected_kobo: 500000,
    payment_method_requested: "bank_transfer",
    resolved_provider: "monnify",
    payment_purpose: "plan_subscription",
  };

  const { error: recordError } = await supabase.from("payment_records").upsert(
    {
      payment_purpose: "plan_subscription",
      payment_method: "bank_transfer",
      provider_name: "monnify",
      internal_reference: reference,
      provider_reference: null,
      amount_paid: 0,
      expected_amount: 5000,
      currency: "NGN",
      payment_status: "pending",
      processing_status: "pending_payment",
      account_setup_status: "pending_payment",
      password_setup_required: true,
      customer_email: email,
      plan_id: "individual",
      plan_name: "individual",
      metadata,
      expires_at: null,
      settlement_destination_source: "provider_dashboard",
      reconciliation_status: "pending_reconciliation",
      raw_provider_payload: metadata,
    },
    { onConflict: "internal_reference" }
  );

  if (recordError) {
    throw new Error(`Failed to create pending payment record: ${recordError.message}`);
  }

  const accessToken = await getMonnifyToken();
  const response = await fetch(`${monnifyBase}/api/v1/merchant/transactions/init-transaction`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: 5000,
      customerName: businessName,
      customerEmail: email,
      paymentReference: reference,
      paymentDescription: "DeraLedger proof subscription underpayment",
      redirectUrl: "https://www.deraledger.com/onboarding/payment-callback",
      currencyCode: "NGN",
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      paymentMethods: ["ACCOUNT_TRANSFER"],
      metaData: metadata,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.requestSuccessful === false || !payload.responseBody?.checkoutUrl) {
    throw new Error(payload.responseMessage || "Monnify transaction initialization failed.");
  }

  console.log(JSON.stringify({
    provider: "monnify",
    test: "underpayment",
    expectedAmount: 5000,
    payAmount: 3000,
    reference,
    email,
    checkoutUrl: payload.responseBody.checkoutUrl,
    transactionReference: payload.responseBody.transactionReference || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
