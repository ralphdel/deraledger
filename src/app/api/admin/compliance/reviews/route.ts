import type { NextResponse } from "next/server";

import type { ReviewCorrectionService } from "@/lib/compliance/server/review-correction-service";
import { noStoreJson, routeFailure } from "@/lib/compliance/server/review-correction-route";

type Dependencies = {
  requireSuperAdminSession: typeof import("@/lib/admin-auth").requireSuperAdminSession;
  createService: () => ReviewCorrectionService;
  onUnexpectedError?: (error: unknown) => void;
};

export function createAdminComplianceReviewsRoute(dependencies: Dependencies) {
  return async function GET(): Promise<NextResponse> {
    const guard = await dependencies.requireSuperAdminSession();
    if (!guard.ok) return routeFailure(guard.status, guard.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
    try {
      return noStoreJson({ reviews: await dependencies.createService().listAdminReviews() });
    } catch (error) {
      dependencies.onUnexpectedError?.(error);
      return routeFailure(500, "INTERNAL_ERROR");
    }
  };
}

export async function GET(): Promise<NextResponse> {
  const [{ requireSuperAdminSession }, { createReviewCorrectionService }] = await Promise.all([
    import("@/lib/admin-auth"), import("@/lib/compliance/server/review-correction-service"),
  ]);
  return createAdminComplianceReviewsRoute({
    requireSuperAdminSession,
    createService: createReviewCorrectionService,
    onUnexpectedError: (error) => console.error("Compliance review queue failed", error instanceof Error ? error.name : "unknown"),
  })();
}
