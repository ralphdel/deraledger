import "server-only";

import type { AdminReadinessRedisCommandClient } from "./admin-readiness-durable-redis-client";
import type { AdminReadinessCsrfStorage, AdminReadinessCsrfStoredRecord } from "./admin-readiness-csrf-storage";

type Dependencies = Readonly<{
  client: AdminReadinessRedisCommandClient | null;
  namespace: string;
  now?: () => number;
}>;

const DIGEST = /^[a-f0-9]{64}$/i;
const NAMESPACE = /^admin_readiness_(production|staging|preview|local)_v1$/;
const MAX_ACTIVE_PER_BINDING = 4;

const CREATE_SCRIPT = `
-- admin-readiness-csrf-create-v1
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[3])
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) == false then return 0 end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[4]) then redis.call('DEL', KEYS[1]); return -1 end
redis.call('ZADD', KEYS[2], ARGV[5], ARGV[6])
local existingTtl = redis.call('PTTL', KEYS[2])
if existingTtl < tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[2], ARGV[2]) end
return 1`;

const ROTATE_SCRIPT = `
-- admin-readiness-csrf-rotate-v1
local prior = redis.call('GET', KEYS[1])
if not prior then return 0 end
local ok, record = pcall(cjson.decode, prior)
if not ok or record.tokenDigest ~= ARGV[7] or record.sessionBindingDigest ~= ARGV[8] or record.operation ~= ARGV[9] or record.method ~= ARGV[10] or tonumber(record.expiresAtEpochMs) <= tonumber(ARGV[3]) then return 0 end
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[3])
local active = redis.call('ZCARD', KEYS[3])
if redis.call('ZSCORE', KEYS[3], ARGV[7]) then active = active - 1 end
if active >= tonumber(ARGV[4]) then return -1 end
if redis.call('SET', KEYS[2], ARGV[1], 'NX', 'PX', ARGV[2]) == false then return -1 end
redis.call('ZADD', KEYS[3], ARGV[5], ARGV[6])
local existingTtl = redis.call('PTTL', KEYS[3])
if existingTtl < tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[3], ARGV[2]) end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[3], ARGV[7])
return 1`;

const INVALIDATE_SCRIPT = `
-- admin-readiness-csrf-invalidate-v1
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, member in ipairs(members) do redis.call('DEL', ARGV[1] .. member) end
redis.call('DEL', KEYS[1])
return 1`;

const REMOVE_SCRIPT = `return redis.call('DEL', KEYS[1])`;

function validRecord(value: AdminReadinessCsrfStoredRecord): boolean {
  return DIGEST.test(value.tokenDigest) && DIGEST.test(value.sessionBindingDigest)
    && (value.operation === "issue" || value.operation === "snapshot")
    && (value.method === "GET" || value.method === "POST")
    && Number.isSafeInteger(value.expiresAtEpochMs) && value.expiresAtEpochMs > 0;
}

function nowEpoch(clock: () => number): number | null {
  const value = clock();
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function keyPrefix(namespace: string): string {
  return `dl:admin-readiness:v1:${namespace}`;
}

function tokenKey(namespace: string, digest: string): string {
  return `${keyPrefix(namespace)}:csrf:token:${digest}`;
}

function bindingKey(namespace: string, digest: string): string {
  return `${keyPrefix(namespace)}:csrf:binding:${digest}`;
}

function result(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function recordJson(record: AdminReadinessCsrfStoredRecord): string {
  return JSON.stringify({
    v: 1,
    tokenDigest: record.tokenDigest,
    sessionBindingDigest: record.sessionBindingDigest,
    operation: record.operation,
    method: record.method,
    expiresAtEpochMs: record.expiresAtEpochMs,
  });
}

/** A digest-only Redis implementation; configuration/provider failure is represented by rejected storage operations. */
export function createAdminReadinessDurableCsrfStorage(dependencies: Dependencies): AdminReadinessCsrfStorage {
  const client = dependencies.client;
  const namespace = NAMESPACE.test(dependencies.namespace) ? dependencies.namespace : null;
  const clock = dependencies.now ?? Date.now;
  const usable = () => client !== null && namespace !== null;

  function ttl(record: AdminReadinessCsrfStoredRecord): readonly [number, number] | null {
    const now = nowEpoch(clock);
    if (!validRecord(record) || now === null || record.expiresAtEpochMs <= now) return null;
    const ttlMs = record.expiresAtEpochMs - now;
    return ttlMs > 0 && ttlMs <= 60 * 60 * 1_000 ? [ttlMs, now] : null;
  }

  return {
    async write(record) {
      const expiry = ttl(record);
      if (!usable() || !expiry || !client || !namespace) throw new Error("csrf storage unavailable");
      const [ttlMs, now] = expiry;
      try {
        const response = result(await client.eval(CREATE_SCRIPT,
          [tokenKey(namespace, record.tokenDigest), bindingKey(namespace, record.sessionBindingDigest)],
          [recordJson(record), ttlMs, now, MAX_ACTIVE_PER_BINDING, record.expiresAtEpochMs, record.tokenDigest]));
        if (response !== 1) throw new Error("csrf storage rejected");
      } catch {
        throw new Error("csrf storage unavailable");
      }
    },
    async read(tokenDigest) {
      if (!usable() || !DIGEST.test(tokenDigest) || !client || !namespace) throw new Error("csrf storage unavailable");
      try {
        const raw = await client.get(tokenKey(namespace, tokenDigest));
        if (raw === null) return null;
        if (typeof raw !== "string") return raw;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
          const value = parsed as Record<string, unknown>;
          if (value.v !== 1) return raw;
          return {
            tokenDigest: value.tokenDigest,
            sessionBindingDigest: value.sessionBindingDigest,
            operation: value.operation,
            method: value.method,
            expiresAtEpochMs: value.expiresAtEpochMs,
          };
        } catch { return raw; }
      } catch {
        throw new Error("csrf storage unavailable");
      }
    },
    async remove(tokenDigest) {
      if (!usable() || !DIGEST.test(tokenDigest) || !client || !namespace) throw new Error("csrf storage unavailable");
      try {
        if (result(await client.eval(REMOVE_SCRIPT, [tokenKey(namespace, tokenDigest)], [])) === null) throw new Error("bad result");
      } catch {
        throw new Error("csrf storage unavailable");
      }
    },
    async invalidateSessionBinding(sessionBindingDigest) {
      if (!usable() || !DIGEST.test(sessionBindingDigest) || !client || !namespace) throw new Error("csrf storage unavailable");
      try {
        if (result(await client.eval(INVALIDATE_SCRIPT, [bindingKey(namespace, sessionBindingDigest)], [`${keyPrefix(namespace)}:csrf:token:`])) !== 1) throw new Error("bad result");
      } catch {
        throw new Error("csrf storage unavailable");
      }
    },
    async rotate(previousTokenDigest, record) {
      const expiry = ttl(record);
      if (!usable() || !DIGEST.test(previousTokenDigest) || !expiry || !client || !namespace) return false;
      const [ttlMs, now] = expiry;
      try {
        const response = result(await client.eval(ROTATE_SCRIPT,
          [tokenKey(namespace, previousTokenDigest), tokenKey(namespace, record.tokenDigest), bindingKey(namespace, record.sessionBindingDigest)],
          [recordJson(record), ttlMs, now, MAX_ACTIVE_PER_BINDING, record.expiresAtEpochMs, record.tokenDigest,
            previousTokenDigest, record.sessionBindingDigest, record.operation, record.method]));
        return response === 1;
      } catch {
        return false;
      }
    },
  };
}
