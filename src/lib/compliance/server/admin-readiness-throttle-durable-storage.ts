import "server-only";

import type { AdminReadinessRedisCommandClient } from "./admin-readiness-durable-redis-client";
import type { AdminReadinessThrottleEnvironment, AdminReadinessThrottleStorage } from "./admin-readiness-throttle-config";

type Dependencies = Readonly<{
  client: AdminReadinessRedisCommandClient | null;
  environment: AdminReadinessThrottleEnvironment;
  namespace: string;
  issueLimit: number;
  snapshotLimit: number;
  windowSeconds: number;
  now?: () => number;
}>;

const HASH = /^[a-f0-9]{64}$/i;
const NAMESPACE = /^admin_readiness_(production|staging|preview|local)_v1$/;
const FIXED_WINDOW_SCRIPT = `
-- admin-readiness-throttle-fixed-window-v1
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if count <= tonumber(ARGV[2]) then return 1 end
return 0`;

function validPositiveInteger(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function result(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function prefix(namespace: string): string {
  return `dl:admin-readiness:v1:${namespace}:throttle`;
}

/** A provider-backed fixed window; all non-exact results fail closed. */
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
      const key = `${prefix(dependencies.namespace)}:${input.operation}:${input.subjectHash}:${windowStart}`;
      try {
        const decision = result(await client.eval(FIXED_WINDOW_SCRIPT, [key], [windowMs, limit]));
        if (decision === 1) return { kind: "allow" };
        if (decision === 0) return { kind: "deny", code: "rate_limited" };
        return { kind: "unavailable", code: "throttle_unavailable" };
      } catch {
        return { kind: "unavailable", code: "throttle_unavailable" };
      }
    },
  };
}
