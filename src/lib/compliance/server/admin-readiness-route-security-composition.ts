import "server-only";

import type { AdminReadinessCsrfStorage } from "./admin-readiness-csrf-storage";
import { createAdminReadinessConfiguredOriginChecker } from "./admin-readiness-route-cors";
import { createAdminReadinessLifecycleCsrfValidator, type AdminReadinessCsrfInput } from "./admin-readiness-route-csrf";
import { createAdminReadinessConfiguredRouteThrottle } from "./admin-readiness-route-rate-limit";
import type { AdminReadinessThrottleEnvironment, AdminReadinessThrottleStorage } from "./admin-readiness-throttle-config";

type Operation = "issue" | "snapshot";
type SessionBindingReader = { readSessionBindingReference(): Promise<string | null> };

type CompositionDependencies = Readonly<{
  environmentPolicyInput?: unknown;
  csrfStorage?: AdminReadinessCsrfStorage | null;
  sessionBindingReader?: SessionBindingReader | null;
  throttleEnvironment?: AdminReadinessThrottleEnvironment;
  throttleNamespace?: string;
  throttleStorage?: AdminReadinessThrottleStorage | null;
  now?: () => number;
}>;

type SafeCsrfResult = { kind: "allow" } | { kind: "deny"; code: "csrf_denied" } | { kind: "unavailable"; code: "csrf_unavailable" };
type SafeThrottleResult = { kind: "allow" } | { kind: "deny"; code: "rate_limited" } | { kind: "unavailable"; code: "throttle_unavailable" };

const ENVIRONMENT_NAME = "DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT";
const SUPABASE_ENVIRONMENT_NAME = "DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT";
const ADMIN_ORIGIN_NAME = "DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN";
const ALLOWED_ORIGINS_NAME = "DERALEDGER_ADMIN_READINESS_ALLOWED_ORIGINS";
const THROTTLE_NAMESPACE_NAME = "DERALEDGER_ADMIN_READINESS_THROTTLE_NAMESPACE";

function environmentFromProcess(): unknown {
  const additionalAllowedOrigins = process.env[ALLOWED_ORIGINS_NAME] === undefined
    ? []
    : process.env[ALLOWED_ORIGINS_NAME]!.split(",");
  return {
    environment: process.env[ENVIRONMENT_NAME],
    supabaseEnvironment: process.env[SUPABASE_ENVIRONMENT_NAME],
    adminOrigin: process.env[ADMIN_ORIGIN_NAME],
    additionalAllowedOrigins,
    browserEnvironmentVariables: Object.entries(process.env)
      .filter(([name]) => name.startsWith("NEXT_PUBLIC_"))
      .map(([name, value]) => ({ name, value })),
  };
}

/**
 * Production route composition deliberately has no default durable CSRF or
 * throttle storage. Until a reviewed configuration injects those seams, every
 * enabled request fails closed before readiness-service construction.
 */
export function createAdminReadinessRouteSecurityComposition(dependencies: CompositionDependencies = {}): {
  checkOrigin(origin: string | null | undefined): { ok: true } | { ok: false; code: "origin_denied" };
  validateCsrf(input: Readonly<{ operation: Operation; method: "POST"; csrfEvidence: string | null }>): Promise<SafeCsrfResult>;
  checkThrottle(input: Readonly<{ operation: Operation; subjectHash: string }>): Promise<SafeThrottleResult>;
} {
  const origin = createAdminReadinessConfiguredOriginChecker(dependencies.environmentPolicyInput ?? environmentFromProcess());
  const csrf = createAdminReadinessLifecycleCsrfValidator({ storage: dependencies.csrfStorage ?? null, now: dependencies.now });
  const throttle = createAdminReadinessConfiguredRouteThrottle({
    environment: dependencies.throttleEnvironment ?? process.env[ENVIRONMENT_NAME] as AdminReadinessThrottleEnvironment,
    namespace: dependencies.throttleNamespace ?? process.env[THROTTLE_NAMESPACE_NAME] ?? "",
    storage: dependencies.throttleStorage ?? null,
  });
  const sessionBindingReader = dependencies.sessionBindingReader ?? null;

  return {
    checkOrigin(requestOrigin) {
      return origin.check(requestOrigin);
    },
    async validateCsrf(input) {
      if (!sessionBindingReader) return { kind: "unavailable", code: "csrf_unavailable" };
      let sessionBindingReference: string | null;
      try {
        sessionBindingReference = await sessionBindingReader.readSessionBindingReference();
      } catch {
        return { kind: "unavailable", code: "csrf_unavailable" };
      }
      const lifecycleInput: AdminReadinessCsrfInput = {
        operation: input.operation,
        method: input.method,
        csrfEvidence: input.csrfEvidence,
        sessionBindingReference,
      };
      return csrf.validate(lifecycleInput);
    },
    checkThrottle(input) {
      return throttle.check(input);
    },
  };
}
