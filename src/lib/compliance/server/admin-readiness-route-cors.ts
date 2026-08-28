import "server-only";

import {
  checkAdminReadinessConfiguredOrigin,
  validateAdminReadinessEnvironmentPolicy,
  type AdminReadinessEnvironmentPolicy,
} from "./admin-readiness-environment-policy";

export type AdminReadinessOriginResult = { ok: true } | { ok: false; code: "origin_denied" };
export function checkAdminReadinessOrigin(origin: string | null | undefined, expectedOrigin: string, allowedOrigins: readonly string[] = []): AdminReadinessOriginResult {
  if (!origin || origin === "null" || !/^https:\/\//i.test(origin) || !/^https:\/\//i.test(expectedOrigin)) return { ok: false, code: "origin_denied" };
  return origin === expectedOrigin || allowedOrigins.includes(origin) ? { ok: true } : { ok: false, code: "origin_denied" };
}

/**
 * Validates the deployment policy once, then provides only an origin
 * defense-in-depth check. It does not establish reviewer authority.
 */
export function createAdminReadinessConfiguredOriginChecker(input: unknown): {
  check(origin: string | null | undefined): AdminReadinessOriginResult;
} {
  const result = validateAdminReadinessEnvironmentPolicy(input);
  const policy: AdminReadinessEnvironmentPolicy | null = result.ok ? result.policy : null;
  return {
    check(origin) {
      if (!policy) return { ok: false, code: "origin_denied" };
      return checkAdminReadinessConfiguredOrigin(policy, origin);
    },
  };
}
export function adminReadinessPreflight(): { status: 204; headers: Readonly<Record<string, string>> } { return { status: 204, headers: { "Cache-Control": "no-store" } }; }
