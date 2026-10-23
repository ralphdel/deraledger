import type { NextResponse } from "next/server";

import { isResubmissionIdempotencyKey, isUuid, mapReviewMutationKind } from "@/lib/compliance/review-correction-contract";
import type { ReviewCorrectionService } from "@/lib/compliance/server/review-correction-service";
import {
  hasOnlyKeys,
  mapReviewCorrectionServiceError,
  noStoreJson,
  readJsonObject,
  routeFailure,
} from "@/lib/compliance/server/review-correction-route";

type Dependencies = {
  requireOwnerSession: typeof import("@/lib/server/merchant-owner-session").requireMerchantOwnerSession;
  createService: () => ReviewCorrectionService;
  assertOrigin: (request: Request) => unknown;
  onUnexpectedError?: (error: unknown) => void;
};

export function createMerchantReviewResubmissionRoute(dependencies: Dependencies) {
  return async function POST(request: Request): Promise<NextResponse> {
    try {
      dependencies.assertOrigin(request);
    } catch {
      return routeFailure(403, "FORBIDDEN");
    }
    const session = await dependencies.requireOwnerSession();
    if (!session.ok) return routeFailure(session.status, session.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
    const body = await readJsonObject(request);
    if (!body || !hasOnlyKeys(body, ["reviewId", "requestIdempotencyKey"]) || !isUuid(body.reviewId) || !isResubmissionIdempotencyKey(body.requestIdempotencyKey)) {
      return routeFailure(400, "INVALID_REQUEST");
    }
    try {
      const outcome = await dependencies.createService().resubmitCorrection({
        reviewId: body.reviewId,
        actorId: session.userId,
        merchantId: session.merchantId,
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

export async function POST(request: Request): Promise<NextResponse> {
  const [{ requireMerchantOwnerSession }, { createReviewCorrectionService }, { assertSameOriginBrowserMutationRequest }] = await Promise.all([
    import("@/lib/server/merchant-owner-session"),
    import("@/lib/compliance/server/review-correction-service"),
    import("@/lib/server/browser-origin"),
  ]);
  return createMerchantReviewResubmissionRoute({
    requireOwnerSession: requireMerchantOwnerSession,
    createService: createReviewCorrectionService,
    assertOrigin: assertSameOriginBrowserMutationRequest,
    onUnexpectedError: (error) => console.error("Merchant compliance resubmission failed", error instanceof Error ? error.name : "unknown"),
  })(request);
}
