import "server-only";

import type { AdminReadinessCsrfStorage } from "./admin-readiness-csrf-storage";
import { createAdminReadinessRouteSecurityConfiguration } from "./admin-readiness-route-security-config";
import { createAdminReadinessConfiguredOriginChecker } from "./admin-readiness-route-cors";
import { createAdminReadinessLifecycleCsrfValidator, type AdminReadinessCsrfInput } from "./admin-readiness-route-csrf";
import { createAdminReadinessConfiguredRouteThrottle } from "./admin-readiness-route-rate-limit";
import type { AdminReadinessThrottleEnvironment, AdminReadinessThrottleStorage } from "./admin-readiness-throttle-config";

type Operation = "issue" | "snapshot";
type SecurityContextReader = { readSecurityContext(): Promise<Readonly<{ sessionBindingReference: string; throttleSubjectHash: string }> | null> };

type CompositionDependencies = Readonly<{
  environmentPolicyInput?: unknown;
  csrfStorage?: AdminReadinessCsrfStorage | null;
  securityContextReader?: SecurityContextReader | null;
  throttleEnvironment?: AdminReadinessThrottleEnvironment;
  throttleNamespace?: string;
  throttleStorage?: AdminReadinessThrottleStorage | null;
  now?: () => number;
}>;

type SafeCsrfResult = { kind: "allow" } | { kind: "deny"; code: "csrf_denied" } | { kind: "unavailable"; code: "csrf_unavailable" };
type SafeThrottleResult = { kind: "allow" } | { kind: "deny"; code: "rate_limited" } | { kind: "unavailable"; code: "throttle_unavailable" };

/**
 * The zero-argument path obtains a reviewed durable configuration. Missing
 * configuration remains fail closed before readiness-service construction.
 */
function createComposition(dependencies: CompositionDependencies): {
  checkOrigin(origin: string | null | undefined): { ok: true } | { ok: false; code: "origin_denied" };
  validateCsrf(input: Readonly<{ operation: Operation; method: "POST"; csrfEvidence: string | null }>): Promise<SafeCsrfResult>;
  checkThrottle(input: Readonly<{ operation: Operation }>): Promise<SafeThrottleResult>;
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
  };
}

/** Production route composition accepts no caller-provided security dependencies. */
export function createAdminReadinessRouteSecurityComposition(): ReturnType<typeof createComposition> {
  const configuration: CompositionDependencies = createAdminReadinessRouteSecurityConfiguration() ?? {};
  return createComposition(configuration);
}
