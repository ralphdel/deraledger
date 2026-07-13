import type {
  SoloPlusCaseEventRecord,
  SoloPlusCaseRecord,
  SoloPlusCaseRequirementRecord,
  SoloPlusSafeJsonObject,
} from "../repository";
import { normalizeSoloPlusAmount } from "../repository";
import { getPlanPriceKobo } from "@/lib/plans";
import {
  SOLO_PLUS_CASE_STATUSES,
  SOLO_PLUS_PAYMENT_STATUSES,
  SOLO_PLUS_REFUND_STATUSES,
  type SoloPlusCaseStatus,
  type SoloPlusPaymentStatus,
  type SoloPlusRefundStatus,
  SOLO_PLUS_REQUIRED_REQUIREMENTS,
} from "../state";

export const SOLO_PLUS_BROWSER_CREATE_REQUIREMENTS_POLICY_VERSION = "solo-plus-payment-init-v1";
export const SOLO_PLUS_BROWSER_CREATE_MAX_BODY_BYTES = 64 * 1024;
export const SOLO_PLUS_BROWSER_EVIDENCE_MAX_BODY_BYTES = 96 * 1024;
export const SOLO_PLUS_BROWSER_READ_MAX_BODY_BYTES = 4 * 1024;
export const SOLO_PLUS_BROWSER_PROVIDER_REFERENCE_MAX_LENGTH = 128;
export const SOLO_PLUS_BROWSER_STORAGE_KEY_MAX_LENGTH = 512;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_WITH_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const CHECKSUM_SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const STORAGE_KEY_PATTERN =
  /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;
const PROVIDER_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MERCHANT_VISIBLE_REASON_MAX_LENGTH = 500;

export type SoloPlusMerchantReviewState =
  | "not_started"
  | "verification_pending"
  | "under_review"
  | "more_information_required"
  | "approved"
  | "rejected"
  | "cancelled";

export type SoloPlusMerchantActionRequired =
  | "none"
  | "complete_requirements"
  | "resubmit_information"
  | "contact_support";

export type SoloPlusBrowserCaseSummaryDto = {
  caseId: string;
  flowOrigin: SoloPlusCaseRecord["flowOrigin"];
  caseStatus: SoloPlusCaseRecord["caseStatus"];
  paymentStatus: SoloPlusCaseRecord["paymentStatus"];
  refundStatus: SoloPlusCaseRecord["refundStatus"];
  rowVersion: number;
  reviewState: SoloPlusMerchantReviewState;
  actionRequired: SoloPlusMerchantActionRequired;
  merchantVisibleReason: string | null;
  statusChangedAt: string | null;
  // reviewOutcome is preserved for Commit 11 compatibility; reviewState is the
  // explicit merchant-safe UI contract for Commit 12 and later.
  reviewOutcome: "pending_review" | "approved" | "rejected" | "verification_pending" | "draft" | "awaiting_payment" | "cancelled";
  activationState: "inactive" | "approved_pending_activation" | "activated";
  createdAt: string;
  updatedAt: string;
};

export type SoloPlusBrowserRequirementSummaryDto = {
  requirementCode: SoloPlusCaseRequirementRecord["requirementCode"];
  requirementState: SoloPlusCaseRequirementRecord["requirementState"];
  evidenceSourceType: SoloPlusCaseRequirementRecord["evidenceSourceType"];
  evidenceReference: SoloPlusCaseRequirementRecord["evidenceReference"];
  completedAt: SoloPlusCaseRequirementRecord["completedAt"];
  updatedAt: SoloPlusCaseRequirementRecord["updatedAt"];
};

export type SoloPlusBrowserCaseDto = SoloPlusBrowserCaseSummaryDto & {
  requirements: SoloPlusBrowserRequirementSummaryDto[];
};

export type SoloPlusAdminCasesCursor = {
  updatedAt: string;
  caseId: string;
};

export type SoloPlusAdminCaseEventsCursor = {
  createdAt: string;
  eventId: string;
};

export type SoloPlusAdminCasesQuery = {
  status: SoloPlusCaseStatus | null;
  flowOrigin: SoloPlusCaseRecord["flowOrigin"] | null;
  paymentStatus: SoloPlusPaymentStatus | null;
  refundStatus: SoloPlusRefundStatus | null;
  merchantSearch: string | null;
  cursor: SoloPlusAdminCasesCursor | null;
  limit: number;
};

export type SoloPlusAdminQueueRequirementSummaryDto = {
  total: number;
  satisfied: number;
  actionable: number;
  inProgress: number;
};

export type SoloPlusAdminQueueItemDto = {
  caseId: string;
  merchantDisplayName: string | null;
  ownerEmail: string | null;
  flowOrigin: SoloPlusCaseRecord["flowOrigin"];
  caseStatus: SoloPlusCaseRecord["caseStatus"];
  reviewState: SoloPlusMerchantReviewState;
  paymentStatus: SoloPlusCaseRecord["paymentStatus"];
  refundStatus: SoloPlusCaseRecord["refundStatus"];
  rowVersion: number;
  requirementSummary: SoloPlusAdminQueueRequirementSummaryDto;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string | null;
};

export type SoloPlusAdminQueueResponseDto = {
  items: SoloPlusAdminQueueItemDto[];
  nextCursor: string | null;
};

export type SoloPlusAdminEvidenceReferenceSummaryDto = {
  sourceType: NonNullable<SoloPlusCaseRequirementRecord["evidenceSourceType"]>;
  label: string;
  capturedAt: string | null;
  fileType: string | null;
  fileSizeBytes: number | null;
};

export type SoloPlusAdminRequirementDetailDto = {
  requirementCode: SoloPlusCaseRequirementRecord["requirementCode"];
  requirementState: SoloPlusCaseRequirementRecord["requirementState"];
  evidenceSourceType: SoloPlusCaseRequirementRecord["evidenceSourceType"];
  evidenceReferenceSummary: SoloPlusAdminEvidenceReferenceSummaryDto | null;
  completedAt: string | null;
  updatedAt: string;
};

export type SoloPlusAdminPaymentSummaryDto = {
  provider: SoloPlusCaseRecord["paymentProvider"];
  amount: string;
  currency: SoloPlusCaseRecord["paymentCurrency"];
  status: SoloPlusCaseRecord["paymentStatus"];
  providerReference: string | null;
  confirmedAt: string | null;
};

export type SoloPlusAdminRefundSummaryDto = {
  status: SoloPlusCaseRecord["refundStatus"];
  reasonSummary: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  processingAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
};

export type SoloPlusAdminReviewHistoryEventDto = {
  eventType: string;
  decision: "request_more_information" | "approve" | "reject" | "reopen" | null;
  reason: string | null;
  actorType: SoloPlusCaseEventRecord["actorType"];
  reviewerDisplayName: string | null;
  policyVersion: string | null;
  createdAt: string;
};

export type SoloPlusAdminCaseDetailDto = {
  case: {
    caseId: string;
    merchantId: string | null;
    merchantDisplayName: string | null;
    ownerEmail: string | null;
    currentPlan: string | null;
    flowOrigin: SoloPlusCaseRecord["flowOrigin"];
    caseStatus: SoloPlusCaseRecord["caseStatus"];
    reviewState: SoloPlusMerchantReviewState;
    paymentStatus: SoloPlusCaseRecord["paymentStatus"];
    refundStatus: SoloPlusCaseRecord["refundStatus"];
    activationState: "inactive" | "approved_pending_activation" | "activated";
    rowVersion: number;
    createdAt: string;
    updatedAt: string;
    statusChangedAt: string | null;
  };
  requirements: SoloPlusAdminRequirementDetailDto[];
  payment: SoloPlusAdminPaymentSummaryDto | null;
  refund: SoloPlusAdminRefundSummaryDto | null;
  reviewHistory: SoloPlusAdminReviewHistoryEventDto[];
};

type MerchantReviewContext = {
  reviewState: SoloPlusMerchantReviewState;
  actionRequired: SoloPlusMerchantActionRequired;
  merchantVisibleReason: string | null;
  statusChangedAt: string | null;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertPlainRecordBody(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error("Invalid request body.");
  }

  return value;
}

export function assertUuid(value: unknown, field: string): string {
  if (!hasNonEmptyString(value) || !UUID_PATTERN.test(value.trim())) {
    throw new Error(`${field} must be a valid UUID.`);
  }

  return value.trim();
}

export function assertNonNegativeSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }

  return value;
}

export function assertBoundedText(
  value: unknown,
  field: string,
  maxLength: number,
  required: true,
): string;
export function assertBoundedText(
  value: unknown,
  field: string,
  maxLength: number,
  required: false,
): string | null;
export function assertBoundedText(
  value: unknown,
  field: string,
  maxLength: number,
  required = true,
): string | null {
  if (!hasNonEmptyString(value)) {
    if (!required && typeof value === "string" && value.trim() === "") {
      return null;
    }

    throw new Error(`${field} must be a non-empty string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${field} must be at most ${maxLength} characters.`);
  }

  return trimmed;
}

function assertNoUnsafeReferenceCharacters(value: string, field: string): void {
  if (/[\u0000-\u001F\u007F\s]/.test(value)) {
    throw new Error(`${field} contains unsafe whitespace or control characters.`);
  }
}

export function assertIsoTimestamp(value: unknown, field: string): string {
  const normalized = assertBoundedText(value, field, 64, true);
  if (!ISO_TIMESTAMP_WITH_TIME_PATTERN.test(normalized)) {
    throw new Error(`${field} must be an ISO-8601 timestamp.`);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`${field} must be an ISO-8601 timestamp.`);
  }

  return normalized;
}

export function assertSha256Checksum(value: unknown, field: string): string {
  const normalized = assertBoundedText(value, field, 64, true);
  if (!CHECKSUM_SHA256_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a 64-character SHA-256 hex digest.`);
  }

  return normalized.toLowerCase();
}

export function assertStorageObjectKey(value: unknown, field: string): string {
  const normalized = assertBoundedText(value, field, SOLO_PLUS_BROWSER_STORAGE_KEY_MAX_LENGTH, true);
  assertNoUnsafeReferenceCharacters(normalized, field);
  if (
    !STORAGE_KEY_PATTERN.test(normalized) ||
    normalized.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized) ||
    /^[a-z]:/i.test(normalized)
  ) {
    throw new Error(`${field} must be a trusted object-storage key.`);
  }

  return normalized;
}

export function assertOpaqueProviderReference(value: unknown, field: string): string {
  const normalized = assertBoundedText(
    value,
    field,
    SOLO_PLUS_BROWSER_PROVIDER_REFERENCE_MAX_LENGTH,
    true,
  );
  assertNoUnsafeReferenceCharacters(normalized, field);
  if (
    !PROVIDER_REFERENCE_PATTERN.test(normalized) ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized)
  ) {
    throw new Error(`${field} must be a trusted opaque provider reference.`);
  }

  return normalized;
}

export function assertNoForbiddenFields(
  payload: Record<string, unknown>,
  allowedFields: readonly string[],
  forbiddenFields: readonly string[],
): void {
  const allowed = new Set(allowedFields);
  const forbidden = new Set(forbiddenFields);

  for (const key of Object.keys(payload)) {
    if (forbidden.has(key)) {
      throw new Error(`Client-supplied ${key} is not allowed.`);
    }

    if (!allowed.has(key)) {
      throw new Error(`Unexpected request field: ${key}.`);
    }
  }
}

export function assertSupportedJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type");
  if (contentType && !/application\/json/i.test(contentType)) {
    throw new Error("Unsupported content type.");
  }
}

export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  assertSupportedJsonContentType(request);

  const text = await request.text();
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > maxBytes) {
    throw new Error("Request body is too large.");
  }

  if (text.trim() === "") {
    throw new Error("Invalid request body.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid request body.");
  }
}

function hasActionableOutstandingRequirement(
  requirements: readonly SoloPlusCaseRequirementRecord[],
): boolean {
  return requirements.some(
    (requirement) =>
      requirement.requirementState === "not_started" ||
      requirement.requirementState === "failed",
  );
}

export function sanitizeMerchantVisibleReason(rawReason: string | null | undefined): string | null {
  if (!hasNonEmptyString(rawReason)) {
    return null;
  }

  const withoutControlCharacters = rawReason.replace(/[\u0000-\u001F\u007F]/g, " ");
  const withoutHtmlTags = withoutControlCharacters.replace(/<[^>]*>/g, " ");
  const normalizedWhitespace = withoutHtmlTags.replace(/\s+/g, " ").trim();
  if (normalizedWhitespace === "") {
    return null;
  }

  return normalizedWhitespace.slice(0, MERCHANT_VISIBLE_REASON_MAX_LENGTH);
}

function getReviewOutcome(
  caseRecord: SoloPlusCaseRecord,
): SoloPlusBrowserCaseSummaryDto["reviewOutcome"] {
  return caseRecord.caseStatus === "approved"
    ? "approved"
    : caseRecord.caseStatus === "rejected"
    ? "rejected"
    : caseRecord.caseStatus === "verification_pending"
    ? "verification_pending"
    : caseRecord.caseStatus === "manual_review"
    ? "pending_review"
    : caseRecord.caseStatus === "awaiting_payment"
    ? "awaiting_payment"
    : caseRecord.caseStatus === "cancelled"
    ? "cancelled"
    : "draft";
}

function getActivationState(
  caseRecord: SoloPlusCaseRecord,
): SoloPlusBrowserCaseSummaryDto["activationState"] {
  return caseRecord.activationIdempotencyKey != null
    ? "activated"
    : caseRecord.caseStatus === "approved"
    ? "approved_pending_activation"
    : "inactive";
}

function deriveMerchantReviewContext(
  caseRecord: SoloPlusCaseRecord,
  requirements: readonly SoloPlusCaseRequirementRecord[],
  latestReviewDecisionEvent: SoloPlusCaseEventRecord | null,
): MerchantReviewContext {
  switch (caseRecord.caseStatus) {
    case "draft":
    case "awaiting_payment":
      return {
        reviewState: "not_started",
        actionRequired: "none",
        merchantVisibleReason: null,
        statusChangedAt: caseRecord.updatedAt,
      };
    case "verification_pending":
      if (
        latestReviewDecisionEvent?.eventType === "case_review_requested_more_information"
      ) {
        return {
          reviewState: "more_information_required",
          actionRequired: "resubmit_information",
          merchantVisibleReason:
            sanitizeMerchantVisibleReason(latestReviewDecisionEvent.reason) ??
            "Additional information is required before Solo Plus review can continue.",
          statusChangedAt: latestReviewDecisionEvent.createdAt,
        };
      }

      return {
        reviewState: "verification_pending",
        actionRequired: hasActionableOutstandingRequirement(requirements)
          ? "complete_requirements"
          : "none",
        merchantVisibleReason: null,
        statusChangedAt: caseRecord.updatedAt,
      };
    case "manual_review":
      return {
        reviewState: "under_review",
        actionRequired: "none",
        merchantVisibleReason: null,
        statusChangedAt: caseRecord.updatedAt,
      };
    case "approved":
      return {
        reviewState: "approved",
        actionRequired: "none",
        merchantVisibleReason: null,
        statusChangedAt:
          latestReviewDecisionEvent?.eventType === "case_approved"
            ? latestReviewDecisionEvent.createdAt
            : caseRecord.approvedAt ?? caseRecord.updatedAt,
      };
    case "rejected":
      return {
        reviewState: "rejected",
        actionRequired: "none",
        merchantVisibleReason:
          sanitizeMerchantVisibleReason(
            latestReviewDecisionEvent?.eventType === "case_rejected"
              ? latestReviewDecisionEvent.reason
              : caseRecord.rejectionReason,
          ) ?? "Solo Plus verification was rejected.",
        statusChangedAt:
          latestReviewDecisionEvent?.eventType === "case_rejected"
            ? latestReviewDecisionEvent.createdAt
            : caseRecord.rejectedAt ?? caseRecord.updatedAt,
      };
    case "cancelled":
      return {
        reviewState: "cancelled",
        actionRequired: "none",
        merchantVisibleReason: null,
        statusChangedAt: caseRecord.updatedAt,
      };
  }
}

export function buildSoloPlusBrowserCaseSummaryDto(
  caseRecord: SoloPlusCaseRecord,
  requirements: readonly SoloPlusCaseRequirementRecord[],
  latestReviewDecisionEvent: SoloPlusCaseEventRecord | null = null,
): SoloPlusBrowserCaseSummaryDto {
  const reviewContext = deriveMerchantReviewContext(
    caseRecord,
    requirements,
    latestReviewDecisionEvent,
  );

  return {
    caseId: caseRecord.id,
    flowOrigin: caseRecord.flowOrigin,
    caseStatus: caseRecord.caseStatus,
    paymentStatus: caseRecord.paymentStatus,
    refundStatus: caseRecord.refundStatus,
    rowVersion: caseRecord.rowVersion,
    reviewState: reviewContext.reviewState,
    actionRequired: reviewContext.actionRequired,
    merchantVisibleReason: reviewContext.merchantVisibleReason,
    statusChangedAt: reviewContext.statusChangedAt,
    reviewOutcome: getReviewOutcome(caseRecord),
    activationState: getActivationState(caseRecord),
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt,
  };
}

export function buildSoloPlusBrowserRequirementSummaryDto(
  requirement: SoloPlusCaseRequirementRecord,
): SoloPlusBrowserRequirementSummaryDto {
  return {
    requirementCode: requirement.requirementCode,
    requirementState: requirement.requirementState,
    evidenceSourceType: requirement.evidenceSourceType,
    evidenceReference: requirement.evidenceReference,
    completedAt: requirement.completedAt,
    updatedAt: requirement.updatedAt,
  };
}

export function buildSoloPlusBrowserCaseDto(
  caseRecord: SoloPlusCaseRecord,
  requirements: readonly SoloPlusCaseRequirementRecord[],
  latestReviewDecisionEvent: SoloPlusCaseEventRecord | null = null,
): SoloPlusBrowserCaseDto {
  return {
    ...buildSoloPlusBrowserCaseSummaryDto(
      caseRecord,
      requirements,
      latestReviewDecisionEvent,
    ),
    requirements: requirements.map((requirement) =>
      buildSoloPlusBrowserRequirementSummaryDto(requirement),
    ),
  };
}

export function buildSoloPlusCreationRequirementsSnapshot(flowOrigin: "onboarding" | "upgrade"): SoloPlusSafeJsonObject {
  return {
    commitScope: "solo_plus_commit_7_payment_lifecycle",
    flowOrigin,
    activationDeferred: true,
    paymentConfirmationTargetStatus: "verification_pending",
    requiredRequirements: [...SOLO_PLUS_REQUIRED_REQUIREMENTS],
  };
}

export function getSoloPlusCreationExpectedAmount(): string {
  return normalizeSoloPlusAmount((getPlanPriceKobo("solo_plus") / 100).toFixed(2));
}

export function getSoloPlusCreationExpectedAmountKobo(): number {
  return getPlanPriceKobo("solo_plus");
}

function isAllowedCaseStatus(value: string): value is SoloPlusCaseStatus {
  return (SOLO_PLUS_CASE_STATUSES as readonly string[]).includes(value);
}

function isAllowedPaymentStatus(value: string): value is SoloPlusPaymentStatus {
  return (SOLO_PLUS_PAYMENT_STATUSES as readonly string[]).includes(value);
}

function isAllowedRefundStatus(value: string): value is SoloPlusRefundStatus {
  return (SOLO_PLUS_REFUND_STATUSES as readonly string[]).includes(value);
}

function normalizeAdminQueryParam(
  value: string | null,
  field: string,
  maxLength: number,
): string | null {
  if (value == null) {
    return null;
  }

  return assertBoundedText(value, field, maxLength, false);
}

function parseBase64Json<T>(value: string, field: string): T {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return JSON.parse(decoded) as T;
  } catch {
    throw new Error(`${field} is invalid.`);
  }
}

export function serializeSoloPlusAdminCasesCursor(
  cursor: SoloPlusAdminCasesCursor | null,
): string | null {
  if (!cursor) {
    return null;
  }

  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function parseSoloPlusAdminCasesCursor(
  value: string | null,
): SoloPlusAdminCasesCursor | null {
  if (value == null) {
    return null;
  }

  const parsed = parseBase64Json<Record<string, unknown>>(value, "cursor");
  return {
    updatedAt: assertIsoTimestamp(parsed.updatedAt, "cursor.updatedAt"),
    caseId: assertUuid(parsed.caseId, "cursor.caseId"),
  };
}

export function serializeSoloPlusAdminCaseEventsCursor(
  cursor: SoloPlusAdminCaseEventsCursor | null,
): string | null {
  if (!cursor) {
    return null;
  }

  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function parseSoloPlusAdminCaseEventsCursor(
  value: string | null,
): SoloPlusAdminCaseEventsCursor | null {
  if (value == null) {
    return null;
  }

  const parsed = parseBase64Json<Record<string, unknown>>(value, "historyCursor");
  return {
    createdAt: assertIsoTimestamp(parsed.createdAt, "historyCursor.createdAt"),
    eventId: assertUuid(parsed.eventId, "historyCursor.eventId"),
  };
}

export function parseSoloPlusAdminCasesQuery(request: Request): SoloPlusAdminCasesQuery {
  const url = new URL(request.url);
  const statusValue = normalizeAdminQueryParam(url.searchParams.get("status"), "status", 32);
  const flowOriginValue = normalizeAdminQueryParam(
    url.searchParams.get("flowOrigin"),
    "flowOrigin",
    16,
  );
  const paymentStatusValue = normalizeAdminQueryParam(
    url.searchParams.get("paymentStatus"),
    "paymentStatus",
    16,
  );
  const refundStatusValue = normalizeAdminQueryParam(
    url.searchParams.get("refundStatus"),
    "refundStatus",
    32,
  );
  const merchantSearch = normalizeAdminQueryParam(url.searchParams.get("q"), "q", 128);
  const limitRaw = url.searchParams.get("limit");
  const limit =
    limitRaw == null ? 25 : assertNonNegativeSafeInteger(Number(limitRaw), "limit");

  if (limit < 1 || limit > 50) {
    throw new Error("limit must be between 1 and 50.");
  }

  if (statusValue && !isAllowedCaseStatus(statusValue)) {
    throw new Error("status must be a supported Solo Plus case status.");
  }
  if (flowOriginValue && flowOriginValue !== "onboarding" && flowOriginValue !== "upgrade") {
    throw new Error("flowOrigin must be onboarding or upgrade.");
  }
  if (paymentStatusValue && !isAllowedPaymentStatus(paymentStatusValue)) {
    throw new Error("paymentStatus must be a supported Solo Plus payment status.");
  }
  if (refundStatusValue && !isAllowedRefundStatus(refundStatusValue)) {
    throw new Error("refundStatus must be a supported Solo Plus refund status.");
  }

  return {
    status: (statusValue as SoloPlusCaseStatus | null) ?? null,
    flowOrigin: flowOriginValue as SoloPlusCaseRecord["flowOrigin"] | null,
    paymentStatus: (paymentStatusValue as SoloPlusPaymentStatus | null) ?? null,
    refundStatus: (refundStatusValue as SoloPlusRefundStatus | null) ?? null,
    merchantSearch,
    cursor: parseSoloPlusAdminCasesCursor(url.searchParams.get("cursor")),
    limit,
  };
}

export function parseSoloPlusAdminCaseDetailQuery(request: Request): {
  historyCursor: SoloPlusAdminCaseEventsCursor | null;
  historyLimit: number;
} {
  const url = new URL(request.url);
  const historyLimitRaw = url.searchParams.get("historyLimit");
  const historyLimit =
    historyLimitRaw == null
      ? 25
      : assertNonNegativeSafeInteger(Number(historyLimitRaw), "historyLimit");

  if (historyLimit < 1 || historyLimit > 50) {
    throw new Error("historyLimit must be between 1 and 50.");
  }

  return {
    historyCursor: parseSoloPlusAdminCaseEventsCursor(url.searchParams.get("historyCursor")),
    historyLimit,
  };
}
