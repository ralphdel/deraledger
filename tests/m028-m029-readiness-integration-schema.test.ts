import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationPath = "supabase/migrations/20260827_00_m028_m029_readiness_integration.sql";
const preflightPath = "supabase/staging/preflight/030_m028_m029_readiness_integration_snapshot.sql";
const postflightPath = "supabase/staging/postflight/030_m028_m029_readiness_integration_verify.sql";
const migration = readFileSync(migrationPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");
const postflight = readFileSync(postflightPath, "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

for (const [label, source] of [[migrationPath, migration], [preflightPath, preflight], [postflightPath, postflight]] as const) {
  assert.notEqual(readFileSync(label)[0], 0xef, `${label} must not start with a UTF-8 BOM`);
  assert.doesNotMatch(source, /\uFEFF/, `${label} must not contain a BOM character`);
  assert.doesNotMatch(source, /has_function_privilege\(\s*'PUBLIC'/, `${label} must inspect PUBLIC through ACLs`);
  assert.doesNotMatch(source, /has_table_privilege\(\s*'PUBLIC'/, `${label} must inspect PUBLIC through ACLs`);
  assert.doesNotMatch(source, /has_schema_privilege\(\s*'PUBLIC'/, `${label} must inspect PUBLIC through ACLs`);
  assert.doesNotMatch(source, /pg_has_role\(\s*'PUBLIC'/, `${label} must not resolve PUBLIC as a role`);
  assert.doesNotMatch(source, /has_(?:function|table|schema)_privilege\(\s*'(?:anon|authenticated|service_role)'/, `${label} must resolve role OIDs before privilege checks`);
  assert.doesNotMatch(source, /UNION ALL\s+SELECT 'summary'[^\r\n]*\r?\nORDER BY CASE/, `${label} must wrap summary ordering outside UNION`);
}

assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/);
assert.doesNotMatch(migration, /CREATE TABLE|ALTER TABLE|CREATE INDEX|DROP TABLE|DROP FUNCTION/);
assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:review_compliance_profile_decision_v1|issue_canonical_approval_decision_request_v1|read_canonical_approval_snapshot_v1)\(/);
assert.equal((migration.match(/CREATE OR REPLACE FUNCTION public\.issue_canonical_approval_decision_request_v2\(/g) ?? []).length, 1);
assert.equal((migration.match(/CREATE OR REPLACE FUNCTION public\.read_canonical_approval_snapshot_v2\(/g) ?? []).length, 1);
assert.match(migration, /issue_canonical_approval_decision_request_v2\(uuid,uuid,text,text,text\)/);
assert.match(migration, /read_canonical_approval_snapshot_v2\(uuid\)/);
assert.match(migration, /RETURNS TABLE\(\s*result_code text,\s*decision_request_id uuid,\s*decision_idempotency_key text\)/);
assert.match(migration, /RETURNS TABLE\([\s\S]*target_compliance_status text\s*\)/);
assert.match(migration, /SECURITY INVOKER/g);
assert.doesNotMatch(migration, /SECURITY DEFINER/);
assert.match(migration, /SET search_path TO pg_catalog, public/g);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.issue_canonical_approval_decision_request_v2\(uuid,uuid,text,text,text\) FROM PUBLIC, anon, authenticated, service_role/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.read_canonical_approval_snapshot_v2\(uuid\) FROM PUBLIC, anon, authenticated, service_role/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.issue_canonical_approval_decision_request_v2\(uuid,uuid,text,text,text\) TO service_role/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.read_canonical_approval_snapshot_v2\(uuid\) TO service_role/);

assert.match(migration, /canonical_request_v2_payload_invalid/);
assert.match(migration, /canonical_request_v2_reviewer_invalid/);
assert.match(migration, /canonical_request_v2_profile_missing/);
assert.match(migration, /canonical_request_v2_profile_state_invalid/);
assert.match(migration, /canonical_request_v2_workspace_linkage_unavailable/);
assert.match(migration, /canonical_request_v2_workspace_linkage_conflict/);
assert.match(migration, /canonical_request_v2_policy_invalid/);
assert.match(migration, /canonical_request_v2_source_invalid/);
assert.match(migration, /canonical_request_v2_idempotent_replay/);
assert.match(migration, /canonical_request_v2_idempotency_conflict/);
assert.match(migration, /canonical_request_v2_created/);
assert.match(migration, /canonical_request_v2_failed/);
assert.match(migration, /canonical_snapshot_v2_payload_invalid/);
assert.match(migration, /canonical_snapshot_v2_request_missing/);
assert.match(migration, /canonical_snapshot_v2_profile_missing/);
assert.match(migration, /canonical_snapshot_v2_stale_or_conflicting/);
assert.match(migration, /canonical_snapshot_v2_workspace_linkage_unavailable/);
assert.match(migration, /canonical_snapshot_v2_workspace_linkage_conflict/);
assert.match(migration, /canonical_snapshot_v2_policy_invalid/);
assert.match(migration, /canonical_snapshot_v2_source_invalid/);
assert.match(migration, /canonical_snapshot_v2_ready/);
assert.match(migration, /canonical_snapshot_v2_failed/);
const v2Bodies = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.issue_canonical_approval_decision_request_v2("));
assert.doesNotMatch(v2Bodies, /RAISE NOTICE|LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS/);

assert.match(migration, /FROM public\.merchant_canonical_workspaces canonical_link[\s\S]*JOIN public\.workspaces workspace_owner[\s\S]*workspace_owner\.id = canonical_link\.workspace_id[\s\S]*workspace_owner\.merchant_id = canonical_link\.merchant_id/);
assert.match(migration, /canonical_link\.merchant_id = v_profile\.merchant_id[\s\S]*canonical_link\.link_version = 1/);
assert.match(migration, /v_request\.workspace_id IS DISTINCT FROM v_workspace_id/);
assert.doesNotMatch(migration, /merchants\.workspace_id|m\.workspace_id/);
assert.doesNotMatch(migration, /ORDER BY created_at DESC|maybeSingle|currentMerchant|workspace selection/i);
assert.match(migration, /INSERT INTO public\.approval_decision_requests/);
assert.doesNotMatch(migration, /INSERT INTO public\.(?:merchants|workspaces|merchant_canonical_workspaces|merchant_compliance_profiles|merchant_compliance_reviews|merchant_compliance_events|payment|provider|invoice|subscription|merchant_collection|storefront)/i);
assert.doesNotMatch(migration, /UPDATE public\.|DELETE FROM public\.|TRUNCATE public\./);
assert.doesNotMatch(migration, /setup_mode\s*=|live_features_enabled\s*=|can_collect_payments\s*=|activation_status\s*=\s*'active'/);
assert.doesNotMatch(migration, /checkout|paystack|monnify|provider[_ ]?call/i);
assert.match(migration, /to_regrole\('service_role'\)/);
assert.match(migration, /has_table_privilege\(v_service_role_oid, to_regclass\('public\.merchant_compliance_profiles'\), 'SELECT'\)/);
assert.match(migration, /has_table_privilege\(v_service_role_oid, to_regclass\('public\.merchant_canonical_workspaces'\), 'SELECT'\)/);
assert.match(migration, /has_table_privilege\(v_service_role_oid, to_regclass\('auth\.users'\), 'SELECT'\)/);

for (const [label, source] of [[migrationPath, migration], [preflightPath, preflight], [postflightPath, postflight]] as const) {
  assert.doesNotMatch(
    source,
    /to_regclass\('public\.merchant_canonical_workspace_supporting_owner_key'\)\s+IS\s+NOT\s+NULL/,
    `${label} must not accept the M029 ownership index by name alone`,
  );
  assert.match(source, /merchant_canonical_workspace_supporting_owner_key/);
  assert.match(source, /index_state\.indrelid\s*=\s*(?:v_workspaces_oid|to_regclass\('public\.workspaces'\))/);
  assert.match(source, /index_state\.indisunique/);
  assert.match(source, /index_state\.indisvalid/);
  assert.match(source, /index_state\.indisready/);
  assert.match(source, /index_state\.indpred IS NULL/);
  assert.match(source, /index_state\.indnkeyatts\s*=\s*2/);
  assert.match(source, /index_state\.indnatts\s*=\s*2/);
  assert.match(source, /unnest\(index_state\.indkey::smallint\[\]\) WITH ORDINALITY/);
  assert.doesNotMatch(source, /index_state\.indkey\s*=/, `${label} must normalize pg_index.indkey before comparison`);
  assert.match(source, /merchant_canonical_workspaces_pkey/);
  assert.match(source, /merchant_canonical_workspaces_workspace_key/);
  assert.match(source, /merchant_canonical_workspaces_workspace_owner_fkey/);
  assert.match(source, /unnest\(constraint_state\.conkey\) WITH ORDINALITY/);
  assert.match(source, /unnest\(constraint_state\.confkey\) WITH ORDINALITY/);
  assert.match(source, /constraint_state\.confupdtype\s*=\s*'a'::"char"/);
  assert.match(source, /constraint_state\.confdeltype\s*=\s*'r'::"char"/);
  assert.match(source, /constraint_state\.confmatchtype\s*=\s*'s'::"char"/);
}

assert.match(preflight, /to_regclass\(format\('public\.%I', expected\.table_name\)\)/);
assert.match(preflight, /to_regprocedure\(expected\.signature\)/);
assert.match(preflight, /aclexplode\(COALESCE\(p\.proacl, acldefault\('f', p\.proowner\)\)\)/);
assert.match(preflight, /privilege_state\.grantee = 0/);
assert.match(preflight, /prerequisite\.m026_m029_rpc_security/);
assert.match(preflight, /prerequisite\.m028_v1_fail_closed/);
assert.match(preflight, /prerequisite\.m028_m029_rls_browser_security/);
assert.match(preflight, /prerequisite\.service_role_read_contract/);
assert.match(preflight, /prerequisite\.m028_m029_constraints/);
assert.match(preflight, /m029_authority AS \(/);
assert.match(preflight, /migration_030\.v2_objects_absent/);
assert.match(preflight, /output_rows AS \([\s\S]*FROM output_rows[\s\S]*ORDER BY CASE WHEN check_name = 'summary'/);
assert.doesNotMatch(preflight, /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)/im);

assert.match(postflight, /to_regprocedure\(expected\.signature\)/);
assert.match(postflight, /authority_counts AS \([\s\S]*query_to_xml\(format\('SELECT count\(\*\) AS count FROM %s', table_fact\.oid::text\)/);
assert.doesNotMatch(postflight, /FROM public\.(?:approval_decision_requests|merchant_canonical_workspaces)/);
assert.match(postflight, /rpc\.signatures[\s\S]*rpc\.security_grants[\s\S]*m028\.v1_preserved[\s\S]*m029\.authority_intact[\s\S]*tables\.browser_security[\s\S]*v2\.workspace_authority[\s\S]*v2\.safe_result_codes[\s\S]*rpc\.diagnostics_and_forbidden_writes_absent[\s\S]*data\.new_authorities_empty_after_apply[\s\S]*summary/);
assert.match(postflight, /canonical_request_workspace_linkage_unavailable/);
assert.match(postflight, /canonical_snapshot_workspace_linkage_unavailable/);
assert.match(postflight, /canonical_request_v2_workspace_linkage_unavailable/);
assert.match(postflight, /canonical_snapshot_v2_workspace_linkage_unavailable/);
assert.match(postflight, /output_rows AS \([\s\S]*FROM output_rows[\s\S]*ORDER BY CASE WHEN check_name='summary'/);
assert.match(postflight, /m029_authority AS \(/);
assert.doesNotMatch(postflight, /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)/im);

for (const file of sourceFiles("src")) {
  assert.doesNotMatch(
    readFileSync(file, "utf8"),
    /issue_canonical_approval_decision_request_v2|read_canonical_approval_snapshot_v2|m028_m029_readiness_integration/,
    `${file} must not adopt M030 into runtime source`,
  );
}

console.log("m028-m029-readiness-integration-schema.test.ts passed");
