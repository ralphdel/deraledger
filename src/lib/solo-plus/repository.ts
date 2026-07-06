import type {
  SoloPlusCaseStatus,
  SoloPlusPaymentStatus,
  SoloPlusRefundStatus,
  SoloPlusRequirementCode,
  SoloPlusRequirementState,
} from "./state";

export type SoloPlusFlowOrigin = "onboarding" | "upgrade";
export type SoloPlusSourcePlan = "solo_lite" | null;
export type SoloPlusTargetPlan = "solo_plus";
export type SoloPlusPaymentProvider = "paystack" | "monnify" | null;
export type SoloPlusEventActorType = "merchant" | "admin" | "system" | "provider";

export type SoloPlusSafeJsonPrimitive = string | number | boolean | null;
export type SoloPlusSafeJsonValue =
  | SoloPlusSafeJsonPrimitive
  | SoloPlusSafeJsonValue[]
  | SoloPlusSafeJsonObject;

export type SoloPlusSafeJsonObject = {
  [key: string]: SoloPlusSafeJsonValue;
};

export type SoloPlusAmount = string;

const SOLO_PLUS_AMOUNT_PATTERN = /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/;

export function normalizeSoloPlusAmount(value: string): SoloPlusAmount {
  const trimmed = value.trim();

  if (!SOLO_PLUS_AMOUNT_PATTERN.test(trimmed)) {
    throw new Error("Solo Plus amount must be a canonical numeric(18,2)-compatible decimal string.");
  }

  const [wholePart, fractionalPart = ""] = trimmed.split(".");
  return `${wholePart}.${fractionalPart.padEnd(2, "0")}`;
}

export type SoloPlusCaseRecord = {
  id: string;
  merchantId: string | null;
  onboardingSessionId: string | null;
  flowOrigin: SoloPlusFlowOrigin;
  sourcePlan: SoloPlusSourcePlan;
  targetPlan: SoloPlusTargetPlan;
  caseStatus: SoloPlusCaseStatus;
  paymentStatus: SoloPlusPaymentStatus;
  refundStatus: SoloPlusRefundStatus;
  paymentRecordId: string | null;
  paymentProvider: SoloPlusPaymentProvider;
  paymentReference: string | null;
  expectedAmount: SoloPlusAmount;
  paymentCurrency: "NGN";
  requirementsPolicyVersion: string;
  requirementsSnapshot: SoloPlusSafeJsonObject;
  activePlanSnapshot: "starter" | "solo_lite" | "solo_plus" | "business" | null;
  rejectionReason: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  reopenedAt: string | null;
  idempotencyKey: string;
  activationIdempotencyKey: string | null;
  refundIdempotencyKey: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type SoloPlusCaseRequirementRecord = {
  id: string;
  caseId: string;
  requirementCode: SoloPlusRequirementCode;
  requirementState: SoloPlusRequirementState;
  verificationLogId: string | null;
  evidenceSourceType:
    | "verification_log"
    | "merchant_document"
    | "settlement_account"
    | "manual_submission"
    | null;
  evidenceSourceId: string | null;
  evidenceReference: string | null;
  originalCompletedAt: string | null;
  reuseDecisionAt: string | null;
  reuseReason: string | null;
  policyRuleApplied: string | null;
  reviewedByAdminId: string | null;
  reviewNote: string | null;
  providerName: string | null;
  providerReference: string | null;
  failureReason: string | null;
  completedAt: string | null;
  metadata: SoloPlusSafeJsonObject;
  createdAt: string;
  updatedAt: string;
};

export type SoloPlusCaseEventRecord = {
  id: string;
  caseId: string;
  eventType: string;
  previousState: SoloPlusSafeJsonObject;
  newState: SoloPlusSafeJsonObject;
  actorType: SoloPlusEventActorType;
  actorId: string | null;
  requestIdempotencyKey: string | null;
  reason: string | null;
  policyVersion: string;
  createdAt: string;
};

export type SoloPlusCaseCreationIntent = {
  flowOrigin: SoloPlusFlowOrigin;
  merchantId: string | null;
  onboardingSessionId: string | null;
  sourcePlan: SoloPlusSourcePlan;
  targetPlan: SoloPlusTargetPlan;
  expectedAmount: SoloPlusAmount;
  paymentCurrency: "NGN";
  requirementsPolicyVersion: string;
  requirementsSnapshot: SoloPlusSafeJsonObject;
  activePlanSnapshot: "starter" | "solo_lite" | "solo_plus" | "business" | null;
};

export type SoloPlusCaseCreationResult = {
  outcome: "created" | "idempotent_replay" | "existing_active_case";
  caseRecord: SoloPlusCaseRecord;
  requirements: readonly SoloPlusCaseRequirementRecord[];
  createdEvent: SoloPlusCaseEventRecord | null;
};

export type SoloPlusCaseMutationResult = {
  outcome: "updated" | "idempotent_replay";
  caseRecord: SoloPlusCaseRecord;
  event: SoloPlusCaseEventRecord | null;
};

export const SOLO_PLUS_ACTIVE_CASE_STATUSES: readonly SoloPlusCaseStatus[] = [
  "draft",
  "awaiting_payment",
  "verification_pending",
  "manual_review",
] as const;

export type SoloPlusCaseCreateAtomicInput = {
  intent: SoloPlusCaseCreationIntent;
  caseRecord: SoloPlusCaseRecord;
  requirements: readonly SoloPlusCaseRequirementRecord[];
  event: SoloPlusCaseEventRecord;
};

export type SoloPlusCaseCreateAtomicResult =
  | {
      kind: "created";
      caseRecord: SoloPlusCaseRecord;
      requirements: readonly SoloPlusCaseRequirementRecord[];
      event: SoloPlusCaseEventRecord;
    }
  | {
      kind: "idempotent_replay";
      existingCase: SoloPlusCaseRecord;
    }
  | {
      kind: "existing_active_case";
      existingCase: SoloPlusCaseRecord;
    }
  | {
      kind: "idempotency_conflict";
      existingCase: SoloPlusCaseRecord;
    }
  | {
      kind: "active_case_conflict";
      existingCase: SoloPlusCaseRecord;
    }
  | {
      kind: "atomic_persistence_unavailable";
      message?: string;
    };

export type SoloPlusAttachMerchantAtomicParams = {
  caseId: string;
  onboardingSessionId: string;
  merchantId: string;
  expectedRowVersion: number;
  requestIdempotencyKey: string;
  event: SoloPlusCaseEventRecord;
};

export type SoloPlusAttachMerchantAtomicResult =
  | {
      kind: "updated";
      caseRecord: SoloPlusCaseRecord;
      event: SoloPlusCaseEventRecord;
    }
  | {
      kind: "idempotent_replay";
      caseRecord: SoloPlusCaseRecord;
      event: SoloPlusCaseEventRecord | null;
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "idempotency_conflict";
      currentCase: SoloPlusCaseRecord;
    }
  | {
      kind: "active_case_conflict";
      currentCase: SoloPlusCaseRecord;
    }
  | {
      kind: "version_conflict";
      currentCase: SoloPlusCaseRecord;
    }
  | {
      kind: "state_conflict";
      currentCase: SoloPlusCaseRecord;
    }
  | {
      kind: "ownership_conflict";
      currentCase: SoloPlusCaseRecord;
    };

export type SoloPlusCaseTransitionPatch = Partial<
  Pick<
    SoloPlusCaseRecord,
    | "caseStatus"
    | "paymentStatus"
    | "refundStatus"
    | "paymentRecordId"
    | "paymentProvider"
    | "paymentReference"
    | "activationIdempotencyKey"
    | "refundIdempotencyKey"
    | "rejectionReason"
    | "approvedAt"
    | "rejectedAt"
    | "reopenedAt"
  >
>;

export type SoloPlusCaseTransitionAtomicParams = {
  caseId: string;
  expectedRowVersion: number;
  expectedCurrentStatus: SoloPlusCaseStatus;
  targetStatus: SoloPlusCaseStatus;
  requestIdempotencyKey: string;
  patch: SoloPlusCaseTransitionPatch;
  event: SoloPlusCaseEventRecord;
};

export type SoloPlusCaseTransitionAtomicResult =
  | {
      kind: "updated";
      caseRecord: SoloPlusCaseRecord;
      event: SoloPlusCaseEventRecord;
    }
  | {
      kind: "idempotent_replay";
      caseRecord: SoloPlusCaseRecord;
      event: SoloPlusCaseEventRecord | null;
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "idempotency_conflict";
      currentCase: SoloPlusCaseRecord;
    }
  | {
      kind: "version_conflict";
      currentCase: SoloPlusCaseRecord;
    }
  | {
      kind: "state_conflict";
      currentCase: SoloPlusCaseRecord;
    };

export interface SoloPlusCaseRepository {
  findCaseById(caseId: string): Promise<SoloPlusCaseRecord | null>;
  findCaseByIdempotencyKey(idempotencyKey: string): Promise<SoloPlusCaseRecord | null>;
  findActiveCaseByMerchantId(merchantId: string): Promise<SoloPlusCaseRecord | null>;
  findActiveCaseByOnboardingSessionId(
    onboardingSessionId: string,
  ): Promise<SoloPlusCaseRecord | null>;
  listRequirements(caseId: string): Promise<readonly SoloPlusCaseRequirementRecord[]>;
  listSafeEvents(caseId: string): Promise<readonly SoloPlusCaseEventRecord[]>;
  createCaseWithRequirementsAndEvent(
    input: SoloPlusCaseCreateAtomicInput,
  ): Promise<SoloPlusCaseCreateAtomicResult>;
  attachMerchantToOnboardingCase(
    input: SoloPlusAttachMerchantAtomicParams,
  ): Promise<SoloPlusAttachMerchantAtomicResult>;
  transitionCaseStatus(
    input: SoloPlusCaseTransitionAtomicParams,
  ): Promise<SoloPlusCaseTransitionAtomicResult>;
}
