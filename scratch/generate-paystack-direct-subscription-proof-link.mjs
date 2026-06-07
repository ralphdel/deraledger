import crypto from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stamp = Date.now();
const reference = `SUB-INDIVIDUAL-PAYSTACK-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const email = `proof-paystack-subscription-${stamp}@deraledger.app`;
const businessName = `Proof Paystack Subscription ${stamp}`;

const { data: session, error: sessionError } = await supabase
  .from("onboarding_sessions")
  .insert({
    email,
    business_name: businessName,
    plan: "individual",
    business_type: "sole_proprietorship",
    relationship_claim: "owner_affiliated_claim",
    verification_disclosure_acknowledged_at: new Date().toISOString(),
    verification_disclosure_version: "1.0",
    status: "awaiting_payment",
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  })
  .select("id")
  .single();

if (sessionError || !session?.id) {
  throw new Error(`Failed to create onboarding session: ${sessionError?.message || "missing session id"}`);
}

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
  session_id: session.id,
  amount_expected_kobo: 500000,
  payment_method_requested: "card",
  resolved_provider: "paystack",
  payment_purpose: "plan_subscription",
};

const { error: recordError } = await supabase.from("payment_records").upsert(
  {
    payment_purpose: "plan_subscription",
    payment_method: "card",
    provider_name: "paystack",
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

const response = await fetch("https://api.paystack.co/transaction/initialize", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    amount: 500000,
    reference,
    callback_url: `https://www.deraledger.com/onboarding/payment-callback?provider=paystack`,
    metadata,
  }),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok || payload.status !== true || !payload.data?.authorization_url) {
  throw new Error(payload.message || "Paystack transaction initialization failed.");
}

console.log(
  JSON.stringify(
    {
      provider: "paystack",
      test: "paystack_subscription",
      expectedAmount: 5000,
      reference,
      email,
      sessionId: session.id,
      authorizationUrl: payload.data.authorization_url,
      accessCode: payload.data.access_code,
    },
    null,
    2
  )
);
