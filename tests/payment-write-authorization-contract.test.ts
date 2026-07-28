import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function run() {
  const paymentUpgradeRouteSource = readFileSync(
    "src/app/api/payment/upgrade/route.ts",
    "utf8",
  );
  const onboardingCreateSessionRouteSource = readFileSync(
    "src/app/api/onboarding/create-session/route.ts",
    "utf8",
  );
  const paymentRecordsMigrationSource = readFileSync(
    "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql",
    "utf8",
  );
  const verificationDisclosureMigrationSource = readFileSync(
    "supabase/20260527_onboarding_verification_upgrade_flow.sql",
    "utf8",
  );

  assert.match(
    paymentUpgradeRouteSource,
    /const trustedSupabase = createSupabaseClient\(/,
    "Upgrade route should create a trusted service-role Supabase client for internal writes.",
  );
  assert.match(
    paymentUpgradeRouteSource,
    /recordVerificationDisclosure\(trustedSupabase,/,
    "Verification disclosure persistence must use the trusted client.",
  );
  assert.match(
    paymentUpgradeRouteSource,
    /serviceClient: trustedSupabase/,
    "Solo Plus payment preparation must receive the trusted client.",
  );
  assert.match(
    paymentUpgradeRouteSource,
    /createPendingPlanPaymentRecord\(trustedSupabase,/,
    "Internal payment-record persistence must use the trusted client.",
  );
  assert.doesNotMatch(
    paymentUpgradeRouteSource,
    /recordVerificationDisclosure\(supabase,/,
    "The authenticated cookie client must not write verification_disclosures here.",
  );
  assert.doesNotMatch(
    paymentUpgradeRouteSource,
    /createPendingPlanPaymentRecord\(supabase,/,
    "The authenticated cookie client must not write payment_records here.",
  );

  assert.match(
    onboardingCreateSessionRouteSource,
    /const supabase = createSupabaseClient\(/,
    "Onboarding create-session should already use the trusted service-role client.",
  );
  assert.match(
    onboardingCreateSessionRouteSource,
    /recordVerificationDisclosure\(supabase,/,
    "Trusted disclosure writes are already the pattern for onboarding create-session.",
  );

  assert.match(
    paymentRecordsMigrationSource,
    /ALTER TABLE public\.payment_records ENABLE ROW LEVEL SECURITY;/,
    "payment_records must have RLS enabled.",
  );
  assert.match(
    paymentRecordsMigrationSource,
    /CREATE POLICY "merchant_read_payment_records" ON public\.payment_records FOR SELECT USING/,
    "payment_records should expose merchant-scoped authenticated read access only.",
  );
  assert.match(
    paymentRecordsMigrationSource,
    /REVOKE ALL ON TABLE public\.%I FROM authenticated/,
    "The canonical security helper revokes broad authenticated table access first.",
  );
  assert.match(
    paymentRecordsMigrationSource,
    /GRANT SELECT ON TABLE public\.%I TO authenticated/,
    "The canonical security helper only grants authenticated SELECT for merchant-read tables.",
  );
  assert.doesNotMatch(
    paymentRecordsMigrationSource,
    /CREATE POLICY ".*payment_records.*" ON public\.payment_records FOR INSERT/i,
    "No broad authenticated INSERT policy should exist for payment_records.",
  );

  assert.match(
    verificationDisclosureMigrationSource,
    /CREATE TABLE IF NOT EXISTS verification_disclosures \(/,
    "verification_disclosures must exist in the canonical onboarding flow migration.",
  );
  assert.doesNotMatch(
    verificationDisclosureMigrationSource,
    /GRANT INSERT ON TABLE .*verification_disclosures.* TO authenticated/i,
    "verification_disclosures should not gain a broad authenticated INSERT grant in canonical SQL.",
  );
  assert.doesNotMatch(
    verificationDisclosureMigrationSource,
    /CREATE POLICY .*verification_disclosures.* FOR INSERT/i,
    "verification_disclosures should not rely on a broad authenticated INSERT policy in canonical SQL.",
  );

  console.log("payment-write-authorization-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
