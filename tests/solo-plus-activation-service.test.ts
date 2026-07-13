import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";

import type {
  SoloPlusAdminCaseDetailRecord,
  SoloPlusAdminCaseEventListInput,
  SoloPlusAdminCaseEventListResult,
  SoloPlusAdminCaseListInput,
  SoloPlusAdminCaseListResult,
  SoloPlusActivationMerchantRecord,
  SoloPlusActivationWorkspaceRecord,
  SoloPlusActivationWorkspaceSubscriptionRecord,
  SoloPlusCaseActivationAtomicParams,
  SoloPlusCaseActivationAtomicResult,
  SoloPlusCaseRecord,
  SoloPlusCaseRepository,
} from "../src/lib/solo-plus/repository";

type ActivationServiceModule = typeof import("../src/lib/solo-plus/server/activation");
type AccessContextModule = typeof import("../src/lib/solo-plus/server/access-context");

let createSoloPlusActivationService: ActivationServiceModule["createSoloPlusActivationService"];
let SoloPlusActivationServiceError: ActivationServiceModule["SoloPlusActivationServiceError"];
let SoloPlusServerAccessError: AccessContextModule["SoloPlusServerAccessError"];

type FakeUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
  email_confirmed_at?: string | null;
};

class FakeAuthClient {
  currentUser: FakeUser | null = null;

  auth = {
    getUser: async () => ({
      data: { user: this.currentUser },
      error: this.currentUser ? null : { message: "missing user" },
    }),
  };

  from() {
    throw new Error("from() should not be called in activation auth tests");
  }
}

class FakeSoloPlusRepository implements SoloPlusCaseRepository {
  readonly cases = new Map<string, SoloPlusCaseRecord>();
  lastActivationInput: SoloPlusCaseActivationAtomicParams | null = null;

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

  async listRequirements(): Promise<readonly never[]> {
    return [];
  }

  async listSafeEvents(): Promise<readonly never[]> {
    return [];
  }

  async findLatestReviewDecisionEvent(): Promise<null> {
    return null;
  }

  async listAdminCases(_: SoloPlusAdminCaseListInput): Promise<SoloPlusAdminCaseListResult> {
    return { items: [], nextCursor: null };
  }

  async getAdminCaseDetail(_: string): Promise<SoloPlusAdminCaseDetailRecord | null> {
    return null;
  }

  async listAdminCaseEvents(
    __: string,
    ___: SoloPlusAdminCaseEventListInput,
  ): Promise<SoloPlusAdminCaseEventListResult> {
    return { items: [], nextCursor: null };
  }

  async createCaseWithRequirementsAndEvent(): Promise<never> {
    throw new Error("createCaseWithRequirementsAndEvent should not be called");
  }

  async attachMerchantToOnboardingCase(): Promise<never> {
    throw new Error("attachMerchantToOnboardingCase should not be called");
  }

  async transitionCaseStatus(): Promise<never> {
    throw new Error("transitionCaseStatus should not be called");
  }

  async upsertCaseRequirements(): Promise<readonly never[]> {
    return [];
  }

  async activateSoloPlusCase(
    input: SoloPlusCaseActivationAtomicParams,
  ): Promise<SoloPlusCaseActivationAtomicResult> {
    this.lastActivationInput = JSON.parse(JSON.stringify(input)) as SoloPlusCaseActivationAtomicParams;
    const current = this.cases.get(input.caseId);
    if (!current) {
      return { kind: "not_found" };
    }

    return {
      kind: "applied",
      caseRecord: current,
      event: {
        id: "activation-event-1",
        caseId: input.caseId,
        eventType: "case_activated",
        previousState: {},
        newState: {},
        actorType: "admin",
        actorId: input.activatorAdminId,
        requestIdempotencyKey: input.requestIdempotencyKey,
        reason: "Solo Plus activation completed.",
        policyVersion: input.policyVersion || "solo-plus-policy-v1",
        createdAt: "2026-07-11T00:00:00.000Z",
      },
      merchant: {
        id: "merchant-1",
        subscriptionPlan: "solo_plus",
        merchantTier: "individual",
        monthlyCollectionLimit: 5000000,
        setupMode: false,
        liveFeaturesEnabled: true,
        liveFeaturesActivatedAt: "2026-07-11T00:00:00.000Z",
        onboardingStatus: "active",
        workspaceId: "workspace-1",
        verificationStatus: "verified",
        updatedAt: "2026-07-11T00:00:00.000Z",
      } satisfies SoloPlusActivationMerchantRecord,
      workspace: {
        id: "workspace-1",
        merchantId: "merchant-1",
        ownerUserId: "admin-1",
        workspaceType: "personal",
        displayName: "Solo Plus Workspace",
        planType: "solo_plus",
        onboardingStatus: "active",
        setupMode: false,
        liveFeaturesEnabled: true,
        updatedAt: "2026-07-11T00:00:00.000Z",
      } satisfies SoloPlusActivationWorkspaceRecord,
      workspaceSubscription: {
        id: "workspace-sub-1",
        workspaceId: "workspace-1",
        merchantId: "merchant-1",
        planType: "solo_plus",
        subscriptionStatus: "active",
        paymentReference: "SPL-REVIEW-1",
        amountPaid: "13000.00",
        periodStart: "2026-07-11T00:00:00.000Z",
        periodEnd: null,
        updatedAt: "2026-07-11T00:00:00.000Z",
      } satisfies SoloPlusActivationWorkspaceSubscriptionRecord,
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

async function loadModules() {
  ({
    createSoloPlusActivationService,
    SoloPlusActivationServiceError,
  } = await import(new URL("../src/lib/solo-plus/server/activation.ts", import.meta.url).href));
  ({ SoloPlusServerAccessError } = await import(new URL("../src/lib/solo-plus/server/access-context.ts", import.meta.url).href));
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyShimPath = require.resolve("server-only");
  const serverOnlyShimModule = new Module(serverOnlyShimPath);
  serverOnlyShimModule.filename = serverOnlyShimPath;
  serverOnlyShimModule.loaded = true;
  serverOnlyShimModule.exports = {};
  require.cache[serverOnlyShimPath] = serverOnlyShimModule as never;

  await loadModules();

  const unauthorizedAuthClient = new FakeAuthClient();
  await assert.rejects(
    () =>
      createSoloPlusActivationService({
        authClient: unauthorizedAuthClient as never,
        repository: new FakeSoloPlusRepository(),
        env: createEnv(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusServerAccessError);
      assert.equal(error.code, "SOLO_PLUS_SERVER_UNAUTHORIZED");
      return true;
    },
  );

  const nonAdminAuthClient = new FakeAuthClient();
  nonAdminAuthClient.currentUser = {
    id: "merchant-user",
    email: "merchant@example.test",
    email_confirmed_at: "2026-07-11T00:00:00.000Z",
    app_metadata: { is_super_admin: false },
  };
  await assert.rejects(
    () =>
      createSoloPlusActivationService({
        authClient: nonAdminAuthClient as never,
        repository: new FakeSoloPlusRepository(),
        env: createEnv(),
      }),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusActivationServiceError);
      assert.equal(error.code, "SOLO_PLUS_SERVER_FORBIDDEN");
      return true;
    },
  );

  const adminAuthClient = new FakeAuthClient();
  adminAuthClient.currentUser = {
    id: "admin-1",
    email: "admin@example.test",
    email_confirmed_at: "2026-07-11T00:00:00.000Z",
    app_metadata: { is_super_admin: true },
  };

  const repository = new FakeSoloPlusRepository();
  repository.seedCase({
    id: "activation-case-1",
    merchantId: "merchant-1",
    onboardingSessionId: null,
    flowOrigin: "upgrade",
    sourcePlan: "solo_lite",
    targetPlan: "solo_plus",
    caseStatus: "approved",
    paymentStatus: "paid",
    refundStatus: "none",
    paymentRecordId: null,
    paymentProvider: null,
    paymentReference: "SPL-REVIEW-1",
    expectedAmount: "13000.00",
    paymentCurrency: "NGN",
    requirementsPolicyVersion: "solo-plus-policy-v1",
    requirementsSnapshot: {},
    activePlanSnapshot: "solo_lite",
    rejectionReason: null,
    approvedAt: "2026-07-11T00:00:00.000Z",
    approvedByAdminId: "admin-1",
    rejectedAt: null,
    rejectedByAdminId: null,
    reopenedAt: null,
    reopenedByAdminId: null,
    idempotencyKey: "case-idem",
    activationIdempotencyKey: null,
    refundIdempotencyKey: null,
    rowVersion: 4,
    auditMetadata: {},
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  });

  const service = await createSoloPlusActivationService({
    authClient: adminAuthClient as never,
    repository,
    env: createEnv(),
  });

  const applied = await service.activateCase({
    caseId: "activation-case-1",
    expectedRowVersion: 4,
    requestIdempotencyKey: "activation-idem-1",
    policyVersion: "solo-plus-activation-v1",
  });
  assert.equal(applied.kind, "applied");
  assert.equal(repository.lastActivationInput?.activatorAdminId, "admin-1");
  assert.equal(repository.lastActivationInput?.requestIdempotencyKey, "activation-idem-1");
  assert.equal(applied.caseRecord.caseStatus, "approved");
  assert.equal(applied.merchant?.subscriptionPlan, "solo_plus");
  assert.equal(applied.workspaceSubscription?.subscriptionStatus, "active");

  const replay = await service.activateCase({
    caseId: "activation-case-1",
    expectedRowVersion: 4,
    requestIdempotencyKey: "activation-idem-1",
    policyVersion: "solo-plus-activation-v1",
  });
  assert.equal(replay.kind, "applied");

  console.log("solo-plus-activation-service.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
