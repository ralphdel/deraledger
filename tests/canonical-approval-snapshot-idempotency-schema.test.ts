import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migration = "supabase/migrations/20260825_02_canonical_approval_snapshot_idempotency.sql";
const preflight = "supabase/staging/preflight/028_canonical_approval_snapshot_idempotency_snapshot.sql";
const postflight = "supabase/staging/postflight/028_canonical_approval_snapshot_idempotency_verify.sql";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function noBom(file: string) {
  assert.notEqual(readFileSync(file)[0], 0xef, `${file} must be UTF-8 without BOM`);
}

for (const file of [migration, preflight, postflight]) noBom(file);
const sql = readFileSync(migration, "utf8");
const preflightSql = readFileSync(preflight, "utf8");
const postflightSql = readFileSync(postflight, "utf8");

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/);
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.approval_policy_versions/);
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.approval_decision_requests/);
assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_approval_decision_requests_profile_source/);
assert.match(sql, /approval_decision_requests_fingerprint_unique UNIQUE NULLS NOT DISTINCT/);
assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.issue_canonical_approval_decision_request_v1\(/g) ?? []).length, 1);
assert.equal((sql.match(/CREATE OR REPLACE FUNCTION public\.read_canonical_approval_snapshot_v1\(/g) ?? []).length, 1);
assert.match(sql, /issue_canonical_approval_decision_request_v1\(uuid,uuid,text,text,text\)/);
assert.match(sql, /read_canonical_approval_snapshot_v1\(uuid\)/);
assert.match(sql, /SECURITY INVOKER/g);
assert.doesNotMatch(sql, /SECURITY DEFINER/);
assert.match(sql, /SET search_path TO pg_catalog, public/g);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.issue_canonical_approval_decision_request_v1[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.read_canonical_approval_snapshot_v1[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.issue_canonical_approval_decision_request_v1[\s\S]*TO service_role/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.read_canonical_approval_snapshot_v1[\s\S]*TO service_role/);
assert.match(sql, /ALTER TABLE public\.approval_policy_versions ENABLE ROW LEVEL SECURITY/);
assert.match(sql, /ALTER TABLE public\.approval_decision_requests ENABLE ROW LEVEL SECURITY/);
assert.match(sql, /ALTER TABLE public\.approval_policy_versions NO FORCE ROW LEVEL SECURITY/);
assert.match(sql, /ALTER TABLE public\.approval_decision_requests NO FORCE ROW LEVEL SECURITY/);
assert.match(sql, /REVOKE ALL ON TABLE public\.approval_policy_versions, public\.approval_decision_requests FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql, /GRANT SELECT, INSERT ON TABLE public\.approval_decision_requests TO service_role/);
assert.match(sql, /FROM public\.workspaces w WHERE w\.merchant_id=v_profile\.merchant_id/);
assert.match(sql, /FROM public\.workspaces w WHERE w\.id=v_request\.workspace_id AND w\.merchant_id=v_request\.merchant_id/);
assert.match(sql, /workspace_merchant_fk_is_exact|source_attribute\.attname = 'merchant_id'/);
assert.doesNotMatch(sql, /public\.merchants\.workspace_id|m\.workspace_id|\('merchants','workspace_id'\)/);
assert.match(sql, /r\.review_type=CASE v_profile\.decision_source_type[\s\S]*solo_lite_review[\s\S]*business_kyb_review/);
assert.match(sql, /v_case\.requirements_policy_version<>btrim\(p_policy_version\)/);
assert.match(sql, /NOT COALESCE\([\s\S]*v_profile\.plan_code='solo_lite' AND v_profile\.compliance_status IN \('lite_pending','needs_attention'\)[\s\S]*v_profile\.plan_code='solo_plus' AND v_profile\.compliance_status IN \('enhanced_pending','needs_attention'\)[\s\S]*v_profile\.plan_code='business' AND v_profile\.compliance_status IN \('business_pending','needs_attention'\)[\s\S]*false\n\s*\)/);
assert.match(sql, /canonical_request_profile_state_invalid/);
assert.match(sql, /canonical_snapshot_stale_or_conflicting/);
assert.doesNotMatch(sql, /v_profile\.plan_code='solo_lite' AND v_profile\.compliance_status IN \('business_pending'/);
assert.match(sql, /decision_idempotency_key text NOT NULL DEFAULT gen_random_uuid\(\)::text/);
assert.match(sql, /canonical_request_existing[\s\S]*canonical_request_issued/);
assert.match(sql, /canonical_snapshot_replay_candidate/);
assert.match(sql, /canonical_snapshot_replay_ambiguous/);
assert.match(sql, /ON CONFLICT ON CONSTRAINT approval_decision_requests_fingerprint_unique DO NOTHING/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.issue_canonical_approval_decision_request_v1/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.read_canonical_approval_snapshot_v1/);
const m028FunctionBodies = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.issue_canonical_approval_decision_request_v1("));
assert.doesNotMatch(m028FunctionBodies, /LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|GET STACKED DIAGNOSTICS|approval_rpc_internal_diagnostics/);
for (const forbidden of [
  "merchants", "workspaces", "subscriptions", "invoices", "payment_records",
  "merchant_collection_limit_windows", "merchant_collection_limit_reservations",
  "merchant_collection_limit_reservation_windows", "merchant_collection_usage_events",
]) assert.doesNotMatch(sql, new RegExp(`(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE) public\\.${forbidden}`));
assert.doesNotMatch(sql, /setup_mode\s*=|live_features_enabled\s*=|can_collect_payments\s*=|activation_status\s*=\s*'active'/);
assert.doesNotMatch(sql, /checkout|paystack|monnify|provider[_ ]?call/i);
assert.match(preflightSql, /to_regclass\(format\('public\.%I',e\.table_name\)\)/);
assert.doesNotMatch(preflightSql, /'public\.(?:merchant_compliance_profiles|merchant_compliance_reviews|merchant_compliance_events|merchants|workspaces)'::regclass/);
assert.match(preflightSql, /workspace_key_shape[\s\S]*merchant_id_is_unique[\s\S]*workspace_id_is_unique[\s\S]*workspace_merchant_is_unique[\s\S]*workspace_merchant_fk_is_exact/);
assert.match(preflightSql, /prerequisite\.workspace_linkage[\s\S]*workspaces\.merchant_id is unique and FK-backed/);
assert.doesNotMatch(preflightSql, /public\.merchants\.workspace_id|\('merchants','workspace_id'\)/);
assert.match(preflightSql, /migration_025\.rpc_security[\s\S]*bootstrap_reviewed_profile_v1[\s\S]*has_function_privilege\('service_role'/);
assert.match(preflightSql, /migration_025\.rpc_security[\s\S]*NOT has_function_privilege\('anon'[\s\S]*NOT has_function_privilege\('authenticated'/);
assert.match(preflightSql, /migration_025\.rpc_security[\s\S]*a\.grantee=0/);
assert.match(preflightSql, /migration_025\.rpc_security[\s\S]*migration_026_027\.rpc[\s\S]*migration_028\.objects[\s\S]*summary/);
assert.doesNotMatch(preflightSql, /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)/im);
assert.match(postflightSql, /objects\.tables[\s\S]*tables\.rls[\s\S]*tables\.service_role_grants[\s\S]*tables\.constraints_indexes[\s\S]*tables\.immutable_posture[\s\S]*rpc\.signature[\s\S]*rpc\.diagnostics_absent[\s\S]*rpc\.forbidden_writes[\s\S]*summary/);
assert.match(postflightSql, /prerequisite\.workspace_linkage[\s\S]*workspace_merchant_fk_is_exact/);
assert.doesNotMatch(postflightSql, /public\.merchants\.workspace_id|\('merchants','workspace_id'\)/);
assert.match(postflightSql, /c\.relrowsecurity AND NOT c\.relforcerowsecurity/);
assert.match(postflightSql, /ARRAY\['SELECT'\]::text\[\]/);
assert.match(postflightSql, /ARRAY\['INSERT','SELECT'\]::text\[\]/);
assert.match(postflightSql, /approval_decision_requests_fingerprint_unique/);
assert.match(postflightSql, /idx_approval_decision_requests_profile_source/);
assert.match(postflightSql, /NOT t\.tgisinternal/);
assert.match(postflightSql, /LOCAL_APPROVAL_BRANCH\|LOCAL_APPROVAL_EXCEPTION\|deraledger/);
assert.doesNotMatch(postflightSql, /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)/im);
for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /issue_canonical_approval_decision_request_v1|read_canonical_approval_snapshot_v1|approval_decision_requests/);
}
console.log("canonical-approval-snapshot-idempotency-schema.test.ts passed");
