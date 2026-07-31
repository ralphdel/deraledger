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
  const disclosureRpcMigrationSource = readFileSync(
    "supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql",
    "utf8",
  );
  const authorizationHardeningMigrationSource = readFileSync(
    "supabase/migrations/20260728_00_authorization_hardening.sql",
    "utf8",
  );
  const onboardingFlowSource = readFileSync(
    "src/lib/services/onboarding-flow.service.ts",
    "utf8",
  );
  const disclosureFunctionSource = onboardingFlowSource.slice(
    onboardingFlowSource.indexOf("export async function recordVerificationDisclosure"),
    onboardingFlowSource.indexOf("export async function enterPaidSetupMode"),
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
  assert.match(
    disclosureFunctionSource,
    /\.rpc\(\s*"record_verification_disclosure_acceptance_v1"/,
    "Verification disclosure persistence should go through the atomic RPC.",
  );
  assert.doesNotMatch(
    disclosureFunctionSource,
    /\.from\(\s*"verification_disclosures"\s*\)\.insert/,
    "The normal disclosure path must not retain a separate audit-row insert.",
  );
  assert.doesNotMatch(
    disclosureFunctionSource,
    /\.from\(\s*"merchants"\s*\)[\s\S]*\.update\(/,
    "The normal disclosure path must not retain a separate merchant acknowledgement update.",
  );
  assert.match(
    disclosureFunctionSource,
    /const disclosureVersion = VERIFICATION_DISCLOSURE_VERSION;/,
    "The disclosure version should be server-controlled at the central service boundary.",
  );
  assert.match(
    disclosureRpcMigrationSource,
    /CREATE OR REPLACE FUNCTION public\.record_verification_disclosure_acceptance_v1/,
    "The closeout migration should define the atomic disclosure acknowledgement RPC.",
  );
  assert.match(
    disclosureRpcMigrationSource,
    /SECURITY DEFINER/,
    "The disclosure acknowledgement RPC should run through the trusted database boundary.",
  );
  assert.match(
    disclosureRpcMigrationSource,
    /REVOKE ALL ON FUNCTION public\.record_verification_disclosure_acceptance_v1\(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB\) FROM PUBLIC, anon, authenticated;/,
    "The disclosure acknowledgement RPC must revoke browser-role execution.",
  );
  assert.match(
    disclosureRpcMigrationSource,
    /GRANT EXECUTE ON FUNCTION public\.record_verification_disclosure_acceptance_v1\(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB\) TO service_role;/,
    "The disclosure acknowledgement RPC must grant execute only to service_role.",
  );
  assert.match(
    authorizationHardeningMigrationSource,
    /DROP POLICY IF EXISTS "Allow public read merchants" ON public\.merchants;/,
    "The authorization hardening migration should remove full-row public merchant reads.",
  );
  assert.match(
    authorizationHardeningMigrationSource,
    /DROP POLICY IF EXISTS "Allow public update merchants" ON public\.merchants;/,
    "The authorization hardening migration should remove unrestricted public merchant updates.",
  );
  assert.match(
    authorizationHardeningMigrationSource,
    /REVOKE ALL ON TABLE public\.verification_disclosures FROM PUBLIC;/,
    "verification_disclosures should not remain browser-writable.",
  );
  assert.match(
    authorizationHardeningMigrationSource,
    /CREATE POLICY "authenticated_read_own_team_or_admin_merchants"/,
    "Authenticated merchant reads should be narrow and policy-bound.",
  );
  assert.doesNotMatch(
    authorizationHardeningMigrationSource,
    /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)[\s\S]{0,160}\b(?:anon|authenticated|PUBLIC)\b/i,
    "Hardening must not grant browser write privileges.",
  );

  console.log("payment-write-authorization-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
