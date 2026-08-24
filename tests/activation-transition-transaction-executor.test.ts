import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  executeActivationTransitionTransaction,
  type ActivationTransitionTransactionRunner,
} from "../src/lib/compliance/activation-transition-transaction-executor-core";
import type { ActivationPersistenceCommand } from "../src/lib/compliance/activation-transition-persistence-core";

const context = { databaseRole: "service_role" as const, internalActivationAuthorized: true };
const versions = { merchant: 1, workspace: 1, profile: 2, limitWindows: [3] };
const audit = { eventType: "activation_prepared" as const, reasonCode: null, actorId: "operator-1", policyVersion: "phase-2-v1", idempotencyKey: "activate-1" };
function command(overrides: Partial<ActivationPersistenceCommand> = {}): ActivationPersistenceCommand {
  return { family: "activation", merchantId: "merchant-1", workspaceId: "workspace-1", planCode: "solo_lite", idempotencyKey: "activate-1", expectedRowVersions: versions, target: { setupMode: false, liveFeaturesEnabled: true, activationStatus: "active", merchantEntitlements: { canCollectPayments: true }, schemaCompatibility: { currentMigration024SupportsActivationStatusActive: false, persistenceBlockedPendingSchemaDecision: true } }, audit, ...overrides };
}
function writer(overrides: Record<string, unknown> = {}) {
  return {
    findEntitlements: async () => [{ id: "entitlement-1", merchantId: "merchant-1", workspaceId: "workspace-1", planCode: "solo_lite" as const, state: "active_paid" as const }],
    findProfiles: async () => [{ id: "profile-1", merchantId: "merchant-1", planCode: "solo_lite" as const, complianceStatus: "lite_verified", activationStatus: "approved", restrictionState: "active" as const, rowVersion: 2 }],
    findRiskSnapshots: async () => [{ decisionId: "risk-1", merchantId: "merchant-1", rating: "low" as const, reviewed: true }],
    lockLimitWindows: async () => [{ id: "window-1", merchantId: "merchant-1", profileId: "profile-1", lifecycle: "active" as const, approved: true, rowVersion: 3 }],
    loadReadiness: async () => ({ payoutReady: true, exactProviderEnvironmentMappingReady: true, globalCollectionFlagEnabled: true, merchantCollectionEntitlementApproved: true, setupLiveReadinessApproved: true }),
    lockOperationalState: async () => [{ merchantId: "merchant-1", workspaceId: "workspace-1", merchantRowVersion: 1, workspaceRowVersion: 1, setupMode: true, liveFeaturesEnabled: false }],
    findEvents: async () => [],
    updateProfileActivation: async () => ({ id: "profile-1", rowVersion: 3 }),
    updateOperationalFlags: async () => ({ merchantId: "merchant-1", workspaceId: "workspace-1" }),
    appendActivationEvent: async () => ({ id: "event-1" }),
    ...overrides,
  };
}
function runner(overrides: Record<string, unknown> = {}): ActivationTransitionTransactionRunner {
  const transactionWriter = writer(overrides);
  return { runServiceRoleTransaction: async <T>(operation: (input: typeof transactionWriter) => Promise<T>) => operation(transactionWriter) };
}
function relock(): ActivationPersistenceCommand {
  return command({ family: "relock", planCode: null, idempotencyKey: "relock-1", target: { setupMode: true, liveFeaturesEnabled: false, activationStatus: "restricted", restrictionState: "restricted", merchantEntitlements: { canCollectPayments: false } }, audit: { ...audit, eventType: "merchant_relocked", reasonCode: "limit_unavailable", idempotencyKey: "relock-1" } });
}
function suspension(): ActivationPersistenceCommand {
  return command({ family: "emergency_suspension", planCode: null, idempotencyKey: "suspend-1", target: { setupMode: true, liveFeaturesEnabled: false, activationStatus: "suspended", restrictionState: "suspended", merchantEntitlements: { canCollectPayments: false } }, audit: { ...audit, eventType: "merchant_suspended", reasonCode: "emergency_risk_suspension", idempotencyKey: "suspend-1" } });
}
function sourceFiles(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => { const file = join(directory, entry.name); return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx)$/.test(entry.name) ? [file] : []; }); }

async function run() {
  assert.equal((await executeActivationTransitionTransaction(command(), context, runner())).kind, "schema_blocked");
  const relockResult = await executeActivationTransitionTransaction(relock(), context, runner());
  assert.equal(relockResult.kind, "created");
  const suspensionResult = await executeActivationTransitionTransaction(suspension(), context, runner());
  assert.equal(suspensionResult.kind, "created");
  assert.equal(relock().target.merchantEntitlements.canCollectPayments, false);
  assert.equal(suspension().target.merchantEntitlements.canCollectPayments, false);
  assert.deepEqual((await executeActivationTransitionTransaction(command(), { databaseRole: "authenticated", internalActivationAuthorized: true }, runner())).diagnostics, [{ code: "activation_transaction_context_denied" }]);
  assert.deepEqual((await executeActivationTransitionTransaction(command(), context, null)).diagnostics, [{ code: "activation_transaction_runner_missing" }]);
  for (const override of [
    { findEntitlements: async () => [] },
    { findProfiles: async () => [{ ...await writer().findProfiles(), complianceStatus: "business_verified" }] },
    { findRiskSnapshots: async () => [] },
    { lockLimitWindows: async () => [] },
    { lockLimitWindows: async () => [{ ...await writer().lockLimitWindows(), lifecycle: "exhausted" as const }] },
    { loadReadiness: async () => ({ payoutReady: false, exactProviderEnvironmentMappingReady: true, globalCollectionFlagEnabled: true, merchantCollectionEntitlementApproved: true, setupLiveReadinessApproved: true }) },
    { loadReadiness: async () => ({ payoutReady: true, exactProviderEnvironmentMappingReady: false, globalCollectionFlagEnabled: true, merchantCollectionEntitlementApproved: true, setupLiveReadinessApproved: true }) },
    { loadReadiness: async () => ({ payoutReady: true, exactProviderEnvironmentMappingReady: true, globalCollectionFlagEnabled: false, merchantCollectionEntitlementApproved: true, setupLiveReadinessApproved: true }) },
    { loadReadiness: async () => ({ payoutReady: true, exactProviderEnvironmentMappingReady: true, globalCollectionFlagEnabled: true, merchantCollectionEntitlementApproved: false, setupLiveReadinessApproved: true }) },
    { loadReadiness: async () => ({ payoutReady: true, exactProviderEnvironmentMappingReady: true, globalCollectionFlagEnabled: true, merchantCollectionEntitlementApproved: true, setupLiveReadinessApproved: false }) },
  ]) assert.equal((await executeActivationTransitionTransaction(command(), context, runner(override))).kind, "rejected");
  const replay = await executeActivationTransitionTransaction(command(), context, runner({ findEvents: async () => [{ id: "event-1", merchantId: "merchant-1", workspaceId: "workspace-1", idempotencyKey: "activate-1", family: "activation" as const, targetActivationStatus: "active", sourceProfileId: "profile-1", resultingProfileRowVersion: 3 }] }));
  assert.equal(replay.kind, "replay");
  assert.equal((await executeActivationTransitionTransaction(command(), context, runner({ findEvents: async () => [{ id: "event-1", merchantId: "merchant-1", workspaceId: "workspace-1", idempotencyKey: "activate-1", family: "activation" as const, targetActivationStatus: "restricted", sourceProfileId: "profile-1", resultingProfileRowVersion: 3 }] }))).kind, "rejected");
  for (const failure of [{ updateProfileActivation: async () => null }, { updateOperationalFlags: async () => null }, { appendActivationEvent: async () => null }]) assert.deepEqual((await executeActivationTransitionTransaction(relock(), context, runner(failure))).diagnostics, [{ code: "activation_transaction_atomic_write_failed" }]);

  const core = readFileSync("src/lib/compliance/activation-transition-transaction-executor-core.ts", "utf8");
  const facade = readFileSync("src/lib/compliance/activation-transition-transaction-executor.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|(?:paystack|monnify|breet)\s*[.(]|(?:initialize|create|open)[A-Z]\w*Checkout\s*\(/i);
  assert.doesNotMatch(core, /updateSubscription|updateInvoice|createPayment|createLimit|approveCompliance/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /activation-transition-transaction-executor/);
}
run().then(() => console.log("activation transition transaction executor: PASS"));
