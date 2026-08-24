import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  prepareComplianceProfileApprovalCommand,
  type ComplianceProfileApprovalCommandRequest,
} from "../src/lib/compliance/compliance-profile-approval-command-core";
import {
  prepareComplianceProfileApprovalPersistence,
  type ComplianceApprovalServiceRoleContext,
  type ComplianceProfileApprovalPersistenceSnapshot,
} from "../src/lib/compliance/compliance-profile-approval-persistence-core";

const context = { databaseRole: "service_role" as const, internalReviewAuthorized: true };
const identity = { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" as const };
const reviewer = { reviewerId: "reviewer-1", authorization: "internal_compliance_reviewer" as const, authorized: true as const };
const evidence = {
  sourceType: "solo_lite_review" as const, sourceId: "source-1", evidenceVersion: 1,
  evidenceState: "complete" as const, reviewedAt: "2026-08-24T14:00:00.000Z",
  policyVersion: "phase-2-v1", authority: "trusted_review_workflow" as const,
};

function commandRequest(overrides: Partial<ComplianceProfileApprovalCommandRequest> = {}): ComplianceProfileApprovalCommandRequest {
  return {
    identity, approvalDecisionKey: "decision-1", expectedProfileRowVersion: 2,
    plan: "solo_lite", sourceComplianceStatus: "lite_pending", targetComplianceStatus: "lite_verified",
    reviewer, evidence, restrictionOutcome: "none", ...overrides,
  };
}

function command(input: ComplianceProfileApprovalCommandRequest = commandRequest()) {
  const result = prepareComplianceProfileApprovalCommand(input);
  assert.equal(result.kind, "prepared");
  return result.payload;
}

function snapshot(overrides: Partial<ComplianceProfileApprovalPersistenceSnapshot> = {}): ComplianceProfileApprovalPersistenceSnapshot {
  return {
    profiles: [{ id: "profile-1", merchantId: "merchant-1", complianceStatus: "lite_pending", activationStatus: "test_mode", restrictionState: null, rowVersion: 2 }],
    reviews: [{ id: "review-1", merchantId: "merchant-1", profileId: "profile-1", reviewType: "solo_lite", sourceId: "source-1", rowVersion: 1 }],
    soloPlusCases: [], events: [], ...overrides,
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function rejected(
  input: ReturnType<typeof command>,
  state: ComplianceProfileApprovalPersistenceSnapshot,
  code: string,
  executionContext: ComplianceApprovalServiceRoleContext | null = context,
) {
  const result = prepareComplianceProfileApprovalPersistence(input, executionContext, state);
  assert.equal(result.kind, "rejected");
  assert.deepEqual(result.diagnostics, [{ code }]);
}

function run() {
  const lite = prepareComplianceProfileApprovalPersistence(command(), context, snapshot());
  assert.equal(lite.kind, "ready");
  assert.deepEqual(lite.reviewUpdate, { reviewId: "review-1" });
  assert.equal(lite.soloPlusCaseBinding, null);

  const businessCommand = command(commandRequest({
    plan: "business", sourceComplianceStatus: "business_pending", targetComplianceStatus: "business_verified",
    evidence: { ...evidence, sourceType: "business_kyb_review" },
  }));
  const business = prepareComplianceProfileApprovalPersistence(businessCommand, context, snapshot({
    profiles: [{ id: "profile-1", merchantId: "merchant-1", complianceStatus: "business_pending", activationStatus: "test_mode", restrictionState: null, rowVersion: 2 }],
    reviews: [{ id: "review-1", merchantId: "merchant-1", profileId: "profile-1", reviewType: "business_kyb", sourceId: "source-1", rowVersion: 1 }],
  }));
  assert.equal(business.kind, "ready");
  assert.deepEqual(business.reviewUpdate, { reviewId: "review-1" });

  const soloPlusCommand = command(commandRequest({
    plan: "solo_plus", sourceComplianceStatus: "enhanced_pending", targetComplianceStatus: "enhanced_verified",
    evidence: { ...evidence, sourceType: "solo_plus_case" },
  }));
  const soloPlus = prepareComplianceProfileApprovalPersistence(soloPlusCommand, context, snapshot({
    profiles: [{ id: "profile-1", merchantId: "merchant-1", complianceStatus: "enhanced_pending", activationStatus: "test_mode", restrictionState: null, rowVersion: 2 }],
    reviews: [], soloPlusCases: [{ id: "case-1", merchantId: "merchant-1", profileId: "profile-1", sourceId: "source-1", rowVersion: 3 }],
  }));
  assert.equal(soloPlus.kind, "ready");
  assert.equal(soloPlus.reviewUpdate, null);
  assert.deepEqual(soloPlus.soloPlusCaseBinding, { caseId: "case-1" });

  const replay = prepareComplianceProfileApprovalPersistence(command(), context, snapshot({
    events: [{ id: "event-1", merchantId: "merchant-1", profileId: "profile-1", idempotencyKey: "decision-1", sourceType: "solo_lite_review", sourceId: "source-1", complianceStatus: "lite_verified", resultingRowVersion: 3 }],
  }));
  assert.equal(replay.kind, "replay");
  assert.deepEqual(replay.diagnostics, [{ code: "approval_idempotent_replay" }]);
  rejected(command(), snapshot({ events: [{ id: "event-1", merchantId: "merchant-1", profileId: "profile-1", idempotencyKey: "decision-1", sourceType: "solo_lite_review", sourceId: "wrong", complianceStatus: "lite_verified", resultingRowVersion: 3 }] }), "approval_replay_inconsistent");

  for (const profile of [
    { complianceStatus: "lite_verified", activationStatus: "test_mode", restrictionState: null },
    { complianceStatus: "rejected", activationStatus: "restricted", restrictionState: null },
    { complianceStatus: "restricted", activationStatus: "restricted", restrictionState: "restricted" },
    { complianceStatus: "restricted", activationStatus: "suspended", restrictionState: "suspended" },
  ]) {
    const result = prepareComplianceProfileApprovalPersistence(command(), context, snapshot({
      profiles: [{ id: "profile-1", merchantId: "merchant-1", rowVersion: 2, ...profile }],
    }));
    assert.equal(result.kind, "preserved");
  }

  rejected(command(), snapshot({ profiles: [] }), "approval_profile_missing");
  rejected(command(), snapshot({ profiles: [snapshot().profiles[0], { ...snapshot().profiles[0], id: "profile-2" }] }), "approval_profile_ambiguous");
  rejected(command(), snapshot({ profiles: [{ ...snapshot().profiles[0], rowVersion: 1 }] }), "approval_row_version_conflict");
  rejected(command(), snapshot({ reviews: [] }), "approval_review_missing");
  rejected(command(), snapshot({ reviews: [snapshot().reviews[0], { ...snapshot().reviews[0], id: "review-2" }] }), "approval_review_ambiguous");
  rejected(command(), snapshot(), "approval_persistence_context_denied", null);
  rejected(command(), snapshot(), "approval_persistence_context_denied", { databaseRole: "authenticated", internalReviewAuthorized: true });
  const missing = prepareComplianceProfileApprovalPersistence(null, context, snapshot());
  assert.equal(missing.kind, "rejected");
  assert.deepEqual(missing.diagnostics, [{ code: "approval_persistence_command_missing" }]);

  const payload = command();
  assert.deepEqual(payload.merchantEntitlements, {
    canCollectPayments: false, canUseInstantSale: false, canUseReceivableSale: false,
    canUseStorefront: false, canActivateSettlement: false, canUseDepositBalance: false,
  });
  assert.notEqual(payload.activationStatus, "approved");

  const facade = readFileSync("src/lib/compliance/compliance-profile-approval-persistence.ts", "utf8");
  const core = readFileSync("src/lib/compliance/compliance-profile-approval-persistence-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|rpc\(|paystack|monnify|breet/i);
  assert.doesNotMatch(core, /updateMerchant|updateWorkspace|updateSubscription|updateInvoice|insertLimit|createReview/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /compliance-profile-approval-persistence/);
  }
  console.log("compliance-profile-approval-persistence.test.ts passed");
}

run();
