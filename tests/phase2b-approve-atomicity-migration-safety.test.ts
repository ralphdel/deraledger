import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(path), "utf8");
const baseline = read("supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql");
const cutover = read("supabase/migrations/20261014000000_phase2b_approve_atomicity_fail_closed.sql");
const firstDdl = cutover.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1(");
const preDdl = cutover.slice(0, firstDdl);
const postDdl = cutover.slice(cutover.indexOf("DO $$", cutover.indexOf("GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_approve_atomic_v1(")));
assert.match(preDdl, /\nBEGIN;\s+SET LOCAL search_path = public, pg_temp;/);

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const bodyStart = sql.indexOf("AS $$", start) + "AS $$".length;
  const bodyEnd = sql.indexOf("$$;", bodyStart);
  assert.ok(bodyEnd > bodyStart, `Missing body end for ${name}`);
  return sql.slice(bodyStart, bodyEnd).replace(/\r\n?/g, "\n");
}

function hash(body: string): string {
  return createHash("md5").update(body).digest("hex");
}

const baselineHash = hash(functionBody(baseline, "review_solo_plus_case_v1"));
const closedHash = hash(functionBody(cutover, "review_solo_plus_case_v1"));
const atomicHash = hash(functionBody(cutover, "review_solo_plus_case_approve_atomic_v1"));
assert.equal(baselineHash, "57fa7f166f81f24cb3ec077acc3449eb");
assert.equal(closedHash, "27710a7819d8413aa8764d8762a6a0ca");
assert.equal(atomicHash, "59a78faa12cc7abad8d93637b4a60125");
const overloadCase = /<> \(CASE WHEN v_new_oid IS NULL THEN 0 ELSE 1 END\) THEN/;
const paymentPurposeCase = /v_payment\.payment_purpose IS DISTINCT FROM\s+\(CASE WHEN v_case\.flow_origin = 'upgrade' THEN 'plan_upgrade' ELSE 'plan_subscription' END\)\s+OR/;
function assertParenthesizedIfCases(sql: string): void {
  assert.match(sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1(")),
    overloadCase, "Pre-DDL IF must keep the CASE expression parenthesized");
  assert.match(functionBody(sql, "review_solo_plus_case_approve_atomic_v1"),
    paymentPurposeCase, "Approve RPC IF must keep the CASE expression parenthesized");
}
assertParenthesizedIfCases(cutover);
for (const malformed of [
  cutover.replace("<> (CASE WHEN v_new_oid IS NULL THEN 0 ELSE 1 END) THEN",
    "<> CASE WHEN v_new_oid IS NULL THEN 0 ELSE 1 END THEN"),
  cutover.replace("(CASE WHEN v_case.flow_origin = 'upgrade' THEN 'plan_upgrade' ELSE 'plan_subscription' END)",
    "CASE WHEN v_case.flow_origin = 'upgrade' THEN 'plan_upgrade' ELSE 'plan_subscription' END"),
]) {
  assert.throws(() => assertParenthesizedIfCases(malformed),
    "An unparenthesized CASE inside IF must fail the static contract");
}
const preDdlDoBody = preDdl.slice(preDdl.indexOf("DO $$") + "DO $$".length, preDdl.lastIndexOf("$$;"));
assert.match(preDdl, /END IF;\s*END;\s*\$\$;\s*$/);
assert.equal((preDdlDoBody.match(/^\s*IF\b/gm) ?? []).length,
  (preDdlDoBody.match(/^\s*END IF;/gm) ?? []).length,
  "Pre-DDL DO block must balance IF and END IF statements");
assert.equal((cutover.match(/^DO \$\$$/gm) ?? []).length, 2);
assert.equal((cutover.match(/^\$\$;$/gm) ?? []).length, 4);
for (const expectedHash of [baselineHash, closedHash, atomicHash]) {
  assert.ok(preDdl.includes(expectedHash), `Pre-DDL body guard missing ${expectedHash}`);
}
assert.ok(postDdl.includes(closedHash));
assert.ok(postDdl.includes(atomicHash));
assert.notEqual(
  hash(functionBody(cutover, "review_solo_plus_case_v1").replace("IF v_decision = 'approve' THEN", "IF v_decision = 'reject' THEN")),
  closedHash,
  "A hostile branch edit must change the reviewed function-body digest",
);

const catalogContracts = [
  "pg_catalog.pg_proc", "p.proname = 'review_solo_plus_case_v1'",
  "p.proname = 'review_solo_plus_case_approve_atomic_v1'",
  "v_old.proargnames", "v_old.pronargdefaults", "v_old.proowner",
  "v_old.prosecdef", "v_old.proconfig", "aclexplode",
  "pg_catalog.pg_attribute", "pg_catalog.format_type", "a.attnotnull",
  "pg_catalog.pg_constraint", "c.convalidated", "pg_catalog.pg_index",
  "i.indisunique", "pg_catalog.pg_trigger", "t.tgtype <> 19",
  "pg_catalog.pg_policy", "c.relrowsecurity", "c.relforcerowsecurity",
  "solo_plus_case_requirements_unique_case_code",
  "idx_solo_plus_case_events_review_request_intent",
  "Phase 2B approve atomicity blocked: reviewed v1 function drift",
  "Phase 2B approve atomicity blocked: RPC grant drift",
] as const;
function hasPreDdlContract(text: string): boolean {
  return catalogContracts.every((contract) => text.includes(contract));
}
assert.ok(hasPreDdlContract(preDdl));
assert.doesNotMatch(preDdl, /CREATE OR REPLACE FUNCTION public\.review_solo_plus_case/);
const exactDefaultGuard = /v_old\.pronargdefaults <> 2\s+OR pg_catalog\.pg_get_expr\(v_old\.proargdefaults, 0\) IS DISTINCT FROM\s+'NULL::text, NULL::text'/;
assert.match(preDdl, exactDefaultGuard);
for (const weakenedDefaultGuard of [
  preDdl.replace("pg_catalog.pg_get_expr(v_old.proargdefaults, 0)", "NULL::text"),
  preDdl.replace("'NULL::text, NULL::text'", "'NULL::text, TRUE'"),
  preDdl.replace("IS DISTINCT FROM\n        'NULL::text, NULL::text'", "IS NOT DISTINCT FROM\n        'NULL::text, NULL::text'"),
]) {
  assert.doesNotMatch(weakenedDefaultGuard, exactDefaultGuard, "A weakened v1 default-expression guard must fail");
}
for (const hostileRemoval of [
  "v_old.proowner", "v_old.prosecdef", "v_old.proconfig", "aclexplode",
  "pg_catalog.pg_attribute", "pg_catalog.pg_constraint", "pg_catalog.pg_trigger",
  "pg_catalog.pg_policy", "c.relrowsecurity", "i.indisunique",
]) {
  assert.equal(
    hasPreDdlContract(preDdl.replaceAll(hostileRemoval, "")),
    false,
    `Static hostile-drift probe must detect a removed ${hostileRemoval} check`,
  );
}

// These contracts inspect complete comparisons in their own guard blocks.
// Mutating a same-name object's role, expression, key, target, or action must
// make the static source contract fail. PostgreSQL behavior still needs the
// separately planned disposable first-apply and hostile-drift tests.
function guardBlock(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  assert.ok(startAt >= 0, `Missing semantic guard start: ${start}`);
  const endAt = source.indexOf(end, startAt);
  assert.ok(endAt > startAt, `Missing semantic guard end: ${end}`);
  return source.slice(startAt, endAt);
}

function assertSemanticGuards(source: string): void {
  const policy = guardBlock(source, "-- Compare complete policy expressions", "RAISE EXCEPTION 'Phase 2B approve atomicity blocked: policy role or expression drift'");
  const keys = guardBlock(source, "-- Same-name constraints", "RAISE EXCEPTION 'Phase 2B approve atomicity blocked: key or foreign-key semantic drift'");
  const checks = guardBlock(source, "IF NOT EXISTS (\n    SELECT 1 FROM pg_catalog.pg_constraint c\n    WHERE c.conrelid = 'public.solo_plus_cases'", "RAISE EXCEPTION 'Phase 2B approve atomicity blocked: check constraint expression drift'");
  const index = guardBlock(source, "IF NOT EXISTS (\n    SELECT 1 FROM pg_catalog.pg_index i\n    JOIN pg_catalog.pg_class ix", "RAISE EXCEPTION 'Phase 2B approve atomicity blocked: review intent index semantic drift'");
  const contracts: Record<string, readonly string[]> = {
    policy: [
      "p.polroles IS DISTINCT FROM ARRAY[0]::OID[]",
      "pg_catalog.pg_get_expr(p.polqual, p.polrelid, false)",
      "IS DISTINCT FROM e.using_expression",
      "p.polwithcheck IS NOT NULL",
      "('solo_plus_cases', 'merchant_read_solo_plus_cases'",
      "('solo_plus_case_requirements', 'merchant_read_solo_plus_case_requirements'",
      "('payment_records', 'merchant_read_payment_records', v_expected_payment_policy)",
      "$policy$((auth.role() = 'authenticated'::text) AND (merchant_id IS NOT NULL) AND (EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = solo_plus_cases.merchant_id) AND (m.user_id = auth.uid())))))$policy$",
      "$policy$((auth.role() = 'authenticated'::text) AND (EXISTS (SELECT 1 FROM (solo_plus_cases c JOIN merchants m ON ((m.id = c.merchant_id))) WHERE ((c.id = solo_plus_case_requirements.case_id) AND (m.user_id = auth.uid())))))$policy$",
      "WHEN to_regclass('public.merchant_team') IS NULL THEN",
      "payment_records.merchant_id) AND (m.user_id = auth.uid())",
      "(SELECT count(*) FROM pg_catalog.pg_policy p",
    ],
    keys: [
      "c.confrelid IS DISTINCT FROM format('public.%I', e.target_table)::regclass",
      "c.confupdtype::TEXT <> 'a' OR c.confdeltype::TEXT <> e.delete_action",
      "c.confmatchtype::TEXT <> 's' OR c.condeferrable OR c.condeferred",
      "unnest(c.conkey) WITH ORDINALITY",
      "unnest(c.confkey) WITH ORDINALITY",
      "IS DISTINCT FROM e.local_columns",
      "IS DISTINCT FROM e.target_columns",
      "('solo_plus_cases', 'solo_plus_cases_payment_record_id_fkey'",
      "ARRAY['payment_record_id']::TEXT[], 'payment_records', ARRAY['id']::TEXT[], 'n'",
      "ARRAY['case_id']::TEXT[], 'solo_plus_cases', ARRAY['id']::TEXT[], 'c'",
      "ARRAY['case_id']::TEXT[], 'solo_plus_cases', ARRAY['id']::TEXT[], 'r'",
      "i.indisunique IS NOT TRUE",
      "i.indpred IS NOT NULL OR i.indexprs IS NOT NULL",
      "IS DISTINCT FROM e.key_columns",
    ],
    checks: [
      "pg_catalog.pg_get_expr(c.conbin, c.conrelid, false)",
      "c.conname = 'solo_plus_cases_case_status_check'",
      "= $check$(case_status = ANY (ARRAY['draft'::text, 'awaiting_payment'::text, 'verification_pending'::text, 'manual_review'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]))$check$",
      "= $check$((case_status <> 'approved'::text) OR ((payment_status = 'paid'::text) AND (approved_at IS NOT NULL) AND (approved_by_admin_id IS NOT NULL) AND (refund_status = 'none'::text)))$check$",
      "= $check$((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'successful'::character varying, 'failed'::character varying, 'abandoned'::character varying, 'reversed'::character varying, 'refunded'::character varying])::text[]))$check$",
      "c.conname = 'solo_plus_case_requirements_requirement_code_check'",
      "= $check$(requirement_code = ANY (ARRAY['bvn'::text, 'selfie_liveness'::text, 'id_document'::text, 'proof_of_address'::text, 'settlement_account'::text, 'activity_profile'::text]))$check$",
      "c.conname = 'solo_plus_case_requirements_requirement_state_check'",
      "= $check$(requirement_state = ANY (ARRAY['not_started'::text, 'pending'::text, 'processing'::text, 'passed'::text, 'failed'::text, 'needs_review'::text, 'reused'::text, 'waived'::text]))$check$",
    ],
    index: [
      "am.amname = 'btree' AND i.indisunique AND i.indisvalid",
      "i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indexprs IS NULL",
      "key_opclass.oid = i.indclass[0]",
      "key_collation.oid = i.indcollation[0]",
      "key_collation.collname = 'default'",
      "key_attribute.attcollation = key_collation.oid",
      "key_opclass.opcname = 'text_ops' AND key_opclass.opcdefault",
      "key_opclass.opcintype = 'text'::regtype",
      "key_opclass.opcmethod = ix.relam",
      "unnest(i.indkey::SMALLINT[]) WITH ORDINALITY",
      "ARRAY['request_idempotency_key']::TEXT[]",
      "pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)",
      "= $predicate$((request_idempotency_key IS NOT NULL) AND (event_type = ANY (ARRAY['case_review_requested_more_information'::text, 'case_approved'::text, 'case_rejected'::text, 'case_reopened'::text])))$predicate$",
    ],
  };
  for (const [name, block] of Object.entries({ policy, keys, checks, index })) {
    for (const clause of contracts[name]) {
      assert.ok(block.includes(clause), `${name} guard lost exact semantic clause: ${clause}`);
    }
  }
}

assertSemanticGuards(preDdl);
for (const [name, original, hostile] of [
  ["policy role", "p.polroles IS DISTINCT FROM ARRAY[0]::OID[]", "p.polroles IS NULL"],
  ["policy USING", "IS DISTINCT FROM e.using_expression", "IS NOT DISTINCT FROM e.using_expression"],
  ["policy owner expression", "m.id = solo_plus_cases.merchant_id", "m.id = solo_plus_cases.id"],
  ["policy requirement expression", "c.id = solo_plus_case_requirements.case_id", "c.id = solo_plus_case_requirements.id"],
  ["policy WITH CHECK", "p.polwithcheck IS NOT NULL", "p.polwithcheck IS NULL"],
  ["check expression", "case_status <> 'approved'::text", "case_status <> 'rejected'::text"],
  ["case-status expression", "'manual_review'::text, 'approved'::text, 'rejected'::text", "'manual_review'::text, 'cancelled'::text, 'rejected'::text"],
  ["requirement-code expression", "'settlement_account'::text, 'activity_profile'::text", "'settlement_account'::text, 'unreviewed'::text"],
  ["requirement-state expression", "'processing'::text, 'passed'::text, 'failed'::text", "'processing'::text, 'waived'::text, 'failed'::text"],
  ["FK target", "c.confrelid IS DISTINCT FROM format('public.%I', e.target_table)::regclass", "c.confrelid IS NULL"],
  ["FK columns", "IS DISTINCT FROM e.target_columns", "IS NOT DISTINCT FROM e.target_columns"],
  ["FK target table", "ARRAY['payment_record_id']::TEXT[], 'payment_records', ARRAY['id']::TEXT[], 'n'", "ARRAY['payment_record_id']::TEXT[], 'merchants', ARRAY['id']::TEXT[], 'n'"],
  ["FK actions", "c.confupdtype::TEXT <> 'a' OR c.confdeltype::TEXT <> e.delete_action", "c.confdeltype IS NOT NULL"],
  ["index keys", "unnest(i.indkey::SMALLINT[]) WITH ORDINALITY", "unnest(i.indkey::SMALLINT[])"],
  ["index key identity", "ARRAY['request_idempotency_key']::TEXT[]", "ARRAY['event_type']::TEXT[]"],
  ["index collation", "key_collation.collname = 'default'", "key_collation.collname = 'C'"],
  ["index operator class", "key_opclass.opcname = 'text_ops' AND key_opclass.opcdefault", "key_opclass.opcname = 'text_pattern_ops'"],
  ["index predicate", "event_type = ANY (ARRAY['case_review_requested_more_information'::text", "event_type = ANY (ARRAY['case_reopened'::text"],
] as const) {
  assert.ok(preDdl.includes(original), `Missing ${name} hostile probe source`);
  assert.throws(
    () => assertSemanticGuards(preDdl.replace(original, hostile)),
    `${name} hostile source drift must fail the static contract`,
  );
}

assert.match(postDdl, /verification failed: RPC body or security/);
assert.match(postDdl, /v_rpc\.prosecdef[\s\S]*v_rpc\.proconfig[\s\S]*aclexplode/);
assert.match(cutover, /REVOKE ALL ON FUNCTION public\.review_solo_plus_case_approve_atomic_v1\([\s\S]*FROM PUBLIC, anon, authenticated;/);
assert.match(cutover, /GRANT EXECUTE ON FUNCTION public\.review_solo_plus_case_approve_atomic_v1\([\s\S]*TO service_role;/);

console.log("phase2b-approve-atomicity-migration-safety.test.ts passed (static only; no SQL executed)");
