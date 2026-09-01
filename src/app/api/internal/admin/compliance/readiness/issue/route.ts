import "server-only";

import { createAdminReadinessCorrelationId, createAdminReadinessOperationalEvent } from "@/lib/compliance/server/admin-readiness-route-logging";
import { createAdminReadinessRouteSecurityComposition } from "@/lib/compliance/server/admin-readiness-route-security-composition";
import { mapAdminReadinessRouteOutcome } from "@/lib/compliance/server/admin-readiness-route-response";

const ROUTE_GATE_ENV = "DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED";
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

export async function POST(request: Request): Promise<Response> {
  const correlationId = createAdminReadinessCorrelationId();
  // This is deliberately the first operational gate: disabled routes never
  // construct security/service dependencies or read request-derived evidence.
  if (!routeEnabled()) return responseFor(correlationId, { kind: "unavailable" });
  const security = createAdminReadinessRouteSecurityComposition();
  const issuance = await security.issueCsrfToken({
    origin: request.headers.get("origin"),
    // The token is deliberately scoped to the next non-business snapshot
    // request; this endpoint never issues a readiness approval command.
    operation: "snapshot",
  });
  return responseFor(correlationId, issuance);
}
