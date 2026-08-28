import "server-only";

import { createCanonicalApprovalReadinessServerService } from "@/lib/compliance/server/canonical-approval-readiness-service-factory";
import { readAdminReadinessJsonBody } from "@/lib/compliance/server/admin-readiness-route-json";
import { createAdminReadinessCorrelationId, createAdminReadinessOperationalEvent } from "@/lib/compliance/server/admin-readiness-route-logging";
import { createAdminReadinessRouteSecurityComposition } from "@/lib/compliance/server/admin-readiness-route-security-composition";
import { mapAdminReadinessRouteOutcome } from "@/lib/compliance/server/admin-readiness-route-response";
import { validateAdminReadinessIssue } from "@/lib/compliance/server/admin-readiness-route-validation";

const ROUTE_GATE_ENV = "DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED";
const OPERATION_THROTTLE_SUBJECT_HASH = "f61e079ce40366d3054e5c75d2ed4cc884c2a3a3d876c71dc54701021341a254";

function routeEnabled(): boolean {
  return process.env[ROUTE_GATE_ENV] === "true";
}

function responseFor(correlationId: string, outcome: unknown): Response {
  const envelope = mapAdminReadinessRouteOutcome(outcome);
  const event = createAdminReadinessOperationalEvent({
    operation: "issue",
    correlationId,
    resultKind: envelope.body.kind,
    resultCode: envelope.body.code,
  });

  if (event) {
    try {
      console.info("admin_readiness_route", event);
    } catch {
      // Logging is operational only and cannot alter the safe response.
    }
  }

  return Response.json(envelope.body, {
    status: envelope.status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Keeps internal readiness fields out of the route response mapper input. */
function publicOutcome(outcome: Awaited<ReturnType<ReturnType<typeof createCanonicalApprovalReadinessServerService>["issue"]>>): unknown {
  if (outcome.kind === "created" || outcome.kind === "replay") {
    return { kind: outcome.kind, decisionRequestId: outcome.decisionRequestId };
  }
  return outcome;
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = createAdminReadinessCorrelationId();
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return responseFor(correlationId, { kind: "unavailable" });
  }

  const parsed = readAdminReadinessJsonBody({
    contentType: request.headers.get("content-type"),
    rawBody,
  });
  if (!parsed.ok) return responseFor(correlationId, { kind: "validation_denied" });

  const validation = validateAdminReadinessIssue(parsed.value);
  if (!validation.ok) return responseFor(correlationId, { kind: "validation_denied" });

  const security = createAdminReadinessRouteSecurityComposition();
  if (!security.checkOrigin(request.headers.get("origin")).ok) {
    return responseFor(correlationId, { kind: "validation_denied" });
  }

  const csrf = await security.validateCsrf({
    operation: "issue",
    method: "POST",
    csrfEvidence: request.headers.get("x-deraledger-readiness-csrf"),
  });
  if (csrf.kind === "deny") return responseFor(correlationId, { kind: "csrf_denied" });
  if (csrf.kind !== "allow") return responseFor(correlationId, { kind: "unavailable" });

  const throttle = await security.checkThrottle({
    operation: "issue",
    // This opaque, operation-level bucket is not identity or reviewer authority.
    subjectHash: OPERATION_THROTTLE_SUBJECT_HASH,
  });
  if (throttle.kind === "deny") return responseFor(correlationId, { kind: "throttled" });
  if (throttle.kind !== "allow") return responseFor(correlationId, { kind: "unavailable" });

  if (!routeEnabled()) return responseFor(correlationId, { kind: "unavailable" });

  try {
    const service = createCanonicalApprovalReadinessServerService();
    return responseFor(correlationId, publicOutcome(await service.issue(validation.command)));
  } catch {
    return responseFor(correlationId, { kind: "unavailable" });
  }
}
