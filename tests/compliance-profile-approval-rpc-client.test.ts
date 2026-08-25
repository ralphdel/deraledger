import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  REVIEW_COMPLIANCE_PROFILE_DECISION_RPC,
  executeReviewedProfileApprovalRpc,
  toReviewedProfileApprovalRpcArguments,
  type ReviewedProfileApprovalRpcArguments,
} from "../src/lib/compliance/compliance-profile-approval-rpc-client-core";
import { prepareComplianceProfileApprovalCommand } from "../src/lib/compliance/compliance-profile-approval-command-core";

const context = { databaseRole: "service_role" as const, internalReviewAuthorized: true };
const prepared = prepareComplianceProfileApprovalCommand({
  identity: { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" },
  approvalDecisionKey: "decision-1", expectedProfileRowVersion: 7, plan: "solo_lite",
  sourceComplianceStatus: "lite_pending", targetComplianceStatus: "lite_verified",
  reviewer: { reviewerId: "reviewer-1", authorization: "internal_compliance_reviewer", authorized: true },
  evidence: { sourceType: "solo_lite_review", sourceId: "source-1", evidenceVersion: 3, evidenceState: "complete", reviewedAt: "2026-08-25T12:00:00.000Z", policyVersion: "phase-2-v1", authority: "trusted_review_workflow" },
  restrictionOutcome: "none",
});
assert.equal(prepared.kind, "prepared");
const command = prepared.payload;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  const args = toReviewedProfileApprovalRpcArguments(command, "profile-1");
  assert.equal(REVIEW_COMPLIANCE_PROFILE_DECISION_RPC, "review_compliance_profile_decision_v1");
  assert.deepEqual(Object.keys(args), [
    "p_merchant_id", "p_profile_id", "p_plan_code", "p_source_type", "p_source_id", "p_source_version",
    "p_target_compliance_status", "p_expected_profile_row_version", "p_reviewer_id", "p_decision_idempotency_key",
    "p_policy_version", "p_reviewed_at", "p_reason_code",
  ]);
  assert.deepEqual(args, {
    p_merchant_id: "merchant-1", p_profile_id: "profile-1", p_plan_code: "solo_lite",
    p_source_type: "solo_lite_review", p_source_id: "source-1", p_source_version: 3,
    p_target_compliance_status: "lite_verified", p_expected_profile_row_version: 7, p_reviewer_id: "reviewer-1",
    p_decision_idempotency_key: "decision-1", p_policy_version: "phase-2-v1", p_reviewed_at: "2026-08-25T12:00:00.000Z", p_reason_code: null,
  });

  let invoked: { name: string; args: ReviewedProfileApprovalRpcArguments } | null = null;
  const created = await executeReviewedProfileApprovalRpc(command, "profile-1", context, {
    async callApprovalDecisionRpc(name, input) {
      invoked = { name, args: input };
      return [{ result_code: "approval_applied", profile_id: "profile-1", event_id: "event-1", resulting_row_version: 8 }];
    },
  });
  assert.deepEqual(created, { kind: "created", profileId: "profile-1", eventId: "event-1", resultingRowVersion: 8, diagnostics: [] });
  assert.deepEqual(invoked, { name: REVIEW_COMPLIANCE_PROFILE_DECISION_RPC, args });

  const replay = await executeReviewedProfileApprovalRpc(command, "profile-1", context, {
    async callApprovalDecisionRpc() { return [{ result_code: "approval_idempotent_replay", profile_id: "profile-1", event_id: "event-1", resulting_row_version: 8 }]; },
  });
  assert.equal(replay.kind, "replay");
  const preserved = await executeReviewedProfileApprovalRpc(command, "profile-1", context, {
    async callApprovalDecisionRpc() { return [{ result_code: "approval_profile_preserved", profile_id: "profile-1", event_id: null, resulting_row_version: 7 }]; },
  });
  assert.equal(preserved.kind, "preserved");

  for (const role of ["anon", "authenticated", "browser", "unknown"] as const) {
    let calls = 0;
    const result = await executeReviewedProfileApprovalRpc(command, "profile-1", { databaseRole: role, internalReviewAuthorized: false }, {
      async callApprovalDecisionRpc() { calls += 1; return []; },
    });
    assert.deepEqual(result, { kind: "rejected", diagnostics: [{ code: "approval_rpc_context_denied" }] });
    assert.equal(calls, 0);
  }
  const unknown = await executeReviewedProfileApprovalRpc(command, "profile-1", context, {
    async callApprovalDecisionRpc() { return [{ result_code: "unexpected_database_detail", profile_id: null, event_id: null, resulting_row_version: null }]; },
  });
  assert.deepEqual(unknown, { kind: "rejected", diagnostics: [{ code: "approval_rpc_result_unknown" }] });
  const transportFailure = await executeReviewedProfileApprovalRpc(command, "profile-1", context, {
    async callApprovalDecisionRpc() { throw new Error("transport detail"); },
  });
  assert.deepEqual(transportFailure, { kind: "rejected", diagnostics: [{ code: "approval_rpc_rejected" }] });
  assert.doesNotMatch(JSON.stringify(transportFailure), /transport detail/i);

  const facade = readFileSync("src/lib/compliance/compliance-profile-approval-rpc-client.ts", "utf8");
  const core = readFileSync("src/lib/compliance/compliance-profile-approval-rpc-client-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|paystack|monnify|breet|checkout/i);
  assert.doesNotMatch(core, /setup_mode|live_features_enabled|can_collect_payments|activation_status|payment_records|subscriptions|invoices|provider/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /compliance-profile-approval-rpc-client/);
  }
  console.log("compliance-profile-approval-rpc-client.test.ts passed");
}

void run();
