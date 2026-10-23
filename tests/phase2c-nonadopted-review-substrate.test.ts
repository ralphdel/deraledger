import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const path = "supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql";
const sql = readFileSync(path, "utf8");
const guard = sql.split("AS $freeze_submitted_plan_review_v1$")[1]?.split("$freeze_submitted_plan_review_v1$;")[0];
const submit = sql.split("AS $submit_draft_plan_review_v1$")[1]?.split("$submit_draft_plan_review_v1$;")[0];
assert.ok(guard && submit, "Both new functions must have complete, separate bodies");
const replay = submit.split("IF FOUND AND v_event.merchant_id = p_merchant_id")[1]?.split("RETURN pg_catalog.jsonb_build_object('kind', 'already_processed'")[0];
assert.ok(replay, "A replay must have a bounded canonical event/review comparison");

assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/m);
assert.equal((sql.match(/CREATE FUNCTION public\./g) ?? []).length, 2);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION|DROP (?:TABLE|FUNCTION|TRIGGER)|ALTER TABLE .* DISABLE ROW LEVEL SECURITY/i);
assert.doesNotMatch(sql, /review_compliance_profile_decision_v1|solo_plus_cases|payment_records|subscription_payments/);
assert.match(sql, /column prerequisite incompatible/);
assert.match(sql, /uniqueness prerequisite incompatible/);
assert.match(sql, /uq_merchant_compliance_reviews_idempotency[\s\S]*conkey = ARRAY\[[\s\S]*merchant_id[\s\S]*idempotency_key/);
assert.match(sql, /AND NOT condeferrable AND convalidated[\s\S]*indisvalid AND indisunique/);
assert.match(sql, /AND NOT tgisinternal/);
assert.match(sql, /REVOKE UPDATE ON TABLE public\.merchant_compliance_reviews FROM service_role/);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.submit_draft_plan_review_v1\([\s\S]*?FROM PUBLIC, anon, authenticated, service_role/);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.submit_draft_plan_review_v1\([\s\S]*?TO service_role/);
assert.match(sql, /has_function_privilege\('service_role', 'public\.freeze_submitted_plan_review_v1\(\)', 'EXECUTE'\)/);
assert.match(sql, /CREATE FUNCTION public\.freeze_submitted_plan_review_v1\(\)[\s\S]*?SECURITY INVOKER\s+SET search_path = pg_catalog, pg_temp/);
assert.match(sql, /CREATE FUNCTION public\.submit_draft_plan_review_v1\([\s\S]*?SECURITY DEFINER\s+SET search_path = pg_catalog, pg_temp/);
assert.match(sql, /p\.prosecdef[\s\S]*p\.proowner = pg_catalog\.to_regrole\(current_user\)::oid/);
assert.match(sql, /has_table_privilege\(current_user, 'public\.merchants', 'UPDATE'\)/);
assert.match(sql, /owner_role\.rolsuper OR owner_role\.rolbypassrls OR NOT EXISTS/);
assert.match(sql, /table_class\.relowner <> owner_role\.oid OR table_class\.relforcerowsecurity/);
assert.doesNotMatch(sql, /has_table_privilege\('service_role', 'public\.merchants', 'UPDATE'\)/);
assert.doesNotMatch(sql, /GRANT\s+(?:UPDATE|ALL)\s+ON\s+TABLE\s+public\.merchants\s+TO\s+service_role/i);
assert.doesNotMatch(sql, /GRANT\s+(?:INSERT|UPDATE|ALL)\s+ON\s+TABLE[^;]*TO\s+(?:anon|authenticated)/i);

assert.match(guard, /OLD\.review_status <> 'draft' OR OLD\.submitted_at IS NOT NULL/);
assert.match(guard, /NEW\.review_status = 'draft'[\s\S]*RAISE EXCEPTION/);
for (const field of ["id", "merchant_id", "profile_id", "review_type", "target_plan_code", "evidence_snapshot", "policy_version", "submitted_at", "idempotency_key"]) {
  assert.match(guard, new RegExp(`NEW\\.${field}`));
  assert.match(guard, new RegExp(`OLD\\.${field}`));
}
assert.match(guard, /IS DISTINCT FROM[\s\S]*RAISE EXCEPTION 'Submitted review source is immutable'/);
assert.match(guard, /NEW\.id, NEW\.merchant_id[\s\S]*IS DISTINCT FROM[\s\S]*OLD\.id, OLD\.merchant_id/);

const isolation = submit.indexOf("pg_catalog.current_setting('transaction_isolation') IS DISTINCT FROM 'read committed'");
const isolationFailure = submit.indexOf("'kind', 'unsupported_isolation'");
assert.ok(isolation >= 0 && isolationFailure > isolation, "Unsupported isolation must return a bounded result");
assert.ok(isolation < submit.indexOf("FROM public.merchants"), "Isolation must be checked before acquiring locks");
assert.ok(isolationFailure < submit.indexOf("INSERT INTO public.merchant_compliance_reviews"), "Isolation must fail before mutation");

const ordered = [
  "FROM public.merchants",
  "FROM public.merchant_canonical_workspaces",
  "FROM public.merchant_compliance_profiles",
  "FROM public.merchant_compliance_events",
  "FROM public.merchant_compliance_reviews",
  "INSERT INTO public.merchant_compliance_reviews",
  "INSERT INTO public.merchant_compliance_events",
];
let previous = -1;
for (const marker of ordered) {
  const position = submit.indexOf(marker);
  assert.ok(position > previous, `${marker} must follow the preceding lock, replay check, or write`);
  previous = position;
}
const merchantLock = submit.match(/SELECT \* INTO v_merchant FROM public\.merchants\b[^;]*;/)?.[0];
const profileLock = submit.match(/SELECT \* INTO v_profile FROM public\.merchant_compliance_profiles\b[^;]*;/)?.[0];
assert.ok(merchantLock && profileLock, "Merchant serialization and profile version locks must remain present");
assert.match(merchantLock, /WHERE\s+id = p_merchant_id\s+FOR\s+NO\s+KEY\s+UPDATE\s*;/);
assert.doesNotMatch(merchantLock, /\bFOR\s+UPDATE\b/);
assert.match(profileLock, /WHERE\s+merchant_id = p_merchant_id\s+FOR\s+UPDATE\s*;/);
assert.match(submit, /-- Idempotency is merchant-scoped[\s\S]*\(merchant_id, key\) unique/);
assert.match(submit, /FROM public\.merchant_compliance_events\s+WHERE merchant_id = p_merchant_id AND idempotency_key = p_idempotency_key/);
assert.doesNotMatch(sql, /CREATE\s+(?:UNIQUE\s+)?INDEX|UNIQUE\s*\(\s*idempotency_key\s*\)/i);
for (const predicate of [
  /v_event\.profile_id = v_profile\.id/,
  /v_event\.source_id = v_review\.id/,
  /v_event\.source_type = v_source_type/,
  /v_event\.actor_type = 'merchant' AND v_event\.actor_id = p_actor_id/,
  /v_event\.policy_version = p_policy_version/,
  /v_review\.row_version = 1/,
  /v_event\.resulting_row_version = v_review\.row_version/,
  /v_review\.evidence_snapshot = p_evidence_snapshot/,
  /v_event\.metadata = pg_catalog\.jsonb_build_object\([\s\S]*'workspace_id', p_workspace_id[\s\S]*'profile_row_version', p_expected_profile_row_version[\s\S]*'snapshot_sha256', v_snapshot_hash[\s\S]*'policy_id', v_policy_id/,
  /v_event\.event_type = 'phase2c_draft_review_submit_v1'/,
  /v_event\.from_state = '\{\}'::jsonb/,
  /v_event\.to_state = pg_catalog\.jsonb_build_object\('review_status', 'pending'\)/,
]) {
  assert.match(replay, predicate, `Exact replay is missing ${predicate}`);
}
assert.match(submit, /WHERE id = v_event\.source_id AND merchant_id = p_merchant_id AND profile_id = v_profile\.id/);
assert.match(submit, /v_merchant\.user_id IS DISTINCT FROM p_actor_id/);
assert.match(submit, /workspace_id IS DISTINCT FROM p_workspace_id/);
assert.match(submit, /v_profile\.plan_code IS DISTINCT FROM v_plan/);
assert.match(submit, /v_profile\.row_version <> p_expected_profile_row_version/);
assert.match(submit, /WHEN 'individual' THEN 'solo_lite'/);
assert.match(submit, /WHEN 'corporate' THEN 'business'/);
assert.doesNotMatch(submit, /WHEN 'solo_plus' THEN|WHEN 'starter' THEN/);
assert.match(submit, /p_policy_version IS DISTINCT FROM '2c-2b-draft-v1'/);
assert.match(submit, /'policyStatus' IS DISTINCT FROM 'draft'/);
assert.match(submit, /'adapterVersion' IS DISTINCT FROM '2c-2b-v1'/);
assert.match(submit, /pg_catalog\.sha256\(/);
assert.match(replay, /'snapshot_sha256', v_snapshot_hash/);
assert.match(submit, /'kind', 'already_processed'/);
assert.match(submit, /'kind', 'version_conflict'/);
assert.match(submit, /'kind', 'evidence_conflict'/);
assert.match(submit, /'kind', 'state_conflict'/);
assert.match(submit, /'review_status', 'pending'/);
assert.match(submit, /'phase2c_draft_review_submit_v1'/);
assert.match(submit, /'evidence_trust', 'unverified_diagnostic'/);
assert.match(submit, /id, merchant_id, profile_id, review_type, target_plan_code, review_status,[\s\S]*idempotency_key, row_version\s*\) VALUES \([\s\S]*p_idempotency_key, 1\s*\) RETURNING id, row_version INTO v_review_id, v_review_version/);
assert.match(submit, /IF v_review_version IS DISTINCT FROM 1 THEN\s*RAISE EXCEPTION/);
assert.match(submit, /p_policy_version, p_idempotency_key, NULL, v_review_version/);
assert.match(submit, /'kind', 'applied'[\s\S]*'row_version', v_review_version/);
assert.ok(submit.indexOf("INSERT INTO public.merchant_compliance_reviews") < submit.indexOf("INSERT INTO public.merchant_compliance_events"));
assert.doesNotMatch(submit, /UPDATE public\.merchant_compliance_profiles|UPDATE public\.merchants|INSERT INTO public\.merchant_compliance_profiles/);
assert.doesNotMatch(submit, /'lite_verified'|'business_verified'|SET\s+review_status\s*=\s*'approved'/);
assert.doesNotMatch(sql, /raw_bvn|raw_nin|provider_payload|document_path|bank_account_number/i);

const runtimeImports = spawnSync("rg", ["-l", "submit_draft_plan_review_v1|freeze_submitted_plan_review_v1", "src"], { encoding: "utf8" });
assert.equal(runtimeImports.status, 0, "B4 must adopt the submit RPC through one trusted server boundary");
assert.deepEqual(runtimeImports.stdout.trim().split(/\r?\n/), [
  "src\\lib\\compliance\\server\\review-correction-service.ts",
]);
assert.doesNotMatch(runtimeImports.stdout, /freeze_submitted_plan_review_v1/);

console.log("PASS Phase 2C-2C-B1 non-adopted review substrate source contract");
