import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SOLO_PLUS_REVIEW_REASON_MAX_LENGTH } from "../src/lib/solo-plus/review-action-contract";

const migrationPath =
  "supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql";
const sql = readFileSync(migrationPath, "utf8");

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

const normalized = compact(sql);
const expectedReviewEventTypes = [
  "case_review_requested_more_information",
  "case_approved",
  "case_rejected",
  "case_reopened",
].sort();

function extractIndexStatement(indexName: string) {
  const match = normalized.match(
    new RegExp(`CREATE UNIQUE INDEX(?: IF NOT EXISTS)? ${indexName} [^;]+;`, "i"),
  );
  assert.ok(match, `${indexName} definition must exist`);
  return match[0];
}

function extractReviewEventTypes(statement: string) {
  return [...statement.matchAll(/'(case_[a-z_]+)'/g)]
    .map((match) => match[1])
    .sort();
}

assert.match(normalized, /CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_case_events_review_request_intent ON public\.solo_plus_case_events \(request_idempotency_key\)/i);
assert.match(normalized, /WHERE request_idempotency_key IS NOT NULL AND event_type IN \(/i);
assert.match(normalized, /FROM public\.solo_plus_case_events WHERE request_idempotency_key = p_request_idempotency_key AND event_type IN \(/i);

const expectedShapeIndex = extractIndexStatement(
  "phase2b_review_intent_index_expected_shape_idx",
);
const persistentIntentIndex = extractIndexStatement(
  "idx_solo_plus_case_events_review_request_intent",
);
assert.deepEqual(extractReviewEventTypes(expectedShapeIndex), expectedReviewEventTypes);
assert.deepEqual(extractReviewEventTypes(persistentIntentIndex), expectedReviewEventTypes);
assert.match(expectedShapeIndex, /ON phase2b_review_intent_index_expected_shape \(request_idempotency_key\)/i);
assert.match(expectedShapeIndex, /request_idempotency_key IS NOT NULL/i);
assert.match(persistentIntentIndex, /ON public\.solo_plus_case_events \(request_idempotency_key\)/i);
assert.match(persistentIntentIndex, /request_idempotency_key IS NOT NULL/i);

const preCompatibilityGuard = normalized.indexOf(
  "pg_temp.assert_phase2b_review_intent_index(false)",
);
const persistentIndexCreation = normalized.indexOf(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_case_events_review_request_intent",
);
const postflightGuard = normalized.indexOf(
  "pg_temp.assert_phase2b_review_intent_index(true)",
);
assert.ok(preCompatibilityGuard >= 0);
assert.ok(preCompatibilityGuard < persistentIndexCreation);
assert.ok(postflightGuard > persistentIndexCreation);

for (const exactCatalogCheck of [
  "v_table_schema <> 'public'",
  "v_table_name <> 'solo_plus_case_events'",
  "v_is_unique IS NOT TRUE",
  "v_is_valid IS NOT TRUE",
  "v_is_ready IS NOT TRUE",
  "v_is_live IS NOT TRUE",
  "v_access_method <> 'btree'",
  "v_key_count <> 1",
  "v_attribute_count <> 1",
  "v_has_no_expressions IS NOT TRUE",
  "v_key_columns IS DISTINCT FROM ARRAY['request_idempotency_key']::TEXT[]",
  "v_actual_predicate IS DISTINCT FROM v_expected_predicate",
]) {
  assert.equal(normalized.includes(exactCatalogCheck), true, exactCatalogCheck);
}
assert.match(normalized, /incompatible review intent index definition/i);
assert.doesNotMatch(normalized, /FROM pg_indexes/i);
assert.doesNotMatch(normalized, /indexdef ILIKE/i);

for (const intentComparison of [
  "v_existing_event.case_id = p_case_id",
  "v_existing_event.event_type = v_event_type",
  "v_existing_event.actor_id IS NOT DISTINCT FROM p_reviewer_admin_id",
  "v_existing_event.reason IS NOT DISTINCT FROM v_reason",
  "v_existing_event.policy_version = v_effective_policy_version",
  "v_existing_event.previous_state ->> 'rowVersion' = p_expected_row_version::text",
]) {
  assert.equal(normalized.includes(intentComparison), true, intentComparison);
}

assert.equal(SOLO_PLUS_REVIEW_REASON_MAX_LENGTH, 1_000);
assert.equal(
  normalized.includes(`char_length(v_reason) > ${SOLO_PLUS_REVIEW_REASON_MAX_LENGTH}`),
  true,
);
assert.match(normalized, /IF v_decision = 'approve' THEN/i);
assert.match(normalized, /v_case\.payment_status <> 'paid'/i);
assert.match(normalized, /v_case\.payment_record_id IS NULL/i);
assert.match(normalized, /v_requirement_count <> 6/i);
assert.match(normalized, /v_satisfied_requirement_count <> 6/i);
assert.match(normalized, /p\.solo_plus_case_id = p_case_id/i);
assert.match(normalized, /p\.payment_status = 'successful'/i);

assert.doesNotMatch(normalized, /activate_solo_plus_case_v1\s*\(/i);
assert.doesNotMatch(normalized, /UPDATE public\.merchants/i);
assert.doesNotMatch(normalized, /UPDATE public\.workspaces/i);
assert.doesNotMatch(normalized, /INSERT INTO public\.payment_records/i);
assert.doesNotMatch(normalized, /UPDATE public\.payment_records/i);

assert.match(normalized, /REVOKE ALL ON FUNCTION public\.review_solo_plus_case_v1[\s\S]*FROM PUBLIC, anon, authenticated/i);
assert.match(normalized, /GRANT EXECUTE ON FUNCTION public\.review_solo_plus_case_v1[\s\S]*TO service_role/i);

console.log("solo-plus-review-action-hardening-migration.test.ts passed");
