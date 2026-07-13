import type {
  SoloPlusCaseRecord,
  SoloPlusCaseRequirementRecord,
  SoloPlusSafeJsonObject,
} from "../repository";
import { normalizeSoloPlusAmount } from "../repository";
import { getPlanPriceKobo } from "@/lib/plans";
import { SOLO_PLUS_REQUIRED_REQUIREMENTS } from "../state";

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

export type SoloPlusBrowserCaseSummaryDto = {
  caseId: string;
  flowOrigin: SoloPlusCaseRecord["flowOrigin"];
  caseStatus: SoloPlusCaseRecord["caseStatus"];
  paymentStatus: SoloPlusCaseRecord["paymentStatus"];
  refundStatus: SoloPlusCaseRecord["refundStatus"];
  rowVersion: number;
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

export function buildSoloPlusBrowserCaseSummaryDto(
  caseRecord: SoloPlusCaseRecord,
): SoloPlusBrowserCaseSummaryDto {
  return {
    caseId: caseRecord.id,
    flowOrigin: caseRecord.flowOrigin,
    caseStatus: caseRecord.caseStatus,
    paymentStatus: caseRecord.paymentStatus,
    refundStatus: caseRecord.refundStatus,
    rowVersion: caseRecord.rowVersion,
    reviewOutcome:
      caseRecord.caseStatus === "approved"
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
        : "draft",
    activationState:
      caseRecord.activationIdempotencyKey != null
        ? "activated"
        : caseRecord.caseStatus === "approved"
        ? "approved_pending_activation"
        : "inactive",
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
): SoloPlusBrowserCaseDto {
  return {
    ...buildSoloPlusBrowserCaseSummaryDto(caseRecord),
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
