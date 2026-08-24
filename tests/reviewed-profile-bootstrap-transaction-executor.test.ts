import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { persistReviewedProfileBootstrap, type ReviewedProfileBootstrapAtomicWriter } from "../src/lib/compliance/reviewed-profile-bootstrap-persistence-core";
import { createReviewedProfileBootstrapTransactionExecutor, ReviewedProfileBootstrapTransactionExecutorError, type ReviewedProfileBootstrapTransactionClient } from "../src/lib/compliance/reviewed-profile-bootstrap-transaction-executor-core";
import type { ReviewedProfileBootstrapPayload } from "../src/lib/compliance/reviewed-profile-bootstrap-core";

function payload(overrides: Partial<ReviewedProfileBootstrapPayload> = {}): ReviewedProfileBootstrapPayload {
  return {
    merchantId: "merchant-1", workspaceId: "workspace-1", bootstrapKey: "bootstrap-1", planCode: "solo_lite",
    complianceStatus: "lite_pending", activationStatus: "test_mode", restrictionState: null,
    reviewSourceId: "case-or-review-1", reviewedBy: "admin-1", reviewedAt: "2026-08-24T00:00:00.000Z",
    merchantEntitlements: { canCollectPayments: false, canUseInstantSale: false, canUseReceivableSale: false, canUseStorefront: false, canActivateSettlement: false, canUseDepositBalance: false },
    ...overrides,
  };
}

function writer(overrides: Partial<ReviewedProfileBootstrapAtomicWriter> = {}) {
  const writes: Array<{ table: string; row: Record<string, unknown> }> = [];
  const value: ReviewedProfileBootstrapAtomicWriter = {
    findProfiles: async () => [], findReviewByIdempotencyKey: async () => [], findEventByIdempotencyKey: async () => [],
    insertProfile: async (row) => { writes.push({ table: "merchant_compliance_profiles", row }); return { id: String(row.id) }; },
    insertReview: async (row) => { writes.push({ table: "merchant_compliance_reviews", row }); return { id: String(row.id) }; },
    insertEvent: async (row) => { writes.push({ table: "merchant_compliance_events", row }); return { id: String(row.id) }; },
    ...overrides,
  };
  return { value, writes };
}

function client(mock: ReviewedProfileBootstrapAtomicWriter) {
  let calls = 0; let committed = 0; let rolledBack = 0;
  const value: ReviewedProfileBootstrapTransactionClient = {
    async runServiceRoleTransaction<T>(operation: (transactionWriter: ReviewedProfileBootstrapAtomicWriter) => Promise<T>): Promise<T> {
      calls += 1;
      try { const result = await operation(mock); committed += 1; return result; }
      catch (error) { rolledBack += 1; throw error; }
    },
  };
  return { value, calls: () => calls, committed: () => committed, rolledBack: () => rolledBack };
}

function executor(transactionClient: ReviewedProfileBootstrapTransactionClient, role: "service_role" | "anon" | "authenticated" | "browser" | "unknown" = "service_role") {
  return createReviewedProfileBootstrapTransactionExecutor({ databaseRole: role, internalReviewAuthorized: role === "service_role" }, transactionClient);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  for (const [planCode, complianceStatus] of [["solo_lite", "lite_pending"], ["business", "business_pending"]] as const) {
    const mock = writer(); const tx = client(mock.value);
    const result = await persistReviewedProfileBootstrap(payload({ planCode, complianceStatus }), executor(tx.value));
    assert.equal(result.kind, "created"); assert.equal(tx.calls(), 1); assert.equal(tx.committed(), 1); assert.equal(tx.rolledBack(), 0);
    assert.deepEqual(mock.writes.map((write) => write.table), ["merchant_compliance_profiles", "merchant_compliance_reviews", "merchant_compliance_events"]);
    assert.equal(mock.writes[0].row.activation_status, "test_mode"); assert.equal(mock.writes[0].row.restriction_state, null);
    assert.equal(mock.writes[0].row.can_collect_payments, false);
  }

  const soloPlus = writer(); const soloPlusTx = client(soloPlus.value);
  const soloPlusResult = await persistReviewedProfileBootstrap(payload({ planCode: "solo_plus", complianceStatus: "enhanced_pending" }), executor(soloPlusTx.value));
  assert.equal(soloPlusResult.kind, "created");
  assert.equal(soloPlus.writes.some((write) => write.table === "merchant_compliance_reviews"), false);
  assert.equal(soloPlus.writes[0].row.decision_source_type, "solo_plus_case");

  for (const role of ["anon", "authenticated", "browser", "unknown"] as const) {
    const tx = client(writer().value);
    await assert.rejects(
      () => executor(tx.value, role).executeAtomically(async () => "nope"),
      (error: unknown) => error instanceof ReviewedProfileBootstrapTransactionExecutorError && error.code === "bootstrap_executor_context_denied",
    );
    assert.equal(tx.calls(), 0);
  }

  for (const existing of [
    { id: "p", merchantId: "merchant-1", complianceStatus: "lite_verified", restrictionState: null },
    { id: "p", merchantId: "merchant-1", complianceStatus: "rejected", restrictionState: null },
    { id: "p", merchantId: "merchant-1", complianceStatus: "restricted", restrictionState: "restricted" },
    { id: "p", merchantId: "merchant-1", complianceStatus: "lite_pending", restrictionState: "suspended" },
  ]) {
    const mock = writer({ findProfiles: async () => [existing] });
    const result = await persistReviewedProfileBootstrap(payload(), executor(client(mock.value).value));
    assert.equal(result.kind, "existing"); assert.equal(mock.writes.length, 0);
  }
  for (const duplicate of [
    writer({ findProfiles: async () => [{ id: "a", merchantId: "merchant-1", complianceStatus: "draft", restrictionState: null }, { id: "b", merchantId: "merchant-1", complianceStatus: "draft", restrictionState: null }] }),
    writer({ findReviewByIdempotencyKey: async () => [{ id: "a", merchantId: "merchant-1", idempotencyKey: "bootstrap-1" }, { id: "b", merchantId: "merchant-1", idempotencyKey: "bootstrap-1" }] }),
    writer({ findEventByIdempotencyKey: async () => [{ id: "a", merchantId: "merchant-1", idempotencyKey: "bootstrap-1:bootstrap" }, { id: "b", merchantId: "merchant-1", idempotencyKey: "bootstrap-1:bootstrap" }] }),
  ]) {
    assert.equal(
      (await persistReviewedProfileBootstrap(payload(), executor(client(duplicate.value).value))).kind,
      "rejected",
    );
  }

  for (const failure of ["insertProfile", "insertReview", "insertEvent"] as const) {
    const mock = writer({ [failure]: async () => { throw new Error("sensitive database detail"); } });
    const tx = client(mock.value);
    const result = await persistReviewedProfileBootstrap(payload(), executor(tx.value));
    assert.equal(result.kind, "rejected"); assert.equal(tx.rolledBack(), 1); assert.doesNotMatch(JSON.stringify(result), /sensitive/i);
  }
  for (const input of [
    payload({ complianceStatus: "rejected", activationStatus: "restricted" }),
    payload({ complianceStatus: "restricted", activationStatus: "suspended", restrictionState: "suspended" }),
  ]) {
    const mock = writer(); const result = await persistReviewedProfileBootstrap(input, executor(client(mock.value).value));
    assert.equal(result.kind, "created"); assert.notEqual(mock.writes[0].row.activation_status, "approved");
  }

  const facade = readFileSync("src/lib/compliance/reviewed-profile-bootstrap-transaction-executor.ts", "utf8");
  const core = readFileSync("src/lib/compliance/reviewed-profile-bootstrap-transaction-executor-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|payment_records|subscriptions|merchants|workspaces|paystack|monnify|breet/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /reviewed-profile-bootstrap-transaction-executor/);
  console.log("reviewed-profile-bootstrap-transaction-executor.test.ts passed");
}
void run();
