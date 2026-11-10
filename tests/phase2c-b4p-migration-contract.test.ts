import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const path = "supabase/migrations/20261023000000_phase2c_draft_compliance_profile_provisioning.sql";
const sql = readFileSync(path, "utf8");
const compact = sql.replace(/\s+/g, " ");
const b4Service = readFileSync("src/lib/compliance/server/review-correction-service.ts", "utf8");
const preflight = readFileSync("supabase/staging/preflight/031_phase2c_draft_compliance_profile_provisioning_snapshot.sql", "utf8");
const postflight = readFileSync("supabase/staging/postflight/031_phase2c_draft_compliance_profile_provisioning_verify.sql", "utf8");
const behavior = readFileSync("supabase/tests/phase2c_draft_compliance_profile_provisioning.sql", "utf8");
const concurrentWorker = readFileSync("supabase/tests/phase2c_b4p_concurrency_worker.sql", "utf8");
const concurrentVerify = readFileSync("supabase/tests/phase2c_b4p_concurrency_verify.sql", "utf8");
const concurrentSetup = readFileSync("supabase/tests/phase2c_b4p_concurrency_setup.sql", "utf8");
const concurrentCleanup = readFileSync("supabase/tests/phase2c_b4p_concurrency_cleanup.sql", "utf8");
const localTargetGate = readFileSync("supabase/tests/phase2c_b4p_local_target_gate.sql", "utf8");
const concurrentRunner = readFileSync("scripts/rehearse-phase2c-b4p-concurrency-local.ps1", "utf8");
const expectedMigrationHash = "12CDC46047AF9F39A02C9D4AF330256BCD8C48654101F49C5C9940D69BC036CF";

assert.equal(
  createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase(),
  expectedMigrationHash,
  "B4P migration hash pin must match the corrected canonical source",
);
assert.match(concurrentRunner, new RegExp(expectedMigrationHash));

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.ensure_draft_compliance_profile_v1\(\s*p_merchant_id uuid\s*\)/);
assert.match(sql, /SECURITY INVOKER/);
assert.match(sql, /SET search_path = pg_catalog, public/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.ensure_draft_compliance_profile_v1\(uuid\)[\s\S]+FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ensure_draft_compliance_profile_v1\(uuid\)[\s\S]+TO service_role/);
assert.doesNotMatch(sql, /SECURITY DEFINER/);

const functionBody = sql.match(
  /CREATE OR REPLACE FUNCTION public\.ensure_draft_compliance_profile_v1[\s\S]+?AS \$function\$([\s\S]+?)\$function\$;/,
)?.[1];
assert.ok(functionBody, "B4P ensure RPC body must be present");
assert.doesNotMatch(
  functionBody,
  /EXCEPTION\s+WHEN\s+OTHERS/i,
  "B4P must allow unexpected database failures to roll back and propagate to the server boundary",
);

assert.match(sql, /FROM public\.merchants m[\s\S]+FOR UPDATE/);
assert.match(sql, /WHEN 'individual' THEN 'solo_lite'/);
assert.match(sql, /WHEN 'corporate' THEN 'business'/);
assert.equal((sql.match(/ELSE NULL/g) || []).length >= 2, true);
assert.doesNotMatch(sql, /WHEN 'starter' THEN/);
assert.doesNotMatch(sql, /WHEN 'solo_plus' THEN/);
assert.match(sql, /FROM public\.subscriptions s[\s\S]+status[\s\S]+'active'/);
assert.doesNotMatch(sql, /workspace_subscriptions/);
assert.match(sql, /FROM public\.merchant_canonical_workspaces mcw[\s\S]+LEFT JOIN public\.workspaces w ON w\.id = mcw\.workspace_id/);
assert.doesNotMatch(sql, /ORDER BY[\s\S]+created_at/);

assert.equal((sql.match(/INSERT INTO public\.merchant_compliance_profiles/g) || []).length, 1);
assert.doesNotMatch(sql, /INSERT INTO public\.merchant_compliance_reviews/);
assert.doesNotMatch(sql, /INSERT INTO public\.merchant_compliance_events/);
assert.doesNotMatch(sql, /UPDATE public\.(merchants|subscriptions|workspaces|merchant_compliance_profiles)/);
assert.match(compact, /'draft', 'test_mode'/);
assert.match(sql, /collection_limit_approved[\s\S]+can_collect_payments[\s\S]+can_activate_settlement/);
assert.match(sql, /false,[\s\S]+false,[\s\S]+false,[\s\S]+false,[\s\S]+false,[\s\S]+false/);
assert.match(sql, /policy_version[\s\S]+decision_source_type[\s\S]+reviewed_by[\s\S]+row_version/);
assert.match(sql, /ON CONFLICT \(merchant_id\) DO NOTHING/);
assert.match(sql, /v_profile\.row_version IS DISTINCT FROM 1/);
assert.match(sql, /v_has_review[\s\S]+v_has_event/);
assert.match(sql, /draft_profile_existing_conflict/);
assert.match(sql, /draft_profile_existing_exact/);
assert.match(sql, /draft_profile_created/);
assert.doesNotMatch(b4Service, /ensureDraftComplianceProfileForEligibleMerchant|ensure_draft_compliance_profile_v1/);
assert.match(preflight, /BEGIN TRANSACTION READ ONLY/);
assert.match(preflight, /ROLLBACK/);
assert.match(postflight, /BEGIN TRANSACTION READ ONLY/);
assert.match(postflight, /service_execute AND NOT anon_execute AND NOT authenticated_execute/);
assert.match(behavior, /BEGIN;[\s\S]+SET LOCAL ROLE service_role[\s\S]+ROLLBACK;/);
assert.match(behavior, /draft_profile_created[\s\S]+draft_profile_existing_exact/);
for (const requiredBehavior of [
  "solo_lite_create", "solo_lite_replay", "business_create", "business_replay",
  "individual_alias", "corporate_alias", "starter_rejected", "solo_plus_rejected",
  "unknown_rejected", "owner_required", "subscription_inactive", "subscription_mismatch",
  "canonical_missing", "cross_tenant_link_constraint", "existing_exact",
  "existing_plan_mismatch", "existing_stronger", "existing_provenance",
  "existing_restricted", "existing_rejected", "unexpected_db_failure",
]) {
  assert.ok(behavior.includes(requiredBehavior), `missing behavioral SQL case: ${requiredBehavior}`);
}
assert.match(behavior, /CREATE TRIGGER b4p_force_unexpected_failure[\s\S]+B4P_FORCED_UNEXPECTED_DATABASE_FAILURE[\s\S]+rpc_error_propagated/);
assert.match(behavior, /b4p_authority_snapshot[\s\S]+workspace_subscription_rows[\s\S]+existing profile was overwritten/);
assert.match(behavior, /policy_version IS NOT NULL[\s\S]+decision_source_id IS NOT NULL[\s\S]+reviewed_by IS NOT NULL/);

assert.match(localTargetGate, /host\(inet_server_addr\(\)\)/);
assert.match(localTargetGate, /v_server_host IS DISTINCT FROM '127\.0\.0\.1'/);
assert.match(localTargetGate, /v_server_port IS DISTINCT FROM 55432/);
assert.match(localTargetGate, /v_server_version_num < 150000[\s\S]+v_server_version_num >= 160000/);
assert.match(localTargetGate, /\^deraledger_phase2c_b4p_rehearsal_\[a-z0-9_\]\+\$/);
assert.match(localTargetGate, /session_user IS DISTINCT FROM 'postgres'/);
assert.match(localTargetGate, /B4P_LOCAL_TARGET_REJECTED/);
for (const mutatingArtifact of [behavior, concurrentSetup, concurrentWorker, concurrentCleanup]) {
  assert.match(mutatingArtifact, /\\ir phase2c_b4p_local_target_gate\.sql/);
}

assert.match(concurrentWorker, /pg_advisory_xact_lock\(20261023, 4\)/);
assert.match(concurrentWorker, /FOR UPDATE[\s\S]+pg_advisory_xact_lock\(20261023, 5\)[\s\S]+ensure_draft_compliance_profile_v1/);
assert.match(concurrentRunner, /pg_blocking_pids\(blocked\.pid\)/);
assert.match(concurrentRunner, /pg_blocking_pids\(worker_a\.pid\)/);
assert.match(concurrentRunner, /phase2c_b4p_coordinator/);
assert.match(concurrentRunner, /worker_b_blocked_observed = true/);
assert.doesNotMatch(concurrentRunner, /\.Kill\(\$true\)/);
assert.match(concurrentRunner, /ReadToEndAsync\(\)/);
assert.match(concurrentRunner, /PGPASSWORD[\s\S]+PGPASSFILE/);
assert.doesNotMatch(concurrentRunner, /\.ArgumentList/);
assert.doesNotMatch(concurrentRunner, /\.Environment\[/);
assert.match(concurrentRunner, /function ConvertTo-B4pWindowsCommandLineArgument/);
assert.match(concurrentRunner, /ProcessStartInfo\]::new\(\)[\s\S]+\.Arguments =/);
assert.match(concurrentRunner, /EnvironmentVariables\.Remove/);
assert.match(concurrentRunner, /function Stop-B4pProcessTree/);
assert.match(concurrentRunner, /function Start-B4pPsql[\s\S]+\[AllowEmptyCollection\(\)\][\s\S]+\[string\[\]\]\$AdditionalArguments = @\(\)/);
assert.match(concurrentRunner, /\$coordinator = Start-B4pPsql -AdditionalArguments @\(\)/);
assert.match(concurrentVerify, /created_count = 1[\s\S]+replay_count = 1[\s\S]+profile_count = 1/);
assert.match(concurrentVerify, /overlap_proven[\s\S]+authority_state_unchanged/);
assert.match(concurrentVerify, /review_count = 0[\s\S]+event_count = 0/);

const frozen = [
  "supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql",
  "supabase/migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql",
];
for (const frozenPath of frozen) {
  assert.ok(readFileSync(frozenPath, "utf8").length > 0);
}

console.log("phase2c-b4p-migration-contract.test.ts passed");
