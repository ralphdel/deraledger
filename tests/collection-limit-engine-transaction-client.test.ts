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
  CollectionLimitTransactionClientError,
  createCollectionLimitServiceRoleTransactionClient,
  type CollectionLimitEngineServiceRoleTransactionTransport,
} from "../src/lib/compliance/collection-limit-engine-transaction-client-core";
import { executeCollectionLimitTransaction } from "../src/lib/compliance/collection-limit-engine-transaction-executor-core";

const context = { databaseRole: "service_role" as const, internalCollectionEngineAuthorized: true };
const identity = { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" as const };
const readiness = { profileId: "profile-1", complianceStatus: "lite_verified" as const, entitlementId: "entitlement-1", entitlementState: "active_paid" as const, planCode: "solo_lite" as const, riskTier: "low" as const, reviewerDecisionId: "review-1", payoutReadinessId: "payout-1", providerEnvironmentMappingId: "mapping-1", authority: "trusted_collection_readiness" as const };
const policy = { policyTimezone: "Africa/Lagos" as const, windowStart: "2026-08-24T00:00:00.000Z", windowEnd: "2026-08-25T00:00:00.000Z" };
const activeWindow = { id: "window-1", merchantId: "merchant-1", profileId: "profile-1", windowType: "daily_velocity" as const, lifecycle: "active" as const, rowVersion: 1 };
const reservedReservation = { id: "reservation-1", merchantId: "merchant-1", profileId: "profile-1", internalReference: "DL-1", amountNgn: 5000, currency: "NGN" as const, status: "reserved" as const, rowVersion: 1 };

function payload(result: CollectionLimitCommandResult) { assert.equal(result.kind, "prepared"); if (result.kind !== "prepared") throw new Error("expected prepared command"); return result.payload; }
function limitApproval() { return payload(prepareLimitApprovalCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "limit-1", limitType: "daily_cumulative", currentLifecycle: "proposed", targetLifecycle: "approved", amountNgn: 5000, policy, expectedWindowRowVersion: 1 })); }
function reservation() { return payload(prepareReservationCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "reservation-1", amountNgn: 5000, currency: "NGN", sourceType: "invoice", sourceId: "invoice-1", internalReference: "DL-1", expiresAt: "2026-08-24T12:00:00.000Z", windows: [{ windowId: "window-1", limitType: "daily_cumulative", lifecycle: "active", expectedRowVersion: 1, policy }] })); }
function sourceReservation(status: "reserved" | "committed") { return { reservationId: "reservation-1", merchantId: "merchant-1", workspaceId: "workspace-1", internalReference: "DL-1", amountNgn: 5000, currency: "NGN" as const, status, expectedRowVersion: 1, authority: "trusted_limit_repository" as const }; }
function commit() { return payload(prepareCommitCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "commit-1", reservation: sourceReservation("reserved"), expectedReservationRowVersion: 1, verifiedPaymentReference: "verified-payment-1" })); }
function release(expired = false) { return payload(prepareReleaseCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: expired ? "expiry-1" : "release-1", reservation: sourceReservation("reserved"), expectedReservationRowVersion: 1, reasonCode: expired ? "reservation_expired" : "provider_attempt_failed", outcome: expired ? "expired" : "released" })); }
function reversal() { return payload(prepareReversalCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "reversal-1", reservation: sourceReservation("committed"), expectedReservationRowVersion: 1, reasonCode: "payment_refunded", reversalType: "refund_adjustment" })); }
function state(overrides: Partial<CollectionLimitEnginePersistenceSnapshot> = {}): CollectionLimitEnginePersistenceSnapshot { return { windows: [activeWindow], reservations: [reservedReservation], links: [{ reservationId: "reservation-1", windowId: "window-1", amountNgn: 5000 }], events: [], ...overrides }; }

function writer(snapshot: CollectionLimitEnginePersistenceSnapshot, failure = false) {
  const operations: string[] = [];
  const value: CollectionLimitEngineAtomicWriter = {
    findWindows: async () => snapshot.windows, findReservations: async () => snapshot.reservations, findReservationLinks: async () => snapshot.links, findUsageEvents: async () => snapshot.events,
    createLimitWindow: async () => { operations.push("window:create"); return { id: "window-new", rowVersion: 1 }; }, updateLimitWindow: async () => { operations.push("window:update"); return { id: "window-1", rowVersion: 2 }; },
    createReservation: async () => { operations.push("reservation:create"); return { id: "reservation-1", rowVersion: 1 }; }, updateReservation: async () => { operations.push("reservation:update"); return { id: "reservation-1", rowVersion: 2 }; },
    createReservationWindowLink: async () => { operations.push("link:create"); return { reservationId: "reservation-1", windowId: "window-1" }; }, appendUsageEvent: async () => { operations.push("event:append"); if (failure) throw new Error("sensitive transport failure"); return { id: "event-1" }; },
  };
  return { value, operations };
}
function transport(session: CollectionLimitEngineAtomicWriter, failure = false) {
  let calls = 0;
  const value: CollectionLimitEngineServiceRoleTransactionTransport = { async runInTransaction<T>(operation: (writer: CollectionLimitEngineAtomicWriter) => Promise<T>) { calls += 1; if (failure) throw new Error("sensitive transport failure"); return operation(session); } };
  return { value, calls: () => calls };
}
function sourceFiles(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => { const file = join(directory, entry.name); return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx)$/.test(entry.name) ? [file] : []; }); }

async function run() {
  const inert = transport(writer(state()).value);
  createCollectionLimitServiceRoleTransactionClient(context, inert.value);
  assert.equal(inert.calls(), 0, "construction must be inert");

  for (const [command, snapshot, expectedOperation] of [
    [limitApproval(), state({ windows: [] }), "limit_approval"], [reservation(), state(), "reservation"], [commit(), state(), "commit"], [release(), state(), "release"], [release(true), state(), "expiry"], [reversal(), state({ reservations: [{ ...reservedReservation, status: "committed" }] }), "reversal"],
  ] as const) {
    const mock = writer(snapshot); const tx = transport(mock.value);
    const result = await executeCollectionLimitTransaction(command, context, createCollectionLimitServiceRoleTransactionClient(context, tx.value));
    assert.equal(result.kind, "created"); if (result.kind === "created") assert.equal(result.operation, expectedOperation);
    assert.equal(tx.calls(), 1);
  }

  for (const role of ["anon", "authenticated", "browser", "unknown"] as const) {
    const tx = transport(writer(state()).value);
    const client = createCollectionLimitServiceRoleTransactionClient({ databaseRole: role, internalCollectionEngineAuthorized: false }, tx.value);
    await assert.rejects(() => client.runServiceRoleTransaction(async () => "nope"), (error: unknown) => error instanceof CollectionLimitTransactionClientError && error.code === "limit_transaction_client_context_denied");
    assert.equal(tx.calls(), 0);
  }
  const missing = createCollectionLimitServiceRoleTransactionClient(context, null);
  await assert.rejects(() => missing.runServiceRoleTransaction(async () => "nope"), (error: unknown) => error instanceof CollectionLimitTransactionClientError && error.code === "limit_transaction_client_transport_missing");

  const failure = await executeCollectionLimitTransaction(commit(), context, createCollectionLimitServiceRoleTransactionClient(context, transport(writer(state()).value, true).value));
  assert.deepEqual(failure, { kind: "rejected", diagnostics: [{ code: "limit_transaction_atomic_write_failed" }] }); assert.doesNotMatch(JSON.stringify(failure), /sensitive/i);
  const payloads = [limitApproval(), reservation(), commit(), release(), reversal()];
  for (const command of payloads) { assert.equal(command.activationRequested, false); assert.equal(command.merchantEntitlements.canCollectPayments, false); }
  const expiryPayload = release(true);
  assert.equal(expiryPayload.kind, "release");
  if (expiryPayload.kind !== "release") throw new Error("expected expiry release payload");
  assert.equal(expiryPayload.usageEventType, "reservation_expired"); assert.equal(expiryPayload.reasonCode, "reservation_expired");

  const core = readFileSync("src/lib/compliance/collection-limit-engine-transaction-client-core.ts", "utf8");
  const facade = readFileSync("src/lib/compliance/collection-limit-engine-transaction-client.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|paystack|monnify|breet|checkout/i);
  assert.doesNotMatch(core, /Merchant|Workspace|Subscription|Payment|Provider|Settlement|Invoice|Activation|Entitlement/);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /collection-limit-engine-transaction-client/);
  console.log("collection-limit-engine-transaction-client.test.ts passed");
}

void run();
