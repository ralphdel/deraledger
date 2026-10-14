import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

const runbook = source("docs/prd-phase-2b-admin-ui-staging-approve-acceptance-runbook.md");
const rmiRunbook = source("docs/prd-phase-2b-admin-ui-staging-request-more-information-acceptance-runbook.md");
const rejectRunbook = source("docs/prd-phase-2b-admin-ui-staging-reject-acceptance-runbook.md");
const acceptancePlan = source("docs/prd-phase-2b-admin-ui-staging-review-action-acceptance-plan.md");
const releasePlan = source("docs/prd-phase-2b-admin-ui-staging-release-execution-plan.md");
const gate = source("src/lib/server/solo-plus-review-action-release.ts");
const service = source("src/lib/solo-plus/server/review-service.ts");
const orchestration = source("src/lib/solo-plus/orchestration.ts");
const reviewRpc = source("supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql");
const fixtureExecutor = source("scripts/phase2b-admin-detail-fixture-staging.ps1");
const requirementsService = source("src/lib/solo-plus/server/requirements.ts");
const repository = source("src/lib/solo-plus/server/supabase-repository.ts");
const normalizedRunbook = runbook.replace(/\s+/g, " ").toLowerCase();

for (const required of [
  "source-only proposal for independent review",
  "Fresh approve fixture planning and creation are blocked",
  "phase2b-approve-YYYYMMDD",
  "fixture_scope=phase2b_approve_acceptance",
  "payment_status=paid",
  "exactly six canonical requirements",
  "Activation is a separate",
  "Requirement-write race blocker",
  "does not resolve that race",
  "payment_records.payment_status=successful",
  "Read-only preflight contract",
  "PASS|APPROVE_PREFLIGHT|ready|row_version=",
  "Read-only post-action contract",
  "PASS|APPROVE_POSTFLIGHT|approved_without_activation",
  "Restore default block and cleanup",
  "separate **approve execution approval**",
  "DERALEDGER_DEPLOYMENT_TARGET=staging",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED=true",
  "DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED=true",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID=<fresh exact approve fixture case UUID>",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION=approve",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID=<fresh exact phase2b-approve-YYYYMMDD-random run ID>",
]) {
  assert.ok(normalizedRunbook.includes(required.toLowerCase()), `Missing approve package contract: ${required}`);
}

assert.doesNotMatch(runbook, /DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION\s*=\s*(?:request_more_information|reject|reopen)\b/i);
assert.doesNotMatch(runbook, /DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_(?:CASE_ID|RUN_ID)\s*=\s*(?:\*|all|any)\b/i);
assert.doesNotMatch(runbook, /2c4dde2a-2c9b-47c4-927c-607a0bae951e|phase2b-rmi-20261001-002|phase2b-reject-20261013-a1b2/i);
assert.doesNotMatch(runbook, /gznwibespgkwknnvbrlv/i);
assert.match(runbook, /The reject flag must be absent/i);
assert.match(runbook, /Keep `DERALEDGER_DEPLOYMENT_TARGET=staging`/i);
assert.match(runbook, /unpaid RMI\/reject fixture cleanup\s+path must not be reused/i);
assert.match(runbook, /No cleanup is authorized here/i);

assert.match(gate, /DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED/);
assert.match(gate, /APPROVE_RUN_ID_PATTERN/);
assert.match(gate, /rejectGateValue !== "" && approveGateValue !== ""/);
assert.match(service, /phase2b_approve_acceptance/);
assert.match(service, /synthetic_approve_acceptance === true/);
assert.match(service, /paymentStatus === "paid"/);
assert.match(orchestration, /async approveSoloPlusCase\(/);
assert.doesNotMatch(orchestration.slice(orchestration.indexOf("async approveSoloPlusCase("), orchestration.indexOf("async rejectSoloPlusCase(")), /activateSoloPlusCase|activate_solo_plus_case_v1/);
assert.match(reviewRpc, /IF v_case\.payment_status <> 'paid'/);
assert.match(reviewRpc, /v_satisfied_requirement_count <> 6/);
assert.doesNotMatch(reviewRpc.slice(reviewRpc.indexOf("CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1(")), /activate_solo_plus_case_v1\(/);
assert.match(fixtureExecutor, /c\.payment_status = 'pending'/);
assert.match(requirementsService, /repository\.upsertCaseRequirements\(/);
assert.match(repository, /\.from\("solo_plus_case_requirements"\)[\s\S]*?\.upsert\(/);

assert.match(rmiRunbook.slice(0, 550), /reject gate also completed/i);
assert.match(rejectRunbook.slice(0, 700), /historical reject acceptance package/i);
assert.match(rejectRunbook.slice(0, 700).replace(/\s+/g, " "), /approve fixture planning remains blocked/i);
assert.match(acceptancePlan.slice(0, 700), /RMI and reject actions[\s\S]*completed/);
assert.match(acceptancePlan.slice(0, 700), /approve-acceptance-runbook\.md/);
assert.match(releasePlan.slice(0, 600), /RMI and reject acceptance/);
assert.match(acceptancePlan, /Historical RMI\/reject sequence \(completed\)/);
assert.match(acceptancePlan, /Historical post-RMI block list/);
assert.doesNotMatch(acceptancePlan, /proposed reject gate|reject package is ready for independent source review only/i);
for (const stale of [
  /next proposed reject gate/i,
  /new unpaid reject gate/i,
  /proposed reject gate blocked pending separate approvals/i,
  /reject package is ready for independent source review only/i,
]) {
  assert.doesNotMatch(`${rmiRunbook.slice(0, 550)}\n${rejectRunbook.slice(0, 700)}\n${acceptancePlan.slice(0, 700)}\n${releasePlan.slice(0, 600)}`, stale);
}

console.log("phase2b-approve-acceptance-package.test.ts passed");
