import { NextResponse } from "next/server";

import type { SoloPlusCaseEventRecord, SoloPlusCaseMutationResult, SoloPlusCaseRecord } from "@/lib/solo-plus/repository";
import type {
  ReviewSoloPlusCaseInput,
  SoloPlusReviewerDecision,
} from "@/lib/solo-plus/server/review-service";
import { assertSameOriginBrowserMutationRequest } from "@/lib/server/browser-origin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_DECISIONS = new Set<SoloPlusReviewerDecision>([
  "request_more_information",
  "approve",
  "reject",
  "reopen",
]);

const ALLOWED_FIELDS = new Set([
  "caseId",
  "expectedRowVersion",
  "requestIdempotencyKey",
  "decision",
  "reason",
]);

const REJECTED_AUTHORITY_FIELDS = new Set([
  "reviewerId",
  "reviewerAdminId",
  "actorId",
  "actorType",
  "merchantId",
  "policyVersion",
  "accessContext",
  "serviceRoleKey",
  "serviceRoleToken",
  "event",
  "patch",
  "targetStatus",
  "newState",
]);

type RequireSuperAdminSessionFn = typeof import("@/lib/admin-auth").requireSuperAdminSession;
type CreateSoloPlusReviewerServiceFn =
  typeof import("@/lib/solo-plus/server/review-service").createSoloPlusReviewerService;

type SoloPlusReviewRouteDependencies = {
  requireSuperAdminSession: RequireSuperAdminSessionFn;
  createReviewerService: CreateSoloPlusReviewerServiceFn;
  assertBrowserMutationOriginRequest?: typeof assertSameOriginBrowserMutationRequest;
  onUnexpectedError?: (error: unknown) => void;
};

type ReviewRouteInput = ReviewSoloPlusCaseInput;

type ReviewRouteErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "STATE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalReason(value: unknown): string | null {
  return hasNonEmptyString(value) ? value.trim() : null;
}

function buildErrorResponse(
  status: number,
  error: string,
  code: ReviewRouteErrorCode,
): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

function mapCaseRecord(caseRecord: SoloPlusCaseRecord) {
  return {
    id: caseRecord.id,
    caseStatus: caseRecord.caseStatus,
    paymentStatus: caseRecord.paymentStatus,
    refundStatus: caseRecord.refundStatus,
    rowVersion: caseRecord.rowVersion,
    approvedAt: caseRecord.approvedAt,
    approvedByAdminId: caseRecord.approvedByAdminId,
    rejectedAt: caseRecord.rejectedAt,
    rejectedByAdminId: caseRecord.rejectedByAdminId,
    rejectionReason: caseRecord.rejectionReason,
    reopenedAt: caseRecord.reopenedAt,
    reopenedByAdminId: caseRecord.reopenedByAdminId,
    updatedAt: caseRecord.updatedAt,
  };
}

function mapEventRecord(event: SoloPlusCaseEventRecord | null) {
  if (!event) {
    return null;
  }

  return {
    id: event.id,
    eventType: event.eventType,
    actorType: event.actorType,
    actorId: event.actorId,
    requestIdempotencyKey: event.requestIdempotencyKey,
    reason: event.reason,
    policyVersion: event.policyVersion,
    createdAt: event.createdAt,
  };
}

function mapSuccessResponse(result: SoloPlusCaseMutationResult): NextResponse {
  return NextResponse.json(
    {
      kind: result.outcome,
      case: mapCaseRecord(result.caseRecord),
      event: mapEventRecord(result.event),
    },
    { status: 200 },
  );
}

function assertDecision(value: unknown): SoloPlusReviewerDecision {
  if (!hasNonEmptyString(value)) {
    throw new Error("Decision is required.");
  }

  const normalized = value.trim() as SoloPlusReviewerDecision;
  if (!ALLOWED_DECISIONS.has(normalized)) {
    throw new Error("Decision must be one of request_more_information, approve, reject, or reopen.");
  }

  return normalized;
}

function assertCaseId(value: unknown): string {
  if (!hasNonEmptyString(value) || !UUID_PATTERN.test(value.trim())) {
    throw new Error("caseId must be a valid UUID.");
  }

  return value.trim();
}

function assertExpectedRowVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("expectedRowVersion must be a non-negative safe integer.");
  }

  return value;
}

function assertRequestIdempotencyKey(value: unknown): string {
  if (!hasNonEmptyString(value)) {
    throw new Error("requestIdempotencyKey is required.");
  }

  return value.trim();
}

function parseReviewRouteInput(payload: unknown): ReviewRouteInput {
  if (!isRecord(payload)) {
    throw new Error("Invalid request body.");
  }

  for (const key of Object.keys(payload)) {
    if (REJECTED_AUTHORITY_FIELDS.has(key)) {
      throw new Error(`Client-supplied ${key} is not allowed.`);
    }

    if (!ALLOWED_FIELDS.has(key)) {
      throw new Error(`Unexpected request field: ${key}.`);
    }
  }

  const decision = assertDecision(payload.decision);
  const reason = normalizeOptionalReason(payload.reason);

  if ((decision === "request_more_information" || decision === "reject") && !reason) {
    throw new Error(`reason is required for ${decision}.`);
  }

  return {
    caseId: assertCaseId(payload.caseId),
    expectedRowVersion: assertExpectedRowVersion(payload.expectedRowVersion),
    requestIdempotencyKey: assertRequestIdempotencyKey(payload.requestIdempotencyKey),
    decision,
    reason,
  };
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

function mapDomainError(error: unknown): NextResponse | null {
  const code = getErrorCode(error);
  const message = getErrorMessage(error, "Solo Plus review decision failed.");

  switch (code) {
    case "SOLO_PLUS_SERVER_UNAUTHORIZED":
      return buildErrorResponse(401, message, "UNAUTHORIZED");
    case "SOLO_PLUS_SERVER_FORBIDDEN":
    case "SOLO_PLUS_ACCESS_DENIED":
    case "SOLO_PLUS_CASE_OWNERSHIP_CONFLICT":
      return buildErrorResponse(403, message, "FORBIDDEN");
    case "SOLO_PLUS_CASE_NOT_FOUND":
      return buildErrorResponse(404, message, "NOT_FOUND");
    case "SOLO_PLUS_INVALID_REVIEW_INPUT":
      return buildErrorResponse(400, message, "INVALID_REQUEST");
    case "SOLO_PLUS_CASE_VERSION_CONFLICT":
      return buildErrorResponse(409, message, "VERSION_CONFLICT");
    case "SOLO_PLUS_CASE_STATE_CONFLICT":
      return buildErrorResponse(409, message, "STATE_CONFLICT");
    case "SOLO_PLUS_IDEMPOTENCY_CONFLICT":
      return buildErrorResponse(409, message, "IDEMPOTENCY_CONFLICT");
    default:
      return null;
  }
}

export function createSoloPlusReviewRouteHandler(
  dependencies: SoloPlusReviewRouteDependencies,
) {
  return async function POST(request: Request): Promise<NextResponse> {
    const guard = await dependencies.requireSuperAdminSession();
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
      const message = getErrorMessage(error, "Browser mutation request origin is required.");
      return buildErrorResponse(403, message, "FORBIDDEN");
    }

    let input: ReviewRouteInput;
    try {
      input = parseReviewRouteInput(await request.json());
    } catch (error) {
      return buildErrorResponse(
        400,
        getErrorMessage(error, "Invalid request body."),
        "INVALID_REQUEST",
      );
    }

    try {
      const reviewerService = await dependencies.createReviewerService();
      const result = await reviewerService.reviewCase(input);
      return mapSuccessResponse(result);
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) {
        return mapped;
      }

      dependencies.onUnexpectedError?.(error);
      return buildErrorResponse(
        500,
        "Solo Plus review decision failed unexpectedly.",
        "INTERNAL_ERROR",
      );
    }
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const [{ requireSuperAdminSession }, { createSoloPlusReviewerService }] =
    await Promise.all([
      import("@/lib/admin-auth"),
      import("@/lib/solo-plus/server/review-service"),
    ]);

  const handler = createSoloPlusReviewRouteHandler({
    requireSuperAdminSession,
    createReviewerService: createSoloPlusReviewerService,
    assertBrowserMutationOriginRequest: (req) =>
      assertSameOriginBrowserMutationRequest(req, { env: process.env }),
    onUnexpectedError: (error) => {
      console.error("Solo Plus review route failed:", error);
    },
  });

  return handler(request);
}
