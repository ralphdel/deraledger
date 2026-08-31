import "server-only";

import type { AdminReadinessCsrfStorage } from "./admin-readiness-csrf-storage";
import type { AdminReadinessCsrfIssuedToken } from "./admin-readiness-csrf-issuer";
import { createAdminReadinessRouteSecurityConfiguration } from "./admin-readiness-route-security-config";
import { createAdminReadinessConfiguredOriginChecker } from "./admin-readiness-route-cors";
import { createAdminReadinessLifecycleCsrfValidator, type AdminReadinessCsrfInput } from "./admin-readiness-route-csrf";
import { createAdminReadinessConfiguredRouteThrottle } from "./admin-readiness-route-rate-limit";
import type { AdminReadinessThrottleEnvironment, AdminReadinessThrottleStorage } from "./admin-readiness-throttle-config";

type Operation = "issue" | "snapshot";
type SecurityContextReader = { readSecurityContext(): Promise<Readonly<{ sessionBindingReference: string; throttleSubjectHash: string }> | null> };
type AdminAuthorizer = { isCurrentRequestAdmin(): Promise<boolean> };
type CsrfIssuer = {
  issue(input: Readonly<{ operation: Operation; method: "POST"; sessionBindingReference: string }>): Promise<AdminReadinessCsrfIssuedToken | null>;
  rotate(input: Readonly<{ operation: Operation; method: "POST"; sessionBindingReference: string; previousToken: string }>): Promise<AdminReadinessCsrfIssuedToken | null>;
  invalidateSessionBinding(sessionBindingReference: string): Promise<boolean>;
};

type CompositionDependencies = Readonly<{
  environmentPolicyInput?: unknown;
  csrfStorage?: AdminReadinessCsrfStorage | null;
  csrfIssuer?: CsrfIssuer | null;
  securityContextReader?: SecurityContextReader | null;
  adminAuthorizer?: AdminAuthorizer | null;
  throttleEnvironment?: AdminReadinessThrottleEnvironment;
  throttleNamespace?: string;
  throttleStorage?: AdminReadinessThrottleStorage | null;
  now?: () => number;
}>;

type SafeCsrfResult = { kind: "allow" } | { kind: "deny"; code: "csrf_denied" } | { kind: "unavailable"; code: "csrf_unavailable" };
type SafeThrottleResult = { kind: "allow" } | { kind: "deny"; code: "rate_limited" } | { kind: "unavailable"; code: "throttle_unavailable" };
type SafeCsrfIssueResult =
  | { kind: "issued"; token: string; expiresAt: string }
  | { kind: "deny"; code: "origin_denied" | "authority_denied" | "rate_limited" }
  | { kind: "unavailable"; code: "csrf_unavailable" | "throttle_unavailable" };

const ROUTE_GATE_ENV = "DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED";

/** Keep the lifecycle seam disabled unless the exact reviewed route flag is set. */
function adminReadinessRoutesEnabled(): boolean {
  return process.env[ROUTE_GATE_ENV] === "true";
}

/**
 * The zero-argument path obtains a reviewed durable configuration. Missing
 * configuration remains fail closed before readiness-service construction.
 */
function createComposition(dependencies: CompositionDependencies): {
  checkOrigin(origin: string | null | undefined): { ok: true } | { ok: false; code: "origin_denied" };
  validateCsrf(input: Readonly<{ operation: Operation; method: "POST"; csrfEvidence: string | null }>): Promise<SafeCsrfResult>;
  checkThrottle(input: Readonly<{ operation: Operation }>): Promise<SafeThrottleResult>;
  issueCsrfToken(input: Readonly<{ origin: string | null | undefined; operation: Operation }>): Promise<SafeCsrfIssueResult>;
} {
  const source = dependencies;
  const origin = createAdminReadinessConfiguredOriginChecker(source.environmentPolicyInput ?? null);
  const csrf = createAdminReadinessLifecycleCsrfValidator({ storage: source.csrfStorage ?? null, now: source.now });
  const throttle = createAdminReadinessConfiguredRouteThrottle({
    environment: source.throttleEnvironment ?? "local" as AdminReadinessThrottleEnvironment,
    namespace: source.throttleNamespace ?? "",
    storage: source.throttleStorage ?? null,
  });
  const securityContextReader = source.securityContextReader ?? null;
  const csrfIssuer = source.csrfIssuer ?? null;
  const adminAuthorizer = source.adminAuthorizer ?? null;
  let contextPromise: Promise<Readonly<{ sessionBindingReference: string; throttleSubjectHash: string }> | null> | null = null;

  async function context(): Promise<Readonly<{ sessionBindingReference: string; throttleSubjectHash: string }> | null> {
    if (!securityContextReader) return null;
    contextPromise ??= (async () => {
      try { return await securityContextReader.readSecurityContext(); } catch { return null; }
    })();
    return contextPromise;
  }

  return {
    checkOrigin(requestOrigin) {
      return origin.check(requestOrigin);
    },
    async validateCsrf(input) {
      const securityContext = await context();
      if (!securityContext) return { kind: "unavailable", code: "csrf_unavailable" };
      const lifecycleInput: AdminReadinessCsrfInput = {
        operation: input.operation,
        method: input.method,
        csrfEvidence: input.csrfEvidence,
        sessionBindingReference: securityContext.sessionBindingReference,
      };
      return csrf.validate(lifecycleInput);
    },
    async checkThrottle(input) {
      const securityContext = await context();
      if (!securityContext) return { kind: "unavailable", code: "throttle_unavailable" };
      return throttle.check({ operation: input.operation, subjectHash: securityContext.throttleSubjectHash });
    },
    async issueCsrfToken(input) {
      // This seam is callable by server-only code outside the HTTP route
      // handlers, so it must independently preserve the disabled-by-default
      // boundary before any origin, authority, context, throttle, or storage work.
      if (!adminReadinessRoutesEnabled()) return { kind: "unavailable", code: "csrf_unavailable" };
      if (!origin.check(input.origin).ok) return { kind: "deny", code: "origin_denied" };
      if (!csrfIssuer || !adminAuthorizer) return { kind: "unavailable", code: "csrf_unavailable" };
      try {
        if (!await adminAuthorizer.isCurrentRequestAdmin()) return { kind: "deny", code: "authority_denied" };
      } catch {
        return { kind: "unavailable", code: "csrf_unavailable" };
      }
      const securityContext = await context();
      if (!securityContext) return { kind: "unavailable", code: "csrf_unavailable" };
      const throttleResult = await throttle.check({ operation: input.operation, subjectHash: securityContext.throttleSubjectHash });
      if (throttleResult.kind === "deny") return { kind: "deny", code: "rate_limited" };
      if (throttleResult.kind !== "allow") return { kind: "unavailable", code: "throttle_unavailable" };
      try {
        const issued = await csrfIssuer.issue({
          operation: input.operation,
          method: "POST",
          sessionBindingReference: securityContext.sessionBindingReference,
        });
        return issued ? { kind: "issued", token: issued.token, expiresAt: issued.expiresAt }
          : { kind: "unavailable", code: "csrf_unavailable" };
      } catch {
        return { kind: "unavailable", code: "csrf_unavailable" };
      }
    },
  };
}

/** Production route composition accepts no caller-provided security dependencies. */
export function createAdminReadinessRouteSecurityComposition(): ReturnType<typeof createComposition> {
  const configuration: CompositionDependencies = createAdminReadinessRouteSecurityConfiguration() ?? {};
  return createComposition(configuration);
}
