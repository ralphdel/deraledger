import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire, Module } from "node:module";

import {
  ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC,
  READ_CANONICAL_APPROVAL_SNAPSHOT_V2_RPC,
  createCanonicalApprovalReadiness,
  type CanonicalApprovalIssueRpcRow,
  type CanonicalApprovalReadinessReviewerResolver,
  type CanonicalApprovalReadinessRpcTransport,
  type CanonicalApprovalSnapshotRpcRow,
} from "../src/lib/compliance/canonical-approval-readiness-core";

type ServiceModule = typeof import("../src/lib/compliance/server/canonical-approval-readiness-service");

const ids = {
  profile: "00000000-0000-4000-8000-000000000101",
  reviewer: "00000000-0000-4000-8000-000000000102",
  request: "00000000-0000-4000-8000-000000000103",
  merchant: "00000000-0000-4000-8000-000000000104",
  workspace: "00000000-0000-4000-8000-000000000105",
  source: "00000000-0000-4000-8000-000000000106",
};
const derivedSuperAdmin = { actorKind: "super_admin" as const, reviewerId: ids.reviewer };

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function issueRow(result_code: string, overrides: Partial<CanonicalApprovalIssueRpcRow> = {}): CanonicalApprovalIssueRpcRow {
  return { result_code, decision_request_id: ids.request, decision_idempotency_key: "opaque-server-key", ...overrides };
}

function snapshotRow(result_code: string, overrides: Partial<CanonicalApprovalSnapshotRpcRow> = {}): CanonicalApprovalSnapshotRpcRow {
  return {
    ...issueRow(result_code), merchant_id: ids.merchant, workspace_id: ids.workspace, profile_id: ids.profile,
    plan_code: "solo_lite", current_compliance_status: "lite_pending", source_type: "solo_lite_review",
    source_id: ids.source, source_version: 7, expected_profile_row_version: 9, policy_version: "phase-2-v1",
    reviewer_id: ids.reviewer, reviewed_at: "2026-08-27T03:07:11.000Z", reason_code: null,
    target_compliance_status: "lite_verified", ...overrides,
  };
}

function transport(overrides: Partial<CanonicalApprovalReadinessRpcTransport> = {}): CanonicalApprovalReadinessRpcTransport {
  return {
    async issueCanonicalApprovalDecisionRequestV2(functionName, arguments_) {
      assert.equal(functionName, ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC);
      assert.deepEqual(Object.keys(arguments_).sort(), ["p_policy_version", "p_profile_id", "p_reason_code", "p_reviewer_id", "p_target_compliance_status"]);
      return [issueRow("canonical_request_v2_created")];
    },
    async readCanonicalApprovalSnapshotV2(functionName, arguments_) {
      assert.equal(functionName, READ_CANONICAL_APPROVAL_SNAPSHOT_V2_RPC);
      assert.deepEqual(arguments_, { p_decision_request_id: ids.request });
      return [snapshotRow("canonical_snapshot_v2_ready")];
    },
    ...overrides,
  };
}

function resolver(overrides: Partial<CanonicalApprovalReadinessReviewerResolver> = {}): CanonicalApprovalReadinessReviewerResolver {
  return { async resolveServerSessionReviewer() { return derivedSuperAdmin; }, ...overrides };
}

function readiness(
  rpcTransport: CanonicalApprovalReadinessRpcTransport = transport(),
  reviewerResolver: CanonicalApprovalReadinessReviewerResolver = resolver(),
) {
  return createCanonicalApprovalReadiness({ transport: rpcTransport, reviewerResolver });
}

async function run() {
  const canonicalReadiness = readiness();
  const created = await canonicalReadiness.issue({ profileId: ids.profile, targetComplianceStatus: "lite_verified", policyVersion: " phase-2-v1 ", reasonCode: null });
  assert.deepEqual(created, { kind: "created", decisionRequestId: ids.request, decisionIdempotencyKey: "opaque-server-key", diagnostics: [] });

  const replay = await readiness(transport({
    async issueCanonicalApprovalDecisionRequestV2() { return [issueRow("canonical_request_v2_idempotent_replay")]; },
  })).issue({ profileId: ids.profile, targetComplianceStatus: "lite_verified", policyVersion: "phase-2-v1" });
  assert.equal(replay.kind, "replay");

  const workspaceUnavailable = await readiness(transport({
    async issueCanonicalApprovalDecisionRequestV2() { return [issueRow("canonical_request_v2_workspace_linkage_unavailable", { decision_request_id: null, decision_idempotency_key: null })]; },
  })).issue({ profileId: ids.profile, targetComplianceStatus: "lite_verified", policyVersion: "phase-2-v1" });
  assert.deepEqual(workspaceUnavailable, { kind: "rejected", diagnostics: [{ code: "canonical_request_v2_workspace_linkage_unavailable" }] });

  for (const resultCode of ["canonical_snapshot_v2_stale_or_conflicting", "canonical_snapshot_v2_source_invalid", "canonical_snapshot_v2_payload_invalid", "canonical_snapshot_v2_failed"] as const) {
    const result = await readiness(transport({
      async readCanonicalApprovalSnapshotV2() { return [snapshotRow(resultCode, { decision_request_id: null, decision_idempotency_key: null })]; },
    })).readSnapshot({ decisionRequestId: ids.request });
    assert.deepEqual(result, { kind: "rejected", diagnostics: [{ code: resultCode }] });
  }

  const ready = await canonicalReadiness.readSnapshot({ decisionRequestId: ids.request });
  assert.equal(ready.kind, "ready");
  if (ready.kind === "ready") assert.deepEqual({ profile: ready.snapshot.profileId, sourceVersion: ready.snapshot.sourceVersion, rowVersion: ready.snapshot.expectedProfileRowVersion }, { profile: ids.profile, sourceVersion: 7, rowVersion: 9 });

  const incompatibleReadyPayload = await readiness(transport({
    async readCanonicalApprovalSnapshotV2() { return [snapshotRow("canonical_snapshot_v2_ready", { plan_code: "solo_lite", source_type: "business_kyb_review" })]; },
  })).readSnapshot({ decisionRequestId: ids.request });
  assert.deepEqual(incompatibleReadyPayload, { kind: "rejected", diagnostics: [{ code: "canonical_readiness_response_invalid" }] });

  const unknown = await readiness(transport({
    async issueCanonicalApprovalDecisionRequestV2() { return [issueRow("unexpected_code")]; },
  })).issue({ profileId: ids.profile, targetComplianceStatus: "lite_verified", policyVersion: "phase-2-v1" });
  assert.deepEqual(unknown, { kind: "rejected", diagnostics: [{ code: "canonical_readiness_result_unknown" }] });

  const callerCannotAssertSuperAdmin = await readiness(transport(), resolver({
    async resolveServerSessionReviewer() { return { actorKind: "merchant_owner", reviewerId: ids.reviewer }; },
  })).issue({ profileId: ids.profile, targetComplianceStatus: "lite_verified", policyVersion: "phase-2-v1", authority: derivedSuperAdmin } as never);
  assert.deepEqual(callerCannotAssertSuperAdmin, { kind: "rejected", diagnostics: [{ code: "canonical_readiness_authority_denied" }] });
  const nonAdminDenied = await readiness(transport(), resolver({
    async resolveServerSessionReviewer() { return { actorKind: "merchant_owner", reviewerId: ids.reviewer }; },
  })).readSnapshot({ decisionRequestId: ids.request });
  assert.deepEqual(nonAdminDenied, { kind: "rejected", diagnostics: [{ code: "canonical_readiness_authority_denied" }] });
  const resolverFailure = await readiness(transport(), resolver({ async resolveServerSessionReviewer() { throw new Error("sensitive resolver failure"); } })).issue({ profileId: ids.profile, targetComplianceStatus: "lite_verified", policyVersion: "phase-2-v1" });
  assert.deepEqual(resolverFailure, { kind: "rejected", diagnostics: [{ code: "canonical_readiness_authority_denied" }] });
  const transportFailure = await readiness(transport({ async issueCanonicalApprovalDecisionRequestV2() { throw new Error("sensitive database failure"); } })).issue({ profileId: ids.profile, targetComplianceStatus: "lite_verified", policyVersion: "phase-2-v1" });
  assert.deepEqual(transportFailure, { kind: "rejected", diagnostics: [{ code: "canonical_readiness_transport_failed" }] });

  const unknownReason = await readiness(transport({
    async readCanonicalApprovalSnapshotV2() { return [snapshotRow("canonical_snapshot_v2_ready", { reason_code: "untrusted_reason" })]; },
  })).readSnapshot({ decisionRequestId: ids.request });
  assert.deepEqual(unknownReason, { kind: "rejected", diagnostics: [{ code: "canonical_readiness_response_invalid" }] });

  const order: string[] = [];
  const ordered = readiness({
    ...transport(),
    async issueCanonicalApprovalDecisionRequestV2(name, args) { order.push("rpc"); return transport().issueCanonicalApprovalDecisionRequestV2(name, args); },
  }, resolver({ async resolveServerSessionReviewer() { order.push("resolver"); return derivedSuperAdmin; } }));
  await ordered.issue({ profileId: ids.profile, targetComplianceStatus: "lite_verified", policyVersion: "phase-2-v1" });
  assert.deepEqual(order, ["resolver", "rpc"]);

  const require = createRequire(import.meta.url);
  const serverOnlyShimPath = require.resolve("server-only");
  const serverOnlyShim = new Module(serverOnlyShimPath);
  serverOnlyShim.filename = serverOnlyShimPath;
  serverOnlyShim.loaded = true;
  serverOnlyShim.exports = {};
  require.cache[serverOnlyShimPath] = serverOnlyShim as never;
  const serviceModule = require("../src/lib/compliance/server/canonical-approval-readiness-service") as ServiceModule;
  let serviceCall: { name: string; args: unknown } | null = null;
  const readinessService = serviceModule.createCanonicalApprovalReadinessService({
    reviewerResolver: resolver(),
    createServiceRoleRpcClient: () => ({
      async rpc(name, args) {
        serviceCall = { name, args };
        return { data: [issueRow("canonical_request_v2_created")], error: null };
      },
    }),
  });
  await readinessService.issue({ profileId: ids.profile, targetComplianceStatus: "lite_verified", policyVersion: "phase-2-v1" });
  assert.deepEqual(serviceCall, {
    name: ISSUE_CANONICAL_APPROVAL_DECISION_REQUEST_V2_RPC,
    args: { p_profile_id: ids.profile, p_reviewer_id: ids.reviewer, p_target_compliance_status: "lite_verified", p_policy_version: "phase-2-v1", p_reason_code: null },
  });

  const facade = readFileSync("src/lib/compliance/canonical-approval-readiness.ts", "utf8");
  const core = readFileSync("src/lib/compliance/canonical-approval-readiness-core.ts", "utf8");
  const serviceSource = readFileSync("src/lib/compliance/server/canonical-approval-readiness-service.ts", "utf8");
  assert.match(facade, /^import\s+["']server-only["']/);
  assert.match(serviceSource, /^import\s+["']server-only["']/);
  assert.match(core, /issue_canonical_approval_decision_request_v2/);
  assert.match(core, /read_canonical_approval_snapshot_v2/);
  assert.doesNotMatch(core, /interface\s+IssueCanonicalApprovalReadinessCommand\s*\{[^}]*authority\s*:/);
  assert.doesNotMatch(core, /interface\s+ReadCanonicalApprovalSnapshotCommand\s*\{[^}]*authority\s*:/);
  assert.doesNotMatch(serviceSource, /export\s+(?:const|function|class)[\s\S]*?(?:createClient|Supabase|\.from|\.insert|\.update|\.delete)/);
  assert.doesNotMatch(core, /\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|setup_mode|live_features_enabled|can_collect_payments|activation_status|payment_records|providers|invoices|subscriptions|checkout|storefront/i);
  for (const file of sourceFiles("src/app")) {
    const content = readFileSync(file, "utf8");
    assert.doesNotMatch(content, /canonical-approval-readiness|canonicalApprovalReadiness/);
  }
  for (const file of sourceFiles("src/lib")) {
    if (file.includes("canonical-approval-readiness")) continue;
    const content = readFileSync(file, "utf8");
    if (/\b(?:route\.ts|page\.tsx)\b/.test(file) || /actions|webhooks|payment|provider|checkout|subscription|invoice|storefront/i.test(file)) {
      assert.doesNotMatch(content, /canonical-approval-readiness|canonicalApprovalReadiness/);
    }
  }
  console.log("canonical-approval-readiness.test.ts passed");
}

void run();
