import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire, Module } from "node:module";

type RouteModule = { POST(request: Request): Promise<Response> };
type Scenario = {
  csrf: { kind: "allow" } | { kind: "deny"; code: "csrf_denied" } | { kind: "unavailable"; code: "csrf_unavailable" };
  throttle: { kind: "allow" } | { kind: "deny"; code: "rate_limited" } | { kind: "unavailable"; code: "throttle_unavailable" };
  csrfIssue: { kind: "issued"; token: string; expiresAt: string } | { kind: "deny"; code: "origin_denied" | "authority_denied" | "rate_limited" } | { kind: "unavailable"; code: "csrf_unavailable" | "throttle_unavailable" };
  issueResult: unknown;
  snapshotResult: unknown;
  trace: string[];
  events: unknown[];
  factoryCalls: number;
  issueCalls: number;
  csrfIssueCalls: number;
  snapshotCalls: number;
  csrfEvidence: string | null | undefined;
  runtimeDiagnosticCalls: Array<string | null>;
};

const routeFiles = [
  "src/app/api/internal/admin/compliance/readiness/issue/route.ts",
  "src/app/api/internal/admin/compliance/readiness/snapshot/route.ts",
] as const;
const issuePath = "../src/app/api/internal/admin/compliance/readiness/issue/route";
const snapshotPath = "../src/app/api/internal/admin/compliance/readiness/snapshot/route";
const origin = "https://admin.example.test";
const id = "00000000-0000-4000-8000-000000000101";
const requestId = "00000000-0000-4000-8000-000000000102";

function moduleShim(path: string, exports: object): Module {
  const shim = new Module(path);
  shim.filename = path;
  shim.loaded = true;
  shim.exports = exports;
  return shim;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function scenario(): Scenario {
  return {
    csrf: { kind: "allow" },
    throttle: { kind: "allow" },
    csrfIssue: { kind: "issued", token: "x".repeat(43), expiresAt: "2026-08-31T12:00:00.000Z" },
    issueResult: { kind: "created", decisionRequestId: requestId, decisionIdempotencyKey: "internal-only", diagnostics: [] },
    snapshotResult: {
      kind: "ready",
      snapshot: {
        decisionRequestId: requestId,
        decisionIdempotencyKey: "internal-only",
        merchantId: "00000000-0000-4000-8000-000000000103",
        workspaceId: "00000000-0000-4000-8000-000000000104",
        profileId: id,
        planCode: "solo_lite",
        currentComplianceStatus: "lite_pending",
        sourceType: "solo_lite_review",
        sourceId: "00000000-0000-4000-8000-000000000105",
        sourceVersion: 1,
        expectedProfileRowVersion: 1,
        policyVersion: "policy-v1",
        reviewerId: "00000000-0000-4000-8000-000000000106",
        reviewedAt: "2026-08-28T00:00:00.000Z",
        reasonCode: null,
        targetComplianceStatus: "lite_verified",
      },
      diagnostics: [],
    },
    trace: [],
    events: [],
    factoryCalls: 0,
    issueCalls: 0,
    csrfIssueCalls: 0,
    snapshotCalls: 0,
    csrfEvidence: undefined,
    runtimeDiagnosticCalls: [],
  };
}

function installRoute(require: NodeRequire, routePath: string, state: Scenario): RouteModule {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = moduleShim(serverOnlyPath, {}) as never;

  const factoryPath = require.resolve("../src/lib/compliance/server/canonical-approval-readiness-service-factory");
  require.cache[factoryPath] = moduleShim(factoryPath, {
    createCanonicalApprovalReadinessServerService() {
      state.trace.push("factory");
      state.factoryCalls += 1;
      return {
        async issue() { state.trace.push("issue"); state.issueCalls += 1; return state.issueResult; },
        async readSnapshot() { state.trace.push("snapshot"); state.snapshotCalls += 1; return state.snapshotResult; },
      };
    },
  }) as never;

  const securityPath = require.resolve("../src/lib/compliance/server/admin-readiness-route-security-composition");
  require.cache[securityPath] = moduleShim(securityPath, {
    createAdminReadinessRouteSecurityComposition() {
      return {
        checkOrigin() { return { ok: true }; },
        async validateCsrf(input: { csrfEvidence: string | null }) { state.trace.push("csrf"); state.csrfEvidence = input.csrfEvidence; return state.csrf; },
        async checkThrottle() { state.trace.push("throttle"); return state.throttle; },
        async issueCsrfToken() { state.trace.push("csrf_issue"); state.csrfIssueCalls += 1; return state.csrfIssue; },
      };
    },
  }) as never;

  const loggingPath = require.resolve("../src/lib/compliance/server/admin-readiness-route-logging");
  require.cache[loggingPath] = moduleShim(loggingPath, {
    createAdminReadinessCorrelationId() { return "00000000-0000-4000-8000-000000000107"; },
    createAdminReadinessOperationalEvent(input: object) { state.events.push(input); return input; },
  }) as never;

  const securityConfigPath = require.resolve("../src/lib/compliance/server/admin-readiness-route-security-config");
  require.cache[securityConfigPath] = moduleShim(securityConfigPath, {
    createAdminReadinessRedactedRuntimeDiagnostic(requestOrigin: string | null) {
      state.runtimeDiagnosticCalls.push(requestOrigin);
      return { final_failure_category: "request_origin_mismatch" };
    },
  }) as never;

  const resolvedRoutePath = require.resolve(routePath);
  delete require.cache[resolvedRoutePath];
  return require(routePath) as RouteModule;
}

function request(body = "", includeCsrf = true, requestUrlOrigin = origin, requestHeaderOrigin = origin): Request {
  return new Request(`${requestUrlOrigin}/api/internal/admin/compliance/readiness`, {
    method: "POST",
    headers: {
      origin: requestHeaderOrigin,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(includeCsrf ? { "x-deraledger-readiness-csrf": "test-csrf-evidence" } : {}),
    },
    body,
  });
}

async function result(route: RouteModule, body = "", includeCsrf = true, requestUrlOrigin = origin, requestHeaderOrigin = origin): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await route.POST(request(body, includeCsrf, requestUrlOrigin, requestHeaderOrigin));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function run() {
  const require = createRequire(import.meta.url);
  const previousGate = process.env.DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED;

  try {
    for (const file of routeFiles) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /^import\s+["']server-only["']/);
      assert.match(source, /admin-readiness-route-(?:json|logging|response|validation|security-composition)/);
      assert.doesNotMatch(source, /createClient|Supabase|auth\.admin|service.role|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
      assert.doesNotMatch(source, /approval decision|activate|collection unlock|payment|provider|checkout|subscription|invoice|storefront|compliance_reviewer|support manager|compliance manager|compliance officer/i);
      assert.doesNotMatch(source, /deraledger\.com\/admin/i);
    }
    const issueSource = readFileSync(routeFiles[0], "utf8");
    assert.match(issueSource, /issueCsrfToken\(\{[\s\S]*operation: "snapshot"/);
    assert.match(issueSource, /const STAGING_DIAGNOSTIC_ORIGIN = "https:\/\/deraledger-staging\.vercel\.app"/);
    assert.match(issueSource, /new URL\(request\.url\)\.origin !== STAGING_DIAGNOSTIC_ORIGIN/);
    assert.match(issueSource, /logStagingOriginDiagnostic\(request, requestOrigin\)/);
    assert.doesNotMatch(issueSource, /DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT !== "staging"/);
    assert.doesNotMatch(issueSource, /SUPABASE_SERVICE_ROLE_KEY|DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY|DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY/);
    assert.doesNotMatch(issueSource, /canonical-approval-readiness-service-factory|createCanonicalApprovalReadinessServerService|validateAdminReadinessIssue|validateCsrf\(/);
    assert.match(readFileSync(routeFiles[1], "utf8"), /canonical-approval-readiness-service-factory/);
    for (const file of sourceFiles("src/app")) {
      const source = readFileSync(file, "utf8");
      if (!routeFiles.includes(normalizedPath(file) as typeof routeFiles[number])) {
        assert.doesNotMatch(source, /canonical-approval-readiness-service-factory|admin-readiness-route-(?:csrf|cors|json|logging|rate-limit|response|validation)/);
      }
    }

    // A disabled feature gate prevents service construction even when every pre-service control allows.
    delete process.env.DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED;
    let state = scenario();
    let route = installRoute(require, issuePath, state);
    let received = await result(route, JSON.stringify({ profileId: id, targetComplianceStatus: "lite_verified", policyVersion: "policy-v1" }));
    assert.deepEqual(received, { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } });
    assert.equal(state.factoryCalls, 0);
    assert.deepEqual(state.trace, []);

    // The issuance endpoint requires no body or incoming CSRF token; only its
    // server-only composition decides origin, authority, context, throttle, and issuer access.
    process.env.DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED = "true";
    state = scenario(); route = installRoute(require, issuePath, state);
    received = await result(route, "", false);
    assert.deepEqual(received, { status: 201, body: { kind: "issued", code: "csrf_issued", csrfToken: "x".repeat(43), expiresAt: "2026-08-31T12:00:00.000Z" } });
    assert.deepEqual(state.trace, ["csrf_issue"]); assert.equal(state.factoryCalls, 0); assert.equal(state.csrfIssueCalls, 1);
    assert.equal((state.events[0] as Record<string, unknown>).operation, "issue");
    assert.equal("token" in (state.events[0] as Record<string, unknown>), false);
    assert.equal("csrfToken" in (state.events[0] as Record<string, unknown>), false);

    // The staging diagnostic is anchored to the request URL rather than the
    // deployment-label key, because that key can itself be malformed.
    const stagingOrigin = "https://deraledger-staging.vercel.app";
    const previousDeploymentLabel = process.env.DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT;
    const originalWarn = console.warn;
    const warningEvents: unknown[][] = [];
    console.warn = (...args: unknown[]) => { warningEvents.push(args); };
    try {
      delete process.env.DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT;
      state = scenario(); state.csrfIssue = { kind: "deny", code: "origin_denied" }; route = installRoute(require, issuePath, state);
      received = await result(route, "", false, stagingOrigin, "https://arbitrary-header.example");
      assert.deepEqual(received, { status: 400, body: { kind: "denied", code: "origin_denied" } });
      assert.deepEqual(state.runtimeDiagnosticCalls, ["https://arbitrary-header.example"]);
      assert.deepEqual(warningEvents, [["admin_readiness_staging_runtime_diagnostic", { final_failure_category: "request_origin_mismatch" }]]);

      process.env.DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT = '"staging"';
      state = scenario(); state.csrfIssue = { kind: "deny", code: "origin_denied" }; route = installRoute(require, issuePath, state);
      received = await result(route, "", false, stagingOrigin);
      assert.deepEqual(received, { status: 400, body: { kind: "denied", code: "origin_denied" } });
      assert.deepEqual(state.runtimeDiagnosticCalls, [origin]);
      assert.equal(warningEvents.length, 2);

      state = scenario(); state.csrfIssue = { kind: "deny", code: "origin_denied" }; route = installRoute(require, issuePath, state);
      received = await result(route, "", false, "https://not-staging.example.test");
      assert.deepEqual(received, { status: 400, body: { kind: "denied", code: "origin_denied" } });
      assert.deepEqual(state.runtimeDiagnosticCalls, []);
      assert.equal(warningEvents.length, 2);
    } finally {
      console.warn = originalWarn;
      if (previousDeploymentLabel === undefined) delete process.env.DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT;
      else process.env.DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT = previousDeploymentLabel;
    }
    assert.equal(state.factoryCalls, 0);
    state = scenario(); state.csrfIssue = { kind: "deny", code: "authority_denied" }; route = installRoute(require, issuePath, state);
    received = await result(route, "", false);
    assert.deepEqual(received, { status: 403, body: { kind: "denied", code: "authority_denied" } }); assert.equal(state.factoryCalls, 0);
    state = scenario(); state.csrfIssue = { kind: "deny", code: "rate_limited" }; route = installRoute(require, issuePath, state);
    received = await result(route, "", false);
    assert.deepEqual(received, { status: 429, body: { kind: "throttled", code: "rate_limited" } }); assert.equal(state.factoryCalls, 0);
    state = scenario(); state.csrfIssue = { kind: "unavailable", code: "csrf_unavailable" }; route = installRoute(require, issuePath, state);
    received = await result(route, "", false);
    assert.deepEqual(received, { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } }); assert.equal(state.factoryCalls, 0);

    state = scenario(); route = installRoute(require, snapshotPath, state);
    received = await result(route, JSON.stringify({ decisionRequestId: requestId }));
    assert.deepEqual(received, { status: 200, body: { kind: "ready", code: "ready" } });
    assert.deepEqual(state.trace, ["csrf", "throttle", "factory", "snapshot"]); assert.equal(state.issueCalls, 0);
    assert.equal((state.events[0] as Record<string, unknown>).operation, "snapshot");
    assert.equal("merchantId" in received.body, false);

    // With available security context, a missing snapshot token remains a
    // safe CSRF denial rather than an opaque configuration failure.
    state = scenario(); state.csrf = { kind: "deny", code: "csrf_denied" }; route = installRoute(require, snapshotPath, state);
    received = await result(route, JSON.stringify({ decisionRequestId: requestId }), false);
    assert.deepEqual(received, { status: 400, body: { kind: "denied", code: "csrf_denied" } });
    assert.equal(state.csrfEvidence, null); assert.equal(state.factoryCalls, 0);
  } finally {
    if (previousGate === undefined) delete process.env.DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED;
    else process.env.DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED = previousGate;
  }

  console.log("admin-readiness-routes.test.ts passed");
}

void run();
