import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  prepareActivationTransitionPersistence,
  type ActivationPersistenceCommand,
  type ActivationPersistenceSnapshot,
} from "../src/lib/compliance/activation-transition-persistence-core";

const context = { databaseRole: "service_role" as const, internalActivationAuthorized: true };
const transaction = { executeAtomically: async <T>(operation: (writer: never) => Promise<T>) => operation(undefined as never) };
const audit = { eventType: "activation_prepared" as const, reasonCode: null, actorId: "operator-1", policyVersion: "phase-2-v1", idempotencyKey: "activate-1" };
const versions = { merchant: 1, workspace: 1, profile: 2, limitWindows: [3] };
function command(overrides: Partial<ActivationPersistenceCommand> = {}): ActivationPersistenceCommand {
  return {
    family: "activation", merchantId: "merchant-1", workspaceId: "workspace-1", planCode: "solo_lite", idempotencyKey: "activate-1", expectedRowVersions: versions,
    target: { setupMode: false, liveFeaturesEnabled: true, activationStatus: "active", merchantEntitlements: { canCollectPayments: true }, schemaCompatibility: { currentMigration024SupportsActivationStatusActive: false, persistenceBlockedPendingSchemaDecision: true } },
    audit, ...overrides,
  };
}
function snapshot(overrides: Partial<ActivationPersistenceSnapshot> = {}): ActivationPersistenceSnapshot {
  return {
    entitlements: [{ id: "entitlement-1", merchantId: "merchant-1", workspaceId: "workspace-1", planCode: "solo_lite", state: "active_paid" }],
    profiles: [{ id: "profile-1", merchantId: "merchant-1", planCode: "solo_lite", complianceStatus: "lite_verified", activationStatus: "approved", restrictionState: "active", rowVersion: 2 }],
    risks: [{ decisionId: "risk-1", merchantId: "merchant-1", rating: "low", reviewed: true }],
    limitWindows: [{ id: "window-1", merchantId: "merchant-1", profileId: "profile-1", lifecycle: "active", approved: true, rowVersion: 3 }],
    readiness: { payoutReady: true, exactProviderEnvironmentMappingReady: true, globalCollectionFlagEnabled: true, merchantCollectionEntitlementApproved: true, setupLiveReadinessApproved: true },
    operational: [{ merchantId: "merchant-1", workspaceId: "workspace-1", merchantRowVersion: 1, workspaceRowVersion: 1, setupMode: true, liveFeaturesEnabled: false }], events: [], ...overrides,
  };
}
function rejected(
  input: ActivationPersistenceCommand | null,
  state: ActivationPersistenceSnapshot,
  code: string,
  executionContext: Parameters<typeof prepareActivationTransitionPersistence>[1] = context,
  boundary: Parameters<typeof prepareActivationTransitionPersistence>[2] = transaction,
) {
  const result = prepareActivationTransitionPersistence(input, executionContext, boundary, state);
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
  const blocked = prepareActivationTransitionPersistence(command(), context, transaction, snapshot());
  assert.equal(blocked.kind, "schema_blocked");
  assert.deepEqual(blocked.diagnostics, [{ code: "activation_schema_incompatible" }]);

  const relock = command({ family: "relock", planCode: null, idempotencyKey: "relock-1", target: { setupMode: true, liveFeaturesEnabled: false, activationStatus: "restricted", restrictionState: "restricted", merchantEntitlements: { canCollectPayments: false } }, audit: { ...audit, eventType: "merchant_relocked", reasonCode: "limit_unavailable", idempotencyKey: "relock-1" } });
  const relockResult = prepareActivationTransitionPersistence(relock, context, transaction, snapshot());
  assert.equal(relockResult.kind, "ready");
  assert.equal(relock.target.merchantEntitlements.canCollectPayments, false);
  const suspension = command({ family: "emergency_suspension", planCode: null, idempotencyKey: "suspend-1", target: { setupMode: true, liveFeaturesEnabled: false, activationStatus: "suspended", restrictionState: "suspended", merchantEntitlements: { canCollectPayments: false } }, audit: { ...audit, eventType: "merchant_suspended", reasonCode: "emergency_risk_suspension", idempotencyKey: "suspend-1" } });
  const suspensionResult = prepareActivationTransitionPersistence(suspension, context, transaction, snapshot());
  assert.equal(suspensionResult.kind, "ready");
  assert.equal(suspension.target.merchantEntitlements.canCollectPayments, false);

  rejected(null, snapshot(), "activation_persistence_command_missing");
  rejected(command(), snapshot(), "activation_persistence_context_denied", null);
  rejected(command(), snapshot(), "activation_persistence_transaction_missing", context, null);
  rejected(command(), snapshot({ entitlements: [] }), "activation_prerequisite_missing");
  rejected(command(), snapshot({ profiles: [{ ...snapshot().profiles[0], complianceStatus: "business_verified" }] }), "activation_prerequisite_conflicting");
  rejected(command(), snapshot({ risks: [] }), "activation_prerequisite_missing");
  rejected(command(), snapshot({ limitWindows: [] }), "activation_prerequisite_missing");
  for (const lifecycle of ["exhausted", "expired", "suspended", "revoked"] as const) rejected(command(), snapshot({ limitWindows: [{ ...snapshot().limitWindows[0], lifecycle }] }), "activation_prerequisite_stale");
  rejected(command(), snapshot({ readiness: { ...snapshot().readiness!, payoutReady: false } }), "activation_prerequisite_missing");
  rejected(command(), snapshot({ readiness: { ...snapshot().readiness!, exactProviderEnvironmentMappingReady: false } }), "activation_prerequisite_missing");
  rejected(command(), snapshot({ readiness: { ...snapshot().readiness!, globalCollectionFlagEnabled: false } }), "activation_prerequisite_missing");
  rejected(command(), snapshot({ readiness: { ...snapshot().readiness!, merchantCollectionEntitlementApproved: false } }), "activation_prerequisite_missing");
  rejected(command(), snapshot({ readiness: { ...snapshot().readiness!, setupLiveReadinessApproved: false } }), "activation_prerequisite_missing");
  const replay = prepareActivationTransitionPersistence(command(), context, transaction, snapshot({ events: [{ id: "event-1", merchantId: "merchant-1", workspaceId: "workspace-1", idempotencyKey: "activate-1", family: "activation", targetActivationStatus: "active", sourceProfileId: "profile-1", resultingProfileRowVersion: 3 }] }));
  assert.equal(replay.kind, "replay");
  rejected(command(), snapshot({ events: [{ id: "event-1", merchantId: "merchant-1", workspaceId: "workspace-1", idempotencyKey: "activate-1", family: "activation", targetActivationStatus: "restricted", sourceProfileId: "profile-1", resultingProfileRowVersion: 3 }] }), "activation_replay_inconsistent");

  const core = readFileSync("src/lib/compliance/activation-transition-persistence-core.ts", "utf8");
  const facade = readFileSync("src/lib/compliance/activation-transition-persistence.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|(?:paystack|monnify|breet)\s*[.(]|(?:initialize|create|open)[A-Z]\w*Checkout\s*\(/i);
  assert.doesNotMatch(core, /updateSubscription|updateInvoice|createPayment|createLimit|approveCompliance/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /activation-transition-persistence/);
}
run();
console.log("activation transition persistence contracts: PASS");
