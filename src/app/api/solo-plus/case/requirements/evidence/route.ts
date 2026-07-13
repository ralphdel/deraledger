import { NextResponse } from "next/server";

import type { SoloPlusActivityProfileInput } from "@/lib/solo-plus/requirement-orchestration";
import type { SoloPlusBrowserCaseService } from "@/lib/solo-plus/server/browser-case-service";
import {
  assertBoundedText,
  assertNoForbiddenFields,
  assertNonNegativeSafeInteger,
  assertOpaqueProviderReference,
  assertPlainRecordBody,
  assertSha256Checksum,
  assertStorageObjectKey,
  assertIsoTimestamp,
  assertUuid,
  buildSoloPlusBrowserCaseDto,
  readBoundedJsonBody,
  SOLO_PLUS_BROWSER_EVIDENCE_MAX_BODY_BYTES,
} from "@/lib/solo-plus/server/route-contracts";
import { assertSameOriginBrowserMutationRequest } from "@/lib/server/browser-origin";

type RequireAuthenticatedSessionResult =
  | { ok: true; userId: string; email: string | null }
  | { ok: false; status: number; error: string };

type RequireAuthenticatedSessionFn = () => Promise<RequireAuthenticatedSessionResult>;
type CreateSoloPlusBrowserCaseServiceFn =
  typeof import("@/lib/solo-plus/server/browser-case-service").createSoloPlusBrowserCaseService;
type BrowserMutationOriginGuardFn = typeof assertSameOriginBrowserMutationRequest;

type SoloPlusEvidenceRouteDependencies = {
  requireAuthenticatedSession: RequireAuthenticatedSessionFn;
  createBrowserCaseService: CreateSoloPlusBrowserCaseServiceFn;
  assertBrowserMutationOriginRequest?: BrowserMutationOriginGuardFn;
  onUnexpectedError?: (error: unknown) => void;
};

type SoloPlusEvidenceSubmissionInput = {
  caseId: string;
  onboardingSessionId?: string | null;
  activityProfile?: SoloPlusActivityProfileInput | null;
  idDocument?: {
    storageKey: string;
    checksumSha256?: string | null;
    uploadedAt: string;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    providerName?: string | null;
    providerReference?: string | null;
  } | null;
  proofOfAddress?: {
    storageKey: string;
    checksumSha256?: string | null;
    uploadedAt: string;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    providerName?: string | null;
    providerReference?: string | null;
  } | null;
};

const ALLOWED_FIELDS = [
  "caseId",
  "onboardingSessionId",
  "activityProfile",
  "idDocument",
  "proofOfAddress",
] as const;

const FORBIDDEN_FIELDS = [
  "merchantId",
  "userId",
  "actorId",
  "actorType",
  "reviewerId",
  "reviewerAdminId",
  "activatorId",
  "activatorAdminId",
  "serviceRole",
  "serviceRoleKey",
  "serviceRoleToken",
  "caseStatus",
  "paymentStatus",
  "refundStatus",
  "approvedAt",
  "liveFeaturesEnabled",
  "setupMode",
  "subscriptionPlan",
  "merchantTier",
  "requestIdempotencyKey",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildErrorResponse(status: number, error: string, code: string): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

function getErrorCode(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }

  return typeof error.code === "string" ? error.code : null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (!isRecord(error) || typeof error.message !== "string" || error.message.trim() === "") {
    return fallback;
  }

  return error.message.trim();
}

function parseNestedEvidenceObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object.`);
  }

  return value;
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function assertActivityProfile(value: unknown): SoloPlusActivityProfileInput {
  const record = parseNestedEvidenceObject(value, "activityProfile");
  return {
    businessActivityType: assertBoundedText(record.businessActivityType, "businessActivityType", 128, true),
    expectedMonthlyTransactionValue: assertBoundedText(
      record.expectedMonthlyTransactionValue,
      "expectedMonthlyTransactionValue",
      64,
      true,
    ),
    expectedTransactionCount: assertNonNegativeSafeInteger(
      record.expectedTransactionCount,
      "expectedTransactionCount",
    ),
    typicalCustomerType: assertBoundedText(record.typicalCustomerType, "typicalCustomerType", 128, true),
    reasonForHigherCollectionNeed: assertBoundedText(
      record.reasonForHigherCollectionNeed,
      "reasonForHigherCollectionNeed",
      256,
      true,
    ),
    expectedSettlementBehaviour: assertBoundedText(
      record.expectedSettlementBehaviour,
      "expectedSettlementBehaviour",
      128,
      true,
    ),
    submittedAt:
      record.submittedAt == null
        ? null
        : assertBoundedText(record.submittedAt, "submittedAt", 64, false),
  };
}

function normalizeDocumentInput(value: unknown, field: string) {
  const record = parseNestedEvidenceObject(value, field);
  return {
    storageKey: assertStorageObjectKey(record.storageKey, "storageKey"),
    checksumSha256:
      record.checksumSha256 == null
        ? null
        : assertSha256Checksum(record.checksumSha256, "checksumSha256"),
    uploadedAt: assertIsoTimestamp(record.uploadedAt, "uploadedAt"),
    contentType: normalizeOptionalText(record.contentType),
    fileSizeBytes:
      record.fileSizeBytes == null
        ? null
        : assertNonNegativeSafeInteger(record.fileSizeBytes, "fileSizeBytes"),
    providerName: normalizeOptionalText(record.providerName),
    providerReference:
      record.providerReference == null
        ? null
        : assertOpaqueProviderReference(record.providerReference, "providerReference"),
  };
}

function parseEvidenceInput(payload: unknown): SoloPlusEvidenceSubmissionInput {
  const body = assertPlainRecordBody(payload);
  assertNoForbiddenFields(body, ALLOWED_FIELDS, FORBIDDEN_FIELDS);

  const caseId = assertUuid(body.caseId, "caseId");
  const onboardingSessionId =
    body.onboardingSessionId == null ? null : assertUuid(body.onboardingSessionId, "onboardingSessionId");

  const activityProfile = body.activityProfile == null ? null : assertActivityProfile(body.activityProfile);

  const idDocument =
    body.idDocument == null
      ? null
      : normalizeDocumentInput(body.idDocument, "idDocument");

  const proofOfAddress =
    body.proofOfAddress == null
      ? null
      : normalizeDocumentInput(body.proofOfAddress, "proofOfAddress");

  return {
    caseId,
    onboardingSessionId,
    activityProfile,
    idDocument,
    proofOfAddress,
  };
}

function mapDomainError(error: unknown): NextResponse | null {
  const code = getErrorCode(error);
  const message = getErrorMessage(error, "Solo Plus evidence submission failed.");

  switch (code) {
    case "SOLO_PLUS_SERVER_UNAUTHORIZED":
      return buildErrorResponse(401, message, "UNAUTHORIZED");
    case "SOLO_PLUS_SERVER_FORBIDDEN":
      return buildErrorResponse(403, message, "FORBIDDEN");
    case "SOLO_PLUS_ACCESS_DENIED":
    case "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT":
    case "SOLO_PLUS_SERVER_NOT_FOUND":
      return buildErrorResponse(404, "Solo Plus case was not found.", "NOT_FOUND");
    case "SOLO_PLUS_SERVER_CONFIG_ERROR":
    case "SOLO_PLUS_INVALID_REVIEW_INPUT":
      return buildErrorResponse(400, message, "INVALID_REQUEST");
    case "SOLO_PLUS_CASE_VERSION_CONFLICT":
      return buildErrorResponse(409, "Solo Plus case version no longer matches the current record.", "VERSION_CONFLICT");
    case "SOLO_PLUS_CASE_STATE_CONFLICT":
      return buildErrorResponse(409, "Solo Plus case is not in a valid state for this evidence update.", "STATE_CONFLICT");
    case "SOLO_PLUS_IDEMPOTENCY_CONFLICT":
      return buildErrorResponse(409, "Solo Plus evidence submission idempotency key conflicts with a different request.", "IDEMPOTENCY_CONFLICT");
    case "SOLO_PLUS_PREREQUISITE_CONFLICT":
    case "SOLO_PLUS_CASE_PREREQUISITE_CONFLICT":
      return buildErrorResponse(409, "Solo Plus evidence submission prerequisites are not satisfied.", "PREREQUISITE_CONFLICT");
    case "SOLO_PLUS_FEATURE_DISABLED":
      return buildErrorResponse(409, "Solo Plus evidence submission is currently unavailable.", "FEATURE_DISABLED");
    default:
      return null;
  }
}

function mapSuccessResponse(result: Awaited<ReturnType<SoloPlusBrowserCaseService["submitEvidence"]>>): NextResponse {
  return NextResponse.json(
    {
      kind: "updated",
      case: buildSoloPlusBrowserCaseDto(
        result.caseRecord,
        result.requirements,
        result.latestReviewDecisionEvent,
      ),
    },
    { status: 200 },
  );
}

export function createSoloPlusCaseEvidenceRouteHandler(dependencies: SoloPlusEvidenceRouteDependencies) {
  return async function POST(request: Request): Promise<NextResponse> {
    const guard = await dependencies.requireAuthenticatedSession();
    if (!guard.ok) {
      return buildErrorResponse(
        guard.status,
        guard.error,
        guard.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      );
    }

    try {
      dependencies.assertBrowserMutationOriginRequest?.(request);
    } catch (error) {
      return buildErrorResponse(403, getErrorMessage(error, "Browser mutation request origin is required."), "FORBIDDEN");
    }

    let input: SoloPlusEvidenceSubmissionInput;
    try {
      input = parseEvidenceInput(await readBoundedJsonBody(request, SOLO_PLUS_BROWSER_EVIDENCE_MAX_BODY_BYTES));
    } catch (error) {
      return buildErrorResponse(
        400,
        getErrorMessage(error, "Invalid request body."),
        "INVALID_REQUEST",
      );
    }

    try {
      const service = (await dependencies.createBrowserCaseService()) as SoloPlusBrowserCaseService;
      const result = await service.submitEvidence(input);
      return mapSuccessResponse(result);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) {
        return mapped;
      }

      dependencies.onUnexpectedError?.(error);
      return buildErrorResponse(500, "Solo Plus evidence submission failed unexpectedly.", "INTERNAL_ERROR");
    }
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const [{ createClient }, { createSoloPlusBrowserCaseService }] = await Promise.all([
    import("@/lib/supabase/server"),
    import("@/lib/solo-plus/server/browser-case-service"),
  ]);

  const supabase = await createClient();
  const handler = createSoloPlusCaseEvidenceRouteHandler({
    requireAuthenticatedSession: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        return { ok: false, status: 401, error: "Unauthorized" };
      }

      return { ok: true, userId: user.id, email: user.email || null };
    },
    createBrowserCaseService: () => createSoloPlusBrowserCaseService(),
    assertBrowserMutationOriginRequest: (req) =>
      assertSameOriginBrowserMutationRequest(req, { env: process.env }),
    onUnexpectedError: (error) => {
      console.error("Solo Plus evidence route failed:", error);
    },
  });

  return handler(request);
}
