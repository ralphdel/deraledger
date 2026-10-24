import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { CanonicalWorkspaceRecoveryRepository } from "../src/lib/server/canonical-workspace-recovery";

const ids = {
  merchant: "11111111-1111-4111-8111-111111111111",
  owner: "22222222-2222-4222-8222-222222222222",
  workspace: "33333333-3333-4333-8333-333333333333",
  otherMerchant: "44444444-4444-4444-8444-444444444444",
};

class RpcClient {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  data: unknown = [{
    result_code: "canonical_workspace_link_created",
    merchant_id: ids.merchant,
    workspace_id: ids.workspace,
    link_version: 1,
  }];
  error: { message: string } | null = null;

  async rpc(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    return { data: this.data, error: this.error };
  }
}

class RecoveryRepository implements CanonicalWorkspaceRecoveryRepository {
  merchant = { id: ids.merchant, user_id: ids.owner, subscription_plan: "individual" };
  subscription = { plan_type: "individual", status: "active" };
  workspaces = [{ id: ids.workspace, merchant_id: ids.merchant }];
  reconcileCalls: Array<{ merchantId: string; reconciledBy: string }> = [];
  reconcileKind: "created" | "replayed" | "existing_exact_link" = "created";

  async findMerchant() { return this.merchant; }
  async findSubscription() { return this.subscription; }
  async listWorkspaces() { return this.workspaces; }
  async reconcile(input: { merchantId: string; reconciledBy: string }) {
    this.reconcileCalls.push(input);
    return {
      kind: this.reconcileKind,
      merchantId: input.merchantId,
      workspaceId: this.reconcileKind === "existing_exact_link" ? null : ids.workspace,
      linkVersion: this.reconcileKind === "existing_exact_link" ? null : 1 as const,
    };
  }
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {}, filename: serverOnlyId, id: serverOnlyId, loaded: true, path: serverOnlyId,
    children: [], paths: [], isPreloading: false, parent: null, require,
  } as NodeModule;

  const reconciliation = await import("../src/lib/server/canonical-workspace-reconciliation");
  const recovery = await import("../src/lib/server/canonical-workspace-recovery");
  const {
    CanonicalWorkspaceReconciliationError,
    reconcileCanonicalWorkspaceForMerchant,
  } = reconciliation;
  const {
    CanonicalWorkspaceRecoveryError,
    recoverCanonicalWorkspaceForEligibleMerchant,
  } = recovery;

  const createdClient = new RpcClient();
  const created = await reconcileCanonicalWorkspaceForMerchant(createdClient as never, {
    merchantId: ids.merchant,
    reconciledBy: ids.owner,
  });
  assert.equal(created.kind, "created");
  assert.equal(created.workspaceId, ids.workspace);
  assert.equal(createdClient.calls.length, 1);
  assert.equal(createdClient.calls[0]?.name, "reconcile_canonical_merchant_workspace_link_v1");
  assert.deepEqual(Object.keys(createdClient.calls[0]!.args).sort(), [
    "p_merchant_id",
    "p_reconcile_idempotency_key",
    "p_reconciled_by",
  ]);
  assert.equal("p_workspace_id" in createdClient.calls[0]!.args, false);

  const replayClient = new RpcClient();
  replayClient.data = [{
    result_code: "canonical_workspace_link_replay",
    merchant_id: ids.merchant,
    workspace_id: ids.workspace,
    link_version: "1",
  }];
  assert.equal((await reconcileCanonicalWorkspaceForMerchant(replayClient as never, {
    merchantId: ids.merchant,
    reconciledBy: ids.owner,
  })).kind, "replayed");
  assert.equal(
    replayClient.calls[0]?.args.p_reconcile_idempotency_key,
    createdClient.calls[0]?.args.p_reconcile_idempotency_key,
    "Retries must use one deterministic merchant-scoped idempotency key.",
  );

  const existingClient = new RpcClient();
  existingClient.data = [{
    result_code: "canonical_workspace_link_idempotency_mismatch",
    merchant_id: ids.merchant,
    workspace_id: null,
    link_version: null,
  }];
  assert.equal((await reconcileCanonicalWorkspaceForMerchant(existingClient as never, {
    merchantId: ids.merchant,
    reconciledBy: ids.owner,
  })).kind, "existing_exact_link");

  const failures: Array<{
    row: Record<string, unknown>;
    code: InstanceType<typeof CanonicalWorkspaceReconciliationError>["code"];
  }> = [
    { row: { result_code: "canonical_workspace_link_unavailable", merchant_id: ids.merchant, workspace_id: null, link_version: null }, code: "WORKSPACE_REQUIRED" },
    { row: { result_code: "canonical_workspace_link_ambiguous", merchant_id: ids.merchant, workspace_id: null, link_version: null }, code: "MULTIPLE_WORKSPACES" },
    { row: { result_code: "canonical_workspace_link_conflict", merchant_id: ids.merchant, workspace_id: null, link_version: null }, code: "CANONICAL_LINK_CONFLICT" },
    { row: { result_code: "canonical_workspace_link_idempotency_mismatch", merchant_id: null, workspace_id: null, link_version: null }, code: "IDEMPOTENCY_CONFLICT" },
    { row: { result_code: "unknown_result", merchant_id: null, workspace_id: null, link_version: null }, code: "INVALID_RPC_RESULT" },
    { row: { result_code: "canonical_workspace_link_created", merchant_id: ids.otherMerchant, workspace_id: ids.workspace, link_version: 1 }, code: "INVALID_RPC_RESULT" },
  ];
  for (const failure of failures) {
    const client = new RpcClient();
    client.data = [failure.row];
    await assert.rejects(
      reconcileCanonicalWorkspaceForMerchant(client as never, {
        merchantId: ids.merchant,
        reconciledBy: ids.owner,
      }),
      (error: unknown) => error instanceof CanonicalWorkspaceReconciliationError
        && error.code === failure.code,
    );
  }

  for (const invalidData of [
    [],
    [
      { result_code: "canonical_workspace_link_created", merchant_id: ids.merchant, workspace_id: ids.workspace, link_version: 1 },
      { result_code: "canonical_workspace_link_replay", merchant_id: ids.merchant, workspace_id: ids.workspace, link_version: 1 },
    ],
    [{ result_code: "canonical_workspace_link_created", merchant_id: ids.merchant, workspace_id: "not-a-uuid", link_version: 1 }],
    [{ result_code: "canonical_workspace_link_created", merchant_id: ids.merchant, workspace_id: ids.workspace, link_version: 2 }],
  ]) {
    const client = new RpcClient();
    client.data = invalidData;
    await assert.rejects(
      reconcileCanonicalWorkspaceForMerchant(client as never, {
        merchantId: ids.merchant,
        reconciledBy: ids.owner,
      }),
      (error: unknown) => error instanceof CanonicalWorkspaceReconciliationError
        && error.code === "INVALID_RPC_RESULT",
    );
  }

  const databaseFailure = new RpcClient();
  databaseFailure.error = { message: "sensitive database details" };
  await assert.rejects(
    reconcileCanonicalWorkspaceForMerchant(databaseFailure as never, {
      merchantId: ids.merchant,
      reconciledBy: ids.owner,
    }),
    (error: unknown) => error instanceof CanonicalWorkspaceReconciliationError
      && error.code === "DATA_ACCESS_ERROR"
      && !/sensitive|database details/i.test(error.message),
  );

  const repository = new RecoveryRepository();
  const before = JSON.stringify({
    merchant: repository.merchant,
    subscription: repository.subscription,
    workspaces: repository.workspaces,
  });
  const recovered = await recoverCanonicalWorkspaceForEligibleMerchant(repository, ids.merchant);
  assert.equal(recovered.kind, "created");
  repository.reconcileKind = "replayed";
  const repeated = await recoverCanonicalWorkspaceForEligibleMerchant(repository, ids.merchant);
  assert.equal(repeated.kind, "replayed");
  assert.equal(repository.reconcileCalls.length, 2);
  assert.deepEqual(repository.reconcileCalls[0], { merchantId: ids.merchant, reconciledBy: ids.owner });
  assert.equal(JSON.stringify({
    merchant: repository.merchant,
    subscription: repository.subscription,
    workspaces: repository.workspaces,
  }), before, "Recovery must not mutate plan, subscription, or workspace state.");

  const businessRepository = new RecoveryRepository();
  businessRepository.merchant.subscription_plan = "corporate";
  businessRepository.subscription.plan_type = "business";
  assert.equal(
    (await recoverCanonicalWorkspaceForEligibleMerchant(businessRepository, ids.merchant)).kind,
    "created",
    "Business aliases must be accepted when merchant and active subscription plans agree.",
  );

  const soloPlusRepository = new RecoveryRepository();
  soloPlusRepository.merchant.subscription_plan = "solo_plus";
  soloPlusRepository.subscription.plan_type = "solo_plus";
  await assert.rejects(
    recoverCanonicalWorkspaceForEligibleMerchant(soloPlusRepository, ids.merchant),
    (error: unknown) => error instanceof CanonicalWorkspaceRecoveryError
      && error.code === "MERCHANT_NOT_ELIGIBLE",
  );
  assert.equal(soloPlusRepository.reconcileCalls.length, 0);

  const recoveryFailures: Array<{
    arrange: (repository: RecoveryRepository) => void;
    code: InstanceType<typeof CanonicalWorkspaceRecoveryError>["code"];
  }> = [
    { arrange: (repo) => { repo.merchant.subscription_plan = "starter"; }, code: "MERCHANT_NOT_ELIGIBLE" },
    { arrange: (repo) => { repo.subscription.status = "pending"; }, code: "SUBSCRIPTION_NOT_ACTIVE" },
    { arrange: (repo) => { repo.subscription.plan_type = "business"; }, code: "SUBSCRIPTION_PLAN_MISMATCH" },
    { arrange: (repo) => { repo.workspaces = []; }, code: "WORKSPACE_REQUIRED" },
    { arrange: (repo) => { repo.workspaces.push({ id: ids.otherMerchant, merchant_id: ids.merchant }); }, code: "MULTIPLE_WORKSPACES" },
    { arrange: (repo) => { repo.workspaces[0]!.merchant_id = ids.otherMerchant; }, code: "WORKSPACE_OWNERSHIP_MISMATCH" },
  ];
  for (const failure of recoveryFailures) {
    const blockedRepository = new RecoveryRepository();
    failure.arrange(blockedRepository);
    await assert.rejects(
      recoverCanonicalWorkspaceForEligibleMerchant(blockedRepository, ids.merchant),
      (error: unknown) => error instanceof CanonicalWorkspaceRecoveryError
        && error.code === failure.code,
    );
    assert.equal(blockedRepository.reconcileCalls.length, 0);
  }

  const shared = readFileSync("src/lib/server/canonical-workspace-reconciliation.ts", "utf8");
  const recoverySource = readFileSync("src/lib/server/canonical-workspace-recovery.ts", "utf8");
  const recoveryTarget = readFileSync("src/lib/server/canonical-workspace-recovery-target.ts", "utf8");
  const starter = readFileSync("src/lib/services/starter-workspace.service.ts", "utf8");
  const onboarding = readFileSync("src/lib/services/onboarding-flow.service.ts", "utf8");
  const fiat = readFileSync("src/lib/services/fiat-payment-confirmation.service.ts", "utf8");
  const upgrade = readFileSync("src/lib/services/paid-upgrade-confirmation.service.ts", "utf8");
  const recoveryScript = readFileSync("scripts/recover-canonical-workspace-staging.ts", "utf8");
  const paidSetup = onboarding.slice(
    onboarding.indexOf("export async function enterPaidSetupMode"),
    onboarding.indexOf("export async function syncMerchantSetupStatus"),
  );
  const workspaceEnsure = onboarding.slice(
    onboarding.indexOf("export async function ensureWorkspaceForMerchant"),
    onboarding.indexOf("export function matchAffiliationByName"),
  );
  const recoveryConfiguration = recoveryScript.slice(
    recoveryScript.indexOf("function requireStagingConfiguration"),
    recoveryScript.indexOf("async function main"),
  );

  assert.match(shared, /import "server-only"/);
  assert.match(shared, /reconcile_canonical_merchant_workspace_link_v1/);
  assert.doesNotMatch(shared, /\.from\("workspaces"\)|p_workspace_id|order\(/);
  assert.doesNotMatch(shared, /console\.(?:log|warn|error)/);
  assert.ok(starter.indexOf("repository.ensureWorkspace") < starter.indexOf("repository.reconcileCanonicalWorkspace"));
  assert.ok(paidSetup.indexOf("ensureWorkspaceForMerchant") < paidSetup.indexOf("params.reconcileCanonicalWorkspace"));
  assert.ok(paidSetup.indexOf("params.reconcileCanonicalWorkspace") < paidSetup.indexOf("merchantUpdateError"));
  assert.match(workspaceEnsure, /existingWorkspaceError[\s\S]*Failed to resolve a unique merchant workspace/);
  assert.ok(workspaceEnsure.indexOf("existingWorkspaceError") < workspaceEnsure.indexOf(".insert({"));
  assert.match(fiat, /reconcileCanonicalWorkspace: \(\) => reconcileCanonicalWorkspaceForMerchant\(supabase,[\s\S]*merchantId,[\s\S]*reconciledBy: userId/);
  assert.match(upgrade, /confirm_paid_upgrade_v1[\s\S]*reconcileCanonicalWorkspaceForMerchant/);
  assert.doesNotMatch(upgrade, /\.from\("workspaces"\)|order\("created_at"/);
  assert.match(recoveryScript, /--environment[\s\S]*staging[\s\S]*--merchant-id/);
  assert.match(recoveryScript, /PRODUCTION_TARGET_BLOCKED/);
  assert.match(recoveryTarget, /fsjljliiyfchkwbjifzw/);
  assert.match(recoveryTarget, /gznwibespgkwknnvbrlv/);
  assert.match(recoveryTarget, /parsedUrl\.protocol !== "https:"/);
  assert.doesNotMatch(recoveryScript, /CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF/);
  assert.ok(
    recoveryConfiguration.indexOf("validateCanonicalWorkspaceRecoveryTarget")
      < recoveryConfiguration.indexOf("process.env.SUPABASE_SERVICE_ROLE_KEY"),
    "Target validation must complete before the script reads the privileged service-role key.",
  );
  assert.ok(
    recoveryScript.indexOf("requireStagingConfiguration(requestedEnvironment)")
      < recoveryScript.indexOf("createClient(supabaseUrl, serviceRoleKey"),
    "Target validation must complete before privileged client construction.",
  );
  assert.doesNotMatch(recoveryScript, /--workspace-id|p_workspace_id|merchant_canonical_workspaces/);
  assert.doesNotMatch(recoverySource, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|merchant_compliance_profiles/);
  for (const source of [shared, starter, onboarding, fiat, upgrade, recoveryScript]) {
    assert.doesNotMatch(source, /\.from\("merchant_canonical_workspaces"\)\s*\.(?:insert|update|upsert|delete)/);
  }

  console.log("canonical-workspace-provisioning-closure.test.ts passed");
}

void run();
