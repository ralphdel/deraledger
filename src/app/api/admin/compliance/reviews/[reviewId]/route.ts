import type { NextResponse } from "next/server";

import { isUuid } from "@/lib/compliance/review-correction-contract";
import type { ReviewCorrectionService } from "@/lib/compliance/server/review-correction-service";
import { noStoreJson, routeFailure } from "@/lib/compliance/server/review-correction-route";

type Dependencies = {
  requireSuperAdminSession: typeof import("@/lib/admin-auth").requireSuperAdminSession;
  createService: () => ReviewCorrectionService;
  onUnexpectedError?: (error: unknown) => void;
};

export function createAdminComplianceReviewDetailRoute(dependencies: Dependencies) {
  return async function GET(_request: Request, context: { params: Promise<{ reviewId: string }> }): Promise<NextResponse> {
    const guard = await dependencies.requireSuperAdminSession();
    if (!guard.ok) return routeFailure(guard.status, guard.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
    const { reviewId } = await context.params;
    if (!isUuid(reviewId)) return routeFailure(400, "INVALID_REQUEST");
    try {
      const review = await dependencies.createService().getAdminReview(reviewId);
      return review ? noStoreJson({ review }) : routeFailure(404, "NOT_FOUND");
    } catch (error) {
      dependencies.onUnexpectedError?.(error);
      return routeFailure(500, "INTERNAL_ERROR");
    }
  };
}

export async function GET(request: Request, context: { params: Promise<{ reviewId: string }> }): Promise<NextResponse> {
  const [{ requireSuperAdminSession }, { createReviewCorrectionService }] = await Promise.all([
    import("@/lib/admin-auth"), import("@/lib/compliance/server/review-correction-service"),
  ]);
  return createAdminComplianceReviewDetailRoute({
    requireSuperAdminSession,
    createService: createReviewCorrectionService,
    onUnexpectedError: (error) => console.error("Compliance review detail failed", error instanceof Error ? error.name : "unknown"),
  })(request, context);
}
