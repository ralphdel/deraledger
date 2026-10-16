import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(path), "utf8");
const plan = read("docs/prd-phase-2b-approve-atomicity-hardening-source-package.md");
const racePlan = read("docs/prd-phase-2b-approve-disposable-postgres-race-plan.md");
const design = read("docs/prd-phase-2b-approve-paid-fixture-and-atomicity-design.md");
const runbook = read("docs/prd-phase-2b-admin-ui-staging-approve-acceptance-runbook.md");
const reviewRpc = read("supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql");
const cutover = read("supabase/migrations/20261014000000_phase2b_approve_atomicity_fail_closed.sql");
const paymentConfirmation = read("supabase/migrations/20260707020000_solo_plus_payment_lifecycle.sql");
const paymentRecovery = read("supabase/migrations/20260718_01_solo_plus_payment_recovery.sql");
const requirementRepository = read("src/lib/solo-plus/server/supabase-repository.ts");
const requirementService = read("src/lib/solo-plus/server/requirements.ts");
const reviewerService = read("src/lib/solo-plus/server/review-service.ts");
const orchestration = read("src/lib/solo-plus/orchestration.ts");
const normalized = plan.replace(/\s+/g, " ");
assert.match(plan, /does not detect a second linked successful payment row/);
assert.match(runbook, /does not yet prove there is no second linked successful payment row/);
assert.match(racePlan, /duplicate-payment case returning[\s\S]*does not prove duplicate detection/);

for (const required of [
  "fail-closed migration and source package",
  "Approve fixture planning, fixture creation",
  "no expected run ID",
  "forward-only migration",
  "early `state_conflict` for approve",
  "review_solo_plus_case_approve_atomic_v1",
  "plus the exact expected fixture run ID",
  "not a browser-supplied value",
  "case → linked payment → requirements by canonical code",
  "lock all six requirement rows in canonical code order",
  "Lock the case's non-null `payment_record_id` row",
  "`NOWAIT`/lock-conflict",
  "never automatically retry an approve decision",
  "expected case version",
  "direct `.upsert` must be replaced",
  "non-locking lookup, lock the case, then lock and re-read",
  "shared `payment_records` table",
  "could deadlock",
  "No existing migration is edited",
  "two controlled sessions",
  "do **not** prove migration validity",
  "separate approve-only fixture procedure",
]) {
  assert.ok(normalized.toLowerCase().includes(required.toLowerCase()), `Missing atomicity design contract: ${required}`);
}
assert.match(design, /seven-argument review RPC for RMI\/reject while making its old\s+approve branch fail closed/);
assert.match(design, /exact fixture run ID is not among those\s+seven arguments/);
assert.match(runbook, /forward-only atomicity source package/);
assert.match(runbook, /Approve fixture planning remains blocked/);
assert.match(runbook, /disposable-database\s+race tests/);

// These are current-source blocker assertions. They intentionally do not
// mistake a proposed RPC or a simulated race test for deployed SQL safety.
const signature = reviewRpc.slice(
  reviewRpc.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1("),
  reviewRpc.indexOf("RETURNS JSONB", reviewRpc.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1(")),
);
assert.doesNotMatch(signature, /run_id|fixture_scope/i);
const approveBranch = reviewRpc.slice(
  reviewRpc.indexOf("IF v_decision = 'approve' THEN", reviewRpc.indexOf("FOR UPDATE;")),
  reviewRpc.indexOf("v_target_refund_status := CASE"),
);
assert.match(approveBranch, /v_case\.payment_status <> 'paid'/);
assert.match(approveBranch, /v_case\.payment_record_id IS NULL/);
assert.match(approveBranch, /v_requirement_count <> 6/);
assert.match(approveBranch, /v_satisfied_requirement_count <> 6/);
assert.match(approveBranch, /p\.payment_status = 'successful'/);
assert.doesNotMatch(approveBranch, /FOR (?:UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)/i);
assert.match(reviewerService, /scopedCase\.auditMetadata\.fixture_run_id !== reviewActionScope\.runId/);
assert.match(reviewerService, /scopedCase\.auditMetadata\.fixture_scope !== expectedFixtureScope/);
assert.match(reviewerService, /scopedCase\.auditMetadata\.synthetic_approve_acceptance === true/);
assert.match(requirementService, /repository\.upsertCaseRequirements\(/);
const directWriter = requirementRepository.slice(requirementRepository.indexOf("async upsertCaseRequirements("));
assert.match(directWriter, /\.from\("solo_plus_case_requirements"\)\s*\.upsert\(/);
assert.doesNotMatch(directWriter, /expectedRowVersion|row_version/);
for (const [paymentWriter, functionName] of [
  [paymentConfirmation, "confirm_solo_plus_payment_v1"],
  [paymentRecovery, "recover_solo_plus_payment_attempt_v1"],
] as const) {
  const paymentLock = paymentWriter.indexOf("FROM public.payment_records", paymentWriter.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}(`));
  const caseLock = paymentWriter.indexOf("FROM public.solo_plus_cases", paymentLock);
  assert.ok(paymentLock >= 0 && caseLock > paymentLock, "Payment writer is payment-first today");
}
const approveMethod = orchestration.slice(
  orchestration.indexOf("async approveSoloPlusCase("),
  orchestration.indexOf("async rejectSoloPlusCase("),
);
assert.match(approveMethod, /repository\.transitionCaseStatus\(/);
assert.doesNotMatch(approveMethod, /activateSoloPlusCase|activate_solo_plus_case_v1|workspace_subscriptions|UPDATE public\.merchants/);
assert.doesNotMatch(reviewRpc.slice(reviewRpc.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1(")), /activate_solo_plus_case_v1\(/);

const oldCutover = cutover.slice(
  cutover.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1("),
  cutover.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_approve_atomic_v1("),
);
const originalStart = reviewRpc.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1(");
const originalFunction = reviewRpc.slice(originalStart, reviewRpc.indexOf("\n$$;", originalStart) + 4);
const cutoverFunction = oldCutover.slice(0, oldCutover.indexOf("\n$$;") + 4);
const withoutGuard = cutoverFunction.replace(
  /\n  -- The seven-argument RPC has no trusted fixture run ID\. It must not approve\.\n  IF v_decision = 'approve' THEN\n    RETURN jsonb_build_object\('kind', 'state_conflict', 'case', to_jsonb\(v_case\)\);\n  END IF;\n/,
  "",
);
assert.equal(withoutGuard, originalFunction, "Legacy RMI/reject/reopen RPC body must remain unchanged");
assert.ok(oldCutover.indexOf("IF v_decision = 'approve' THEN") < oldCutover.indexOf("v_effective_policy_version := COALESCE("));
assert.match(oldCutover, /IF v_decision = 'approve' THEN\s+RETURN jsonb_build_object\('kind', 'state_conflict'/);
const atomic = cutover.slice(cutover.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_approve_atomic_v1("));
assert.match(atomic, /p_expected_fixture_run_id TEXT/);
assert.match(atomic, /p_decision IS DISTINCT FROM 'approve'/);
assert.match(atomic, /v_case\.row_version::BIGINT <> p_expected_row_version/);
assert.match(atomic, /v_case\.case_status <> 'manual_review'/);
assert.match(atomic, /v_case\.payment_status <> 'paid'/);
assert.match(atomic, /v_case\.audit_metadata ->> 'fixture_run_id' IS DISTINCT FROM p_expected_fixture_run_id/);
assert.match(atomic, /v_case\.audit_metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'/);
assert.match(atomic, /v_payment\.payment_status IS DISTINCT FROM 'successful'/);
assert.match(atomic, /v_requirement\.requirement_state IS DISTINCT FROM 'passed'/);
assert.match(atomic, /v_requirement_count <> 6/);
assert.ok(atomic.indexOf("FROM public.solo_plus_cases") < atomic.indexOf("FROM public.payment_records"));
assert.ok(atomic.indexOf("FROM public.payment_records") < atomic.indexOf("FROM public.solo_plus_case_requirements"));
assert.equal((atomic.match(/FOR SHARE NOWAIT/g) ?? []).length, 2);
assert.match(atomic, /EXCEPTION WHEN lock_not_available THEN\s+RETURN jsonb_build_object\('kind', 'state_conflict'/);
assert.match(atomic, /writer protocol and two-session PostgreSQL races remain unproven[\s\S]*RETURN jsonb_build_object\('kind', 'state_conflict'/);
assert.doesNotMatch(atomic, /UPDATE public\.solo_plus_cases|INSERT INTO public\.solo_plus_case_events|activate_solo_plus_case_v1|workspace_subscriptions/i);
assert.match(cutover, /REVOKE ALL ON FUNCTION public\.review_solo_plus_case_approve_atomic_v1\([\s\S]*FROM PUBLIC, anon, authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.review_solo_plus_case_approve_atomic_v1\([\s\S]*TO service_role;/);
assert.match(racePlan, /Payment-first legacy overlap/);
assert.match(racePlan, /Requirement update overlap/);
assert.match(racePlan, /current static tests cannot establish those races/i);
assert.match(requirementRepository, /reviewDecision === "approve" \? REVIEW_APPROVE_ATOMIC_RPC : REVIEW_CASE_RPC/);
assert.match(requirementRepository, /p_expected_fixture_run_id: input\.expectedFixtureRunId/);
assert.doesNotMatch(requirementRepository, /writer protocol is not released/);
assert.match(reviewerService, /expectedFixtureRunId: reviewActionScope\.runId/);

console.log("phase2b-approve-atomicity-hardening-package.test.ts passed (fail-closed; approve blocked)");
