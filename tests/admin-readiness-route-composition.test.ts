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
  const actualSecurityConfig = require("../src/lib/compliance/server/admin-readiness-route-security-config") as typeof import("../src/lib/compliance/server/admin-readiness-route-security-config");
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
  for (const browserEnvironmentVariable of [
    { name: "NEXT_PUBLIC_APP_URL", value: "https://admin.deraledger.com" },
    { name: "NEXT_PUBLIC_APP_ENV", value: "production" },
    { name: "NEXT_PUBLIC_SUPABASE_URL", value: "https://public-project.supabase.co" },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: "public-anon-key" },
    { name: "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY", value: "pk_live_public-key" },
  ]) {
    assert.equal(environment.validateAdminReadinessEnvironmentPolicy(policy({
      browserEnvironmentVariables: [browserEnvironmentVariable],
    })).ok, true, `${browserEnvironmentVariable.name} must remain an intentional public browser variable`);
  }
  for (const dangerousBrowserVariableName of [
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SECRET_KEY",
    "NEXT_PUBLIC_PRIVATE_KEY",
    "NEXT_PUBLIC_ACCESS_TOKEN",
  ]) {
    assert.equal(environment.validateAdminReadinessEnvironmentPolicy(policy({
      browserEnvironmentVariables: [{ name: dangerousBrowserVariableName, value: "browser-value" }],
    })).ok, false, `${dangerousBrowserVariableName} must remain blocked`);
  }
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(policy({
    browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_APP_URL", value: "sb_secret_hidden" }],
  })).ok, false, "an allowed app URL name must not authorize an sb_secret value");
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(policy({
    browserEnvironmentVariables: [{
      name: "NEXT_PUBLIC_APP_ENV",
      value: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature",
    }],
  })).ok, false, "an allowed app environment name must not authorize a service-role JWT");
  assert.equal(environment.validateAdminReadinessEnvironmentPolicy(policy({
    browserEnvironmentVariables: [{ name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: "sb_secret_hidden" }],
  })).ok, false, "an allowed anon-key name must not authorize a secret-shaped value");

  const secretSentinels = {
    supabaseUrl: "https://production-project.supabase.co",
    serviceRole: "service-role-value-must-not-appear",
    csrfHmac: "A".repeat(43),
    throttleHmac: "B".repeat(43),
  };
  const diagnosticEnvironment = {
    DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT: "production",
    DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT: "production",
    DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN: "https://admin.deraledger.com",
    SUPABASE_URL: secretSentinels.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: secretSentinels.serviceRole,
    DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY: secretSentinels.csrfHmac,
    DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY: secretSentinels.throttleHmac,
    DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT: "10",
    DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT: "30",
    DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS: "60",
  };
  const runtimeDiagnostic = actualSecurityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://admin.deraledger.com",
    diagnosticEnvironment,
  );
  assert.equal(runtimeDiagnostic.request_origin_matches_admin_origin, true);
  assert.equal(runtimeDiagnostic.origin_policy_created, true);
  assert.equal(runtimeDiagnostic.deployment_environment_literal_valid, true);
  assert.equal(runtimeDiagnostic.supabase_environment_literal_valid, true);
  assert.equal(runtimeDiagnostic.deployment_environment_is_production, true);
  assert.equal(runtimeDiagnostic.supabase_environment_is_production, true);
  assert.equal(runtimeDiagnostic.production_pair_allowed, true);
  assert.equal(runtimeDiagnostic.environment_pair_allowed, true);
  assert.equal(runtimeDiagnostic.browser_environment_secret_exposure_detected, false);
  assert.equal(runtimeDiagnostic.security_configuration_created, true);
  assert.equal(runtimeDiagnostic.final_failure_category, "origin_policy_ready");
  const runtimeDiagnosticJson = JSON.stringify(runtimeDiagnostic);
  for (const secret of Object.values(secretSentinels)) assert.equal(runtimeDiagnosticJson.includes(secret), false);
  assert.doesNotMatch(runtimeDiagnosticJson, /cookie|jwt|authorization|header|connection|string_value/i);
  assert.ok(Object.entries(runtimeDiagnostic).every(([name, value]) => name === "final_failure_category"
    ? typeof value === "string"
    : typeof value === "boolean"));

  const invalidHmacDiagnostic = actualSecurityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://admin.deraledger.com",
    {
      ...diagnosticEnvironment,
      DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY: secretSentinels.csrfHmac,
    },
  );
  assert.equal(invalidHmacDiagnostic.hmac_keys_distinct, false);
  assert.equal(invalidHmacDiagnostic.security_configuration_created, false);
  assert.equal(invalidHmacDiagnostic.final_failure_category, "hmac_configuration_invalid");

  const unsupportedDeploymentDiagnostic = actualSecurityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://admin.deraledger.com",
    { ...diagnosticEnvironment, DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT: "PRODUCTION" },
  );
  assert.equal(unsupportedDeploymentDiagnostic.deployment_environment_literal_valid, false);
  assert.equal(unsupportedDeploymentDiagnostic.final_failure_category, "environment_policy_unsupported_deployment");

  const unsupportedSupabaseDiagnostic = actualSecurityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://admin.deraledger.com",
    { ...diagnosticEnvironment, DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT: "PRODUCTION" },
  );
  assert.equal(unsupportedSupabaseDiagnostic.supabase_environment_literal_valid, false);
  assert.equal(unsupportedSupabaseDiagnostic.final_failure_category, "environment_policy_unsupported_supabase");

  const mismatchedPairDiagnostic = actualSecurityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://admin.deraledger.com",
    { ...diagnosticEnvironment, DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT: "staging" },
  );
  assert.equal(mismatchedPairDiagnostic.deployment_environment_literal_valid, true);
  assert.equal(mismatchedPairDiagnostic.supabase_environment_literal_valid, true);
  assert.equal(mismatchedPairDiagnostic.environment_pair_allowed, false);
  assert.equal(mismatchedPairDiagnostic.final_failure_category, "environment_policy_pair_mismatch");

  const browserSecretDiagnostic = actualSecurityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://admin.deraledger.com",
    { ...diagnosticEnvironment, NEXT_PUBLIC_SERVICE_ROLE_KEY: "browser-secret-sentinel" },
  );
  assert.equal(browserSecretDiagnostic.browser_environment_secret_exposure_detected, true);
  assert.equal(browserSecretDiagnostic.final_failure_category, "environment_policy_browser_secret_exposure");
  assert.equal(JSON.stringify(browserSecretDiagnostic).includes("browser-secret-sentinel"), false);

  const intentionalPublicKeysDiagnostic = actualSecurityConfig.createAdminReadinessRedactedRuntimeDiagnostic(
    "https://admin.deraledger.com",
    {
      ...diagnosticEnvironment,
      NEXT_PUBLIC_APP_URL: "https://app-metadata-diagnostic.example",
      NEXT_PUBLIC_APP_ENV: "public-app-environment-diagnostic-sentinel",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-diagnostic-sentinel",
      NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY: "pk_live_diagnostic-sentinel",
    },
  );
  assert.equal(intentionalPublicKeysDiagnostic.browser_environment_secret_exposure_detected, false);
  assert.equal(intentionalPublicKeysDiagnostic.security_configuration_created, true);
  assert.equal(intentionalPublicKeysDiagnostic.final_failure_category, "origin_policy_ready");
  const intentionalPublicKeysDiagnosticJson = JSON.stringify(intentionalPublicKeysDiagnostic);
  assert.equal(intentionalPublicKeysDiagnosticJson.includes("public-anon-diagnostic-sentinel"), false);
  assert.equal(intentionalPublicKeysDiagnosticJson.includes("pk_live_diagnostic-sentinel"), false);
  assert.equal(intentionalPublicKeysDiagnosticJson.includes("https://app-metadata-diagnostic.example"), false);
  assert.equal(intentionalPublicKeysDiagnosticJson.includes("public-app-environment-diagnostic-sentinel"), false);

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
