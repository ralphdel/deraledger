export const DRAFT_REVIEW_POLICY_VERSION = "2c-2b-draft-v1" as const;

export const REVIEW_CORRECTION_REASON_CODES = [
  "evidence_incomplete",
  "evidence_expired",
  "evidence_mismatch",
  "reviewer_requested_correction",
] as const;

export type ReviewCorrectionReasonCode = typeof REVIEW_CORRECTION_REASON_CODES[number];

export const LITE_REVIEW_FINDING_CODES = [
  "legal_name", "email_contact", "phone", "bvn", "bvn_name_match",
  "selfie_face_match", "distinct_liveness", "nin", "government_id",
  "declared_address", "address_evidence", "activity_nature",
  "expected_transaction_profile", "manual_review",
] as const;

export const BUSINESS_REVIEW_FINDING_CODES = [
  "legal_name", "registration_number", "registration_status", "registered_address",
  "operating_address", "tin", "activity_nature", "expected_transaction_profile",
  "directors", "shareholders_members", "partners", "trustees", "representatives",
  "signatories", "senior_management", "beneficial_owners", "controllers", "documents",
  "approved_volume", "manual_review",
] as const;

export type ReviewPlan = "solo_lite" | "business";
export type ReviewStatus = "pending" | "needs_attention";
export type ReviewMutationKind =
  | "applied"
  | "already_processed"
  | "version_conflict"
  | "state_conflict"
  | "evidence_conflict"
  | "actor_unauthorized"
  | "reviewer_unauthorized"
  | "unsupported_isolation"
  | "invalid_transition";

export type ReviewFindingSummary = {
  code: string;
  status: string;
  reasonCode: string;
};

export type ReviewHistoryItem = {
  action: "submitted" | "correction_requested" | "superseded";
  occurredAt: string;
  reasonCode: string | null;
};

export type ReviewReadModel = {
  reviewId: string;
  merchantId: string;
  merchantName: string;
  plan: ReviewPlan;
  planLabel: "Solo Lite" | "Business";
  status: ReviewStatus;
  submittedAt: string;
  reviewedAt: string | null;
  policyVersion: string;
  rowVersion: number;
  reasonCode: ReviewCorrectionReasonCode | null;
  requestedFindingCodes: string[];
  findings: ReviewFindingSummary[];
  history: ReviewHistoryItem[];
};

export type ReviewMutationResponse = {
  ok: boolean;
  code:
    | "APPLIED"
    | "ALREADY_PROCESSED"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "INVALID_REQUEST"
    | "VERSION_CONFLICT"
    | "STATE_CONFLICT"
    | "EVIDENCE_CONFLICT"
    | "AUTHORITY_CONFLICT"
    | "SERVICE_UNAVAILABLE"
    | "INTERNAL_ERROR";
  review?: ReviewReadModel | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_:-]{7,127}$/;
const RESUBMISSION_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9_:-]{7,123}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isReviewCorrectionReasonCode(value: unknown): value is ReviewCorrectionReasonCode {
  return typeof value === "string" && (REVIEW_CORRECTION_REASON_CODES as readonly string[]).includes(value);
}

export function isRequestIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY.test(value);
}

export function isResubmissionIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && RESUBMISSION_IDEMPOTENCY_KEY.test(value);
}

export function validFindingCodesForPlan(plan: ReviewPlan): readonly string[] {
  return plan === "solo_lite" ? LITE_REVIEW_FINDING_CODES : BUSINESS_REVIEW_FINDING_CODES;
}

export function normalizeRequestedFindingCodes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32 || !value.every((item) => typeof item === "string")) {
    return null;
  }
  const normalized = value.map((item) => item.trim());
  if (normalized.some((item) => !/^[a-z][a-z0-9_]{1,63}$/.test(item)) || new Set(normalized).size !== normalized.length) {
    return null;
  }
  return normalized.sort();
}

export function mapReviewMutationKind(kind: ReviewMutationKind): { status: number; body: ReviewMutationResponse } {
  switch (kind) {
    case "applied":
      return { status: 200, body: { ok: true, code: "APPLIED" } };
    case "already_processed":
      return { status: 200, body: { ok: true, code: "ALREADY_PROCESSED" } };
    case "version_conflict":
      return { status: 409, body: { ok: false, code: "VERSION_CONFLICT" } };
    case "state_conflict":
    case "invalid_transition":
      return { status: 409, body: { ok: false, code: "STATE_CONFLICT" } };
    case "evidence_conflict":
      return { status: 422, body: { ok: false, code: "EVIDENCE_CONFLICT" } };
    case "actor_unauthorized":
    case "reviewer_unauthorized":
      return { status: 403, body: { ok: false, code: "AUTHORITY_CONFLICT" } };
    case "unsupported_isolation":
      return { status: 503, body: { ok: false, code: "SERVICE_UNAVAILABLE" } };
  }
}

export const REVIEW_CORRECTION_REASON_LABELS: Record<ReviewCorrectionReasonCode, string> = {
  evidence_incomplete: "Evidence is incomplete",
  evidence_expired: "Evidence has expired",
  evidence_mismatch: "Submitted information does not match",
  reviewer_requested_correction: "A correction is required",
};

export const REVIEW_FINDING_LABELS: Record<string, string> = {
  legal_name: "Legal name",
  email_contact: "Email address",
  phone: "Phone number",
  bvn: "BVN verification",
  bvn_name_match: "BVN name match",
  selfie_face_match: "Selfie face match",
  distinct_liveness: "Liveness check",
  nin: "NIN verification",
  government_id: "Government ID",
  declared_address: "Declared address",
  address_evidence: "Proof of address",
  activity_nature: "Business activity",
  expected_transaction_profile: "Expected transaction profile",
  manual_review: "Manual review evidence",
  registration_number: "Registration number",
  registration_status: "Registration status",
  registered_address: "Registered address",
  operating_address: "Operating address",
  tin: "Tax identification number",
  directors: "Directors",
  shareholders_members: "Shareholders or members",
  partners: "Partners",
  trustees: "Trustees",
  representatives: "Authorised representatives",
  signatories: "Authorised signatories",
  senior_management: "Senior management",
  beneficial_owners: "Beneficial owners",
  controllers: "Controllers",
  documents: "Business documents",
  approved_volume: "Approved transaction volume",
};

export function findingLabel(code: string): string {
  return REVIEW_FINDING_LABELS[code] ?? "Requested evidence";
}
