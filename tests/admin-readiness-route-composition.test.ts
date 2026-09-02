import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";

const sessionBinding = "a".repeat(32);
const otherSessionBinding = "b".repeat(32);
const subjectHash = "c".repeat(64);
const routeFlagEnvironmentVariable = "DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED";

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
  const originalRouteFlag = process.env[routeFlagEnvironmentVariable];
  const restoreRouteFlag = () => {
    if (originalRouteFlag === undefined) delete process.env[routeFlagEnvironmentVariable];
    else process.env[routeFlagEnvironmentVariable] = originalRouteFlag;
  };
  try {
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
  let issuerCalls = 0;
  const issued = await csrfIssuer.createAdminReadinessCsrfIssuer({ storage, now: () => now }).issue({
    operation: "issue", method: "POST", sessionBindingReference: sessionBinding, expiresInMs: 100,
  });
  assert.ok(issued);
  if (!issued) throw new Error("expected test CSRF token");

  injectedConfiguration = {
    environmentPolicyInput: policy(),
    csrfStorage: storage,
    csrfIssuer: {
      async issue() { issuerCalls += 1; return { token: "x".repeat(43), expiresAt: new Date(now + 100).toISOString() }; },
      async rotate() { return null; },
      async invalidateSessionBinding() { return false; },
    },
    securityContextReader: { async readSecurityContext() { return { sessionBindingReference: sessionBinding, throttleSubjectHash: subjectHash }; } },
    adminAuthorizer: { async isCurrentRequestAdmin() { return true; } },
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
  process.env[routeFlagEnvironmentVariable] = "true";
  assert.deepEqual(await secure.issueCsrfToken({ origin: "http://localhost:3000", operation: "issue" }), {
    kind: "issued", token: "x".repeat(43), expiresAt: new Date(now + 100).toISOString(),
  });
  assert.equal(issuerCalls, 1);
  assert.deepEqual(await secure.issueCsrfToken({ origin: "https://not-allowed.example.test", operation: "issue" }), { kind: "deny", code: "origin_denied" });
  assert.equal(issuerCalls, 1);

  for (const disabledValue of [undefined, "false", "", "TRUE", "malformed"]) {
    let authorityCalls = 0;
    let contextCalls = 0;
    let throttleCalls = 0;
    let disabledIssuerCalls = 0;
    injectedConfiguration = {
      environmentPolicyInput: policy(),
      csrfIssuer: {
        async issue() { disabledIssuerCalls += 1; return null; },
        async rotate() { return null; },
        async invalidateSessionBinding() { return false; },
      },
      securityContextReader: { async readSecurityContext() { contextCalls += 1; return null; } },
      adminAuthorizer: { async isCurrentRequestAdmin() { authorityCalls += 1; return false; } },
      throttleEnvironment: "local",
      throttleNamespace: "admin_readiness_local_test",
      throttleStorage: { async check() { throttleCalls += 1; return { kind: "allow" as const }; } },
    };
    if (disabledValue === undefined) delete process.env[routeFlagEnvironmentVariable];
    else process.env[routeFlagEnvironmentVariable] = disabledValue;
    const disabledSeam = composition.createAdminReadinessRouteSecurityComposition();
    assert.deepEqual(await disabledSeam.issueCsrfToken({ origin: "https://not-allowed.example.test", operation: "issue" }), {
      kind: "unavailable", code: "csrf_unavailable",
    });
    assert.equal(authorityCalls, 0);
    assert.equal(contextCalls, 0);
    assert.equal(throttleCalls, 0);
    assert.equal(disabledIssuerCalls, 0);
  }
  const compositionSourceForGate = readFileSync("src/lib/compliance/server/admin-readiness-route-security-composition.ts", "utf8");
  const issueCsrfStart = compositionSourceForGate.indexOf("async issueCsrfToken(input)");
  const routeGateIndex = compositionSourceForGate.indexOf("if (!adminReadinessRoutesEnabled())", issueCsrfStart);
  const originCheckIndex = compositionSourceForGate.indexOf("origin.check(input.origin)", issueCsrfStart);
  assert.ok(routeGateIndex > issueCsrfStart && routeGateIndex < originCheckIndex, "issuer seam must gate before origin work");
  process.env[routeFlagEnvironmentVariable] = "true";

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

  const redactedOriginDiagnostic = environment.createAdminReadinessRedactedOriginPolicyDiagnostic({
    environment: "staging",
    supabaseEnvironment: "staging",
    adminOrigin: "https://deraledger-staging.vercel.app",
    additionalAllowedOrigins: ["https://deraledger-staging.vercel.app"],
    allowedOriginsKeyPresent: true,
    allowedOriginsEmptyString: false,
    browserEnvironmentVariables: [],
    requestOrigin: "https://deraledger-staging.vercel.app",
  });
  assert.equal(redactedOriginDiagnostic.allowed_origins_duplicates_admin_origin, true);
  assert.equal(redactedOriginDiagnostic.origin_policy_created, false);
  assert.equal(redactedOriginDiagnostic.final_failure_category, "environment_policy_invalid");

  const emptyAllowedOriginsDiagnostic = environment.createAdminReadinessRedactedOriginPolicyDiagnostic({
    environment: "staging",
    supabaseEnvironment: "staging",
    adminOrigin: "https://deraledger-staging.vercel.app",
    additionalAllowedOrigins: [""],
    allowedOriginsKeyPresent: true,
    allowedOriginsEmptyString: true,
    browserEnvironmentVariables: [],
    requestOrigin: "https://deraledger-staging.vercel.app",
  });
  assert.equal(emptyAllowedOriginsDiagnostic.allowed_origins_empty_string, true);
  assert.equal(emptyAllowedOriginsDiagnostic.origin_policy_created, false);

  delete require.cache[securityConfigPath];
  const securityConfig = require("../src/lib/compliance/server/admin-readiness-route-security-config") as typeof import("../src/lib/compliance/server/admin-readiness-route-security-config");
  const csrfDiagnosticKey = Buffer.alloc(32, 1).toString("base64url");
  const throttleDiagnosticKey = Buffer.alloc(32, 2).toString("base64url");
  const hiddenServiceRoleValue = "diagnostic-service-role-value-must-not-appear";
  const validDiagnosticEnvironment = {
    DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT: "staging",
    DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT: "staging",
    DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN: "https://deraledger-staging.vercel.app",
    SUPABASE_URL: "https://diagnostic-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: hiddenServiceRoleValue,
    DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY: csrfDiagnosticKey,
    DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY: throttleDiagnosticKey,
    DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT: "10",
    DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT: "30",
    DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS: "60",
  };
  const validRuntimeDiagnostic = securityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://deraledger-staging.vercel.app",
    validDiagnosticEnvironment,
  );
  assert.equal(validRuntimeDiagnostic.origin_policy_created, true);
  assert.equal(validRuntimeDiagnostic.security_configuration_created, true);
  assert.equal(validRuntimeDiagnostic.final_failure_category, "origin_policy_ready");
  assert.equal(JSON.stringify(validRuntimeDiagnostic).includes(hiddenServiceRoleValue), false);
  assert.equal(JSON.stringify(validRuntimeDiagnostic).includes(csrfDiagnosticKey), false);
  assert.equal(JSON.stringify(validRuntimeDiagnostic).includes(throttleDiagnosticKey), false);
  assert.equal(JSON.stringify(validRuntimeDiagnostic).includes("https://diagnostic-project.supabase.co"), false);
  for (const value of Object.values(validRuntimeDiagnostic)) {
    assert.equal(typeof value === "boolean" || value === "origin_policy_ready", true);
  }

  const missingLabelDiagnostic = securityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://deraledger-staging.vercel.app",
    { ...validDiagnosticEnvironment, DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT: undefined },
  );
  assert.equal(missingLabelDiagnostic.deployment_environment_present, false);
  assert.equal(missingLabelDiagnostic.origin_policy_created, false);
  const mismatchedLabelDiagnostic = securityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://deraledger-staging.vercel.app",
    { ...validDiagnosticEnvironment, DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT: "preview" },
  );
  assert.equal(mismatchedLabelDiagnostic.deployment_and_supabase_environment_equal, false);
  assert.equal(mismatchedLabelDiagnostic.origin_policy_created, false);

  const missingHmacDiagnostic = securityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://deraledger-staging.vercel.app",
    { ...validDiagnosticEnvironment, DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY: undefined },
  );
  assert.equal(missingHmacDiagnostic.csrf_hmac_key_present, false);
  assert.equal(missingHmacDiagnostic.final_failure_category, "hmac_configuration_invalid");
  const missingThrottleDiagnostic = securityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://deraledger-staging.vercel.app",
    { ...validDiagnosticEnvironment, DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS: undefined },
  );
  assert.equal(missingThrottleDiagnostic.throttle_window_seconds_valid, false);
  assert.equal(missingThrottleDiagnostic.final_failure_category, "throttle_configuration_invalid");

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
  } finally {
    restoreRouteFlag();
  }
}

void run();
