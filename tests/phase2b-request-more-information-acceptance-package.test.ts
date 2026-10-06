import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const runbook = readFileSync(
  resolve("docs/prd-phase-2b-admin-ui-staging-request-more-information-acceptance-runbook.md"),
  "utf8",
);
const fixtureExecutor = readFileSync(
  resolve("scripts/phase2b-admin-detail-fixture-staging.ps1"),
  "utf8",
);
const releaseGate = readFileSync(
  resolve("src/lib/server/solo-plus-review-action-release.ts"),
  "utf8",
);
const acceptancePlan = readFileSync(
  resolve("docs/prd-phase-2b-admin-ui-staging-review-action-acceptance-plan.md"),
  "utf8",
);
const detailPage = readFileSync(
  resolve("src/app/(admin)/admin/solo-plus/cases/[caseId]/page.tsx"),
  "utf8",
);

const productionRef = ["gznwibespgkw", "knnvbrlv"].join("");
assert.equal(
  runbook.includes(productionRef),
  false,
  "request-more-information package must not embed the production project ref",
);

for (const exactValue of [
  "fsjljliiyfchkwbjifzw",
  "aws-1-eu-central-2.pooler.supabase.com",
  "postgres.fsjljliiyfchkwbjifzw",
  "DERALEDGER_DEPLOYMENT_TARGET=staging",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED=true",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID=<fresh exact fixture case UUID>",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION=request_more_information",
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID=<fresh exact fixture run ID>",
  "PASS|FIXTURE|draft_case_eligible",
  "PASS|FIXTURE|admin_read_case_prepared",
  "PASS|FIXTURE|admin_detail_ready",
  "PASS|RMI_POSTFLIGHT|state_requirements_event_and_boundaries_verified",
  "PASS|FIXTURE_CLEANUP|case_descendants_absent",
]) {
  assert.ok(runbook.includes(exactValue), `missing exact package contract: ${exactValue}`);
}

assert.doesNotMatch(
  runbook,
  /DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION\s*=\s*(?:approve|reject|reopen)\b/i,
);
assert.doesNotMatch(
  runbook,
  /DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_(?:CASE_ID|RUN_ID)\s*=\s*(?:\*|all|any)\b/i,
);
assert.match(runbook, /approve, reject, and reopen controls must remain absent/i);
assert.match(runbook, /Do not probe another real case/i);
assert.match(runbook, /Do not execute them under fixture-creation\s+approval alone/i);
assert.match(
  runbook,
  /Remove all five review-action\/deployment-target environment values/i,
);
assert.match(runbook, /Cleanup is not authorized by fixture creation or action acceptance/i);
assert.match(runbook, /deraledger-staging\.vercel\.app/);
assert.match(runbook, /explicit label cannot enable the gate by\s+itself/i);
assert.match(runbook, /real production Supabase ref/i);

const futureRejectMarker = "## Future reject gate (non-authorizing; not part of this package)";
const futureRejectStart = acceptancePlan.indexOf(futureRejectMarker);
assert.ok(futureRejectStart >= 0, "reject guidance must be explicitly future-gated");
const currentAcceptancePlan = acceptancePlan.slice(0, futureRejectStart);
const futureRejectPlan = acceptancePlan.slice(futureRejectStart);
assert.doesNotMatch(currentAcceptancePlan, /Reject second/i);
assert.doesNotMatch(currentAcceptancePlan, /unpaid-reject acceptance/i);
assert.doesNotMatch(
  currentAcceptancePlan,
  /(?:^|\n)### Reject(?:\s|$)/i,
);
assert.match(futureRejectPlan, /does not authorize a reject action/i);
assert.match(futureRejectPlan, /separate source change/i);
assert.match(futureRejectPlan, /separate exact environment\s+scope/i);
assert.match(futureRejectPlan, /separate staging deployment approval/i);
assert.match(futureRejectPlan, /separate final execution\s+approval/i);
assert.match(acceptancePlan, /End this current gate after request-more-information/i);
assert.doesNotMatch(currentAcceptancePlan, /two actions in this plan/i);
assert.doesNotMatch(currentAcceptancePlan, /- reject:\s+`rejected`/i);

assert.match(releaseGate, /caseId:\s*caseId\.toLowerCase\(\)/);
assert.match(releaseGate, /decision,/);
assert.match(releaseGate, /runId,/);
assert.match(releaseGate, /scope\.caseId === input\.caseId\.trim\(\)\.toLowerCase\(\)/);
assert.match(releaseGate, /scope\.decision === input\.decision\.trim\(\)\.toLowerCase\(\)/);
assert.match(releaseGate, /DERALEDGER_DEPLOYMENT_TARGET/);
assert.match(releaseGate, /CURRENT_STAGING_ACCEPTANCE_DECISION = "request_more_information"/);
assert.match(releaseGate, /hasProductionIdentity\(env\)/);
assert.match(releaseGate, /isExplicitDedicatedStagingDeployment\(env\)/);
assert.match(detailPage, /reviewActionScope\?\.caseId === caseId\.toLowerCase\(\)/);
assert.match(detailPage, /allowedReviewDecision=\{allowedReviewDecision\}/);

for (const exactFixtureGuard of [
  /\[guid\]\$FixtureCaseId/,
  /\[string\]\$FixtureRunId/,
  /c\.id = v_case_id/,
  /c\.audit_metadata ->> 'fixture_run_id' = v_fixture_run_id/,
  /WHERE case_id = v_case_id/,
  /FOR UPDATE;/,
  /RETURNING id INTO v_deleted_case_id/,
  /v_deleted_case_count <> 1/,
]) {
  assert.match(fixtureExecutor, exactFixtureGuard);
}

assert.match(runbook, /BEGIN TRANSACTION READ ONLY;/g);
assert.match(runbook, /ROLLBACK;/g);
assert.match(runbook, /case_review_requested_more_information/);
assert.match(runbook, /prior_review_event_count/);
assert.match(runbook, /exact_request_event_count/);
assert.match(runbook, /prohibited_review_event_count/);
assert.match(runbook, /non_pristine_requirement_count/);
assert.match(runbook, /commercial_boundary_fingerprint/);
assert.match(runbook, /workspace_exists/);
assert.match(runbook, /kind=idempotent_replay/);
assert.match(runbook, /code=VERSION_CONFLICT/);
assert.match(runbook, /private, no-store, max-age=0/);

console.log("phase2b-request-more-information-acceptance-package.test.ts passed");
