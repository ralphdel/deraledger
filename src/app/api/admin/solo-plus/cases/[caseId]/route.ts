import { NextResponse } from "next/server";

import type { SoloPlusAdminReadService } from "@/lib/solo-plus/server/admin-read-service";
import {
  assertUuid,
  parseSoloPlusAdminCaseDetailQuery,
} from "@/lib/solo-plus/server/route-contracts";

type RequireSuperAdminSessionFn = typeof import("@/lib/admin-auth").requireSuperAdminSession;
type CreateSoloPlusAdminReadServiceFn =
  typeof import("@/lib/solo-plus/server/admin-read-service").createSoloPlusAdminReadService;

type SoloPlusAdminCaseDetailRouteDependencies = {
  requireSuperAdminSession: RequireSuperAdminSessionFn;
  createAdminReadService: CreateSoloPlusAdminReadServiceFn;
  onUnexpectedError?: (error: unknown) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildErrorResponse(status: number, error: string, code: string): NextResponse {
  return NextResponse.json(
    { error, code },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    },
  );
}

function getErrorCode(error: unknown): string | null {
  if (!isRecord(error) || typeof error.code !== "string") {
    return null;
  }

  return error.code;
}

function mapDomainError(error: unknown): NextResponse | null {
  switch (getErrorCode(error)) {
    case "SOLO_PLUS_SERVER_UNAUTHORIZED":
      return buildErrorResponse(401, "Unauthorized", "UNAUTHORIZED");
    case "SOLO_PLUS_SERVER_FORBIDDEN":
      return buildErrorResponse(403, "SuperAdmin access required", "FORBIDDEN");
    default:
      return null;
  }
}

export function createSoloPlusAdminCaseDetailRouteHandler(
  dependencies: SoloPlusAdminCaseDetailRouteDependencies,
) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ caseId: string }> },
  ): Promise<NextResponse> {
    const guard = await dependencies.requireSuperAdminSession();
    if (!guard.ok) {
      return buildErrorResponse(
        guard.status,
        guard.error,
        guard.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
      );
    }

    let caseId: string;
    let historyInput;
    try {
      const params = await context.params;
      caseId = assertUuid(params.caseId, "caseId");
      historyInput = parseSoloPlusAdminCaseDetailQuery(request);
    } catch (error) {
      return buildErrorResponse(
        400,
        error instanceof Error ? error.message : "Invalid request.",
        "INVALID_REQUEST",
      );
    }

    try {
      const service = (await dependencies.createAdminReadService()) as SoloPlusAdminReadService;
      const result = await service.getCaseDetail(caseId, {
        cursor: historyInput.historyCursor,
        limit: historyInput.historyLimit,
      });
      if (!result) {
        return buildErrorResponse(404, "Solo Plus case was not found.", "NOT_FOUND");
      }

      return NextResponse.json(result, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      });
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) {
        return mapped;
      }

      dependencies.onUnexpectedError?.(error);
      return buildErrorResponse(
        500,
        "Solo Plus admin case detail failed unexpectedly.",
        "INTERNAL_ERROR",
      );
    }
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
): Promise<NextResponse> {
  const [{ requireSuperAdminSession }, { createSoloPlusAdminReadService }] = await Promise.all([
    import("@/lib/admin-auth"),
    import("@/lib/solo-plus/server/admin-read-service"),
  ]);

  const handler = createSoloPlusAdminCaseDetailRouteHandler({
    requireSuperAdminSession,
    createAdminReadService: createSoloPlusAdminReadService,
    onUnexpectedError: (error) => {
      console.error("Solo Plus admin case detail route failed:", error);
    },
  });

  return handler(request, context);
}
