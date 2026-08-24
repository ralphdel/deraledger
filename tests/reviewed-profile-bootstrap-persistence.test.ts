import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { persistReviewedProfileBootstrap, type ReviewedProfileBootstrapAtomicWriter } from "../src/lib/compliance/reviewed-profile-bootstrap-persistence-core";
import type { ReviewedProfileBootstrapPayload } from "../src/lib/compliance/reviewed-profile-bootstrap-core";

function payload(overrides: Partial<ReviewedProfileBootstrapPayload> = {}): ReviewedProfileBootstrapPayload {
  return {
    merchantId: "merchant-1", workspaceId: "workspace-1", bootstrapKey: "key-1", planCode: "solo_lite",
    complianceStatus: "lite_pending", activationStatus: "test_mode", restrictionState: null,
    reviewSourceId: "trusted-review-source", reviewedBy: "admin-1", reviewedAt: "2026-08-23T00:00:00.000Z",
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

function atomic(mock: ReviewedProfileBootstrapAtomicWriter) {
  let calls = 0;
  return { database: { executeAtomically: async <T>(operation: (writer: ReviewedProfileBootstrapAtomicWriter) => Promise<T>) => { calls += 1; return operation(mock); } }, calls: () => calls };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  for (const [planCode, complianceStatus] of [["solo_lite", "lite_pending"], ["solo_plus", "enhanced_pending"], ["business", "business_pending"]] as const) {
    const mock = writer(); const db = atomic(mock.value);
    const result = await persistReviewedProfileBootstrap(payload({ planCode, complianceStatus }), db.database);
    assert.equal(result.kind, "created"); assert.equal(db.calls(), 1);
    assert.equal(mock.writes[0].row.activation_status, "test_mode");
    assert.equal(mock.writes[0].row.restriction_state, null);
    assert.equal(mock.writes[0].row.can_collect_payments, false);
    assert.equal(mock.writes[0].row.can_use_deposit_balance, false);
    assert.equal(mock.writes.some((item) => item.table === "merchant_compliance_events"), true);
    assert.equal(mock.writes.some((item) => item.table === "merchant_compliance_reviews"), planCode !== "solo_plus");
  }

  for (const input of [
    payload({ complianceStatus: "rejected", activationStatus: "restricted" }),
    payload({ complianceStatus: "restricted", activationStatus: "suspended", restrictionState: "suspended" }),
  ]) {
    const mock = writer(); const result = await persistReviewedProfileBootstrap(input, atomic(mock.value).database);
    assert.equal(result.kind, "created"); assert.notEqual(mock.writes[0].row.activation_status, "approved");
  }

  const idempotent = writer({ findReviewByIdempotencyKey: async () => [{ id: "review-1", merchantId: "merchant-1", idempotencyKey: "key-1" }] });
  const repeat = await persistReviewedProfileBootstrap(payload(), atomic(idempotent.value).database);
  assert.equal(repeat.kind, "existing"); assert.equal(idempotent.writes.length, 0);

  for (const profile of [
    { id: "profile-1", merchantId: "merchant-1", complianceStatus: "lite_verified", restrictionState: null },
    { id: "profile-1", merchantId: "merchant-1", complianceStatus: "rejected", restrictionState: null },
    { id: "profile-1", merchantId: "merchant-1", complianceStatus: "restricted", restrictionState: "restricted" },
  ]) {
    const mock = writer({ findProfiles: async () => [profile] });
    const result = await persistReviewedProfileBootstrap(payload(), atomic(mock.value).database);
    assert.equal(result.kind, "existing"); assert.equal(mock.writes.length, 0);
  }
  const duplicate = writer({ findProfiles: async () => [
    { id: "a", merchantId: "merchant-1", complianceStatus: "lite_pending", restrictionState: null },
    { id: "b", merchantId: "merchant-1", complianceStatus: "lite_pending", restrictionState: null },
  ] });
  assert.equal((await persistReviewedProfileBootstrap(payload(), atomic(duplicate.value).database)).kind, "rejected");
  const duplicateEvent = writer({ findEventByIdempotencyKey: async () => [
    { id: "event-a", merchantId: "merchant-1", idempotencyKey: "key-1:bootstrap" },
    { id: "event-b", merchantId: "merchant-1", idempotencyKey: "key-1:bootstrap" },
  ] });
  assert.equal((await persistReviewedProfileBootstrap(payload(), atomic(duplicateEvent.value).database)).kind, "rejected");

  for (const failure of ["insertProfile", "insertReview", "insertEvent"] as const) {
    const mock = writer({ [failure]: async () => { throw new Error("write failed"); } });
    const result = await persistReviewedProfileBootstrap(payload(), atomic(mock.value).database);
    assert.deepEqual(result, { kind: "rejected", diagnostics: [{ code: "bootstrap_atomic_write_failed" }] });
  }
  const unsafePayload = {
    ...payload(),
    merchantEntitlements: { ...payload().merchantEntitlements, canCollectPayments: true },
  } as unknown as ReviewedProfileBootstrapPayload;
  const unsafe = await persistReviewedProfileBootstrap(unsafePayload, atomic(writer().value).database);
  assert.equal(unsafe.kind, "rejected");

  const facade = readFileSync("src/lib/compliance/reviewed-profile-bootstrap-persistence.ts", "utf8");
  const core = readFileSync("src/lib/compliance/reviewed-profile-bootstrap-persistence-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|paystack|monnify|breet|payment_records|subscriptions|merchants|workspaces/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /reviewed-profile-bootstrap-persistence/);
  console.log("reviewed-profile-bootstrap-persistence.test.ts passed");
}
void run();
