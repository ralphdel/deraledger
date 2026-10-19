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
  readonly requirements = new Map<string, SoloPlusCaseRequirementRecord[]>();
  transitionCallCount = 0;
  lastTransitionInput: SoloPlusCaseTransitionAtomicParams | null = null;
  activationCallCount = 0;

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

  async listRequirements(caseId: string): Promise<readonly SoloPlusCaseRequirementRecord[]> {
    return this.requirements.get(caseId) ?? [];
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
    this.lastTransitionInput = input;
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
    this.activationCallCount += 1;
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
    paymentRecordId: overrides.paymentRecordId ?? null,
    paymentProvider: overrides.paymentProvider ?? null,
    paymentReference: overrides.paymentReference === undefined
      ? "SPL-REVIEW-1"
      : overrides.paymentReference,
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
    activationIdempotencyKey: overrides.activationIdempotencyKey ?? null,
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

function buildSatisfiedRequirements(caseId: string): SoloPlusCaseRequirementRecord[] {
  return ["activity_profile", "bvn", "id_document", "proof_of_address", "selfie_liveness", "settlement_account"].map((requirementCode, index) => ({
    id: `synthetic-requirement-${index}`,
    caseId,
    requirementCode: requirementCode as SoloPlusCaseRequirementRecord["requirementCode"],
    requirementState: "passed",
    verificationLogId: null,
    evidenceSourceType: "manual_submission",
    evidenceSourceId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    evidenceReference: null,
    originalCompletedAt: null,
    reuseDecisionAt: null,
    reuseReason: null,
    policyRuleApplied: null,
    reviewedByAdminId: "admin-reviewer",
    reviewNote: "Synthetic requirement.",
    providerName: null,
    providerReference: null,
    failureReason: null,
    completedAt: "2026-10-14T00:00:00.000Z",
    metadata: {},
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
  }));
}

function createEnv(
  caseId = "11111111-1111-4111-8111-111111111111",
  decision: "request_more_information" | "reject" | "approve" | "reopen" = "request_more_information",
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
  assert.equal(requestedMoreInformation.event?.id, "event-review-3");
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

  const freshRejectCaseId = "55555555-5555-4555-8555-555555555555";
  const freshRejectRunId = "phase2b-reject-20261013-a1b2";
  const freshRejectEnv = createEnv(freshRejectCaseId, "reject");
  freshRejectEnv.DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED = "true";
  freshRejectEnv.DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID = freshRejectRunId;
  freshRejectEnv.DERALEDGER_DEPLOYMENT_TARGET = "staging";
  freshRejectEnv.NEXT_PUBLIC_SUPABASE_URL = "https://fsjljliiyfchkwbjifzw.supabase.co";
  freshRejectEnv.VERCEL_PROJECT_PRODUCTION_URL = "deraledger-staging.vercel.app";
  const freshRejectCase = buildCaseRecord({
    id: freshRejectCaseId,
    rowVersion: 1,
    paymentStatus: "pending",
    paymentReference: null,
    auditMetadata: {
      fixture_scope: "phase2b_admin_detail_smoke",
      fixture_run_id: freshRejectRunId,
      synthetic_read_only_admin_smoke: true,
    },
  });
  const freshRejectRepository = new FakeSoloPlusRepository();
  freshRejectRepository.seedCase(freshRejectCase);
  const freshRejectService = await createSoloPlusReviewerService({
    repository: freshRejectRepository,
    resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
    env: freshRejectEnv,
    now: () => new Date("2026-10-13T00:00:00.000Z"),
    generateId: () => "synthetic-reject-event",
  });
  const rejectInput = {
    caseId: freshRejectCaseId,
    expectedRowVersion: 1,
    requestIdempotencyKey: "synthetic-reject-service-test",
    decision: "reject" as const,
    reason: "Please revise the synthetic details.",
  };
  for (const blockedDecision of ["request_more_information", "approve", "reopen"] as const) {
    await assert.rejects(
      () => freshRejectService.reviewCase({ ...rejectInput, decision: blockedDecision }),
      /outside the approved staging scope/i,
    );
  }
  assert.equal(freshRejectRepository.transitionCallCount, 0);

  for (const unsafeCase of [
    buildCaseRecord({ ...freshRejectCase, paymentStatus: "paid" }),
    buildCaseRecord({ ...freshRejectCase, paymentRecordId: "66666666-6666-4666-8666-666666666666" }),
    buildCaseRecord({ ...freshRejectCase, paymentProvider: "paystack" }),
    buildCaseRecord({ ...freshRejectCase, paymentReference: "synthetic-payment-reference" }),
    buildCaseRecord({ ...freshRejectCase, rowVersion: 2 }),
    buildCaseRecord({ ...freshRejectCase, auditMetadata: {
      fixture_scope: "phase2b_admin_detail_smoke",
      fixture_run_id: freshRejectRunId,
    } }),
    buildCaseRecord({ ...freshRejectCase, auditMetadata: {
      fixture_scope: "phase2b_admin_detail_smoke",
      fixture_run_id: "phase2b-rmi-20261001-002",
      synthetic_read_only_admin_smoke: true,
    } }),
  ]) {
    const unsafeRepository = new FakeSoloPlusRepository();
    unsafeRepository.seedCase(unsafeCase);
    const unsafeService = await createSoloPlusReviewerService({
      repository: unsafeRepository,
      resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
      env: freshRejectEnv,
      generateId: () => "unused-synthetic-event",
    });
    await assert.rejects(
      () => unsafeService.reviewCase(rejectInput),
      /fresh unpaid staging fixture|fixture marker does not match/i,
    );
    assert.equal(unsafeRepository.transitionCallCount, 0);
  }

  const previouslyReviewedRepository = new FakeSoloPlusRepository();
  previouslyReviewedRepository.seedCase(freshRejectCase);
  previouslyReviewedRepository.events.set(freshRejectCaseId, [{
    id: "66666666-6666-4666-8666-666666666666",
    caseId: freshRejectCaseId,
    eventType: "case_review_requested_more_information",
    previousState: {},
    newState: {},
    actorType: "admin",
    actorId: "admin-reviewer",
    requestIdempotencyKey: "synthetic-prior-review",
    reason: "Synthetic prior review.",
    policyVersion: "solo-plus-policy-v1",
    createdAt: "2026-10-12T00:00:00.000Z",
  }]);
  const previouslyReviewedService = await createSoloPlusReviewerService({
    repository: previouslyReviewedRepository,
    resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
    env: freshRejectEnv,
  });
  await assert.rejects(
    () => previouslyReviewedService.reviewCase(rejectInput),
    /fresh unpaid staging fixture/i,
  );
  assert.equal(previouslyReviewedRepository.transitionCallCount, 0);

  const syntheticReject = await freshRejectService.reviewCase(rejectInput);
  assert.equal(syntheticReject.caseRecord.caseStatus, "rejected");
  assert.equal(syntheticReject.caseRecord.rowVersion, 2);
  assert.equal(syntheticReject.caseRecord.refundStatus, "none");
  assert.equal(syntheticReject.event?.id, "synthetic-reject-event");
  assert.equal(syntheticReject.event?.eventType, "case_rejected");
  assert.equal(freshRejectRepository.transitionCallCount, 1);
  await assert.rejects(
    () => freshRejectService.reviewCase(rejectInput),
    /fresh unpaid staging fixture/i,
  );
  assert.equal(freshRejectRepository.transitionCallCount, 1);

  const rejectedForReopen = freshRejectRepository.cases.get(freshRejectCaseId)!;
  freshRejectRepository.cases.set(freshRejectCaseId, buildCaseRecord({
    ...rejectedForReopen,
    rowVersion: rejectedForReopen.rowVersion + 1,
    auditMetadata: {
      ...rejectedForReopen.auditMetadata,
      fixture_scope: "phase2b_reopen_acceptance",
      fixture_origin_scope: "phase2b_admin_detail_smoke",
      synthetic_reopen_acceptance: true,
    },
  }));

  const reopenEnv = createEnv(freshRejectCaseId, "reopen");
  reopenEnv.DERALEDGER_PHASE2B_SOLO_PLUS_REOPEN_ACCEPTANCE_ENABLED = "true";
  reopenEnv.DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID = freshRejectRunId;
  reopenEnv.DERALEDGER_DEPLOYMENT_TARGET = "staging";
  reopenEnv.NEXT_PUBLIC_SUPABASE_URL = "https://fsjljliiyfchkwbjifzw.supabase.co";
  reopenEnv.VERCEL_PROJECT_PRODUCTION_URL = "deraledger-staging.vercel.app";
  const reopenService = await createSoloPlusReviewerService({
    repository: freshRejectRepository,
    resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
    env: reopenEnv,
    now: () => new Date("2026-10-19T00:00:00.000Z"),
    generateId: () => "synthetic-reopen-event",
  });
  const reopenInput = {
    caseId: freshRejectCaseId,
    expectedRowVersion: 3,
    requestIdempotencyKey: "synthetic-reopen-service-test",
    decision: "reopen" as const,
    reason: "Reopen the synthetic case for verification.",
  };
  for (const blockedDecision of ["request_more_information", "reject", "approve"] as const) {
    await assert.rejects(
      () => reopenService.reviewCase({ ...reopenInput, decision: blockedDecision }),
      /outside the approved staging scope/i,
    );
  }
  const reopened = await reopenService.reviewCase(reopenInput);
  assert.equal(reopened.caseRecord.caseStatus, "verification_pending");
  assert.equal(reopened.caseRecord.rowVersion, 4);
  assert.equal(reopened.caseRecord.paymentStatus, "pending");
  assert.equal(reopened.caseRecord.activationIdempotencyKey, null);
  assert.equal(reopened.event?.eventType, "case_reopened");
  assert.equal(freshRejectRepository.events.get(freshRejectCaseId)?.length, 2);
  const reopenReplay = await reopenService.reviewCase(reopenInput);
  assert.equal(reopenReplay.outcome, "idempotent_replay");
  assert.equal(freshRejectRepository.events.get(freshRejectCaseId)?.length, 2);
  await assert.rejects(
    () => reopenService.reviewCase({ ...reopenInput, requestIdempotencyKey: "conflicting-reopen-key" }),
    /exact rejected synthetic staging fixture/i,
  );
  assert.equal(freshRejectRepository.transitionCallCount, 3);

  const approveCaseId = "77777777-7777-4777-8777-777777777777";
  const approveRunId = "phase2b-approve-20261014-a1b2";
  const approveEnv = createEnv(approveCaseId, "approve");
  approveEnv.DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED = "true";
  approveEnv.DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID = approveRunId;
  approveEnv.DERALEDGER_DEPLOYMENT_TARGET = "staging";
  approveEnv.NEXT_PUBLIC_SUPABASE_URL = "https://fsjljliiyfchkwbjifzw.supabase.co";
  approveEnv.VERCEL_PROJECT_PRODUCTION_URL = "deraledger-staging.vercel.app";
  const approveCase = buildCaseRecord({
    id: approveCaseId,
    rowVersion: 3,
    paymentStatus: "paid",
    paymentRecordId: "88888888-8888-4888-8888-888888888888",
    auditMetadata: {
      fixture_scope: "phase2b_approve_acceptance",
      fixture_run_id: approveRunId,
      synthetic_approve_acceptance: true,
    },
  });
  const approveRepository = new FakeSoloPlusRepository();
  approveRepository.seedCase(approveCase);
  approveRepository.requirements.set(approveCaseId, buildSatisfiedRequirements(approveCaseId));
  const approveService = await createSoloPlusReviewerService({
    repository: approveRepository,
    resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
    env: approveEnv,
    now: () => new Date("2026-10-14T00:00:00.000Z"),
    generateId: () => "synthetic-approve-event",
  });
  const approveInput = {
    caseId: approveCaseId,
    expectedRowVersion: 3,
    requestIdempotencyKey: "synthetic-approve-service-test",
    decision: "approve" as const,
    reason: "Synthetic requirements verified.",
  };
  for (const blockedDecision of ["request_more_information", "reject", "reopen"] as const) {
    await assert.rejects(
      () => approveService.reviewCase({ ...approveInput, decision: blockedDecision }),
      /outside the approved staging scope/i,
    );
  }
  assert.equal(approveRepository.transitionCallCount, 0);

  for (const unsafeCase of [
    buildCaseRecord({ ...approveCase, paymentStatus: "pending" }),
    buildCaseRecord({ ...approveCase, paymentRecordId: null }),
    buildCaseRecord({ ...approveCase, caseStatus: "approved" }),
    buildCaseRecord({ ...approveCase, activationIdempotencyKey: "prior-activation" }),
    buildCaseRecord({ ...approveCase, auditMetadata: { ...approveCase.auditMetadata, fixture_run_id: "phase2b-approve-20261014-wrong" } }),
    buildCaseRecord({ ...approveCase, auditMetadata: { ...approveCase.auditMetadata, synthetic_approve_acceptance: false } }),
    buildCaseRecord({ ...approveCase, auditMetadata: { ...approveCase.auditMetadata, fixture_scope: "phase2b_admin_detail_smoke" } }),
  ]) {
    const unsafeRepository = new FakeSoloPlusRepository();
    unsafeRepository.seedCase(unsafeCase);
    const unsafeService = await createSoloPlusReviewerService({
      repository: unsafeRepository,
      resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
      env: approveEnv,
    });
    await assert.rejects(
      () => unsafeService.reviewCase(approveInput),
      /fixture marker does not match|fresh eligible synthetic staging fixture/i,
    );
    assert.equal(unsafeRepository.transitionCallCount, 0);
  }

  const priorDecisionRepository = new FakeSoloPlusRepository();
  priorDecisionRepository.seedCase(approveCase);
  priorDecisionRepository.events.set(approveCaseId, [{
    id: "99999999-9999-4999-8999-999999999999",
    caseId: approveCaseId,
    eventType: "case_rejected",
    previousState: {},
    newState: {},
    actorType: "admin",
    actorId: "admin-reviewer",
    requestIdempotencyKey: "prior-synthetic-review",
    reason: "Synthetic prior decision.",
    policyVersion: "solo-plus-policy-v1",
    createdAt: "2026-10-13T00:00:00.000Z",
  }]);
  const priorDecisionService = await createSoloPlusReviewerService({
    repository: priorDecisionRepository,
    resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
    env: approveEnv,
  });
  await assert.rejects(() => priorDecisionService.reviewCase(approveInput), /fresh eligible synthetic staging fixture/i);
  assert.equal(priorDecisionRepository.transitionCallCount, 0);

  approveRepository.requirements.set(approveCaseId, buildSatisfiedRequirements(approveCaseId).slice(0, 5));
  await assert.rejects(() => approveService.reviewCase(approveInput), /not eligible for approval/i);
  assert.equal(approveRepository.transitionCallCount, 0);
  approveRepository.requirements.set(approveCaseId, buildSatisfiedRequirements(approveCaseId));

  const staleApproveRepository = new FakeSoloPlusRepository();
  staleApproveRepository.seedCase(approveCase);
  staleApproveRepository.requirements.set(approveCaseId, buildSatisfiedRequirements(approveCaseId));
  const staleApproveService = await createSoloPlusReviewerService({
    repository: staleApproveRepository,
    resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
    env: approveEnv,
    generateId: () => "stale-approve-event",
  });
  await assert.rejects(
    () => staleApproveService.reviewCase({ ...approveInput, expectedRowVersion: 2 }),
    /version conflict|row version|changed since/i,
  );
  assert.equal(staleApproveRepository.transitionCallCount, 0);
  assert.equal(staleApproveRepository.cases.get(approveCaseId)?.caseStatus, "manual_review");

  const approved = await approveService.reviewCase(approveInput);
  assert.equal(approved.caseRecord.caseStatus, "approved");
  assert.equal(approved.caseRecord.rowVersion, 4);
  assert.equal(approved.caseRecord.paymentStatus, "paid");
  assert.equal(approved.caseRecord.activationIdempotencyKey, null);
  assert.equal(approved.event?.eventType, "case_approved");
  assert.equal(approveRepository.transitionCallCount, 1);
  assert.equal(approveRepository.lastTransitionInput?.expectedFixtureRunId, approveRunId);
  assert.equal(approveRepository.activationCallCount, 0);
  const approveReplay = await approveService.reviewCase(approveInput);
  assert.equal(approveReplay.outcome, "idempotent_replay");
  assert.equal(approveReplay.event?.eventType, "case_approved");
  assert.equal(approveRepository.transitionCallCount, 2);
  assert.equal(approveRepository.events.get(approveCaseId)?.length, 1);
  await assert.rejects(
    () => approveService.reviewCase({ ...approveInput, requestIdempotencyKey: "conflicting-approve-key" }),
    /fresh eligible synthetic staging fixture/i,
  );
  assert.equal(approveRepository.transitionCallCount, 2);

  // The route constructs the service without generateId. Keep the production
  // default covered through the real service/orchestration with an in-memory
  // repository and injected authority; no database or network is involved.
  const defaultIdCaseId = "44444444-4444-4444-8444-444444444444";
  const defaultIdRepository = new FakeSoloPlusRepository();
  defaultIdRepository.seedCase(buildCaseRecord({ id: defaultIdCaseId, rowVersion: 1 }));
  const { createSoloPlusReviewRouteHandler } = await import(
    new URL("../src/app/api/admin/solo-plus/review/route.ts", import.meta.url).href
  );
  const unexpectedErrors: unknown[] = [];
  const defaultIdHandler = createSoloPlusReviewRouteHandler({
    resolveReviewActionScope: () => ({
      caseId: defaultIdCaseId,
      decision: "request_more_information",
      runId: "phase2b-review-service-test",
    }),
    requireSuperAdminSession: async () => ({ ok: true, userId: "admin-reviewer" }),
    createReviewerService: () => createSoloPlusReviewerService({
      repository: defaultIdRepository,
      resolveAdminAuthority: async () => ({ ok: true, userId: "admin-reviewer" }),
      env: createEnv(defaultIdCaseId),
      // Intentionally omit generateId, just as the actual POST entry point does.
    }),
    onUnexpectedError: (error: unknown) => unexpectedErrors.push(error),
  });
  const defaultIdResponse = await defaultIdHandler(new Request(
    "http://localhost/api/admin/solo-plus/review",
    {
      method: "POST",
      body: JSON.stringify({
        caseId: defaultIdCaseId,
        expectedRowVersion: 1,
        requestIdempotencyKey: "default-id-synthetic-test",
        decision: "request_more_information",
        reason: "Please clarify the synthetic fixture response.",
      }),
    },
  ));
  assert.equal(defaultIdResponse.status, 200);
  const defaultIdPayload = await defaultIdResponse.json();
  assert.equal(defaultIdPayload.kind, "updated");
  assert.equal(defaultIdPayload.case.caseStatus, "verification_pending");
  assert.equal(defaultIdPayload.case.rowVersion, 2);
  assert.deepEqual(unexpectedErrors, []);
  assert.equal(defaultIdRepository.transitionCallCount, 1);
  const defaultIdEvents = await defaultIdRepository.listSafeEvents(defaultIdCaseId);
  assert.equal(defaultIdEvents.length, 1);
  assert.match(defaultIdEvents[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(defaultIdEvents[0].actorId, "admin-reviewer");
  assert.equal(defaultIdEvents[0].reason, "Please clarify the synthetic fixture response.");
  assert.equal(defaultIdEvents[0].previousState.rowVersion, 1);

  console.log("solo-plus-review-service.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
