import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadTrustedRuntimeCapabilityContext } from "../src/lib/compliance/trusted-runtime-capability-loader-core";
import {
  createTrustedRuntimeCapabilityRepository,
  type SupabaseReadClientLike,
  type SupabaseReadQueryLike,
} from "../src/lib/compliance/trusted-runtime-capability-repository-core";

type Row = Record<string, unknown>;

class FakeQuery implements SupabaseReadQueryLike {
  constructor(
    private readonly table: string,
    private readonly data: Record<string, Row[]>,
    private readonly errors: Set<string>,
    private readonly calls: string[],
  ) {}

  select(columns: string) { this.calls.push(`${this.table}.select:${columns}`); return this; }
  eq(column: string, value: unknown) { this.calls.push(`${this.table}.eq:${column}=${String(value)}`); return this; }
  in(column: string, values: readonly unknown[]) { this.calls.push(`${this.table}.in:${column}=${values.join(",")}`); return this; }
  limit(count: number) { this.calls.push(`${this.table}.limit:${count}`); return this; }
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const response = this.errors.has(this.table)
      ? { data: null, error: { message: "sensitive db error" } }
      : { data: this.data[this.table] ?? [], error: null };
    return Promise.resolve(response).then(onfulfilled, onrejected);
  }
}

function profile(overrides: Row = {}): Row {
  return {
    merchant_id: "merchant-1",
    compliance_status: "lite_verified",
    activation_status: "approved",
    risk_rating: "low",
    restriction_state: "active",
    approved_monthly_volume: "5000000.00",
    cumulative_collection_cap: "8000000.00",
    cumulative_collection_used: "100000.00",
    hidden_daily_velocity_limit: "250000.00",
    single_transaction_limit: "100000.00",
    can_collect_payments: true,
    can_use_instant_sale: true,
    can_use_receivable_sale: false,
    can_use_storefront: true,
    can_activate_settlement: true,
    can_use_deposit_balance: false,
    ...overrides,
  };
}

function baseData(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    merchants: [{ id: "merchant-1", user_id: "user-1", plan: "individual", setup_mode: false, live_features_enabled: true }],
    workspaces: [{ id: "workspace-1", merchant_id: "merchant-1", plan_type: "solo_lite", setup_mode: false, live_features_enabled: true }],
    merchant_team: [],
    subscriptions: [{ merchant_id: "merchant-1", plan_type: "solo_lite", status: "active", expiry_date: "2027-01-01T00:00:00.000Z" }],
    workspace_subscriptions: [{ merchant_id: "merchant-1", workspace_id: "workspace-1", plan_type: "individual", subscription_status: "active" }],
    merchant_compliance_profiles: [profile()],
    platform_settings: [
      { key: "storefront_enabled", value: "true" },
      { key: "instant_sale_enabled", value: "true" },
      { key: "receivable_sale_enabled", value: "true" },
      { key: "merchant_confirmation_before_deposit_enabled", value: "true" },
      { key: "customer_registration_required_for_receivables", value: "true" },
    ],
    merchant_collection_limit_windows: [{ merchant_id: "merchant-1", window_type: "cumulative", window_start: "2026-01-01T00:00:00.000Z", window_end: null, policy_timezone: "Africa/Lagos", limit_amount: "8000000.00", committed_amount: "100000.00", reserved_amount: "0.00" }],
    merchant_settlement_accounts: [{ id: "settlement-1", merchant_id: "merchant-1", currency: "NGN", is_default: true, status: "active", verification_status: "verified" }],
    merchant_provider_settlement_accounts: [{ settlement_account_id: "settlement-1", provider_name: "paystack", environment: "live", status: "connected", provider_subaccount_code: "SUB_1", provider_account_reference: null }],
    ...overrides,
  };
}

function fakeClient(data = baseData(), errorTables: string[] = []) {
  const calls: string[] = [];
  const errors = new Set(errorTables);
  const client: SupabaseReadClientLike = {
    from(table: string) {
      calls.push(`from:${table}`);
      return new FakeQuery(table, data, errors, calls);
    },
  };
  return { client, calls };
}

function repository(data?: Record<string, Row[]>, errorTables?: string[]) {
  const fake = fakeClient(data, errorTables);
  return {
    ...fake,
    repository: createTrustedRuntimeCapabilityRepository(fake.client, {
      provider: "paystack",
      environment: "live",
      now: () => new Date("2026-08-20T00:00:00.000Z"),
    }),
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  const imported = repository();
  assert.equal(imported.calls.length, 0, "repository construction must not query at import/creation time");
  const context = await imported.repository.resolveTrustedMerchantWorkspace({ authenticatedUserId: "user-1" });
  assert.equal(context.kind, "found");
  if (context.kind !== "found") throw new Error("expected trusted merchant/workspace");
  assert.equal(context.value.relationship, "owner");
  assert.ok(imported.calls.some((call) => call === "workspaces.eq:merchant_id=merchant-1"));

  const ready = await loadTrustedRuntimeCapabilityContext(
    imported.repository,
    { authenticatedUserId: "user-1" },
    { now: () => new Date("2026-08-20T00:00:00.000Z") },
  );
  assert.equal(ready.status, "ready");
  assert.equal(ready.context.commercialEntitlementState, "active_paid");

  const emptyProfiles = repository(baseData({ merchant_compliance_profiles: [] }));
  const emptyProfileResult = await emptyProfiles.repository.loadComplianceProfiles({ merchantId: "merchant-1" });
  assert.deepEqual(emptyProfileResult, { kind: "found", value: [] });
  const emptyProfileContext = await loadTrustedRuntimeCapabilityContext(
    emptyProfiles.repository,
    { authenticatedUserId: "user-1" },
  );
  assert.ok(emptyProfileContext.diagnostics.some((item) => item.code === "compliance_profile_missing"));

  const duplicateProfiles = repository(baseData({ merchant_compliance_profiles: [profile(), profile()] }));
  const duplicateProfileContext = await loadTrustedRuntimeCapabilityContext(
    duplicateProfiles.repository,
    { authenticatedUserId: "user-1" },
  );
  assert.ok(duplicateProfileContext.diagnostics.some((item) => item.code === "compliance_profile_ambiguous"));

  for (const [status, expiry, expected] of [
    ["active", "2026-08-19T00:00:00.000Z", "expired"],
    ["cancelled", null, "cancelled"],
  ] as const) {
    const state = repository(baseData({
      subscriptions: [{ merchant_id: "merchant-1", plan_type: "solo_lite", status, expiry_date: expiry }],
      workspace_subscriptions: [{ merchant_id: "merchant-1", workspace_id: "workspace-1", plan_type: "solo_lite", subscription_status: status }],
    }));
    const result = await loadTrustedRuntimeCapabilityContext(state.repository, { authenticatedUserId: "user-1" }, { now: () => new Date("2026-08-20T00:00:00.000Z") });
    assert.equal(result.context.commercialEntitlementState, expected);
  }

  const planConflict = repository(baseData({
    subscriptions: [{ merchant_id: "merchant-1", plan_type: "business", status: "active", expiry_date: "2027-01-01T00:00:00.000Z" }],
  }));
  const planConflictResult = await loadTrustedRuntimeCapabilityContext(planConflict.repository, { authenticatedUserId: "user-1" });
  assert.equal(planConflictResult.context.commercialEntitlementState, "conflicting");

  const starter = repository(baseData({
    merchants: [{ id: "merchant-1", user_id: "user-1", plan: "starter", setup_mode: true, live_features_enabled: false }],
    workspaces: [{ id: "workspace-1", merchant_id: "merchant-1", plan_type: "starter", setup_mode: true, live_features_enabled: false }],
    subscriptions: [],
    workspace_subscriptions: [],
  }));
  const starterResult = await loadTrustedRuntimeCapabilityContext(starter.repository, { authenticatedUserId: "user-1" });
  assert.equal(starterResult.context.commercialEntitlementState, "starter_free");

  const missingFlagRepo = repository(baseData({ platform_settings: [] }));
  assert.equal((await missingFlagRepo.repository.loadGlobalFeatureFlags()).kind, "missing");
  const missingEntitlements = repository(baseData({ merchant_compliance_profiles: [profile({ can_collect_payments: null })] }));
  const entitlementResult = await missingEntitlements.repository.loadComplianceProfiles({ merchantId: "merchant-1" });
  assert.equal(entitlementResult.kind, "found");
  if (entitlementResult.kind === "found") assert.equal(entitlementResult.value[0].merchantEntitlements, null);

  const noMapping = repository(baseData({ merchant_provider_settlement_accounts: [] }));
  assert.equal((await noMapping.repository.loadPayoutReadiness({ merchantId: "merchant-1" })).kind, "found");
  const noMappingResult = await noMapping.repository.loadProviderSettlementReadiness({ merchantId: "merchant-1", workspaceId: "workspace-1" });
  assert.equal(noMappingResult.kind, "found");
  if (noMappingResult.kind === "found") assert.equal(noMappingResult.value.providerMappingReady, false);

  for (const mapping of [
    { provider_name: "paystack", environment: "sandbox" },
    { provider_name: "monnify", environment: "live" },
  ]) {
    const mismatch = repository(baseData({ merchant_provider_settlement_accounts: [{ settlement_account_id: "settlement-1", status: "connected", provider_subaccount_code: "SUB_1", provider_account_reference: null, ...mapping }] }));
    const result = await mismatch.repository.loadProviderSettlementReadiness({ merchantId: "merchant-1", workspaceId: "workspace-1" });
    assert.equal(result.kind, "found");
    if (result.kind === "found") assert.equal(result.value.providerMappingReady, false);
  }

  const lockMismatch = repository(baseData({ workspaces: [{ id: "workspace-1", merchant_id: "merchant-1", plan_type: "solo_lite", setup_mode: true, live_features_enabled: true }] }));
  const lockResult = await lockMismatch.repository.loadOperationalState({ merchantId: "merchant-1", workspaceId: "workspace-1" });
  assert.equal(lockResult.kind, "found");
  if (lockResult.kind === "found") assert.notEqual(lockResult.value.merchantSetupMode, lockResult.value.workspaceSetupMode);

  const queryError = repository(baseData(), ["merchant_compliance_profiles"]);
  const queryErrorResult = await queryError.repository.loadComplianceProfiles({ merchantId: "merchant-1" });
  assert.deepEqual(queryErrorResult, { kind: "error" });
  assert.doesNotMatch(JSON.stringify(queryErrorResult), /sensitive|db error/i);

  const facade = readFileSync("src/lib/compliance/trusted-runtime-capability-repository.ts", "utf8");
  const core = readFileSync("src/lib/compliance/trusted-runtime-capability-repository-core.ts", "utf8");
  assert.match(facade, /import\s+["']server-only["']/);
  assert.doesNotMatch(core, /\.insert\(|\.update\(|\.delete\(|\.upsert\(|rpc\(/i);
  assert.doesNotMatch(core, /payment_records|subscription_payments|provider_metadata/i);

  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /trusted-runtime-capability-repository/);
  }

  console.log("trusted-runtime-capability-repository.test.ts passed");
}

void run();
