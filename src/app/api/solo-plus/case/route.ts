import { NextResponse } from "next/server";

import type {
  SoloPlusCaseEventRecord,
  SoloPlusCaseCreationResult,
  SoloPlusCaseRecord,
  SoloPlusCaseRequirementRecord,
} from "@/lib/solo-plus/repository";
import type {
  SoloPlusBrowserCaseService,
} from "@/lib/solo-plus/server/browser-case-service";
import {
  assertBoundedText,
  assertNoForbiddenFields,
  assertPlainRecordBody,
  assertUuid,
  buildSoloPlusBrowserCaseDto,
  readBoundedJsonBody,
  SOLO_PLUS_BROWSER_CREATE_MAX_BODY_BYTES,
} from "@/lib/solo-plus/server/route-contracts";
import { assertSameOriginBrowserMutationRequest } from "@/lib/server/browser-origin";

type RequireAuthenticatedSessionResult =
  | { ok: true; userId: string; email: string | null }
  | { ok: false; status: number; error: string };

type RequireAuthenticatedSessionFn = () => Promise<RequireAuthenticatedSessionResult>;
type CreateBrowserCaseServiceFn =
  typeof import("@/lib/solo-plus/server/browser-case-service").createSoloPlusBrowserCaseService;
type BrowserMutationOriginGuardFn = typeof assertSameOriginBrowserMutationRequest;

type SoloPlusCaseRouteDependencies = {
  requireAuthenticatedSession: RequireAuthenticatedSessionFn;
  createBrowserCaseService: CreateBrowserCaseServiceFn;
  assertBrowserMutationOriginRequest?: BrowserMutationOriginGuardFn;
  onUnexpectedError?: (error: unknown) => void;
};

type SoloPlusCaseFlowOrigin = "onboarding" | "upgrade";

type SoloPlusCaseCreateInput = {
  flowOrigin: SoloPlusCaseFlowOrigin;
  requestIdempotencyKey: string;
  onboardingSessionId?: string | null;
};

type SoloPlusCaseReadInput = {
  caseId?: string | null;
  onboardingSessionId?: string | null;
};

const CREATE_ALLOWED_FIELDS = [
  "flowOrigin",
  "requestIdempotencyKey",
  "onboardingSessionId",
] as const;

const CREATE_FORBIDDEN_FIELDS = [
  "caseId",
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
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildErrorResponse(status: number, error: string, code: string): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

function buildPrivateNoStoreHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store, max-age=0",
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

function assertFlowOrigin(value: unknown): SoloPlusCaseFlowOrigin {
  const normalized = assertBoundedText(value, "flowOrigin", 16, true);
  if (normalized !== "onboarding" && normalized !== "upgrade") {
    throw new Error("flowOrigin must be onboarding or upgrade.");
  }

  return normalized;
}

function parseCreateInput(payload: unknown): SoloPlusCaseCreateInput {
  const body = assertPlainRecordBody(payload);
  assertNoForbiddenFields(body, CREATE_ALLOWED_FIELDS, CREATE_FORBIDDEN_FIELDS);

  const flowOrigin = assertFlowOrigin(body.flowOrigin);
  const requestIdempotencyKey = assertBoundedText(body.requestIdempotencyKey, "requestIdempotencyKey", 128, true);
  const onboardingSessionId =
    flowOrigin === "onboarding"
      ? assertUuid(body.onboardingSessionId, "onboardingSessionId")
      : body.onboardingSessionId == null
      ? null
      : (() => {
          throw new Error("onboardingSessionId is not allowed for upgrade case creation.");
        })();

  return {
    flowOrigin,
    requestIdempotencyKey,
    onboardingSessionId,
  };
}

function parseReadInput(request: Request): SoloPlusCaseReadInput {
  const url = new URL(request.url);
  const caseId = url.searchParams.get("caseId");
  const onboardingSessionId = url.searchParams.get("onboardingSessionId");

  return {
    caseId: caseId ? assertUuid(caseId, "caseId") : null,
    onboardingSessionId: onboardingSessionId ? assertUuid(onboardingSessionId, "onboardingSessionId") : null,
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
  const message = getErrorMessage(error, "Solo Plus case operation failed.");

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
    case "SOLO_PLUS_INVALID_CREATION_INPUT":
      return buildErrorResponse(400, message, "INVALID_REQUEST");
    case "SOLO_PLUS_CASE_VERSION_CONFLICT":
      return buildErrorResponse(409, "Solo Plus case version no longer matches the current record.", "VERSION_CONFLICT");
    case "SOLO_PLUS_CASE_STATE_CONFLICT":
      return buildErrorResponse(409, "Solo Plus case is not in a valid state for this request.", "STATE_CONFLICT");
    case "SOLO_PLUS_IDEMPOTENCY_CONFLICT":
      return buildErrorResponse(409, "Solo Plus request idempotency key conflicts with a different request.", "IDEMPOTENCY_CONFLICT");
    case "SOLO_PLUS_FEATURE_DISABLED":
      return buildErrorResponse(409, "Solo Plus is currently unavailable.", "FEATURE_DISABLED");
    default:
      return null;
  }
}

function mapCreateResponse(
  result: Awaited<ReturnType<SoloPlusBrowserCaseService["createOrResumeCase"]>>,
): NextResponse {
  return NextResponse.json(
    {
      kind: result.outcome,
      case: buildSoloPlusBrowserCaseDto(
        result.caseRecord,
        result.requirements,
        "latestReviewDecisionEvent" in result ? result.latestReviewDecisionEvent : null,
      ),
      event: mapEventRecord(result.createdEvent),
    },
    { status: 200 },
  );
}

export function createSoloPlusCaseRouteHandler(dependencies: SoloPlusCaseRouteDependencies) {
  return {
    async GET(request: Request): Promise<NextResponse> {
      const guard = await dependencies.requireAuthenticatedSession();
      if (!guard.ok) {
        return buildErrorResponse(
          guard.status,
          guard.error,
          guard.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
        );
      }

      try {
        const service = (await dependencies.createBrowserCaseService()) as SoloPlusBrowserCaseService;
        const result = await service.readCurrentCase(parseReadInput(request));
        if (!result) {
          return buildErrorResponse(404, "Solo Plus case was not found.", "NOT_FOUND");
        }

        return NextResponse.json(
          {
            kind: "current_case",
            case: buildSoloPlusBrowserCaseDto(
              result.caseRecord,
              result.requirements as SoloPlusCaseRequirementRecord[],
              result.latestReviewDecisionEvent,
            ),
          },
          {
            status: 200,
            headers: buildPrivateNoStoreHeaders(),
          },
        );
      } catch (error) {
        const mapped = mapDomainError(error);
        if (mapped) {
          return mapped;
        }

        dependencies.onUnexpectedError?.(error);
        return buildErrorResponse(500, "Solo Plus case lookup failed unexpectedly.", "INTERNAL_ERROR");
      }
    },

    async POST(request: Request): Promise<NextResponse> {
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
        const mapped = mapDomainError(error);
        if (mapped) {
          return mapped;
        }

        return buildErrorResponse(403, getErrorMessage(error, "Browser mutation request origin is required."), "FORBIDDEN");
      }

      let input: SoloPlusCaseCreateInput;
      try {
        input = parseCreateInput(await readBoundedJsonBody(request, SOLO_PLUS_BROWSER_CREATE_MAX_BODY_BYTES));
      } catch (error) {
        return buildErrorResponse(
          400,
          getErrorMessage(error, "Invalid request body."),
          "INVALID_REQUEST",
        );
      }

      try {
        const service = (await dependencies.createBrowserCaseService()) as SoloPlusBrowserCaseService;
        const result = await service.createOrResumeCase(input);
        return mapCreateResponse(result);
      } catch (error) {
        const mapped = mapDomainError(error);
        if (mapped) {
          return mapped;
        }

        dependencies.onUnexpectedError?.(error);
        return buildErrorResponse(500, "Solo Plus case creation failed unexpectedly.", "INTERNAL_ERROR");
      }
    },
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const [{ createClient }, { createSoloPlusBrowserCaseService }] = await Promise.all([
    import("@/lib/supabase/server"),
    import("@/lib/solo-plus/server/browser-case-service"),
  ]);

  const supabase = await createClient();
  const handler = createSoloPlusCaseRouteHandler({
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
    onUnexpectedError: (error) => {
      console.error("Solo Plus case GET route failed:", error);
    },
  });

  return handler.GET(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  const [{ createClient }, { createSoloPlusBrowserCaseService }] = await Promise.all([
    import("@/lib/supabase/server"),
    import("@/lib/solo-plus/server/browser-case-service"),
  ]);

  const supabase = await createClient();
  const handler = createSoloPlusCaseRouteHandler({
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
      console.error("Solo Plus case POST route failed:", error);
    },
  });

  return handler.POST(request);
}
