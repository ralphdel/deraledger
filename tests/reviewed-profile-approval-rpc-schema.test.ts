import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migration = "supabase/migrations/20260825_00_reviewed_profile_approval_rpc.sql";
const substrateMigration = "supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql";
const preflight = "supabase/staging/preflight/026_reviewed_profile_approval_rpc_snapshot.sql";
const postflight = "supabase/staging/postflight/026_reviewed_profile_approval_rpc_verify.sql";
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
  assert.match(sql, /FROM public\.merchant_compliance_reviews[\s\S]*?FOR UPDATE/);
  assert.match(sql, /FROM public\.solo_plus_cases[\s\S]*?FOR UPDATE/);
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
  assert.match(sql, /v_review\.review_status IN \('pending', 'needs_attention'\)/);
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

  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /review_compliance_profile_decision_v1|compliance-profile-approval-transaction-client/);
  }
  console.log("reviewed-profile-approval-rpc-schema.test.ts passed");
}

run();
