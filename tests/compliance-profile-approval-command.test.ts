import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  prepareComplianceProfileApprovalCommand,
  type ComplianceProfileApprovalCommandRequest,
} from "../src/lib/compliance/compliance-profile-approval-command-core";

const identity = { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" as const };
const reviewer = { reviewerId: "reviewer-1", authorization: "internal_compliance_reviewer" as const, authorized: true as const };
const evidence = {
  sourceType: "solo_lite_review" as const,
  sourceId: "review-1",
  evidenceVersion: 1,
  evidenceState: "complete" as const,
  reviewedAt: "2026-08-24T12:00:00.000Z",
  policyVersion: "phase-2-v1",
  authority: "trusted_review_workflow" as const,
};

function request(overrides: Partial<ComplianceProfileApprovalCommandRequest> = {}): ComplianceProfileApprovalCommandRequest {
  return {
    identity,
    approvalDecisionKey: "approval-1",
    expectedProfileRowVersion: 1,
    plan: "solo_lite",
    sourceComplianceStatus: "lite_pending",
    targetComplianceStatus: "lite_verified",
    reviewer,
    evidence,
    restrictionOutcome: "none",
    ...overrides,
  };
}

function prepared(input: ComplianceProfileApprovalCommandRequest) {
  const result = prepareComplianceProfileApprovalCommand(input);
  assert.equal(result.kind, "prepared");
  return result.payload;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function rejected(input: ComplianceProfileApprovalCommandRequest, code: string) {
  const result = prepareComplianceProfileApprovalCommand(input);
  assert.equal(result.kind, "rejected");
  assert.deepEqual(result.diagnostics, [{ code }]);
}

function run() {
  assert.equal(prepared(request()).complianceStatus, "lite_verified");
  assert.equal(prepared(request({
    plan: "solo_plus",
    sourceComplianceStatus: "enhanced_pending",
    targetComplianceStatus: "enhanced_verified",
    evidence: { ...evidence, sourceType: "solo_plus_case" },
  })).complianceStatus, "enhanced_verified");
  assert.equal(prepared(request({
    plan: "business",
    sourceComplianceStatus: "business_pending",
    targetComplianceStatus: "business_verified",
    evidence: { ...evidence, sourceType: "business_kyb_review" },
  })).complianceStatus, "business_verified");

  for (const [target, reasonCode] of [
    ["needs_attention", "evidence_incomplete"],
    ["rejected", "review_rejected"],
    ["restricted", "risk_restricted"],
  ] as const) {
    const payload = prepared(request({ targetComplianceStatus: target, reasonCode }));
    assert.equal(payload.complianceStatus, target);
    assert.equal(payload.reasonCode, reasonCode);
  }
  const suspended = prepared(request({
    targetComplianceStatus: "restricted",
    reasonCode: "risk_suspended",
    restrictionOutcome: "suspended",
  }));
  assert.deepEqual(
    [suspended.complianceStatus, suspended.activationStatus, suspended.restrictionState],
    ["restricted", "suspended", "suspended"],
  );
  assert.notEqual(suspended.complianceStatus, "suspended");

  rejected(request({ targetComplianceStatus: "enhanced_verified" }), "approval_source_target_mismatch");
  rejected(request({ approvalDecisionKey: "" }), "approval_decision_key_missing");
  rejected(request({ expectedProfileRowVersion: null }), "approval_row_version_missing");
  rejected(request({ reviewer: { ...reviewer, authorized: false } as never }), "approval_reviewer_unauthorized");
  rejected(request({ identity: { ...identity, authority: "browser" } as never }), "approval_authority_untrusted");
  rejected(request({ evidence: null }), "approval_evidence_missing");
  rejected(request({ evidence: { ...evidence, evidenceState: "incomplete" } }), "approval_evidence_unsafe");
  rejected(request({ evidence: { ...evidence, sourceType: "solo_plus_case" } }), "approval_evidence_plan_mismatch");
  rejected(request({ targetComplianceStatus: "rejected", reasonCode: null }), "approval_reason_code_required");
  rejected(request({ reasonCode: "raw customer email@example.com" as never }), "approval_reason_code_unsafe");
  rejected(request({ restrictionOutcome: "suspended" }), "approval_restriction_outcome_invalid");
  for (const sourceType of ["payment_record", "subscription", "setup_mode", "live_features", "provider_mapping"]) {
    rejected(request({ evidence: { ...evidence, sourceType } as never }), "approval_evidence_plan_mismatch");
  }

  const preserved = prepareComplianceProfileApprovalCommand(request({
    existingProfile: { complianceStatus: "lite_verified", activationStatus: "test_mode", restrictionState: null },
  }));
  assert.equal(preserved.kind, "existing");
  assert.deepEqual(preserved.diagnostics, [{ code: "approval_profile_preserved" }]);
  const suspensionPreserved = prepareComplianceProfileApprovalCommand(request({
    existingProfile: { complianceStatus: "restricted", activationStatus: "suspended", restrictionState: "suspended" },
  }));
  assert.equal(suspensionPreserved.kind, "existing");

  const payload = prepared(request());
  assert.equal(payload.activationStatus, "test_mode");
  assert.equal(payload.restrictionState, null);
  assert.deepEqual(payload.merchantEntitlements, {
    canCollectPayments: false,
    canUseInstantSale: false,
    canUseReceivableSale: false,
    canUseStorefront: false,
    canActivateSettlement: false,
    canUseDepositBalance: false,
  });

  const facade = readFileSync("src/lib/compliance/compliance-profile-approval-command.ts", "utf8");
  const core = readFileSync("src/lib/compliance/compliance-profile-approval-command-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|rpc\(|paystack|monnify|breet/i);
  assert.doesNotMatch(core, /setup_mode|live_features_enabled|payment_records|subscriptions|provider/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /compliance-profile-approval-command/);
  }

  console.log("compliance-profile-approval-command.test.ts passed");
}

run();
