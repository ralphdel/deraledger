import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";

const sessionBinding = "a".repeat(32);
const otherSessionBinding = "b".repeat(32);
const subjectHash = "c".repeat(64);

function moduleShim(path: string, exports: object): Module {
  const shim = new Module(path);
  shim.filename = path;
  shim.loaded = true;
  shim.exports = exports;
  return shim;
}

function policy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environment: "local",
    supabaseEnvironment: "local",
    adminOrigin: "http://localhost:3000",
    browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_SUPABASE_URL", value: "https://local.example.test" }],
    ...overrides,
  };
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = moduleShim(serverOnlyPath, {}) as never;
  let injectedConfiguration: object | null = null;
  const securityConfigPath = require.resolve("../src/lib/compliance/server/admin-readiness-route-security-config");
  require.cache[securityConfigPath] = moduleShim(securityConfigPath, {
    createAdminReadinessRouteSecurityConfiguration() { return injectedConfiguration; },
  }) as never;
  const composition = require("../src/lib/compliance/server/admin-readiness-route-security-composition") as typeof import("../src/lib/compliance/server/admin-readiness-route-security-composition");
  const csrfStorage = require("../src/lib/compliance/server/admin-readiness-csrf-storage") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-storage");
  const csrfIssuer = require("../src/lib/compliance/server/admin-readiness-csrf-issuer") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-issuer");
  const environment = require("../src/lib/compliance/server/admin-readiness-environment-policy") as typeof import("../src/lib/compliance/server/admin-readiness-environment-policy");

  let now = 1_000_000;
  const storage = csrfStorage.createInMemoryAdminReadinessCsrfStorage();
  const issued = await csrfIssuer.createAdminReadinessCsrfIssuer({ storage, now: () => now }).issue({
    operation: "issue", method: "POST", sessionBindingReference: sessionBinding, expiresInMs: 100,
  });
  assert.ok(issued);
  if (!issued) throw new Error("expected test CSRF token");

  injectedConfiguration = {
    environmentPolicyInput: policy(),
    csrfStorage: storage,
    securityContextReader: { async readSecurityContext() { return { sessionBindingReference: sessionBinding, throttleSubjectHash: subjectHash }; } },
    throttleEnvironment: "local",
    throttleNamespace: "admin_readiness_local_test",
    throttleStorage: { async check() { return { kind: "allow" }; } },
    now: () => now,
  };
  const secure = composition.createAdminReadinessRouteSecurityComposition();
  assert.equal(secure.checkOrigin("http://localhost:3000").ok, true);
  assert.equal(secure.checkOrigin("https://deraledger.com/admin").ok, false);
  assert.equal(secure.checkOrigin(null).ok, false);
  assert.deepEqual(await secure.validateCsrf({ operation: "issue", method: "POST", csrfEvidence: issued.token }), { kind: "allow" });
  assert.deepEqual(await secure.validateCsrf({ operation: "issue", method: "POST", csrfEvidence: null }), { kind: "deny", code: "csrf_denied" });
  assert.deepEqual(await secure.checkThrottle({ operation: "issue" }), { kind: "allow" });

  injectedConfiguration = {
    environmentPolicyInput: policy(), csrfStorage: storage,
    securityContextReader: { async readSecurityContext() { return { sessionBindingReference: otherSessionBinding, throttleSubjectHash: subjectHash }; } },
    throttleEnvironment: "local", throttleNamespace: "admin_readiness_local_test",
    throttleStorage: { async check() { return { kind: "allow" }; } }, now: () => now,
  };
  const mismatchedSession = composition.createAdminReadinessRouteSecurityComposition();
  assert.deepEqual(await mismatchedSession.validateCsrf({ operation: "issue", method: "POST", csrfEvidence: issued.token }), { kind: "deny", code: "csrf_denied" });
  now += 101;
  assert.deepEqual(await secure.validateCsrf({ operation: "issue", method: "POST", csrfEvidence: issued.token }), { kind: "deny", code: "csrf_denied" });

  injectedConfiguration = { environmentPolicyInput: policy() };
  const missingDependencies = composition.createAdminReadinessRouteSecurityComposition();
  assert.deepEqual(await missingDependencies.validateCsrf({ operation: "issue", method: "POST", csrfEvidence: issued.token }), { kind: "unavailable", code: "csrf_unavailable" });
  assert.deepEqual(await missingDependencies.checkThrottle({ operation: "issue" }), { kind: "unavailable", code: "throttle_unavailable" });

  injectedConfiguration = {
    environmentPolicyInput: policy(), csrfStorage: {
      async write() {}, async read() { throw new Error("storage"); }, async remove() {}, async invalidateSessionBinding() {},
    },
    securityContextReader: { async readSecurityContext() { throw new Error("session"); } },
    throttleEnvironment: "local", throttleNamespace: "admin_readiness_local_test",
    throttleStorage: { async check() { throw new Error("throttle"); } }, now: () => now,
  };
  const throwing = composition.createAdminReadinessRouteSecurityComposition();
  assert.deepEqual(await throwing.validateCsrf({ operation: "issue", method: "POST", csrfEvidence: issued.token }), { kind: "unavailable", code: "csrf_unavailable" });
  assert.deepEqual(await throwing.checkThrottle({ operation: "issue" }), { kind: "unavailable", code: "throttle_unavailable" });

  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(policy({ adminOrigin: "https://deraledger.com/admin" })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(policy({ browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_CONFIG", value: "sb_secret_hidden" }] })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(policy({ browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_CONFIG", value: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature" }] })).ok, false);

  const compositionSource = readFileSync("src/lib/compliance/server/admin-readiness-route-security-composition.ts", "utf8");
  assert.match(compositionSource, /^import\s+["']server-only["']/);
  assert.doesNotMatch(compositionSource, /canonical-approval-readiness-service-factory|createCanonicalApprovalReadinessServerService|createClient|auth\.admin|service.role|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
  assert.doesNotMatch(compositionSource, /approval execution|activation|collection unlock|payment|provider|checkout|subscription|invoice|storefront|compliance_reviewer|support manager|compliance manager|compliance officer/i);
  for (const file of [
    "src/lib/compliance/server/admin-readiness-route-cors.ts",
    "src/lib/compliance/server/admin-readiness-route-csrf.ts",
    "src/lib/compliance/server/admin-readiness-route-rate-limit.ts",
  ]) assert.match(readFileSync(file, "utf8"), /^import\s+["']server-only["']/);
  console.log("admin-readiness-route-composition.test.ts passed");
}

void run();
