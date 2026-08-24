import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  prepareComplianceProfileApprovalCommand,
  type ComplianceProfileApprovalCommandRequest,
} from "../src/lib/compliance/compliance-profile-approval-command-core";
import type {
  ComplianceProfileApprovalAtomicWriter,
  ComplianceProfileApprovalPersistenceSnapshot,
} from "../src/lib/compliance/compliance-profile-approval-persistence-core";
import {
  executeComplianceProfileApprovalTransaction,
  type ComplianceProfileApprovalTransactionRunner,
} from "../src/lib/compliance/compliance-profile-approval-transaction-executor-core";

const context = { databaseRole: "service_role" as const, internalReviewAuthorized: true };
const identity = { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" as const };
const reviewer = { reviewerId: "reviewer-1", authorization: "internal_compliance_reviewer" as const, authorized: true as const };
const evidence = {
  sourceType: "solo_lite_review" as const, sourceId: "source-1", evidenceVersion: 1,
  evidenceState: "complete" as const, reviewedAt: "2026-08-24T15:00:00.000Z",
  policyVersion: "phase-2-v1", authority: "trusted_review_workflow" as const,
};

function request(overrides: Partial<ComplianceProfileApprovalCommandRequest> = {}): ComplianceProfileApprovalCommandRequest {
  return {
    identity, approvalDecisionKey: "approval-1", expectedProfileRowVersion: 2,
    plan: "solo_lite", sourceComplianceStatus: "lite_pending", targetComplianceStatus: "lite_verified",
    reviewer, evidence, restrictionOutcome: "none", ...overrides,
  };
}

function command(input = request()) {
  const result = prepareComplianceProfileApprovalCommand(input);
  assert.equal(result.kind, "prepared");
  return result.payload;
}

function state(overrides: Partial<ComplianceProfileApprovalPersistenceSnapshot> = {}): ComplianceProfileApprovalPersistenceSnapshot {
  return {
    profiles: [{ id: "profile-1", merchantId: "merchant-1", complianceStatus: "lite_pending", activationStatus: "test_mode", restrictionState: null, rowVersion: 2 }],
    reviews: [{ id: "review-1", merchantId: "merchant-1", profileId: "profile-1", reviewType: "solo_lite", sourceId: "source-1", rowVersion: 1 }],
    soloPlusCases: [], events: [], ...overrides,
  };
}

function writer(snapshot: ComplianceProfileApprovalPersistenceSnapshot, overrides: Partial<ComplianceProfileApprovalAtomicWriter> = {}) {
  const writes: Array<{ operation: string; row: Record<string, unknown> }> = [];
  const value: ComplianceProfileApprovalAtomicWriter = {
    findProfiles: async () => snapshot.profiles,
    findReviewsByApprovalSource: async () => snapshot.reviews,
    findSoloPlusCasesByApprovalSource: async () => snapshot.soloPlusCases,
    findEventsByApprovalDecisionKey: async () => snapshot.events,
    updateProfileDecision: async (row) => { writes.push({ operation: "profile", row }); return { id: "profile-1", rowVersion: 3 }; },
    updateReviewDecision: async (row) => { writes.push({ operation: "review", row }); return { id: "review-1", rowVersion: 2 }; },
    bindSoloPlusCaseDecision: async (row) => { writes.push({ operation: "case", row }); return { id: "case-1", rowVersion: 4 }; },
    appendApprovalEvent: async (row) => { writes.push({ operation: "event", row }); return { id: "event-1" }; },
    ...overrides,
  };
  return { value, writes };
}

function runner(mock: ComplianceProfileApprovalAtomicWriter) {
  let calls = 0; let commits = 0; let rollbacks = 0;
  const value: ComplianceProfileApprovalTransactionRunner = {
    async runServiceRoleTransaction<T>(operation: (transactionWriter: ComplianceProfileApprovalAtomicWriter) => Promise<T>): Promise<T> {
      calls += 1;
      try { const result = await operation(mock); commits += 1; return result; }
      catch (error) { rollbacks += 1; throw error; }
    },
  };
  return { value, calls: () => calls, commits: () => commits, rollbacks: () => rollbacks };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  for (const [plan, sourceStatus, targetStatus, sourceType, reviewType] of [
    ["solo_lite", "lite_pending", "lite_verified", "solo_lite_review", "solo_lite"],
    ["business", "business_pending", "business_verified", "business_kyb_review", "business_kyb"],
  ] as const) {
    const input = command(request({ plan, sourceComplianceStatus: sourceStatus, targetComplianceStatus: targetStatus, evidence: { ...evidence, sourceType } }));
    const mock = writer(state({
      profiles: [{ id: "profile-1", merchantId: "merchant-1", complianceStatus: sourceStatus, activationStatus: "test_mode", restrictionState: null, rowVersion: 2 }],
      reviews: [{ id: "review-1", merchantId: "merchant-1", profileId: "profile-1", reviewType, sourceId: "source-1", rowVersion: 1 }],
    }));
    const tx = runner(mock.value);
    const result = await executeComplianceProfileApprovalTransaction(input, context, tx.value);
    assert.equal(result.kind, "created"); assert.equal(tx.calls(), 1); assert.equal(tx.commits(), 1); assert.equal(tx.rollbacks(), 0);
    assert.deepEqual(mock.writes.map((item) => item.operation), ["profile", "review", "event"]);
    assert.equal(mock.writes[0].row.activation_status, "test_mode");
    assert.equal(mock.writes[0].row.can_collect_payments, false);
  }

  const soloPlus = command(request({
    plan: "solo_plus", sourceComplianceStatus: "enhanced_pending", targetComplianceStatus: "enhanced_verified",
    evidence: { ...evidence, sourceType: "solo_plus_case" },
  }));
  const soloPlusMock = writer(state({
    profiles: [{ id: "profile-1", merchantId: "merchant-1", complianceStatus: "enhanced_pending", activationStatus: "test_mode", restrictionState: null, rowVersion: 2 }],
    reviews: [], soloPlusCases: [{ id: "case-1", merchantId: "merchant-1", profileId: "profile-1", sourceId: "source-1", rowVersion: 3 }],
  }));
  const soloPlusResult = await executeComplianceProfileApprovalTransaction(soloPlus, context, runner(soloPlusMock.value).value);
  assert.equal(soloPlusResult.kind, "created");
  assert.deepEqual(soloPlusMock.writes.map((item) => item.operation), ["profile", "case", "event"]);
  assert.equal(soloPlusMock.writes.some((item) => item.operation === "review"), false);

  for (const role of ["anon", "authenticated", "browser", "unknown"] as const) {
    const tx = runner(writer(state()).value);
    const result = await executeComplianceProfileApprovalTransaction(command(), { databaseRole: role, internalReviewAuthorized: false }, tx.value);
    assert.deepEqual(result, { kind: "rejected", diagnostics: [{ code: "approval_transaction_context_denied" }] });
    assert.equal(tx.calls(), 0);
  }
  assert.deepEqual(await executeComplianceProfileApprovalTransaction(command(), context, null), { kind: "rejected", diagnostics: [{ code: "approval_transaction_runner_missing" }] });

  const replayMock = writer(state({ events: [{ id: "event-1", merchantId: "merchant-1", profileId: "profile-1", idempotencyKey: "approval-1", sourceType: "solo_lite_review", sourceId: "source-1", complianceStatus: "lite_verified", resultingRowVersion: 3 }] }));
  const replay = await executeComplianceProfileApprovalTransaction(command(), context, runner(replayMock.value).value);
  assert.equal(replay.kind, "replay"); assert.equal(replayMock.writes.length, 0);

  for (const profile of [
    { complianceStatus: "lite_verified", activationStatus: "test_mode", restrictionState: null },
    { complianceStatus: "rejected", activationStatus: "restricted", restrictionState: null },
    { complianceStatus: "restricted", activationStatus: "restricted", restrictionState: "restricted" },
    { complianceStatus: "restricted", activationStatus: "suspended", restrictionState: "suspended" },
  ]) {
    const mock = writer(state({ profiles: [{ id: "profile-1", merchantId: "merchant-1", rowVersion: 2, ...profile }] }));
    assert.equal((await executeComplianceProfileApprovalTransaction(command(), context, runner(mock.value).value)).kind, "preserved");
    assert.equal(mock.writes.length, 0);
  }
  for (const invalid of [
    state({ profiles: [state().profiles[0], { ...state().profiles[0], id: "profile-2" }] }),
    state({ reviews: [state().reviews[0], { ...state().reviews[0], id: "review-2" }] }),
    state({ soloPlusCases: [{ id: "case-1", merchantId: "merchant-1", profileId: "profile-1", sourceId: "source-1", rowVersion: 1 }, { id: "case-2", merchantId: "merchant-1", profileId: "profile-1", sourceId: "source-1", rowVersion: 1 }] }),
    state({ events: [{ id: "e1", merchantId: "merchant-1", profileId: "profile-1", idempotencyKey: "approval-1", sourceType: "solo_lite_review", sourceId: "source-1", complianceStatus: "lite_verified", resultingRowVersion: 3 }, { id: "e2", merchantId: "merchant-1", profileId: "profile-1", idempotencyKey: "approval-1", sourceType: "solo_lite_review", sourceId: "source-1", complianceStatus: "lite_verified", resultingRowVersion: 3 }] }),
  ]) {
    const result = await executeComplianceProfileApprovalTransaction(command(), context, runner(writer(invalid).value).value);
    assert.equal(result.kind, "rejected");
  }
  const stale = await executeComplianceProfileApprovalTransaction(command(), context, runner(writer(state({ profiles: [{ ...state().profiles[0], rowVersion: 1 }] })).value).value);
  assert.deepEqual(stale, { kind: "rejected", diagnostics: [{ code: "approval_row_version_conflict" }] });

  for (const failure of ["updateProfileDecision", "updateReviewDecision", "bindSoloPlusCaseDecision", "appendApprovalEvent"] as const) {
    const input = failure === "bindSoloPlusCaseDecision" ? soloPlus : command();
    const mockState = failure === "bindSoloPlusCaseDecision" ? {
      profiles: [{ id: "profile-1", merchantId: "merchant-1", complianceStatus: "enhanced_pending", activationStatus: "test_mode", restrictionState: null, rowVersion: 2 }], reviews: [], soloPlusCases: [{ id: "case-1", merchantId: "merchant-1", profileId: "profile-1", sourceId: "source-1", rowVersion: 3 }], events: [],
    } : state();
    const mock = writer(mockState, { [failure]: async () => { throw new Error("sensitive detail"); } });
    const tx = runner(mock.value);
    const result = await executeComplianceProfileApprovalTransaction(input, context, tx.value);
    assert.deepEqual(result, { kind: "rejected", diagnostics: [{ code: "approval_transaction_atomic_write_failed" }] });
    assert.equal(tx.rollbacks(), 1);
    assert.doesNotMatch(JSON.stringify(result), /sensitive/i);
  }

  const payload = command();
  assert.equal(payload.merchantEntitlements.canCollectPayments, false);
  assert.equal(payload.merchantEntitlements.canUseDepositBalance, false);
  assert.notEqual(payload.activationStatus, "approved");

  const facade = readFileSync("src/lib/compliance/compliance-profile-approval-transaction-executor.ts", "utf8");
  const core = readFileSync("src/lib/compliance/compliance-profile-approval-transaction-executor-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.delete\(|\.upsert\(|rpc\(|paystack|monnify|breet/i);
  assert.doesNotMatch(core, /updateMerchant|updateWorkspace|updateSubscription|updateInvoice|insertLimit/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /compliance-profile-approval-transaction-executor/);
  }
  console.log("compliance-profile-approval-transaction-executor.test.ts passed");
}

void run();
