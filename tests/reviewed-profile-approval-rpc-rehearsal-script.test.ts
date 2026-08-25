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
  assert.match(script, /CREATE OR REPLACE FUNCTION pg_temp\.capture_approval_scenario[\s\S]*review_compliance_profile_decision_v1/);
  assert.match(serviceRoleSection, /capture_approval_scenario/);
  assert.doesNotMatch(serviceRoleSection, /INSERT INTO public\.(?:merchants|merchant_compliance_profiles|merchant_compliance_reviews|solo_plus_cases)/);
  assert.match(script, /SET LOCAL ROLE anon;[\s\S]*insufficient_privilege/);
  assert.match(script, /SET LOCAL ROLE authenticated;[\s\S]*insufficient_privilege/);
  assert.match(script, /has_function_privilege\('anon'/);
  assert.match(script, /has_function_privilege\('authenticated'/);
  assert.doesNotMatch(script, /\bSET(?:\s+LOCAL)?\s+ROLE\s+PUBLIC\b/i);
  assert.doesNotMatch(script, /current_role\s*=\s*'?PUBLIC'?/i);
  assert.doesNotMatch(script, /has_function_privilege\('PUBLIC'/i);
  assert.match(script, /aclexplode\(COALESCE\([\s\S]*?procedure_state\.proacl/);
  assert.match(script, /procedure_state\.oid = to_regprocedure\([\s\S]*?review_compliance_profile_decision_v1/);
  assert.match(script, /privilege_state\.grantee = 0[\s\S]*?privilege_state\.privilege_type = 'EXECUTE'/);

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
  assert.match(script, /CREATE TRIGGER local_026_rehearsal_reject_profile_update[\s\S]*?BEFORE UPDATE ON public\.merchant_compliance_profiles/);
  assert.match(script, /DROP TRIGGER local_026_rehearsal_reject_profile_update ON public\.merchant_compliance_profiles/);
  assert.doesNotMatch(script, /REVOKE UPDATE ON TABLE public\.merchant_compliance_profiles FROM service_role/);
  assert.match(script, /REVOKE INSERT ON TABLE public\.merchant_compliance_events FROM service_role/);
  assert.match(script, /GRANT SELECT ON TABLE auth\.users TO service_role/);
  assert.match(script, /GRANT SELECT ON TABLE public\.solo_plus_cases TO service_role/);
  assert.doesNotMatch(script, /GRANT UPDATE ON TABLE public\.solo_plus_cases TO service_role/);
  assert.match(script, /ALTER ROLE service_role BYPASSRLS/);
  assert.match(script, /rollback_partial_state_detected/);
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
  assert.match(script, /CREATE TEMP TABLE approval_scenario_results/);
  assert.match(script, /scenario_name, expected_result, actual_result/);
  assert.match(script, /LOCAL_APPROVAL_SCENARIOS_FAILED/);
  assert.match(script, /approval_profile_update_failed/);
  assert.match(script, /approval_event_insert_failed/);
  assert.match(script, /probe\.profile_update_privilege_rls/);
  assert.match(script, /probe\.event_insert_privilege_rls/);
  assert.match(script, /probe\.replay_lookup_privilege/);
  assert.match(script, /probe\.lite_review_source_exact/);
  assert.match(script, /probe\.business_review_source_exact/);
  assert.match(script, /review_type = CASE 'solo_lite_review'[\s\S]*?WHEN 'solo_lite_review' THEN 'solo_lite'[\s\S]*?WHEN 'business_kyb_review' THEN 'business_kyb'/);
  assert.match(script, /review_type = CASE 'business_kyb_review'[\s\S]*?WHEN 'solo_lite_review' THEN 'solo_lite'[\s\S]*?WHEN 'business_kyb_review' THEN 'business_kyb'/);
  assert.match(script, /DIAGNOSTIC\|lite_review_source_before_rpc/);
  for (const field of [
    "input_merchant_id", "input_profile_id", "input_source_type", "input_source_id",
    "input_source_version", "input_plan_code", "input_target_status", "input_expected_row_version",
    "candidate_id", "candidate_merchant_id", "candidate_profile_id", "candidate_review_type",
    "candidate_target_plan_code", "candidate_review_status", "candidate_row_version",
    "exact_rpc_predicate_count",
  ]) {
    assert.match(script, new RegExp(field));
  }
  const exactDiagnosticIndex = script.indexOf("DIAGNOSTIC|lite_review_source_before_rpc");
  const firstLiteInvocationIndex = script.indexOf("lite.pending_to_verified");
  assert.ok(exactDiagnosticIndex >= 0 && exactDiagnosticIndex < firstLiteInvocationIndex, "exact Lite diagnostic must run before the first Lite RPC call");
  assert.match(script, /review_source\.profile_id = profile_state\.id[\s\S]*?review_source\.review_type = CASE rpc_input\.source_type[\s\S]*?WHEN 'solo_lite_review' THEN 'solo_lite'[\s\S]*?WHEN 'business_kyb_review' THEN 'business_kyb'[\s\S]*?review_source\.row_version = rpc_input\.source_version/);
  assert.match(script, /probe\.case_source_read/);
  assert.match(script, /'00000000-0000-4000-8000-000000000112','local-026-missing-reviewer'/);
  assert.doesNotMatch(script, /lite verified failed:/);
  const summaryIndex = script.indexOf("SELECT scenario_name, expected_result, actual_result");
  const finalFailureIndex = script.indexOf("LOCAL_APPROVAL_SCENARIOS_FAILED");
  assert.ok(summaryIndex >= 0 && finalFailureIndex > summaryIndex, "scenario results must print before final failure");
  assert.doesNotMatch(script, /src\\app|src\/app|src\\lib\\actions|paystack|monnify|breet/i);
  assert.match(runbook, /forbidden to run it against staging, production, or any Supabase project/i);
  assert.match(runbook, /concurrent identical or stale replay may fail closed/i);
  assert.match(runbook, /-Execute/);
  console.log("reviewed-profile-approval-rpc-rehearsal-script.test.ts passed");
}

run();
