import "server-only";

export type AdminReadinessThrottleEnvironment = "production" | "staging" | "preview" | "local";
export type AdminReadinessConfiguredThrottleKey = Readonly<{ operation: "issue" | "snapshot"; subjectHash: string }>;
export type AdminReadinessConfiguredThrottleResult =
  | { kind: "allow" }
  | { kind: "deny"; code: "rate_limited" }
  | { kind: "unavailable"; code: "throttle_unavailable" };

export interface AdminReadinessThrottleStorage {
  check(input: Readonly<{ namespace: string; operation: "issue" | "snapshot"; subjectHash: string }>): Promise<unknown>;
}

type ThrottleDependencies = Readonly<{
  environment: AdminReadinessThrottleEnvironment;
  namespace: string;
  storage: AdminReadinessThrottleStorage | null;
}>;

const ENVIRONMENTS = new Set<AdminReadinessThrottleEnvironment>(["production", "staging", "preview", "local"]);
const HASH = /^[a-f0-9]{64}$/i;

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === keys.length && keys.every((key) => Object.hasOwn(value as object, key));
}

function validEnvironment(value: unknown): value is AdminReadinessThrottleEnvironment {
  return typeof value === "string" && ENVIRONMENTS.has(value as AdminReadinessThrottleEnvironment);
}

function validNamespace(environment: AdminReadinessThrottleEnvironment, namespace: unknown): namespace is string {
  return typeof namespace === "string"
    && new RegExp(`^admin_readiness_${environment}_[a-z0-9_]{1,48}$`).test(namespace);
}

function validKey(value: AdminReadinessConfiguredThrottleKey): boolean {
  return (value.operation === "issue" || value.operation === "snapshot") && HASH.test(value.subjectHash);
}

function normalize(value: unknown): AdminReadinessConfiguredThrottleResult {
  if (exact(value, ["kind"]) && value.kind === "allow") return { kind: "allow" };
  if (exact(value, ["kind", "code"]) && value.kind === "deny" && value.code === "rate_limited") return { kind: "deny", code: "rate_limited" };
  if (exact(value, ["kind", "code"]) && value.kind === "unavailable" && value.code === "throttle_unavailable") return { kind: "unavailable", code: "throttle_unavailable" };
  return { kind: "unavailable", code: "throttle_unavailable" };
}

/**
 * A narrow storage seam. No storage is configured by default, and an invalid
 * configuration or storage result never permits progress toward the service.
 */
export function createAdminReadinessConfiguredThrottle(dependencies: ThrottleDependencies): {
  check(key: AdminReadinessConfiguredThrottleKey): Promise<AdminReadinessConfiguredThrottleResult>;
} {
  const configured = validEnvironment(dependencies.environment)
    && validNamespace(dependencies.environment, dependencies.namespace)
    && dependencies.storage !== null;
  return {
    async check(key) {
      if (!validKey(key)) return { kind: "deny", code: "rate_limited" };
      if (!configured || !dependencies.storage) return { kind: "unavailable", code: "throttle_unavailable" };
      try {
        return normalize(await dependencies.storage.check({ namespace: dependencies.namespace, operation: key.operation, subjectHash: key.subjectHash }));
      } catch {
        return { kind: "unavailable", code: "throttle_unavailable" };
      }
    },
  };
}
