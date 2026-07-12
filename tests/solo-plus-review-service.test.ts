import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";

import type {
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
type AccessContextModule = typeof import("../src/lib/solo-plus/server/access-context");

let createSoloPlusReviewerService: ReviewServiceModule["createSoloPlusReviewerService"];
let SoloPlusReviewerServiceError: ReviewServiceModule["SoloPlusReviewerServiceError"];
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
    throw new Error("from() should not be called in reviewer auth tests");
  }
}

class FakeSoloPlusRepository implements SoloPlusCaseRepository {
  readonly cases = new Map<string, SoloPlusCaseRecord>();
  readonly events = new Map<string, SoloPlusCaseEventRecord[]>();

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

  async createCaseWithRequirementsAndEvent(): Promise<SoloPlusCaseCreateAtomicResult> {
    throw new Error("createCaseWithRequirementsAndEvent should not be called");
  }

  async attachMerchantToOnboardingCase(): Promise<SoloPlusAttachMerchantAtomicResult> {
    throw new Error("attachMerchantToOnboardingCase should not be called");
  }

  async transitionCaseStatus(
    input: SoloPlusCaseTransitionAtomicParams,
  ): Promise<SoloPlusCaseTransitionAtomicResult> {
    const current = this.cases.get(input.caseId);
    if (!current) {
      return { kind: "not_found" };
    }

    const existingEvent = (this.events.get(input.caseId) || []).find(
      (event) => event.requestIdempotencyKey === input.requestIdempotencyKey,
    );
    if (existingEvent) {
      if (existingEvent.eventType === input.event.eventType && current.caseStatus === input.targetStatus) {
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
    auditMetadata: {},
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function createEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  } as unknown as NodeJS.ProcessEnv;
}

async function loadModules() {
  ({
    createSoloPlusReviewerService,
    SoloPlusReviewerServiceError,
  } = await import(new URL("../src/lib/solo-plus/server/review-service.ts", import.meta.url).href));
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
      createSoloPlusReviewerService({
        authClient: unauthorizedAuthClient as never,
        repository: new FakeSoloPlusRepository(),
        env: createEnv(),
        generateId: () => "event-review-1",
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
    email_confirmed_at: "2026-07-09T00:00:00.000Z",
    app_metadata: { is_super_admin: false },
  };
  await assert.rejects(
    () =>
      createSoloPlusReviewerService({
        authClient: nonAdminAuthClient as never,
        repository: new FakeSoloPlusRepository(),
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

  const repository = new FakeSoloPlusRepository();
  repository.seedCase(buildCaseRecord({ id: "approve-case", rowVersion: 4 }));
  const service = await createSoloPlusReviewerService({
    authClient: adminAuthClient as never,
    repository,
    env: createEnv(),
    now: () => new Date("2026-07-10T00:00:00.000Z"),
    generateId: () => "event-review-3",
  });

  const approved = await service.reviewCase({
    caseId: "approve-case",
    expectedRowVersion: 4,
    requestIdempotencyKey: "approve-review-1",
    decision: "approve",
    reason: "Approved after manual review.",
  });
  assert.equal(approved.caseRecord.caseStatus, "approved");
  assert.equal(approved.caseRecord.approvedByAdminId, "admin-reviewer");
  assert.equal(approved.caseRecord.refundStatus, "none");
  assert.equal(approved.event?.actorType, "admin");
  assert.equal(approved.event?.actorId, "admin-reviewer");

  const approvedReplay = await service.reviewCase({
    caseId: "approve-case",
    expectedRowVersion: 4,
    requestIdempotencyKey: "approve-review-1",
    decision: "approve",
    reason: "Approved after manual review.",
  });
  assert.equal(approvedReplay.outcome, "idempotent_replay");

  repository.seedCase(
    buildCaseRecord({
      id: "reject-case",
      rowVersion: 1,
      paymentStatus: "paid",
      refundStatus: "none",
    }),
  );
  const rejected = await service.reviewCase({
    caseId: "reject-case",
    expectedRowVersion: 1,
    requestIdempotencyKey: "reject-review-1",
    decision: "reject",
    reason: "Rejected for mismatch.",
  });
  assert.equal(rejected.caseRecord.caseStatus, "rejected");
  assert.equal(rejected.caseRecord.refundStatus, "review_required");
  assert.equal(rejected.caseRecord.rejectedByAdminId, "admin-reviewer");

  await assert.rejects(
    () =>
      service.reviewCase({
        caseId: "reject-case",
        expectedRowVersion: 2,
        requestIdempotencyKey: "reject-review-1",
        decision: "approve",
        reason: "conflict",
      }),
    /SOLO_PLUS_IDEMPOTENCY_CONFLICT|idempotency/i,
  );

  console.log("solo-plus-review-service.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
