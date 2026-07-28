import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("src/app/api/checkout/payment-methods/route.ts", "utf8");
const routingMigration = readFileSync(
  "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql",
  "utf8",
);
const breetServiceSource = readFileSync("src/lib/services/breet-crypto.service.ts", "utf8");
const implementationPlan = readFileSync("docs/phase 2 full implementation plan.md", "utf8");

async function run() {
  assert.match(
    routeSource,
    /if \(kind === "upgrade"\) return "plan_upgrade";/,
    "Checkout payment-method endpoint must map upgrade checkout to plan_upgrade.",
  );

  assert.match(routeSource, /availableMethods/);
  assert.match(routeSource, /methodAvailability/);

  assert.match(
    routingMigration,
    /\('plan_upgrade', 'card', 'sandbox', true, 'Card'/,
    "Sandbox plan upgrades should expose card when providers are configured.",
  );
  assert.match(
    routingMigration,
    /\('plan_upgrade', 'bank_transfer', 'sandbox', true, 'Bank Transfer'/,
    "Sandbox plan upgrades should expose bank transfer when providers are configured.",
  );
  assert.match(
    routingMigration,
    /\('plan_upgrade', 'ussd', 'sandbox', true, 'USSD'/,
    "Sandbox plan upgrades should expose USSD when providers are configured.",
  );
  assert.match(
    routingMigration,
    /\('plan_upgrade', 'crypto', 'sandbox', false, 'Crypto'/,
    "Sandbox plan-upgrade crypto remains disabled unless separately approved.",
  );
  assert.match(
    routingMigration,
    /\('plan_upgrade', 'crypto', 'breet', NULL, 'sandbox', false\)/,
    "Breet must remain route-disabled for sandbox plan upgrades by default.",
  );

  assert.match(
    breetServiceSource,
    /input\.purpose === "plan_upgrade"/,
    "Breet service has an explicit plan-upgrade branch for future approved configuration.",
  );
  assert.match(
    breetServiceSource,
    /subscriptionCryptoEnabled/,
    "Plan-payment crypto is gated by subscriptionCryptoEnabled.",
  );

  assert.match(
    implementationPlan,
    /Breet remains excluded unless separately approved for plan payments/,
    "The implementation plan keeps Breet excluded for plan payments unless separately approved.",
  );

  console.log("checkout-payment-methods-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
