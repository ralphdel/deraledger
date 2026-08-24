import type {
  MerchantActivationStatus,
  MerchantComplianceStatus,
  MerchantRestrictionState,
} from "./merchant-capabilities";

/**
 * Pure command contract for a future, reviewer-operated compliance approval
 * transition. It performs no database work and never grants activation or a
 * live merchant entitlement.
 */

export type ComplianceApprovalPlan = "solo_lite" | "solo_plus" | "business";

export type ComplianceApprovalSourceState =
  | "lite_pending"
  | "enhanced_pending"
  | "business_pending"
  | "needs_attention";

export type ComplianceApprovalTargetState =
  | "lite_verified"
  | "enhanced_verified"
  | "business_verified"
  | "needs_attention"
  | "restricted"
  | "rejected";

export type ComplianceApprovalReasonCode =
  | "evidence_incomplete"
  | "evidence_expired"
  | "evidence_mismatch"
  | "review_rejected"
  | "reviewer_requested_correction"
  | "policy_restriction"
  | "risk_restricted"
  | "risk_suspended";

export interface TrustedApprovalIdentity {
  merchantId: string;
  workspaceId: string;
  /** This value is set only by the trusted server command boundary. */
  authority: "trusted_server";
}

export interface TrustedApprovalReviewer {
  reviewerId: string;
  /** Browser/session metadata is insufficient for this authorization. */
  authorization: "internal_compliance_reviewer" | "compliance_operator";
  authorized: true;
}

export interface TrustedApprovalEvidenceReference {
  sourceType: "solo_lite_review" | "solo_plus_case" | "business_kyb_review";
  sourceId: string;
  evidenceVersion: number;
  evidenceState: "complete" | "incomplete";
  reviewedAt: string;
  policyVersion: string;
  /** Evidence must be resolved by an approved server-side review flow. */
  authority: "trusted_review_workflow";
}

export interface ExistingApprovalProfileSnapshot {
  complianceStatus: MerchantComplianceStatus | string | null;
  activationStatus: MerchantActivationStatus | string | null;
  restrictionState: MerchantRestrictionState | string | null;
}

export interface ComplianceProfileApprovalCommandRequest {
  identity: TrustedApprovalIdentity | null;
  /** Server-generated approval decision/idempotency key. */
  approvalDecisionKey: string;
  expectedProfileRowVersion: number | null;
  plan: ComplianceApprovalPlan;
  sourceComplianceStatus: ComplianceApprovalSourceState;
  targetComplianceStatus: ComplianceApprovalTargetState;
  reviewer: TrustedApprovalReviewer | null;
  evidence: TrustedApprovalEvidenceReference | null;
  /** Required for rejected, restricted, and needs-attention outcomes. */
  reasonCode?: ComplianceApprovalReasonCode | null;
  /** Suspension is a restriction outcome, never a compliance status. */
  restrictionOutcome?: "none" | "restricted" | "suspended";
  /** A future repository supplies this only from trusted persistence. */
  existingProfile?: ExistingApprovalProfileSnapshot | null;
}

export interface ComplianceProfileApprovalPayload {
  merchantId: string;
  workspaceId: string;
  approvalDecisionKey: string;
  expectedProfileRowVersion: number;
  planCode: ComplianceApprovalPlan;
  sourceComplianceStatus: ComplianceApprovalSourceState;
  complianceStatus: ComplianceApprovalTargetState;
  activationStatus: Extract<MerchantActivationStatus, "test_mode" | "restricted" | "suspended">;
  restrictionState: Extract<MerchantRestrictionState, "restricted" | "suspended"> | null;
  reviewedBy: string;
  reviewedAt: string;
  reviewSourceType: TrustedApprovalEvidenceReference["sourceType"];
  reviewSourceId: string;
  evidenceVersion: number;
  policyVersion: string;
  reasonCode: ComplianceApprovalReasonCode | null;
  /** Approval stays non-operational until a separate activation transition. */
  merchantEntitlements: {
    canCollectPayments: false;
    canUseInstantSale: false;
    canUseReceivableSale: false;
    canUseStorefront: false;
    canActivateSettlement: false;
    canUseDepositBalance: false;
  };
}

export type ComplianceProfileApprovalReasonCode =
  | "approval_identity_missing"
  | "approval_authority_untrusted"
  | "approval_decision_key_missing"
  | "approval_row_version_missing"
  | "approval_reviewer_unauthorized"
  | "approval_evidence_missing"
  | "approval_evidence_unsafe"
  | "approval_evidence_plan_mismatch"
  | "approval_policy_version_missing"
  | "approval_source_target_mismatch"
  | "approval_reason_code_required"
  | "approval_reason_code_unsafe"
  | "approval_restriction_outcome_invalid"
  | "approval_profile_preserved";

export interface ComplianceProfileApprovalDiagnostic {
  code: ComplianceProfileApprovalReasonCode;
}

export type ComplianceProfileApprovalCommandResult =
  | { kind: "prepared"; payload: ComplianceProfileApprovalPayload; diagnostics: readonly [] }
  | { kind: "existing"; diagnostics: readonly [{ code: "approval_profile_preserved" }] }
  | { kind: "rejected"; diagnostics: readonly [ComplianceProfileApprovalDiagnostic] };

const VERIFIED_TARGET_BY_PLAN: Record<ComplianceApprovalPlan, ComplianceApprovalTargetState> = {
  solo_lite: "lite_verified",
  solo_plus: "enhanced_verified",
  business: "business_verified",
};

const SOURCE_BY_PLAN: Record<Exclude<ComplianceApprovalSourceState, "needs_attention">, ComplianceApprovalPlan> = {
  lite_pending: "solo_lite",
  enhanced_pending: "solo_plus",
  business_pending: "business",
};

const EVIDENCE_SOURCE_BY_PLAN: Record<ComplianceApprovalPlan, TrustedApprovalEvidenceReference["sourceType"]> = {
  solo_lite: "solo_lite_review",
  solo_plus: "solo_plus_case",
  business: "business_kyb_review",
};

const NON_VERIFIED_TARGETS = new Set<ComplianceApprovalTargetState>([
  "needs_attention",
  "restricted",
  "rejected",
]);

const SAFE_REASON_CODES = new Set<ComplianceApprovalReasonCode>([
  "evidence_incomplete",
  "evidence_expired",
  "evidence_mismatch",
  "review_rejected",
  "reviewer_requested_correction",
  "policy_restriction",
  "risk_restricted",
  "risk_suspended",
]);

function nonEmpty(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function validIdentity(value: TrustedApprovalIdentity | null): value is TrustedApprovalIdentity {
  return Boolean(
    value
      && value.authority === "trusted_server"
      && nonEmpty(value.merchantId)
      && nonEmpty(value.workspaceId),
  );
}

function validReviewer(value: TrustedApprovalReviewer | null): value is TrustedApprovalReviewer {
  return Boolean(
    value
      && value.authorized === true
      && (value.authorization === "internal_compliance_reviewer" || value.authorization === "compliance_operator")
      && nonEmpty(value.reviewerId),
  );
}

function validEvidence(value: TrustedApprovalEvidenceReference | null): value is TrustedApprovalEvidenceReference {
  return Boolean(
    value
      && value.authority === "trusted_review_workflow"
      && nonEmpty(value.sourceId)
      && Number.isInteger(value.evidenceVersion)
      && value.evidenceVersion > 0
      && nonEmpty(value.reviewedAt)
      && nonEmpty(value.policyVersion),
  );
}

function isPreservedProfile(profile: ExistingApprovalProfileSnapshot | null | undefined): boolean {
  if (!profile) return false;
  const status = String(profile.complianceStatus ?? "").trim().toLowerCase();
  const restriction = String(profile.restrictionState ?? "").trim().toLowerCase();
  return ["lite_verified", "enhanced_verified", "business_verified", "restricted", "rejected"].includes(status)
    || ["restricted", "suspended"].includes(restriction);
}

function targetMatchesPlan(request: ComplianceProfileApprovalCommandRequest): boolean {
  if (request.targetComplianceStatus === VERIFIED_TARGET_BY_PLAN[request.plan]) return true;
  return NON_VERIFIED_TARGETS.has(request.targetComplianceStatus);
}

function sourceMatchesPlan(request: ComplianceProfileApprovalCommandRequest): boolean {
  return request.sourceComplianceStatus === "needs_attention"
    || SOURCE_BY_PLAN[request.sourceComplianceStatus] === request.plan;
}

function requiresReason(target: ComplianceApprovalTargetState): boolean {
  return NON_VERIFIED_TARGETS.has(target);
}

function resolveNonOperationalState(
  target: ComplianceApprovalTargetState,
  outcome: ComplianceProfileApprovalCommandRequest["restrictionOutcome"],
): Pick<ComplianceProfileApprovalPayload, "activationStatus" | "restrictionState"> | null {
  const restrictionOutcome = outcome ?? "none";
  if (target !== "restricted" && restrictionOutcome !== "none") return null;
  if (target === "restricted" && restrictionOutcome === "suspended") {
    return { activationStatus: "suspended", restrictionState: "suspended" };
  }
  if (target === "restricted") {
    return { activationStatus: "restricted", restrictionState: "restricted" };
  }
  return { activationStatus: "test_mode", restrictionState: null };
}

/**
 * Builds a non-operational approval intent. A future service-role transaction
 * owns persistence; neither this core nor its facade queries or writes a DB.
 */
export function prepareComplianceProfileApprovalCommand(
  request: ComplianceProfileApprovalCommandRequest,
): ComplianceProfileApprovalCommandResult {
  if (!validIdentity(request.identity)) {
    return { kind: "rejected", diagnostics: [{ code: request.identity ? "approval_authority_untrusted" : "approval_identity_missing" }] };
  }
  if (!nonEmpty(request.approvalDecisionKey)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_decision_key_missing" }] };
  }
  const expectedProfileRowVersion = request.expectedProfileRowVersion;
  if (typeof expectedProfileRowVersion !== "number"
    || !Number.isInteger(expectedProfileRowVersion)
    || expectedProfileRowVersion <= 0) {
    return { kind: "rejected", diagnostics: [{ code: "approval_row_version_missing" }] };
  }
  if (!validReviewer(request.reviewer)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_reviewer_unauthorized" }] };
  }
  if (!request.evidence) {
    return { kind: "rejected", diagnostics: [{ code: "approval_evidence_missing" }] };
  }
  if (!validEvidence(request.evidence) || request.evidence.evidenceState === "incomplete") {
    return { kind: "rejected", diagnostics: [{ code: "approval_evidence_unsafe" }] };
  }
  if (request.evidence.sourceType !== EVIDENCE_SOURCE_BY_PLAN[request.plan]) {
    return { kind: "rejected", diagnostics: [{ code: "approval_evidence_plan_mismatch" }] };
  }
  if (!sourceMatchesPlan(request) || !targetMatchesPlan(request)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_source_target_mismatch" }] };
  }
  if (!nonEmpty(request.evidence.policyVersion)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_policy_version_missing" }] };
  }
  if (requiresReason(request.targetComplianceStatus) && !request.reasonCode) {
    return { kind: "rejected", diagnostics: [{ code: "approval_reason_code_required" }] };
  }
  if (request.reasonCode && !SAFE_REASON_CODES.has(request.reasonCode)) {
    return { kind: "rejected", diagnostics: [{ code: "approval_reason_code_unsafe" }] };
  }
  const nonOperationalState = resolveNonOperationalState(
    request.targetComplianceStatus,
    request.restrictionOutcome,
  );
  if (!nonOperationalState) {
    return { kind: "rejected", diagnostics: [{ code: "approval_restriction_outcome_invalid" }] };
  }
  if (isPreservedProfile(request.existingProfile)) {
    return { kind: "existing", diagnostics: [{ code: "approval_profile_preserved" }] };
  }

  return {
    kind: "prepared",
    payload: {
      merchantId: request.identity.merchantId.trim(),
      workspaceId: request.identity.workspaceId.trim(),
      approvalDecisionKey: request.approvalDecisionKey.trim(),
      expectedProfileRowVersion,
      planCode: request.plan,
      sourceComplianceStatus: request.sourceComplianceStatus,
      complianceStatus: request.targetComplianceStatus,
      activationStatus: nonOperationalState.activationStatus,
      restrictionState: nonOperationalState.restrictionState,
      reviewedBy: request.reviewer.reviewerId.trim(),
      reviewedAt: request.evidence.reviewedAt.trim(),
      reviewSourceType: request.evidence.sourceType,
      reviewSourceId: request.evidence.sourceId.trim(),
      evidenceVersion: request.evidence.evidenceVersion,
      policyVersion: request.evidence.policyVersion.trim(),
      reasonCode: request.reasonCode ?? null,
      merchantEntitlements: {
        canCollectPayments: false,
        canUseInstantSale: false,
        canUseReceivableSale: false,
        canUseStorefront: false,
        canActivateSettlement: false,
        canUseDepositBalance: false,
      },
    },
    diagnostics: [],
  };
}
