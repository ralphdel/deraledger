const appUrl = "https://www.deraledger.com";
const stamp = Date.now();
const email = `proof-paystack-subscription-${stamp}@deraledger.app`;
const businessName = `Proof Paystack Subscription ${stamp}`;

async function postJson(path, body) {
  const response = await fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed: ${payload.error || response.statusText}`);
  }
  return payload;
}

const session = await postJson("/api/onboarding/create-session", {
  email,
  businessName,
  plan: "individual",
  businessType: "sole_proprietorship",
  relationshipClaim: "owner_affiliated_claim",
  verificationDisclosureAccepted: true,
  disclosureVersion: "1.0",
});

const payment = await postJson("/api/onboarding/initialize-payment", {
  email,
  tradingName: businessName,
  registeredName: businessName,
  ownerName: "Proof Test Owner",
  businessType: "sole_proprietorship",
  relationshipClaim: "owner_affiliated_claim",
  plan: "individual",
  sessionId: session.sessionId,
  amountKobo: 500000,
  verificationDisclosureAccepted: true,
  disclosureVersion: "1.0",
  paymentMethod: "card",
});

console.log(
  JSON.stringify(
    {
      provider: payment.provider,
      test: "paystack_subscription",
      expectedAmount: 5000,
      reference: payment.reference,
      email,
      sessionId: session.sessionId,
      authorizationUrl: payment.authorizationUrl,
      accessCode: payment.accessCode,
    },
    null,
    2
  )
);
