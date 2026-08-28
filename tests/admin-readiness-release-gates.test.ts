import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";

const hash = "a".repeat(64);

function moduleShim(path: string, exports: object): Module {
  const shim = new Module(path);
  shim.filename = path;
  shim.loaded = true;
  shim.exports = exports;
  return shim;
}

function productionPolicy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environment: "production",
    supabaseEnvironment: "production",
    adminOrigin: "https://admin.deraledger.com",
    browserEnvironmentVariables: [
      { name: "NEXT_PUBLIC_SUPABASE_URL", value: "https://project.supabase.co" },
      { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: "public-anon-key" },
    ],
    ...overrides,
  };
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = moduleShim(serverOnlyPath, {}) as never;
  const environment = require("../src/lib/compliance/server/admin-readiness-environment-policy") as typeof import("../src/lib/compliance/server/admin-readiness-environment-policy");
  const throttle = require("../src/lib/compliance/server/admin-readiness-throttle-config") as typeof import("../src/lib/compliance/server/admin-readiness-throttle-config");

  const policyResult = environment.validateAdminReadinessEnvironmentPolicy(productionPolicy());
  assert.equal(policyResult.ok, true);
  if (!policyResult.ok) throw new Error("production policy unexpectedly rejected");
  assert.equal(environment.checkAdminReadinessConfiguredOrigin(policyResult.policy, "https://admin.deraledger.com").ok, true);
  assert.equal(environment.checkAdminReadinessConfiguredOrigin(policyResult.policy, null).ok, false);
  assert.equal(environment.checkAdminReadinessConfiguredOrigin(policyResult.policy, "https://unapproved.example.test").ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ adminOrigin: "https://deraledger.com/admin" })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ additionalAllowedOrigins: ["*"] })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ supabaseEnvironment: "staging" })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ environment: "staging", supabaseEnvironment: "production", adminOrigin: "https://staging-admin.example.test" })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ environment: "preview", supabaseEnvironment: "production", adminOrigin: "https://preview-admin.example.test" })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ environment: "local", supabaseEnvironment: "local", adminOrigin: "http://localhost:3000" })).ok, true);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY", value: "never-safe" }] })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_CONFIG", value: "sb_secret_hidden" }] })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_CONFIG", value: jwt({ role: "service_role" }) }] })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_CONFIG", value: "header.%%% .signature".replace(" ", "") }] })).ok, false);
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(productionPolicy({ browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_CONFIG", value: jwt({ role: "anon" }) }] })).ok, true);

  const unconfigured = throttle.createAdminReadinessConfiguredThrottle({ environment: "production", namespace: "admin_readiness_production_primary", storage: null });
  assert.deepEqual(await unconfigured.check({ operation: "issue", subjectHash: hash }), { kind: "unavailable", code: "throttle_unavailable" });
  const unavailable = throttle.createAdminReadinessConfiguredThrottle({
    environment: "production", namespace: "admin_readiness_production_primary",
    storage: { async check() { return { kind: "unavailable", code: "throttle_unavailable" }; } },
  });
  assert.deepEqual(await unavailable.check({ operation: "issue", subjectHash: hash }), { kind: "unavailable", code: "throttle_unavailable" });
  const allowed = throttle.createAdminReadinessConfiguredThrottle({
    environment: "staging", namespace: "admin_readiness_staging_primary",
    storage: { async check() { return { kind: "allow" }; } },
  });
  assert.deepEqual(await allowed.check({ operation: "snapshot", subjectHash: hash }), { kind: "allow" });
  const limited = throttle.createAdminReadinessConfiguredThrottle({
    environment: "preview", namespace: "admin_readiness_preview_primary",
    storage: { async check() { return { kind: "deny", code: "rate_limited" }; } },
  });
  assert.deepEqual(await limited.check({ operation: "issue", subjectHash: hash }), { kind: "deny", code: "rate_limited" });
  assert.deepEqual(await allowed.check({ operation: "issue", subjectHash: "full@example.test" }), { kind: "deny", code: "rate_limited" });
  const throwing = throttle.createAdminReadinessConfiguredThrottle({
    environment: "local", namespace: "admin_readiness_local_primary",
    storage: { async check() { throw new Error("provider failure"); } },
  });
  assert.deepEqual(await throwing.check({ operation: "issue", subjectHash: hash }), { kind: "unavailable", code: "throttle_unavailable" });

  for (const file of [
    "src/lib/compliance/server/admin-readiness-environment-policy.ts",
    "src/lib/compliance/server/admin-readiness-throttle-config.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /^import\s+["']server-only["']/);
    assert.doesNotMatch(source, /src\/app|route\.ts|page\.tsx|webhook|canonical-approval-readiness-service-factory|createCanonicalApprovalReadinessServerService|createClient|auth\.admin|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
    assert.doesNotMatch(source, /approval execution|activation|collection unlock|payment|provider|checkout|subscription|invoice|storefront|compliance_reviewer|support manager|compliance manager|compliance officer/i);
  }
  const issueRoute = readFileSync("src/app/api/internal/admin/compliance/readiness/issue/route.ts", "utf8");
  const snapshotRoute = readFileSync("src/app/api/internal/admin/compliance/readiness/snapshot/route.ts", "utf8");
  assert.match(issueRoute, /DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED/);
  assert.match(snapshotRoute, /DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED/);
  assert.match(readFileSync("docs/prd-phase-2-admin-readiness-release-gates-source-checkpoint.md", "utf8"), /Local development has one narrow exception:[\s\S]*HTTP\s+loopback/i);
  console.log("admin-readiness-release-gates.test.ts passed");
}

void run();
