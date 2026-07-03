export type SoloPlusCaseStatus =
  | "draft"
  | "awaiting_payment"
  | "verification_pending"
  | "manual_review"
  | "approved"
  | "rejected"
  | "cancelled";

export type SoloPlusPaymentStatus =
  | "pending"
  | "paid"
  | "failed";

export type SoloPlusRefundStatus =
  | "none"
  | "review_required"
  | "approved"
  | "processing"
  | "completed"
  | "failed";

export type SoloPlusRequirementCode =
  | "bvn"
  | "selfie_liveness"
  | "id_document"
  | "proof_of_address"
  | "settlement_account"
  | "activity_profile";

export type SoloPlusRequirementState =
  | "not_started"
  | "pending"
  | "processing"
  | "passed"
  | "failed"
  | "needs_review"
  | "reused"
  | "waived";

export type SoloPlusDomainErrorCode =
  | "SOLO_PLUS_INVALID_CASE_TRANSITION"
  | "SOLO_PLUS_REOPEN_REQUIRED"
  | "SOLO_PLUS_TERMINAL_CASE"
  | "SOLO_PLUS_INVALID_REQUIREMENT_TRANSITION"
  | "SOLO_PLUS_CASE_INCONSISTENT"
  | "SOLO_PLUS_REQUIREMENT_INCONSISTENT"
  | "SOLO_PLUS_REQUIREMENTS_INCOMPLETE"
  | "SOLO_PLUS_DUPLICATE_REQUIREMENT";

export type SoloPlusValidationIssue = {
  field: string;
  message: string;
};

export class SoloPlusDomainError extends Error {
  readonly code: SoloPlusDomainErrorCode;
  readonly issues: readonly SoloPlusValidationIssue[];

  constructor(
    code: SoloPlusDomainErrorCode,
    message: string,
    issues: readonly SoloPlusValidationIssue[] = [],
  ) {
    super(message);
    this.name = "SoloPlusDomainError";
    this.code = code;
    this.issues = issues;
  }
}

export type SoloPlusCaseStateSnapshot = {
  caseStatus: SoloPlusCaseStatus;
  paymentStatus: SoloPlusPaymentStatus;
  refundStatus: SoloPlusRefundStatus;
  approvedAt?: Date | string | null;
  approvedByAdminId?: string | null;
  rejectedAt?: Date | string | null;
  rejectedByAdminId?: string | null;
  rejectionReason?: string | null;
};

export type SoloPlusRequirementSnapshot = {
  code: SoloPlusRequirementCode;
  state: SoloPlusRequirementState;
  completedAt?: Date | string | null;
  verificationLogId?: string | null;
  evidenceSourceId?: string | null;
  evidenceReference?: string | null;
  originalCompletedAt?: Date | string | null;
  reuseDecisionAt?: Date | string | null;
  reuseReason?: string | null;
  policyRuleApplied?: string | null;
  reviewedByAdminId?: string | null;
  reviewNote?: string | null;
};

export type SoloPlusRequirementLike = {
  code: SoloPlusRequirementCode | string;
  state: SoloPlusRequirementState | string;
};

export type SoloPlusValidationSuccess = {
  ok: true;
};

export type SoloPlusValidationFailure = {
  ok: false;
  issues: readonly SoloPlusValidationIssue[];
};

export type SoloPlusValidationResult =
  | SoloPlusValidationSuccess
  | SoloPlusValidationFailure;

export const SOLO_PLUS_CASE_STATUSES = [
  "draft",
  "awaiting_payment",
  "verification_pending",
  "manual_review",
  "approved",
  "rejected",
  "cancelled",
] as const;

export const SOLO_PLUS_PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
] as const;

export const SOLO_PLUS_REFUND_STATUSES = [
  "none",
  "review_required",
  "approved",
  "processing",
  "completed",
  "failed",
] as const;

export const SOLO_PLUS_REQUIREMENT_CODES = [
  "bvn",
  "selfie_liveness",
  "id_document",
  "proof_of_address",
  "settlement_account",
  "activity_profile",
] as const;

export const SOLO_PLUS_REQUIREMENT_STATES = [
  "not_started",
  "pending",
  "processing",
  "passed",
  "failed",
  "needs_review",
  "reused",
  "waived",
] as const;

export const SOLO_PLUS_REQUIRED_REQUIREMENTS = [
  "bvn",
  "selfie_liveness",
  "id_document",
  "proof_of_address",
  "settlement_account",
  "activity_profile",
] as const;

const CASE_STATUS_SET = new Set<string>(SOLO_PLUS_CASE_STATUSES);
const REQUIREMENT_CODE_SET = new Set<string>(SOLO_PLUS_REQUIREMENT_CODES);
const REQUIREMENT_STATE_SET = new Set<string>(SOLO_PLUS_REQUIREMENT_STATES);
const SATISFIED_REQUIREMENT_STATE_SET = new Set<SoloPlusRequirementState>([
  "passed",
  "reused",
  "waived",
]);

const CASE_TRANSITIONS: Record<SoloPlusCaseStatus, readonly SoloPlusCaseStatus[]> = {
  draft: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["verification_pending", "cancelled"],
  verification_pending: ["manual_review", "rejected", "cancelled"],
  manual_review: ["approved", "rejected", "verification_pending", "cancelled"],
  approved: [],
  rejected: [],
  cancelled: [],
};

const REQUIREMENT_TRANSITIONS: Record<
  SoloPlusRequirementState,
  readonly SoloPlusRequirementState[]
> = {
  not_started: ["pending", "reused", "waived"],
  pending: ["processing", "needs_review", "failed", "reused", "waived"],
  processing: ["passed", "failed", "needs_review"],
  failed: ["pending", "processing", "needs_review", "waived"],
  needs_review: ["pending", "processing", "passed", "failed", "reused", "waived"],
  passed: [],
  reused: [],
  waived: [],
};

function hasValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hasTimestamp(value: Date | string | null | undefined): boolean {
  if (value instanceof Date) {
    return !Number.isNaN(value.valueOf());
  }
  return hasValue(value);
}

function duplicateRequirementError(code: string) {
  return new SoloPlusDomainError(
    "SOLO_PLUS_DUPLICATE_REQUIREMENT",
    `Duplicate Solo Plus requirement code: ${code}`,
    [{ field: "code", message: `Duplicate requirement code: ${code}` }],
  );
}

export function isSoloPlusCaseStatus(value: string): value is SoloPlusCaseStatus {
  return CASE_STATUS_SET.has(value);
}

export function isSoloPlusRequirementCode(value: string): value is SoloPlusRequirementCode {
  return REQUIREMENT_CODE_SET.has(value);
}

export function isSoloPlusRequirementState(value: string): value is SoloPlusRequirementState {
  return REQUIREMENT_STATE_SET.has(value);
}

export function isTerminalSoloPlusCaseStatus(status: SoloPlusCaseStatus): boolean {
  return status === "approved" || status === "rejected" || status === "cancelled";
}

export function canTransitionSoloPlusCase(
  from: SoloPlusCaseStatus,
  to: SoloPlusCaseStatus,
): boolean {
  return CASE_TRANSITIONS[from].includes(to);
}

export function assertSoloPlusCaseTransition(
  from: SoloPlusCaseStatus,
  to: SoloPlusCaseStatus,
): void {
  if (from === "rejected" && to === "verification_pending") {
    throw new SoloPlusDomainError(
      "SOLO_PLUS_REOPEN_REQUIRED",
      "Rejected Solo Plus cases require the explicit reopen helper.",
      [{ field: "caseStatus", message: "Use explicit reopen helper for rejected cases." }],
    );
  }

  if (!canTransitionSoloPlusCase(from, to)) {
    const code = isTerminalSoloPlusCaseStatus(from)
      ? "SOLO_PLUS_TERMINAL_CASE"
      : "SOLO_PLUS_INVALID_CASE_TRANSITION";
    throw new SoloPlusDomainError(
      code,
      `Invalid Solo Plus case transition from ${from} to ${to}.`,
      [{ field: "caseStatus", message: `Transition ${from} -> ${to} is not allowed.` }],
    );
  }
}

export function canReopenRejectedSoloPlusCase(status: SoloPlusCaseStatus): boolean {
  return status === "rejected";
}

export function assertSoloPlusReopenAllowed(status: SoloPlusCaseStatus): void {
  if (status === "approved" || status === "cancelled") {
    throw new SoloPlusDomainError(
      "SOLO_PLUS_TERMINAL_CASE",
      `Solo Plus case status ${status} cannot be reopened.`,
      [{ field: "caseStatus", message: `${status} is terminal.` }],
    );
  }
  if (status !== "rejected") {
    throw new SoloPlusDomainError(
      "SOLO_PLUS_REOPEN_REQUIRED",
      `Solo Plus case status ${status} does not support reopen.`,
      [{ field: "caseStatus", message: "Only rejected cases can be reopened." }],
    );
  }
}

export function isTerminalSoloPlusRequirementState(
  state: SoloPlusRequirementState,
): boolean {
  return SATISFIED_REQUIREMENT_STATE_SET.has(state);
}

export function isSatisfiedSoloPlusRequirementState(
  state: SoloPlusRequirementState,
): boolean {
  return SATISFIED_REQUIREMENT_STATE_SET.has(state);
}

export function canTransitionSoloPlusRequirement(
  from: SoloPlusRequirementState,
  to: SoloPlusRequirementState,
): boolean {
  return REQUIREMENT_TRANSITIONS[from].includes(to);
}

export function assertSoloPlusRequirementTransition(
  from: SoloPlusRequirementState,
  to: SoloPlusRequirementState,
): void {
  if (!canTransitionSoloPlusRequirement(from, to)) {
    throw new SoloPlusDomainError(
      "SOLO_PLUS_INVALID_REQUIREMENT_TRANSITION",
      `Invalid Solo Plus requirement transition from ${from} to ${to}.`,
      [{ field: "state", message: `Transition ${from} -> ${to} is not allowed.` }],
    );
  }
}

export function validateSoloPlusCaseConsistency(
  snapshot: SoloPlusCaseStateSnapshot,
): SoloPlusValidationResult {
  const issues: SoloPlusValidationIssue[] = [];
  const isApproved = snapshot.caseStatus === "approved";
  const isRejected = snapshot.caseStatus === "rejected";
  const isCancelled = snapshot.caseStatus === "cancelled";

  if (isApproved) {
    if (snapshot.paymentStatus !== "paid") {
      issues.push({ field: "paymentStatus", message: "Approved cases must be paid." });
    }
    if (snapshot.refundStatus !== "none") {
      issues.push({ field: "refundStatus", message: "Approved cases must have refund status none." });
    }
    if (!hasTimestamp(snapshot.approvedAt)) {
      issues.push({ field: "approvedAt", message: "Approved cases require approvedAt." });
    }
    if (!hasValue(snapshot.approvedByAdminId)) {
      issues.push({
        field: "approvedByAdminId",
        message: "Approved cases require approvedByAdminId.",
      });
    }
  } else if (snapshot.approvedAt != null || snapshot.approvedByAdminId != null) {
    issues.push({
      field: "approvedState",
      message: "Non-approved cases must not carry approval fields.",
    });
  }

  if (isRejected) {
    if (!hasTimestamp(snapshot.rejectedAt)) {
      issues.push({ field: "rejectedAt", message: "Rejected cases require rejectedAt." });
    }
    if (!hasValue(snapshot.rejectedByAdminId)) {
      issues.push({
        field: "rejectedByAdminId",
        message: "Rejected cases require rejectedByAdminId.",
      });
    }
    if (!hasValue(snapshot.rejectionReason)) {
      issues.push({
        field: "rejectionReason",
        message: "Rejected cases require a non-empty rejection reason.",
      });
    }
    if (snapshot.paymentStatus === "paid" && snapshot.refundStatus === "none") {
      issues.push({
        field: "refundStatus",
        message: "Paid rejected cases require refund review state.",
      });
    }
  } else if (
    snapshot.rejectedAt != null ||
    snapshot.rejectedByAdminId != null ||
    snapshot.rejectionReason != null
  ) {
    issues.push({
      field: "rejectedState",
      message: "Non-rejected cases must not carry rejection fields.",
    });
  }

  if (isCancelled && snapshot.paymentStatus === "paid" && snapshot.refundStatus === "none") {
    issues.push({
      field: "refundStatus",
      message: "Paid cancelled cases require refund review state.",
    });
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function assertSoloPlusCaseConsistency(
  snapshot: SoloPlusCaseStateSnapshot,
): void {
  const result = validateSoloPlusCaseConsistency(snapshot);
  if (result.ok === false) {
    throw new SoloPlusDomainError(
      "SOLO_PLUS_CASE_INCONSISTENT",
      "Solo Plus case snapshot is inconsistent.",
      result.issues,
    );
  }
}

export function validateSoloPlusRequirementConsistency(
  requirement: SoloPlusRequirementSnapshot,
): SoloPlusValidationResult {
  const issues: SoloPlusValidationIssue[] = [];

  if (requirement.state === "passed" && !hasTimestamp(requirement.completedAt)) {
    issues.push({ field: "completedAt", message: "Passed requirements require completedAt." });
  }

  if (requirement.state === "reused") {
    if (!hasTimestamp(requirement.completedAt)) {
      issues.push({ field: "completedAt", message: "Reused requirements require completedAt." });
    }
    if (!hasTimestamp(requirement.originalCompletedAt)) {
      issues.push({
        field: "originalCompletedAt",
        message: "Reused requirements require originalCompletedAt.",
      });
    }
    if (!hasTimestamp(requirement.reuseDecisionAt)) {
      issues.push({
        field: "reuseDecisionAt",
        message: "Reused requirements require reuseDecisionAt.",
      });
    }
    if (!hasValue(requirement.reuseReason)) {
      issues.push({ field: "reuseReason", message: "Reused requirements require reuseReason." });
    }
    if (!hasValue(requirement.policyRuleApplied)) {
      issues.push({
        field: "policyRuleApplied",
        message: "Reused requirements require policyRuleApplied.",
      });
    }
    if (
      !hasValue(requirement.verificationLogId) &&
      !hasValue(requirement.evidenceSourceId) &&
      !hasValue(requirement.evidenceReference)
    ) {
      issues.push({
        field: "provenance",
        message: "Reused requirements require at least one provenance reference.",
      });
    }
  }

  if (requirement.state === "waived") {
    if (!hasTimestamp(requirement.completedAt)) {
      issues.push({ field: "completedAt", message: "Waived requirements require completedAt." });
    }
    if (!hasValue(requirement.reviewedByAdminId)) {
      issues.push({
        field: "reviewedByAdminId",
        message: "Waived requirements require reviewedByAdminId.",
      });
    }
    if (!hasValue(requirement.reviewNote)) {
      issues.push({ field: "reviewNote", message: "Waived requirements require reviewNote." });
    }
    if (!hasValue(requirement.policyRuleApplied)) {
      issues.push({
        field: "policyRuleApplied",
        message: "Waived requirements require policyRuleApplied.",
      });
    }
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function assertSoloPlusRequirementConsistency(
  requirement: SoloPlusRequirementSnapshot,
): void {
  const result = validateSoloPlusRequirementConsistency(requirement);
  if (result.ok === false) {
    throw new SoloPlusDomainError(
      "SOLO_PLUS_REQUIREMENT_INCONSISTENT",
      "Solo Plus requirement snapshot is inconsistent.",
      result.issues,
    );
  }
}

function normalizeRequirementMap(
  requirements: readonly SoloPlusRequirementLike[],
): Map<SoloPlusRequirementCode, SoloPlusRequirementState> {
  const map = new Map<SoloPlusRequirementCode, SoloPlusRequirementState>();

  for (const requirement of requirements) {
    if (!isSoloPlusRequirementCode(requirement.code)) {
      throw new SoloPlusDomainError(
        "SOLO_PLUS_REQUIREMENTS_INCOMPLETE",
        `Unknown Solo Plus requirement code: ${String(requirement.code)}`,
        [{ field: "code", message: `Unknown requirement code: ${String(requirement.code)}` }],
      );
    }
    if (!isSoloPlusRequirementState(requirement.state)) {
      throw new SoloPlusDomainError(
        "SOLO_PLUS_REQUIREMENTS_INCOMPLETE",
        `Unknown Solo Plus requirement state: ${String(requirement.state)}`,
        [{ field: "state", message: `Unknown requirement state: ${String(requirement.state)}` }],
      );
    }
    if (map.has(requirement.code)) {
      throw duplicateRequirementError(requirement.code);
    }
    map.set(requirement.code, requirement.state);
  }

  return map;
}

export function getMissingSoloPlusRequirements(
  requirements: readonly SoloPlusRequirementLike[],
): SoloPlusRequirementCode[] {
  const requirementMap = normalizeRequirementMap(requirements);
  const missing: SoloPlusRequirementCode[] = [];

  for (const code of SOLO_PLUS_REQUIRED_REQUIREMENTS) {
    const state = requirementMap.get(code);
    if (!state || !isSatisfiedSoloPlusRequirementState(state)) {
      missing.push(code);
    }
  }

  return missing;
}

export function areAllSoloPlusRequirementsSatisfied(
  requirements: readonly SoloPlusRequirementLike[],
): boolean {
  return getMissingSoloPlusRequirements(requirements).length === 0;
}
