import "server-only";

import { createAdminReadinessCorrelationId, createAdminReadinessOperationalEvent } from "@/lib/compliance/server/admin-readiness-route-logging";
import {
  createAdminReadinessRedactedRuntimeDiagnostic,
  type AdminReadinessRedactedRuntimeDiagnostic,
} from "@/lib/compliance/server/admin-readiness-route-security-config";
import { createAdminReadinessRouteSecurityComposition } from "@/lib/compliance/server/admin-readiness-route-security-composition";
import { mapAdminReadinessRouteOutcome } from "@/lib/compliance/server/admin-readiness-route-response";

const ROUTE_GATE_ENV = "DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED";
const PRODUCTION_DIAGNOSTIC_ORIGIN = "https://admin.deraledger.com";
const ISSUE_PATH = "/api/internal/admin/compliance/readiness/issue";
function routeEnabled(): boolean {
  return process.env[ROUTE_GATE_ENV] === "true";
}

function productionOriginDiagnostic(
  request: Request,
  requestOrigin: string | null,
): AdminReadinessRedactedRuntimeDiagnostic | null {
  // Temporary smoke diagnostic: both runtime mode and the non-secret request
  // URL must prove this is the exact production admin endpoint.
  if (process.env.NODE_ENV !== "production") return null;
  try {
    const url = new URL(request.url);
    if (url.origin !== PRODUCTION_DIAGNOSTIC_ORIGIN || url.pathname !== ISSUE_PATH) return null;
  } catch {
    return null;
  }
  try {
    return createAdminReadinessRedactedRuntimeDiagnostic(requestOrigin);
  } catch {
    // Diagnostic failure must preserve the normal origin_denied response.
    return null;
  }
}

function responseFor(
  correlationId: string,
  outcome: unknown,
  productionDiagnostic: AdminReadinessRedactedRuntimeDiagnostic | null = null,
): Response {
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

  // Remove this temporary field as soon as the production smoke failure is
  // classified. No successful or non-production response receives it.
  const body = productionDiagnostic ? { ...envelope.body, productionDiagnostic } : envelope.body;
  return Response.json(body, {
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
  const productionDiagnostic = issuance.kind === "deny" && issuance.code === "origin_denied"
    ? productionOriginDiagnostic(request, requestOrigin)
    : null;
  return responseFor(correlationId, issuance, productionDiagnostic);
}
