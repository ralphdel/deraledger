import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { readFileSync } from "node:fs";

type RedisClient = import("../src/lib/compliance/server/admin-readiness-durable-redis-client").AdminReadinessRedisCommandClient;

function moduleShim(path: string, exports: object): Module {
  const shim = new Module(path);
  shim.filename = path;
  shim.loaded = true;
  shim.exports = exports;
  return shim;
}

class FakeRedis implements RedisClient {
  readonly values = new Map<string, string>();
  readonly bindings = new Map<string, Set<string>>();
  readonly counters = new Map<string, number>();
  unavailable = false;

  async get(key: string): Promise<unknown> {
    if (this.unavailable) throw new Error("unavailable");
    return this.values.get(key) ?? null;
  }

  async eval(script: string, keys: string[], args: unknown[]): Promise<unknown> {
    if (this.unavailable) throw new Error("unavailable");
    if (script.includes("admin-readiness-csrf-create-v1")) {
      const [recordKey, bindingKey] = keys;
      const [raw, , , capacity, , digest] = args as [string, number, number, number, number, string];
      if (this.values.has(recordKey)) return 0;
      const members = this.bindings.get(bindingKey) ?? new Set<string>();
      if (members.size >= capacity) return -1;
      this.values.set(recordKey, raw);
      members.add(digest); this.bindings.set(bindingKey, members);
      return 1;
    }
    if (script.includes("admin-readiness-csrf-rotate-v1")) {
      const [previousKey, nextKey, bindingKey] = keys;
      const [raw, , , capacity, , nextDigest, previousDigest, bindingDigest, operation, method] = args as [string, number, number, number, number, string, string, string, string, "issue" | "snapshot", "GET" | "POST"];
      const previous = this.values.get(previousKey);
      if (!previous || this.values.has(nextKey)) return 0;
      const parsed = JSON.parse(previous) as Record<string, unknown>;
      if (parsed.tokenDigest !== previousDigest || parsed.sessionBindingDigest !== bindingDigest || parsed.operation !== operation || parsed.method !== method) return 0;
      const members = this.bindings.get(bindingKey) ?? new Set<string>();
      const effective = members.has(previousDigest) ? members.size - 1 : members.size;
      if (effective >= capacity) return -1;
      this.values.set(nextKey, raw); this.values.delete(previousKey);
      members.delete(previousDigest); members.add(nextDigest); this.bindings.set(bindingKey, members);
      return 1;
    }
    if (script.includes("admin-readiness-csrf-invalidate-v1")) {
      const [bindingKey] = keys;
      const [tokenPrefix] = args as [string];
      for (const digest of this.bindings.get(bindingKey) ?? []) this.values.delete(`${tokenPrefix}${digest}`);
      this.bindings.delete(bindingKey);
      return 1;
    }
    if (script.includes("admin-readiness-throttle-fixed-window-v1")) {
      const [key] = keys;
      const [, limit] = args as [number, number];
      const count = (this.counters.get(key) ?? 0) + 1;
      this.counters.set(key, count);
      return count <= limit ? 1 : 0;
    }
    if (script.includes("DEL")) { this.values.delete(keys[0]); return 1; }
    return "malformed";
  }
}

function key(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64url");
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = moduleShim(serverOnlyPath, {}) as never;
  const durable = require("../src/lib/compliance/server/admin-readiness-durable-redis-client") as typeof import("../src/lib/compliance/server/admin-readiness-durable-redis-client");
  const binding = require("../src/lib/compliance/server/admin-readiness-csrf-session-binding") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-session-binding");
  const csrfStorageModule = require("../src/lib/compliance/server/admin-readiness-csrf-durable-storage") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-durable-storage");
  const csrfIssuer = require("../src/lib/compliance/server/admin-readiness-csrf-issuer") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-issuer");
  const csrfToken = require("../src/lib/compliance/server/admin-readiness-csrf-token") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-token");
  const throttleModule = require("../src/lib/compliance/server/admin-readiness-throttle-durable-storage") as typeof import("../src/lib/compliance/server/admin-readiness-throttle-durable-storage");
  const securityConfig = require("../src/lib/compliance/server/admin-readiness-route-security-config") as typeof import("../src/lib/compliance/server/admin-readiness-route-security-config");

  assert.equal(durable.validateAdminReadinessDurableRedisConfiguration(null), null);
  assert.equal(durable.validateAdminReadinessDurableRedisConfiguration({ environment: "production", redisEnvironment: "staging", namespace: "admin_readiness_production_v1", url: "https://redis.example.test", token: "x".repeat(16) }), null);
  assert.equal(durable.validateAdminReadinessDurableRedisConfiguration({ environment: "production", redisEnvironment: "production", namespace: "admin_readiness_production_v1", url: "http://redis.example.test", token: "x".repeat(16) }), null);
  assert.ok(durable.validateAdminReadinessDurableRedisConfiguration({ environment: "local", redisEnvironment: "local", namespace: "admin_readiness_local_v1", url: "https://redis.example.test", token: "x".repeat(16) }));
  assert.equal(securityConfig.createAdminReadinessRouteSecurityConfiguration(), null);

  const configNames = [
    "DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT", "DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT",
    "DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN", "DERALEDGER_ADMIN_READINESS_REDIS_ENVIRONMENT",
    "DERALEDGER_ADMIN_READINESS_SECURITY_NAMESPACE", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
    "DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY", "DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY",
    "DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT", "DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT",
    "DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS",
  ];
  const saved = new Map<string, string | undefined>([...configNames, ...Object.keys(process.env).filter((name) => name.startsWith("NEXT_PUBLIC_"))].map((name) => [name, process.env[name]]));
  try {
    for (const name of Object.keys(process.env).filter((name) => name.startsWith("NEXT_PUBLIC_"))) delete process.env[name];
    Object.assign(process.env, {
      DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT: "local",
      DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT: "local",
      DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN: "http://localhost:3000",
      DERALEDGER_ADMIN_READINESS_REDIS_ENVIRONMENT: "local",
      DERALEDGER_ADMIN_READINESS_SECURITY_NAMESPACE: "admin_readiness_local_v1",
      UPSTASH_REDIS_REST_URL: "https://redis.example.test",
      UPSTASH_REDIS_REST_TOKEN: "x".repeat(16),
      DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY: key(7),
      DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY: key(8),
      DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT: "1",
      DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT: "1",
      DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS: "60",
      NEXT_PUBLIC_SUPABASE_URL: "https://local.example.test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
    });
    assert.ok(securityConfig.createAdminReadinessRouteSecurityConfiguration());
    process.env.NEXT_PUBLIC_CONFIG = "sb_secret_not_allowed";
    assert.equal(securityConfig.createAdminReadinessRouteSecurityConfiguration(), null);
  } finally {
    for (const name of configNames) delete process.env[name];
    for (const name of Object.keys(process.env).filter((name) => name.startsWith("NEXT_PUBLIC_"))) delete process.env[name];
    for (const [name, value] of saved) {
      if (value !== undefined) process.env[name] = value;
    }
  }

  const csrfKey = key(1); const throttleKey = key(2);
  const userId = "00000000-0000-4000-8000-000000000111";
  const reader = binding.createAdminReadinessCsrfSessionBindingReader({
    csrfBindingHmacKey: csrfKey,
    throttleSubjectHmacKey: throttleKey,
    clientFactory: async () => ({
      auth: {
        async getUser() { return { data: { user: { id: userId } }, error: null }; },
        async getSession() { return { data: { session: { access_token: "x".repeat(64) } }, error: null }; },
      },
    }),
  });
  const context = await reader.readSecurityContext();
  assert.ok(context);
  assert.match(context!.sessionBindingReference, /^[a-f0-9]{64}$/);
  assert.match(context!.throttleSubjectHash, /^[a-f0-9]{64}$/);
  assert.notEqual(context!.sessionBindingReference, context!.throttleSubjectHash);
  const missingSession = binding.createAdminReadinessCsrfSessionBindingReader({
    csrfBindingHmacKey: csrfKey, throttleSubjectHmacKey: throttleKey,
    clientFactory: async () => ({ auth: { async getUser() { return { data: { user: { id: userId } }, error: null }; }, async getSession() { return { data: { session: null }, error: null }; } } }),
  });
  assert.equal(await missingSession.readSecurityContext(), null);

  let now = 1_000_000;
  const fake = new FakeRedis();
  const storage = csrfStorageModule.createAdminReadinessDurableCsrfStorage({ client: fake, namespace: "admin_readiness_local_v1", now: () => now });
  const issuer = csrfIssuer.createAdminReadinessCsrfIssuer({ storage, now: () => now });
  const validator = csrfIssuer.createAdminReadinessCsrfLifecycleValidator({ storage, now: () => now });
  const issued = await issuer.issue({ operation: "issue", method: "POST", sessionBindingReference: context!.sessionBindingReference, expiresInMs: 1_000 });
  assert.ok(issued);
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: issued!.token, sessionBindingReference: context!.sessionBindingReference }), { kind: "allow" });
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: issued!.token, sessionBindingReference: "f".repeat(64) }), { kind: "deny", code: "csrf_denied" });
  const digest = csrfToken.digestAdminReadinessCsrfValue(issued!.token);
  await assert.rejects(storage.write({ tokenDigest: digest, sessionBindingDigest: csrfToken.digestAdminReadinessCsrfValue(context!.sessionBindingReference), operation: "issue", method: "POST", expiresAtEpochMs: now + 1_000 }));
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: issued!.token, sessionBindingReference: context!.sessionBindingReference }), { kind: "allow" });
  const rotated = await issuer.rotate({ operation: "issue", method: "POST", sessionBindingReference: context!.sessionBindingReference, previousToken: issued!.token, expiresInMs: 1_000 });
  assert.ok(rotated);
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: issued!.token, sessionBindingReference: context!.sessionBindingReference }), { kind: "deny", code: "csrf_denied" });
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: rotated!.token, sessionBindingReference: context!.sessionBindingReference }), { kind: "allow" });
  const replacementReader = binding.createAdminReadinessCsrfSessionBindingReader({
    csrfBindingHmacKey: key(3), throttleSubjectHmacKey: throttleKey,
    clientFactory: async () => ({ auth: { async getUser() { return { data: { user: { id: userId } }, error: null }; }, async getSession() { return { data: { session: { access_token: "x".repeat(64) } }, error: null }; } } }),
  });
  const replacementContext = await replacementReader.readSecurityContext();
  assert.notEqual(replacementContext?.sessionBindingReference, context!.sessionBindingReference);
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: rotated!.token, sessionBindingReference: replacementContext!.sessionBindingReference }), { kind: "deny", code: "csrf_denied" });
  assert.equal(await issuer.invalidateSessionBinding(context!.sessionBindingReference), true);
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: rotated!.token, sessionBindingReference: context!.sessionBindingReference }), { kind: "deny", code: "csrf_denied" });
  fake.unavailable = true;
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: rotated!.token, sessionBindingReference: context!.sessionBindingReference }), { kind: "unavailable", code: "csrf_unavailable" });

  const throttleRedis = new FakeRedis();
  const throttle = throttleModule.createAdminReadinessDurableThrottleStorage({ client: throttleRedis, environment: "local", namespace: "admin_readiness_local_v1", issueLimit: 1, snapshotLimit: 2, windowSeconds: 60, now: () => now });
  assert.deepEqual(await throttle.check({ namespace: "admin_readiness_local_v1", operation: "issue", subjectHash: context!.throttleSubjectHash }), { kind: "allow" });
  assert.deepEqual(await throttle.check({ namespace: "admin_readiness_local_v1", operation: "issue", subjectHash: context!.throttleSubjectHash }), { kind: "deny", code: "rate_limited" });
  throttleRedis.unavailable = true;
  assert.deepEqual(await throttle.check({ namespace: "admin_readiness_local_v1", operation: "snapshot", subjectHash: context!.throttleSubjectHash }), { kind: "unavailable", code: "throttle_unavailable" });
  const malformedThrottle = throttleModule.createAdminReadinessDurableThrottleStorage({
    client: { async get() { return null; }, async eval() { return "bad"; } }, environment: "local", namespace: "admin_readiness_local_v1", issueLimit: 1, snapshotLimit: 1, windowSeconds: 60,
  });
  assert.deepEqual(await malformedThrottle.check({ namespace: "admin_readiness_local_v1", operation: "issue", subjectHash: context!.throttleSubjectHash }), { kind: "unavailable", code: "throttle_unavailable" });

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
  assert.ok(packageJson.dependencies["@upstash/redis"]);
  assert.equal(packageJson.dependencies["@upstash/ratelimit"], undefined);
  for (const file of [
    "src/lib/compliance/server/admin-readiness-durable-redis-client.ts",
    "src/lib/compliance/server/admin-readiness-csrf-session-binding.ts",
    "src/lib/compliance/server/admin-readiness-csrf-durable-storage.ts",
    "src/lib/compliance/server/admin-readiness-throttle-durable-storage.ts",
    "src/lib/compliance/server/admin-readiness-route-security-config.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /^import\s+["']server-only["']/);
    assert.doesNotMatch(source, /console\.|auth\.admin|SUPABASE_SERVICE_ROLE_KEY|\b(?:supabase|client)\.(?:from|rpc|insert|update|delete)\(/i);
    assert.doesNotMatch(source, /approval execution|activation|collection unlock|payment|checkout|subscription|invoice|storefront|compliance_reviewer|support manager|compliance manager|compliance officer/i);
  }
  for (const file of ["src/app/api/internal/admin/compliance/readiness/issue/route.ts", "src/app/api/internal/admin/compliance/readiness/snapshot/route.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /OPERATION_THROTTLE_SUBJECT_HASH|subjectHash:/);
    assert.match(source, /DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED/);
  }
  console.log("admin-readiness-durable-security-adapters.test.ts passed");
}

void run();
