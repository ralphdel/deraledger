import {
  observationFinding, safeSource, safeTimestamp, safeMetadataReference, safePolicyVersion, safeObservedStatus, hasProvenance,
  type AuthorityFinding, type BeneficialOwnershipFinding, type EvidenceObservation,
  type OngoingCddFinding, type OngoingCddStatus, type OngoingTrigger,
  type PayoutFinding, type PolicyDefinition, type RiskFinding,
  type ScreeningDisposition, type ScreeningFinding, type ScreeningType,
  type SourceReference, type SubjectRole,
} from "./contract";

export interface ScreeningObservation {
  type: ScreeningType;
  disposition: ScreeningDisposition;
  subject?: SourceReference | null;
  source?: SourceReference | null;
  listVersion?: string | null;
  screenedAt?: string | null;
  nextReviewDue?: string | null;
  reviewer?: SourceReference | null;
}

const SCREENING_DISPOSITIONS = new Set<ScreeningDisposition>(["not_screened", "clear", "possible_match", "confirmed_match", "resolved_false_positive", "needs_review"]);
export function screeningFindings(observations: readonly ScreeningObservation[] | null | undefined, evaluatedAt: string | null = null): ScreeningFinding[] {
  const evaluationTime = safeTimestamp(evaluatedAt);
  return (["sanctions", "pep", "adverse_media"] as const).map((type) => {
    const matches = observations?.filter((entry) => entry.type === type) ?? [];
    const entry = matches.length === 1 ? matches[0] : null;
    const listVersion = safeMetadataReference(entry?.listVersion);
    const source = safeSource(entry?.source), subject = safeSource(entry?.subject), reviewer = safeSource(entry?.reviewer);
    const screenedAt = safeTimestamp(entry?.screenedAt);
    const hasProvenScreening = source?.sourceType === "screening" && hasProvenance(source) && hasProvenance(subject) &&
      !!listVersion && !!screenedAt && !!evaluationTime && Date.parse(screenedAt) <= Date.parse(evaluationTime) &&
      (entry?.disposition !== "resolved_false_positive" || (reviewer?.sourceType === "review" && hasProvenance(reviewer)));
    const disposition = matches.length > 1 ? "needs_review" : !entry || entry.disposition === "not_screened" ? "not_screened"
      : !hasProvenScreening || !SCREENING_DISPOSITIONS.has(entry.disposition) ? "needs_review" : entry.disposition;
    return {
      type, disposition,
      status: disposition === "clear" || disposition === "resolved_false_positive" ? "verified"
        : disposition === "confirmed_match" ? type === "sanctions" ? "failed" : "needs_review"
        : disposition === "possible_match" || disposition === "needs_review" ? "needs_review" : "unknown",
      subject: hasProvenScreening ? subject : null, source: hasProvenScreening ? source : null,
      listVersion: hasProvenScreening ? listVersion : null, screenedAt: hasProvenScreening ? screenedAt : null,
      nextReviewDue: hasProvenScreening ? safeTimestamp(entry?.nextReviewDue) : null, reviewer: hasProvenScreening ? reviewer : null,
      reasonCode: matches.length > 1 ? "screening_ambiguous" : entry && !hasProvenScreening ? "screening_provenance_missing" : `screening_${disposition}`,
    };
  });
}

export interface RiskObservation {
  rating: "low" | "medium" | "high" | "unknown";
  factors?: readonly string[];
  source?: SourceReference | null;
  nextReviewDue?: string | null;
  reviewRequired?: boolean;
}

const RISK_FACTORS = new Set(["provider_review", "identity_mismatch", "registry_change", "ownership_change", "screening_hit", "activity_mismatch", "manual_review"]);
export function riskFinding(input: RiskObservation | null | undefined, policy: PolicyDefinition, evaluatedAt: string | null): RiskFinding {
  const source = safeSource(input?.source), evaluationTime = safeTimestamp(evaluatedAt), policyVersion = safePolicyVersion(policy);
  const hasSource = source?.sourceType === "risk_review" && hasProvenance(source) && !!evaluationTime && !!policyVersion;
  const rating = hasSource && (input?.rating === "low" || input?.rating === "medium" || input?.rating === "high") ? input.rating : "unknown";
  return {
    rating, factors: (input?.factors ?? []).filter((factor) => RISK_FACTORS.has(factor)),
    source, evaluatedAt: evaluationTime, nextReviewDue: safeTimestamp(input?.nextReviewDue),
    reviewRequired: rating === "unknown" || rating === "high" || input?.reviewRequired === true,
    policyVersion,
  };
}

export interface OngoingObservation {
  status: OngoingCddStatus;
  triggers?: readonly OngoingTrigger[];
  source?: SourceReference | null;
  nextReviewDue?: string | null;
}

const ONGOING_TRIGGERS = new Set<OngoingTrigger>(["registry_status_change", "director_change", "ownership_change", "representative_change", "payout_account_change", "provider_mapping_change", "evidence_expiry", "evidence_revocation", "screening_change", "risk_change", "expected_activity_change"]);
const ONGOING_STATUSES = new Set<OngoingCddStatus>(["current", "review_due", "evidence_changed", "revoked", "unknown", "needs_review"]);
export function ongoingFinding(input: OngoingObservation | null | undefined): OngoingCddFinding {
  return {
    status: input && ONGOING_STATUSES.has(input.status) ? input.status : "unknown",
    triggers: (input?.triggers ?? []).filter((trigger) => ONGOING_TRIGGERS.has(trigger)),
    source: safeSource(input?.source), nextReviewDue: safeTimestamp(input?.nextReviewDue),
  };
}

export interface PayoutObservation {
  account?: EvidenceObservation | null;
  ownership?: EvidenceObservation | null;
  providerMapping?: EvidenceObservation | null;
}
export function payoutFinding(input: PayoutObservation | null | undefined, policy: PolicyDefinition, evaluatedAt: string | null): PayoutFinding {
  return {
    accountEvidence: observationFinding("payout_account", input?.account, policy, evaluatedAt),
    ownershipRelationship: observationFinding("payout_ownership", input?.ownership, policy, evaluatedAt),
    providerMapping: observationFinding("provider_settlement_mapping", input?.providerMapping, policy, evaluatedAt),
  };
}

export interface BeneficialOwnershipObservation {
  subject?: SourceReference | null;
  entity?: SourceReference | null;
  roles?: readonly SubjectRole[];
  directPercent?: number | null;
  indirectPercent?: number | null;
  votingPercent?: number | null;
  chain?: readonly SourceReference[];
  controlBasis?: BeneficialOwnershipFinding["controlBasis"];
  appointmentControl?: boolean | null;
  significantInfluence?: boolean | null;
  evidence?: readonly SourceReference[];
  verification?: BeneficialOwnershipFinding["verification"];
}

const SUBJECT_ROLES = new Set<SubjectRole>(["merchant_account", "individual_merchant", "legal_entity", "workspace_owner", "team_member", "director", "partner", "trustee", "authorised_representative", "authorised_signatory", "senior_management", "shareholder_member", "beneficial_owner", "controller"]);
const CONTROL_BASES = new Set<BeneficialOwnershipFinding["controlBasis"]>(["ownership", "voting", "appointment_removal", "significant_influence", "unknown"]);
function percent(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function beneficialOwnershipFinding(input: BeneficialOwnershipObservation): BeneficialOwnershipFinding {
  const evidence = (input.evidence ?? []).map(safeSource).filter((value): value is SourceReference =>
    hasProvenance(value) && (value?.sourceType === "review" || value?.sourceType === "registry_snapshot" || value?.sourceType === "document"));
  const subject = safeSource(input.subject), entity = safeSource(input.entity);
  const direct = percent(input.directPercent);
  const indirect = percent(input.indirectPercent);
  const voting = percent(input.votingPercent);
  const hasControlEvidence = direct !== null || indirect !== null || voting !== null || typeof input.appointmentControl === "boolean" || typeof input.significantInfluence === "boolean";
  const claimedVerification = safeObservedStatus(input.verification);
  const substantiated = hasProvenance(subject) && hasProvenance(entity) &&
    (subject?.sourceType !== entity?.sourceType || subject?.sourceId !== entity?.sourceId) &&
    evidence.length > 0 && hasControlEvidence;
  const verification = claimedVerification === "failed" || claimedVerification === "rejected" ? "failed"
    : claimedVerification === "verified" || claimedVerification === "passed" ? substantiated ? "verified" : "needs_review"
    : claimedVerification === "ambiguous" ? "ambiguous" : "unknown";
  return {
    subject, entity, roles: (input.roles ?? []).filter((role) => SUBJECT_ROLES.has(role)),
    directPercent: direct, indirectPercent: indirect, votingPercent: voting,
    chain: (input.chain ?? []).map(safeSource).filter((value): value is SourceReference => hasProvenance(value)),
    controlBasis: input.controlBasis && CONTROL_BASES.has(input.controlBasis) ? input.controlBasis : "unknown", appointmentControl: typeof input.appointmentControl === "boolean" ? input.appointmentControl : null,
    significantInfluence: typeof input.significantInfluence === "boolean" ? input.significantInfluence : null, evidence,
    verification,
    // A label, percentage, or single person never proves the full ownership graph.
    completeness: !hasControlEvidence || evidence.length === 0 ? "incomplete" : "needs_review",
    reasonCode: !hasControlEvidence ? "ownership_control_unproven" : "ownership_completeness_unproven",
  };
}

export interface AuthorityObservation {
  subject?: SourceReference | null;
  claimedRole?: SubjectRole | null;
  verifiedRole?: SubjectRole | null;
  authorityScope?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  evidence?: SourceReference | null;
}

export function authorityFinding(input: AuthorityObservation): AuthorityFinding {
  const evidence = safeSource(input.evidence);
  const subject = safeSource(input.subject);
  const hasProvenEvidence = hasProvenance(subject) && hasProvenance(evidence) && (evidence?.sourceType === "review" || evidence?.sourceType === "document");
  const claimedRole = input.claimedRole && SUBJECT_ROLES.has(input.claimedRole) ? input.claimedRole : null;
  const verifiedRole = hasProvenEvidence && input.verifiedRole && SUBJECT_ROLES.has(input.verifiedRole) ? input.verifiedRole : null;
  const claimedOnly = claimedRole === "workspace_owner" || claimedRole === "team_member" || claimedRole === "director" || claimedRole === "beneficial_owner";
  const authorityScope = input.authorityScope && ["account_opening", "document_submission", "payment_instruction", "settlement", "review_submission"].includes(input.authorityScope) ? input.authorityScope : null;
  return {
    subject, claimedRole,
    verifiedRole, authorityScope,
    effectiveFrom: safeTimestamp(input.effectiveFrom), effectiveUntil: safeTimestamp(input.effectiveUntil),
    evidence, status: hasProvenEvidence && verifiedRole && authorityScope && !claimedOnly ? "needs_review" : "unknown",
    reasonCode: claimedOnly ? "role_not_legal_authority" : hasProvenEvidence ? "authority_requires_review" : "authority_evidence_missing",
  };
}
