import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  prepareCommitCommand,
  prepareLimitApprovalCommand,
  prepareReleaseCommand,
  prepareReservationCommand,
  prepareReversalCommand,
  type CollectionLimitCommandResult,
} from "../src/lib/compliance/collection-limit-engine-command-core";
import type {
  CollectionLimitEngineAtomicWriter,
  CollectionLimitEnginePersistenceSnapshot,
} from "../src/lib/compliance/collection-limit-engine-persistence-core";
import {
  executeCollectionLimitTransaction,
  type CollectionLimitTransactionRunner,
} from "../src/lib/compliance/collection-limit-engine-transaction-executor-core";

const context = { databaseRole: "service_role" as const, internalCollectionEngineAuthorized: true };
const identity = { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" as const };
const readiness = { profileId: "profile-1", complianceStatus: "lite_verified" as const, entitlementId: "entitlement-1", entitlementState: "active_paid" as const, planCode: "solo_lite" as const, riskTier: "low" as const, reviewerDecisionId: "review-1", payoutReadinessId: "payout-1", providerEnvironmentMappingId: "mapping-1", authority: "trusted_collection_readiness" as const };
const policy = { policyTimezone: "Africa/Lagos" as const, windowStart: "2026-08-24T00:00:00.000Z", windowEnd: "2026-08-25T00:00:00.000Z" };
const activeWindow = { id: "window-1", merchantId: "merchant-1", profileId: "profile-1", windowType: "daily_velocity" as const, lifecycle: "active" as const, rowVersion: 1 };
const reservedReservation = { id: "reservation-1", merchantId: "merchant-1", profileId: "profile-1", internalReference: "DL-1", amountNgn: 5000, currency: "NGN" as const, status: "reserved" as const, rowVersion: 1 };

function payload(result: CollectionLimitCommandResult) {
  assert.equal(result.kind, "prepared");
  if (result.kind !== "prepared") throw new Error("expected prepared payload");
  return result.payload;
}
function limitApproval() { return payload(prepareLimitApprovalCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "limit-1", limitType: "daily_cumulative", currentLifecycle: "proposed", targetLifecycle: "approved", amountNgn: 5000, policy, expectedWindowRowVersion: 1 })); }
function reservation() { return payload(prepareReservationCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "reservation-1", amountNgn: 5000, currency: "NGN", sourceType: "invoice", sourceId: "invoice-1", internalReference: "DL-1", expiresAt: "2026-08-24T12:00:00.000Z", windows: [{ windowId: "window-1", limitType: "daily_cumulative", lifecycle: "active", expectedRowVersion: 1, policy }] })); }
function sourceReservation(status: "reserved" | "committed") { return { reservationId: "reservation-1", merchantId: "merchant-1", workspaceId: "workspace-1", internalReference: "DL-1", amountNgn: 5000, currency: "NGN" as const, status, expectedRowVersion: 1, authority: "trusted_limit_repository" as const }; }
function commit() { return payload(prepareCommitCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "commit-1", reservation: sourceReservation("reserved"), expectedReservationRowVersion: 1, verifiedPaymentReference: "verified-payment-1" })); }
function release(expired = false) { return payload(prepareReleaseCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: expired ? "expiry-1" : "release-1", reservation: sourceReservation("reserved"), expectedReservationRowVersion: 1, reasonCode: expired ? "reservation_expired" : "provider_attempt_failed", outcome: expired ? "expired" : "released" })); }
function reversal() { return payload(prepareReversalCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "reversal-1", reservation: sourceReservation("committed"), expectedReservationRowVersion: 1, reasonCode: "payment_refunded", reversalType: "refund_adjustment" })); }

function snapshot(overrides: Partial<CollectionLimitEnginePersistenceSnapshot> = {}): CollectionLimitEnginePersistenceSnapshot {
  return { windows: [activeWindow], reservations: [reservedReservation], links: [{ reservationId: "reservation-1", windowId: "window-1", amountNgn: 5000 }], events: [], ...overrides };
}
function writer(state: CollectionLimitEnginePersistenceSnapshot, overrides: Partial<CollectionLimitEngineAtomicWriter> = {}) {
  const writes: string[] = [];
  const value: CollectionLimitEngineAtomicWriter = {
    findWindows: async () => state.windows,
    findReservations: async () => state.reservations,
    findReservationLinks: async () => state.links,
    findUsageEvents: async () => state.events,
    createLimitWindow: async () => { writes.push("window:create"); return { id: "window-new", rowVersion: 1 }; },
    updateLimitWindow: async () => { writes.push("window:update"); return { id: "window-1", rowVersion: 2 }; },
    createReservation: async () => { writes.push("reservation:create"); return { id: "reservation-1", rowVersion: 1 }; },
    updateReservation: async () => { writes.push("reservation:update"); return { id: "reservation-1", rowVersion: 2 }; },
    createReservationWindowLink: async () => { writes.push("link:create"); return { reservationId: "reservation-1", windowId: "window-1" }; },
    appendUsageEvent: async () => { writes.push("event:append"); return { id: `event-${writes.length}` }; },
    ...overrides,
  };
  return { value, writes };
}
function runner(mock: CollectionLimitEngineAtomicWriter) {
  let calls = 0; let rollbacks = 0;
  const value: CollectionLimitTransactionRunner = { async runServiceRoleTransaction<T>(operation: (tx: CollectionLimitEngineAtomicWriter) => Promise<T>) { calls += 1; try { return await operation(mock); } catch (error) { rollbacks += 1; throw error; } } };
  return { value, calls: () => calls, rollbacks: () => rollbacks };
}
function sourceFiles(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => { const file = join(directory, entry.name); return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx)$/.test(entry.name) ? [file] : []; }); }

async function run() {
  const cases = [
    [limitApproval(), snapshot({ windows: [] }), "limit_approval"],
    [reservation(), snapshot(), "reservation"],
    [commit(), snapshot(), "commit"],
    [release(), snapshot(), "release"],
    [release(true), snapshot(), "expiry"],
    [reversal(), snapshot({ reservations: [{ ...reservedReservation, status: "committed" }] }), "reversal"],
  ] as const;
  for (const [command, state, operation] of cases) {
    const mock = writer(state); const tx = runner(mock.value);
    const result = await executeCollectionLimitTransaction(command, context, tx.value);
    assert.equal(result.kind, "created");
    if (result.kind === "created") assert.equal(result.operation, operation);
    assert.equal(tx.calls(), 1);
  }

  for (const role of ["anon", "authenticated", "browser", "unknown"] as const) {
    const tx = runner(writer(snapshot()).value);
    const result = await executeCollectionLimitTransaction(reservation(), { databaseRole: role, internalCollectionEngineAuthorized: false }, tx.value);
    assert.deepEqual(result, { kind: "rejected", diagnostics: [{ code: "limit_transaction_context_denied" }] }); assert.equal(tx.calls(), 0);
  }
  assert.deepEqual(await executeCollectionLimitTransaction(reservation(), context, null), { kind: "rejected", diagnostics: [{ code: "limit_transaction_runner_missing" }] });

  const replayState = snapshot({ events: [{ id: "event-1", merchantId: "merchant-1", profileId: "profile-1", windowId: "window-1", reservationId: "reservation-1", internalReference: "DL-1", idempotencyKey: "commit-1", eventType: "collection_committed", reasonCode: null }] });
  const replayWrites = writer(replayState);
  assert.equal((await executeCollectionLimitTransaction(commit(), context, runner(replayWrites.value).value)).kind, "replay"); assert.equal(replayWrites.writes.length, 0);
  const mismatch = await executeCollectionLimitTransaction(commit(), context, runner(writer(snapshot({ events: [{ ...replayState.events[0], merchantId: "other" }] })).value).value);
  assert.equal(mismatch.kind, "rejected");

  for (const lifecycle of ["exhausted", "expired", "suspended", "revoked"] as const) {
    assert.deepEqual(await executeCollectionLimitTransaction(reservation(), context, runner(writer(snapshot({ windows: [{ ...activeWindow, lifecycle }] })).value).value), { kind: "rejected", diagnostics: [{ code: "limit_window_not_reservable" }] });
  }
  assert.equal((await executeCollectionLimitTransaction(reservation(), context, runner(writer(snapshot({ windows: [activeWindow, { ...activeWindow }] })).value).value)).kind, "rejected");
  assert.equal((await executeCollectionLimitTransaction(commit(), context, runner(writer(snapshot({ reservations: [reservedReservation, { ...reservedReservation, id: "reservation-2" }] })).value).value)).kind, "rejected");
  assert.equal((await executeCollectionLimitTransaction(commit(), context, runner(writer(snapshot({ links: [{ reservationId: "reservation-1", windowId: "window-1", amountNgn: 5000 }, { reservationId: "reservation-1", windowId: "window-1", amountNgn: 5000 }] })).value).value)).kind, "rejected");
  assert.equal((await executeCollectionLimitTransaction(commit(), context, runner(writer(snapshot({ events: [replayState.events[0], { ...replayState.events[0], id: "event-2" }] })).value).value)).kind, "rejected");
  assert.equal((await executeCollectionLimitTransaction(commit(), context, runner(writer(snapshot({ reservations: [{ ...reservedReservation, rowVersion: 2 }] })).value).value)).kind, "rejected");
  assert.equal((await executeCollectionLimitTransaction(commit(), context, runner(writer(snapshot({ reservations: [] })).value).value)).kind, "rejected");
  assert.equal((await executeCollectionLimitTransaction(reversal(), context, runner(writer(snapshot()).value).value)).kind, "rejected");

  for (const method of ["updateLimitWindow", "createReservation", "createReservationWindowLink", "appendUsageEvent"] as const) {
    const mock = writer(snapshot(), { [method]: async () => { throw new Error("sensitive provider detail"); } }); const tx = runner(mock.value);
    const input = method === "appendUsageEvent" ? commit() : method === "createReservation" || method === "createReservationWindowLink" ? reservation() : commit();
    const result = await executeCollectionLimitTransaction(input, context, tx.value);
    assert.deepEqual(result, { kind: "rejected", diagnostics: [{ code: "limit_transaction_atomic_write_failed" }] }); assert.equal(tx.rollbacks(), 1); assert.doesNotMatch(JSON.stringify(result), /sensitive|provider detail/i);
  }

  for (const command of [limitApproval(), reservation(), commit(), release(), reversal()]) {
    assert.equal(command.activationRequested, false); assert.equal(command.merchantEntitlements.canCollectPayments, false);
  }
  const core = readFileSync("src/lib/compliance/collection-limit-engine-transaction-executor-core.ts", "utf8");
  const facade = readFileSync("src/lib/compliance/collection-limit-engine-transaction-executor.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.delete\(|\.upsert\(|\.rpc\(|paystack|monnify|breet|checkout/i);
  assert.doesNotMatch(core, /updateMerchant|updateWorkspace|updateSubscription|updateInvoice|activateCollection/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /collection-limit-engine-transaction-executor/);
  console.log("collection-limit-engine-transaction-executor.test.ts passed");
}

void run();
