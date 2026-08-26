import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const migrationPath = "supabase/migrations/20260826_00_canonical_workspace_linkage.sql";
const preflightPath = "supabase/staging/preflight/029_canonical_workspace_linkage_snapshot.sql";
const postflightPath = "supabase/staging/postflight/029_canonical_workspace_linkage_verify.sql";
const rehearsalScriptPath = "scripts/rehearse-canonical-workspace-linkage-local.ps1";
const migration = readFileSync(migrationPath, "utf8");
const preflight = readFileSync(preflightPath, "utf8");
const postflight = readFileSync(postflightPath, "utf8");
const rehearsalScript = readFileSync(rehearsalScriptPath, "utf8");

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

for (const [label, content] of [[migrationPath, migration], [preflightPath, preflight], [postflightPath, postflight]] as const) {
  assert.notEqual(readFileSync(label)[0], 0xef, `${label} must not start with a UTF-8 BOM`);
  assert.doesNotMatch(content, /\uFEFF/, `${label} must not contain a BOM character`);
}

assert.match(migration, /^BEGIN;[\s\S]*COMMIT;\s*$/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.merchant_canonical_workspaces/);
assert.match(migration, /merchant_id uuid NOT NULL[\s\S]*PRIMARY KEY \(merchant_id\)/);
assert.match(migration, /workspace_id uuid NOT NULL/);
assert.match(migration, /link_version bigint NOT NULL DEFAULT 1/);
assert.match(migration, /reconcile_idempotency_key text NOT NULL/);
assert.match(migration, /created_by uuid NOT NULL/);
assert.match(migration, /UNIQUE \(workspace_id\)/);
assert.match(migration, /UNIQUE \(reconcile_idempotency_key\)/);
assert.match(migration, /FOREIGN KEY \(workspace_id, merchant_id\)[\s\S]*REFERENCES public\.workspaces\(id, merchant_id\)/);
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS merchant_canonical_workspace_supporting_owner_key[\s\S]*ON public\.workspaces \(id, merchant_id\)/);

assert.match(migration, /to_regclass\('public\.workspaces'\)/);
assert.match(migration, /to_regclass\('public\.merchants'\)/);
assert.match(migration, /to_regclass\('auth\.users'\)/);
assert.match(migration, /workspace identity\/linkage contract is incompatible/);
assert.match(migration, /v_workspace_merchant_fk_count <> 1[\s\S]*v_workspace_merchant_unique_count <> 1/);
assert.match(migration, /v_existing_link_contract_ok/);
assert.match(migration, /existing canonical workspace authority is incompatible/);
assert.match(migration, /v_named_support_index_oid regclass := to_regclass\('public\.merchant_canonical_workspace_supporting_owner_key'\)/);
assert.match(migration, /v_named_support_index_oid IS NOT NULL AND NOT v_named_support_index_valid/);
assert.doesNotMatch(migration, /merchants\.workspace_id/);
assert.doesNotMatch(migration, /ORDER BY created_at DESC/);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reconcile_canonical_merchant_workspace_link_v1\([\s\S]*p_merchant_id uuid,[\s\S]*p_reconciled_by uuid,[\s\S]*p_reconcile_idempotency_key text/);
assert.match(migration, /LANGUAGE plpgsql[\s\S]*SECURITY INVOKER[\s\S]*SET search_path TO pg_catalog, public/);
assert.match(migration, /workspace_candidate\.merchant_id = p_merchant_id/);
assert.doesNotMatch(migration, /min\(workspace_candidate\.id\)/);
assert.match(migration, /v_workspace_candidate_count = 0[\s\S]*canonical_workspace_link_unavailable/);
assert.match(migration, /v_workspace_candidate_count <> 1[\s\S]*canonical_workspace_link_ambiguous/);
assert.match(migration, /canonical_workspace_link_replay/);
assert.match(migration, /canonical_workspace_link_idempotency_mismatch/);
assert.match(migration, /canonical_workspace_link_conflict/);
assert.match(migration, /canonical_workspace_link_failed/);
assert.match(migration, /INSERT INTO public\.merchant_canonical_workspaces/);
assert.doesNotMatch(migration, /v_existing_key_merchant_id/);
assert.doesNotMatch(migration, /UPDATE public\./);
assert.doesNotMatch(migration, /DELETE FROM public\./);
assert.doesNotMatch(migration, /TRUNCATE public\./);

assert.match(migration, /ALTER TABLE public\.merchant_canonical_workspaces ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /NO FORCE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON TABLE public\.merchant_canonical_workspaces FROM PUBLIC, anon, authenticated, service_role/);
assert.match(migration, /GRANT SELECT, INSERT ON TABLE public\.merchant_canonical_workspaces TO service_role/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.reconcile_canonical_merchant_workspace_link_v1\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated, service_role/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.reconcile_canonical_merchant_workspace_link_v1\(uuid, uuid, text\) TO service_role/);
assert.match(migration, /v_service_role_oid oid := to_regrole\('service_role'\)/);
assert.match(migration, /v_anon_oid oid := to_regrole\('anon'\)/);
assert.match(migration, /v_authenticated_oid oid := to_regrole\('authenticated'\)/);
assert.match(migration, /aclexplode\(COALESCE\(p\.proacl, acldefault\('f', p\.proowner\)\)\)/);
assert.match(migration, /aclexplode\(COALESCE\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/);
assert.match(migration, /privilege_state\.grantee = 0/);
assert.match(migration, /has_function_privilege\(v_service_role_oid, v_rpc_oid, 'EXECUTE'\)/);

assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.(?:review_compliance_profile_decision_v1|issue_canonical_approval_decision_request_v1|read_canonical_approval_snapshot_v1)\(/);
assert.doesNotMatch(migration, /setup_mode\s*=|live_features_enabled\s*=|can_collect_payments\s*=|activation_status\s*=\s*'active'/);
assert.doesNotMatch(migration, /INSERT INTO public\.(?:merchant_compliance_profiles|merchant_compliance_events|approval_decision_requests|payment|provider|invoice|subscription|merchant_collection)/i);
assert.doesNotMatch(migration, /checkout|paystack|monnify|storefront/i);
assert.doesNotMatch(migration, /LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS/);

assert.match(preflight, /to_regclass\(format\('public\.%I', r\.table_name\)\)/);
assert.match(preflight, /to_regclass\('auth\.users'\)/);
assert.doesNotMatch(preflight, /'public\.(?:merchants|workspaces|merchant_canonical_workspaces)'::regclass/);
assert.match(preflight, /prerequisite\.workspace_contract[\s\S]*workspace primary key, merchant FK cascade, and count-one merchant uniqueness are exact/i);
assert.match(preflight, /migration_026_028\.rpc_security/);
assert.match(preflight, /public\.issue_canonical_approval_decision_request_v1\(uuid,uuid,text,text,text\)/);
assert.match(preflight, /public\.read_canonical_approval_snapshot_v1\(uuid\)/);
assert.match(preflight, /role_facts AS \([\s\S]*to_regrole\('service_role'\)[\s\S]*to_regrole\('anon'\)[\s\S]*to_regrole\('authenticated'\)/);
assert.match(preflight, /aclexplode\(COALESCE\(p\.proacl, acldefault\('f', p\.proowner\)\)\)/);
assert.match(preflight, /protected_table_security AS \([\s\S]*aclexplode\(COALESCE\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/);
assert.match(preflight, /privilege_state\.grantee=0/);
assert.match(preflight, /has_function_privilege\(r\.service_role_oid, f\.issue_oid, 'EXECUTE'\)/);
assert.match(preflight, /migration_029\.objects_absent/);
assert.match(preflight, /migration_029\.supporting_index_name/);
assert.match(preflight, /merchant_canonical_workspace_supporting_owner_key/);
assert.match(preflight, /output_rows AS \([\s\S]*SELECT check_name, status, details FROM rendered[\s\S]*UNION ALL[\s\S]*All preflight checks must pass[\s\S]*\)[\s\S]*FROM output_rows[\s\S]*ORDER BY CASE WHEN check_name='summary'/);
assert.doesNotMatch(preflight, /UNION ALL\s+SELECT 'summary'[^\r\n]*\r?\nORDER BY CASE/);
assert.match(preflight, /summary[\s\S]*All preflight checks must pass/);
assert.doesNotMatch(preflight, /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)/im);

assert.match(postflight, /objects\.table[\s\S]*table\.rls[\s\S]*table\.browser_grants[\s\S]*table\.service_role_grants[\s\S]*table\.constraints_indexes[\s\S]*table\.immutable_posture[\s\S]*rpc\.signature[\s\S]*rpc\.security[\s\S]*rpc\.grants[\s\S]*rpc\.diagnostics_absent[\s\S]*rpc\.forbidden_writes[\s\S]*m028\.remains_fail_closed[\s\S]*data\.empty_after_apply[\s\S]*summary/);
assert.match(postflight, /to_regclass\('public\.merchant_canonical_workspaces'\)/);
assert.match(postflight, /to_regprocedure\('public\.reconcile_canonical_merchant_workspace_link_v1\(uuid,uuid,text\)'\)/);
assert.match(postflight, /^WITH object_facts AS \([\s\S]*to_regclass\('public\.merchant_canonical_workspaces'\)[\s\S]*to_regprocedure\('public\.reconcile_canonical_merchant_workspace_link_v1\(uuid,uuid,text\)'\)/);
assert.match(postflight, /query_to_xml\(format\('SELECT count\(\*\) AS count FROM %s', o\.link_table_oid::text\)/);
assert.doesNotMatch(postflight, /FROM public\.merchant_canonical_workspaces/);
assert.doesNotMatch(postflight, /(?:FROM|JOIN)\s+public\.reconcile_canonical_merchant_workspace_link_v1/i);
assert.doesNotMatch(postflight, /'public\.merchant_canonical_workspaces'::regclass/);
assert.match(postflight, /o\.reconcile_oid IS NOT NULL/);
assert.match(postflight, /SELECT overload_count FROM reconcile_overloads\)\s*=\s*1/);
assert.match(postflight, /role_facts AS \([\s\S]*to_regrole\('service_role'\)[\s\S]*to_regrole\('anon'\)[\s\S]*to_regrole\('authenticated'\)/);
assert.match(postflight, /aclexplode\(COALESCE\(f\.proacl, acldefault\('f', f\.proowner\)\)\)/);
assert.match(postflight, /aclexplode\(COALESCE\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/);
assert.match(postflight, /privilege_state\.grantee=0/);
assert.match(postflight, /has_function_privilege\(r\.service_role_oid, f\.oid, 'EXECUTE'\)/);
assert.match(postflight, /CASE WHEN o\.link_table_oid IS NULL OR r\.anon_oid IS NULL THEN false ELSE has_table_privilege\(r\.anon_oid/);
assert.doesNotMatch(postflight, /FROM public\.merchant_canonical_workspaces/);
assert.match(postflight, /merchant_canonical_workspaces_workspace_owner_fkey/);
assert.match(postflight, /canonical_request_workspace_linkage_unavailable/);
assert.match(postflight, /canonical_snapshot_workspace_linkage_unavailable/);
assert.match(postflight, /output_rows AS \([\s\S]*SELECT check_name, status, details FROM rendered[\s\S]*UNION ALL[\s\S]*All postflight checks must pass[\s\S]*\)[\s\S]*FROM output_rows[\s\S]*ORDER BY CASE WHEN check_name='summary'/);
assert.doesNotMatch(postflight, /UNION ALL\s+SELECT 'summary'[^\r\n]*\r?\nORDER BY CASE/);
assert.doesNotMatch(postflight, /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)/im);

assert.match(rehearsalScript, /REHEARSE MIGRATION 029 LOCAL DISPOSABLE DB ONLY/);
assert.match(rehearsalScript, /LOCAL_M029_REHEARSAL_NONLOCAL_HOST_REJECTED/);
assert.match(rehearsalScript, /LOCAL_M029_REHEARSAL_CONNECTION_STRING_REJECTED/);
assert.match(rehearsalScript, /LOCAL_M029_REHEARSAL_DISPOSABLE_DATABASE_NAME_REQUIRED/);
assert.match(rehearsalScript, /\^deraledger_m029_disposable_\[a-z0-9_\]\+\$/);
assert.match(rehearsalScript, /Write-LocalSqlFileNoBom/);
assert.match(rehearsalScript, /local-evidence\/migration-029-local-/);
assert.match(rehearsalScript, /\$env:PGOPTIONS = '-c client_min_messages=warning'/);
assert.match(rehearsalScript, /\$Psql = \(Resolve-Path -LiteralPath \(Get-Command \$PsqlPath -ErrorAction Stop\)\.Source\)\.Path/);
assert.match(rehearsalScript, /Start-Process -FilePath \$Psql -ArgumentList @\(/);
assert.match(rehearsalScript, /-RedirectStandardOutput \$StdoutPath -RedirectStandardError \$StderrPath -Wait -PassThru -NoNewWindow/);
assert.match(rehearsalScript, /-v ON_ERROR_STOP=1/);
assert.match(rehearsalScript, /\$PsqlExitCode = \$PsqlProcess\.ExitCode/);
assert.match(rehearsalScript, /Get-Content -LiteralPath \$StdoutPath -Raw/);
assert.match(rehearsalScript, /Get-Content -LiteralPath \$StderrPath -Raw/);
assert.match(rehearsalScript, /WriteAllText\(\$EvidencePath, \$Evidence, \$utf8NoBom\)/);
assert.match(rehearsalScript, /LOCAL_M029_REHEARSAL_VERIFICATION_FAILED/);
assert.match(rehearsalScript, /Remove-Item -Path Env:PGOPTIONS/);
assert.doesNotMatch(rehearsalScript, /Tee-Object -FilePath/);
assert.doesNotMatch(rehearsalScript, /\$Psql[^\r\n]*2>&1\s*\|/);
assert.doesNotMatch(rehearsalScript, /cmd\.exe|\$env:ComSpec|\/d \/c/);
assert.doesNotMatch(rehearsalScript, /& \$Psql\b/);
assert.match(rehearsalScript, /CREATE TABLE IF NOT EXISTS public\.workspaces[\s\S]*id uuid PRIMARY KEY,[\s\S]*merchant_id uuid REFERENCES public\.merchants\(id\) ON DELETE CASCADE,[\s\S]*UNIQUE \(merchant_id\)/);
assert.match(rehearsalScript, /\$Migration024[\s\S]*\$Migration025[\s\S]*\$Migration026[\s\S]*\$Migration027[\s\S]*\$Migration028[\s\S]*\$Migration029/);
assert.match(rehearsalScript, /\$Preflight029[\s\S]*Invoke-LocalPsqlFile '029-preflight' \$Preflight029[\s\S]*Invoke-LocalPsqlFile '029-apply-first' \$Migration029[\s\S]*Invoke-LocalPsqlFile '029-apply-rerun' \$Migration029[\s\S]*Invoke-LocalPsqlFile '029-postflight' \$Postflight029/);
assert.match(rehearsalScript, /zero_candidate_fails_closed[\s\S]*canonical_workspace_link_unavailable/);
assert.match(rehearsalScript, /one_candidate_creates_link[\s\S]*canonical_workspace_link_created/);
assert.match(rehearsalScript, /exact_replay_preserved[\s\S]*canonical_workspace_link_replay/);
assert.match(rehearsalScript, /conflicting_idempotency_fails_closed[\s\S]*canonical_workspace_link_idempotency_mismatch/);
assert.match(rehearsalScript, /cross_merchant_workspace_fails_closed[\s\S]*canonical_workspace_link_unavailable/);
assert.match(rehearsalScript, /duplicate_candidate_blocked/);
assert.match(rehearsalScript, /SET LOCAL ROLE anon[\s\S]*anon_execute_denied/);
assert.match(rehearsalScript, /SET LOCAL ROLE authenticated[\s\S]*authenticated_execute_denied/);
assert.match(rehearsalScript, /anon_table_denied/);
assert.match(rehearsalScript, /authenticated_table_denied/);
assert.match(rehearsalScript, /merchant_workspace_unchanged/);
assert.match(rehearsalScript, /forbidden_writes_absent/);
assert.match(rehearsalScript, /CONTROL\|LOCAL_CANONICAL_WORKSPACE_LINKAGE_REHEARSAL=PASS/);
assert.doesNotMatch(rehearsalScript, /SET ROLE PUBLIC|SET LOCAL ROLE PUBLIC/);
assert.match(rehearsalScript, /supabase\\\.co\|supabase\\\.com/);
assert.match(rehearsalScript, /LOCAL_M029_REHEARSAL_CONNECTION_STRING_REJECTED/);
assert.doesNotMatch(rehearsalScript, /STAGING_DATABASE_URL|PRODUCTION_DATABASE_URL/);

for (const [label, content] of [[migrationPath, migration], [preflightPath, preflight], [postflightPath, postflight]] as const) {
  assert.doesNotMatch(content, /has_function_privilege\(\s*'PUBLIC'/, `${label} must inspect PUBLIC through ACLs`);
  assert.doesNotMatch(content, /has_table_privilege\(\s*'PUBLIC'/, `${label} must inspect PUBLIC through ACLs`);
  assert.doesNotMatch(content, /has_schema_privilege\(\s*'PUBLIC'/, `${label} must inspect PUBLIC through ACLs`);
  assert.doesNotMatch(content, /pg_has_role\(\s*'PUBLIC'/, `${label} must not resolve PUBLIC as a role`);
  assert.doesNotMatch(content, /has_(?:function|table|schema)_privilege\(\s*'(?:anon|authenticated|service_role)'/, `${label} must resolve named roles to OIDs before privilege checks`);
  assert.doesNotMatch(content, /information_schema\.role_table_grants/, `${label} must inspect protected table grants through ACLs`);
  assert.doesNotMatch(content, /UNION ALL\s+SELECT 'summary'[^\r\n]*\r?\nORDER BY CASE/, `${label} must wrap summary ordering outside UNION`);
}

for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
  const content = readFileSync(file, "utf8");
  assert.doesNotMatch(content, /reconcile_canonical_merchant_workspace_link_v1|merchant_canonical_workspaces/);
}

console.log("canonical-workspace-linkage-schema.test.ts passed");
