import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

const design = source("docs/prd-phase-2b-approve-paid-fixture-and-atomicity-design.md");
const runbook = source("docs/prd-phase-2b-admin-ui-staging-approve-acceptance-runbook.md");
const oldFixture = source("scripts/phase2b-admin-detail-fixture-staging.ps1");
const repository = source("src/lib/solo-plus/server/supabase-repository.ts");
const reviewRpc = source("supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql");
const paymentRpc = source("supabase/migrations/20260707020000_solo_plus_payment_lifecycle.sql");
const recoveryRpc = source("supabase/migrations/20260718_01_solo_plus_payment_recovery.sql");
const orchestration = source("src/lib/solo-plus/orchestration.ts");
const normalizedDesign = design.replace(/\s+/g, " ");

for (const required of [
  "No executable fixture is reviewed",
  "Approve fixture planning, creation,",
  "separate approve-only fixture procedure",
  "Current source: fail-closed predecessor plus unverified approve-success migration",
  "case, linked payment, then requirements in canonical code order",
  "Payment confirmation and recovery",
  "phase2b-approve-YYYYMMDD-<random>",
  "review_state=under_review",
  "payment_status=paid",
  "payment_status=successful",
  "Exactly the six canonical codes",
  "Read the actual positive `row_version` after every fixture write commits",
  "ON CONFLICT DO UPDATE",
  "fixture_scope=phase2b_approve_acceptance",
  "synthetic_approve_acceptance=true",
  "Provider name/reference/payload",
  "no real customer identity",
  "case `row_version` and preflight cannot by themselves stabilize child rows",
  "payment-first writer",
  "NOWAIT",
  "direct upserts and deletes",
  "Direct table",
  "disposable local PostgreSQL",
  "cannot prove transactional safety",
  "separately approve",
  "Production remains outside this package",
]) {
  assert.ok(normalizedDesign.includes(required), `Missing approve design boundary: ${required}`);
}
assert.doesNotMatch(design, /\| Version \|[^\n]*row_version=1/);
assert.match(design, /pre-action version plus one/);
assert.match(runbook, /paid-fixture and atomicity design/);
assert.match(runbook, /planning and creation are blocked/);
assert.match(runbook, /no transactional guarantee/);
assert.doesNotMatch(design, /phase2b-rmi-20261001-002|phase2b-reject-20261013-a1b2/i);
assert.match(oldFixture, /payment_status = 'pending'/);
assert.match(oldFixture, /IF EXISTS \(SELECT 1 FROM public\.payment_records WHERE solo_plus_case_id = v_case_id\)/);

// These source assertions are deliberately a blocker detector, not proof of
// safety. They must be replaced with concurrent database tests when the
// forward-only atomicity migration and new fixture procedure are reviewed.
const approveBranch = reviewRpc.slice(
  reviewRpc.indexOf("IF v_decision = 'approve' THEN", reviewRpc.indexOf("FOR UPDATE;")),
  reviewRpc.indexOf("v_target_refund_status := CASE"),
);
assert.match(approveBranch, /FROM public\.solo_plus_case_requirements/);
assert.match(approveBranch, /FROM public\.payment_records p/);
assert.match(approveBranch, /p\.payment_status = 'successful'/);
assert.doesNotMatch(approveBranch, /FOR (?:UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)/i);
const requirementWriter = repository.slice(repository.indexOf("async upsertCaseRequirements("));
assert.match(requirementWriter, /\.from\("solo_plus_case_requirements"\)\s*\.upsert\(/);
assert.doesNotMatch(requirementWriter, /row_version|rowVersion/);
const paymentLock = paymentRpc.indexOf("FROM public.payment_records", paymentRpc.indexOf("p_internal_reference TEXT"));
const caseLock = paymentRpc.indexOf("FROM public.solo_plus_cases", paymentLock);
assert.ok(paymentLock >= 0 && caseLock > paymentLock, "Payment confirmation is payment-first today");
const recoveryPaymentLock = recoveryRpc.indexOf("FROM public.payment_records");
const recoveryCaseLock = recoveryRpc.indexOf("FROM public.solo_plus_cases", recoveryPaymentLock);
assert.ok(recoveryPaymentLock >= 0 && recoveryCaseLock > recoveryPaymentLock, "Payment recovery is payment-first today");
const approveMethod = orchestration.slice(
  orchestration.indexOf("async approveSoloPlusCase("),
  orchestration.indexOf("async rejectSoloPlusCase("),
);
assert.doesNotMatch(approveMethod, /activateSoloPlusCase|activate_solo_plus_case_v1|subscription|onboarding|settlement|refundCase|processRefund/i);

// A source-only model of the required eligibility/snapshot contract. The
// deployed RPC does not invoke it; this detects precisely why unchanged case
// row_version alone is insufficient when child rows drift.
const codes = [
  "activity_profile", "bvn", "id_document", "proof_of_address",
  "selfie_liveness", "settlement_account",
] as const;
type Snapshot = {
  caseId: string;
  runId: string;
  scope: string;
  rowVersion: number;
  caseStatus: string;
  paymentStatus: string;
  paymentRecord: { id: string; caseId: string; status: string; amount: string } | null;
  requirements: { code: string; state: string; evidence: string }[];
};
function assess(current: Snapshot, retained: Snapshot): string {
  if (current.caseId !== retained.caseId || current.runId !== retained.runId
      || current.scope !== "phase2b_approve_acceptance") return "marker_conflict";
  if (current.rowVersion !== retained.rowVersion) return "version_conflict";
  if (current.caseStatus !== "manual_review" || current.paymentStatus !== "paid") return "case_ineligible";
  if (!current.paymentRecord || current.paymentRecord.caseId !== current.caseId
      || current.paymentRecord.status !== "successful") return "payment_ineligible";
  if (current.requirements.length !== 6 || codes.some((code) =>
    !current.requirements.some((requirement) => requirement.code === code && requirement.state === "passed"))) {
    return "requirements_ineligible";
  }
  if (JSON.stringify(current.paymentRecord) !== JSON.stringify(retained.paymentRecord)
      || JSON.stringify(current.requirements) !== JSON.stringify(retained.requirements)) return "child_drift";
  return "eligible";
}
const baseline: Snapshot = {
  caseId: "synthetic-case", runId: "phase2b-approve-20261014-test", scope: "phase2b_approve_acceptance",
  rowVersion: 1, caseStatus: "manual_review", paymentStatus: "paid",
  paymentRecord: { id: "synthetic-payment", caseId: "synthetic-case", status: "successful", amount: "13000.00" },
  requirements: codes.map((code) => ({ code, state: "passed", evidence: `synthetic-${code}` })),
};
const changed = (patch: Partial<Snapshot>): Snapshot => ({ ...baseline, ...patch });
assert.equal(assess(baseline, baseline), "eligible");
assert.equal(assess(changed({ paymentStatus: "pending" }), baseline), "case_ineligible");
assert.equal(assess(changed({ paymentRecord: null }), baseline), "payment_ineligible");
assert.equal(assess(changed({ paymentRecord: { id: "synthetic-payment", caseId: "synthetic-case", status: "reversed", amount: "13000.00" } }), baseline), "payment_ineligible");
assert.equal(assess(changed({ paymentRecord: { id: "synthetic-payment", caseId: "synthetic-case", status: "successful", amount: "1.00" } }), baseline), "child_drift");
assert.equal(assess(changed({ requirements: baseline.requirements.slice(1) }), baseline), "requirements_ineligible");
assert.equal(assess(changed({ requirements: [{ code: codes[0], state: "failed", evidence: "synthetic-changed" }, ...baseline.requirements.slice(1)] }), baseline), "requirements_ineligible");
assert.equal(assess(changed({ requirements: [{ ...baseline.requirements[0], evidence: "synthetic-changed" }, ...baseline.requirements.slice(1)] }), baseline), "child_drift");
assert.equal(assess(changed({ runId: "phase2b-approve-20261014-wrong" }), baseline), "marker_conflict");
assert.equal(assess(changed({ rowVersion: 2 }), baseline), "version_conflict");

console.log("phase2b-approve-paid-fixture-design.test.ts passed (design-only; execution blocked)");
