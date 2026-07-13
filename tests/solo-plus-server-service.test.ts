import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  normalizeSoloPlusAmount,
  type SoloPlusCaseCreateAtomicInput,
  type SoloPlusCaseCreateAtomicResult,
  type SoloPlusCaseActivationAtomicParams,
  type SoloPlusCaseActivationAtomicResult,
  type SoloPlusCaseEventRecord,
  type SoloPlusCaseRecord,
  type SoloPlusCaseRepository,
  type SoloPlusCaseRequirementRecord,
  type SoloPlusCaseTransitionAtomicParams,
  type SoloPlusCaseTransitionAtomicResult,
  type SoloPlusAttachMerchantAtomicParams,
  type SoloPlusAttachMerchantAtomicResult,
  type SoloPlusSafeJsonObject,
} from "../src/lib/solo-plus/repository";

type AccessContextModule = typeof import("../src/lib/solo-plus/server/access-context");
type ServiceFactoryModule = typeof import("../src/lib/solo-plus/server/service-factory");

let assertSoloPlusServerEnvironment: AccessContextModule["assertSoloPlusServerEnvironment"];
let loadSoloPlusServerFeatureFlags: AccessContextModule["loadSoloPlusServerFeatureFlags"];
let resolveSoloPlusAuthenticatedUser: AccessContextModule["resolveSoloPlusAuthenticatedUser"];
let resolveSoloPlusMerchantOwnership: AccessContextModule["resolveSoloPlusMerchantOwnership"];
let resolveSoloPlusOnboardingSessionOwnership: AccessContextModule["resolveSoloPlusOnboardingSessionOwnership"];
let resolveSoloPlusServerAccess: AccessContextModule["resolveSoloPlusServerAccess"];
let SoloPlusServerAccessError: AccessContextModule["SoloPlusServerAccessError"];
let createSoloPlusServerService: ServiceFactoryModule["createSoloPlusServerService"];
let SoloPlusServerServiceFactoryError: ServiceFactoryModule["SoloPlusServerServiceFactoryError"];

type QueryResponse = {
  data: unknown;
  error: { message: string } | null;
};

type FakeUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
  email_confirmed_at?: string | null;
};

class FakeQueryBuilder {
  private readonly client: FakeSupabaseClient;
  private readonly table: string;
  private filters: Array<{ type: "eq" | "in"; column: string; value: unknown }> = [];
  private limitCount: number | null = null;

  constructor(client: FakeSupabaseClient, table: string) {
    this.client = client;
    this.table = table;
  }

  select(): FakeQueryBuilder {
    return this;
  }

  eq(column: string, value: unknown): FakeQueryBuilder {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column: string, values: readonly unknown[]): FakeQueryBuilder {
    this.filters.push({ type: "in", column, value: [...values] });
    return this;
  }

  limit(count: number): FakeQueryBuilder {
    this.limitCount = count;
    return this;
  }

  async maybeSingle(): Promise<QueryResponse> {
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  async single(): Promise<QueryResponse> {
    const rows = this.resolveRows();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.resolveRows(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }

  private resolveRows(): unknown[] {
    let rows = (this.client.tables.get(this.table) ?? []).map((row) =>
      JSON.parse(JSON.stringify(row)),
    );

    for (const filter of this.filters) {
      rows = rows.filter((row) => {
        const value = (row as Record<string, unknown>)[filter.column];
        if (filter.type === "eq") {
          return value === filter.value;
        }

        return (filter.value as readonly unknown[]).includes(value);
      });
    }

    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    return rows;
  }
}

class FakeSupabaseClient {
  readonly tables = new Map<string, unknown[]>();
  currentUser: FakeUser | null = null;

  auth = {
    getUser: async () => ({
      data: { user: this.currentUser },
      error: this.currentUser ? null : { message: "missing user" },
    }),
  };

  from(table: string) {
    return new FakeQueryBuilder(this, table) as never;
  }

  async rpc() {
    return {
      data: null,
      error: null,
    };
  }
}

class FakeSoloPlusRepository implements SoloPlusCaseRepository {
  readonly cases = new Map<string, SoloPlusCaseRecord>();
  lastCreateInput: SoloPlusCaseCreateAtomicInput | null = null;
  lastAttachInput: SoloPlusAttachMerchantAtomicParams | null = null;
  lastTransitionInput: SoloPlusCaseTransitionAtomicParams | null = null;
  lastUpsertRequirements:
    | { caseId: string; requirements: readonly SoloPlusCaseRequirementRecord[] }
    | null = null;
  readonly requirements = new Map<string, readonly SoloPlusCaseRequirementRecord[]>();
  readonly events = new Map<string, readonly SoloPlusCaseEventRecord[]>();

  seedCase(caseRecord: SoloPlusCaseRecord) {
    this.cases.set(caseRecord.id, JSON.parse(JSON.stringify(caseRecord)) as SoloPlusCaseRecord);
  }

  async findCaseById(caseId: string): Promise<SoloPlusCaseRecord | null> {
    return this.cases.get(caseId) ?? null;
  }

  async findCaseByIdempotencyKey(): Promise<SoloPlusCaseRecord | null> {
    return null;
  }

  async findActiveCaseByMerchantId(): Promise<SoloPlusCaseRecord | null> {
    return null;
  }

  async findActiveCaseByOnboardingSessionId(): Promise<SoloPlusCaseRecord | null> {
    return null;
  }

  async listRequirements(caseId: string): Promise<readonly SoloPlusCaseRequirementRecord[]> {
    return this.requirements.get(caseId) ?? [];
  }

  async listSafeEvents(caseId: string): Promise<readonly SoloPlusCaseEventRecord[]> {
    return this.events.get(caseId) ?? [];
  }

  async findLatestReviewDecisionEvent(
    caseId: string,
  ): Promise<SoloPlusCaseEventRecord | null> {
    const events = this.events.get(caseId) ?? [];
    return events.at(-1) ?? null;
  }

  async createCaseWithRequirementsAndEvent(
    input: SoloPlusCaseCreateAtomicInput,
  ): Promise<SoloPlusCaseCreateAtomicResult> {
    this.lastCreateInput = JSON.parse(JSON.stringify(input)) as SoloPlusCaseCreateAtomicInput;
    this.cases.set(input.caseRecord.id, input.caseRecord);
    this.requirements.set(input.caseRecord.id, input.requirements);
    this.events.set(input.caseRecord.id, [input.event]);

    return {
      kind: "created",
      caseRecord: input.caseRecord,
      requirements: input.requirements,
      event: input.event,
    };
  }

  async attachMerchantToOnboardingCase(
    input: SoloPlusAttachMerchantAtomicParams,
  ): Promise<SoloPlusAttachMerchantAtomicResult> {
    this.lastAttachInput = JSON.parse(JSON.stringify(input)) as SoloPlusAttachMerchantAtomicParams;
    const caseRecord = buildCaseRecord({
      id: input.caseId,
      merchantId: input.merchantId,
      onboardingSessionId: input.onboardingSessionId,
      rowVersion: input.expectedRowVersion + 1,
    });
    this.cases.set(caseRecord.id, caseRecord);
    return {
      kind: "updated",
      caseRecord,
      event: input.event,
    };
  }

  async transitionCaseStatus(
    input: SoloPlusCaseTransitionAtomicParams,
  ): Promise<SoloPlusCaseTransitionAtomicResult> {
    this.lastTransitionInput = JSON.parse(JSON.stringify(input)) as SoloPlusCaseTransitionAtomicParams;
    const caseRecord = buildCaseRecord({
      id: input.caseId,
      caseStatus: input.targetStatus,
      rowVersion: input.expectedRowVersion + 1,
    });
    this.cases.set(caseRecord.id, caseRecord);
    return {
      kind: "updated",
      caseRecord,
      event: input.event,
    };
  }

  async upsertCaseRequirements(
    caseId: string,
    requirements: readonly SoloPlusCaseRequirementRecord[],
  ): Promise<readonly SoloPlusCaseRequirementRecord[]> {
    this.lastUpsertRequirements = {
      caseId,
      requirements: JSON.parse(JSON.stringify(requirements)) as SoloPlusCaseRequirementRecord[],
    };
    this.requirements.set(
      caseId,
      JSON.parse(JSON.stringify(requirements)) as SoloPlusCaseRequirementRecord[],
    );
    return this.requirements.get(caseId) ?? [];
  }

  async activateSoloPlusCase(
    input: SoloPlusCaseActivationAtomicParams,
  ): Promise<SoloPlusCaseActivationAtomicResult> {
    const caseRecord = this.cases.get(input.caseId);
    if (!caseRecord) {
      return { kind: "not_found" };
    }

    return {
      kind: "feature_disabled",
      currentCase: JSON.parse(JSON.stringify(caseRecord)) as SoloPlusCaseRecord,
    };
  }
}

function createEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  };
}

function seedBaseTables(client: FakeSupabaseClient) {
  client.tables.set("platform_settings", [
    { key: "plan_migration_solo_lite_enabled", value: "false" },
    { key: "solo_plus_enabled", value: "false" },
    { key: "solo_plus_kyc_enabled", value: "false" },
  ]);
  client.tables.set("merchants", []);
  client.tables.set("onboarding_sessions", []);
}

function buildCaseRecord(
  overrides: Partial<SoloPlusCaseRecord> = {},
): SoloPlusCaseRecord {
  return {
    id: overrides.id || "11111111-1111-4111-8111-111111111111",
    merchantId: overrides.merchantId ?? null,
    onboardingSessionId: overrides.onboardingSessionId ?? null,
    flowOrigin: overrides.flowOrigin || "onboarding",
    sourcePlan: overrides.sourcePlan ?? null,
    targetPlan: "solo_plus",
    caseStatus: overrides.caseStatus || "draft",
    paymentStatus: overrides.paymentStatus || "pending",
    refundStatus: overrides.refundStatus || "none",
    paymentRecordId: null,
    paymentProvider: null,
    paymentReference: null,
    expectedAmount: overrides.expectedAmount || "12.50",
    paymentCurrency: "NGN",
    requirementsPolicyVersion: "solo-plus-policy-v1",
    requirementsSnapshot: {},
    activePlanSnapshot: overrides.activePlanSnapshot ?? null,
    rejectionReason: null,
    approvedAt: null,
    approvedByAdminId: null,
    rejectedAt: null,
    rejectedByAdminId: null,
    reopenedAt: null,
    reopenedByAdminId: null,
    idempotencyKey: "idem-case",
    activationIdempotencyKey: null,
    refundIdempotencyKey: null,
    rowVersion: overrides.rowVersion ?? 0,
    auditMetadata: {},
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  };
}

function buildRequirementRecord(
  overrides: Partial<SoloPlusCaseRequirementRecord> & {
    requirementCode: SoloPlusCaseRequirementRecord["requirementCode"];
  },
): SoloPlusCaseRequirementRecord {
  return {
    id: `${overrides.requirementCode}-requirement`,
    caseId: "case-kyc-1",
    requirementState: "not_started",
    verificationLogId: null,
    evidenceSourceType: null,
    evidenceSourceId: null,
    evidenceReference: null,
    originalCompletedAt: null,
    reuseDecisionAt: null,
    reuseReason: null,
    policyRuleApplied: null,
    reviewedByAdminId: null,
    reviewNote: null,
    providerName: null,
    providerReference: null,
    failureReason: null,
    completedAt: null,
    metadata: {},
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    ...overrides,
    requirementCode: overrides.requirementCode,
  };
}

async function expectAccessError(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(fn, (error: unknown) => {
    assert.ok(
      error instanceof SoloPlusServerAccessError ||
        error instanceof SoloPlusServerServiceFactoryError,
    );
    assert.equal(error.code, code);
    return true;
  });
}

async function run() {
  assert.match(
    readFileSync("src/lib/solo-plus/server/access-context.ts", "utf8"),
    /^import "server-only";/,
  );
  assert.match(
    readFileSync("src/lib/solo-plus/server/service-factory.ts", "utf8"),
    /^import "server-only";/,
  );

  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {},
    filename: serverOnlyId,
    id: serverOnlyId,
    loaded: true,
    path: serverOnlyId,
    children: [],
    paths: [],
    isPreloading: false,
    parent: null,
    require,
  } as NodeModule;

  ({
    assertSoloPlusServerEnvironment,
    loadSoloPlusServerFeatureFlags,
    resolveSoloPlusAuthenticatedUser,
    resolveSoloPlusMerchantOwnership,
    resolveSoloPlusOnboardingSessionOwnership,
    resolveSoloPlusServerAccess,
    SoloPlusServerAccessError,
  } = await import("../src/lib/solo-plus/server/access-context"));
  ({
    createSoloPlusServerService,
    SoloPlusServerServiceFactoryError,
  } = await import("../src/lib/solo-plus/server/service-factory"));

  assert.throws(
    () => assertSoloPlusServerEnvironment({ NODE_ENV: "test" }),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusServerAccessError);
      assert.equal(error.code, "SOLO_PLUS_SERVER_CONFIG_ERROR");
      return true;
    },
  );

  const authClient = new FakeSupabaseClient();
  const serviceClient = new FakeSupabaseClient();
  seedBaseTables(authClient);
  seedBaseTables(serviceClient);

  authClient.currentUser = {
    id: "user-1",
    email: "owner@example.com",
    user_metadata: {},
    app_metadata: {},
    email_confirmed_at: "2026-07-07T00:00:00.000Z",
  };

  const merchantRows = [
    {
      id: "merchant-1",
      user_id: "user-1",
      email: "owner@example.com",
      is_super_admin: false,
    },
    {
      id: "merchant-2",
      user_id: "user-2",
      email: "other@example.com",
      is_super_admin: false,
    },
    {
      id: "merchant-sandbox",
      user_id: "user-1",
      email: "sandbox-owner@example.com",
      is_super_admin: true,
    },
    {
      id: "merchant-email-only",
      user_id: "user-1",
      email: "sandbox-owner@example.com",
      is_super_admin: false,
    },
  ];
  authClient.tables.set("merchants", merchantRows);

  const sessionRows = [
    {
      id: "session-owned",
      email: "owner@example.com",
      merchant_id: null,
      status: "awaiting_payment",
      expires_at: "2099-01-01T00:00:00.000Z",
    },
    {
      id: "session-mismatch",
      email: "stranger@example.com",
      merchant_id: null,
      status: "awaiting_payment",
      expires_at: "2099-01-01T00:00:00.000Z",
    },
    {
      id: "session-linked-merchant",
      email: "other@example.com",
      merchant_id: "merchant-1",
      status: "payment_confirmed",
      expires_at: "2099-01-01T00:00:00.000Z",
    },
    {
      id: "session-expired",
      email: "owner@example.com",
      merchant_id: null,
      status: "awaiting_payment",
      expires_at: "2000-01-01T00:00:00.000Z",
    },
  ];
  authClient.tables.set("onboarding_sessions", sessionRows);

  const resolvedUser = await resolveSoloPlusAuthenticatedUser({
    authClient,
    env: createEnv(),
  });
  assert.equal(resolvedUser.id, "user-1");
  assert.equal(resolvedUser.email, "owner@example.com");
  assert.equal(resolvedUser.isSuperAdmin, false);
  assert.equal(resolvedUser.hasVerifiedEmail, true);

  const missingUserClient = new FakeSupabaseClient();
  seedBaseTables(missingUserClient);
  await expectAccessError(
    () => resolveSoloPlusAuthenticatedUser({ authClient: missingUserClient, env: createEnv() }),
    "SOLO_PLUS_SERVER_UNAUTHORIZED",
  );

  const ownedMerchant = await resolveSoloPlusMerchantOwnership("merchant-1", {
    authClient,
    serviceClient,
    env: createEnv(),
  });
  assert.equal(ownedMerchant.merchantId, "merchant-1");

  await expectAccessError(
    () =>
      resolveSoloPlusMerchantOwnership("merchant-2", {
        authClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  const ownedSession = await resolveSoloPlusOnboardingSessionOwnership("session-owned", {
    authClient,
    serviceClient,
    env: createEnv(),
  });
  assert.equal(ownedSession.ownershipBasis, "session_email");

  const merchantLinkedSession = await resolveSoloPlusOnboardingSessionOwnership(
    "session-linked-merchant",
    {
      authClient,
      serviceClient,
      env: createEnv(),
    },
  );
  assert.equal(merchantLinkedSession.ownershipBasis, "merchant_owner");

  await expectAccessError(
    () =>
      resolveSoloPlusOnboardingSessionOwnership("session-mismatch", {
        authClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  await expectAccessError(
    () =>
      resolveSoloPlusOnboardingSessionOwnership("session-expired", {
        authClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  const unverifiedEmailClient = new FakeSupabaseClient();
  seedBaseTables(unverifiedEmailClient);
  unverifiedEmailClient.currentUser = {
    id: "user-1",
    email: "owner@example.com",
    app_metadata: {},
    email_confirmed_at: null,
  };
  unverifiedEmailClient.tables.set("merchants", merchantRows);
  unverifiedEmailClient.tables.set("onboarding_sessions", sessionRows);
  await expectAccessError(
    () =>
      resolveSoloPlusOnboardingSessionOwnership("session-owned", {
        authClient: unverifiedEmailClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  const missingVerifiedEmailClient = new FakeSupabaseClient();
  seedBaseTables(missingVerifiedEmailClient);
  missingVerifiedEmailClient.currentUser = {
    id: "user-1",
    email: "owner@example.com",
    app_metadata: {},
  };
  missingVerifiedEmailClient.tables.set("merchants", merchantRows);
  missingVerifiedEmailClient.tables.set("onboarding_sessions", sessionRows);
  await expectAccessError(
    () =>
      resolveSoloPlusOnboardingSessionOwnership("session-owned", {
        authClient: missingVerifiedEmailClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  const metadataOnlyAdminClient = new FakeSupabaseClient();
  seedBaseTables(metadataOnlyAdminClient);
  metadataOnlyAdminClient.currentUser = {
    id: "admin-2",
    email: "metadata-only@example.com",
    user_metadata: { is_super_admin: true },
    app_metadata: {},
    email_confirmed_at: "2026-07-07T00:00:00.000Z",
  };
  await expectAccessError(
    () =>
      resolveSoloPlusServerAccess({
        requestedMode: "internal_test",
        authClient: metadataOnlyAdminClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  const adminClient = new FakeSupabaseClient();
  seedBaseTables(adminClient);
  adminClient.currentUser = {
    id: "admin-1",
    email: "admin@example.com",
    user_metadata: { is_super_admin: true },
    app_metadata: { is_super_admin: true },
    email_confirmed_at: "2026-07-07T00:00:00.000Z",
  };
  adminClient.tables.set("merchants", [
    {
      id: "merchant-admin",
      user_id: "admin-1",
      email: "admin@example.com",
      is_super_admin: false,
    },
  ]);
  adminClient.tables.set("onboarding_sessions", [
    {
      id: "session-admin",
      email: "admin@example.com",
      merchant_id: null,
      status: "awaiting_payment",
      expires_at: "2099-01-01T00:00:00.000Z",
    },
    {
      id: "session-linked-admin-merchant",
      email: "not-admin@example.com",
      merchant_id: "merchant-admin",
      status: "payment_confirmed",
      expires_at: "2099-01-01T00:00:00.000Z",
    },
  ]);

  serviceClient.tables.set("platform_settings", [
    { key: "plan_migration_solo_lite_enabled", value: "false" },
    { key: "solo_plus_enabled", value: "false" },
    { key: "solo_plus_kyc_enabled", value: "true" },
  ]);

  const internalAdminAccess = await resolveSoloPlusServerAccess({
    requestedMode: "internal_test",
    authClient: adminClient,
    serviceClient,
    env: createEnv(),
  });
  assert.equal(internalAdminAccess.accessContext.mode, "internal_test");
  assert.equal(internalAdminAccess.accessContext.isAuthorizedAdmin, true);
  assert.equal(internalAdminAccess.accessContext.isSandboxMerchant, false);

  await expectAccessError(
    () =>
      resolveSoloPlusServerAccess({
        requestedMode: "internal_test",
        merchantId: "merchant-sandbox",
        authClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  await expectAccessError(
    () =>
      resolveSoloPlusServerAccess({
        requestedMode: "internal_test",
        merchantId: "merchant-email-only",
        authClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  await expectAccessError(
    () =>
      resolveSoloPlusServerAccess({
        requestedMode: "internal_test",
        merchantId: "merchant-1",
        authClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  const loadedFlags = await loadSoloPlusServerFeatureFlags({
    serviceClient,
    env: createEnv(),
  });
  assert.deepEqual(loadedFlags, {
    planMigrationSoloLiteEnabled: false,
    soloPlusEnabled: false,
    soloPlusKycEnabled: true,
  });

  await expectAccessError(
    () =>
      resolveSoloPlusServerAccess({
        requestedMode: "public",
        onboardingSessionId: "session-owned",
        authClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  serviceClient.tables.set("platform_settings", [
    { key: "plan_migration_solo_lite_enabled", value: "false" },
    { key: "solo_plus_enabled", value: "true" },
    { key: "solo_plus_kyc_enabled", value: "false" },
  ]);
  await expectAccessError(
    () =>
      resolveSoloPlusServerAccess({
        requestedMode: "public",
        onboardingSessionId: "session-owned",
        authClient,
        serviceClient,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  serviceClient.tables.set("platform_settings", [
    { key: "plan_migration_solo_lite_enabled", value: "false" },
    { key: "solo_plus_enabled", value: "true" },
    { key: "solo_plus_kyc_enabled", value: "true" },
  ]);

  const publicAccess = await resolveSoloPlusServerAccess({
    requestedMode: "public",
    onboardingSessionId: "session-owned",
    authClient,
    serviceClient,
    env: createEnv(),
  });
  assert.equal(publicAccess.accessContext.mode, "public");

  const repository = new FakeSoloPlusRepository();
  const service = await createSoloPlusServerService({
    requestedMode: "public",
    onboardingSessionId: "session-owned",
    authClient,
    serviceClient,
    repository,
    env: createEnv(),
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    generateId: (() => {
      let index = 0;
      const ids = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
        "77777777-7777-4777-8777-777777777777",
        "88888888-8888-4888-8888-888888888888",
      ];
      return () =>
        ids[index++] || `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`;
    })(),
  });

  const maliciousInput = {
    idempotencyKey: "solo-plus-create-1",
    expectedAmount: normalizeSoloPlusAmount("1"),
    paymentCurrency: "NGN" as const,
    requirementsPolicyVersion: "solo-plus-policy-v1",
    requirementsSnapshot: { safe: true } satisfies SoloPlusSafeJsonObject,
    accessContext: {
      mode: "internal_test",
      isAuthorizedAdmin: true,
      isSandboxMerchant: true,
      authenticatedAdminId: "spoofed-admin",
      sandboxMerchantId: "spoofed-merchant",
    },
    featureFlags: {
      soloPlusEnabled: false,
      soloPlusKycEnabled: false,
    },
  } as unknown as Parameters<typeof service.createOnboardingCase>[0];

  const created = await service.createOnboardingCase(maliciousInput);
  assert.equal(created.outcome, "created");
  assert.equal(repository.lastCreateInput?.intent.onboardingSessionId, "session-owned");
  assert.equal(repository.lastCreateInput?.intent.expectedAmount, "1.00");
  assert.equal(repository.lastCreateInput?.event.actorType, "merchant");
  assert.equal(repository.lastCreateInput?.event.actorId, "user-1");
  assert.equal(repository.lastCreateInput?.event.newState.accessMode, "public");

  const upgradeRepository = new FakeSoloPlusRepository();
  const upgradeService = await createSoloPlusServerService({
    requestedMode: "internal_test",
    merchantId: "merchant-admin",
    authClient: adminClient,
    serviceClient,
    repository: upgradeRepository,
    env: createEnv(),
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    generateId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });

  await upgradeService.createUpgradeCase({
    currentPlan: "solo_lite",
    idempotencyKey: "solo-plus-upgrade-1",
    expectedAmount: "9999999999999999.99",
    paymentCurrency: "NGN",
    requirementsPolicyVersion: "solo-plus-policy-v1",
    requirementsSnapshot: { safe: "snapshot" },
  });
  assert.equal(upgradeRepository.lastCreateInput?.intent.merchantId, "merchant-admin");
  assert.equal(upgradeRepository.lastCreateInput?.intent.expectedAmount, "9999999999999999.99");

  const attachRepository = new FakeSoloPlusRepository();
  attachRepository.seedCase(
    buildCaseRecord({
      id: "case-1",
      onboardingSessionId: "session-admin",
      merchantId: null,
      flowOrigin: "onboarding",
      rowVersion: 2,
    }),
  );
  attachRepository.seedCase(
    buildCaseRecord({
      id: "case-2",
      onboardingSessionId: "session-admin",
      merchantId: "merchant-admin",
      flowOrigin: "onboarding",
      rowVersion: 3,
    }),
  );
  const attachService = await createSoloPlusServerService({
    requestedMode: "internal_test",
    merchantId: "merchant-admin",
    onboardingSessionId: "session-admin",
    authClient: adminClient,
    serviceClient,
    repository: attachRepository,
    env: createEnv(),
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    generateId: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });

  await attachService.attachMerchantToOnboardingCase({
    caseId: "case-1",
    expectedRowVersion: 2,
    requestIdempotencyKey: "attach-1",
  });
  assert.equal(attachRepository.lastAttachInput?.merchantId, "merchant-admin");
  assert.equal(attachRepository.lastAttachInput?.onboardingSessionId, "session-admin");

  await attachService.markCaseAwaitingPayment({
    caseId: "case-2",
    expectedRowVersion: 3,
    requestIdempotencyKey: "awaiting-1",
  });
  assert.equal(attachRepository.lastTransitionInput?.requestIdempotencyKey, "awaiting-1");
  assert.equal(attachRepository.lastTransitionInput?.event.actorType, "admin");

  attachRepository.seedCase(
    buildCaseRecord({
      id: "case-kyc-1",
      merchantId: "merchant-admin",
      flowOrigin: "upgrade",
      sourcePlan: "solo_lite",
      activePlanSnapshot: "solo_lite",
      rowVersion: 1,
    }),
  );
  attachRepository.requirements.set(
    "case-kyc-1",
    [
      buildRequirementRecord({ requirementCode: "bvn" }),
      buildRequirementRecord({ requirementCode: "selfie_liveness" }),
      buildRequirementRecord({ requirementCode: "id_document" }),
      buildRequirementRecord({ requirementCode: "proof_of_address" }),
      buildRequirementRecord({ requirementCode: "settlement_account" }),
      buildRequirementRecord({ requirementCode: "activity_profile" }),
    ],
  );
  serviceClient.tables.set("merchants", [
    {
      id: "merchant-admin",
      user_id: "admin-user",
      email: "admin@example.test",
      is_super_admin: false,
      verification_step_state: {
        valid_id_document: {
          status: "verified",
          provider: "manual_upload",
          provider_reference: "doc-ref-1",
          verified_at: "2026-07-05T00:00:00.000Z",
        },
      },
      cac_document_url: "kyc-documents/id-existing.pdf",
      utility_document_url: null,
      business_type: "retail",
    },
  ]);
  serviceClient.tables.set("verification_logs", [
    {
      id: "log-bvn-1",
      merchant_id: "merchant-admin",
      provider_name: "dojah",
      verification_type: "bvn_selfie",
      normalized_status: "verified",
      provider_reference: "prov-bvn-1",
      response_timestamp: "2026-07-06T00:00:00.000Z",
      created_at: "2026-07-06T00:00:00.000Z",
    },
  ]);
  serviceClient.tables.set("merchant_settlement_accounts", [
    {
      id: "settlement-1",
      merchant_id: "merchant-admin",
      bank_name: "Test Bank",
      account_number: "0123456789",
      account_name: "Merchant Admin",
      currency: "NGN",
      is_default: true,
      verification_status: "verified",
      status: "active",
    },
  ]);

  const syncedRequirements = await attachService.syncCaseRequirements({
    caseId: "case-kyc-1",
    proofOfAddress: {
      storageKey: "kyc-documents/address-latest.pdf",
      checksumSha256: "address-hash-1",
      uploadedAt: "2026-07-07T00:00:00.000Z",
      contentType: "application/pdf",
      providerName: "manual_upload",
      providerReference: "address-ref-1",
    },
    activityProfile: {
      businessActivityType: "retail",
      expectedMonthlyTransactionValue: "500000",
      expectedTransactionCount: 150,
      typicalCustomerType: "consumers",
      reasonForHigherCollectionNeed: "expanded inventory",
      expectedSettlementBehaviour: "daily",
      submittedAt: "2026-07-07T00:00:00.000Z",
    },
  });
  assert.equal(syncedRequirements.merchantId, "merchant-admin");
  assert.equal(attachRepository.lastUpsertRequirements?.caseId, "case-kyc-1");
  const syncedBvn = attachRepository.lastUpsertRequirements?.requirements.find(
    (requirement) => requirement.requirementCode === "bvn",
  );
  assert.equal(syncedBvn?.requirementState, "reused");
  assert.equal(syncedBvn?.policyRuleApplied, "reuse_bvn_v1");
  const syncedAddress = attachRepository.lastUpsertRequirements?.requirements.find(
    (requirement) => requirement.requirementCode === "proof_of_address",
  );
  assert.equal(syncedAddress?.requirementState, "pending");
  assert.equal(syncedAddress?.metadata.storageKey, "kyc-documents/address-latest.pdf");
  const syncedActivity = attachRepository.lastUpsertRequirements?.requirements.find(
    (requirement) => requirement.requirementCode === "activity_profile",
  );
  assert.equal(syncedActivity?.requirementState, "pending");
  assert.equal("rawDocument" in (syncedActivity?.metadata || {}), false);

  const linkedMerchantService = await createSoloPlusServerService({
    requestedMode: "internal_test",
    merchantId: "merchant-admin",
    onboardingSessionId: "session-linked-admin-merchant",
    authClient: adminClient,
    serviceClient,
    repository: attachRepository,
    env: createEnv(),
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    generateId: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
  assert.equal(
    linkedMerchantService.resolvedAccess.onboardingSessionOwnership?.ownershipBasis,
    "merchant_owner",
  );

  serviceClient.tables.set("platform_settings", [
    { key: "plan_migration_solo_lite_enabled", value: "false" },
    { key: "solo_plus_enabled", value: "false" },
    { key: "solo_plus_kyc_enabled", value: "true" },
  ]);
  await expectAccessError(
    () =>
      createSoloPlusServerService({
        requestedMode: "public",
        onboardingSessionId: "session-owned",
        authClient,
        serviceClient,
        repository,
        env: createEnv(),
      }),
    "SOLO_PLUS_SERVER_FORBIDDEN",
  );

  console.log("solo-plus-server-service.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
