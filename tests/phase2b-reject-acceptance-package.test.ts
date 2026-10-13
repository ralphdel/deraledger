import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(path), "utf8");
}

const runbook = source("docs/prd-phase-2b-admin-ui-staging-reject-acceptance-runbook.md");
const rmiRunbook = source("docs/prd-phase-2b-admin-ui-staging-request-more-information-acceptance-runbook.md");
const acceptancePlan = source("docs/prd-phase-2b-admin-ui-staging-review-action-acceptance-plan.md");
const releasePlan = source("docs/prd-phase-2b-admin-ui-staging-release-execution-plan.md");
const gate = source("src/lib/server/solo-plus-review-action-release.ts");
const service = source("src/lib/solo-plus/server/review-service.ts");
const fixtureExecutor = source("scripts/phase2b-admin-detail-fixture-staging.ps1");

for (const required of [
  "source package for independent review",
  "one fresh synthetic unpaid case",
  "phase2b-reject-<yyyymmdd>-<random-suffix>",
  "PASS|FIXTURE|draft_case_eligible",
  "PASS|FIXTURE|admin_read_case_prepared",
  "PASS|FIXTURE|admin_detail_ready",
  "PASS|REJECT_PREFLIGHT|ready|row_version=",
  "DERALEDGER_DEPLOYMENT_TARGET=staging",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED=true",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED=true",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID=<fresh exact reject fixture case UUID>",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION=reject",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID=<fresh exact phase2b-reject-YYYYMMDD-random run ID>",
  "PASS|REJECT_POSTFLIGHT|state_event_and_boundaries_verified",
  "Request more information",
  "approve",
  "reopen",
  "default-block",
  "separate cleanup approval",
]) {
  assert.ok(runbook.toLowerCase().includes(required.toLowerCase()), `Missing reject gate contract: ${required}`);
}

assert.doesNotMatch(runbook, /2c4dde2a-2c9b-47c4-927c-607a0bae951e|phase2b-rmi-20261001-002/i);
assert.doesNotMatch(runbook, /DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION\s*=\s*(?:request_more_information|approve|reopen)\b/i);
assert.doesNotMatch(runbook, /DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_(?:CASE_ID|RUN_ID)\s*=\s*(?:\*|all|any)\b/i);
assert.doesNotMatch(runbook, /gznwibespgkwknnvbrlv/i);
assert.match(runbook, /No placeholder is deployable/i);
assert.match(runbook, /unpaid service check itself is outside the RPC transaction/i);
assert.match(runbook, /alternate unversioned payment path/i);
assert.match(runbook, /separate \*\*execution approval\*\*/i);
assert.match(runbook, /No replay, stale tab/i);
assert.match(runbook, /Cleanup is not authorized by fixture creation or reject acceptance/i);
assert.match(runbook, /all six temporary/i);
assert.match(runbook, /private\/no-store 404/i);

const sqlTemplates = [...runbook.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
assert.equal(sqlTemplates.length, 2, "preflight and postflight must both be read-only templates");
for (const sql of sqlTemplates) {
  assert.match(sql, /^BEGIN TRANSACTION READ ONLY;/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|DO|COMMIT)\b/i);
  assert.match(sql, /fixture_run_id/);
  assert.match(sql, /payment_count/);
  assert.match(sql, /non_pristine_count/);
  assert.match(sql, /boundary/);
}
assert.match(sqlTemplates[0], /review_event_count/);
assert.match(sqlTemplates[0], /synthetic_read_only_admin_smoke/);
assert.match(sqlTemplates[1], /total_reject_event_count/);
assert.match(sqlTemplates[1], /other_decision_count/);

assert.match(gate, /DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED/);
assert.match(gate, /REJECT_RUN_ID_PATTERN/);
assert.match(gate, /isExplicitDedicatedStagingDeployment\(env\)/);
assert.match(service, /synthetic_read_only_admin_smoke === true/);
assert.match(service, /findLatestReviewDecisionEvent\(input\.caseId\)/);
assert.match(fixtureExecutor, /fixture_scope', 'phase2b_admin_detail_smoke'/);
assert.match(fixtureExecutor, /'synthetic_read_only_admin_smoke', true/);

assert.match(rmiRunbook, /Status:\*\* historical RMI acceptance package/i);
assert.match(acceptancePlan, /historical RMI design/i);
assert.match(acceptancePlan, /reject-acceptance-runbook\.md/);
assert.match(releasePlan, /historical staging-only release plan/i);
for (const staleGateWording of [
  /current staging gate can expose only request-more-information/i,
  /current source gate supports only the request-more-information fixture/i,
  /End this current gate after request-more-information/i,
  /VERCEL_ENV=production` always disables actions/i,
]) {
  assert.doesNotMatch(`${acceptancePlan}\n${releasePlan}`, staleGateWording);
}
assert.doesNotMatch(gate, /CURRENT_STAGING_ACCEPTANCE_DECISION/);

console.log("phase2b-reject-acceptance-package.test.ts passed");
