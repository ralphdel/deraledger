import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";

type RpcCall = Readonly<{ name: string; arguments_: Record<string, unknown> }>;
const routeFlagEnvironmentVariable = "DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED";

function moduleShim(path: string, exports: object): Module {
  const shim = new Module(path);
  shim.filename = path;
  shim.loaded = true;
  shim.exports = exports;
  return shim;
}

class FakeSecurityRpcClient {
  readonly calls: RpcCall[] = [];
  readonly tokens = new Map<string, Record<string, unknown>>();
  throttleResult: "allow" | "rate_limited" | "malformed" | "error" = "allow";
  unavailable = false;

  async rpc(name: string, arguments_: Record<string, unknown>): Promise<{ data: unknown; error: unknown | null }> {
    this.calls.push({ name, arguments_ });
    if (this.unavailable || this.throttleResult === "error") throw new Error("provider unavailable");
    if (name === "create_admin_readiness_csrf_token_v1") {
      const digest = arguments_.p_token_digest as string;
      if (this.tokens.has(digest)) return { data: [{ result_code: "conflict" }], error: null };
      this.tokens.set(digest, { ...arguments_ });
      return { data: [{ result_code: "created" }], error: null };
    }
    if (name === "read_admin_readiness_csrf_token_v1") {
      const record = this.tokens.get(arguments_.p_token_digest as string);
      if (!record) return { data: [{ result_code: "missing", operation: null, method: null, session_binding_digest: null, expires_at: null }], error: null };
      return {
        data: [{
          result_code: "found",
          operation: record.p_operation,
          method: record.p_method,
          session_binding_digest: record.p_session_binding_digest,
          expires_at: record.p_expires_at,
        }],
        error: null,
      };
    }
    if (name === "rotate_admin_readiness_csrf_token_v1") {
      const previous = arguments_.p_previous_token_digest as string;
      const next = arguments_.p_new_token_digest as string;
      if (!this.tokens.has(previous) || this.tokens.has(next)) return { data: [{ result_code: "conflict" }], error: null };
      this.tokens.delete(previous); this.tokens.set(next, { ...arguments_, p_token_digest: next });
      return { data: [{ result_code: "rotated" }], error: null };
    }
    if (name === "invalidate_admin_readiness_csrf_binding_v1") {
      const binding = arguments_.p_session_binding_digest;
      let deleted = 0;
      for (const [digest, record] of this.tokens) {
        if (record.p_session_binding_digest === binding) { this.tokens.delete(digest); deleted += 1; }
      }
      return { data: [{ result_code: deleted ? "invalidated" : "missing", deleted_count: deleted }], error: null };
    }
    if (name === "decide_admin_readiness_throttle_v1") {
      if (this.throttleResult === "malformed") return { data: [{ unexpected: "response" }], error: null };
      return { data: [{ result_code: this.throttleResult }], error: null };
    }
    return { data: [], error: { message: "unexpected" } };
  }
}

async function run() {
  const originalRouteFlag = process.env[routeFlagEnvironmentVariable];
  const restoreRouteFlag = () => {
    if (originalRouteFlag === undefined) delete process.env[routeFlagEnvironmentVariable];
    else process.env[routeFlagEnvironmentVariable] = originalRouteFlag;
  };
  try {
  const require = createRequire(import.meta.url);
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = moduleShim(serverOnlyPath, {}) as never;
  const csrfStorageModule = require("../src/lib/compliance/server/admin-readiness-csrf-durable-storage") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-durable-storage");
  const throttleModule = require("../src/lib/compliance/server/admin-readiness-throttle-durable-storage") as typeof import("../src/lib/compliance/server/admin-readiness-throttle-durable-storage");
  const issuerModule = require("../src/lib/compliance/server/admin-readiness-csrf-issuer") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-issuer");
  const tokenModule = require("../src/lib/compliance/server/admin-readiness-csrf-token") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-token");

  const now = 1_725_000_000_000;
  const binding = "a".repeat(64);
  const subjectHash = "b".repeat(64);
  const rpc = new FakeSecurityRpcClient();
  const storage = csrfStorageModule.createAdminReadinessDurableCsrfStorage({ client: rpc, now: () => now });
  const issuer = issuerModule.createAdminReadinessCsrfIssuer({ storage, now: () => now });
  const validator = issuerModule.createAdminReadinessCsrfLifecycleValidator({ storage, now: () => now });

  const issued = await issuer.issue({ operation: "issue", method: "POST", sessionBindingReference: binding, expiresInMs: 60_000 });
  assert.ok(issued);
  assert.equal(rpc.calls[0]?.name, "create_admin_readiness_csrf_token_v1");
  assert.equal(rpc.calls[0]?.arguments_.p_operation, "readiness_issue");
  assert.match(rpc.calls[0]?.arguments_.p_token_digest as string, /^[a-f0-9]{64}$/);
  assert.notEqual(rpc.calls[0]?.arguments_.p_token_digest, issued?.token);
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: issued!.token, sessionBindingReference: binding }), { kind: "allow" });
  assert.equal(rpc.calls.at(-1)?.name, "read_admin_readiness_csrf_token_v1");
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: issued!.token, sessionBindingReference: "c".repeat(64) }), { kind: "deny", code: "csrf_denied" });

  const rotated = await issuer.rotate({ operation: "issue", method: "POST", sessionBindingReference: binding, previousToken: issued!.token, expiresInMs: 60_000 });
  assert.ok(rotated);
  assert.equal(rpc.calls.at(-1)?.name, "rotate_admin_readiness_csrf_token_v1");
  assert.equal(await issuer.invalidateSessionBinding(binding), true);
  assert.equal(rpc.calls.at(-1)?.name, "invalidate_admin_readiness_csrf_binding_v1");
  assert.equal(rpc.calls.some((call) => call.name === "cleanup_admin_readiness_security_storage_v1"), false);

  const throttle = throttleModule.createAdminReadinessDurableThrottleStorage({
    client: rpc, environment: "production", namespace: "admin_readiness_production_v1",
    issueLimit: 2, snapshotLimit: 2, windowSeconds: 60, now: () => now,
  });
  assert.deepEqual(await throttle.check({ namespace: "admin_readiness_production_v1", operation: "issue", subjectHash }), { kind: "allow" });
  const throttleCall = rpc.calls.at(-1);
  assert.equal(throttleCall?.name, "decide_admin_readiness_throttle_v1");
  assert.equal(throttleCall?.arguments_.p_operation, "readiness_issue");
  assert.equal(throttleCall?.arguments_.p_security_namespace, "admin_readiness_production_v1");
  rpc.throttleResult = "rate_limited";
  assert.deepEqual(await throttle.check({ namespace: "admin_readiness_production_v1", operation: "snapshot", subjectHash }), { kind: "deny", code: "rate_limited" });
  rpc.throttleResult = "malformed";
  assert.deepEqual(await throttle.check({ namespace: "admin_readiness_production_v1", operation: "snapshot", subjectHash }), { kind: "unavailable", code: "throttle_unavailable" });

  const unavailableStorage = csrfStorageModule.createAdminReadinessDurableCsrfStorage({ client: null, now: () => now });
  await assert.rejects(unavailableStorage.write({ tokenDigest: "d".repeat(64), sessionBindingDigest: binding, operation: "issue", method: "POST", expiresAtEpochMs: now + 60_000 }));
  const unavailableThrottle = throttleModule.createAdminReadinessDurableThrottleStorage({
    client: null, environment: "local", namespace: "admin_readiness_local_v1", issueLimit: 1, snapshotLimit: 1, windowSeconds: 60,
  });
  assert.deepEqual(await unavailableThrottle.check({ namespace: "admin_readiness_local_v1", operation: "issue", subjectHash }), { kind: "unavailable", code: "throttle_unavailable" });
  assert.match(tokenModule.digestAdminReadinessCsrfValue(issued!.token), /^[a-f0-9]{64}$/);

  // The real production composition reaches the real issuer and then the
  // durable adapter; the RPC fake is transport-only, not an issuer substitute.
  const runtimeRpc = new FakeSecurityRpcClient();
  const runtimeStorage = csrfStorageModule.createAdminReadinessDurableCsrfStorage({ client: runtimeRpc, now: () => now });
  const runtimeIssuer = issuerModule.createAdminReadinessCsrfIssuer({ storage: runtimeStorage, now: () => now });
  const securityConfigPath = require.resolve("../src/lib/compliance/server/admin-readiness-route-security-config");
  require.cache[securityConfigPath] = moduleShim(securityConfigPath, {
    createAdminReadinessRouteSecurityConfiguration() {
      return {
        environmentPolicyInput: {
          environment: "local", supabaseEnvironment: "local", adminOrigin: "http://localhost:3000", browserEnvironmentVariables: [],
        },
        csrfStorage: runtimeStorage,
        csrfIssuer: runtimeIssuer,
        securityContextReader: { async readSecurityContext() { return { sessionBindingReference: binding, throttleSubjectHash: subjectHash }; } },
        adminAuthorizer: { async isCurrentRequestAdmin() { return true; } },
        throttleEnvironment: "local",
        throttleNamespace: "admin_readiness_local_v1",
        throttleStorage: { async check() { return { kind: "allow" }; } },
        now: () => now,
      };
    },
  }) as never;
  const composition = require("../src/lib/compliance/server/admin-readiness-route-security-composition") as typeof import("../src/lib/compliance/server/admin-readiness-route-security-composition");
  process.env[routeFlagEnvironmentVariable] = "true";
  const runtimeIssue = await composition.createAdminReadinessRouteSecurityComposition().issueCsrfToken({ origin: "http://localhost:3000", operation: "issue" });
  assert.equal(runtimeIssue.kind, "issued");
  assert.equal(runtimeRpc.calls[0]?.name, "create_admin_readiness_csrf_token_v1");
  assert.match(runtimeRpc.calls[0]?.arguments_.p_token_digest as string, /^[a-f0-9]{64}$/);
  assert.notEqual(runtimeRpc.calls[0]?.arguments_.p_token_digest, runtimeIssue.kind === "issued" ? runtimeIssue.token : null);

  const configSource = readFileSync("src/lib/compliance/server/admin-readiness-route-security-config.ts", "utf8");
  const csrfSource = readFileSync("src/lib/compliance/server/admin-readiness-csrf-durable-storage.ts", "utf8");
  const throttleSource = readFileSync("src/lib/compliance/server/admin-readiness-throttle-durable-storage.ts", "utf8");
  for (const source of [configSource, csrfSource, throttleSource]) assert.match(source, /^import\s+["']server-only["']/);
  assert.match(configSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(configSource, /createSupabaseClient/);
  assert.match(configSource, /createAdminReadinessCsrfIssuer/);
  assert.doesNotMatch(configSource, /admin-readiness-durable-redis-client|UPSTASH|createAdminReadinessDurableRedisClient/);
  assert.match(csrfSource, /create_admin_readiness_csrf_token_v1|read_admin_readiness_csrf_token_v1|rotate_admin_readiness_csrf_token_v1|invalidate_admin_readiness_csrf_binding_v1/);
  assert.match(throttleSource, /decide_admin_readiness_throttle_v1/);
  assert.doesNotMatch(`${csrfSource}\n${throttleSource}`, /cleanup_admin_readiness_security_storage_v1/);
  for (const source of [csrfSource, throttleSource]) assert.doesNotMatch(source, /console\.|localStorage|sessionStorage|cookie|jwt|header|user_metadata|\.from\(/i);
  for (const route of [
    "src/app/api/internal/admin/compliance/readiness/issue/route.ts",
    "src/app/api/internal/admin/compliance/readiness/snapshot/route.ts",
  ]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /if \(!routeEnabled\(\)\) return responseFor/);
    assert.doesNotMatch(source, /createClient|Supabase|SUPABASE_SERVICE_ROLE_KEY|\.rpc\(|\.from\(/i);
  }
  const compositionSource = readFileSync("src/lib/compliance/server/admin-readiness-route-security-composition.ts", "utf8");
  assert.match(compositionSource, /issueCsrfToken/);
  assert.match(compositionSource, /DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED/);
  assert.match(compositionSource, /if \(!adminReadinessRoutesEnabled\(\)\) return \{ kind: "unavailable", code: "csrf_unavailable" \}/);
  assert.match(compositionSource, /csrfIssuer\.issue/);
  assert.match(compositionSource, /adminAuthorizer\.isCurrentRequestAdmin/);

  console.log("admin-readiness-route-runtime-adoption.test.ts passed");
  } finally {
    restoreRouteFlag();
  }
}

void run();
