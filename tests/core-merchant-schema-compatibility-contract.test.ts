import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

async function run() {
  const migrationPath = "supabase/migrations/20260818_00_core_merchant_schema_compatibility.sql";
  const wrapperPath = "supabase/staging/018_core_merchant_schema_compatibility.sql";
  const preflightPath = "supabase/staging/preflight/018_core_merchant_schema_compatibility_snapshot.sql";
  const postflightPath = "supabase/staging/postflight/018_core_merchant_schema_compatibility_verify.sql";
  const sqlTestPath = "supabase/tests/phase2_core_merchant_schema_compatibility.sql";

  for (const path of [migrationPath, wrapperPath, preflightPath, postflightPath, sqlTestPath]) {
    assert.equal(existsSync(path), true, `${path} should exist.`);
  }

  const migration = readFileSync(migrationPath, "utf8");
  const wrapper = readFileSync(wrapperPath, "utf8");
  const preflight = readFileSync(preflightPath, "utf8");
  const postflight = readFileSync(postflightPath, "utf8");
  const sqlTest = readFileSync(sqlTestPath, "utf8");
  const executableSql = (source: string) => source
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");

  assert.match(
    wrapper,
    /\\ir \.\.\/migrations\/20260818_00_core_merchant_schema_compatibility\.sql/,
    "The 018 wrapper should include the canonical migration.",
  );

  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/, "The migration should be transactional.");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\."references"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.item_catalog/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.discount_templates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.line_items/);
  assert.doesNotMatch(
    migration,
    /CREATE TABLE(?: IF NOT EXISTS)? public\.invoice_items/i,
    "The app contract uses line_items, not invoice_items.",
  );

  for (const column of ["whatsapp_number", "reminder_enabled", "reminder_channels"]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  for (const column of ["reference_id", "handled_by", "invoice_stage"]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  }
  assert.match(migration, /project_total_value NUMERIC DEFAULT 0/);

  assert.match(
    migration,
    /public\.can_read_merchant_row_v1\(merchant_id\)/,
    "Merchant-scoped reads should reuse the authorization-hardening helper.",
  );
  assert.match(migration, /REVOKE ALL ON TABLE public\.%I FROM PUBLIC/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.%I TO authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.%I TO service_role/);
  assert.doesNotMatch(
    migration,
    /USING\s*\(\s*true\s*\)|WITH CHECK\s*\(\s*true\s*\)/i,
    "The migration must not create unrestricted RLS policies.",
  );

  assert.doesNotMatch(migration, /\b(?:DROP TABLE|TRUNCATE|DELETE FROM|UPDATE\s+public\.|INSERT INTO)\b/i);
  assert.doesNotMatch(
    migration,
    /ALTER TABLE public\.(?:subscriptions|payment_|payment_records|payment_events|payment_providers|merchant_settlement)/i,
    "The schema repair must not alter subscription or payment-provider tables.",
  );

  for (const source of [preflight, postflight]) {
    assert.match(source, /SET TRANSACTION READ ONLY/);
    assert.match(source, /ROLLBACK;/);
    assert.doesNotMatch(
      executableSql(source),
      /\b(?:CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i,
      "Preflight/postflight executable SQL must remain read-only.",
    );
  }

  assert.match(preflight, /repairable_missing/i);
  assert.match(preflight, /preservation_baseline/);
  assert.match(postflight, /constraint_manifest/);
  assert.match(postflight, /foreign_key_manifest/);
  assert.match(postflight, /rls_policy_manifest/);
  assert.match(postflight, /grant_manifest/);
  assert.match(postflight, /preservation_postflight/);
  assert.match(postflight, /invoice_items_required=false/);

  assert.match(sqlTest, /core merchant tables must exist/);
  assert.match(sqlTest, /authenticated must not write core merchant tables directly/);
  assert.match(sqlTest, /service_role must retain core merchant table access/);

  console.log("core-merchant-schema-compatibility-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
