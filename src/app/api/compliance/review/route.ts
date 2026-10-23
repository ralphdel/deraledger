import type { NextResponse } from "next/server";

import type { ReviewCorrectionService } from "@/lib/compliance/server/review-correction-service";
import { mapReviewCorrectionServiceError, noStoreJson, routeFailure } from "@/lib/compliance/server/review-correction-route";

type Dependencies = {
  requireOwnerSession: typeof import("@/lib/server/merchant-owner-session").requireMerchantOwnerSession;
  createService: () => ReviewCorrectionService;
  onUnexpectedError?: (error: unknown) => void;
};

export function createMerchantComplianceReviewRoute(dependencies: Dependencies) {
  return async function GET(): Promise<NextResponse> {
    const session = await dependencies.requireOwnerSession();
    if (!session.ok) return routeFailure(session.status, session.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
    try {
      return noStoreJson({ state: await dependencies.createService().getMerchantReviewState(session.userId, session.merchantId) });
    } catch (error) {
      const mapped = mapReviewCorrectionServiceError(error);
      if (mapped) return mapped;
      dependencies.onUnexpectedError?.(error);
      return routeFailure(500, "INTERNAL_ERROR");
    }
  };
}

export async function GET(): Promise<NextResponse> {
  const [{ requireMerchantOwnerSession }, { createReviewCorrectionService }] = await Promise.all([
    import("@/lib/server/merchant-owner-session"), import("@/lib/compliance/server/review-correction-service"),
  ]);
  return createMerchantComplianceReviewRoute({
    requireOwnerSession: requireMerchantOwnerSession,
    createService: createReviewCorrectionService,
    onUnexpectedError: (error) => console.error("Merchant compliance review read failed", error instanceof Error ? error.name : "unknown"),
  })();
}
