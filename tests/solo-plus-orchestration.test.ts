import assert from "node:assert/strict";
import {
  assertSoloPlusCaseCreationAccess,
  canCreateInternalSoloPlusTestCaseIntent,
  canCreatePublicSoloPlusCaseIntent,
  createSoloPlusOrchestration,
  SoloPlusOrchestrationError,
  type CreateSoloPlusOnboardingCaseInput,
  type CreateSoloPlusUpgradeCaseInput,
} from "../src/lib/solo-plus/orchestration";
import {
  SOLO_PLUS_ACTIVE_CASE_STATUSES,
  type SoloPlusCaseCreateAtomicInput,
  type SoloPlusCaseCreateAtomicResult,
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
import { SOLO_PLUS_REQUIRED_REQUIREMENTS } from "../src/lib/solo-plus/state";

function expectCode(fn: () => unknown | Promise<unknown>, code: string) {
  return assert.rejects(async () => {
    await fn();
  }, (error: unknown) => {
    assert.ok(error instanceof SoloPlusOrchestrationError);
    assert.equal(error.code, code);
    return true;
  });
}

class FakeSoloPlusRepository implements SoloPlusCaseRepository {
  private readonly cases = new Map<string, SoloPlusCaseRecord>();
  private readonly requirements = new Map<string, SoloPlusCaseRequirementRecord[]>();
  private readonly events = new Map<string, SoloPlusCaseEventRecord[]>();

  forceNextCreateResult: SoloPlusCaseCreateAtomicResult | null = null;

  async findCaseById(caseId: string): Promise<SoloPlusCaseRecord | null> {
    return this.cloneCase(this.cases.get(caseId) || null);
  }

  async findCaseByIdempotencyKey(idempotencyKey: string): Promise<SoloPlusCaseRecord | null> {
    for (const record of this.cases.values()) {
      if (record.idempotencyKey === idempotencyKey) {
        return this.cloneCase(record);
      }
    }
    return null;
  }

  async findActiveCaseByMerchantId(merchantId: string): Promise<SoloPlusCaseRecord | null> {
    for (const record of this.cases.values()) {
      if (
        record.merchantId === merchantId &&
        SOLO_PLUS_ACTIVE_CASE_STATUSES.includes(record.caseStatus)
      ) {
        return this.cloneCase(record);
      }
    }
    return null;
  }

  async findActiveCaseByOnboardingSessionId(
    onboardingSessionId: string,
  ): Promise<SoloPlusCaseRecord | null> {
    for (const record of this.cases.values()) {
      if (
        record.onboardingSessionId === onboardingSessionId &&
        SOLO_PLUS_ACTIVE_CASE_STATUSES.includes(record.caseStatus)
      ) {
        return this.cloneCase(record);
      }
    }
    return null;
  }

  async listRequirements(caseId: string): Promise<readonly SoloPlusCaseRequirementRecord[]> {
    return this.cloneRequirements(this.requirements.get(caseId) || []);
  }

  async listSafeEvents(caseId: string): Promise<readonly SoloPlusCaseEventRecord[]> {
    return this.cloneEvents(this.events.get(caseId) || []);
  }

  async createCaseWithRequirementsAndEvent(
    input: SoloPlusCaseCreateAtomicInput,
  ): Promise<SoloPlusCaseCreateAtomicResult> {
    if (this.forceNextCreateResult) {
      const result = this.forceNextCreateResult;
      this.forceNextCreateResult = null;
      return result;
    }

    const existingByIdempotency = await this.findCaseByIdempotencyKey(input.caseRecord.idempotencyKey);
    if (existingByIdempotency) {
      return { kind: "idempotency_conflict", existingCase: existingByIdempotency };
    }

    if (input.caseRecord.merchantId) {
      const activeByMerchant = await this.findActiveCaseByMerchantId(input.caseRecord.merchantId);
      if (activeByMerchant) {
        return { kind: "active_case_conflict", existingCase: activeByMerchant };
      }
    }

    if (input.caseRecord.onboardingSessionId) {
      const activeBySession = await this.findActiveCaseByOnboardingSessionId(
        input.caseRecord.onboardingSessionId,
      );
      if (activeBySession) {
        return { kind: "active_case_conflict", existingCase: activeBySession };
      }
    }

    this.cases.set(input.caseRecord.id, this.cloneCase(input.caseRecord)!);
    this.requirements.set(input.caseRecord.id, this.cloneRequirements(input.requirements));
    this.events.set(input.caseRecord.id, this.cloneEvents([input.event]));

    return {
      kind: "created",
      caseRecord: this.cloneCase(input.caseRecord)!,
      requirements: this.cloneRequirements(input.requirements),
      event: this.cloneEvent(input.event),
    };
  }

  async attachMerchantToOnboardingCase(
    input: SoloPlusAttachMerchantAtomicParams,
  ): Promise<SoloPlusAttachMerchantAtomicResult> {
    const current = this.cases.get(input.caseId);
    if (!current) {
      return { kind: "not_found" };
    }

    if (current.rowVersion !== input.expectedRowVersion) {
      return { kind: "version_conflict", currentCase: this.cloneCase(current)! };
    }

    if (current.flowOrigin !== "onboarding") {
      return { kind: "ownership_conflict", currentCase: this.cloneCase(current)! };
    }

    if (current.onboardingSessionId !== input.onboardingSessionId) {
      return { kind: "ownership_conflict", currentCase: this.cloneCase(current)! };
    }

    if (!SOLO_PLUS_ACTIVE_CASE_STATUSES.includes(current.caseStatus)) {
      return { kind: "state_conflict", currentCase: this.cloneCase(current)! };
    }

    if (current.merchantId === input.merchantId) {
      return { kind: "idempotent_replay", caseRecord: this.cloneCase(current)!, event: null };
    }

    if (current.merchantId && current.merchantId !== input.merchantId) {
      return { kind: "ownership_conflict", currentCase: this.cloneCase(current)! };
    }

    const updated: SoloPlusCaseRecord = {
      ...current,
      merchantId: input.merchantId,
      rowVersion: current.rowVersion + 1,
      updatedAt: input.event.createdAt,
    };
    this.cases.set(updated.id, this.cloneCase(updated)!);
    this.events.set(updated.id, [...(this.events.get(updated.id) || []), this.cloneEvent(input.event)]);

    return { kind: "updated", caseRecord: this.cloneCase(updated)!, event: this.cloneEvent(input.event) };
  }

  async transitionCaseStatus(
    input: SoloPlusCaseTransitionAtomicParams,
  ): Promise<SoloPlusCaseTransitionAtomicResult> {
    const current = this.cases.get(input.caseId);
    if (!current) {
      return { kind: "not_found" };
    }

    if (current.rowVersion !== input.expectedRowVersion) {
      return { kind: "version_conflict", currentCase: this.cloneCase(current)! };
    }

    if (current.caseStatus !== input.expectedCurrentStatus) {
      if (current.caseStatus === input.targetStatus) {
        return { kind: "idempotent_replay", caseRecord: this.cloneCase(current)!, event: null };
      }
      return { kind: "state_conflict", currentCase: this.cloneCase(current)! };
    }

    const updated: SoloPlusCaseRecord = {
      ...current,
      ...input.patch,
      caseStatus: input.targetStatus,
      rowVersion: current.rowVersion + 1,
      updatedAt: input.event.createdAt,
    };
    this.cases.set(updated.id, this.cloneCase(updated)!);
    this.events.set(updated.id, [...(this.events.get(updated.id) || []), this.cloneEvent(input.event)]);

    return { kind: "updated", caseRecord: this.cloneCase(updated)!, event: this.cloneEvent(input.event) };
  }

  seedCase(record: SoloPlusCaseRecord, requirements?: readonly SoloPlusCaseRequirementRecord[]) {
    this.cases.set(record.id, this.cloneCase(record)!);
    this.requirements.set(record.id, this.cloneRequirements(requirements || []));
    this.events.set(record.id, []);
  }

  private cloneCase(record: SoloPlusCaseRecord | null): SoloPlusCaseRecord | null {
    if (!record) {
      return null;
    }
    return JSON.parse(JSON.stringify(record)) as SoloPlusCaseRecord;
  }

  private cloneRequirements(
    records: readonly SoloPlusCaseRequirementRecord[],
  ): SoloPlusCaseRequirementRecord[] {
    return JSON.parse(JSON.stringify(records)) as SoloPlusCaseRequirementRecord[];
  }

  private cloneEvents(records: readonly SoloPlusCaseEventRecord[]): SoloPlusCaseEventRecord[] {
    return JSON.parse(JSON.stringify(records)) as SoloPlusCaseEventRecord[];
  }

  private cloneEvent(record: SoloPlusCaseEventRecord): SoloPlusCaseEventRecord {
    return JSON.parse(JSON.stringify(record)) as SoloPlusCaseEventRecord;
  }
}

function createIdGenerator(prefix = "id") {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

function buildService(repository: FakeSoloPlusRepository) {
  return createSoloPlusOrchestration({
    repository,
    now: () => new Date("2026-07-04T10:00:00.000Z"),
    generateId: createIdGenerator("solo-plus"),
  });
}

function buildFeatureFlags(overrides: Partial<{ soloPlusEnabled: boolean; soloPlusKycEnabled: boolean }> = {}) {
  return {
    soloPlusEnabled: true,
    soloPlusKycEnabled: true,
    ...overrides,
  };
}

function buildPublicContext() {
  return {
    mode: "public" as const,
    authenticatedUserId: "user-1",
  };
}

function buildInternalAdminContext() {
  return {
    mode: "internal_test" as const,
    authenticatedAdminId: "admin-1",
    isAuthorizedAdmin: true,
    isSandboxMerchant: false,
  };
}

function buildInternalSandboxContext() {
  return {
    mode: "internal_test" as const,
    sandboxMerchantId: "merchant-sandbox",
    isAuthorizedAdmin: false,
    isSandboxMerchant: true,
  };
}

function buildRequirementsSnapshot(): SoloPlusSafeJsonObject {
  return {
    requirements: {
      policy: "controlled_launch",
      version: "solo-plus-v1",
    },
  };
}

function buildOnboardingInput(
  overrides: Partial<CreateSoloPlusOnboardingCaseInput> = {},
): CreateSoloPlusOnboardingCaseInput {
  return {
    onboardingSessionId: "session-1",
    idempotencyKey: "idem-onboarding-1",
    expectedAmount: 13000,
    paymentCurrency: "NGN",
    requirementsPolicyVersion: "solo-plus-v1",
    requirementsSnapshot: buildRequirementsSnapshot(),
    accessContext: buildPublicContext(),
    featureFlags: buildFeatureFlags(),
    ...overrides,
  };
}

function buildUpgradeInput(
  overrides: Partial<CreateSoloPlusUpgradeCaseInput> = {},
): CreateSoloPlusUpgradeCaseInput {
  return {
    merchantId: "merchant-1",
    currentPlan: "solo_lite",
    idempotencyKey: "idem-upgrade-1",
    expectedAmount: 13000,
    paymentCurrency: "NGN",
    requirementsPolicyVersion: "solo-plus-v1",
    requirementsSnapshot: buildRequirementsSnapshot(),
    accessContext: buildPublicContext(),
    featureFlags: buildFeatureFlags(),
    ...overrides,
  };
}

function createHistoricalCase(
  overrides: Partial<SoloPlusCaseRecord>,
): SoloPlusCaseRecord {
  return {
    id: overrides.id || "case-historical",
    merchantId: overrides.merchantId ?? "merchant-historical",
    onboardingSessionId: overrides.onboardingSessionId ?? null,
    flowOrigin: overrides.flowOrigin ?? "upgrade",
    sourcePlan: overrides.sourcePlan ?? "solo_lite",
    targetPlan: "solo_plus",
    caseStatus: overrides.caseStatus ?? "approved",
    paymentStatus: overrides.paymentStatus ?? "paid",
    refundStatus: overrides.refundStatus ?? "none",
    paymentRecordId: null,
    paymentProvider: null,
    paymentReference: null,
    expectedAmount: 13000,
    paymentCurrency: "NGN",
    requirementsPolicyVersion: "solo-plus-v1",
    requirementsSnapshot: buildRequirementsSnapshot(),
    activePlanSnapshot: overrides.activePlanSnapshot ?? "solo_lite",
    rejectionReason: overrides.rejectionReason ?? null,
    approvedAt: overrides.approvedAt ?? null,
    rejectedAt: overrides.rejectedAt ?? null,
    reopenedAt: null,
    idempotencyKey: overrides.idempotencyKey || `idem-${overrides.id || "historical"}`,
    activationIdempotencyKey: null,
    refundIdempotencyKey: null,
    rowVersion: overrides.rowVersion ?? 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

async function run() {
  assert.equal(
    canCreatePublicSoloPlusCaseIntent(buildFeatureFlags(), buildPublicContext()),
    true,
  );
  assert.equal(
    canCreatePublicSoloPlusCaseIntent(
      buildFeatureFlags({ soloPlusEnabled: false }),
      buildPublicContext(),
    ),
    false,
  );
  assert.equal(
    canCreatePublicSoloPlusCaseIntent(
      buildFeatureFlags({ soloPlusKycEnabled: false }),
      buildPublicContext(),
    ),
    false,
  );

  await expectCode(
    async () =>
      assertSoloPlusCaseCreationAccess({
        featureFlags: buildFeatureFlags({ soloPlusEnabled: false }),
        accessContext: buildPublicContext(),
      }),
    "SOLO_PLUS_FEATURE_DISABLED",
  );

  assert.equal(
    canCreateInternalSoloPlusTestCaseIntent(
      buildFeatureFlags({ soloPlusEnabled: false, soloPlusKycEnabled: true }),
      buildInternalAdminContext(),
    ),
    true,
  );
  assert.equal(
    canCreateInternalSoloPlusTestCaseIntent(
      buildFeatureFlags({ soloPlusEnabled: false, soloPlusKycEnabled: true }),
      buildInternalSandboxContext(),
    ),
    true,
  );
  assert.equal(
    canCreateInternalSoloPlusTestCaseIntent(
      buildFeatureFlags({ soloPlusKycEnabled: false }),
      buildInternalAdminContext(),
    ),
    false,
  );

  const invalidInternalContext = {
    mode: "internal_test" as const,
    isAuthorizedAdmin: false,
    isSandboxMerchant: false,
  };

  const repoA = new FakeSoloPlusRepository();
  const serviceA = buildService(repoA);

  await expectCode(
    async () =>
      serviceA.createSoloPlusOnboardingCase(
        buildOnboardingInput({
          featureFlags: buildFeatureFlags({ soloPlusKycEnabled: false }),
          accessContext: buildInternalAdminContext(),
        }),
      ),
    "SOLO_PLUS_FEATURE_DISABLED",
  );

  await expectCode(
    async () =>
      serviceA.createSoloPlusOnboardingCase(
        buildOnboardingInput({
          accessContext: invalidInternalContext as CreateSoloPlusOnboardingCaseInput["accessContext"],
        }),
      ),
    "SOLO_PLUS_INVALID_CREATION_INPUT",
  );

  const onboardingInput = buildOnboardingInput();
  const onboardingSnapshotBefore = JSON.stringify(onboardingInput.requirementsSnapshot);
  const onboardingResult = await serviceA.createSoloPlusOnboardingCase(onboardingInput);
  assert.equal(onboardingResult.outcome, "created");
  assert.equal(onboardingResult.caseRecord.flowOrigin, "onboarding");
  assert.equal(onboardingResult.caseRecord.merchantId, null);
  assert.equal(onboardingResult.caseRecord.onboardingSessionId, "session-1");
  assert.equal(onboardingResult.caseRecord.sourcePlan, null);
  assert.equal(onboardingResult.caseRecord.activePlanSnapshot, null);
  assert.equal(onboardingResult.caseRecord.caseStatus, "draft");
  assert.equal(onboardingResult.caseRecord.paymentStatus, "pending");
  assert.equal(onboardingResult.caseRecord.refundStatus, "none");
  assert.equal(onboardingResult.createdEvent?.eventType, "case_created");
  assert.equal(onboardingResult.createdEvent?.actorType, "merchant");
  assert.equal(JSON.stringify(onboardingInput.requirementsSnapshot), onboardingSnapshotBefore);
  assert.equal(onboardingResult.requirements.length, 6);
  assert.deepEqual(
    onboardingResult.requirements.map((entry) => entry.requirementCode).sort(),
    [...SOLO_PLUS_REQUIRED_REQUIREMENTS].sort(),
  );
  assert.ok(onboardingResult.requirements.every((entry) => entry.requirementState === "not_started"));
  assert.ok(onboardingResult.requirements.every((entry) => entry.completedAt === null));
  assert.ok(onboardingResult.requirements.every((entry) => entry.reviewedByAdminId === null));
  assert.ok(onboardingResult.requirements.every((entry) => entry.requirementCode !== ("admin_review" as never)));

  const onboardingReplay = await serviceA.createSoloPlusOnboardingCase(buildOnboardingInput());
  assert.equal(onboardingReplay.outcome, "idempotent_replay");
  const onboardingEvents = await repoA.listSafeEvents(onboardingResult.caseRecord.id);
  assert.equal(onboardingEvents.length, 1);

  await expectCode(
    async () =>
      serviceA.createSoloPlusOnboardingCase(
        buildOnboardingInput({ expectedAmount: 14000 }),
      ),
    "SOLO_PLUS_IDEMPOTENCY_CONFLICT",
  );

  const upgradeRepo = new FakeSoloPlusRepository();
  const upgradeService = buildService(upgradeRepo);
  const upgradeInput = buildUpgradeInput();
  const upgradeResult = await upgradeService.createSoloPlusUpgradeCase(upgradeInput);
  assert.equal(upgradeResult.outcome, "created");
  assert.equal(upgradeResult.caseRecord.flowOrigin, "upgrade");
  assert.equal(upgradeResult.caseRecord.merchantId, "merchant-1");
  assert.equal(upgradeResult.caseRecord.onboardingSessionId, null);
  assert.equal(upgradeResult.caseRecord.sourcePlan, "solo_lite");
  assert.equal(upgradeResult.caseRecord.activePlanSnapshot, "solo_lite");

  await expectCode(
    async () =>
      upgradeService.createSoloPlusUpgradeCase(
        buildUpgradeInput({ currentPlan: "starter" as "solo_lite" }),
      ),
    "SOLO_PLUS_INVALID_CREATION_INPUT",
  );

  await expectCode(
    async () =>
      upgradeService.createSoloPlusUpgradeCase(
        buildUpgradeInput({
          requirementsSnapshot: {
            accountNumber: "1234567890",
          } as never,
        }),
      ),
    "SOLO_PLUS_UNSAFE_METADATA",
  );

  const activeConflictRepo = new FakeSoloPlusRepository();
  const activeConflictService = buildService(activeConflictRepo);
  await activeConflictService.createSoloPlusUpgradeCase(buildUpgradeInput());
  await expectCode(
    async () =>
      activeConflictService.createSoloPlusUpgradeCase(
        buildUpgradeInput({
          idempotencyKey: "idem-upgrade-2",
          expectedAmount: 14000,
        }),
      ),
    "SOLO_PLUS_ACTIVE_CASE_CONFLICT",
  );

  const sameIntentDifferentKey = await activeConflictService.createSoloPlusUpgradeCase(
    buildUpgradeInput({ idempotencyKey: "idem-upgrade-same-intent" }),
  );
  assert.equal(sameIntentDifferentKey.outcome, "existing_active_case");
  const sameIntentRequirements = await activeConflictRepo.listRequirements(
    sameIntentDifferentKey.caseRecord.id,
  );
  assert.equal(sameIntentRequirements.length, 6);

  const sessionConflictRepo = new FakeSoloPlusRepository();
  const sessionConflictService = buildService(sessionConflictRepo);
  await sessionConflictService.createSoloPlusOnboardingCase(buildOnboardingInput());
  await expectCode(
    async () =>
      sessionConflictService.createSoloPlusOnboardingCase(
        buildOnboardingInput({
          idempotencyKey: "idem-onboarding-2",
          expectedAmount: 14000,
        }),
      ),
    "SOLO_PLUS_ACTIVE_CASE_CONFLICT",
  );

  const historicalRepo = new FakeSoloPlusRepository();
  historicalRepo.seedCase(
    createHistoricalCase({
      id: "approved-case",
      merchantId: "merchant-1",
      caseStatus: "approved",
      paymentStatus: "paid",
      refundStatus: "none",
      approvedAt: "2026-07-01T00:00:00.000Z",
    }),
  );
  const historicalService = buildService(historicalRepo);
  const historicalAllowed = await historicalService.createSoloPlusUpgradeCase(buildUpgradeInput());
  assert.equal(historicalAllowed.outcome, "created");

  const rejectedHistoricalRepo = new FakeSoloPlusRepository();
  rejectedHistoricalRepo.seedCase(
    createHistoricalCase({
      id: "rejected-case",
      merchantId: "merchant-2",
      caseStatus: "rejected",
      paymentStatus: "paid",
      refundStatus: "review_required",
      rejectedAt: "2026-07-01T00:00:00.000Z",
      rejectionReason: "manual review",
      idempotencyKey: "idem-rejected",
    }),
  );
  const rejectedHistoricalService = buildService(rejectedHistoricalRepo);
  const rejectedAllowed = await rejectedHistoricalService.createSoloPlusUpgradeCase(
    buildUpgradeInput({
      merchantId: "merchant-2",
      idempotencyKey: "idem-upgrade-after-rejected",
    }),
  );
  assert.equal(rejectedAllowed.outcome, "created");

  const cancelledHistoricalRepo = new FakeSoloPlusRepository();
  cancelledHistoricalRepo.seedCase(
    createHistoricalCase({
      id: "cancelled-case",
      merchantId: "merchant-3",
      caseStatus: "cancelled",
      paymentStatus: "paid",
      refundStatus: "review_required",
      idempotencyKey: "idem-cancelled",
    }),
  );
  const cancelledHistoricalService = buildService(cancelledHistoricalRepo);
  const cancelledAllowed = await cancelledHistoricalService.createSoloPlusUpgradeCase(
    buildUpgradeInput({
      merchantId: "merchant-3",
      idempotencyKey: "idem-upgrade-after-cancelled",
    }),
  );
  assert.equal(cancelledAllowed.outcome, "created");

  const attachRepo = new FakeSoloPlusRepository();
  const attachService = buildService(attachRepo);
  const attachCreated = await attachService.createSoloPlusOnboardingCase(buildOnboardingInput());
  const attachResult = await attachService.attachMerchantToSoloPlusOnboardingCase({
    caseId: attachCreated.caseRecord.id,
    onboardingSessionId: "session-1",
    merchantId: "merchant-attached",
    expectedRowVersion: 0,
    requestIdempotencyKey: "attach-1",
    accessContext: buildPublicContext(),
  });
  assert.equal(attachResult.outcome, "updated");
  assert.equal(attachResult.caseRecord.merchantId, "merchant-attached");

  const attachReplay = await attachService.attachMerchantToSoloPlusOnboardingCase({
    caseId: attachCreated.caseRecord.id,
    onboardingSessionId: "session-1",
    merchantId: "merchant-attached",
    expectedRowVersion: 1,
    requestIdempotencyKey: "attach-2",
    accessContext: buildPublicContext(),
  });
  assert.equal(attachReplay.outcome, "idempotent_replay");

  await expectCode(
    async () =>
      attachService.attachMerchantToSoloPlusOnboardingCase({
        caseId: attachCreated.caseRecord.id,
        onboardingSessionId: "session-1",
        merchantId: "merchant-other",
        expectedRowVersion: 1,
        requestIdempotencyKey: "attach-3",
        accessContext: buildPublicContext(),
      }),
    "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT",
  );

  const attachUpgradeRepo = new FakeSoloPlusRepository();
  const attachUpgradeService = buildService(attachUpgradeRepo);
  const attachUpgradeCase = await attachUpgradeService.createSoloPlusUpgradeCase(buildUpgradeInput());
  await expectCode(
    async () =>
      attachUpgradeService.attachMerchantToSoloPlusOnboardingCase({
        caseId: attachUpgradeCase.caseRecord.id,
        onboardingSessionId: "session-upgrade",
        merchantId: "merchant-upgrade",
        expectedRowVersion: 0,
        requestIdempotencyKey: "attach-upgrade",
        accessContext: buildPublicContext(),
      }),
    "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT",
  );

  const staleAttachRepo = new FakeSoloPlusRepository();
  const staleAttachService = buildService(staleAttachRepo);
  const staleAttachCase = await staleAttachService.createSoloPlusOnboardingCase(
    buildOnboardingInput({
      onboardingSessionId: "session-stale-attach",
      idempotencyKey: "idem-stale-attach",
    }),
  );
  await expectCode(
    async () =>
      staleAttachService.attachMerchantToSoloPlusOnboardingCase({
        caseId: staleAttachCase.caseRecord.id,
        onboardingSessionId: "session-stale-attach",
        merchantId: "merchant-stale",
        expectedRowVersion: 1,
        requestIdempotencyKey: "attach-stale",
        accessContext: buildPublicContext(),
      }),
    "SOLO_PLUS_CASE_VERSION_CONFLICT",
  );

  const transitionRepo = new FakeSoloPlusRepository();
  const transitionService = buildService(transitionRepo);
  const transitionCreated = await transitionService.createSoloPlusUpgradeCase(
    buildUpgradeInput({ merchantId: "merchant-transition" }),
  );
  const transitionResult = await transitionService.markSoloPlusCaseAwaitingPayment({
    caseId: transitionCreated.caseRecord.id,
    expectedRowVersion: 0,
    requestIdempotencyKey: "awaiting-1",
    accessContext: buildPublicContext(),
  });
  assert.equal(transitionResult.outcome, "updated");
  assert.equal(transitionResult.caseRecord.caseStatus, "awaiting_payment");
  assert.equal(transitionResult.caseRecord.paymentStatus, "pending");
  assert.equal(transitionResult.caseRecord.paymentProvider, null);
  assert.equal(transitionResult.caseRecord.paymentReference, null);

  const transitionReplay = await transitionService.markSoloPlusCaseAwaitingPayment({
    caseId: transitionCreated.caseRecord.id,
    expectedRowVersion: 1,
    requestIdempotencyKey: "awaiting-2",
    accessContext: buildPublicContext(),
  });
  assert.equal(transitionReplay.outcome, "idempotent_replay");

  const staleTransitionRepo = new FakeSoloPlusRepository();
  const staleTransitionService = buildService(staleTransitionRepo);
  const staleTransitionCase = await staleTransitionService.createSoloPlusUpgradeCase(
    buildUpgradeInput({
      merchantId: "merchant-transition-stale",
      idempotencyKey: "idem-transition-stale",
    }),
  );
  await expectCode(
    async () =>
      staleTransitionService.markSoloPlusCaseAwaitingPayment({
        caseId: staleTransitionCase.caseRecord.id,
        expectedRowVersion: 1,
        requestIdempotencyKey: "awaiting-stale",
        accessContext: buildPublicContext(),
      }),
    "SOLO_PLUS_CASE_VERSION_CONFLICT",
  );

  const nonDraftRepo = new FakeSoloPlusRepository();
  const nonDraftService = buildService(nonDraftRepo);
  nonDraftRepo.seedCase(
    createHistoricalCase({
      id: "verification-pending-case",
      merchantId: "merchant-non-draft",
      caseStatus: "verification_pending",
      paymentStatus: "pending",
      refundStatus: "none",
      approvedAt: null,
      sourcePlan: "solo_lite",
      activePlanSnapshot: "solo_lite",
      idempotencyKey: "idem-verification-pending",
    }),
  );
  await expectCode(
    async () =>
      nonDraftService.markSoloPlusCaseAwaitingPayment({
        caseId: "verification-pending-case",
        expectedRowVersion: 0,
        requestIdempotencyKey: "awaiting-non-draft-2",
        accessContext: buildPublicContext(),
      }),
    "SOLO_PLUS_CASE_STATE_CONFLICT",
  );

  const repoConflict = new FakeSoloPlusRepository();
  const conflictService = buildService(repoConflict);
  repoConflict.forceNextCreateResult = {
    kind: "active_case_conflict",
    existingCase: createHistoricalCase({
      id: "repo-conflict",
      caseStatus: "draft",
      merchantId: "merchant-conflict",
      idempotencyKey: "repo-conflict-idem",
    }),
  };
  await expectCode(
    async () =>
      conflictService.createSoloPlusUpgradeCase(
        buildUpgradeInput({
          merchantId: "merchant-conflict",
          idempotencyKey: "repo-conflict-request",
        }),
      ),
    "SOLO_PLUS_ACTIVE_CASE_CONFLICT",
  );

  const repoAtomicUnavailable = new FakeSoloPlusRepository();
  const atomicUnavailableService = buildService(repoAtomicUnavailable);
  repoAtomicUnavailable.forceNextCreateResult = {
    kind: "atomic_persistence_unavailable",
    message: "rpc missing",
  };
  await expectCode(
    async () =>
      atomicUnavailableService.createSoloPlusOnboardingCase(
        buildOnboardingInput({
          onboardingSessionId: "session-atomic",
          idempotencyKey: "idem-atomic",
        }),
      ),
    "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
  );

  await expectCode(
    async () =>
      serviceA.createSoloPlusOnboardingCase(
        buildOnboardingInput({
          expectedAmount: Number.NaN,
        }),
      ),
    "SOLO_PLUS_INVALID_CREATION_INPUT",
  );

  await expectCode(
    async () =>
      serviceA.createSoloPlusOnboardingCase(
        buildOnboardingInput({
          paymentCurrency: "USD" as "NGN",
        }),
      ),
    "SOLO_PLUS_INVALID_CREATION_INPUT",
  );

  await expectCode(
    async () =>
      serviceA.createSoloPlusOnboardingCase(
        buildOnboardingInput({
          requirementsSnapshot: {
            nested: {
              provider_payload: "unsafe",
            },
          } as never,
        }),
      ),
    "SOLO_PLUS_UNSAFE_METADATA",
  );

  const circularSnapshot = { safe: true } as Record<string, unknown>;
  circularSnapshot.self = circularSnapshot;
  await expectCode(
    async () =>
      serviceA.createSoloPlusOnboardingCase(
        buildOnboardingInput({
          onboardingSessionId: "session-circular",
          idempotencyKey: "idem-circular",
          requirementsSnapshot: circularSnapshot as never,
        }),
      ),
    "SOLO_PLUS_UNSAFE_METADATA",
  );

  const errorMessage = await assert.rejects(
    async () =>
      serviceA.createSoloPlusOnboardingCase(
        buildOnboardingInput({
          onboardingSessionId: "session-sensitive",
          idempotencyKey: "idem-sensitive",
          requirementsSnapshot: {
            bvn: "12345678901",
          } as never,
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusOrchestrationError);
      assert.equal(error.code, "SOLO_PLUS_UNSAFE_METADATA");
      assert.equal(error.message.includes("12345678901"), false);
      return true;
    },
  );
  assert.equal(errorMessage, undefined);

  assert.equal(typeof (serviceA as Record<string, unknown>).approveSoloPlusCase, "undefined");
  assert.equal(typeof (serviceA as Record<string, unknown>).rejectSoloPlusCase, "undefined");
  assert.equal(typeof (serviceA as Record<string, unknown>).activateSoloPlusCapabilities, "undefined");

  console.log("solo-plus-orchestration.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
