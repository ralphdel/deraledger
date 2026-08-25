import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/rehearse-reviewed-profile-approval-rpc-local.ps1", "utf8");
const runbook = readFileSync("docs/prd-phase-2-approval-rpc-disposable-rehearsal-runbook.md", "utf8");

function assertExplicitSeedColumnCounts(table: string) {
  const match = script.match(new RegExp(`INSERT INTO public\\.${table}\\(([\\s\\S]*?)\\) VALUES\\s*([\\s\\S]*?);`));
  assert.ok(match, `${table} seed INSERT must have an explicit column list`);
  const expectedColumns = match[1].split(",").map((column) => column.trim()).filter(Boolean).length;
  const rows = match[2].match(/\([^()]+\)/g) ?? [];
  assert.ok(rows.length > 0, `${table} seed INSERT must include rows`);
  for (const row of rows) {
    const actualValues = row.slice(1, -1).split(",").length;
    assert.equal(actualValues, expectedColumns, `${table} seed row has ${actualValues} values; expected ${expectedColumns}`);
  }
}

function run() {
  assert.match(script, /\[string\]\$LocalConnectionString/);
  assert.match(script, /REHEARSE MIGRATION 026 LOCAL DISPOSABLE DB ONLY/);
  assert.match(script, /-not \$Execute/);
  for (const value of ["supabase\\\\.co", "supabase\\\\.com", "vercel", "production", "staging", "service_role", "anon", "eyJ"]) {
    assert.match(script, new RegExp(value, "i"));
  }
  assert.match(script, /localhost', '127\.0\.0\.1', 'host\.docker\.internal/);
  assert.match(script, /LOCAL_APPROVAL_REHEARSAL_NONLOCAL_HOST_REJECTED/);
  assert.match(script, /LOCAL_APPROVAL_REHEARSAL_DISPOSABLE_DATABASE_NAME_REQUIRED/);
  assert.match(script, /Write-LocalSqlFileNoBom/);
  assert.match(script, /\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(script, /\[System\.IO\.File\]::WriteAllText\(\$Path, \$Content, \$utf8NoBom\)/);
  assert.doesNotMatch(script, /Set-Content -LiteralPath \$(?:BaselineSql|BehaviorSql)/);

  for (const migration of [
    "20260820_00_prd_phase_2_compliance_schema_substrate.sql",
    "20260824_00_reviewed_profile_bootstrap_rpc.sql",
    "20260825_00_reviewed_profile_approval_rpc.sql",
  ]) {
    assert.match(script, new RegExp(migration.replaceAll(".", "\\.")));
  }
  assert.match(script, /Running Migration 026 preflight[\s\S]*Applying Migration 026 first time[\s\S]*Applying Migration 026 second time for idempotency[\s\S]*Running Migration 026 postflight/);
  assert.match(script, /026_reviewed_profile_approval_rpc_snapshot\.sql/);
  assert.match(script, /026_reviewed_profile_approval_rpc_verify\.sql/);
  for (const table of ["merchant_compliance_profiles", "merchant_compliance_reviews", "solo_plus_cases"]) {
    assertExplicitSeedColumnCounts(table);
  }

  assert.match(script, /RESET ROLE;[\s\S]*INSERT INTO public\.merchants[\s\S]*SET LOCAL ROLE service_role;/);
  const serviceRoleSection = script.match(/SET LOCAL ROLE service_role;([\s\S]*?)RESET ROLE;\n\n-- Structural duplicates/)?.[1] ?? "";
  assert.match(serviceRoleSection, /review_compliance_profile_decision_v1/);
  assert.doesNotMatch(serviceRoleSection, /INSERT INTO public\.(?:merchants|merchant_compliance_profiles|merchant_compliance_reviews|solo_plus_cases)/);
  assert.match(script, /SET LOCAL ROLE anon;[\s\S]*insufficient_privilege/);
  assert.match(script, /SET LOCAL ROLE authenticated;[\s\S]*insufficient_privilege/);
  assert.match(script, /has_function_privilege\('anon'/);
  assert.match(script, /has_function_privilege\('authenticated'/);

  for (const value of [
    "lite_verified",
    "needs_attention",
    "rejected",
    "restricted",
    "business_verified",
    "enhanced_verified",
    "approval_idempotent_replay",
    "approval_idempotency_conflict",
    "approval_profile_missing",
    "approval_reviewer_invalid",
  ]) {
    assert.match(script, new RegExp(value));
  }
  assert.match(script, /REVOKE UPDATE ON TABLE public\.merchant_compliance_profiles FROM service_role/);
  assert.match(script, /REVOKE INSERT ON TABLE public\.merchant_compliance_events FROM service_role/);
  assert.match(script, /GRANT SELECT ON TABLE auth\.users TO service_role/);
  assert.match(script, /ALTER ROLE service_role BYPASSRLS/);
  assert.match(script, /rollback left partial profile decision or event/);
  assert.match(script, /NOT setup_mode OR live_features_enabled/);
  assert.match(script, /can_collect_payments OR activation_status = 'active'/);
  for (const table of [
    "merchant_collection_limit_windows",
    "merchant_collection_limit_reservations",
    "merchant_collection_limit_reservation_windows",
    "merchant_collection_usage_events",
    "invoices",
    "payment_records",
    "subscriptions",
    "payment_providers",
    "provider_settlement_accounts",
  ]) {
    assert.match(script, new RegExp(`public\\.${table}`));
  }
  assert.match(script, /CONTROL\|LOCAL_APPROVAL_REHEARSAL=PASS/);
  assert.doesNotMatch(script, /src\\app|src\/app|src\\lib\\actions|paystack|monnify|breet/i);
  assert.match(runbook, /forbidden to run it against staging, production, or any Supabase project/i);
  assert.match(runbook, /concurrent identical or stale replay may fail closed/i);
  assert.match(runbook, /-Execute/);
  console.log("reviewed-profile-approval-rpc-rehearsal-script.test.ts passed");
}

run();
