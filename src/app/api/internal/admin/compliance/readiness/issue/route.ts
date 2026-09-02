import "server-only";

import { createAdminReadinessCorrelationId, createAdminReadinessOperationalEvent } from "@/lib/compliance/server/admin-readiness-route-logging";
import { createAdminReadinessRedactedRuntimeDiagnostic } from "@/lib/compliance/server/admin-readiness-route-security-config";
import { createAdminReadinessRouteSecurityComposition } from "@/lib/compliance/server/admin-readiness-route-security-composition";
import { mapAdminReadinessRouteOutcome } from "@/lib/compliance/server/admin-readiness-route-response";

const ROUTE_GATE_ENV = "DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED";
const STAGING_DIAGNOSTIC_ORIGIN = "https://deraledger-staging.vercel.app";
function routeEnabled(): boolean {
  return process.env[ROUTE_GATE_ENV] === "true";
}

function logStagingOriginDiagnostic(request: Request, requestOrigin: string | null): void {
  // The staging request URL is the non-secret deployment anchor. Do not use
  // the deployment-label environment key here: its absence or invalid value
  // is one of the conditions this temporary diagnostic must reveal.
  try {
    if (new URL(request.url).origin !== STAGING_DIAGNOSTIC_ORIGIN) return;
  } catch {
    return;
  }
  try {
    console.warn("admin_readiness_staging_runtime_diagnostic", createAdminReadinessRedactedRuntimeDiagnostic(requestOrigin));
  } catch {
    // Diagnostics must never alter the opaque client response.
  }
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
  const requestOrigin = request.headers.get("origin");
  const issuance = await security.issueCsrfToken({
    origin: requestOrigin,
    // The token is deliberately scoped to the next non-business snapshot
    // request; this endpoint never issues a readiness approval command.
    operation: "snapshot",
  });
  if (issuance.kind === "deny" && issuance.code === "origin_denied") logStagingOriginDiagnostic(request, requestOrigin);
  return responseFor(correlationId, issuance);
}
