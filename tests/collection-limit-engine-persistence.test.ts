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
import {
  PERSISTED_COLLECTION_USAGE_EVENT_TYPES,
  PERSISTED_COLLECTION_WINDOW_TYPES,
  prepareCollectionLimitEnginePersistence,
  type CollectionLimitServiceRoleContext,
  type CollectionLimitEnginePersistenceSnapshot,
} from "../src/lib/compliance/collection-limit-engine-persistence-core";

const context: CollectionLimitServiceRoleContext = { databaseRole: "service_role", internalCollectionEngineAuthorized: true };
const identity = { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" as const };
const readiness = { profileId: "profile-1", complianceStatus: "lite_verified" as const, entitlementId: "entitlement-1", entitlementState: "active_paid" as const, planCode: "solo_lite" as const, riskTier: "low" as const, reviewerDecisionId: "review-1", payoutReadinessId: "payout-1", providerEnvironmentMappingId: "mapping-1", authority: "trusted_collection_readiness" as const };
const policy = { policyTimezone: "Africa/Lagos" as const, windowStart: "2026-08-24T00:00:00.000Z", windowEnd: "2026-08-25T00:00:00.000Z" };
const activeWindow = { id: "window-1", merchantId: "merchant-1", profileId: "profile-1", windowType: "daily_velocity" as const, lifecycle: "active" as const, rowVersion: 1 };
const reservedReservation = { id: "reservation-1", merchantId: "merchant-1", profileId: "profile-1", internalReference: "DL-1", amountNgn: 5000, currency: "NGN" as const, status: "reserved" as const, rowVersion: 1 };

function commandResult(result: CollectionLimitCommandResult) {
  assert.equal(result.kind, "prepared");
  if (result.kind !== "prepared") throw new Error("expected prepared command");
  return result.payload;
}

function limitApproval() {
  return commandResult(prepareLimitApprovalCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "limit-1", limitType: "daily_cumulative", currentLifecycle: "proposed", targetLifecycle: "approved", amountNgn: 5000, policy, expectedWindowRowVersion: 1 }));
}
function reservation() {
  return commandResult(prepareReservationCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "reservation-1", amountNgn: 5000, currency: "NGN", sourceType: "invoice", sourceId: "invoice-1", internalReference: "DL-1", expiresAt: "2026-08-24T12:00:00.000Z", windows: [{ windowId: "window-1", limitType: "daily_cumulative", lifecycle: "active", expectedRowVersion: 1, policy }] }));
}
function transitionReservation(status: "reserved" | "committed") {
  return { reservationId: "reservation-1", merchantId: "merchant-1", workspaceId: "workspace-1", internalReference: "DL-1", amountNgn: 5000, currency: "NGN" as const, status, expectedRowVersion: 1, authority: "trusted_limit_repository" as const };
}
function commit() { return commandResult(prepareCommitCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "commit-1", reservation: transitionReservation("reserved"), expectedReservationRowVersion: 1, verifiedPaymentReference: "verified-payment-1" })); }
function release(outcome: "released" | "expired" = "released") { return commandResult(prepareReleaseCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: outcome === "expired" ? "expiry-1" : "release-1", reservation: transitionReservation("reserved"), expectedReservationRowVersion: 1, reasonCode: outcome === "expired" ? "reservation_expired" : "provider_attempt_failed", outcome })); }
function reversal() { return commandResult(prepareReversalCommand({ identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "reversal-1", reservation: transitionReservation("committed"), expectedReservationRowVersion: 1, reasonCode: "payment_refunded", reversalType: "refund_adjustment" })); }

function snapshot(overrides: Partial<CollectionLimitEnginePersistenceSnapshot> = {}): CollectionLimitEnginePersistenceSnapshot {
  return { windows: [activeWindow], reservations: [reservedReservation], links: [{ reservationId: "reservation-1", windowId: "window-1", amountNgn: 5000 }], events: [], ...overrides };
}
function rejected(command: Parameters<typeof prepareCollectionLimitEnginePersistence>[0], state: CollectionLimitEnginePersistenceSnapshot, code: string, executionContext: CollectionLimitServiceRoleContext | null = context) {
  const result = prepareCollectionLimitEnginePersistence(command, executionContext, state);
  assert.equal(result.kind, "rejected");
  assert.deepEqual(result.diagnostics, [{ code }]);
}
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

function run() {
  assert.deepEqual(PERSISTED_COLLECTION_WINDOW_TYPES, ["cumulative", "monthly", "daily_velocity", "outstanding_receivable"]);
  assert.deepEqual(PERSISTED_COLLECTION_USAGE_EVENT_TYPES, ["collection_committed", "reservation_released", "refund_adjustment", "chargeback_adjustment", "manual_correction"]);

  assert.equal(prepareCollectionLimitEnginePersistence(limitApproval(), context, snapshot({ windows: [] })).kind, "ready");
  assert.equal(prepareCollectionLimitEnginePersistence(reservation(), context, snapshot()).kind, "ready");
  const commitReady = prepareCollectionLimitEnginePersistence(commit(), context, snapshot());
  assert.equal(commitReady.kind, "ready");
  if (commitReady.kind === "ready") assert.equal(commitReady.persistedUsageEventType, "collection_committed");
  const releaseReady = prepareCollectionLimitEnginePersistence(release(), context, snapshot());
  assert.equal(releaseReady.kind, "ready");
  const expiryReady = prepareCollectionLimitEnginePersistence(release("expired"), context, snapshot());
  assert.equal(expiryReady.kind, "ready");
  if (expiryReady.kind === "ready") {
    assert.equal(expiryReady.operation, "expiry");
    assert.equal(expiryReady.persistedUsageEventType, "reservation_released");
  }
  assert.equal(prepareCollectionLimitEnginePersistence(reversal(), context, snapshot({ reservations: [{ ...reservedReservation, status: "committed" }] })).kind, "ready");

  const replay = prepareCollectionLimitEnginePersistence(commit(), context, snapshot({ events: [{ id: "event-1", merchantId: "merchant-1", profileId: "profile-1", windowId: "window-1", reservationId: "reservation-1", internalReference: "DL-1", idempotencyKey: "commit-1", eventType: "collection_committed", reasonCode: null }] }));
  assert.equal(replay.kind, "replay");
  rejected(commit(), snapshot({ events: [{ id: "event-1", merchantId: "other", profileId: "profile-1", windowId: "window-1", reservationId: "reservation-1", internalReference: "DL-1", idempotencyKey: "commit-1", eventType: "collection_committed", reasonCode: null }] }), "limit_replay_inconsistent");
  rejected(null, snapshot(), "limit_persistence_command_missing");
  rejected(reservation(), snapshot(), "limit_persistence_context_denied", null);
  rejected(reservation(), snapshot(), "limit_persistence_context_denied", { databaseRole: "authenticated", internalCollectionEngineAuthorized: true });
  rejected(reservation(), snapshot({ windows: [{ ...activeWindow, rowVersion: 2 }] }), "limit_window_row_version_stale");
  for (const lifecycle of ["exhausted", "expired", "suspended", "revoked"] as const) {
    rejected(reservation(), snapshot({ windows: [{ ...activeWindow, lifecycle }] }), "limit_window_not_reservable");
  }
  rejected(commit(), snapshot({ reservations: [] }), "limit_reservation_missing");
  rejected(commit(), snapshot({ reservations: [{ ...reservedReservation, status: "committed" }] }), "limit_reservation_status_invalid");
  rejected(reversal(), snapshot({ reservations: [reservedReservation] }), "limit_reservation_status_invalid");

  for (const payload of [limitApproval(), reservation(), commit(), release(), reversal()]) {
    assert.equal(payload.activationRequested, false);
    assert.equal(payload.merchantEntitlements.canCollectPayments, false);
  }

  const core = readFileSync("src/lib/compliance/collection-limit-engine-persistence-core.ts", "utf8");
  const facade = readFileSync("src/lib/compliance/collection-limit-engine-persistence.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|(?:paystack|monnify|breet)\s*[.(]/i);
  assert.doesNotMatch(core, /updateMerchant|updateWorkspace|updateSubscription|updateInvoice|activateCollection/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /collection-limit-engine-persistence/);
  }
  console.log("collection-limit-engine-persistence.test.ts passed");
}

run();
