import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const sql = readFileSync(
  "supabase/migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql",
  "utf8",
);
const b1 = readFileSync(
  "supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql",
  "utf8",
);

function body(name: string): string {
  const match = sql.match(
    new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$b2_(?:rmi|resubmit)\\$([\\s\\S]*?)\\$b2_(?:rmi|resubmit)\\$;`),
  );
  assert.ok(match, `${name} must be defined`);
  return match[1];
}

const rmi = body("request_draft_plan_review_correction_v1");
const resubmit = body("resubmit_corrected_draft_plan_review_v1");
assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/);
assert.equal((sql.match(/CREATE FUNCTION public\./g) ?? []).length, 2);
assert.ok(sql.indexOf("DO $b2_preflight$") < sql.indexOf("CREATE FUNCTION public.request_draft_plan_review_correction_v1"));
assert.doesNotMatch(sql, /CREATE (?:TABLE|INDEX|TRIGGER)|ALTER TABLE|CREATE OR REPLACE FUNCTION|DROP (?:TABLE|FUNCTION)/i);
assert.match(sql, /'is_super_admin', 'boolean'::regtype/);
assert.match(sql, /trg_freeze_submitted_plan_review_v1/);
assert.match(sql, /has_table_privilege\('service_role', 'public\.merchant_compliance_reviews', 'UPDATE'\)/);
assert.doesNotMatch(sql, /GRANT\s+(?:UPDATE|ALL)\s+ON\s+.*merchant_compliance_reviews\s+TO\s+service_role/i);

for (const [name, signature, command] of [
  ["request_draft_plan_review_correction_v1", "uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text", rmi],
  ["resubmit_corrected_draft_plan_review_v1", "uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text", resubmit],
] as const) {
  assert.match(sql, new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER\\s+SET search_path = pg_catalog, pg_temp`));
  assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?\\) FROM PUBLIC, anon, authenticated, service_role;`));
  assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?\\) TO service_role;`));
  assert.ok(sql.includes(signature));
  assert.match(command, /pg_catalog\.current_setting\('transaction_isolation'\) IS DISTINCT FROM 'read committed'/);
  assert.match(command, /'kind', 'unsupported_isolation'/);
  assert.ok(command.indexOf("'kind', 'unsupported_isolation'") < command.indexOf("FOR NO KEY UPDATE"));
  assert.match(command, /WHEN 'individual' THEN 'solo_lite'/);
  assert.match(command, /WHEN 'corporate' THEN 'business'/);
  assert.doesNotMatch(command, /WHEN 'starter' THEN|WHEN 'solo_plus' THEN/);
  assert.match(command, /p_policy_version IS DISTINCT FROM '2c-2b-draft-v1'/);
  assert.match(command, /FOR NO KEY UPDATE/);
  assert.match(command, /FROM public\.merchant_compliance_profiles[\s\S]*?FOR UPDATE/);
  assert.match(command, /FROM public\.merchant_compliance_reviews[\s\S]*?FOR UPDATE/);
  assert.match(command, /p_expected_profile_row_version/);
  assert.match(command, /p_idempotency_key/);
  assert.match(command, /WHEN unique_violation THEN[\s\S]*?'kind', 'state_conflict'/);
  assert.doesNotMatch(command, /UPDATE public\.merchant_compliance_profiles|UPDATE public\.merchants/);
  assert.doesNotMatch(command, /'lite_verified'|'business_verified'|SET\s+review_status\s*=\s*'approved'|SET\s+review_status\s*=\s*'rejected'/);
  assert.doesNotMatch(command, /EXECUTE\s+|format\s*\(/i);
}

assert.match(rmi, /is_super_admin = true/);
assert.match(rmi, /user_id = p_reviewer_id AND is_super_admin = true\) THEN/);
assert.doesNotMatch(rmi, /app_metadata|auth\.users/);
assert.match(rmi, /ORDER BY id FOR NO KEY UPDATE/);
assert.ok(rmi.indexOf("ORDER BY id FOR NO KEY UPDATE") < rmi.indexOf("AND user_id = p_reviewer_id AND is_super_admin = true) THEN"));
assert.match(rmi, /'reviewer_unauthorized'/);
assert.match(rmi, /'evidence_incomplete', 'evidence_expired', 'evidence_mismatch', 'reviewer_requested_correction'/);
assert.match(rmi, /array_ndims\(p_requested_finding_codes\) IS DISTINCT FROM 1/);
assert.match(rmi, /COALESCE\(pg_catalog\.cardinality\(p_requested_finding_codes\), 0\) NOT BETWEEN 1 AND 32/);
assert.doesNotMatch(sql, /pg_catalog\.(?:coalesce|nullif|greatest|least)\s*\(/i);
assert.match(rmi, /p_expected_review_row_version = 9223372036854775807/);
assert.match(resubmit, /p_expected_old_row_version = 9223372036854775807/);
assert.match(rmi, /jsonb_array_elements\(v_review\.evidence_snapshot -> 'findings'\)/);
assert.match(rmi, /count\(DISTINCT requested\.code\)/);
assert.match(rmi, /array_agg\(requested\.code ORDER BY requested\.code\)/);
assert.match(rmi, /v_plan = 'solo_lite' AND requested\.code NOT IN/);
assert.match(rmi, /v_plan = 'business' AND requested\.code NOT IN/);
assert.match(rmi, /v_review\.review_status IS DISTINCT FROM 'pending'/);
assert.match(rmi, /v_review\.row_version IS DISTINCT FROM 1/);
assert.match(rmi, /v_review\.review_type IS DISTINCT FROM \(CASE v_plan WHEN 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END\)/);
assert.match(rmi, /phase2c_draft_review_submit_v1/);
assert.match(rmi, /e\.from_state = '\{\}'::jsonb/);
assert.match(rmi, /e\.to_state = '\{"review_status":"pending"\}'::jsonb/);
assert.match(rmi, /UPDATE public\.merchant_compliance_reviews SET review_status = 'needs_attention'/);
assert.match(rmi, /row_version = row_version \+ 1/);
assert.match(rmi, /RETURNING row_version INTO v_new_version/);
assert.match(rmi, /phase2c_draft_review_needs_attention_v1/);
assert.match(rmi, /p_expected_review_row_version, v_new_version/);
assert.match(rmi, /'requested_finding_codes', pg_catalog\.to_jsonb\(v_codes\)/);
assert.match(rmi, /'snapshot_sha256', v_snapshot_hash/);
assert.match(rmi, /'kind', 'already_processed'/);

assert.match(resubmit, /v_merchant\.user_id IS DISTINCT FROM p_actor_id/);
assert.match(resubmit, /v_old\.review_status IS DISTINCT FROM 'needs_attention'/);
assert.match(resubmit, /v_old\.review_type IS DISTINCT FROM \(CASE v_plan WHEN 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END\)/);
assert.match(resubmit, /v_new_review\.review_type = \(CASE v_plan WHEN 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END\)/);
assert.match(resubmit, /phase2c_draft_review_needs_attention_v1/);
assert.match(resubmit, /v_rmi_event\.metadata ->> 'profile_row_version' IS DISTINCT FROM p_expected_profile_row_version::text/);
assert.match(resubmit, /p_new_evidence_snapshot = v_old\.evidence_snapshot/);
assert.match(resubmit, /v_new_key := p_idempotency_key \|\| ':new'/);
assert.match(resubmit, /UPDATE public\.merchant_compliance_reviews SET review_status = 'cancelled'/);
assert.match(resubmit, /decision_reason_code = 'superseded_by_corrected_submission'/);
assert.match(resubmit, /v_submit := public\.submit_draft_plan_review_v1\(/);
assert.match(b1, /p_evidence_snapshot[\s\S]*?octet_length\(p_evidence_snapshot::text\) > 16384/);
assert.match(resubmit, /ERRCODE = 'P2B01'/);
assert.match(resubmit, /WHEN SQLSTATE 'P2B01' THEN[\s\S]*?IF v_abort_kind IS NULL THEN RAISE; END IF;/);
assert.doesNotMatch(resubmit, /WHEN raise_exception|MESSAGE_TEXT|split_part/);
assert.match(resubmit, /'invalid_transition','unsupported_isolation'\) THEN v_submit ->> 'kind'\s+ELSE 'state_conflict' END/);
assert.match(resubmit, /EXCEPTION WHEN unique_violation/);
assert.match(resubmit, /phase2c_draft_review_superseded_v1/);
assert.match(resubmit, /'new_review_id', \(v_submit ->> 'review_id'\)::uuid/);
assert.match(resubmit, /'new_snapshot_sha256', v_new_hash/);
assert.match(resubmit, /'kind', 'already_processed'/);
assert.match(resubmit, /'new_event_id', v_new_event\.id/);
assert.doesNotMatch(resubmit, /SET\s+evidence_snapshot\s*=/);
assert.ok(resubmit.indexOf("SET review_status = 'cancelled'") < resubmit.indexOf("v_submit := public.submit_draft_plan_review_v1"));
assert.ok(resubmit.indexOf("v_submit := public.submit_draft_plan_review_v1") < resubmit.indexOf("INSERT INTO public.merchant_compliance_events"));
for (const predicate of [
  /v_new_event\.expected_row_version IS NULL AND v_new_event\.reason_code IS NULL/,
  /v_new_event\.from_state = '\{\}'::jsonb/,
  /v_new_event\.to_state = '\{"review_status":"pending"\}'::jsonb/,
  /v_new_review\.id <> p_old_review_id/,
  /v_old\.row_version IS DISTINCT FROM 2/,
  /v_rmi_event\.metadata IS DISTINCT FROM pg_catalog\.jsonb_build_object/,
]) assert.match(resubmit, predicate);
assert.match(rmi, /JOIN public\.merchant_compliance_reviews replacement/);
assert.match(rmi, /JOIN public\.merchant_compliance_events submitted/);
assert.match(rmi, /successor\.metadata = pg_catalog\.jsonb_build_object/);
for (const command of [rmi,resubmit]) {
  assert.ok(command.indexOf("'kind', 'unsupported_isolation'") < command.indexOf("FROM public.merchants"));
  const locks = [
    command.indexOf("FOR NO KEY UPDATE"),
    command.indexOf("FROM public.merchant_compliance_profiles"),
    command.indexOf("FROM public.merchant_compliance_reviews"),
  ];
  assert.ok(locks[0] < locks[1] && locks[1] < locks[2]);
  assert.doesNotMatch(command, /WHERE idempotency_key = p_idempotency_key/);
}
assert.match(sql, /acl\.grantee NOT IN \(p\.proowner,pg_catalog\.to_regrole\('service_role'\)::oid\)/);
assert.match(sql, /merchant idempotency prerequisite incompatible/);
assert.match(sql, /trigger or table security prerequisite incompatible/);

const runtime = spawnSync("rg", ["-l", "request_draft_plan_review_correction_v1|resubmit_corrected_draft_plan_review_v1", "src"], { encoding: "utf8" });
assert.equal(runtime.status, 1, "B2 must have no runtime caller");
assert.equal(runtime.stdout.trim(), "");
console.log("PASS Phase 2C-2C-B2 non-adopted triage and resubmission source contract");
