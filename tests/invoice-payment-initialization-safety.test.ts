import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getInvoicePaymentInitializationError,
  getVerifiedProviderSubaccountCode,
} from "../src/lib/services/invoice-payment-safety.service";

const account = { id: "account-1", status: "active", verification_status: "verified" };
const validMapping = {
  provider_name: "paystack",
  environment: "live",
  status: "connected",
  provider_subaccount_code: "ACCT_verified",
};

async function run() {
  assert.equal(getInvoicePaymentInitializationError({ invoice_type: "collection" }), null);
  assert.equal(getInvoicePaymentInitializationError({ invoice_type: "record" })?.code, "RECORD_INVOICE_OFFLINE_ONLY");

  assert.equal(getVerifiedProviderSubaccountCode(null, { provider: "paystack", environment: "live" }), null);
  assert.equal(getVerifiedProviderSubaccountCode({ account, mapping: null, ready: true } as never, { provider: "paystack", environment: "live" }), null);
  assert.equal(getVerifiedProviderSubaccountCode({ account, mapping: { ...validMapping, provider_name: "monnify" }, ready: true } as never, { provider: "paystack", environment: "live" }), null);
  assert.equal(getVerifiedProviderSubaccountCode({ account, mapping: { ...validMapping, environment: "sandbox" }, ready: true } as never, { provider: "paystack", environment: "live" }), null);
  assert.equal(getVerifiedProviderSubaccountCode({ account, mapping: validMapping, ready: false } as never, { provider: "paystack", environment: "live" }), null);
  assert.equal(getVerifiedProviderSubaccountCode({ account, mapping: validMapping, ready: true } as never, { provider: "paystack", environment: "live" }), "ACCT_verified");

  const demoRoute = readFileSync("src/app/api/demo-payment/route.ts", "utf8");
  const cryptoRoute = readFileSync("src/app/api/checkout/crypto-invoice/route.ts", "utf8");
  assert.ok(demoRoute.indexOf("getInvoicePaymentInitializationError(invoice)") < demoRoute.indexOf("PaymentService.initializeTransaction"));
  assert.ok(cryptoRoute.indexOf("getInvoicePaymentInitializationError(invoice)") < cryptoRoute.indexOf("PaymentService.generateInvoicePaymentAddress"));
  assert.match(demoRoute, /subaccountCode: route\.provider === "paystack" \? \(verifiedProviderSubaccountCode \|\| undefined\)/);
  assert.doesNotMatch(demoRoute, /subaccountCode:[^\n]*merchant\.payment_subaccount_code/);

  console.log("invoice-payment-initialization-safety tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
