import "server-only";

import {
  createAdminReadinessConfiguredThrottle,
  type AdminReadinessThrottleStorage,
  type AdminReadinessThrottleEnvironment,
} from "./admin-readiness-throttle-config";

export interface AdminReadinessThrottleKey { operation: "issue" | "snapshot"; subjectHash: string; }
export type AdminReadinessThrottleResult = { kind: "allow" } | { kind: "deny"; code: "rate_limited" } | { kind: "unavailable"; code: "throttle_unavailable" };
export interface AdminReadinessThrottleChecker { check(key: AdminReadinessThrottleKey): Promise<AdminReadinessThrottleResult>; }
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === keys.length && keys.every((key) => Object.hasOwn(value as object, key));
}
function normalize(value: unknown): AdminReadinessThrottleResult {
  if (exact(value, ["kind"]) && value.kind === "allow") return { kind: "allow" };
  if (exact(value, ["kind", "code"]) && value.kind === "deny" && value.code === "rate_limited") return { kind: "deny", code: "rate_limited" };
  if (exact(value, ["kind", "code"]) && value.kind === "unavailable" && value.code === "throttle_unavailable") return { kind: "unavailable", code: "throttle_unavailable" };
  return { kind: "unavailable", code: "throttle_unavailable" };
}
export function createAdminReadinessThrottle(checker?: AdminReadinessThrottleChecker | null): AdminReadinessThrottleChecker {
  return { async check(key) {
    if (!/^(issue|snapshot)$/.test(key.operation) || !/^[a-f0-9]{12,128}$/i.test(key.subjectHash)) return { kind: "deny", code: "rate_limited" };
    if (!checker) return { kind: "unavailable", code: "throttle_unavailable" };
    try { return normalize(await checker.check(key)); } catch { return { kind: "unavailable", code: "throttle_unavailable" }; }
  } };
}

/** Wraps the configured storage seam in the route's normalized throttle boundary. */
export function createAdminReadinessConfiguredRouteThrottle(dependencies: Readonly<{
  environment: AdminReadinessThrottleEnvironment;
  namespace: string;
  storage: AdminReadinessThrottleStorage | null;
}>): AdminReadinessThrottleChecker {
  const configured = createAdminReadinessConfiguredThrottle(dependencies);
  return createAdminReadinessThrottle({
    check(key: AdminReadinessThrottleKey) {
      return configured.check(key);
    },
  });
}
