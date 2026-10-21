import { createHash } from "node:crypto";
import { PLAN_ALIASES, type CanonicalPlanCode } from "../../plans";

export type PolicyStatus = "draft" | "approved";
export type EvidenceStatus = "verified" | "failed" | "missing" | "unknown" | "ambiguous" | "not_applicable" | "needs_review";
export type Projectability = "confidently_projectable" | "requires_shadow_reconciliation" | "requires_manual_review" | "conflicting_entitlement" | "unprojectable_unknown_source";
export type SubjectRole = "merchant_account" | "individual_merchant" | "legal_entity" | "workspace_owner" | "team_member" | "director" | "partner" | "trustee" | "authorised_representative" | "authorised_signatory" | "senior_management" | "shareholder_member" | "beneficial_owner" | "controller";
export type ScreeningType = "sanctions" | "pep" | "adverse_media";
export type ScreeningDisposition = "not_screened" | "clear" | "possible_match" | "confirmed_match" | "resolved_false_positive" | "needs_review";
export type OngoingCddStatus = "current" | "review_due" | "evidence_changed" | "revoked" | "unknown" | "needs_review";
export type OngoingTrigger = "registry_status_change" | "director_change" | "ownership_change" | "representative_change" | "payout_account_change" | "provider_mapping_change" | "evidence_expiry" | "evidence_revocation" | "screening_change" | "risk_change" | "expected_activity_change";

export interface PolicyDefinition {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly policyStatus: PolicyStatus;
  readonly canonicalPlan: CanonicalPlanCode;
}

export const POLICY_DEFINITIONS = Object.freeze({
  starter: Object.freeze({ policyId: "starter_offline", policyVersion: "2c-2b-v1", policyStatus: "approved", canonicalPlan: "starter" }),
  solo_lite: Object.freeze({ policyId: "solo_lite_evidence", policyVersion: "2c-2b-draft-v1", policyStatus: "draft", canonicalPlan: "solo_lite" }),
  business: Object.freeze({ policyId: "business_kyb_evidence", policyVersion: "2c-2b-draft-v1", policyStatus: "draft", canonicalPlan: "business" }),
  solo_plus: Object.freeze({ policyId: "solo_plus_case_projection", policyVersion: "2c-2b-v1", policyStatus: "approved", canonicalPlan: "solo_plus" }),
} as const satisfies Record<CanonicalPlanCode, PolicyDefinition>);

export type ParsedPlan = {
  rawPlan: string | null;
  canonicalPlan: CanonicalPlanCode | null;
  provenance: "canonical" | "legacy_alias" | "unknown";
  reasonCode: "recognized_plan" | "legacy_plan_alias" | "unknown_plan";
};

/** Policy selection must not use normalizePlanCode, which defaults unknown to Starter. */
export function parsePolicyPlan(raw: string | null | undefined): ParsedPlan {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  // A malformed value may be a misplaced secret; do not echo it into a shadow result.
  const safeRaw = Object.prototype.hasOwnProperty.call(PLAN_ALIASES, normalized) ? normalized : null;
  const canonical = Object.prototype.hasOwnProperty.call(PLAN_ALIASES, normalized)
    ? PLAN_ALIASES[normalized]
    : null;
  if (!canonical) return { rawPlan: safeRaw, canonicalPlan: null, provenance: "unknown", reasonCode: "unknown_plan" };
  const alias = normalized !== canonical;
  return { rawPlan: safeRaw, canonicalPlan: canonical, provenance: alias ? "legacy_alias" : "canonical", reasonCode: alias ? "legacy_plan_alias" : "recognized_plan" };
}

export interface SourceReference {
  sourceType: "merchant" | "verification_log" | "verification_step" | "registry_snapshot" | "director_verification" | "affiliation" | "document" | "settlement_account" | "provider_mapping" | "solo_plus_case" | "solo_plus_requirement" | "solo_plus_event" | "review" | "risk_review" | "screening";
  /** UUID only. Arbitrary provider references, storage paths, and identifiers are excluded. */
  sourceId: string | null;
  sourceVersion: number | null;
}

export interface EvidenceObservation {
  status: string | null;
  sourceType: SourceReference["sourceType"];
  sourceId?: string | null;
  sourceVersion?: number | null;
  subject?: SourceReference | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  revoked?: boolean | null;
}

export interface EvidenceFinding {
  code: string;
  status: EvidenceStatus;
  reasonCode: string;
  source: SourceReference | null;
  subject: SourceReference | null;
  evaluatedAt: string | null;
  evidenceAt: string | null;
  expiresAt: string | null;
  policyVersion: string | null;
}

export interface ScreeningFinding {
  type: ScreeningType;
  disposition: ScreeningDisposition;
  status: EvidenceStatus;
  subject: SourceReference | null;
  source: SourceReference | null;
  listVersion: string | null;
  screenedAt: string | null;
  nextReviewDue: string | null;
  reviewer: SourceReference | null;
  reasonCode: string;
}

export interface RiskFinding {
  rating: "low" | "medium" | "high" | "unknown";
  factors: readonly string[];
  source: SourceReference | null;
  evaluatedAt: string | null;
  nextReviewDue: string | null;
  reviewRequired: boolean;
  policyVersion: string | null;
}

export interface OngoingCddFinding {
  status: OngoingCddStatus;
  triggers: readonly OngoingTrigger[];
  source: SourceReference | null;
  nextReviewDue: string | null;
}

export interface PayoutFinding {
  accountEvidence: EvidenceFinding;
  ownershipRelationship: EvidenceFinding;
  providerMapping: EvidenceFinding;
}

export interface BeneficialOwnershipFinding {
  subject: SourceReference | null;
  entity: SourceReference | null;
  roles: readonly SubjectRole[];
  directPercent: number | null;
  indirectPercent: number | null;
  votingPercent: number | null;
  chain: readonly SourceReference[];
  controlBasis: "ownership" | "voting" | "appointment_removal" | "significant_influence" | "unknown";
  appointmentControl: boolean | null;
  significantInfluence: boolean | null;
  evidence: readonly SourceReference[];
  verification: EvidenceStatus;
  completeness: "unknown" | "incomplete" | "needs_review";
  reasonCode: string;
}

export interface AuthorityFinding {
  subject: SourceReference | null;
  claimedRole: SubjectRole | null;
  verifiedRole: SubjectRole | null;
  authorityScope: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  evidence: SourceReference | null;
  status: EvidenceStatus;
  reasonCode: string;
}

export interface PolicyDiagnostic {
  policy: PolicyDefinition;
  plan: ParsedPlan;
  evaluatedAt: string | null;
  projectability: Projectability;
  reasonCodes: readonly string[];
  findings: readonly EvidenceFinding[];
  screening: readonly ScreeningFinding[];
  risk: RiskFinding;
  ongoingCdd: OngoingCddFinding;
  payout: PayoutFinding;
  beneficialOwners: readonly BeneficialOwnershipFinding[];
  authority: readonly AuthorityFinding[];
  /** Source claim only. Never a canonical profile approval or an activation grant. */
  sourceAssurance: "enhanced_verified" | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_SOURCE_TYPES = new Set<SourceReference["sourceType"]>(["merchant", "verification_log", "verification_step", "registry_snapshot", "director_verification", "affiliation", "document", "settlement_account", "provider_mapping", "solo_plus_case", "solo_plus_requirement", "solo_plus_event", "review", "risk_review", "screening"]);
const OBSERVATION_STATES = new Set(["verified", "passed", "failed", "rejected", "missing", "unknown", "needs_review", "manual_review", "ambiguous", "not_applicable", "pending", "not_started", "unverified", "active", "locked", "processing"]);
const FINDING_CODES = new Set(["legal_name", "email_contact", "phone", "bvn", "bvn_name_match", "selfie_face_match", "distinct_liveness", "nin", "government_id", "declared_address", "address_evidence", "activity_nature", "expected_transaction_profile", "manual_review", "registration_number", "registration_status", "registered_address", "operating_address", "tin", "directors", "shareholders_members", "partners", "trustees", "representatives", "signatories", "senior_management", "beneficial_owners", "controllers", "documents", "document", "approved_volume", "payout_account", "payout_ownership", "provider_settlement_mapping"]);

/** Unregistered source/list versions are opaque references, never raw diagnostic text. */
export function safeMetadataReference(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || !/[A-Za-z]/.test(value)) return null;
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function safePolicyVersion(policy: PolicyDefinition): string | null {
  return Object.values(POLICY_DEFINITIONS).find((known) =>
    known.policyId === policy.policyId && known.policyVersion === policy.policyVersion &&
    known.policyStatus === policy.policyStatus && known.canonicalPlan === policy.canonicalPlan,
  )?.policyVersion ?? null;
}

export function safeObservedStatus(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "unknown";
  return OBSERVATION_STATES.has(normalized) ? normalized : "unknown";
}

export function safeTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length > 35) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}
export function safeSource(source: { sourceType: SourceReference["sourceType"]; sourceId?: string | null; sourceVersion?: number | null } | null | undefined): SourceReference | null {
  if (!source || !SAFE_SOURCE_TYPES.has(source.sourceType)) return null;
  return {
    sourceType: source.sourceType,
    sourceId: typeof source.sourceId === "string" && UUID.test(source.sourceId) ? source.sourceId.toLowerCase() : null,
    sourceVersion: positiveVersion(source.sourceVersion) ? source.sourceVersion : null,
  };
}

export function positiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function hasProvenance(source: SourceReference | null | undefined): boolean {
  return !!source?.sourceId && positiveVersion(source.sourceVersion);
}

export function observationFinding(code: string, observation: EvidenceObservation | null | undefined, policy: PolicyDefinition, evaluatedAt: string | null): EvidenceFinding {
  const state = safeObservedStatus(observation?.status);
  const evaluationTime = safeTimestamp(evaluatedAt);
  const source = safeSource(observation);
  const subject = safeSource(observation?.subject);
  const policyVersion = safePolicyVersion(policy);
  const expiresAt = safeTimestamp(observation?.expiresAt);
  const evidenceAt = safeTimestamp(observation?.observedAt);
  const expired = !!expiresAt && !!evaluationTime && Date.parse(expiresAt) <= Date.parse(evaluationTime);
  let status: EvidenceStatus = observation?.revoked === true || state === "failed" || state === "rejected" ? "failed"
    : !observation || state === "missing" ? "missing"
    : state === "ambiguous" ? "ambiguous"
    : state === "needs_review" || state === "manual_review" ? "needs_review" : "unknown";
  let reasonCode = observation?.revoked === true ? "evidence_revoked" : `evidence_${status}`;
  if (state === "verified" || state === "passed") {
    if (observation?.revoked === true) { status = "failed"; reasonCode = "evidence_revoked"; }
    else if (!evaluationTime || (observation?.expiresAt != null && !expiresAt) || (observation?.observedAt != null && !evidenceAt)) {
      status = "needs_review"; reasonCode = "evidence_time_indeterminate";
    } else if (expired || (evidenceAt && Date.parse(evidenceAt) > Date.parse(evaluationTime))) {
      status = "needs_review"; reasonCode = expired ? "evidence_expired" : "evidence_time_indeterminate";
    } else if (!hasProvenance(source) || !hasProvenance(subject) || source?.sourceType === "merchant" ||
      (code === "payout_ownership" && source?.sourceType !== "verification_log" && source?.sourceType !== "review") ||
      (code === "provider_settlement_mapping" && source?.sourceType !== "provider_mapping") ||
      !policyVersion || !FINDING_CODES.has(code)) {
      status = "needs_review"; reasonCode = "positive_evidence_provenance_missing";
    } else { status = "verified"; reasonCode = "evidence_verified"; }
  } else if (state === "not_applicable") reasonCode = "unapproved_non_applicability";
  return {
    code: FINDING_CODES.has(code) ? code : "unknown_evidence", status, reasonCode,
    source, subject, evaluatedAt: evaluationTime, evidenceAt, expiresAt, policyVersion,
  };
}
