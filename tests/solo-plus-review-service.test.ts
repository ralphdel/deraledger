import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";

import type {
  SoloPlusAdminCaseDetailRecord,
  SoloPlusAdminCaseEventListInput,
  SoloPlusAdminCaseEventListResult,
  SoloPlusAdminCaseListInput,
  SoloPlusAdminCaseListResult,
  SoloPlusCaseActivationAtomicParams,
  SoloPlusCaseActivationAtomicResult,
  SoloPlusCaseEventRecord,
  SoloPlusCaseCreateAtomicResult,
  SoloPlusCaseRecord,
  SoloPlusCaseRepository,
  SoloPlusCaseRequirementRecord,
  SoloPlusCaseTransitionAtomicParams,
  SoloPlusCaseTransitionAtomicResult,
  SoloPlusAttachMerchantAtomicParams,
  SoloPlusAttachMerchantAtomicResult,
} from "../src/lib/solo-plus/repository";

type ReviewServiceModule = typeof import("../src/lib/solo-plus/server/review-service");

let createSoloPlusReviewerService: ReviewServiceModule["createSoloPlusReviewerService"];
let SoloPlusReviewerServiceError: ReviewServiceModule["SoloPlusReviewerServiceError"];

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
    throw new Error("from() should not be called in reviewer auth tests");
  }
}

class FakeSoloPlusRepository implements SoloPlusCaseRepository {
  readonly cases = new Map<string, SoloPlusCaseRecord>();
  readonly events = new Map<string, SoloPlusCaseEventRecord[]>();
  transitionCallCount = 0;

  seedCase(caseRecord: SoloPlusCaseRecord) {
    this.cases.set(caseRecord.id, JSON.parse(JSON.stringify(caseRecord)) as SoloPlusCaseRecord);
    this.events.set(caseRecord.id, []);
  }

  async findCaseById(caseId: string): Promise<SoloPlusCaseRecord | null> {
    return this.cloneCase(this.cases.get(caseId) ?? null);
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

  async listRequirements(): Promise<readonly SoloPlusCaseRequirementRecord[]> {
    return [];
  }

  async listSafeEvents(caseId: string): Promise<readonly SoloPlusCaseEventRecord[]> {
    return [...(this.events.get(caseId) || [])].map((event) =>
      JSON.parse(JSON.stringify(event)) as SoloPlusCaseEventRecord,
    );
  }

  async findLatestReviewDecisionEvent(
    caseId: string,
  ): Promise<SoloPlusCaseEventRecord | null> {
    const events = this.events.get(caseId) || [];
    const latest = events.at(-1) ?? null;
    return latest == null
      ? null
      : (JSON.parse(JSON.stringify(latest)) as SoloPlusCaseEventRecord);
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

  async createCaseWithRequirementsAndEvent(): Promise<SoloPlusCaseCreateAtomicResult> {
    throw new Error("createCaseWithRequirementsAndEvent should not be called");
  }

  async attachMerchantToOnboardingCase(): Promise<SoloPlusAttachMerchantAtomicResult> {
    throw new Error("attachMerchantToOnboardingCase should not be called");
  }

  async transitionCaseStatus(
    input: SoloPlusCaseTransitionAtomicParams,
  ): Promise<SoloPlusCaseTransitionAtomicResult> {
    this.transitionCallCount += 1;
    const current = this.cases.get(input.caseId);
    if (!current) {
      return { kind: "not_found" };
    }

    const existingEvent = (this.events.get(input.caseId) || []).find(
      (event) => event.requestIdempotencyKey === input.requestIdempotencyKey,
    );
    if (existingEvent) {
      if (
        existingEvent.eventType === input.event.eventType
        && existingEvent.reason === input.event.reason
        && existingEvent.actorId === input.event.actorId
        && existingEvent.policyVersion === input.event.policyVersion
        && existingEvent.previousState.rowVersion === input.expectedRowVersion
        && current.caseStatus === input.targetStatus
      ) {
        return {
          kind: "idempotent_replay",
          caseRecord: this.cloneCase(current)!,
          event: JSON.parse(JSON.stringify(existingEvent)) as SoloPlusCaseEventRecord,
        };
      }

      return {
        kind: "idempotency_conflict",
        currentCase: this.cloneCase(current)!,
      };
    }

    if (current.rowVersion !== input.expectedRowVersion) {
      return {
        kind: "version_conflict",
        currentCase: this.cloneCase(current)!,
      };
    }

    if (current.caseStatus !== input.expectedCurrentStatus) {
      if (current.caseStatus === input.targetStatus) {
        return {
          kind: "idempotent_replay",
          caseRecord: this.cloneCase(current)!,
          event: null,
        };
      }

      return {
        kind: "state_conflict",
        currentCase: this.cloneCase(current)!,
      };
    }

    const updated: SoloPlusCaseRecord = {
      ...current,
      ...input.patch,
      caseStatus: input.targetStatus,
      rowVersion: current.rowVersion + 1,
      updatedAt: input.event.createdAt,
    };

    this.cases.set(updated.id, this.cloneCase(updated)!);
    this.events.set(updated.id, [...(this.events.get(updated.id) || []), JSON.parse(JSON.stringify(input.event)) as SoloPlusCaseEventRecord]);

    return {
      kind: "updated",
      caseRecord: this.cloneCase(updated)!,
      event: JSON.parse(JSON.stringify(input.event)) as SoloPlusCaseEventRecord,
    };
  }

  async upsertCaseRequirements(): Promise<readonly SoloPlusCaseRequirementRecord[]> {
    return [];
  }

  async activateSoloPlusCase(
    input: SoloPlusCaseActivationAtomicParams,
  ): Promise<SoloPlusCaseActivationAtomicResult> {
    const current = this.cases.get(input.caseId);
    if (!current) {
      return { kind: "not_found" };
    }

    return {
      kind: "feature_disabled",
      currentCase: this.cloneCase(current),
    };
  }

  private cloneCase(caseRecord: SoloPlusCaseRecord | null): SoloPlusCaseRecord | null {
    return caseRecord == null
      ? null
      : (JSON.parse(JSON.stringify(caseRecord)) as SoloPlusCaseRecord);
  }
}

function buildCaseRecord(overrides: Partial<SoloPlusCaseRecord> = {}): SoloPlusCaseRecord {
  return {
    id: overrides.id || "review-case-1",
    merchantId: overrides.merchantId ?? "merchant-review",
    onboardingSessionId: overrides.onboardingSessionId ?? null,
    flowOrigin: overrides.flowOrigin ?? "upgrade",
    sourcePlan: overrides.sourcePlan ?? "solo_lite",
    targetPlan: "solo_plus",
    caseStatus: overrides.caseStatus ?? "manual_review",
    paymentStatus: overrides.paymentStatus ?? "paid",
    refundStatus: overrides.refundStatus ?? "none",
    paymentRecordId: null,
    paymentProvider: null,
    paymentReference: "SPL-REVIEW-1",
    expectedAmount: "13000.00",
    paymentCurrency: "NGN",
    requirementsPolicyVersion: "solo-plus-policy-v1",
    requirementsSnapshot: {},
    activePlanSnapshot: "solo_lite",
    rejectionReason: overrides.rejectionReason ?? null,
    approvedAt: overrides.approvedAt ?? null,
    approvedByAdminId: overrides.approvedByAdminId ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
    rejectedByAdminId: overrides.rejectedByAdminId ?? null,
    reopenedAt: overrides.reopenedAt ?? null,
    reopenedByAdminId: overrides.reopenedByAdminId ?? null,
    idempotencyKey: "review-idem-case",
    activationIdempotencyKey: null,
    refundIdempotencyKey: overrides.refundIdempotencyKey ?? null,
    rowVersion: overrides.rowVersion ?? 0,
    auditMetadata: overrides.auditMetadata ?? {
      fixture_scope: "phase2b_admin_detail_smoke",
      fixture_run_id: "phase2b-review-service-test",
    },
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function createEnv(
  caseId = "11111111-1111-4111-8111-111111111111",
  decision: "request_more_information" | "reject" = "request_more_information",
) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: "true",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID: caseId,
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: decision,
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID:
      "phase2b-review-service-test",
    VERCEL_ENV: "preview",
  } as unknown as NodeJS.ProcessEnv;
}

async function loadModules() {
  ({
    createSoloPlusReviewerService,
    SoloPlusReviewerServiceError,
  } = await import(new URL("../src/lib/solo-plus/server/review-service.ts", import.meta.url).href));
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
      createSoloPlusReviewerService({
        authClient: unauthorizedAuthClient as never,
        repository: new FakeSoloPlusRepository(),
        resolveAdminAuthority: async () => ({ ok: false, status: 401, error: "Unauthorized" }),
        env: createEnv(),
        generateId: () => "event-review-1",
      }),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusReviewerServiceError);
      assert.equal(error.code, "SOLO_PLUS_SERVER_UNAUTHORIZED");
      return true;
    },
  );

  const nonAdminAuthClient = new FakeAuthClient();
  nonAdminAuthClient.currentUser = {
    id: "merchant-user",
    email: "merchant@example.test",
    email_confirmed_at: "2026-07-09T00:00:00.000Z",
    app_metadata: { is_super_admin: false },
  };
  await assert.rejects(
    () =>
      createSoloPlusReviewerService({
        authClient: nonAdminAuthClient as never,
        repository: new FakeSoloPlusRepository(),
        resolveAdminAuthority: async () => ({
          ok: false,
          status: 403,
          error: "SuperAdmin access required",
        }),
        env: createEnv(),
        generateId: () => "event-review-2",
      }),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusReviewerServiceError);
      assert.equal(error.code, "SOLO_PLUS_SERVER_FORBIDDEN");
      return true;
    },
  );

  const adminAuthClient = new FakeAuthClient();
  adminAuthClient.currentUser = {
    id: "admin-reviewer",
    email: "admin@example.test",
    email_confirmed_at: "2026-07-09T00:00:00.000Z",
    app_metadata: { is_super_admin: true },
  };

  const disabledEnv = createEnv();
  delete disabledEnv.DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED;
  let disabledAuthorityCalls = 0;
  await assert.rejects(
    () =>
      createSoloPlusReviewerService({
        authClient: adminAuthClient as never,
        repository: new FakeSoloPlusRepository(),
        resolveAdminAuthority: async () => {
          disabledAuthorityCalls += 1;
          return { ok: true, userId: "admin-reviewer" };
        },
        env: disabledEnv,
        generateId: () => "event-review-disabled",
      }),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusReviewerServiceError);
      assert.equal(error.code, "SOLO_PLUS_SERVER_FORBIDDEN");
      assert.match(error.message, /disabled/i);
      return true;
    },
  );
  assert.equal(disabledAuthorityCalls, 0);

  const wrongRunRepository = new FakeSoloPlusRepository();
  const wrongRunCaseId = "33333333-3333-4333-8333-333333333333";
  wrongRunRepository.seedCase(buildCaseRecord({
    id: wrongRunCaseId,
    auditMetadata: {
      fixture_scope: "phase2b_admin_detail_smoke",
      fixture_run_id: "different-valid-fixture-run",
    },
  }));
  const wrongRunService = await createSoloPlusReviewerService({
    authClient: adminAuthClient as never,
    repository: wrongRunRepository,
    resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
    env: createEnv(wrongRunCaseId, "request_more_information"),
    generateId: () => "event-review-wrong-run",
  });
  await assert.rejects(
    () =>
      wrongRunService.reviewCase({
        caseId: wrongRunCaseId,
        expectedRowVersion: 0,
        requestIdempotencyKey: "wrong-fixture-run-1",
        decision: "request_more_information",
        reason: "This must stop before transition.",
      }),
    /fixture marker does not match/i,
  );
  assert.equal(wrongRunRepository.transitionCallCount, 0);

  const repository = new FakeSoloPlusRepository();
  const moreInfoCaseId = "11111111-1111-4111-8111-111111111111";
  repository.seedCase(buildCaseRecord({ id: moreInfoCaseId, rowVersion: 4 }));
  const service = await createSoloPlusReviewerService({
    authClient: adminAuthClient as never,
    repository,
    resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
    env: createEnv(moreInfoCaseId, "request_more_information"),
    now: () => new Date("2026-07-10T00:00:00.000Z"),
    generateId: () => "event-review-3",
  });

  const requestedMoreInformation = await service.reviewCase({
    caseId: moreInfoCaseId,
    expectedRowVersion: 4,
    requestIdempotencyKey: "more-info-review-1",
    decision: "request_more_information",
    reason: "Please provide a clearer synthetic fixture response.",
  });
  assert.equal(requestedMoreInformation.caseRecord.caseStatus, "verification_pending");
  assert.equal(requestedMoreInformation.event?.actorType, "admin");
  assert.equal(requestedMoreInformation.event?.actorId, "admin-reviewer");

  const exactReplay = await service.reviewCase({
    caseId: moreInfoCaseId,
    expectedRowVersion: 4,
    requestIdempotencyKey: "more-info-review-1",
    decision: "request_more_information",
    reason: "Please provide a clearer synthetic fixture response.",
  });
  assert.equal(exactReplay.outcome, "idempotent_replay");

  await assert.rejects(
    () =>
      service.reviewCase({
        caseId: moreInfoCaseId,
        expectedRowVersion: 4,
        requestIdempotencyKey: "more-info-review-1",
        decision: "request_more_information",
        reason: "Changed reason must conflict.",
      }),
    /SOLO_PLUS_IDEMPOTENCY_CONFLICT|idempotency/i,
  );

  await assert.rejects(
    () =>
      service.reviewCase({
        caseId: moreInfoCaseId,
        expectedRowVersion: 4,
        requestIdempotencyKey: "more-info-review-too-long",
        decision: "request_more_information",
        reason: "x".repeat(1001),
      }),
    /at most 1000 characters/i,
  );

  await assert.rejects(
    () =>
      service.reviewCase({
        caseId: moreInfoCaseId,
        expectedRowVersion: 5,
        requestIdempotencyKey: "scope-decision-mismatch",
        decision: "reject",
        reason: "This decision is outside the exact scope.",
      }),
    /outside the approved staging scope/i,
  );

  await assert.rejects(
    () =>
      service.reviewCase({
        caseId: "22222222-2222-4222-8222-222222222222",
        expectedRowVersion: 1,
        requestIdempotencyKey: "scope-case-mismatch",
        decision: "request_more_information",
        reason: "This case is outside the exact scope.",
      }),
    /outside the approved staging scope/i,
  );

  const rejectCaseId = "22222222-2222-4222-8222-222222222222";
  const rejectRepository = new FakeSoloPlusRepository();
  rejectRepository.seedCase(
    buildCaseRecord({
      id: rejectCaseId,
      rowVersion: 1,
      paymentStatus: "pending",
      refundStatus: "none",
    }),
  );
  let rejectAuthorityCalls = 0;
  await assert.rejects(
    () =>
      createSoloPlusReviewerService({
        authClient: adminAuthClient as never,
        repository: rejectRepository,
        resolveAdminAuthority: async () => {
          rejectAuthorityCalls += 1;
          return { ok: true, userId: "admin-reviewer" };
        },
        env: createEnv(rejectCaseId, "reject"),
        now: () => new Date("2026-07-10T00:00:00.000Z"),
        generateId: () => "event-review-reject",
      }),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusReviewerServiceError);
      assert.equal(error.code, "SOLO_PLUS_SERVER_FORBIDDEN");
      assert.match(error.message, /disabled/i);
      return true;
    },
  );
  assert.equal(rejectAuthorityCalls, 0);
  assert.equal(rejectRepository.transitionCallCount, 0);

  console.log("solo-plus-review-service.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
