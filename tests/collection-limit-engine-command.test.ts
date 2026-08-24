import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  COLLECTION_LIMIT_LIFECYCLES,
  COLLECTION_LIMIT_TYPES,
  COLLECTION_RESERVATION_LIFECYCLES,
  COLLECTION_USAGE_EVENT_TYPES,
  prepareCommitCommand,
  prepareLimitApprovalCommand,
  prepareReleaseCommand,
  prepareReservationCommand,
  prepareReversalCommand,
  type PrepareCommitCommandRequest,
  type PrepareLimitApprovalCommandRequest,
  type PrepareReleaseCommandRequest,
  type PrepareReservationCommandRequest,
  type PrepareReversalCommandRequest,
} from "../src/lib/compliance/collection-limit-engine-command-core";

const identity = { merchantId: "merchant-1", workspaceId: "workspace-1", authority: "trusted_server" as const };
const readiness = {
  profileId: "profile-1",
  complianceStatus: "lite_verified" as const,
  entitlementId: "entitlement-1",
  entitlementState: "active_paid" as const,
  planCode: "solo_lite" as const,
  riskTier: "low" as const,
  reviewerDecisionId: "review-1",
  payoutReadinessId: "payout-1",
  providerEnvironmentMappingId: "mapping-1",
  authority: "trusted_collection_readiness" as const,
};
const policy = { policyTimezone: "Africa/Lagos" as const, windowStart: "2026-08-24T00:00:00.000Z", windowEnd: "2026-08-25T00:00:00.000Z" };
const window = { windowId: "window-1", limitType: "daily_cumulative" as const, lifecycle: "active" as const, expectedRowVersion: 1, policy };
const reservedReservation = {
  reservationId: "reservation-1", merchantId: "merchant-1", workspaceId: "workspace-1", internalReference: "DL-1",
  amountNgn: 5000, currency: "NGN" as const, status: "reserved" as const, expectedRowVersion: 1, authority: "trusted_limit_repository" as const,
};
const committedReservation = { ...reservedReservation, status: "committed" as const };

function limitApproval(overrides: Partial<PrepareLimitApprovalCommandRequest> = {}): PrepareLimitApprovalCommandRequest {
  return {
    identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "limit-approval-1",
    limitType: "daily_cumulative", currentLifecycle: "proposed", targetLifecycle: "approved",
    amountNgn: 5000, policy, expectedWindowRowVersion: 1, ...overrides,
  };
}

function reservation(overrides: Partial<PrepareReservationCommandRequest> = {}): PrepareReservationCommandRequest {
  return {
    identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "reservation-1", amountNgn: 5000, currency: "NGN",
    sourceType: "invoice", sourceId: "invoice-1", internalReference: "DL-1", expiresAt: "2026-08-24T12:00:00.000Z", windows: [window], ...overrides,
  };
}

function commit(overrides: Partial<PrepareCommitCommandRequest> = {}): PrepareCommitCommandRequest {
  return { identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "commit-1", reservation: reservedReservation, expectedReservationRowVersion: 1, verifiedPaymentReference: "verified-internal-payment-1", ...overrides };
}

function release(overrides: Partial<PrepareReleaseCommandRequest> = {}): PrepareReleaseCommandRequest {
  return { identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "release-1", reservation: reservedReservation, expectedReservationRowVersion: 1, reasonCode: "provider_attempt_failed", outcome: "released", ...overrides };
}

function reversal(overrides: Partial<PrepareReversalCommandRequest> = {}): PrepareReversalCommandRequest {
  return { identity, readiness, policyVersion: "phase-2-v1", idempotencyKey: "reversal-1", reservation: committedReservation, expectedReservationRowVersion: 1, reasonCode: "payment_refunded", reversalType: "refund_adjustment", ...overrides };
}

function prepared<T extends { kind: string }>(result: T) {
  assert.equal(result.kind, "prepared");
  return result as Extract<T, { kind: "prepared" }>;
}

function rejected<T extends { kind: string; diagnostics: readonly { code: string }[] }>(result: T, code: string) {
  assert.equal(result.kind, "rejected");
  assert.deepEqual(result.diagnostics, [{ code }]);
}

function transitionUsageEvent(result: ReturnType<typeof prepareCommitCommand>) {
  const payload = prepared(result).payload;
  if (!("usageEventType" in payload)) throw new Error("expected a reservation transition payload");
  return payload.usageEventType;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

function run() {
  assert.deepEqual(COLLECTION_LIMIT_TYPES, ["single_transaction", "daily_cumulative", "monthly_cumulative", "velocity_frequency", "plan_cap", "reviewer_risk_override", "cumulative", "outstanding_receivable"]);
  assert.deepEqual(COLLECTION_LIMIT_LIFECYCLES, ["proposed", "approved", "active", "exhausted", "expired", "suspended", "revoked"]);
  assert.deepEqual(COLLECTION_RESERVATION_LIFECYCLES, ["reserved", "committed", "released", "expired", "reversed"]);
  assert.deepEqual(COLLECTION_USAGE_EVENT_TYPES, ["reservation_created", "collection_committed", "reservation_released", "reservation_expired", "refund_adjustment", "chargeback_adjustment", "manual_correction"]);

  assert.equal(prepared(prepareLimitApprovalCommand(limitApproval())).payload.kind, "limit_approval");
  assert.equal(prepared(prepareReservationCommand(reservation())).payload.kind, "reservation");
  assert.equal(transitionUsageEvent(prepareCommitCommand(commit())), "collection_committed");
  assert.equal(transitionUsageEvent(prepareReleaseCommand(release())), "reservation_released");
  assert.equal(transitionUsageEvent(prepareReversalCommand(reversal())), "refund_adjustment");

  rejected(prepareReservationCommand(reservation({ amountNgn: 0 })), "collection_amount_invalid");
  rejected(prepareReservationCommand(reservation({ currency: "USD" as never })), "collection_currency_invalid");
  rejected(prepareReservationCommand(reservation({ idempotencyKey: "" })), "collection_idempotency_key_missing");
  rejected(prepareReservationCommand(reservation({ readiness: null })), "collection_readiness_missing");
  rejected(prepareReservationCommand(reservation({ readiness: { ...readiness, entitlementState: "expired" } as never })), "collection_readiness_unsafe");
  rejected(prepareReservationCommand(reservation({ readiness: { ...readiness, reviewerDecisionId: "" } })), "collection_readiness_unsafe");
  rejected(prepareReservationCommand(reservation({ readiness: { ...readiness, payoutReadinessId: "" } })), "collection_readiness_unsafe");
  rejected(prepareReservationCommand(reservation({ readiness: { ...readiness, providerEnvironmentMappingId: "" } })), "collection_readiness_unsafe");

  for (const lifecycle of ["exhausted", "expired", "suspended", "revoked"] as const) {
    rejected(prepareReservationCommand(reservation({ windows: [{ ...window, lifecycle }] })), "collection_window_not_reservable");
  }
  rejected(prepareCommitCommand(commit({ reservation: null })), "collection_reservation_missing");
  rejected(prepareCommitCommand(commit({ reservation: { ...reservedReservation, status: "committed" } })), "collection_reservation_status_invalid");
  rejected(prepareReversalCommand(reversal({ reservation: reservedReservation })), "collection_reservation_status_invalid");
  rejected(prepareCommitCommand(commit({ verifiedPaymentReference: "" })), "collection_payment_reference_missing");

  const replay = prepareReservationCommand(reservation({
    storedCommand: { commandFamily: "reservation", merchantId: "merchant-1", workspaceId: "workspace-1", idempotencyKey: "reservation-1", amountNgn: 5000, internalReference: "DL-1", reservationStatus: "reserved", authority: "trusted_limit_repository" },
  }));
  assert.equal(replay.kind, "existing");
  rejected(prepareReservationCommand(reservation({
    storedCommand: { commandFamily: "reservation", merchantId: "other", workspaceId: "workspace-1", idempotencyKey: "reservation-1", amountNgn: 5000, internalReference: "DL-1", reservationStatus: "reserved", authority: "trusted_limit_repository" },
  })), "collection_replay_conflict");

  for (const payload of [
    prepared(prepareLimitApprovalCommand(limitApproval())).payload,
    prepared(prepareReservationCommand(reservation())).payload,
    prepared(prepareCommitCommand(commit())).payload,
  ]) {
    assert.equal(payload.activationRequested, false);
    assert.deepEqual(payload.merchantEntitlements, {
      canCollectPayments: false, canUseInstantSale: false, canUseReceivableSale: false,
      canUseStorefront: false, canActivateSettlement: false, canUseDepositBalance: false,
    });
  }

  const core = readFileSync("src/lib/compliance/collection-limit-engine-command-core.ts", "utf8");
  const facade = readFileSync("src/lib/compliance/collection-limit-engine-command.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|(?:paystack|monnify|breet)\s*[.(]/i);
  for (const file of sourceFiles("src/app")) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /collection-limit-engine-command/);
  }
  assert.doesNotMatch(readFileSync("src/lib/actions.ts", "utf8"), /collection-limit-engine-command/);
}

run();
console.log("collection limit engine command contracts: PASS");
