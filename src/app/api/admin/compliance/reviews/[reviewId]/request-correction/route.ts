import type { NextResponse } from "next/server";

import {
  isRequestIdempotencyKey,
  isReviewCorrectionReasonCode,
  isUuid,
  mapReviewMutationKind,
  normalizeRequestedFindingCodes,
} from "@/lib/compliance/review-correction-contract";
import type { ReviewCorrectionService } from "@/lib/compliance/server/review-correction-service";
import {
  hasOnlyKeys,
  mapReviewCorrectionServiceError,
  noStoreJson,
  readJsonObject,
  routeFailure,
} from "@/lib/compliance/server/review-correction-route";

type Dependencies = {
  requireSuperAdminSession: typeof import("@/lib/admin-auth").requireSuperAdminSession;
  createService: () => ReviewCorrectionService;
  assertOrigin: (request: Request) => unknown;
  onUnexpectedError?: (error: unknown) => void;
};

export function createRequestReviewCorrectionRoute(dependencies: Dependencies) {
  return async function POST(request: Request, context: { params: Promise<{ reviewId: string }> }): Promise<NextResponse> {
    try {
      dependencies.assertOrigin(request);
    } catch {
      return routeFailure(403, "FORBIDDEN");
    }
    const guard = await dependencies.requireSuperAdminSession();
    if (!guard.ok) return routeFailure(guard.status, guard.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
    const { reviewId } = await context.params;
    const body = await readJsonObject(request);
    if (!isUuid(reviewId) || !body || !hasOnlyKeys(body, ["reasonCode", "requestedFindingCodes", "requestIdempotencyKey"])) {
      return routeFailure(400, "INVALID_REQUEST");
    }
    const codes = normalizeRequestedFindingCodes(body.requestedFindingCodes);
    if (!isReviewCorrectionReasonCode(body.reasonCode) || !codes || !isRequestIdempotencyKey(body.requestIdempotencyKey)) {
      return routeFailure(400, "INVALID_REQUEST");
    }
    try {
      const outcome = await dependencies.createService().requestCorrection({
        reviewId,
        reviewerId: guard.userId,
        reasonCode: body.reasonCode,
        requestedFindingCodes: codes,
        idempotencyKey: body.requestIdempotencyKey,
      });
      const mapped = mapReviewMutationKind(outcome.result.kind);
      return noStoreJson({ ...mapped.body, review: outcome.review }, mapped.status);
    } catch (error) {
      const mapped = mapReviewCorrectionServiceError(error);
      if (mapped) return mapped;
      dependencies.onUnexpectedError?.(error);
      return routeFailure(500, "INTERNAL_ERROR");
    }
  };
}

export async function POST(request: Request, context: { params: Promise<{ reviewId: string }> }): Promise<NextResponse> {
  const [{ requireSuperAdminSession }, { createReviewCorrectionService }, { assertSameOriginBrowserMutationRequest }] = await Promise.all([
    import("@/lib/admin-auth"),
    import("@/lib/compliance/server/review-correction-service"),
    import("@/lib/server/browser-origin"),
  ]);
  return createRequestReviewCorrectionRoute({
    requireSuperAdminSession,
    createService: createReviewCorrectionService,
    assertOrigin: assertSameOriginBrowserMutationRequest,
    onUnexpectedError: (error) => console.error("Compliance correction request failed", error instanceof Error ? error.name : "unknown"),
  })(request, context);
}
