import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

async function run() {
  const migrationPath =
    "supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql";
  const identityMigrationPath =
    "supabase/migrations/20260731_00_verification_disclosure_identity_hardening.sql";
  const wrapperPath =
    "supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql";
  const identityWrapperPath =
    "supabase/staging/016_verification_disclosure_identity_hardening.sql";
  const preflightPath =
    "supabase/staging/preflight/015_verification_disclosure_acknowledgement_snapshot.sql";
  const postflightPath =
    "supabase/staging/postflight/015_verification_disclosure_acknowledgement_verify.sql";
  const identityPreflightPath =
    "supabase/staging/preflight/016_verification_disclosure_identity_hardening_snapshot.sql";
  const identityPostflightPath =
    "supabase/staging/postflight/016_verification_disclosure_identity_hardening_verify.sql";
  const sqlTestPath =
    "supabase/tests/phase2_verification_disclosure_acknowledgement_rpc.sql";
  const validatorPath = "scripts/validate-solo-plus-commit.ps1";
  const harnessPath = "scripts/test-breet-solo-plus-migrations.ps1";

  for (const path of [
    migrationPath,
    identityMigrationPath,
    wrapperPath,
    identityWrapperPath,
    preflightPath,
    postflightPath,
    identityPreflightPath,
    identityPostflightPath,
    sqlTestPath,
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = readFileSync(migrationPath, "utf8");
  const identityMigration = readFileSync(identityMigrationPath, "utf8");
  const wrapper = readFileSync(wrapperPath, "utf8");
  const identityWrapper = readFileSync(identityWrapperPath, "utf8");
  const preflight = readFileSync(preflightPath, "utf8");
  const postflight = readFileSync(postflightPath, "utf8");
  const identityPreflight = readFileSync(identityPreflightPath, "utf8");
  const identityPostflight = readFileSync(identityPostflightPath, "utf8");
  const sqlTest = readFileSync(sqlTestPath, "utf8");
  const validator = readFileSync(validatorPath, "utf8");
  const harness = readFileSync(harnessPath, "utf8");

  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.record_verification_disclosure_acceptance_v1\(\s*p_user_id UUID,\s*p_merchant_id UUID,\s*p_onboarding_session_id UUID,\s*p_plan_type TEXT,\s*p_context TEXT,\s*p_disclosure_version TEXT,\s*p_ip_address TEXT,\s*p_user_agent TEXT,\s*p_device_metadata JSONB\s*\)\s*RETURNS JSONB/,
    "The disclosure RPC should expose the exact expected signature.",
  );
  assert.match(migration, /SECURITY DEFINER/, "The disclosure RPC should be SECURITY DEFINER.");
  assert.match(
    migration,
    /SET search_path = public, pg_temp/,
    "The disclosure RPC should use an explicit safe search_path.",
  );
  assert.match(
    migration,
    /UPDATE public\.merchants[\s\S]+SET[\s\S]+verification_disclosure_acknowledged_at/,
    "The RPC should update only the merchant disclosure acknowledgement summary.",
  );
  assert.doesNotMatch(
    migration,
    /subscription_plan|merchant_tier|payment_status|live_features_enabled|activation|settlement/i,
    "The disclosure RPC should not mutate plan, payment, activation, or settlement fields.",
  );
  assert.match(
    migration,
    /pg_advisory_xact_lock/,
    "The RPC should serialize duplicate logical acceptance attempts.",
  );
  assert.match(
    migration,
    /verification_disclosure_version IS DISTINCT FROM v_disclosure_version/,
    "The RPC should fail closed instead of downgrading conflicting disclosure versions.",
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.record_verification_disclosure_acceptance_v1\(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB\) FROM PUBLIC, anon, authenticated;/,
    "Browser roles should not be able to execute the RPC.",
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.record_verification_disclosure_acceptance_v1\(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB\) TO service_role;/,
    "Only service_role should execute the RPC.",
  );

  assert.match(
    wrapper,
    /\\ir \.\.\/migrations\/20260728_01_verification_disclosure_acknowledgement_rpc\.sql/,
    "The staging wrapper should include the canonical migration by relative include.",
  );
  assert.match(
    identityWrapper,
    /\\ir \.\.\/migrations\/20260731_00_verification_disclosure_identity_hardening\.sql/,
    "The identity-hardening staging wrapper should include the canonical migration by relative include.",
  );

  assert.match(identityMigration, /ADD COLUMN IF NOT EXISTS is_canonical BOOLEAN/);
  assert.match(identityMigration, /ADD COLUMN IF NOT EXISTS superseded_by_disclosure_id UUID/);
  assert.match(identityMigration, /verification_disclosures_canonical_reference_state/);
  assert.match(identityMigration, /verification_disclosures_no_self_supersede/);
  assert.match(identityMigration, /verification_disclosures_superseded_by_fkey/);
  assert.match(identityMigration, /idx_verification_disclosures_onboarding_canonical_identity/);
  assert.match(identityMigration, /idx_verification_disclosures_upgrade_canonical_identity/);
  assert.match(identityMigration, /NULLS NOT DISTINCT/);
  assert.match(identityMigration, /WHERE onboarding_session_id = p_onboarding_session_id[\s\S]+AND is_canonical = true/);
  assert.match(identityMigration, /WHERE onboarding_session_id IS NULL[\s\S]+AND merchant_id = p_merchant_id[\s\S]+AND user_id IS NOT DISTINCT FROM p_user_id[\s\S]+AND is_canonical = true/);
  assert.match(identityMigration, /verification-disclosure:onboarding:/);
  assert.match(identityMigration, /verification-disclosure:upgrade:/);
  assert.doesNotMatch(identityMigration, /DELETE FROM public\.verification_disclosures/i);

  for (const source of [preflight, postflight]) {
    assert.match(source, /verification_disclosures_ok|disclosure_schema_preserved/);
    assert.match(source, /merchant_acknowledged_at_ok/);
    assert.match(source, /merchant_version_ok/);
    assert.match(source, /udt_name IN \('text', 'varchar'\)/);
    assert.match(source, /browser_write_surface/);
    assert.match(source, /disclosure_browser_write_clear/);
    assert.match(source, /merchant_browser_write_clear/);
    assert.match(source, /record_verification_disclosure_acceptance_v1/);
    assert.match(
      source,
      /SELECT 1 \/ 0;/,
      "Preflight/postflight must force a nonzero psql exit when a diagnostic check fails.",
    );
    assert.doesNotMatch(
      source,
      /GRANT\s+(?:INSERT|UPDATE|DELETE)[\s\S]{0,160}\b(?:anon|authenticated|PUBLIC)\b/i,
      "Preflight/postflight must not grant browser write access.",
    );
  }

  for (const source of [identityPreflight, identityPostflight]) {
    assert.match(source, /016 verification disclosure identity hardening/);
    assert.match(source, /is_canonical/);
    assert.match(source, /superseded_by_disclosure_id/);
    assert.match(source, /idx_verification_disclosures_onboarding_canonical_identity/);
    assert.match(source, /idx_verification_disclosures_upgrade_canonical_identity/);
    assert.match(source, /SELECT 1 \/ 0;/);
  }

  assert.match(sqlTest, /merchant-scoped acceptance should be created/);
  assert.match(sqlTest, /merchant-scoped replay should not duplicate audit rows/);
  assert.match(sqlTest, /onboarding-session-only acceptance should be supported/);
  assert.match(sqlTest, /historical duplicate seed should create five rows/);
  assert.match(sqlTest, /historical duplicate replay should not create a sixth row/);
  assert.match(sqlTest, /historical duplicate replay should return the canonical disclosure id/);
  assert.match(sqlTest, /null-session call should create a distinct upgrade disclosure when only a non-null session row exists/);
  assert.match(sqlTest, /non-null session call should create a distinct onboarding disclosure when only a null-session row exists/);
  assert.match(sqlTest, /cross-mode null-session and non-null-session calls should use different advisory lock keys/);
  assert.match(sqlTest, /duplicate canonical onboarding identity should be rejected/);
  assert.match(sqlTest, /duplicate canonical upgrade identity should be rejected/);
  assert.match(sqlTest, /cross-user merchant input should fail closed/);
  assert.match(sqlTest, /conflicting disclosure version should fail closed/);
  assert.match(sqlTest, /disclosure insert failure should leave merchant acknowledgement unchanged/);
  assert.match(sqlTest, /merchant update failure should roll back the disclosure insert/);
  assert.match(sqlTest, /verification disclosure RPC must not mutate payment_records/);
  assert.match(sqlTest, /verification disclosure RPC must not mutate solo_plus_cases/);
  assert.match(sqlTest, /verification disclosure RPC must not mutate workspace_subscriptions/);

  assert.match(
    validator,
    /phase2_verification_disclosure_acknowledgement_rpc\.sql/,
    "The collected validator should include the disclosure RPC SQL suite.",
  );
  assert.match(validator, /016_verification_disclosure_identity_hardening/);
  assert.match(validator, /20260731_00_verification_disclosure_identity_hardening/);
  assert.match(
    harness,
    /015_verification_disclosure_acknowledgement_rpc\.sql/,
    "The hostile/default-grant harness should include the disclosure RPC staging wrapper.",
  );
  assert.match(harness, /016_verification_disclosure_identity_hardening\.sql/);

  console.log("verification-disclosure-rpc-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
