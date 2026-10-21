import type { SoloPlusCaseRecord, SoloPlusCaseEventRecord, SoloPlusCaseRequirementRecord } from "../../solo-plus/repository";
import type { PendingPlanPaymentRecord } from "../../services/plan-payment-recovery.service";
import { SOLO_PLUS_CASE_STATUSES, SOLO_PLUS_PAYMENT_STATUSES, SOLO_PLUS_REQUIRED_REQUIREMENTS, validateSoloPlusRequirementConsistency } from "../../solo-plus/state";
import {
  POLICY_DEFINITIONS, observationFinding, parsePolicyPlan, safeSource, safeTimestamp, safeMetadataReference, positiveVersion,
  type EvidenceFinding, type EvidenceObservation, type PolicyDefinition, type PolicyDiagnostic,
  type Projectability,
} from "./contract";
import {
  authorityFinding, beneficialOwnershipFinding, ongoingFinding, payoutFinding, riskFinding, screeningFindings,
  type AuthorityObservation, type BeneficialOwnershipObservation, type OngoingObservation,
  type PayoutObservation, type RiskObservation, type ScreeningObservation,
} from "./findings";

export interface CommonEvidenceInput {
  rawPlan: string | null;
  evaluatedAt: string | null;
  legacyVerificationStatus?: string | null;
  screening?: readonly ScreeningObservation[];
  risk?: RiskObservation | null;
  ongoingCdd?: OngoingObservation | null;
  payout?: PayoutObservation | null;
}

const LITE_CODES = [
  "legal_name", "email_contact", "phone", "bvn", "bvn_name_match", "selfie_face_match",
  "distinct_liveness", "nin", "government_id", "declared_address", "address_evidence",
  "activity_nature", "expected_transaction_profile", "manual_review",
] as const;
export type LiteEvidenceCode = typeof LITE_CODES[number];

const BUSINESS_CODES = [
  "legal_name", "registration_number", "registration_status", "registered_address",
  "operating_address", "tin", "activity_nature", "expected_transaction_profile",
  "directors", "shareholders_members", "partners", "trustees", "representatives",
  "signatories", "senior_management", "beneficial_owners", "controllers",
  "documents", "approved_volume", "manual_review",
] as const;
export type BusinessEvidenceCode = typeof BUSINESS_CODES[number];

export interface LiteEvidenceInput extends CommonEvidenceInput {
  evidence?: Partial<Record<LiteEvidenceCode, EvidenceObservation>>;
}

export interface BusinessEvidenceInput extends CommonEvidenceInput {
  rawEntityType?: string | null;
  evidence?: Partial<Record<BusinessEvidenceCode, EvidenceObservation>>;
  beneficialOwners?: readonly BeneficialOwnershipObservation[];
  authority?: readonly AuthorityObservation[];
}

export type CanonicalEntityClass = "registered_business_name" | "limited_liability_company" | "incorporated_trustee" | "limited_liability_partnership" | "limited_partnership" | "cooperative" | null;
export type EntityClassification = { rawEntityType: string | null; canonicalEntityClass: CanonicalEntityClass; status: "classified" | "ambiguous" | "unknown"; reasonCode: string };

/** Never infer that the raw sole_proprietorship UI option means unregistered. */
export function classifyBusinessEntity(raw: string | null | undefined): EntityClassification {
  const normalized = raw?.trim().toLowerCase() ?? "";
  const map: Record<string, Exclude<CanonicalEntityClass, null>> = {
    registered_business_name: "registered_business_name", ltd: "limited_liability_company",
    plc: "limited_liability_company", limited_liability_company: "limited_liability_company",
    incorporated_trustees: "incorporated_trustee", incorporated_trustee: "incorporated_trustee",
    llp: "limited_liability_partnership", lp: "limited_partnership", cooperative: "cooperative",
  };
  if (normalized === "sole_proprietorship") return { rawEntityType: normalized, canonicalEntityClass: null, status: "ambiguous", reasonCode: "sole_proprietorship_registration_ambiguous" };
  if (Object.prototype.hasOwnProperty.call(map, normalized)) return { rawEntityType: normalized, canonicalEntityClass: map[normalized], status: "classified", reasonCode: "entity_class_source_mapping" };
  return { rawEntityType: null, canonicalEntityClass: null, status: "unknown", reasonCode: "entity_class_unknown" };
}

export interface BusinessDiagnostic extends PolicyDiagnostic { entityClassification: EntityClassification }
export interface SoloPlusDiagnostic extends PolicyDiagnostic {
  caseSource: {
    caseId: string | null; merchantId: string | null; rowVersion: number | null;
    caseStatus: SoloPlusCaseRecord["caseStatus"] | "unknown"; paymentStatus: SoloPlusCaseRecord["paymentStatus"] | "unknown";
    paymentRecordId: string | null; reviewEventId: string | null; reviewerId: string | null;
    requirementsPolicyVersion: string | null; approvalPolicyVersion: string | null;
  };
}

function base(input: CommonEvidenceInput, policy: PolicyDefinition, findings: EvidenceFinding[], projectability: Projectability, reasonCodes: string[]): PolicyDiagnostic {
  const plan = parsePolicyPlan(input.rawPlan);
  const mismatchedPlan = plan.canonicalPlan !== policy.canonicalPlan;
  const evaluatedAt = safeTimestamp(input.evaluatedAt);
  return {
    policy, plan, evaluatedAt,
    projectability: mismatchedPlan ? "unprojectable_unknown_source" : !evaluatedAt ? "requires_shadow_reconciliation" : projectability,
    reasonCodes: [...(mismatchedPlan ? ["policy_plan_mismatch"] : []), ...(!evaluatedAt ? ["evaluation_time_invalid"] : []), ...reasonCodes],
    findings, screening: screeningFindings(input.screening, evaluatedAt),
    risk: riskFinding(input.risk, policy, evaluatedAt),
    ongoingCdd: ongoingFinding(input.ongoingCdd),
    payout: payoutFinding(input.payout, policy, evaluatedAt),
    beneficialOwners: [], authority: [], sourceAssurance: null,
  };
}

function evidenceFindings<C extends string>(codes: readonly C[], evidence: Partial<Record<C, EvidenceObservation>> | undefined, policy: PolicyDefinition, evaluatedAt: string | null): EvidenceFinding[] {
  return codes.map((code) => observationFinding(code, evidence?.[code], policy, evaluatedAt));
}

export function evaluateStarter(input: CommonEvidenceInput): PolicyDiagnostic {
  const policy = POLICY_DEFINITIONS.starter;
  return base(input, policy, [], "confidently_projectable", ["starter_offline_only", "historical_evidence_not_assurance"]);
}

export function evaluateSoloLite(input: LiteEvidenceInput): PolicyDiagnostic {
  const policy = POLICY_DEFINITIONS.solo_lite;
  const findings = evidenceFindings(LITE_CODES, input.evidence, policy, input.evaluatedAt);
  return base(input, policy, findings, "requires_manual_review", ["lite_policy_unapproved", ...(input.legacyVerificationStatus === "verified" ? ["legacy_verified_not_canonical_approval"] : [])]);
}

export function evaluateBusiness(input: BusinessEvidenceInput): BusinessDiagnostic {
  const policy = POLICY_DEFINITIONS.business;
  const entityClassification = classifyBusinessEntity(input.rawEntityType);
  const findings = evidenceFindings(BUSINESS_CODES, input.evidence, policy, input.evaluatedAt);
  const result = base(input, policy, findings, "requires_manual_review", [
    "business_policy_unapproved", entityClassification.reasonCode,
    ...(input.legacyVerificationStatus === "verified" ? ["legacy_verified_not_canonical_approval"] : []),
  ]);
  return {
    ...result, entityClassification,
    beneficialOwners: (input.beneficialOwners ?? []).map(beneficialOwnershipFinding),
    authority: (input.authority ?? []).map(authorityFinding),
  };
}

export interface SoloPlusProjectionInput extends CommonEvidenceInput {
  caseRecord: Pick<SoloPlusCaseRecord, "id" | "merchantId" | "onboardingSessionId" | "flowOrigin" | "sourcePlan" | "targetPlan" | "rowVersion" | "caseStatus" | "paymentStatus" | "paymentRecordId" | "requirementsPolicyVersion" | "approvedAt" | "approvedByAdminId">;
  /** Reader-supplied aggregate case version; this is not a new database column. */
  requirements: readonly (Pick<SoloPlusCaseRequirementRecord, "id" | "caseId" | "requirementCode" | "requirementState" | "evidenceSourceType" | "evidenceSourceId" | "evidenceReference" | "verificationLogId" | "originalCompletedAt" | "reuseDecisionAt" | "reuseReason" | "policyRuleApplied" | "reviewedByAdminId" | "reviewNote" | "completedAt"> & { sourceCaseVersion: number })[];
  paymentRecord?: Pick<PendingPlanPaymentRecord, "id" | "solo_plus_case_id" | "merchant_id" | "onboarding_session_id" | "payment_status" | "payment_purpose"> & { sourceCaseVersion: number };
  events: readonly Pick<SoloPlusCaseEventRecord, "id" | "caseId" | "eventType" | "policyVersion" | "actorType" | "actorId" | "createdAt" | "previousState" | "newState">[];
}

export function projectSoloPlus(input: SoloPlusProjectionInput): SoloPlusDiagnostic {
  const policy = POLICY_DEFINITIONS.solo_plus;
  const record = input.caseRecord;
  const evaluatedAt = safeTimestamp(input.evaluatedAt);
  const id = (value: string | null | undefined) => safeSource({ sourceType: "solo_plus_case", sourceId: value })?.sourceId ?? null;
  const caseId = id(record.id), merchantId = id(record.merchantId), paymentRecordId = id(record.paymentRecordId);
  const rowVersion = positiveVersion(record.rowVersion) ? record.rowVersion : null;
  const requirementsPolicyVersion = safeMetadataReference(record.requirementsPolicyVersion);
  const subject = safeSource({ sourceType: "solo_plus_case", sourceId: caseId, sourceVersion: rowVersion });
  const rootValid = !!caseId && !!merchantId && !!rowVersion && !!requirementsPolicyVersion && record.targetPlan === "solo_plus";
  const sameSnapshot = (parent: string, version: number) => rootValid && id(parent) === caseId && version === rowVersion;
  const counts = new Map<string, number>();
  for (const requirement of input.requirements) counts.set(requirement.requirementCode, (counts.get(requirement.requirementCode) ?? 0) + 1);
  const exactCodes = input.requirements.length === SOLO_PLUS_REQUIRED_REQUIREMENTS.length &&
    SOLO_PLUS_REQUIRED_REQUIREMENTS.every((code) => counts.get(code) === 1) &&
    new Set(input.requirements.map((entry) => id(entry.id))).size === SOLO_PLUS_REQUIRED_REQUIREMENTS.length;
  const findings = SOLO_PLUS_REQUIRED_REQUIREMENTS.map((code) => {
    const requirement = input.requirements.find((entry) => entry.requirementCode === code);
    const state = requirement?.requirementState;
    const approvedState = state === "passed" || state === "reused" || state === "waived";
    const provenance = state === "waived" ? id(requirement?.reviewedByAdminId)
      : id(requirement?.evidenceSourceId) || id(requirement?.verificationLogId);
    const consistent = requirement ? validateSoloPlusRequirementConsistency({
      code: requirement.requirementCode, state: requirement.requirementState,
      completedAt: requirement.completedAt, verificationLogId: requirement.verificationLogId,
      evidenceSourceId: requirement.evidenceSourceId, evidenceReference: requirement.evidenceReference,
      originalCompletedAt: requirement.originalCompletedAt, reuseDecisionAt: requirement.reuseDecisionAt,
      reuseReason: requirement.reuseReason, policyRuleApplied: requirement.policyRuleApplied,
      reviewedByAdminId: requirement.reviewedByAdminId, reviewNote: requirement.reviewNote,
    }).ok : false;
    const completedAt = safeTimestamp(requirement?.completedAt);
    const reuseAt = safeTimestamp(requirement?.reuseDecisionAt), originalAt = safeTimestamp(requirement?.originalCompletedAt);
    const coherentTime = !!completedAt && !!evaluatedAt && Date.parse(completedAt) <= Date.parse(evaluatedAt) &&
      (state !== "reused" || (!!reuseAt && !!originalAt && Date.parse(originalAt) <= Date.parse(reuseAt) && Date.parse(reuseAt) <= Date.parse(evaluatedAt)));
    const coherentSource = !!requirement && !!id(requirement.id) && sameSnapshot(requirement.caseId, requirement.sourceCaseVersion) &&
      [requirement.evidenceSourceId, requirement.verificationLogId, requirement.reviewedByAdminId].every((reference) => reference == null || !!id(reference));
    const status = !requirement ? "missing" : state === "failed" ? "failed" : counts.get(code) !== 1 ? "ambiguous" : approvedState && provenance && consistent && coherentSource && coherentTime ? "verified" : "needs_review";
    return {
      code, status, reasonCode: `solo_plus_requirement_${status}`,
      source: requirement ? safeSource({ sourceType: "solo_plus_requirement", sourceId: requirement.id, sourceVersion: requirement.sourceCaseVersion }) : null,
      subject, evaluatedAt, evidenceAt: completedAt,
      expiresAt: null, policyVersion: requirementsPolicyVersion,
    } satisfies EvidenceFinding;
  });
  const approvalEvents = input.events.filter((event) => event.eventType === "case_approved");
  const approvalEvent = approvalEvents.length === 1 ? approvalEvents[0] : null;
  const approvedAt = safeTimestamp(record.approvedAt), eventAt = safeTimestamp(approvalEvent?.createdAt);
  const reviewerId = id(record.approvedByAdminId);
  const coherentEvent = !!approvalEvent && !!id(approvalEvent.id) && id(approvalEvent.caseId) === caseId &&
    approvalEvent.actorType === "admin" && !!reviewerId && id(approvalEvent.actorId) === reviewerId &&
    approvalEvent.policyVersion === record.requirementsPolicyVersion && !!safeMetadataReference(approvalEvent.policyVersion) &&
    approvalEvent.newState?.caseStatus === "approved" && approvalEvent.newState?.rowVersion === rowVersion &&
    typeof approvalEvent.newState?.approvedByAdminId === "string" && id(approvalEvent.newState.approvedByAdminId) === reviewerId &&
    typeof approvalEvent.newState?.approvedAt === "string" && safeTimestamp(approvalEvent.newState.approvedAt) === approvedAt &&
    !!rowVersion && rowVersion > 1 && approvalEvent.previousState?.rowVersion === rowVersion - 1 &&
    approvalEvent.previousState?.caseStatus === "manual_review" &&
    !!eventAt && eventAt === approvedAt && !!evaluatedAt && Date.parse(eventAt) <= Date.parse(evaluatedAt);
  const payment = input.paymentRecord;
  const coherentFlow = record.flowOrigin === "upgrade" ? record.sourcePlan === "solo_lite" && record.onboardingSessionId === null && payment?.onboarding_session_id === null
    : record.flowOrigin === "onboarding" && record.sourcePlan === null && !!id(record.onboardingSessionId) && id(payment?.onboarding_session_id) === id(record.onboardingSessionId);
  const coherentPayment = !!payment && !!paymentRecordId && id(payment.id) === paymentRecordId && sameSnapshot(payment.solo_plus_case_id ?? "", payment.sourceCaseVersion) &&
    id(payment.merchant_id) === merchantId && coherentFlow && payment.payment_status === "successful" &&
    payment.payment_purpose === (record.flowOrigin === "upgrade" ? "plan_upgrade" : "plan_subscription");
  const accepted = rootValid && !!evaluatedAt && exactCodes && findings.every((finding) => finding.status === "verified") &&
    record.caseStatus === "approved" && record.paymentStatus === "paid" && coherentPayment && coherentEvent;
  // Case approval never supplies separate screening, risk, payout, BO, or limit conclusions.
  const result = base({ rawPlan: input.rawPlan, evaluatedAt }, policy, findings,
    accepted ? "confidently_projectable" : rootValid ? "requires_shadow_reconciliation" : "unprojectable_unknown_source",
    [accepted ? "accepted_solo_plus_case_source" : "solo_plus_source_incomplete"]);
  return {
    ...result, sourceAssurance: accepted && result.plan.canonicalPlan === "solo_plus" ? "enhanced_verified" : null,
    caseSource: {
      caseId, merchantId, rowVersion,
      caseStatus: SOLO_PLUS_CASE_STATUSES.includes(record.caseStatus) ? record.caseStatus : "unknown",
      paymentStatus: SOLO_PLUS_PAYMENT_STATUSES.includes(record.paymentStatus) ? record.paymentStatus : "unknown",
      paymentRecordId, reviewEventId: coherentEvent ? id(approvalEvent?.id) : null,
      reviewerId: coherentEvent ? reviewerId : null,
      requirementsPolicyVersion, approvalPolicyVersion: coherentEvent ? safeMetadataReference(approvalEvent?.policyVersion) : null,
    },
  };
}
