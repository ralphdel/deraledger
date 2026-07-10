import {
  evaluateSoloPlusEvidenceCandidates,
  selectBestReusableSoloPlusEvidence,
  type SoloPlusEvidenceCandidate,
  type SoloPlusEvidenceReuseDecision,
  type SoloPlusEvidenceReusePolicy,
  type SoloPlusEvidenceSourceType,
} from "./evidence-reuse";
import type {
  SoloPlusCaseRequirementRecord,
  SoloPlusSafeJsonObject,
  SoloPlusSafeJsonValue,
} from "./repository";
import { SOLO_PLUS_REQUIRED_REQUIREMENTS, type SoloPlusRequirementCode } from "./state";

type SoloPlusCollectedEvidenceState = "pending" | "processing" | "needs_review";

export type SoloPlusDocumentEvidenceReferenceInput = {
  storageKey: string;
  checksumSha256?: string | null;
  uploadedAt: string;
  contentType?: string | null;
  fileSizeBytes?: number | null;
  providerName?: string | null;
  providerReference?: string | null;
  sourceId?: string | null;
  verificationLogId?: string | null;
};

export type SoloPlusActivityProfileInput = {
  businessActivityType: string;
  expectedMonthlyTransactionValue: string;
  expectedTransactionCount: number;
  typicalCustomerType: string;
  reasonForHigherCollectionNeed: string;
  expectedSettlementBehaviour: string;
  submittedAt?: string | null;
};

export type SoloPlusCollectedRequirementEvidence = {
  requirementCode: SoloPlusRequirementCode;
  sourceType: SoloPlusEvidenceSourceType;
  sourceId?: string | null;
  verificationLogId?: string | null;
  evidenceReference?: string | null;
  providerName?: string | null;
  providerReference?: string | null;
  state: SoloPlusCollectedEvidenceState;
  metadata: SoloPlusSafeJsonObject;
  completedAt?: string | null;
  reviewNote?: string | null;
  failureReason?: string | null;
};

export type SoloPlusRequirementOrchestrationParams = {
  caseId: string;
  merchantId: string | null;
  currentRequirements: readonly SoloPlusCaseRequirementRecord[];
  evidenceCandidates: readonly SoloPlusEvidenceCandidate[];
  collectedEvidence: readonly SoloPlusCollectedRequirementEvidence[];
  policy: SoloPlusEvidenceReusePolicy;
  evaluatedAt: Date | string;
  now?: () => Date;
  generateId: () => string;
};

export type SoloPlusRequirementOrchestrationResult = {
  requirements: readonly SoloPlusCaseRequirementRecord[];
  decisions: Readonly<Record<SoloPlusRequirementCode, SoloPlusEvidenceReuseDecision | null>>;
};

export const SOLO_PLUS_KYC_REQUIREMENTS_POLICY: SoloPlusEvidenceReusePolicy = {
  version: "solo-plus-kyc-evidence-v1",
  rules: [
    {
      requirementCode: "bvn",
      allowReuse: true,
      allowedSourceTypes: ["verification_log"],
      minimumAssuranceLevel: "standard",
      maximumAgeDays: 365,
      requireIdentityMatch: true,
      requireSubjectMatch: false,
      policyRuleCode: "reuse_bvn_v1",
    },
    {
      requirementCode: "selfie_liveness",
      allowReuse: true,
      allowedSourceTypes: ["verification_log"],
      minimumAssuranceLevel: "enhanced",
      maximumAgeDays: 180,
      requireIdentityMatch: true,
      requireSubjectMatch: false,
      policyRuleCode: "reuse_selfie_liveness_v1",
    },
    {
      requirementCode: "id_document",
      allowReuse: true,
      allowedSourceTypes: ["verification_log", "merchant_document"],
      minimumAssuranceLevel: "standard",
      maximumAgeDays: 365,
      requireIdentityMatch: true,
      requireSubjectMatch: false,
      policyRuleCode: "reuse_id_document_v1",
    },
    {
      requirementCode: "proof_of_address",
      allowReuse: true,
      allowedSourceTypes: ["merchant_document", "verification_log"],
      minimumAssuranceLevel: "basic",
      maximumAgeDays: 90,
      requireIdentityMatch: true,
      requireSubjectMatch: false,
      policyRuleCode: "reuse_proof_of_address_v1",
    },
    {
      requirementCode: "settlement_account",
      allowReuse: true,
      allowedSourceTypes: ["settlement_account", "verification_log"],
      minimumAssuranceLevel: "standard",
      maximumAgeDays: 180,
      requireIdentityMatch: false,
      requireSubjectMatch: true,
      policyRuleCode: "reuse_settlement_account_v1",
    },
    {
      requirementCode: "activity_profile",
      allowReuse: false,
      allowedSourceTypes: ["manual_submission"],
      minimumAssuranceLevel: "basic",
      maximumAgeDays: 30,
      requireIdentityMatch: false,
      requireSubjectMatch: false,
      policyRuleCode: "reuse_activity_profile_v1",
    },
  ],
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeOptionalString(value: unknown): string | null {
  return hasNonEmptyString(value) ? value.trim() : null;
}

function toIsoString(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error("Solo Plus requirement orchestration requires valid timestamps.");
  }
  return parsed.toISOString();
}

function isUuidLike(value: string | null | undefined): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function cloneMetadata(value: SoloPlusSafeJsonObject): SoloPlusSafeJsonObject {
  return JSON.parse(JSON.stringify(value)) as SoloPlusSafeJsonObject;
}

function hasSafeMetadata(record: SoloPlusCaseRequirementRecord): boolean {
  return Object.keys(record.metadata || {}).length > 0;
}

function buildBaseRequirement(
  params: {
    caseId: string;
    requirementCode: SoloPlusRequirementCode;
    nowIso: string;
    generateId: () => string;
  },
): SoloPlusCaseRequirementRecord {
  return {
    id: params.generateId(),
    caseId: params.caseId,
    requirementCode: params.requirementCode,
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
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
}

function buildReuseMetadata(
  candidate: SoloPlusEvidenceCandidate,
  decision: SoloPlusEvidenceReuseDecision,
): SoloPlusSafeJsonObject {
  const metadata: SoloPlusSafeJsonObject = {
    provenance: {
      evidenceId: candidate.evidenceId,
      evaluatorOutcome: decision.outcome,
      policyVersion: decision.policyVersion,
      policyRuleApplied: decision.policyRuleApplied,
      reasonCode: decision.reasonCode,
      evaluatedAt: decision.evaluatedAt,
      sourceType: candidate.sourceType,
    },
  };

  if (hasNonEmptyString(candidate.evidenceReference)) {
    metadata.provenance = {
      ...(metadata.provenance as SoloPlusSafeJsonObject),
      evidenceReference: candidate.evidenceReference,
    };
  }

  if (hasNonEmptyString(candidate.providerReference)) {
    metadata.provenance = {
      ...(metadata.provenance as SoloPlusSafeJsonObject),
      providerReference: candidate.providerReference,
    };
  }

  return metadata;
}

function buildPendingEvaluationMetadata(decision: SoloPlusEvidenceReuseDecision): SoloPlusSafeJsonObject {
  return {
    lastEvaluation: {
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
      policyVersion: decision.policyVersion,
      policyRuleApplied: decision.policyRuleApplied,
      evaluatedAt: decision.evaluatedAt,
    },
  };
}

function applyReusedRequirement(
  existing: SoloPlusCaseRequirementRecord,
  candidate: SoloPlusEvidenceCandidate,
  decision: SoloPlusEvidenceReuseDecision,
  nowIso: string,
): SoloPlusCaseRequirementRecord {
  return {
    ...existing,
    requirementState: "reused",
    verificationLogId: normalizeOptionalString(candidate.verificationLogId),
    evidenceSourceType: candidate.sourceType,
    evidenceSourceId: isUuidLike(candidate.sourceRowId) ? candidate.sourceRowId.trim() : null,
    evidenceReference:
      normalizeOptionalString(candidate.evidenceReference) ||
      normalizeOptionalString(candidate.providerReference) ||
      normalizeOptionalString(candidate.sourceRowId),
    originalCompletedAt: normalizeOptionalString(decision.originalCompletedAt),
    reuseDecisionAt: normalizeOptionalString(decision.reuseDecisionAt) || nowIso,
    reuseReason: normalizeOptionalString(decision.reuseReason) || decision.reasonCode,
    policyRuleApplied: decision.policyRuleApplied || null,
    reviewNote: null,
    providerName: null,
    providerReference: normalizeOptionalString(candidate.providerReference),
    failureReason: null,
    completedAt: nowIso,
    metadata: buildReuseMetadata(candidate, decision),
    updatedAt: nowIso,
  };
}

function applyCollectedRequirement(
  existing: SoloPlusCaseRequirementRecord,
  collected: SoloPlusCollectedRequirementEvidence,
  nowIso: string,
): SoloPlusCaseRequirementRecord {
  return {
    ...existing,
    requirementState: collected.state,
    verificationLogId: normalizeOptionalString(collected.verificationLogId),
    evidenceSourceType: collected.sourceType,
    evidenceSourceId: isUuidLike(collected.sourceId) ? collected.sourceId.trim() : null,
    evidenceReference: normalizeOptionalString(collected.evidenceReference),
    originalCompletedAt: null,
    reuseDecisionAt: null,
    reuseReason: null,
    policyRuleApplied: null,
    reviewNote: normalizeOptionalString(collected.reviewNote),
    providerName: normalizeOptionalString(collected.providerName),
    providerReference: normalizeOptionalString(collected.providerReference),
    failureReason: normalizeOptionalString(collected.failureReason),
    completedAt: collected.state === "pending" || collected.state === "processing"
      ? null
      : normalizeOptionalString(collected.completedAt),
    metadata: cloneMetadata(collected.metadata),
    updatedAt: nowIso,
  };
}

function applyNeedsReviewRequirement(
  existing: SoloPlusCaseRequirementRecord,
  candidate: SoloPlusEvidenceCandidate,
  decision: SoloPlusEvidenceReuseDecision,
  nowIso: string,
): SoloPlusCaseRequirementRecord {
  return {
    ...existing,
    requirementState: "needs_review",
    verificationLogId: normalizeOptionalString(candidate.verificationLogId),
    evidenceSourceType: candidate.sourceType,
    evidenceSourceId: isUuidLike(candidate.sourceRowId) ? candidate.sourceRowId.trim() : null,
    evidenceReference:
      normalizeOptionalString(candidate.evidenceReference) ||
      normalizeOptionalString(candidate.providerReference) ||
      normalizeOptionalString(candidate.sourceRowId),
    originalCompletedAt: normalizeOptionalString(decision.originalCompletedAt),
    reuseDecisionAt: normalizeOptionalString(decision.reuseDecisionAt) || nowIso,
    reuseReason: null,
    policyRuleApplied: decision.policyRuleApplied || null,
    reviewNote: `Existing evidence requires review: ${decision.reasonCode}.`,
    providerName: null,
    providerReference: normalizeOptionalString(candidate.providerReference),
    failureReason: decision.reasonCode,
    completedAt: null,
    metadata: buildPendingEvaluationMetadata(decision),
    updatedAt: nowIso,
  };
}

function applyNotReusableRequirement(
  existing: SoloPlusCaseRequirementRecord,
  decision: SoloPlusEvidenceReuseDecision,
  nowIso: string,
): SoloPlusCaseRequirementRecord {
  return {
    ...existing,
    requirementState: "pending",
    verificationLogId: null,
    evidenceSourceType: null,
    evidenceSourceId: null,
    evidenceReference: null,
    originalCompletedAt: null,
    reuseDecisionAt: normalizeOptionalString(decision.reuseDecisionAt) || nowIso,
    reuseReason: null,
    policyRuleApplied: decision.policyRuleApplied || null,
    reviewNote: null,
    providerName: null,
    providerReference: null,
    failureReason: decision.reasonCode,
    completedAt: null,
    metadata: buildPendingEvaluationMetadata(decision),
    updatedAt: nowIso,
  };
}

function shouldKeepExistingRequirement(record: SoloPlusCaseRequirementRecord): boolean {
  return record.requirementState !== "not_started" ||
    record.verificationLogId != null ||
    record.evidenceSourceType != null ||
    record.evidenceReference != null ||
    hasSafeMetadata(record);
}

export function buildDocumentRequirementEvidence(
  requirementCode: "id_document" | "proof_of_address",
  input: SoloPlusDocumentEvidenceReferenceInput,
): SoloPlusCollectedRequirementEvidence {
  return {
    requirementCode,
    sourceType: "merchant_document",
    sourceId: normalizeOptionalString(input.sourceId),
    verificationLogId: normalizeOptionalString(input.verificationLogId),
    evidenceReference: input.storageKey.trim(),
    providerName: normalizeOptionalString(input.providerName),
    providerReference: normalizeOptionalString(input.providerReference),
    state: "pending",
    metadata: {
      storageKey: input.storageKey.trim(),
      checksumSha256: normalizeOptionalString(input.checksumSha256),
      uploadedAt: toIsoString(input.uploadedAt),
      contentType: normalizeOptionalString(input.contentType),
      fileSizeBytes: typeof input.fileSizeBytes === "number" ? input.fileSizeBytes : null,
    },
  };
}

export function buildActivityProfileRequirementEvidence(
  input: SoloPlusActivityProfileInput,
): SoloPlusCollectedRequirementEvidence {
  return {
    requirementCode: "activity_profile",
    sourceType: "manual_submission",
    state: "pending",
    evidenceReference: "activity_profile",
    metadata: {
      activityProfile: {
        businessActivityType: input.businessActivityType.trim(),
        expectedMonthlyTransactionValue: input.expectedMonthlyTransactionValue.trim(),
        expectedTransactionCount: input.expectedTransactionCount,
        typicalCustomerType: input.typicalCustomerType.trim(),
        reasonForHigherCollectionNeed: input.reasonForHigherCollectionNeed.trim(),
        expectedSettlementBehaviour: input.expectedSettlementBehaviour.trim(),
      },
      submittedAt: toIsoString(input.submittedAt || new Date()),
    },
  };
}

export function orchestrateSoloPlusRequirements(
  params: SoloPlusRequirementOrchestrationParams,
): SoloPlusRequirementOrchestrationResult {
  const nowIso = toIsoString(params.now ? params.now() : new Date());
  const evaluatedAtIso = toIsoString(params.evaluatedAt);
  const currentByCode = new Map(
    params.currentRequirements.map((requirement) => [requirement.requirementCode, requirement]),
  );
  const collectedByCode = new Map(
    params.collectedEvidence.map((evidence) => [evidence.requirementCode, evidence]),
  );
  const decisionsByCode = {} as Record<SoloPlusRequirementCode, SoloPlusEvidenceReuseDecision | null>;

  const requirements = SOLO_PLUS_REQUIRED_REQUIREMENTS.map((requirementCode) => {
    const current =
      currentByCode.get(requirementCode) ||
      buildBaseRequirement({
        caseId: params.caseId,
        requirementCode,
        nowIso,
        generateId: params.generateId,
      });
    const candidates = params.evidenceCandidates.filter(
      (candidate) => candidate.requirementCode === requirementCode,
    );
    const decisions =
      params.merchantId && candidates.length > 0
        ? evaluateSoloPlusEvidenceCandidates({
            targetMerchantId: params.merchantId,
            targetRequirementCode: requirementCode,
            candidates,
            policy: params.policy,
            evaluatedAt: evaluatedAtIso,
          })
        : [];
    const reusableDecision = selectBestReusableSoloPlusEvidence(decisions);
    const reusableCandidate = reusableDecision
      ? candidates.find((candidate) => candidate.evidenceId === reusableDecision.evidenceId) || null
      : null;
    const needsReviewDecision = decisions.find((decision) => decision.outcome === "needs_review") || null;
    const needsReviewCandidate = needsReviewDecision
      ? candidates.find((candidate) => candidate.evidenceId === needsReviewDecision.evidenceId) || null
      : null;
    const collected = collectedByCode.get(requirementCode) || null;
    const blockingDecision =
      reusableDecision ||
      needsReviewDecision ||
      decisions.find((decision) => decision.outcome === "not_reusable") ||
      null;

    decisionsByCode[requirementCode] = blockingDecision;

    if (reusableDecision && reusableCandidate) {
      return applyReusedRequirement(current, reusableCandidate, reusableDecision, nowIso);
    }

    if (collected) {
      return applyCollectedRequirement(current, collected, nowIso);
    }

    if (needsReviewDecision && needsReviewCandidate) {
      return applyNeedsReviewRequirement(current, needsReviewCandidate, needsReviewDecision, nowIso);
    }

    if (blockingDecision) {
      return applyNotReusableRequirement(current, blockingDecision, nowIso);
    }

    if (shouldKeepExistingRequirement(current)) {
      return {
        ...current,
        metadata: cloneMetadata(current.metadata),
      };
    }

    return current;
  });

  return { requirements, decisions: decisionsByCode };
}
