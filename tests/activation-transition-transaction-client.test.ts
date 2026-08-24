import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ActivationTransitionTransactionClientError,
  createActivationTransitionServiceRoleTransactionClient,
} from "../src/lib/compliance/activation-transition-transaction-client-core";
import { executeActivationTransitionTransaction } from "../src/lib/compliance/activation-transition-transaction-executor-core";
import type { ActivationPersistenceCommand } from "../src/lib/compliance/activation-transition-persistence-core";

const context = { databaseRole: "service_role" as const, internalActivationAuthorized: true };
const writer = {
  findEntitlements: async () => [{ id: "e", merchantId: "m", workspaceId: "w", planCode: "solo_lite" as const, state: "active_paid" as const }],
  findProfiles: async () => [{ id: "p", merchantId: "m", planCode: "solo_lite" as const, complianceStatus: "lite_verified", activationStatus: "approved", restrictionState: "active" as const, rowVersion: 1 }],
  findRiskSnapshots: async () => [{ decisionId: "r", merchantId: "m", rating: "low" as const, reviewed: true }],
  lockLimitWindows: async () => [{ id: "l", merchantId: "m", profileId: "p", lifecycle: "active" as const, approved: true, rowVersion: 1 }],
  loadReadiness: async () => ({ payoutReady: true, exactProviderEnvironmentMappingReady: true, globalCollectionFlagEnabled: true, merchantCollectionEntitlementApproved: true, setupLiveReadinessApproved: true }),
  lockOperationalState: async () => [{ merchantId: "m", workspaceId: "w", merchantRowVersion: 1, workspaceRowVersion: 1, setupMode: true, liveFeaturesEnabled: false }],
  findEvents: async () => [], updateProfileActivation: async () => ({ id: "p", rowVersion: 2 }), updateOperationalFlags: async () => ({ merchantId: "m", workspaceId: "w" }), appendActivationEvent: async () => ({ id: "event" }),
};
const transport = { runInTransaction: async <T>(operation: (session: typeof writer) => Promise<T>) => operation(writer) };
function command(): ActivationPersistenceCommand {
  return { family: "activation", merchantId: "m", workspaceId: "w", planCode: "solo_lite", idempotencyKey: "key", expectedRowVersions: { merchant: 1, workspace: 1, profile: 1, limitWindows: [1] }, target: { setupMode: false, liveFeaturesEnabled: true, activationStatus: "active", merchantEntitlements: { canCollectPayments: true }, schemaCompatibility: { currentMigration024SupportsActivationStatusActive: false, persistenceBlockedPendingSchemaDecision: true } }, audit: { eventType: "activation_prepared", reasonCode: null, actorId: "operator", policyVersion: "v1", idempotencyKey: "key" } };
}
function sourceFiles(directory: string): string[] { return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => { const file = join(directory, entry.name); return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx)$/.test(entry.name) ? [file] : []; }); }
async function run() {
  const client = createActivationTransitionServiceRoleTransactionClient(context, transport);
  assert.equal((await executeActivationTransitionTransaction(command(), context, client)).kind, "schema_blocked");
  await assert.rejects(() => createActivationTransitionServiceRoleTransactionClient({ databaseRole: "browser", internalActivationAuthorized: true }, transport).runServiceRoleTransaction(async () => "x"), (error: unknown) => error instanceof ActivationTransitionTransactionClientError && error.code === "activation_transaction_client_context_denied");
  await assert.rejects(() => createActivationTransitionServiceRoleTransactionClient(context, null).runServiceRoleTransaction(async () => "x"), (error: unknown) => error instanceof ActivationTransitionTransactionClientError && error.code === "activation_transaction_client_transport_missing");
  await assert.rejects(() => createActivationTransitionServiceRoleTransactionClient(context, { runInTransaction: async () => { throw new Error("transport"); } }).runServiceRoleTransaction(async () => "x"), (error: unknown) => error instanceof ActivationTransitionTransactionClientError && error.code === "activation_transaction_client_failed");
  const core = readFileSync("src/lib/compliance/activation-transition-transaction-client-core.ts", "utf8");
  const facade = readFileSync("src/lib/compliance/activation-transition-transaction-client.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /createClient\(|\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|(?:paystack|monnify|breet)\s*[.(]|(?:initialize|create|open)[A-Z]\w*Checkout\s*\(/i);
  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /activation-transition-transaction-client/);
}
run().then(() => console.log("activation transition transaction client: PASS"));
