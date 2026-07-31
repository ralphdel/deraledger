import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

async function run() {
  const migrationPath = "supabase/migrations/20260728_00_authorization_hardening.sql";
  const wrapperPath = "supabase/staging/014_authorization_hardening.sql";
  const preflightPath = "supabase/staging/preflight/014_authorization_hardening_snapshot.sql";
  const postflightPath = "supabase/staging/postflight/014_authorization_hardening_verify.sql";
  const sqlTestPath = "supabase/tests/phase2_authorization_hardening.sql";
  const validatorPath = "scripts/validate-solo-plus-commit.ps1";
  const harnessPath = "scripts/test-breet-solo-plus-migrations.ps1";

  for (const path of [migrationPath, wrapperPath, preflightPath, postflightPath, sqlTestPath]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = readFileSync(migrationPath, "utf8");
  const wrapper = readFileSync(wrapperPath, "utf8");
  const preflight = readFileSync(preflightPath, "utf8");
  const postflight = readFileSync(postflightPath, "utf8");
  const sqlTest = readFileSync(sqlTestPath, "utf8");
  const validator = readFileSync(validatorPath, "utf8");
  const harness = readFileSync(harnessPath, "utf8");

  assert.match(
    wrapper,
    /\\ir \.\.\/migrations\/20260728_00_authorization_hardening\.sql/,
    "The 014 staging wrapper should include the canonical authorization migration.",
  );
  assert.match(
    migration,
    /DROP POLICY IF EXISTS "Allow public read merchants" ON public\.merchants;/,
    "The migration should remove legacy full-row public merchant reads.",
  );
  assert.match(
    migration,
    /DROP POLICY IF EXISTS "Allow public update merchants" ON public\.merchants;/,
    "The migration should remove legacy unrestricted public merchant writes.",
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.verification_disclosures FROM PUBLIC;/,
    "The migration should remove browser disclosure table access.",
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.can_read_merchant_row_v1\(p_merchant_id UUID\)/,
    "The migration should define a narrow merchant-read RLS helper.",
  );
  assert.match(migration, /SECURITY DEFINER/, "The merchant-read helper should be SECURITY DEFINER.");
  assert.match(
    migration,
    /SET search_path = public, pg_temp/,
    "The merchant-read helper should use a safe search_path.",
  );
  assert.match(
    migration,
    /CREATE POLICY "authenticated_read_own_team_or_admin_merchants"/,
    "The migration should restore only narrow authenticated merchant SELECT.",
  );
  assert.doesNotMatch(
    migration,
    /USING\s*\(\s*true\s*\)|WITH CHECK\s*\(\s*true\s*\)/i,
    "The hardening migration must not add permissive true RLS policies.",
  );
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)[\s\S]{0,160}\b(?:anon|authenticated|PUBLIC)\b/i,
    "The hardening migration must not grant browser writes.",
  );
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES/,
    "The migration should repair future table default ACL drift.",
  );
  assert.match(
    migration,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS/,
    "The migration should repair future function default ACL drift.",
  );
  assert.match(
    migration,
    /pg_has_role\(current_user, v_owner, 'MEMBER'\)/,
    "The migration should check role membership before altering another role's default ACLs.",
  );
  assert.match(
    migration,
    /IF v_can_alter_owner_defaults THEN[\s\S]+ALTER DEFAULT PRIVILEGES FOR ROLE %I[\s\S]+ELSE[\s\S]+managed_role_default_acl_unmodifiable/,
    "Default ACL DDL should run only after the explicit owner-capability check.",
  );
  assert.match(
    migration,
    /managed_role_default_acl_unmodifiable/,
    "The migration should report managed default ACL owners it cannot legally alter.",
  );
  assert.doesNotMatch(
    migration,
    /EXCEPTION\s+WHEN\s+permission_denied/i,
    "The migration should not discover default-ACL permissions by issuing unauthorized DDL first.",
  );

  for (const source of [preflight, postflight]) {
    assert.match(source, /browser|default_acl|policy|grant/i);
    assert.match(source, /SELECT 1 \/ 0;/, "Preflight/postflight must force a nonzero psql exit for FAIL rows.");
    assert.match(source, /managed_role_default_acl_unmodifiable/);
    assert.match(source, /managed_unmodifiable_default_acl_present/);
    assert.match(source, /default_acl_owner_capabilities/);
    assert.match(
      source,
      /owner_role\.rolname IN \('postgres', current_user\)[\s\S]+pg_has_role\(current_user, owner_role\.rolname, 'MEMBER'\)/,
      "Preflight/postflight should keep postgres/current-owner/alterable default ACL drift blocking.",
    );
  }

  assert.match(sqlTest, /anon must not insert verification_disclosures/);
  assert.match(sqlTest, /authenticated must not update merchants directly/);
  assert.match(sqlTest, /unsafe browser default ACLs owned by postgres\/current\/alterable roles must be removed/);
  assert.match(sqlTest, /managed_role_default_acl_unmodifiable role=supabase_admin/);

  assert.match(validator, /phase2_authorization_hardening\.sql/);
  assert.match(validator, /014_authorization_hardening\.sql/);
  assert.match(validator, /015_verification_disclosure_acknowledgement_rpc\.sql/);
  assert.match(harness, /phase2_authorization_hardening\.sql/);
  assert.match(harness, /014_authorization_hardening\.sql/);
  assert.match(harness, /015_verification_disclosure_acknowledgement_rpc\.sql/);
  assert.match(harness, /Initialize-HostedSupabaseManagedDefaultAclFixture/);
  assert.match(harness, /Assert-SupabaseAdminDefaultAclFixturePreserved/);
  assert.match(harness, /Run Commit 13 authorization wrapper under hosted managed-role fixture/);

  console.log("authorization-hardening-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
