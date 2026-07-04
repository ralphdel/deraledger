import { type SoloPlusRequirementCode } from "./state";

export type SoloPlusEvidenceAssuranceLevel =
  | "basic"
  | "standard"
  | "enhanced";

export type SoloPlusEvidenceStatus =
  | "passed"
  | "failed"
  | "pending"
  | "revoked"
  | "invalidated";

export type SoloPlusIdentityMatch =
  | "match"
  | "mismatch"
  | "unknown"
  | "not_applicable";

export type SoloPlusEvidenceSubjectMatch =
  | "match"
  | "mismatch"
  | "unknown"
  | "not_applicable";

export type SoloPlusEvidenceSourceType =
  | "verification_log"
  | "merchant_document"
  | "settlement_account"
  | "manual_submission";

export type SoloPlusEvidenceCandidate = {
  evidenceId: string;
  merchantId: string;
  requirementCode: SoloPlusRequirementCode;
  sourceType: SoloPlusEvidenceSourceType;
  status: SoloPlusEvidenceStatus;
  assuranceLevel: SoloPlusEvidenceAssuranceLevel;
  verificationLogId?: string | null;
  sourceRowId?: string | null;
  evidenceReference?: string | null;
  providerReference?: string | null;
  completedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  revokedAt?: Date | string | null;
  invalidatedAt?: Date | string | null;
  identityMatch: SoloPlusIdentityMatch;
  subjectMatch: SoloPlusEvidenceSubjectMatch;
};

export type SoloPlusEvidenceReuseRule = {
  requirementCode: SoloPlusRequirementCode;
  allowReuse: boolean;
  allowedSourceTypes: readonly SoloPlusEvidenceSourceType[];
  minimumAssuranceLevel: SoloPlusEvidenceAssuranceLevel;
  maximumAgeDays: number;
  requireIdentityMatch: boolean;
  requireSubjectMatch: boolean;
  policyRuleCode: string;
};

export type SoloPlusEvidenceReusePolicy = {
  version: string;
  rules: readonly SoloPlusEvidenceReuseRule[];
};

export type SoloPlusEvidenceReuseOutcome =
  | "reusable"
  | "not_reusable"
  | "needs_review";

export type SoloPlusEvidenceReuseReasonCode =
  | "ELIGIBLE_UNDER_POLICY"
  | "POLICY_REUSE_DISABLED"
  | "POLICY_RULE_MISSING"
  | "MERCHANT_MISMATCH"
  | "REQUIREMENT_MISMATCH"
  | "SOURCE_TYPE_NOT_ALLOWED"
  | "EVIDENCE_NOT_PASSED"
  | "EVIDENCE_REVOKED"
  | "EVIDENCE_INVALIDATED"
  | "MISSING_COMPLETION_DATE"
  | "INVALID_COMPLETION_DATE"
  | "COMPLETION_DATE_IN_FUTURE"
  | "EVIDENCE_EXPIRED"
  | "INVALID_EXPIRY_DATE"
  | "EVIDENCE_TOO_OLD"
  | "MISSING_SOURCE_PROVENANCE"
  | "INSUFFICIENT_ASSURANCE"
  | "IDENTITY_MISMATCH"
  | "IDENTITY_MATCH_UNKNOWN"
  | "SUBJECT_MISMATCH"
  | "SUBJECT_MATCH_UNKNOWN";

export type SoloPlusEvidenceReuseDecision = {
  outcome: SoloPlusEvidenceReuseOutcome;
  evidenceId: string;
  requirementCode: SoloPlusRequirementCode;
  reasonCode: SoloPlusEvidenceReuseReasonCode;
  policyVersion: string;
  policyRuleApplied: string;
  evaluatedAt: string;
  assuranceLevel: SoloPlusEvidenceAssuranceLevel;
  sourceVerificationId?: string;
  sourceVerificationReference?: string;
  originalCompletedAt?: string;
  reuseDecisionAt?: string;
  reuseReason?: string;
};

export type SoloPlusEvidenceReusePolicyValidationIssue = {
  field: string;
  message: string;
};

export type SoloPlusEvidenceReusePolicyValidationResult =
  | { valid: true }
  | {
      valid: false;
      issues: readonly SoloPlusEvidenceReusePolicyValidationIssue[];
    };

export type SoloPlusEvidenceReuseErrorCode =
  | "SOLO_PLUS_REUSE_POLICY_INVALID"
  | "SOLO_PLUS_REUSE_POLICY_RULE_MISSING"
  | "SOLO_PLUS_REUSE_DUPLICATE_POLICY_RULE"
  | "SOLO_PLUS_REUSE_INVALID_DATE"
  | "SOLO_PLUS_REUSE_INVALID_EVIDENCE";

export class SoloPlusEvidenceReuseError extends Error {
  readonly code: SoloPlusEvidenceReuseErrorCode;
  readonly issues: readonly SoloPlusEvidenceReusePolicyValidationIssue[];

  constructor(
    code: SoloPlusEvidenceReuseErrorCode,
    message: string,
    issues: readonly SoloPlusEvidenceReusePolicyValidationIssue[] = [],
  ) {
    super(message);
    this.name = "SoloPlusEvidenceReuseError";
    this.code = code;
    this.issues = issues;
  }
}

export type EvaluateSoloPlusEvidenceReuseParams = {
  targetMerchantId: string;
  targetRequirementCode: SoloPlusRequirementCode;
  candidate: SoloPlusEvidenceCandidate;
  policy: SoloPlusEvidenceReusePolicy;
  evaluatedAt: Date | string;
};

export type EvaluateSoloPlusEvidenceCandidatesParams = {
  targetMerchantId: string;
  targetRequirementCode: SoloPlusRequirementCode;
  candidates: readonly SoloPlusEvidenceCandidate[];
  policy: SoloPlusEvidenceReusePolicy;
  evaluatedAt: Date | string;
};

const SOLO_PLUS_EVIDENCE_ASSURANCE_LEVELS = [
  "basic",
  "standard",
  "enhanced",
] as const;
;
const SOLO_PLUS_EVIDENCE_SOURCE_TYPES = [
  "verification_log",
  "merchant_document",
  "settlement_account",
  "manual_submission",
] as const;

const SOLO_PLUS_EVIDENCE_STATUSES = [
  "passed",
  "failed",
  "pending",
  "revoked",
  "invalidated",
] as const;

const SOLO_PLUS_IDENTITY_MATCHES = [
  "match",
  "mismatch",
  "unknown",
  "not_applicable",
] as const;

const SOLO_PLUS_SUBJECT_MATCHES = [
  "match",
  "mismatch",
  "unknown",
  "not_applicable",
] as const;

const SOLO_PLUS_REQUIREMENT_CODES = [
  "bvn",
  "selfie_liveness",
  "id_document",
  "proof_of_address",
  "settlement_account",
  "activity_profile",
] as const;

const ASSURANCE_RANK: Record<SoloPlusEvidenceAssuranceLevel, number> = {
  basic: 1,
  standard: 2,
  enhanced: 3,
};

const REQUIREMENT_CODE_SET = new Set<string>(SOLO_PLUS_REQUIREMENT_CODES);
const SOURCE_TYPE_SET = new Set<string>(SOLO_PLUS_EVIDENCE_SOURCE_TYPES);
const STATUS_SET = new Set<string>(SOLO_PLUS_EVIDENCE_STATUSES);
const ASSURANCE_LEVEL_SET = new Set<string>(SOLO_PLUS_EVIDENCE_ASSURANCE_LEVELS);
const IDENTITY_MATCH_SET = new Set<string>(SOLO_PLUS_IDENTITY_MATCHES);
const SUBJECT_MATCH_SET = new Set<string>(SOLO_PLUS_SUBJECT_MATCHES);

function hasNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isValidRequirementCode(value: string): value is SoloPlusRequirementCode {
  return REQUIREMENT_CODE_SET.has(value);
}

function isValidSourceType(value: string): value is SoloPlusEvidenceSourceType {
  return SOURCE_TYPE_SET.has(value);
}

function isValidEvidenceStatus(value: string): value is SoloPlusEvidenceStatus {
  return STATUS_SET.has(value);
}

function isValidAssuranceLevel(value: string): value is SoloPlusEvidenceAssuranceLevel {
  return ASSURANCE_LEVEL_SET.has(value);
}

function isValidIdentityMatch(value: string): value is SoloPlusIdentityMatch {
  return IDENTITY_MATCH_SET.has(value);
}

function isValidSubjectMatch(value: string): value is SoloPlusEvidenceSubjectMatch {
  return SUBJECT_MATCH_SET.has(value);
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

function parseUtcDate(
  value: Date | string | null | undefined,
): Date | null | "invalid" {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? "invalid" : new Date(value.toISOString());
  }
  if (!hasNonEmptyString(value)) {
    return "invalid";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "invalid" : parsed;
}

function parseRequiredDate(
  value: Date | string,
  field: string,
): Date {
  const parsed = parseUtcDate(value);
  if (parsed === null || parsed === "invalid") {
    throw new SoloPlusEvidenceReuseError(
      "SOLO_PLUS_REUSE_INVALID_DATE",
      `Invalid ${field} supplied to Solo Plus evidence reuse evaluation.`,
      [{ field, message: `Invalid ${field}.` }],
    );
  }
  return parsed;
}

function buildDecision(
  params: {
    candidate: SoloPlusEvidenceCandidate;
    policy: SoloPlusEvidenceReusePolicy;
    rule: SoloPlusEvidenceReuseRule | null;
    evaluatedAt: Date;
    outcome: SoloPlusEvidenceReuseOutcome;
    reasonCode: SoloPlusEvidenceReuseReasonCode;
  },
): SoloPlusEvidenceReuseDecision {
  const { candidate, policy, rule, evaluatedAt, outcome, reasonCode } = params;
  const completedAt = parseUtcDate(candidate.completedAt);
  return {
    outcome,
    evidenceId: candidate.evidenceId,
    requirementCode: params.rule?.requirementCode || candidate.requirementCode,
    reasonCode,
    policyVersion: policy.version,
    policyRuleApplied: rule?.policyRuleCode || "",
    evaluatedAt: toIsoString(evaluatedAt),
    assuranceLevel: candidate.assuranceLevel,
    sourceVerificationId: candidate.verificationLogId || undefined,
    sourceVerificationReference:
      candidate.providerReference ||
      candidate.evidenceReference ||
      candidate.sourceRowId ||
      candidate.verificationLogId ||
      undefined,
    originalCompletedAt: completedAt instanceof Date ? toIsoString(completedAt) : undefined,
    reuseDecisionAt: toIsoString(evaluatedAt),
    reuseReason: reasonCode === "ELIGIBLE_UNDER_POLICY"
      ? `Eligible under ${rule?.policyRuleCode || "policy"}.`
      : undefined,
  };
}

function provenanceAvailable(candidate: SoloPlusEvidenceCandidate): boolean {
  return (
    hasNonEmptyString(candidate.verificationLogId) ||
    hasNonEmptyString(candidate.sourceRowId) ||
    hasNonEmptyString(candidate.evidenceReference) ||
    hasNonEmptyString(candidate.providerReference)
  );
}

function ageInDaysMilliseconds(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function findRule(
  policy: SoloPlusEvidenceReusePolicy,
  requirementCode: SoloPlusRequirementCode,
): SoloPlusEvidenceReuseRule | null {
  return policy.rules.find((rule) => rule.requirementCode === requirementCode) || null;
}

export function getSoloPlusEvidenceAssuranceRank(
  level: SoloPlusEvidenceAssuranceLevel,
): number {
  return ASSURANCE_RANK[level];
}

export function meetsSoloPlusEvidenceAssurance(
  actual: SoloPlusEvidenceAssuranceLevel,
  minimum: SoloPlusEvidenceAssuranceLevel,
): boolean {
  return getSoloPlusEvidenceAssuranceRank(actual) >= getSoloPlusEvidenceAssuranceRank(minimum);
}

export function validateSoloPlusEvidenceReusePolicy(
  policy: SoloPlusEvidenceReusePolicy,
): SoloPlusEvidenceReusePolicyValidationResult {
  const issues: SoloPlusEvidenceReusePolicyValidationIssue[] = [];
  const seen = new Set<SoloPlusRequirementCode>();

  if (!hasNonEmptyString(policy.version)) {
    issues.push({ field: "version", message: "Policy version must be non-empty." });
  }

  for (const [index, rule] of policy.rules.entries()) {
    const path = `rules[${index}]`;

    if (!isValidRequirementCode(rule.requirementCode)) {
      issues.push({
        field: `${path}.requirementCode`,
        message: `Unknown requirement code: ${String(rule.requirementCode)}`,
      });
      continue;
    }

    if (seen.has(rule.requirementCode)) {
      issues.push({
        field: `${path}.requirementCode`,
        message: `Duplicate requirement rule: ${rule.requirementCode}`,
      });
    } else {
      seen.add(rule.requirementCode);
    }

    if (!hasNonEmptyString(rule.policyRuleCode)) {
      issues.push({
        field: `${path}.policyRuleCode`,
        message: "policyRuleCode must be non-empty.",
      });
    }

    if (!Number.isFinite(rule.maximumAgeDays) || !Number.isInteger(rule.maximumAgeDays) || rule.maximumAgeDays <= 0) {
      issues.push({
        field: `${path}.maximumAgeDays`,
        message: "maximumAgeDays must be a finite positive integer.",
      });
    }

    if (!isValidAssuranceLevel(rule.minimumAssuranceLevel)) {
      issues.push({
        field: `${path}.minimumAssuranceLevel`,
        message: `Unknown assurance level: ${String(rule.minimumAssuranceLevel)}`,
      });
    }

    if (rule.allowReuse && rule.allowedSourceTypes.length === 0) {
      issues.push({
        field: `${path}.allowedSourceTypes`,
        message: "Reusable rules must declare at least one allowed source type.",
      });
    }

    for (const [sourceIndex, sourceType] of rule.allowedSourceTypes.entries()) {
      if (!isValidSourceType(sourceType)) {
        issues.push({
          field: `${path}.allowedSourceTypes[${sourceIndex}]`,
          message: `Unknown source type: ${String(sourceType)}`,
        });
      }
    }
  }

  for (const requirementCode of SOLO_PLUS_REQUIREMENT_CODES) {
    if (!seen.has(requirementCode)) {
      issues.push({
        field: "rules",
        message: `Missing policy rule for requirement: ${requirementCode}`,
      });
    }
  }

  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

export function assertSoloPlusEvidenceReusePolicy(
  policy: SoloPlusEvidenceReusePolicy,
): void {
  const result = validateSoloPlusEvidenceReusePolicy(policy);
  if (result.valid === false) {
    const duplicateIssue = result.issues.find((issue) => issue.message.startsWith("Duplicate requirement rule:"));
    throw new SoloPlusEvidenceReuseError(
      duplicateIssue
        ? "SOLO_PLUS_REUSE_DUPLICATE_POLICY_RULE"
        : "SOLO_PLUS_REUSE_POLICY_INVALID",
      "Solo Plus evidence reuse policy is invalid.",
      result.issues,
    );
  }
}

export function evaluateSoloPlusEvidenceReuse(
  params: EvaluateSoloPlusEvidenceReuseParams,
): SoloPlusEvidenceReuseDecision {
  const evaluatedAt = parseRequiredDate(params.evaluatedAt, "evaluatedAt");
  assertSoloPlusEvidenceReusePolicy(params.policy);

  const rule = findRule(params.policy, params.targetRequirementCode);
  if (!rule) {
    throw new SoloPlusEvidenceReuseError(
      "SOLO_PLUS_REUSE_POLICY_RULE_MISSING",
      `Solo Plus evidence reuse policy rule missing for ${params.targetRequirementCode}.`,
      [{ field: "rules", message: `Missing policy rule for ${params.targetRequirementCode}.` }],
    );
  }

  const candidate = params.candidate;

  if (!hasNonEmptyString(candidate.evidenceId)) {
    throw new SoloPlusEvidenceReuseError(
      "SOLO_PLUS_REUSE_INVALID_EVIDENCE",
      "Solo Plus evidence candidate requires a non-empty evidenceId.",
      [{ field: "evidenceId", message: "evidenceId must be non-empty." }],
    );
  }

  if (
    !isValidRequirementCode(candidate.requirementCode) ||
    !isValidSourceType(candidate.sourceType) ||
    !isValidEvidenceStatus(candidate.status) ||
    !isValidAssuranceLevel(candidate.assuranceLevel) ||
    !isValidIdentityMatch(candidate.identityMatch) ||
    !isValidSubjectMatch(candidate.subjectMatch)
  ) {
    throw new SoloPlusEvidenceReuseError(
      "SOLO_PLUS_REUSE_INVALID_EVIDENCE",
      "Solo Plus evidence candidate contains an unsupported enum value.",
      [{ field: "candidate", message: "Candidate contains unsupported enum values." }],
    );
  }

  if (candidate.requirementCode !== params.targetRequirementCode) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "REQUIREMENT_MISMATCH",
    });
  }

  if (!rule.allowReuse) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "POLICY_REUSE_DISABLED",
    });
  }

  if (!hasNonEmptyString(params.targetMerchantId) || !hasNonEmptyString(candidate.merchantId) || candidate.merchantId !== params.targetMerchantId) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "MERCHANT_MISMATCH",
    });
  }

  if (!rule.allowedSourceTypes.includes(candidate.sourceType)) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "SOURCE_TYPE_NOT_ALLOWED",
    });
  }

  if (candidate.status === "revoked") {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "EVIDENCE_REVOKED",
    });
  }

  if (candidate.status === "invalidated") {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "EVIDENCE_INVALIDATED",
    });
  }

  if (candidate.status !== "passed") {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "EVIDENCE_NOT_PASSED",
    });
  }

  if (parseUtcDate(candidate.revokedAt) instanceof Date) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "EVIDENCE_REVOKED",
    });
  }

  if (parseUtcDate(candidate.invalidatedAt) instanceof Date) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "EVIDENCE_INVALIDATED",
    });
  }

  const completedAt = parseUtcDate(candidate.completedAt);
  if (completedAt === null) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "MISSING_COMPLETION_DATE",
    });
  }
  if (completedAt === "invalid") {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "INVALID_COMPLETION_DATE",
    });
  }
  if (completedAt.getTime() > evaluatedAt.getTime()) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "COMPLETION_DATE_IN_FUTURE",
    });
  }

  const expiresAt = parseUtcDate(candidate.expiresAt);
  if (expiresAt === "invalid") {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "INVALID_EXPIRY_DATE",
    });
  }
  if (expiresAt instanceof Date && expiresAt.getTime() < evaluatedAt.getTime()) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "EVIDENCE_EXPIRED",
    });
  }

  const ageMs = evaluatedAt.getTime() - completedAt.getTime();
  if (ageMs > ageInDaysMilliseconds(rule.maximumAgeDays)) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "EVIDENCE_TOO_OLD",
    });
  }

  if (!provenanceAvailable(candidate)) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "MISSING_SOURCE_PROVENANCE",
    });
  }

  if (!meetsSoloPlusEvidenceAssurance(candidate.assuranceLevel, rule.minimumAssuranceLevel)) {
    return buildDecision({
      candidate,
      policy: params.policy,
      rule,
      evaluatedAt,
      outcome: "not_reusable",
      reasonCode: "INSUFFICIENT_ASSURANCE",
    });
  }

  if (rule.requireIdentityMatch) {
    if (candidate.identityMatch === "mismatch") {
      return buildDecision({
        candidate,
        policy: params.policy,
        rule,
        evaluatedAt,
        outcome: "not_reusable",
        reasonCode: "IDENTITY_MISMATCH",
      });
    }
    if (candidate.identityMatch === "unknown" || candidate.identityMatch === "not_applicable") {
      return buildDecision({
        candidate,
        policy: params.policy,
        rule,
        evaluatedAt,
        outcome: "needs_review",
        reasonCode: "IDENTITY_MATCH_UNKNOWN",
      });
    }
  }

  if (rule.requireSubjectMatch) {
    if (candidate.subjectMatch === "mismatch") {
      return buildDecision({
        candidate,
        policy: params.policy,
        rule,
        evaluatedAt,
        outcome: "not_reusable",
        reasonCode: "SUBJECT_MISMATCH",
      });
    }
    if (candidate.subjectMatch === "unknown" || candidate.subjectMatch === "not_applicable") {
      return buildDecision({
        candidate,
        policy: params.policy,
        rule,
        evaluatedAt,
        outcome: "needs_review",
        reasonCode: "SUBJECT_MATCH_UNKNOWN",
      });
    }
  }

  return buildDecision({
    candidate,
    policy: params.policy,
    rule,
    evaluatedAt,
    outcome: "reusable",
    reasonCode: "ELIGIBLE_UNDER_POLICY",
  });
}

export function evaluateSoloPlusEvidenceCandidates(
  params: EvaluateSoloPlusEvidenceCandidatesParams,
): SoloPlusEvidenceReuseDecision[] {
  return params.candidates.map((candidate) =>
    evaluateSoloPlusEvidenceReuse({
      targetMerchantId: params.targetMerchantId,
      targetRequirementCode: params.targetRequirementCode,
      candidate,
      policy: params.policy,
      evaluatedAt: params.evaluatedAt,
    }),
  );
}

export function selectBestReusableSoloPlusEvidence(
  decisions: readonly SoloPlusEvidenceReuseDecision[],
): SoloPlusEvidenceReuseDecision | null {
  const reusable = decisions.filter((decision) => decision.outcome === "reusable");
  if (reusable.length === 0) {
    return null;
  }

  const sorted = [...reusable].sort((left, right) => {
    const assuranceDelta =
      getSoloPlusEvidenceAssuranceRank(right.assuranceLevel) -
      getSoloPlusEvidenceAssuranceRank(left.assuranceLevel);
    if (assuranceDelta !== 0) {
      return assuranceDelta;
    }

    const leftCompleted = parseUtcDate(left.originalCompletedAt);
    const rightCompleted = parseUtcDate(right.originalCompletedAt);
    const leftMs = leftCompleted instanceof Date ? leftCompleted.getTime() : -Infinity;
    const rightMs = rightCompleted instanceof Date ? rightCompleted.getTime() : -Infinity;
    if (rightMs !== leftMs) {
      return rightMs - leftMs;
    }

    return left.evidenceId.localeCompare(right.evidenceId);
  });

  return sorted[0];
}
