import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migration = "supabase/migrations/20260825_00_reviewed_profile_approval_rpc.sql";
const substrateMigration = "supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql";
const preflight = "supabase/staging/preflight/026_reviewed_profile_approval_rpc_snapshot.sql";
const postflight = "supabase/staging/postflight/026_reviewed_profile_approval_rpc_verify.sql";
const cleanupMigration = "supabase/migrations/20260825_01_cleanup_approval_rpc_diagnostics.sql";
const cleanupPreflight = "supabase/staging/preflight/027_cleanup_approval_rpc_diagnostics_snapshot.sql";
const cleanupPostflight = "supabase/staging/postflight/027_cleanup_approval_rpc_diagnostics_verify.sql";
const signature = "review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function assertNoBom(file: string) {
  assert.notEqual(readFileSync(file)[0], 0xef, `${file} must be UTF-8 without BOM`);
}

function run() {
  for (const file of [migration, preflight, postflight]) assertNoBom(file);
  const sql = readFileSync(migration, "utf8");
  const substrateSql = readFileSync(substrateMigration, "utf8");
  const beforeFunction = sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION"));

  assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.review_compliance_profile_decision_v1\(/g) ?? []).length, 1);
  assert.match(sql, new RegExp(signature.replaceAll("(", "\\(").replaceAll(")", "\\)")));
  assert.match(sql, /RETURNS TABLE\(result_code text, profile_id uuid, event_id uuid, resulting_row_version bigint\)/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.doesNotMatch(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path TO pg_catalog, public/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.review_compliance_profile_decision_v1\([\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.review_compliance_profile_decision_v1\([\s\S]*TO service_role/);
  assert.match(beforeFunction, /Migration 026 prerequisite missing/);
  assert.match(beforeFunction, /unexpected review_compliance_profile_decision_v1 overload/);
  assert.match(beforeFunction, /bootstrap_reviewed_profile_v1/);
  assert.match(sql, /FROM public\.merchant_compliance_profiles[\s\S]*?FOR UPDATE/);
  const reviewerValidation = sql.match(/v_failure_stage := 'reviewer_lookup';[\s\S]*?approval_reviewer_invalid[\s\S]*?RETURN;/)?.[0] ?? "";
  const reviewLookupStart = sql.indexOf("v_failure_stage := 'review_source_lookup';");
  const caseLookupStart = sql.indexOf("v_failure_stage := 'case_source_lookup';");
  const sourceValidationEnd = sql.indexOf("IF NOT v_source_valid THEN");
  const reviewLookup = sql.slice(reviewLookupStart, caseLookupStart);
  const caseLookup = sql.slice(caseLookupStart, sourceValidationEnd);
  assert.match(reviewerValidation, /FROM auth\.users WHERE id = p_reviewer_id/);
  assert.ok(sql.indexOf("v_failure_stage := 'reviewer_lookup';") < sql.indexOf("v_failure_stage := 'event_replay_lookup';"));
  assert.ok(sql.indexOf("v_failure_stage := 'reviewer_lookup';") < sql.indexOf("v_failure_stage := 'review_source_lookup';"));
  assert.match(reviewLookup, /SELECT count\(\*\) INTO v_review_source_count[\s\S]*?FROM public\.merchant_compliance_reviews AS review_source[\s\S]*?WHERE review_source\.id = p_source_id[\s\S]*?review_source\.merchant_id = p_merchant_id[\s\S]*?review_source\.profile_id = v_profile\.id/);
  assert.match(reviewLookup, /review_source\.review_type = CASE p_source_type[\s\S]*?WHEN 'solo_lite_review' THEN 'solo_lite'[\s\S]*?WHEN 'business_kyb_review' THEN 'business_kyb'[\s\S]*?END/);
  assert.match(reviewLookup, /review_source\.target_plan_code = p_plan_code[\s\S]*?review_source\.review_status IN \('pending', 'needs_attention'\)[\s\S]*?review_source\.row_version = p_source_version/);
  assert.doesNotMatch(reviewLookup, /\n\s*(?:AND )?profile_id = v_profile\.id/);
  assert.match(reviewLookup, /IF v_review_source_count = 0 THEN[\s\S]*?approval_review_source_lookup_failed[\s\S]*?ELSIF v_review_source_count > 1 THEN[\s\S]*?approval_ambiguous_state[\s\S]*?v_source_valid := true/);
  assert.doesNotMatch(reviewLookup, /FOR UPDATE|SELECT \* INTO v_review/);
  assert.match(reviewLookup, /review_source\.review_type = CASE p_source_type[\s\S]*?solo_lite_review[\s\S]*?business_kyb_review[\s\S]*?review_source\.target_plan_code = p_plan_code[\s\S]*?review_source\.review_status IN \('pending', 'needs_attention'\)[\s\S]*?review_source\.row_version = p_source_version/);
  assert.match(reviewLookup, /current_setting\('deraledger\.local_approval_rehearsal_diagnostics', true\) = 'on'[\s\S]*?to_regclass\('pg_temp\.approval_rpc_internal_diagnostics'\)[\s\S]*?INSERT INTO pg_temp\.approval_rpc_internal_diagnostics/);
  assert.match(reviewLookup, /mapped_review_type, profile_compliance_status, profile_row_version,[\s\S]*?review_source_match_count/);
  for (const branch of [
    "review_lookup_failed.enter",
    "review_lookup_failed.source_type_mapping",
    "review_lookup_failed.review_count",
    "review_lookup_failed.diagnostic_gate_check",
    "review_lookup_failed.diagnostic_insert_start",
    "review_lookup_failed.diagnostic_insert_complete",
    "review_lookup_failed.diagnostic_gate_inactive",
    "review_lookup_failed.review_count_zero",
    "review_lookup_failed.review_count_multiple",
    "review_lookup_failed.unknown_branch",
  ]) {
    assert.match(sql, new RegExp(branch));
  }
  const exceptionHandler = sql.slice(sql.indexOf("EXCEPTION WHEN OTHERS THEN"));
  assert.match(exceptionHandler, /GET STACKED DIAGNOSTICS[\s\S]*?v_exception_sqlstate = RETURNED_SQLSTATE,[\s\S]*?v_exception_message = MESSAGE_TEXT,[\s\S]*?v_exception_detail = PG_EXCEPTION_DETAIL,[\s\S]*?v_exception_hint = PG_EXCEPTION_HINT,[\s\S]*?v_exception_context = PG_EXCEPTION_CONTEXT;/);
  for (const branch of [
    "review_lookup_failed.exception_sqlstate",
    "review_lookup_failed.exception_message",
    "review_lookup_failed.exception_detail",
    "review_lookup_failed.exception_hint",
    "review_lookup_failed.exception_context",
  ]) {
    assert.match(exceptionHandler, new RegExp(branch));
  }
  assert.match(caseLookup, /WHERE id = p_source_id[\s\S]*?merchant_id = p_merchant_id/);
  assert.match(caseLookup, /target_plan = 'solo_plus'[\s\S]*?row_version::bigint = p_source_version[\s\S]*?requirements_policy_version = btrim\(p_policy_version\)/);
  assert.match(caseLookup, /case_status = 'approved'[\s\S]*?case_status = 'rejected'[\s\S]*?case_status IN \('verification_pending', 'manual_review'\)/);
  assert.doesNotMatch(caseLookup, /FOR UPDATE/);
  const eventIdempotencyLookup = sql.match(/SELECT \* INTO v_event[\s\S]*?IF FOUND THEN/)?.[0] ?? "";
  assert.match(eventIdempotencyLookup, /FROM public\.merchant_compliance_events/);
  assert.doesNotMatch(eventIdempotencyLookup, /FOR UPDATE/);
  assert.match(substrateSql, /GRANT SELECT, INSERT ON TABLE public\.merchant_compliance_events TO service_role/);
  assert.match(sql, /approval_idempotent_replay/);
  assert.match(sql, /approval_idempotency_conflict/);
  assert.match(sql, /v_failure_stage text := 'payload_validation'/);
  assert.match(sql, /approval_profile_update_failed/);
  assert.match(sql, /approval_event_insert_failed/);
  assert.match(sql, /approval_atomic_write_failed_unknown/);
  assert.doesNotMatch(sql, /RETURN QUERY SELECT 'approval_atomic_write_failed',/);
  assert.match(sql, /v_event\.actor_id = p_reviewer_id/);
  assert.match(sql, /v_event\.to_state ->> 'activation_status' = v_target_activation_status/);
  assert.match(sql, /v_event\.metadata ->> 'plan_code' = p_plan_code/);
  assert.match(sql, /approval_row_version_conflict|approval_profile_state_invalid/);
  assert.match(sql, /row_version = v_profile\.row_version \+ 1/);
  assert.match(sql, /INSERT INTO public\.merchant_compliance_events/);
  assert.match(sql, /compliance_profile_approval_v1/);
  assert.match(sql, /p_source_version/);
  assert.match(sql, /p_target_compliance_status/);
  assert.match(sql, /lite_pending[\s\S]*lite_verified/);
  assert.match(sql, /enhanced_pending[\s\S]*enhanced_verified/);
  assert.match(sql, /business_pending[\s\S]*business_verified/);
  assert.match(sql, /needs_attention/);
  assert.match(sql, /review_status IN \('pending', 'needs_attention'\)/);
  assert.doesNotMatch(sql, /v_review\.policy_version/);
  assert.doesNotMatch(sql, /v_review\.review_status = 'approved'/);
  assert.match(sql, /risk_suspended[\s\S]*suspended/);
  assert.match(sql, /NOTIFY pgrst, 'reload schema'/);

  assert.doesNotMatch(sql, /UPDATE public\.merchant_compliance_reviews/);
  assert.doesNotMatch(sql, /UPDATE public\.solo_plus_cases/);
  for (const table of [
    "merchants", "workspaces", "subscriptions", "invoices", "payment_records",
    "merchant_collection_limit_windows", "merchant_collection_limit_reservations",
    "merchant_collection_limit_reservation_windows", "merchant_collection_usage_events",
  ]) {
    assert.doesNotMatch(sql, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE) public\\.${table}`));
  }
  assert.doesNotMatch(sql, /UPDATE public\.merchant_compliance_profiles[\s\S]{0,1500}can_collect_payments\s*=/);
  assert.doesNotMatch(sql, /activation_status\s*=\s*'active'/);
  assert.doesNotMatch(sql, /setup_mode\s*=/);
  assert.doesNotMatch(sql, /live_features_enabled\s*=/);
  assert.doesNotMatch(sql, /checkout|paystack|monnify|breet|provider[_ ]?call/i);

  const preflightSql = readFileSync(preflight, "utf8");
  const postflightSql = readFileSync(postflight, "utf8");
  assert.match(preflightSql, /prerequisite\.tables_columns[\s\S]*prerequisite\.rls[\s\S]*migration_025\.rpc_security[\s\S]*rpc\.overloads[\s\S]*summary/);
  assert.match(postflightSql, /rpc\.signature[\s\S]*rpc\.security[\s\S]*rpc\.browser_grants[\s\S]*rpc\.service_role_grant[\s\S]*data\.empty_after_apply[\s\S]*summary/);
  assert.doesNotMatch(preflightSql, /INSERT|UPDATE|DELETE|TRUNCATE/i);
  assert.doesNotMatch(postflightSql, /INSERT|UPDATE|DELETE|TRUNCATE/i);
  assert.match(preflightSql, /to_regclass\('public\.merchant_compliance_profiles'\)/);
  assert.match(preflightSql, /to_regclass\('public\.merchant_compliance_reviews'\)/);
  assert.match(preflightSql, /to_regclass\('public\.merchant_compliance_events'\)/);
  assert.doesNotMatch(preflightSql, /'public\.merchant_compliance_(?:profiles|reviews|events)'::regclass/);

  for (const file of [cleanupMigration, cleanupPreflight, cleanupPostflight]) assertNoBom(file);
  const cleanupSql = readFileSync(cleanupMigration, "utf8");
  const cleanupPreflightSql = readFileSync(cleanupPreflight, "utf8");
  const cleanupPostflightSql = readFileSync(cleanupPostflight, "utf8");
  assert.match(cleanupSql, /^BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.equal((cleanupSql.match(/CREATE OR REPLACE FUNCTION public\.review_compliance_profile_decision_v1\(/g) ?? []).length, 1);
  assert.match(cleanupSql, new RegExp(signature.replaceAll("(", "\\(").replaceAll(")", "\\)")));
  assert.match(cleanupSql, /RETURNS TABLE\(result_code text, profile_id uuid, event_id uuid, resulting_row_version bigint\)/);
  assert.match(cleanupSql, /SECURITY INVOKER/);
  assert.doesNotMatch(cleanupSql, /SECURITY DEFINER/);
  assert.match(cleanupSql, /SET search_path TO pg_catalog, public/);
  assert.match(cleanupSql, /REVOKE ALL ON FUNCTION public\.review_compliance_profile_decision_v1\([\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(cleanupSql, /GRANT EXECUTE ON FUNCTION public\.review_compliance_profile_decision_v1\([\s\S]*TO service_role/);
  assert.match(cleanupSql, /FROM public\.merchant_compliance_reviews AS review_source[\s\S]*?review_source\.profile_id = v_profile\.id[\s\S]*?review_source\.review_type = CASE p_source_type[\s\S]*?review_source\.row_version = p_source_version/);
  for (const diagnostic of [
    "LOCAL_APPROVAL_BRANCH", "LOCAL_APPROVAL_EXCEPTION", "deraledger.local_approval_rehearsal_diagnostics",
    "approval_rpc_internal_diagnostics", "GET STACKED DIAGNOSTICS",
  ]) {
    assert.doesNotMatch(cleanupSql, new RegExp(diagnostic.replaceAll(".", "\\.")));
  }
  assert.match(cleanupSql, /approval_profile_update_failed/);
  assert.match(cleanupSql, /approval_event_insert_failed/);
  assert.match(cleanupSql, /approval_atomic_write_failed_unknown/);
  assert.match(cleanupSql, /approval_idempotent_replay/);
  assert.match(cleanupSql, /approval_idempotency_conflict/);
  assert.match(cleanupSql, /row_version = v_profile\.row_version \+ 1/);
  assert.match(cleanupSql, /INSERT INTO public\.merchant_compliance_events/);
  assert.match(cleanupSql, /NOTIFY pgrst, 'reload schema'/);
  assert.doesNotMatch(cleanupSql, /UPDATE public\.merchant_compliance_reviews|UPDATE public\.solo_plus_cases/);
  for (const table of [
    "merchants", "workspaces", "subscriptions", "invoices", "payment_records",
    "merchant_collection_limit_windows", "merchant_collection_limit_reservations",
    "merchant_collection_limit_reservation_windows", "merchant_collection_usage_events",
  ]) {
    assert.doesNotMatch(cleanupSql, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE) public\\.${table}`));
  }
  assert.doesNotMatch(cleanupSql, /setup_mode\s*=|live_features_enabled\s*=|can_collect_payments\s*=/);
  assert.doesNotMatch(cleanupSql, /activation_status\s*=\s*'active'/);
  assert.doesNotMatch(cleanupSql, /checkout|paystack|monnify|breet|provider[_ ]?call/i);
  assert.match(cleanupPreflightSql, /migration_026\.rpc_signature[\s\S]*rpc\.browser_grants[\s\S]*compliance\.browser_policies[\s\S]*summary/);
  assert.match(cleanupPostflightSql, /rpc\.signature[\s\S]*rpc\.security[\s\S]*rpc\.diagnostics_removed[\s\S]*rpc\.browser_grants[\s\S]*data\.empty_after_apply[\s\S]*summary/);
  assert.match(cleanupPostflightSql, /pg_get_functiondef[\s\S]*LOCAL_APPROVAL_BRANCH[\s\S]*GET STACKED DIAGNOSTICS/);
  assert.doesNotMatch(cleanupPreflightSql, /INSERT|UPDATE|DELETE|TRUNCATE/i);
  assert.doesNotMatch(cleanupPostflightSql, /INSERT|UPDATE|DELETE|TRUNCATE/i);

  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /review_compliance_profile_decision_v1|compliance-profile-approval-transaction-client/);
  }
  console.log("reviewed-profile-approval-rpc-schema.test.ts passed");
}

run();
