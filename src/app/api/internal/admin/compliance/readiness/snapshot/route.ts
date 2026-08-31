import "server-only";

import { createCanonicalApprovalReadinessServerService } from "@/lib/compliance/server/canonical-approval-readiness-service-factory";
import { readAdminReadinessJsonBody } from "@/lib/compliance/server/admin-readiness-route-json";
import { createAdminReadinessCorrelationId, createAdminReadinessOperationalEvent } from "@/lib/compliance/server/admin-readiness-route-logging";
import { createAdminReadinessRouteSecurityComposition } from "@/lib/compliance/server/admin-readiness-route-security-composition";
import { mapAdminReadinessRouteOutcome } from "@/lib/compliance/server/admin-readiness-route-response";
import { validateAdminReadinessSnapshot } from "@/lib/compliance/server/admin-readiness-route-validation";

const ROUTE_GATE_ENV = "DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED";
function routeEnabled(): boolean {
  return process.env[ROUTE_GATE_ENV] === "true";
}

function responseFor(correlationId: string, outcome: unknown): Response {
  const envelope = mapAdminReadinessRouteOutcome(outcome);
  const event = createAdminReadinessOperationalEvent({
    operation: "snapshot",
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

/** Projects the approved public snapshot before the mapper validates it. */
function publicOutcome(outcome: Awaited<ReturnType<ReturnType<typeof createCanonicalApprovalReadinessServerService>["readSnapshot"]>>): unknown {
  if (outcome.kind !== "ready") return outcome;
  const snapshot = outcome.snapshot;
  return {
    kind: "ready",
    snapshot: {
      decisionRequestId: snapshot.decisionRequestId,
      profileId: snapshot.profileId,
      planCode: snapshot.planCode,
      currentComplianceStatus: snapshot.currentComplianceStatus,
      sourceType: snapshot.sourceType,
      sourceVersion: snapshot.sourceVersion,
      expectedProfileRowVersion: snapshot.expectedProfileRowVersion,
      policyVersion: snapshot.policyVersion,
      reasonCode: snapshot.reasonCode,
      targetComplianceStatus: snapshot.targetComplianceStatus,
    },
    diagnostics: [],
  };
}

export async function POST(request: Request): Promise<Response> {
  const correlationId = createAdminReadinessCorrelationId();
  // This is deliberately the first operational gate: disabled routes never
  // construct security/service dependencies or read request-derived evidence.
  if (!routeEnabled()) return responseFor(correlationId, { kind: "unavailable" });
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

  const validation = validateAdminReadinessSnapshot(parsed.value);
  if (!validation.ok) return responseFor(correlationId, { kind: "validation_denied" });

  const security = createAdminReadinessRouteSecurityComposition();
  if (!security.checkOrigin(request.headers.get("origin")).ok) {
    return responseFor(correlationId, { kind: "validation_denied" });
  }

  const csrf = await security.validateCsrf({
    operation: "snapshot",
    method: "POST",
    csrfEvidence: request.headers.get("x-deraledger-readiness-csrf"),
  });
  if (csrf.kind === "deny") return responseFor(correlationId, { kind: "csrf_denied" });
  if (csrf.kind !== "allow") return responseFor(correlationId, { kind: "unavailable" });

  const throttle = await security.checkThrottle({
    operation: "snapshot",
  });
  if (throttle.kind === "deny") return responseFor(correlationId, { kind: "throttled" });
  if (throttle.kind !== "allow") return responseFor(correlationId, { kind: "unavailable" });

  try {
    const service = createCanonicalApprovalReadinessServerService();
    return responseFor(correlationId, publicOutcome(await service.readSnapshot(validation.command)));
  } catch {
    return responseFor(correlationId, { kind: "unavailable" });
  }
}
