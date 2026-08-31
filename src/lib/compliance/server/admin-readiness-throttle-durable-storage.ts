import "server-only";

import type { AdminReadinessSupabaseSecurityRpcClient } from "./admin-readiness-csrf-durable-storage";
import type { AdminReadinessThrottleEnvironment, AdminReadinessThrottleStorage } from "./admin-readiness-throttle-config";

type Dependencies = Readonly<{
  client: AdminReadinessSupabaseSecurityRpcClient | null;
  environment: AdminReadinessThrottleEnvironment;
  namespace: string;
  issueLimit: number;
  snapshotLimit: number;
  windowSeconds: number;
  now?: () => number;
}>;

const HASH = /^[a-f0-9]{64}$/;
const NAMESPACE = /^admin_readiness_(production|staging|preview|local)_v1$/;
const THROTTLE_RPC = "decide_admin_readiness_throttle_v1";

function validPositiveInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function exact(value: unknown): value is Readonly<{ result_code: unknown }> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === 1 && Object.hasOwn(value as object, "result_code");
}

function decision(value: unknown): "allow" | "rate_limited" | "unavailable" {
  if (!Array.isArray(value) || value.length !== 1 || !exact(value[0])) return "unavailable";
  if (value[0].result_code === "allow") return "allow";
  if (value[0].result_code === "rate_limited") return "rate_limited";
  return "unavailable";
}

function operationForRpc(operation: "issue" | "snapshot"): "readiness_issue" | "readiness_snapshot" {
  return operation === "issue" ? "readiness_issue" : "readiness_snapshot";
}

/** Reviewed Supabase RPC fixed-window adapter; every non-exact result fails closed. */
export function createAdminReadinessDurableThrottleStorage(dependencies: Dependencies): AdminReadinessThrottleStorage {
  const client = dependencies.client;
  const configured = client !== null && NAMESPACE.test(dependencies.namespace)
    && dependencies.namespace === `admin_readiness_${dependencies.environment}_v1`
    && validPositiveInteger(dependencies.issueLimit, 100)
    && validPositiveInteger(dependencies.snapshotLimit, 100)
    && validPositiveInteger(dependencies.windowSeconds, 3_600);
  const clock = dependencies.now ?? Date.now;
  return {
    async check(input) {
      if (!configured || !client || input.namespace !== dependencies.namespace || !HASH.test(input.subjectHash) || (input.operation !== "issue" && input.operation !== "snapshot")) {
        return { kind: "unavailable", code: "throttle_unavailable" };
      }
      const now = clock();
      if (!Number.isSafeInteger(now) || now <= 0) return { kind: "unavailable", code: "throttle_unavailable" };
      const windowMs = dependencies.windowSeconds * 1_000;
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const limit = input.operation === "issue" ? dependencies.issueLimit : dependencies.snapshotLimit;
      try {
        const response = await client.rpc(THROTTLE_RPC, {
          p_security_namespace: dependencies.namespace,
          p_operation: operationForRpc(input.operation),
          p_subject_hash: input.subjectHash,
          p_window_started_at: new Date(windowStart).toISOString(),
          p_window_expires_at: new Date(windowStart + windowMs).toISOString(),
          p_limit: limit,
        });
        if (response.error) return { kind: "unavailable", code: "throttle_unavailable" };
        const result = decision(response.data);
        if (result === "allow") return { kind: "allow" };
        if (result === "rate_limited") return { kind: "deny", code: "rate_limited" };
      } catch {
        // Provider diagnostics never cross the route security boundary.
      }
      return { kind: "unavailable", code: "throttle_unavailable" };
    },
  };
}
