import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const reference = process.argv[2];
if (!reference) {
  console.error("Usage: node scratch/verify-monnify-reference.mjs <reference>");
  process.exit(1);
}

const monnifyBase = process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com";

async function getToken() {
  const token = Buffer.from(`${process.env.MONNIFY_API_KEY}:${process.env.MONNIFY_SECRET_KEY}`).toString("base64");
  const response = await fetch(`${monnifyBase}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${token}`, "Content-Type": "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.responseBody?.accessToken) {
    throw new Error(payload.responseMessage || "Monnify auth failed");
  }
  return payload.responseBody.accessToken;
}

async function authorizedGet(path) {
  const response = await fetch(`${monnifyBase}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, payload };
}

console.log(JSON.stringify({
  byTransactionReference: await authorizedGet(`/api/v2/transactions/${encodeURIComponent(reference)}`),
  byPaymentReference: await authorizedGet(`/api/v2/merchant/transactions/query?${new URLSearchParams({ paymentReference: reference }).toString()}`),
}, null, 2));
