import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire, Module } from "node:module";

type RouteModule = { POST(request: Request): Promise<Response> };
type Scenario = {
  csrf: { kind: "allow" } | { kind: "deny"; code: "csrf_denied" } | { kind: "unavailable"; code: "csrf_unavailable" };
  throttle: { kind: "allow" } | { kind: "deny"; code: "rate_limited" } | { kind: "unavailable"; code: "throttle_unavailable" };
  issueResult: unknown;
  snapshotResult: unknown;
  trace: string[];
  events: unknown[];
  factoryCalls: number;
  issueCalls: number;
  snapshotCalls: number;
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
    snapshotCalls: 0,
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
        async validateCsrf() { state.trace.push("csrf"); return state.csrf; },
        async checkThrottle() { state.trace.push("throttle"); return state.throttle; },
      };
    },
  }) as never;

  const loggingPath = require.resolve("../src/lib/compliance/server/admin-readiness-route-logging");
  require.cache[loggingPath] = moduleShim(loggingPath, {
    createAdminReadinessCorrelationId() { return "00000000-0000-4000-8000-000000000107"; },
    createAdminReadinessOperationalEvent(input: object) { state.events.push(input); return input; },
  }) as never;

  const resolvedRoutePath = require.resolve(routePath);
  delete require.cache[resolvedRoutePath];
  return require(routePath) as RouteModule;
}

function request(body: string): Request {
  return new Request(`${origin}/api/internal/admin/compliance/readiness`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-deraledger-readiness-csrf": "test-csrf-evidence",
    },
    body,
  });
}

async function result(route: RouteModule, body: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await route.POST(request(body));
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function run() {
  const require = createRequire(import.meta.url);
  const previousGate = process.env.DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED;

  try {
    for (const file of routeFiles) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /^import\s+["']server-only["']/);
      assert.match(source, /canonical-approval-readiness-service-factory/);
      assert.match(source, /admin-readiness-route-(?:json|logging|response|validation|security-composition)/);
      assert.doesNotMatch(source, /createClient|Supabase|auth\.admin|service.role|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
      assert.doesNotMatch(source, /approval decision|activate|collection unlock|payment|provider|checkout|subscription|invoice|storefront|compliance_reviewer|support manager|compliance manager|compliance officer/i);
      assert.doesNotMatch(source, /deraledger\.com\/admin/i);
    }
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
    assert.deepEqual(state.trace, ["csrf", "throttle"]);

    // Parser and command validation reject before security controls and the factory.
    process.env.DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED = "true";
    state = scenario(); route = installRoute(require, issuePath, state);
    received = await result(route, "{");
    assert.equal(received.status, 400); assert.equal(state.factoryCalls, 0); assert.deepEqual(state.trace, []);
    state = scenario(); route = installRoute(require, issuePath, state);
    received = await result(route, `{"profileId":"${id}","profileId":"${id}","targetComplianceStatus":"lite_verified","policyVersion":"policy-v1"}`);
    assert.equal(received.status, 400); assert.equal(state.factoryCalls, 0); assert.deepEqual(state.trace, []);
    state = scenario(); route = installRoute(require, issuePath, state);
    received = await result(route, JSON.stringify({ profileId: id, targetComplianceStatus: "lite_verified", policyVersion: "policy-v1", authority: "super_admin" }));
    assert.equal(received.status, 400); assert.equal(state.factoryCalls, 0); assert.deepEqual(state.trace, []);
    state = scenario(); route = installRoute(require, issuePath, state);
    received = await result(route, JSON.stringify({ profileId: id, targetComplianceStatus: "lite_verified", policyVersion: "policy-v1", idempotencyKey: "browser-value" }));
    assert.equal(received.status, 400); assert.equal(state.factoryCalls, 0); assert.deepEqual(state.trace, []);

    // CSRF and throttle both deny before factory construction.
    state = scenario(); state.csrf = { kind: "deny", code: "csrf_denied" }; route = installRoute(require, issuePath, state);
    received = await result(route, JSON.stringify({ profileId: id, targetComplianceStatus: "lite_verified", policyVersion: "policy-v1" }));
    assert.equal(received.status, 400); assert.deepEqual(state.trace, ["csrf"]); assert.equal(state.factoryCalls, 0);
    state = scenario(); state.throttle = { kind: "deny", code: "rate_limited" }; route = installRoute(require, issuePath, state);
    received = await result(route, JSON.stringify({ profileId: id, targetComplianceStatus: "lite_verified", policyVersion: "policy-v1" }));
    assert.equal(received.status, 429); assert.deepEqual(state.trace, ["csrf", "throttle"]); assert.equal(state.factoryCalls, 0);

    // With the explicit gate and injected reviewed seams enabled, only the requested readiness operation runs.
    state = scenario(); route = installRoute(require, issuePath, state);
    received = await result(route, JSON.stringify({ profileId: id, targetComplianceStatus: "lite_verified", policyVersion: "policy-v1" }));
    assert.deepEqual(received, { status: 201, body: { kind: "created", code: "created" } });
    assert.deepEqual(state.trace, ["csrf", "throttle", "factory", "issue"]); assert.equal(state.snapshotCalls, 0);
    assert.equal((state.events[0] as Record<string, unknown>).operation, "issue");
    assert.equal("decisionIdempotencyKey" in (state.events[0] as Record<string, unknown>), false);

    state = scenario(); route = installRoute(require, snapshotPath, state);
    received = await result(route, JSON.stringify({ decisionRequestId: requestId }));
    assert.deepEqual(received, { status: 200, body: { kind: "ready", code: "ready" } });
    assert.deepEqual(state.trace, ["csrf", "throttle", "factory", "snapshot"]); assert.equal(state.issueCalls, 0);
    assert.equal((state.events[0] as Record<string, unknown>).operation, "snapshot");
    assert.equal("merchantId" in received.body, false);
  } finally {
    if (previousGate === undefined) delete process.env.DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED;
    else process.env.DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED = previousGate;
  }

  console.log("admin-readiness-routes.test.ts passed");
}

void run();
