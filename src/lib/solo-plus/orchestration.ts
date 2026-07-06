import {
  canCreateInternalSoloPlusTestCase,
  canCreatePublicSoloPlusCase,
  isSoloPlusAccessContext,
  isSoloPlusFeatureFlags,
  resolveSoloPlusEventActor,
  type SoloPlusAccessContext,
  type SoloPlusFeatureFlags,
} from "./access";
import {
  normalizeSoloPlusAmount,
  type SoloPlusAmount,
  type SoloPlusCaseCreationIntent,
  type SoloPlusCaseCreationResult,
  type SoloPlusCaseEventRecord,
  type SoloPlusCaseMutationResult,
  type SoloPlusCaseRecord,
  type SoloPlusCaseRepository,
  type SoloPlusCaseRequirementRecord,
  type SoloPlusFlowOrigin,
  type SoloPlusSafeJsonObject,
  type SoloPlusSafeJsonValue,
  type SoloPlusSourcePlan,
  type SoloPlusTargetPlan,
} from "./repository";
import {
  SOLO_PLUS_REQUIRED_REQUIREMENTS,
  assertSoloPlusCaseTransition,
  isTerminalSoloPlusCaseStatus,
} from "./state";

export type SoloPlusOrchestrationErrorCode =
  | "SOLO_PLUS_ACCESS_DENIED"
  | "SOLO_PLUS_FEATURE_DISABLED"
  | "SOLO_PLUS_INVALID_CREATION_INPUT"
  | "SOLO_PLUS_CASE_NOT_FOUND"
  | "SOLO_PLUS_ACTIVE_CASE_CONFLICT"
  | "SOLO_PLUS_IDEMPOTENCY_CONFLICT"
  | "SOLO_PLUS_CASE_VERSION_CONFLICT"
  | "SOLO_PLUS_CASE_STATE_CONFLICT"
  | "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT"
  | "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE"
  | "SOLO_PLUS_UNSAFE_METADATA";

export type SoloPlusOrchestrationIssue = {
  field: string;
  message: string;
};

export class SoloPlusOrchestrationError extends Error {
  readonly code: SoloPlusOrchestrationErrorCode;
  readonly issues: readonly SoloPlusOrchestrationIssue[];

  constructor(
    code: SoloPlusOrchestrationErrorCode,
    message: string,
    issues: readonly SoloPlusOrchestrationIssue[] = [],
  ) {
    super(message);
    this.name = "SoloPlusOrchestrationError";
    this.code = code;
    this.issues = issues;
  }
}

export type CreateSoloPlusOnboardingCaseInput = {
  onboardingSessionId: string;
  idempotencyKey: string;
  expectedAmount: SoloPlusAmount;
  paymentCurrency: "NGN";
  requirementsPolicyVersion: string;
  requirementsSnapshot: SoloPlusSafeJsonObject;
  accessContext: SoloPlusAccessContext;
  featureFlags: SoloPlusFeatureFlags;
};

export type CreateSoloPlusUpgradeCaseInput = {
  merchantId: string;
  currentPlan: "solo_lite";
  idempotencyKey: string;
  expectedAmount: SoloPlusAmount;
  paymentCurrency: "NGN";
  requirementsPolicyVersion: string;
  requirementsSnapshot: SoloPlusSafeJsonObject;
  accessContext: SoloPlusAccessContext;
  featureFlags: SoloPlusFeatureFlags;
};

export type AttachMerchantToSoloPlusOnboardingCaseInput = {
  caseId: string;
  onboardingSessionId: string;
  merchantId: string;
  expectedRowVersion: number;
  requestIdempotencyKey: string;
  accessContext: SoloPlusAccessContext;
};

export type MarkSoloPlusCaseAwaitingPaymentInput = {
  caseId: string;
  expectedRowVersion: number;
  requestIdempotencyKey: string;
  accessContext: SoloPlusAccessContext;
};

export type SoloPlusOrchestrationDependencies = {
  repository: SoloPlusCaseRepository;
  now?: () => Date;
  generateId?: () => string;
};

export type SoloPlusOrchestrationService = {
  createSoloPlusOnboardingCase(
    input: CreateSoloPlusOnboardingCaseInput,
  ): Promise<SoloPlusCaseCreationResult>;
  createSoloPlusUpgradeCase(
    input: CreateSoloPlusUpgradeCaseInput,
  ): Promise<SoloPlusCaseCreationResult>;
  attachMerchantToSoloPlusOnboardingCase(
    input: AttachMerchantToSoloPlusOnboardingCaseInput,
  ): Promise<SoloPlusCaseMutationResult>;
  markSoloPlusCaseAwaitingPayment(
    input: MarkSoloPlusCaseAwaitingPaymentInput,
  ): Promise<SoloPlusCaseMutationResult>;
};

const PROHIBITED_SNAPSHOT_KEYS = new Set([
  "bvn",
  "account_number",
  "accountnumber",
  "raw_document",
  "rawdocument",
  "selfie",
  "provider_payload",
  "providerpayload",
  "id_number",
  "idnumber",
]);

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function createIssuesError(
  code: SoloPlusOrchestrationErrorCode,
  message: string,
  field: string,
): SoloPlusOrchestrationError {
  return new SoloPlusOrchestrationError(code, message, [{ field, message }]);
}

function assertIdentifier(value: unknown, field: string): string {
  if (!hasNonEmptyString(value)) {
    throw createIssuesError(
      "SOLO_PLUS_INVALID_CREATION_INPUT",
      `${field} must be a non-empty string.`,
      field,
    );
  }

  return value.trim();
}

function assertCanonicalAmount(value: unknown): SoloPlusAmount {
  if (typeof value !== "string") {
    throw createIssuesError(
      "SOLO_PLUS_INVALID_CREATION_INPUT",
      "expectedAmount must be a decimal string compatible with numeric(18,2).",
      "expectedAmount",
    );
  }

  try {
    return normalizeSoloPlusAmount(value);
  } catch {
    throw createIssuesError(
      "SOLO_PLUS_INVALID_CREATION_INPUT",
      "expectedAmount must be a non-negative decimal string with up to two fractional digits and at most sixteen integer digits.",
      "expectedAmount",
    );
  }
}

function assertCurrency(value: unknown): "NGN" {
  if (value !== "NGN") {
    throw createIssuesError(
      "SOLO_PLUS_INVALID_CREATION_INPUT",
      "paymentCurrency must be NGN.",
      "paymentCurrency",
    );
  }

  return "NGN";
}

function cloneSafeJsonValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): SoloPlusSafeJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw createIssuesError(
        "SOLO_PLUS_UNSAFE_METADATA",
        "requirementsSnapshot contains a non-finite number.",
        path,
      );
    }
    return value as string | number | boolean | null;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      cloneSafeJsonValue(item, `${path}[${index}]`, seen),
    );
  }

  if (typeof value !== "object") {
    throw createIssuesError(
      "SOLO_PLUS_UNSAFE_METADATA",
      "requirementsSnapshot contains a non-JSON-safe value.",
      path,
    );
  }

  if (seen.has(value)) {
    throw createIssuesError(
      "SOLO_PLUS_UNSAFE_METADATA",
      "requirementsSnapshot contains circular data.",
      path,
    );
  }

  seen.add(value);

  const output: SoloPlusSafeJsonObject = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const normalizedKey = normalizeKey(rawKey);
    if (PROHIBITED_SNAPSHOT_KEYS.has(normalizedKey)) {
      throw createIssuesError(
        "SOLO_PLUS_UNSAFE_METADATA",
        "requirementsSnapshot contains a prohibited sensitive key.",
        `${path}.${rawKey}`,
      );
    }

    output[rawKey] = cloneSafeJsonValue(rawValue, `${path}.${rawKey}`, seen);
  }

  seen.delete(value);
  return output;
}

function cloneRequirementsSnapshot(value: unknown): SoloPlusSafeJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw createIssuesError(
      "SOLO_PLUS_INVALID_CREATION_INPUT",
      "requirementsSnapshot must be a JSON object.",
      "requirementsSnapshot",
    );
  }

  return cloneSafeJsonValue(value, "requirementsSnapshot", new WeakSet()) as SoloPlusSafeJsonObject;
}

function stableStringify(value: SoloPlusSafeJsonValue): string {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function buildIntentSignature(intent: SoloPlusCaseCreationIntent): string {
  return stableStringify({
    flowOrigin: intent.flowOrigin,
    merchantId: intent.merchantId,
    onboardingSessionId: intent.onboardingSessionId,
    sourcePlan: intent.sourcePlan,
    targetPlan: intent.targetPlan,
    expectedAmount: intent.expectedAmount,
    paymentCurrency: intent.paymentCurrency,
    requirementsPolicyVersion: intent.requirementsPolicyVersion,
    requirementsSnapshot: intent.requirementsSnapshot,
    activePlanSnapshot: intent.activePlanSnapshot,
  });
}

function buildIntentFromCase(caseRecord: SoloPlusCaseRecord): SoloPlusCaseCreationIntent {
  return {
    flowOrigin: caseRecord.flowOrigin,
    merchantId: caseRecord.merchantId,
    onboardingSessionId: caseRecord.onboardingSessionId,
    sourcePlan: caseRecord.sourcePlan,
    targetPlan: caseRecord.targetPlan,
    expectedAmount: caseRecord.expectedAmount,
    paymentCurrency: caseRecord.paymentCurrency,
    requirementsPolicyVersion: caseRecord.requirementsPolicyVersion,
    requirementsSnapshot: caseRecord.requirementsSnapshot,
    activePlanSnapshot: caseRecord.activePlanSnapshot,
  };
}

function sameIntent(
  left: SoloPlusCaseCreationIntent,
  right: SoloPlusCaseCreationIntent,
): boolean {
  return buildIntentSignature(left) === buildIntentSignature(right);
}

function buildRequirementRecords(
  caseId: string,
  nowIso: string,
  generateId: () => string,
): readonly SoloPlusCaseRequirementRecord[] {
  return SOLO_PLUS_REQUIRED_REQUIREMENTS.map((requirementCode) => ({
    id: generateId(),
    caseId,
    requirementCode,
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
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
}

function buildCreationEvent(params: {
  caseId: string;
  accessContext: SoloPlusAccessContext;
  nowIso: string;
  generateId: () => string;
  flowOrigin: SoloPlusFlowOrigin;
  targetPlan: SoloPlusTargetPlan;
  policyVersion: string;
}): SoloPlusCaseEventRecord {
  const actor = resolveSoloPlusEventActor(params.accessContext);
  return {
    id: params.generateId(),
    caseId: params.caseId,
    eventType: "case_created",
    previousState: {},
    newState: {
      flowOrigin: params.flowOrigin,
      targetPlan: params.targetPlan,
      caseStatus: "draft",
      paymentStatus: "pending",
      refundStatus: "none",
      accessMode: actor.accessMode,
    },
    actorType: actor.actorType,
    actorId: actor.actorId,
    requestIdempotencyKey: null,
    reason: "Solo Plus case created.",
    policyVersion: params.policyVersion,
    createdAt: params.nowIso,
  };
}

function buildMerchantAttachedEvent(params: {
  caseRecord: SoloPlusCaseRecord;
  merchantId: string;
  requestIdempotencyKey: string;
  nowIso: string;
  generateId: () => string;
  accessContext: SoloPlusAccessContext;
}): SoloPlusCaseEventRecord {
  const actor = resolveSoloPlusEventActor(params.accessContext);
  return {
    id: params.generateId(),
    caseId: params.caseRecord.id,
    eventType: "merchant_attached",
    previousState: {
      merchantId: params.caseRecord.merchantId,
      rowVersion: params.caseRecord.rowVersion,
    },
    newState: {
      merchantId: params.merchantId,
      rowVersion: params.caseRecord.rowVersion + 1,
    },
    actorType: actor.actorType,
    actorId: actor.actorId,
    requestIdempotencyKey: params.requestIdempotencyKey,
    reason: "Merchant attached to onboarding case.",
    policyVersion: params.caseRecord.requirementsPolicyVersion,
    createdAt: params.nowIso,
  };
}

function buildAwaitingPaymentEvent(params: {
  caseRecord: SoloPlusCaseRecord;
  requestIdempotencyKey: string;
  nowIso: string;
  generateId: () => string;
  accessContext: SoloPlusAccessContext;
}): SoloPlusCaseEventRecord {
  const actor = resolveSoloPlusEventActor(params.accessContext);
  return {
    id: params.generateId(),
    caseId: params.caseRecord.id,
    eventType: "case_marked_awaiting_payment",
    previousState: {
      caseStatus: params.caseRecord.caseStatus,
      paymentStatus: params.caseRecord.paymentStatus,
      paymentProvider: params.caseRecord.paymentProvider,
      paymentReference: params.caseRecord.paymentReference,
      rowVersion: params.caseRecord.rowVersion,
    },
    newState: {
      caseStatus: "awaiting_payment",
      paymentStatus: "pending",
      paymentProvider: null,
      paymentReference: null,
      rowVersion: params.caseRecord.rowVersion + 1,
    },
    actorType: actor.actorType,
    actorId: actor.actorId,
    requestIdempotencyKey: params.requestIdempotencyKey,
    reason: "Solo Plus case moved to awaiting payment.",
    policyVersion: params.caseRecord.requirementsPolicyVersion,
    createdAt: params.nowIso,
  };
}

function assertCaseCreationAccess(
  featureFlags: unknown,
  accessContext: unknown,
): SoloPlusAccessContext {
  if (!isSoloPlusFeatureFlags(featureFlags)) {
    throw createIssuesError(
      "SOLO_PLUS_INVALID_CREATION_INPUT",
      "featureFlags are malformed.",
      "featureFlags",
    );
  }

  if (!isSoloPlusAccessContext(accessContext)) {
    throw createIssuesError(
      "SOLO_PLUS_INVALID_CREATION_INPUT",
      "accessContext is malformed.",
      "accessContext",
    );
  }

  if (accessContext.mode === "public") {
    if (!canCreatePublicSoloPlusCase(featureFlags, accessContext)) {
      if (featureFlags.soloPlusEnabled !== true || featureFlags.soloPlusKycEnabled !== true) {
        throw new SoloPlusOrchestrationError(
          "SOLO_PLUS_FEATURE_DISABLED",
          "Solo Plus public availability is disabled.",
        );
      }

      throw new SoloPlusOrchestrationError(
        "SOLO_PLUS_ACCESS_DENIED",
        "Public Solo Plus case creation requires an authenticated user.",
      );
    }

    return accessContext;
  }

  if (!canCreateInternalSoloPlusTestCase(featureFlags, accessContext)) {
    if (featureFlags.soloPlusKycEnabled !== true) {
      throw new SoloPlusOrchestrationError(
        "SOLO_PLUS_FEATURE_DISABLED",
        "Solo Plus KYC testing is disabled.",
      );
    }

    throw new SoloPlusOrchestrationError(
      "SOLO_PLUS_ACCESS_DENIED",
      "Internal Solo Plus test creation requires an authorized admin or sandbox merchant.",
    );
  }

  return accessContext;
}

function mapCreateConflict(
  result:
    | Awaited<ReturnType<SoloPlusCaseRepository["createCaseWithRequirementsAndEvent"]>>
    | Awaited<ReturnType<SoloPlusCaseRepository["attachMerchantToOnboardingCase"]>>
    | Awaited<ReturnType<SoloPlusCaseRepository["transitionCaseStatus"]>>,
): never {
  if ("kind" in result && result.kind === "atomic_persistence_unavailable") {
    throw new SoloPlusOrchestrationError(
      "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
      result.message || "Atomic Solo Plus persistence is not available.",
    );
  }

  if ("kind" in result && result.kind === "active_case_conflict") {
    throw new SoloPlusOrchestrationError(
      "SOLO_PLUS_ACTIVE_CASE_CONFLICT",
      "An active Solo Plus case already exists for this anchor.",
    );
  }

  if ("kind" in result && result.kind === "existing_active_case") {
    throw new SoloPlusOrchestrationError(
      "SOLO_PLUS_ACTIVE_CASE_CONFLICT",
      "An equivalent active Solo Plus case already exists for this anchor.",
    );
  }

  if ("kind" in result && result.kind === "idempotency_conflict") {
    throw new SoloPlusOrchestrationError(
      "SOLO_PLUS_IDEMPOTENCY_CONFLICT",
      "The idempotency key is already bound to a different Solo Plus intent.",
    );
  }

  if ("kind" in result && result.kind === "not_found") {
    throw new SoloPlusOrchestrationError(
      "SOLO_PLUS_CASE_NOT_FOUND",
      "Solo Plus case not found.",
    );
  }

  if ("kind" in result && result.kind === "version_conflict") {
    throw new SoloPlusOrchestrationError(
      "SOLO_PLUS_CASE_VERSION_CONFLICT",
      "Solo Plus case version conflict.",
    );
  }

  if ("kind" in result && result.kind === "state_conflict") {
    throw new SoloPlusOrchestrationError(
      "SOLO_PLUS_CASE_STATE_CONFLICT",
      "Solo Plus case state conflict.",
    );
  }

  if ("kind" in result && result.kind === "ownership_conflict") {
    throw new SoloPlusOrchestrationError(
      "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT",
      "Solo Plus case ownership conflict.",
    );
  }

  throw new SoloPlusOrchestrationError(
    "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
    "Unexpected Solo Plus repository result.",
  );
}

function normalizeCreateInput(params: {
  flowOrigin: SoloPlusFlowOrigin;
  merchantId: string | null;
  onboardingSessionId: string | null;
  sourcePlan: SoloPlusSourcePlan;
  activePlanSnapshot: "starter" | "solo_lite" | "solo_plus" | "business" | null;
  idempotencyKey: unknown;
  expectedAmount: unknown;
  paymentCurrency: unknown;
  requirementsPolicyVersion: unknown;
  requirementsSnapshot: unknown;
  accessContext: unknown;
  featureFlags: unknown;
}): {
  accessContext: SoloPlusAccessContext;
  intent: SoloPlusCaseCreationIntent;
  idempotencyKey: string;
} {
  const accessContext = assertCaseCreationAccess(params.featureFlags, params.accessContext);
  const idempotencyKey = assertIdentifier(params.idempotencyKey, "idempotencyKey");
  const requirementsPolicyVersion = assertIdentifier(
    params.requirementsPolicyVersion,
    "requirementsPolicyVersion",
  );
  const expectedAmount = assertCanonicalAmount(params.expectedAmount);
  const paymentCurrency = assertCurrency(params.paymentCurrency);
  const requirementsSnapshot = cloneRequirementsSnapshot(params.requirementsSnapshot);

  return {
    accessContext,
    idempotencyKey,
    intent: {
      flowOrigin: params.flowOrigin,
      merchantId: params.merchantId,
      onboardingSessionId: params.onboardingSessionId,
      sourcePlan: params.sourcePlan,
      targetPlan: "solo_plus",
      expectedAmount,
      paymentCurrency,
      requirementsPolicyVersion,
      requirementsSnapshot,
      activePlanSnapshot: params.activePlanSnapshot,
    },
  };
}

async function hydrateCreationResult(
  repository: SoloPlusCaseRepository,
  outcome: SoloPlusCaseCreationResult["outcome"],
  caseRecord: SoloPlusCaseRecord,
  createdEvent: SoloPlusCaseEventRecord | null,
): Promise<SoloPlusCaseCreationResult> {
  const requirements = await repository.listRequirements(caseRecord.id);
  return {
    outcome,
    caseRecord,
    requirements,
    createdEvent,
  };
}

export function createSoloPlusOrchestration(
  dependencies: SoloPlusOrchestrationDependencies,
): SoloPlusOrchestrationService {
  const repository = dependencies.repository;
  const now = dependencies.now || (() => new Date());
  const generateId =
    dependencies.generateId ||
    (() => {
      throw new SoloPlusOrchestrationError(
        "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE",
        "No ID generator configured for Solo Plus orchestration.",
      );
    });

  async function createCase(
    intent: SoloPlusCaseCreationIntent,
    accessContext: SoloPlusAccessContext,
    idempotencyKey: string,
  ): Promise<SoloPlusCaseCreationResult> {
    const existingByIdempotency = await repository.findCaseByIdempotencyKey(idempotencyKey);
    if (existingByIdempotency) {
      if (!sameIntent(buildIntentFromCase(existingByIdempotency), intent)) {
        throw new SoloPlusOrchestrationError(
          "SOLO_PLUS_IDEMPOTENCY_CONFLICT",
          "The idempotency key is already bound to a different Solo Plus intent.",
        );
      }

      return hydrateCreationResult(
        repository,
        "idempotent_replay",
        existingByIdempotency,
        null,
      );
    }

    const activeCase =
      intent.flowOrigin === "upgrade" && intent.merchantId
        ? await repository.findActiveCaseByMerchantId(intent.merchantId)
        : intent.onboardingSessionId
          ? await repository.findActiveCaseByOnboardingSessionId(intent.onboardingSessionId)
          : null;

    if (activeCase) {
      if (sameIntent(buildIntentFromCase(activeCase), intent)) {
        return hydrateCreationResult(repository, "existing_active_case", activeCase, null);
      }

      throw new SoloPlusOrchestrationError(
        "SOLO_PLUS_ACTIVE_CASE_CONFLICT",
        "An active Solo Plus case already exists for this anchor.",
      );
    }

    const nowIso = now().toISOString();
    const caseId = generateId();
    const caseRecord: SoloPlusCaseRecord = {
      id: caseId,
      merchantId: intent.merchantId,
      onboardingSessionId: intent.onboardingSessionId,
      flowOrigin: intent.flowOrigin,
      sourcePlan: intent.sourcePlan,
      targetPlan: "solo_plus",
      caseStatus: "draft",
      paymentStatus: "pending",
      refundStatus: "none",
      paymentRecordId: null,
      paymentProvider: null,
      paymentReference: null,
      expectedAmount: intent.expectedAmount,
      paymentCurrency: intent.paymentCurrency,
      requirementsPolicyVersion: intent.requirementsPolicyVersion,
      requirementsSnapshot: intent.requirementsSnapshot,
      activePlanSnapshot: intent.activePlanSnapshot,
      rejectionReason: null,
      approvedAt: null,
      rejectedAt: null,
      reopenedAt: null,
      idempotencyKey,
      activationIdempotencyKey: null,
      refundIdempotencyKey: null,
      rowVersion: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const requirements = buildRequirementRecords(caseId, nowIso, generateId);
    const event = buildCreationEvent({
      caseId,
      accessContext,
      nowIso,
      generateId,
      flowOrigin: intent.flowOrigin,
      targetPlan: "solo_plus",
      policyVersion: intent.requirementsPolicyVersion,
    });

    const createResult = await repository.createCaseWithRequirementsAndEvent({
      intent,
      caseRecord,
      requirements,
      event,
    });

    if (createResult.kind !== "created") {
      if (createResult.kind === "idempotent_replay") {
        return hydrateCreationResult(
          repository,
          "idempotent_replay",
          createResult.existingCase,
          null,
        );
      }

      if (createResult.kind === "existing_active_case") {
        return hydrateCreationResult(
          repository,
          "existing_active_case",
          createResult.existingCase,
          null,
        );
      }
      mapCreateConflict(createResult);
    }

    return {
      outcome: "created",
      caseRecord: createResult.caseRecord,
      requirements: createResult.requirements,
      createdEvent: createResult.event,
    };
  }

  return {
    async createSoloPlusOnboardingCase(
      input: CreateSoloPlusOnboardingCaseInput,
    ): Promise<SoloPlusCaseCreationResult> {
      const onboardingSessionId = assertIdentifier(
        input.onboardingSessionId,
        "onboardingSessionId",
      );

      const normalized = normalizeCreateInput({
        flowOrigin: "onboarding",
        merchantId: null,
        onboardingSessionId,
        sourcePlan: null,
        activePlanSnapshot: null,
        idempotencyKey: input.idempotencyKey,
        expectedAmount: input.expectedAmount,
        paymentCurrency: input.paymentCurrency,
        requirementsPolicyVersion: input.requirementsPolicyVersion,
        requirementsSnapshot: input.requirementsSnapshot,
        accessContext: input.accessContext,
        featureFlags: input.featureFlags,
      });

      return createCase(normalized.intent, normalized.accessContext, normalized.idempotencyKey);
    },

    async createSoloPlusUpgradeCase(
      input: CreateSoloPlusUpgradeCaseInput,
    ): Promise<SoloPlusCaseCreationResult> {
      const merchantId = assertIdentifier(input.merchantId, "merchantId");

      if (input.currentPlan !== "solo_lite") {
        throw createIssuesError(
          "SOLO_PLUS_INVALID_CREATION_INPUT",
          "Solo Plus upgrades may only start from solo_lite.",
          "currentPlan",
        );
      }

      const normalized = normalizeCreateInput({
        flowOrigin: "upgrade",
        merchantId,
        onboardingSessionId: null,
        sourcePlan: "solo_lite",
        activePlanSnapshot: "solo_lite",
        idempotencyKey: input.idempotencyKey,
        expectedAmount: input.expectedAmount,
        paymentCurrency: input.paymentCurrency,
        requirementsPolicyVersion: input.requirementsPolicyVersion,
        requirementsSnapshot: input.requirementsSnapshot,
        accessContext: input.accessContext,
        featureFlags: input.featureFlags,
      });

      return createCase(normalized.intent, normalized.accessContext, normalized.idempotencyKey);
    },

    async attachMerchantToSoloPlusOnboardingCase(
      input: AttachMerchantToSoloPlusOnboardingCaseInput,
    ): Promise<SoloPlusCaseMutationResult> {
      const caseId = assertIdentifier(input.caseId, "caseId");
      const onboardingSessionId = assertIdentifier(
        input.onboardingSessionId,
        "onboardingSessionId",
      );
      const merchantId = assertIdentifier(input.merchantId, "merchantId");
      const requestIdempotencyKey = assertIdentifier(
        input.requestIdempotencyKey,
        "requestIdempotencyKey",
      );

      if (!isSoloPlusAccessContext(input.accessContext)) {
        throw createIssuesError(
          "SOLO_PLUS_INVALID_CREATION_INPUT",
          "accessContext is malformed.",
          "accessContext",
        );
      }

      if (
        typeof input.expectedRowVersion !== "number" ||
        !Number.isInteger(input.expectedRowVersion) ||
        input.expectedRowVersion < 0
      ) {
        throw createIssuesError(
          "SOLO_PLUS_INVALID_CREATION_INPUT",
          "expectedRowVersion must be a non-negative integer.",
          "expectedRowVersion",
        );
      }

      const currentCase = await repository.findCaseById(caseId);
      if (!currentCase) {
        throw new SoloPlusOrchestrationError(
          "SOLO_PLUS_CASE_NOT_FOUND",
          "Solo Plus case not found.",
        );
      }

      if (currentCase.flowOrigin !== "onboarding") {
        throw new SoloPlusOrchestrationError(
          "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT",
          "Only onboarding-origin Solo Plus cases may receive merchant attachment.",
        );
      }

      if (currentCase.onboardingSessionId !== onboardingSessionId) {
        throw new SoloPlusOrchestrationError(
          "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT",
          "Onboarding session does not match the Solo Plus case.",
        );
      }

      if (isTerminalSoloPlusCaseStatus(currentCase.caseStatus)) {
        throw new SoloPlusOrchestrationError(
          "SOLO_PLUS_CASE_STATE_CONFLICT",
          "Terminal Solo Plus cases cannot receive new merchant attachment.",
        );
      }

      if (currentCase.merchantId === merchantId) {
        return {
          outcome: "idempotent_replay",
          caseRecord: currentCase,
          event: null,
        };
      }

      if (currentCase.merchantId && currentCase.merchantId !== merchantId) {
        throw new SoloPlusOrchestrationError(
          "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT",
          "Solo Plus onboarding case is already attached to a different merchant.",
        );
      }

      const nowIso = now().toISOString();
      const result = await repository.attachMerchantToOnboardingCase({
        caseId,
        onboardingSessionId,
        merchantId,
        expectedRowVersion: input.expectedRowVersion,
        requestIdempotencyKey,
        event: buildMerchantAttachedEvent({
          caseRecord: currentCase,
          merchantId,
          requestIdempotencyKey,
          nowIso,
          generateId,
          accessContext: input.accessContext,
        }),
      });

      if (result.kind !== "updated" && result.kind !== "idempotent_replay") {
        mapCreateConflict(result);
      }

      return {
        outcome: result.kind === "updated" ? "updated" : "idempotent_replay",
        caseRecord: result.caseRecord,
        event: result.event,
      };
    },

    async markSoloPlusCaseAwaitingPayment(
      input: MarkSoloPlusCaseAwaitingPaymentInput,
    ): Promise<SoloPlusCaseMutationResult> {
      const caseId = assertIdentifier(input.caseId, "caseId");
      const requestIdempotencyKey = assertIdentifier(
        input.requestIdempotencyKey,
        "requestIdempotencyKey",
      );

      if (!isSoloPlusAccessContext(input.accessContext)) {
        throw createIssuesError(
          "SOLO_PLUS_INVALID_CREATION_INPUT",
          "accessContext is malformed.",
          "accessContext",
        );
      }

      if (
        typeof input.expectedRowVersion !== "number" ||
        !Number.isInteger(input.expectedRowVersion) ||
        input.expectedRowVersion < 0
      ) {
        throw createIssuesError(
          "SOLO_PLUS_INVALID_CREATION_INPUT",
          "expectedRowVersion must be a non-negative integer.",
          "expectedRowVersion",
        );
      }

      const currentCase = await repository.findCaseById(caseId);
      if (!currentCase) {
        throw new SoloPlusOrchestrationError(
          "SOLO_PLUS_CASE_NOT_FOUND",
          "Solo Plus case not found.",
        );
      }

      if (currentCase.caseStatus === "awaiting_payment") {
        return {
          outcome: "idempotent_replay",
          caseRecord: currentCase,
          event: null,
        };
      }

      try {
        assertSoloPlusCaseTransition(currentCase.caseStatus, "awaiting_payment");
      } catch {
        throw new SoloPlusOrchestrationError(
          "SOLO_PLUS_CASE_STATE_CONFLICT",
          "Solo Plus case cannot transition to awaiting_payment from the current state.",
        );
      }

      const nowIso = now().toISOString();
      const result = await repository.transitionCaseStatus({
        caseId,
        expectedRowVersion: input.expectedRowVersion,
        expectedCurrentStatus: "draft",
        targetStatus: "awaiting_payment",
        requestIdempotencyKey,
        patch: {
          caseStatus: "awaiting_payment",
          paymentStatus: "pending",
          paymentProvider: null,
          paymentReference: null,
        },
        event: buildAwaitingPaymentEvent({
          caseRecord: currentCase,
          requestIdempotencyKey,
          nowIso,
          generateId,
          accessContext: input.accessContext,
        }),
      });

      if (result.kind !== "updated" && result.kind !== "idempotent_replay") {
        mapCreateConflict(result);
      }

      return {
        outcome: result.kind === "updated" ? "updated" : "idempotent_replay",
        caseRecord: result.caseRecord,
        event: result.event,
      };
    },
  };
}

export function canCreatePublicSoloPlusCaseIntent(
  featureFlags: SoloPlusFeatureFlags,
  accessContext: SoloPlusAccessContext,
): boolean {
  return canCreatePublicSoloPlusCase(featureFlags, accessContext);
}

export function canCreateInternalSoloPlusTestCaseIntent(
  featureFlags: SoloPlusFeatureFlags,
  accessContext: SoloPlusAccessContext,
): boolean {
  return canCreateInternalSoloPlusTestCase(featureFlags, accessContext);
}

export function assertSoloPlusCaseCreationAccess(params: {
  featureFlags: SoloPlusFeatureFlags;
  accessContext: SoloPlusAccessContext;
}): void {
  assertCaseCreationAccess(params.featureFlags, params.accessContext);
}
