import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { ComplianceProfileApprovalRpcAdapter } from "../src/lib/compliance/compliance-profile-approval-rpc-client-core";
import { executeComplianceProfileApprovalRpcTransaction } from "../src/lib/compliance/compliance-profile-approval-transaction-executor-core";
import type { ComplianceProfileApprovalCommandRequest } from "../src/lib/compliance/compliance-profile-approval-command-core";

const context = { databaseRole: "service_role" as const, internalReviewAuthorized: true };

function request(overrides: Partial<ComplianceProfileApprovalCommandRequest> = {}): ComplianceProfileApprovalCommandRequest {
  return {
    identity: { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" },
    approvalDecisionKey: "decision-1", expectedProfileRowVersion: 4,
    plan: "solo_lite", sourceComplianceStatus: "lite_pending", targetComplianceStatus: "lite_verified",
    reviewer: { reviewerId: "reviewer-1", authorization: "internal_compliance_reviewer", authorized: true },
    evidence: { sourceType: "solo_lite_review", sourceId: "source-1", evidenceVersion: 2, evidenceState: "complete", reviewedAt: "2026-08-25T12:00:00.000Z", policyVersion: "phase-2-v1", authority: "trusted_review_workflow" },
    restrictionOutcome: "none", ...overrides,
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  let calls = 0;
  let captured: Record<string, unknown> | null = null;
  const adapter: ComplianceProfileApprovalRpcAdapter = {
    async execute(command, profileId, receivedContext) {
      calls += 1;
      captured = { command, profileId, receivedContext };
      return { kind: "created", profileId, eventId: "event-1", resultingRowVersion: 5, diagnostics: [] };
    },
  };
  const created = await executeComplianceProfileApprovalRpcTransaction(request(), "profile-1", context, adapter);
  assert.deepEqual(created, { kind: "created", profileId: "profile-1", reviewId: null, soloPlusCaseId: null, eventId: "event-1", diagnostics: [] });
  assert.equal(calls, 1);
  assert.ok(captured);
  const capturedValue = captured as { command: Record<string, unknown>; profileId: string; receivedContext: unknown };
  const command = capturedValue.command;
  assert.deepEqual({
    approvalDecisionKey: command.approvalDecisionKey, expectedProfileRowVersion: command.expectedProfileRowVersion,
    reviewSourceType: command.reviewSourceType, reviewSourceId: command.reviewSourceId, evidenceVersion: command.evidenceVersion,
    reviewedBy: command.reviewedBy, policyVersion: command.policyVersion, reviewedAt: command.reviewedAt, reasonCode: command.reasonCode,
  }, {
    approvalDecisionKey: "decision-1", expectedProfileRowVersion: 4, reviewSourceType: "solo_lite_review", reviewSourceId: "source-1", evidenceVersion: 2,
    reviewedBy: "reviewer-1", policyVersion: "phase-2-v1", reviewedAt: "2026-08-25T12:00:00.000Z", reasonCode: null,
  });

  const invalid = await executeComplianceProfileApprovalRpcTransaction(request({ approvalDecisionKey: "" }), "profile-1", context, adapter);
  assert.deepEqual(invalid, { kind: "rejected", diagnostics: [{ code: "approval_decision_key_missing" }] });
  assert.equal(calls, 1, "validation must reject before adapter invocation");

  const replay = await executeComplianceProfileApprovalRpcTransaction(request(), "profile-1", context, {
    async execute() { return { kind: "replay", profileId: "profile-1", eventId: "event-1", resultingRowVersion: 5, diagnostics: [{ code: "approval_idempotent_replay" }] }; },
  });
  assert.deepEqual(replay, { kind: "replay", profileId: "profile-1", eventId: "event-1", diagnostics: [{ code: "approval_idempotent_replay" }] });

  const failed = await executeComplianceProfileApprovalRpcTransaction(request(), "profile-1", context, {
    async execute() { return { kind: "rejected", diagnostics: [{ code: "approval_rpc_result_unknown" }] }; },
  });
  assert.deepEqual(failed, { kind: "rejected", diagnostics: [{ code: "approval_rpc_result_unknown" }] });
  const thrown = await executeComplianceProfileApprovalRpcTransaction(request(), "profile-1", context, {
    async execute() { throw new Error("sensitive detail"); },
  });
  assert.deepEqual(thrown, { kind: "rejected", diagnostics: [{ code: "approval_rpc_rejected" }] });
  assert.doesNotMatch(JSON.stringify(thrown), /sensitive/i);

  const core = readFileSync("src/lib/compliance/compliance-profile-approval-transaction-executor-core.ts", "utf8");
  const bridgeStart = core.indexOf("export async function executeComplianceProfileApprovalRpcTransaction");
  const bridgeEnd = core.indexOf("export async function executeComplianceProfileApprovalTransaction");
  const bridge = core.slice(bridgeStart, bridgeEnd);
  assert.doesNotMatch(bridge, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|paystack|monnify|breet|checkout/i);
  assert.doesNotMatch(bridge, /setup_mode|live_features_enabled|can_collect_payments|payment_records|subscriptions|invoices|provider/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /compliance-profile-approval-(?:rpc-client|transaction-executor)/);
  }
  console.log("compliance-profile-approval-executor-rpc-integration.test.ts passed");
}

void run();
