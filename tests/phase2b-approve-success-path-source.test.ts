import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(path), "utf8").replace(/\r\n?/g, "\n");
const prior = read("supabase/migrations/20261014000000_phase2b_approve_atomicity_fail_closed.sql");
const success = read("supabase/migrations/20261015000000_phase2b_approve_success_atomic.sql");
const repository = read("src/lib/solo-plus/server/supabase-repository.ts");
const reviewer = read("src/lib/solo-plus/server/review-service.ts");
const orchestration = read("src/lib/solo-plus/orchestration.ts");
const paymentConfirmation = read("supabase/migrations/20260707020000_solo_plus_payment_lifecycle.sql");
const paymentRecovery = read("supabase/migrations/20260718_01_solo_plus_payment_recovery.sql");

function body(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const from = sql.indexOf("AS $$", start) + 5;
  const to = sql.indexOf("$$;", from);
  assert.ok(to > from, `Missing ${name} body end`);
  return sql.slice(from, to);
}
const hash = (text: string) => createHash("md5").update(text).digest("hex");
const oldApprove = body(prior, "review_solo_plus_case_approve_atomic_v1");
const approve = body(success, "review_solo_plus_case_approve_atomic_v1");
const childGuard = body(success, "phase2b_approve_child_version_guard_v1");
const caseGuard = body(success, "phase2b_approve_case_link_guard_v1");
const packageDoc = read("docs/prd-phase-2b-approve-success-path-source-package.md");
const preDdl = success.slice(0, success.indexOf("-- One AFTER STATEMENT trigger"));
assert.equal(hash(oldApprove), "59a78faa12cc7abad8d93637b4a60125");
assert.equal(hash(approve), "5cc81f443c678a15bed43de6df472077");
assert.equal(hash(body(prior, "review_solo_plus_case_v1")), "27710a7819d8413aa8764d8762a6a0ca");
assert.doesNotMatch(success, /CREATE OR REPLACE FUNCTION public\.review_solo_plus_case_v1\(/);
for (const reviewedHash of [hash(approve), hash(childGuard), hash(caseGuard)]) {
  assert.equal((success.match(new RegExp(reviewedHash, "g")) ?? []).length, 2,
    "First-apply/rerun and post-DDL body assertions must agree");
}
assert.match(success, /BEGIN;\s*SET LOCAL search_path = public, pg_temp;/);
assert.match(success, /COMMIT;\s*$/);
assert.equal((success.match(/^DO \$\$$/gm) ?? []).length, 3);
assert.equal((success.match(/^\$\$;$/gm) ?? []).length, 6);
assert.match(success, /59a78faa12cc7abad8d93637b4a60125/);
assert.match(success, /27710a7819d8413aa8764d8762a6a0ca/);
assert.match(success, /solo_plus_case_requirements_unique_case_code[\s\S]*ARRAY\['case_id', 'requirement_code'\]::TEXT\[\]/);
assert.match(success, /idx_solo_plus_case_events_review_request_intent[\s\S]*ARRAY\['request_idempotency_key'\]::TEXT\[\][\s\S]*\$predicate\$/);

const caseLock = approve.indexOf("FROM public.solo_plus_cases\n  WHERE id = p_case_id FOR UPDATE");
const paymentLock = approve.indexOf("FROM public.payment_records\n    WHERE id = v_case.payment_record_id FOR SHARE NOWAIT");
const requirementLock = approve.indexOf("FROM public.solo_plus_case_requirements\n      WHERE case_id = p_case_id AND requirement_code = v_requirement_code\n      FOR SHARE NOWAIT");
const caseWrite = approve.indexOf("UPDATE public.solo_plus_cases");
const eventWrite = approve.indexOf("INSERT INTO public.solo_plus_case_events");
assert.ok(caseLock >= 0 && caseLock < paymentLock && paymentLock < requirementLock);
assert.ok(requirementLock < caseWrite && caseWrite < eventWrite);
assert.equal((approve.match(/UPDATE public\.solo_plus_cases/g) ?? []).length, 1);
assert.equal((approve.match(/INSERT INTO public\.solo_plus_case_events/g) ?? []).length, 1);
assert.match(approve, /row_version::BIGINT <> p_expected_row_version[\s\S]*'version_conflict'/);
assert.match(approve, /case_status <> 'manual_review'/);
assert.match(approve, /payment_status <> 'paid'/);
assert.match(approve, /v_case\.flow_origin NOT IN \('onboarding', 'upgrade'\)/);
assert.match(approve, /v_case\.flow_origin = 'onboarding'[\s\S]*v_case\.onboarding_session_id IS NULL[\s\S]*v_case\.source_plan IS NOT NULL/);
assert.match(approve, /v_case\.flow_origin = 'upgrade'[\s\S]*v_case\.merchant_id IS NULL[\s\S]*v_case\.onboarding_session_id IS NOT NULL[\s\S]*v_case\.source_plan IS DISTINCT FROM 'solo_lite'/);
assert.match(approve, /v_payment\.onboarding_session_id IS DISTINCT FROM v_case\.onboarding_session_id/);
assert.match(approve, /v_payment\.id IS NULL[\s\S]*v_payment\.solo_plus_case_id IS DISTINCT FROM p_case_id[\s\S]*v_payment\.payment_status IS DISTINCT FROM 'successful'[\s\S]*v_payment\.payment_purpose IS DISTINCT FROM/);
assert.match(approve, /v_payment\.onboarding_session_id IS DISTINCT FROM v_case\.onboarding_session_id/);
assert.match(approve, /FOR v_qualifying_payment IN[\s\S]*payment_status = 'successful'[\s\S]*ORDER BY id FOR SHARE NOWAIT/);
assert.match(approve, /v_qualifying_payment\.id IS DISTINCT FROM v_payment\.id[\s\S]*'state_conflict'/);
assert.match(approve, /v_payment_count <> 1[\s\S]*'state_conflict'/);
assert.match(approve, /FOREACH v_requirement_code IN ARRAY ARRAY\[\s*'activity_profile', 'bvn', 'id_document', 'proof_of_address',\s*'selfie_liveness', 'settlement_account'/);
assert.match(approve, /v_requirement\.id IS NULL[\s\S]*v_requirement\.requirement_state IS DISTINCT FROM 'passed'/);
assert.match(approve, /v_requirement_count <> 6[\s\S]*'state_conflict'/);
assert.match(approve, /fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'/);
assert.match(approve, /fixture_run_id' IS DISTINCT FROM p_expected_fixture_run_id/);
assert.match(approve, /SELECT \* INTO v_existing_event[\s\S]*'idempotent_replay'[\s\S]*'idempotency_conflict'[\s\S]*v_case\.row_version::BIGINT <> p_expected_row_version/);
assert.match(approve, /EXCEPTION WHEN unique_violation THEN\s*RETURN jsonb_build_object\('kind', 'idempotency_conflict'/);
assert.match(approve, /row_version = row_version \+ 1[\s\S]*INSERT INTO public\.solo_plus_case_events[\s\S]*'case_approved'/);
assert.doesNotMatch(approve, /activate_solo_plus_case|workspace_subscriptions|INSERT INTO public\.merchants|provider_rpc|settlement_records|refund_records|http_|net_/i);

assert.match(childGuard, /TG_TABLE_NAME NOT IN \('payment_records', 'solo_plus_case_requirements'\)/);
assert.match(childGuard, /TG_LEVEL <> 'STATEMENT'/);
assert.match(packageDoc, /ON CONFLICT DO UPDATE[\s\S]*both statement triggers[\s\S]*version twice/);
assert.match(childGuard, /FOREACH v_case_id IN ARRAY v_case_ids LOOP[\s\S]*FOR UPDATE/);
assert.match(childGuard, /v_case\.case_status = 'approved'[\s\S]*RAISE EXCEPTION/);
assert.match(childGuard, /v_case\.payment_status = 'paid'[\s\S]*case_status IN \('verification_pending', 'manual_review'\)[\s\S]*row_version = row_version \+ 1/);
assert.match(paymentConfirmation, /v_case\.case_status <> 'awaiting_payment' OR v_case\.payment_status <> 'pending'/);
assert.match(paymentConfirmation, /UPDATE public\.payment_records[\s\S]*UPDATE public\.solo_plus_cases[\s\S]*row_version = row_version \+ 1/);
assert.match(paymentRecovery, /v_case\.payment_status IS DISTINCT FROM 'pending'/);
assert.match(paymentRecovery, /UPDATE public\.solo_plus_cases[\s\S]*row_version = row_version \+ 1/);
assert.equal((childGuard.match(/UPDATE public\.solo_plus_cases/g) ?? []).length, 1);
assert.match(childGuard, /ROW\(o\.solo_plus_case_id,[\s\S]*IS DISTINCT FROM ROW\(n\.solo_plus_case_id/);
assert.match(childGuard, /ROW\(o\.case_id, o\.requirement_code,[\s\S]*IS DISTINCT FROM ROW\(n\.case_id/);
assert.match(childGuard, /n\.payment_status = 'successful' AND n\.payment_purpose = 'plan_subscription'/);
assert.match(childGuard, /c\.payment_record_id = n\.id/);
assert.doesNotMatch(childGuard, /c\.onboarding_session_id IN \(v_old_session_id, v_new_session_id\)/);
for (const table of ["payment_records", "solo_plus_case_requirements"]) {
  assert.match(success, new RegExp(`AFTER INSERT ON public\\.${table}\\s+REFERENCING NEW TABLE AS new_rows\\s+FOR EACH STATEMENT`));
  assert.match(success, new RegExp(`AFTER UPDATE ON public\\.${table}\\s+REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows\\s+FOR EACH STATEMENT`));
  assert.match(success, new RegExp(`AFTER DELETE ON public\\.${table}\\s+REFERENCING OLD TABLE AS old_rows\\s+FOR EACH STATEMENT`));
}
assert.match(success, /BEFORE UPDATE ON public\.solo_plus_cases/);
assert.match(caseGuard, /OLD\.payment_record_id IS DISTINCT FROM NEW\.payment_record_id/);
assert.match(caseGuard, /OLD\.payment_status = 'paid'[\s\S]*paid payment relink/);
const protectedStart = caseGuard.indexOf("IF (OLD.payment_status = 'paid'");
const protectedEnd = caseGuard.indexOf("protected payment definition';", protectedStart);
assert.ok(protectedStart > 0 && protectedEnd > protectedStart);
const protectedBlock = caseGuard.slice(protectedStart, protectedEnd);
assert.match(protectedBlock, /OLD\.case_status IN \('verification_pending', 'manual_review', 'approved'\)/);
const protectedFields = ["merchant_id", "flow_origin", "onboarding_session_id",
  "source_plan", "expected_amount", "payment_currency"];
function assertProtectedFields(block: string): void {
  for (const field of protectedFields) {
    const condition = `OLD.${field} IS DISTINCT FROM NEW.${field}`;
    assert.ok(block.includes(condition), `Protected field missing: ${field}`);
  }
}
assertProtectedFields(protectedBlock);
for (const field of protectedFields) {
  const condition = `OLD.${field} IS DISTINCT FROM NEW.${field}`;
  assert.throws(() => assertProtectedFields(protectedBlock.replace(condition, "false")),
    /Protected field missing/);
}
assert.doesNotMatch(protectedBlock, /row_version|rowVersion/);
assert.doesNotMatch(protectedBlock, /NEW\.payment_status|NEW\.case_status/);
assert.ok(protectedEnd < caseGuard.indexOf("version required"),
  "Advancing row_version must not bypass the protected-field rejection");
assert.match(caseGuard, /WHERE id = NEW\.payment_record_id FOR SHARE NOWAIT/);
assert.match(caseGuard, /IF OLD\.payment_record_id IS DISTINCT FROM NEW\.payment_record_id\s+OR \(NEW\.payment_status = 'paid' AND OLD\.payment_status IS DISTINCT FROM 'paid'\) THEN[\s\S]*WHERE id = NEW\.payment_record_id FOR SHARE NOWAIT/);
assert.match(caseGuard, /OLD\.payment_record_id IS DISTINCT FROM NEW\.payment_record_id[\s\S]*OLD\.payment_status = 'paid'[\s\S]*OLD\.case_status IN \('verification_pending', 'manual_review', 'approved'\)/);
assert.match(caseGuard, /NEW\.flow_origin = 'onboarding'[\s\S]*NEW\.onboarding_session_id IS NULL/);
assert.match(caseGuard, /NEW\.flow_origin = 'upgrade'[\s\S]*NEW\.merchant_id IS NULL[\s\S]*NEW\.onboarding_session_id IS NOT NULL/);
assert.match(caseGuard, /v_payment\.solo_plus_case_id IS DISTINCT FROM NEW\.id/);
assert.match(caseGuard, /v_payment\.merchant_id IS DISTINCT FROM NEW\.merchant_id/);
assert.match(caseGuard, /v_payment\.payment_purpose IS DISTINCT FROM/);
assert.match(caseGuard, /v_payment\.onboarding_session_id IS DISTINCT FROM NEW\.onboarding_session_id/);
assert.match(caseGuard, /v_duplicate_count <> 1/);
assert.match(caseGuard, /OLD\.case_status = 'approved'[\s\S]*approved eligibility/);
assert.match(caseGuard, /v_eligibility_changed AND NEW\.row_version <= OLD\.row_version/);
assert.match(preDdl, /pg_catalog\.format_type\(a\.atttypid, a\.atttypmod\) IS DISTINCT FROM e\.type_name/);
assert.match(preDdl, /\('solo_plus_cases', 'source_plan', 'text', false\)/);
assert.match(preDdl, /to_regrole\('anon'\) IS NULL OR to_regrole\('authenticated'\) IS NULL/);
assert.match(preDdl, /pg_catalog\.pg_get_expr\(d\.adbin, d\.adrelid, false\) = 'gen_random_uuid\(\)'/);
assert.match(preDdl, /c\.confrelid IS DISTINCT FROM format\('public\.%I', e\.target_table\)::regclass/);
assert.match(preDdl, /c\.confupdtype::TEXT <> 'a' OR c\.confdeltype::TEXT <> e\.delete_action/);
assert.match(preDdl, /c\.contype::TEXT <> e\.constraint_type/);
assert.match(preDdl, /acl\.privilege_type IN \('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'\)/);
assert.match(preDdl, /p\.polroles IS DISTINCT FROM ARRAY\[0\]::OID\[\]/);
assert.match(preDdl, /p\.polcmd <> 'r' OR p\.polpermissive IS NOT TRUE/);
assert.match(preDdl, /p\.polwithcheck IS NOT NULL/);
assert.match(preDdl, /pg_catalog\.regexp_matches\([\s\S]*\$quoted\$/);
assert.match(preDdl, /'\[\[:space:\]\]\+', ' ', 'g'[\s\S]*'\[\(\]\[\[:space:\]\]\+'/);
assert.match(preDdl, /policy role or expression drift/);
const flowGuardStart = preDdl.indexOf("WITH expected(constraint_name, check_expression)");
const flowGuardEnd = preDdl.indexOf("flow CHECK expression drift", flowGuardStart);
assert.ok(flowGuardStart > 0 && flowGuardEnd > flowGuardStart);
const flowGuard = preDdl.slice(flowGuardStart, flowGuardEnd);
assert.match(flowGuard, /solo_plus_cases_flow_origin_check/);
assert.match(flowGuard, /solo_plus_cases_flow_ownership_chk/);
assert.match(flowGuard, /flow_origin = ANY \(ARRAY\['onboarding'::text, 'upgrade'::text\]\)/);
assert.match(flowGuard, /onboarding_session_id IS NOT NULL/);
assert.match(flowGuard, /source_plan IS NULL/);
assert.match(flowGuard, /merchant_id IS NOT NULL/);
assert.match(flowGuard, /onboarding_session_id IS NULL/);
assert.match(flowGuard, /source_plan = 'solo_lite'::text/);
assert.match(flowGuard, /c\.contype <> 'c' OR c\.convalidated IS NOT TRUE/);
assert.match(flowGuard, /pg_catalog\.pg_get_expr\(c\.conbin, c\.conrelid, false\)/);
assert.match(flowGuard, /pg_catalog\.regexp_matches\([\s\S]*\$quoted\$/);
assert.match(flowGuard, /IS DISTINCT FROM pg_catalog\.regexp_replace\(/);
assert.match(flowGuard, /btrim\(e\.check_expression\)/);
const flowOwnership = "(((flow_origin = 'onboarding'::text) AND (onboarding_session_id IS NOT NULL) AND (source_plan IS NULL)) OR ((flow_origin = 'upgrade'::text) AND (merchant_id IS NOT NULL) AND (onboarding_session_id IS NULL) AND (source_plan = 'solo_lite'::text)))";
assert.ok(flowGuard.includes(flowOwnership));
const canonicalCheck = (value: string) => value.trim().replace(/\s+/g, " ")
  .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
const quoted = (value: string) => value.match(/'([^']|'')*'/g) ?? [];
const sameGuardedCheck = (actual: string, expected: string) =>
  canonicalCheck(actual) === canonicalCheck(expected)
  && JSON.stringify(quoted(actual)) === JSON.stringify(quoted(expected));
assert.ok(sameGuardedCheck(flowOwnership,
  flowOwnership.replace("((flow_origin", "(( flow_origin").replace("(source_plan IS NULL))", "(source_plan IS NULL) )")));
for (const drift of [
  flowOwnership.replace("onboarding_session_id IS NOT NULL", "onboarding_session_id IS NULL"),
  flowOwnership.replace("merchant_id IS NOT NULL", "merchant_id IS NULL"),
  flowOwnership.replace("source_plan IS NULL", "source_plan IS NOT NULL"),
  flowOwnership.replace(" AND ", " OR "),
  flowOwnership.replace("'solo_lite'", "'solo lite'"),
]) assert.equal(sameGuardedCheck(flowOwnership, drift), false);
assert.match(preDdl, /t\.tgoldtable::TEXT IS NOT DISTINCT FROM expected\.old_table/);
assert.match(preDdl, /t\.tgnewtable::TEXT IS NOT DISTINCT FROM expected\.new_table/);
const canonicalPolicy = (value: string) => value.trim().replace(/\s+/g, " ")
  .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
const expectedPolicy = "EXISTS (SELECT 1 FROM merchants m WHERE (m.id = payment_records.merchant_id) AND (m.user_id = auth.uid()))";
assert.equal(canonicalPolicy(expectedPolicy), canonicalPolicy(
  "EXISTS ( SELECT 1 FROM merchants m WHERE (m.id = payment_records.merchant_id) AND (m.user_id = auth.uid()) )",
));
for (const drift of [
  expectedPolicy.replace("auth.uid()", "auth.role()"),
  expectedPolicy.replace("merchant_id", "id"),
  expectedPolicy.replace(" AND ", " OR "),
]) {
  assert.notEqual(canonicalPolicy(expectedPolicy), canonicalPolicy(drift));
}
assert.notEqual("'team active'", "'team  active'", "Quoted SQL literals remain exact");
assert.match(success, /SECURITY DEFINER\s*SET search_path = public, pg_temp/);
assert.match(success, /REVOKE ALL ON FUNCTION public\.phase2b_approve_child_version_guard_v1\(\)/);
assert.match(success, /GRANT EXECUTE ON FUNCTION public\.review_solo_plus_case_approve_atomic_v1\([\s\S]*TO service_role/);

assert.match(repository, /reviewDecision === "approve" \? REVIEW_APPROVE_ATOMIC_RPC : REVIEW_CASE_RPC/);
assert.match(repository, /p_expected_fixture_run_id: input\.expectedFixtureRunId/);
assert.doesNotMatch(repository, /writer protocol is not released/);
assert.match(reviewer, /latestDecision\?\.eventType === "case_approved"[\s\S]*latestDecision\.requestIdempotencyKey === input\.requestIdempotencyKey/);
const approveOrchestration = orchestration.slice(orchestration.indexOf("async approveSoloPlusCase("));
assert.match(approveOrchestration, /currentCase\.rowVersion !== expectedRowVersion[\s\S]*SOLO_PLUS_CASE_VERSION_CONFLICT/);
assert.match(approveOrchestration, /if \(currentCase\.caseStatus !== "approved"\) \{[\s\S]*repository\.listRequirements\(caseId\)/);
console.log("phase2b-approve-success-path-source.test.ts passed (static only; no SQL executed)");
