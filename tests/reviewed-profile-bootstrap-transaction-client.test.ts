import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { persistReviewedProfileBootstrap, type ReviewedProfileBootstrapAtomicWriter } from "../src/lib/compliance/reviewed-profile-bootstrap-persistence-core";
import { createReviewedProfileBootstrapTransactionExecutor } from "../src/lib/compliance/reviewed-profile-bootstrap-transaction-executor-core";
import { createReviewedProfileBootstrapServiceRoleTransactionClient, ReviewedProfileBootstrapTransactionClientError, type ReviewedProfileBootstrapServiceRoleTransactionTransport } from "../src/lib/compliance/reviewed-profile-bootstrap-transaction-client-core";
import type { ReviewedProfileBootstrapPayload } from "../src/lib/compliance/reviewed-profile-bootstrap-core";

function payload(overrides: Partial<ReviewedProfileBootstrapPayload> = {}): ReviewedProfileBootstrapPayload {
  return {
    merchantId: "merchant-1", workspaceId: "workspace-1", bootstrapKey: "bootstrap-1", planCode: "solo_lite",
    complianceStatus: "lite_pending", activationStatus: "test_mode", restrictionState: null,
    reviewSourceId: "source-1", reviewedBy: "admin-1", reviewedAt: "2026-08-24T00:00:00.000Z",
    merchantEntitlements: { canCollectPayments: false, canUseInstantSale: false, canUseReceivableSale: false, canUseStorefront: false, canActivateSettlement: false, canUseDepositBalance: false },
    ...overrides,
  };
}

function writer(overrides: Partial<ReviewedProfileBootstrapAtomicWriter> = {}) {
  const operations: Array<{ table: string; row: Record<string, unknown> }> = [];
  const value: ReviewedProfileBootstrapAtomicWriter = {
    findProfiles: async () => [], findReviewByIdempotencyKey: async () => [], findEventByIdempotencyKey: async () => [],
    insertProfile: async (row) => { operations.push({ table: "merchant_compliance_profiles", row }); return { id: String(row.id) }; },
    insertReview: async (row) => { operations.push({ table: "merchant_compliance_reviews", row }); return { id: String(row.id) }; },
    insertEvent: async (row) => { operations.push({ table: "merchant_compliance_events", row }); return { id: String(row.id) }; },
    ...overrides,
  };
  return { value, operations };
}

function transport(mock: ReviewedProfileBootstrapAtomicWriter) {
  let calls = 0; let committed = 0; let rolledBack = 0;
  const value: ReviewedProfileBootstrapServiceRoleTransactionTransport = {
    async runInTransaction<T>(operation: (session: ReviewedProfileBootstrapAtomicWriter) => Promise<T>): Promise<T> {
      calls += 1;
      try { const result = await operation(mock); committed += 1; return result; }
      catch (error) { rolledBack += 1; throw error; }
    },
  };
  return { value, calls: () => calls, committed: () => committed, rolledBack: () => rolledBack };
}

function database(transactionClient: ReturnType<typeof createReviewedProfileBootstrapServiceRoleTransactionClient>) {
  return createReviewedProfileBootstrapTransactionExecutor(
    { databaseRole: "service_role", internalReviewAuthorized: true }, transactionClient,
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  const initial = writer(); const initialTransport = transport(initial.value);
  const serviceClient = createReviewedProfileBootstrapServiceRoleTransactionClient(
    { databaseRole: "service_role", internalReviewAuthorized: true }, initialTransport.value,
  );
  assert.equal(initialTransport.calls(), 0, "Construction must not access a database");

  for (const [planCode, complianceStatus] of [["solo_lite", "lite_pending"], ["business", "business_pending"]] as const) {
    const mock = writer(); const tx = transport(mock.value);
    const result = await persistReviewedProfileBootstrap(
      payload({ planCode, complianceStatus }),
      database(createReviewedProfileBootstrapServiceRoleTransactionClient({ databaseRole: "service_role", internalReviewAuthorized: true }, tx.value)),
    );
    assert.equal(result.kind, "created"); assert.equal(tx.calls(), 1); assert.equal(tx.committed(), 1);
    assert.deepEqual(mock.operations.map((operation) => operation.table), ["merchant_compliance_profiles", "merchant_compliance_reviews", "merchant_compliance_events"]);
    assert.equal(mock.operations[0].row.activation_status, "test_mode"); assert.equal(mock.operations[0].row.restriction_state, null);
    assert.equal(mock.operations[0].row.can_collect_payments, false);
  }

  const plus = writer(); const plusTx = transport(plus.value);
  const plusResult = await persistReviewedProfileBootstrap(
    payload({ planCode: "solo_plus", complianceStatus: "enhanced_pending" }),
    database(createReviewedProfileBootstrapServiceRoleTransactionClient({ databaseRole: "service_role", internalReviewAuthorized: true }, plusTx.value)),
  );
  assert.equal(plusResult.kind, "created");
  assert.deepEqual(plus.operations.map((operation) => operation.table), ["merchant_compliance_profiles", "merchant_compliance_events"]);
  assert.equal(plus.operations[0].row.decision_source_type, "solo_plus_case");

  for (const role of ["anon", "authenticated", "browser"] as const) {
    const tx = transport(writer().value);
    const denied = createReviewedProfileBootstrapServiceRoleTransactionClient({ databaseRole: role, internalReviewAuthorized: false }, tx.value);
    await assert.rejects(
      () => denied.runServiceRoleTransaction(async () => "nope"),
      (error: unknown) => error instanceof ReviewedProfileBootstrapTransactionClientError && error.code === "bootstrap_transaction_client_context_denied",
    );
    assert.equal(tx.calls(), 0);
  }

  for (const failure of ["insertProfile", "insertReview", "insertEvent"] as const) {
    const mock = writer({ [failure]: async () => { throw new Error("raw payment/provider secret"); } });
    const tx = transport(mock.value);
    const result = await persistReviewedProfileBootstrap(payload(), database(createReviewedProfileBootstrapServiceRoleTransactionClient({ databaseRole: "service_role", internalReviewAuthorized: true }, tx.value)));
    assert.equal(result.kind, "rejected"); assert.equal(tx.rolledBack(), 1); assert.doesNotMatch(JSON.stringify(result), /secret|provider|payment/i);
  }

  const facade = readFileSync("src/lib/compliance/reviewed-profile-bootstrap-transaction-client.ts", "utf8");
  const core = readFileSync("src/lib/compliance/reviewed-profile-bootstrap-transaction-client-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|payment_records|subscriptions|merchants|workspaces|paystack|monnify|breet/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /reviewed-profile-bootstrap-transaction-client/);
  console.log("reviewed-profile-bootstrap-transaction-client.test.ts passed");
}
void run();
