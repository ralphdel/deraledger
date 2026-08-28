import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire, Module } from "node:module";

const approvedPrimitiveRouteImports = new Set([
  "src/app/api/internal/admin/compliance/readiness/issue/route.ts",
  "src/app/api/internal/admin/compliance/readiness/snapshot/route.ts",
]);

const issue = { profileId: "00000000-0000-4000-8000-000000000001", targetComplianceStatus: "lite_verified", policyVersion: "v1" };
const decisionRequestId = "00000000-0000-4000-8000-000000000003";
const readySnapshot = {
  decisionRequestId,
  profileId: "00000000-0000-4000-8000-000000000004",
  planCode: "solo_lite",
  currentComplianceStatus: "lite_pending",
  sourceType: "solo_lite_review",
  sourceVersion: 1,
  expectedProfileRowVersion: 1,
  policyVersion: "v1",
  reasonCode: null,
  targetComplianceStatus: "lite_verified",
};
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/");
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyPath = require.resolve("server-only");
  const shim = new Module(serverOnlyPath); shim.filename = serverOnlyPath; shim.loaded = true; shim.exports = {};
  require.cache[serverOnlyPath] = shim as never;
  const { readAdminReadinessJsonBody } = require("../src/lib/compliance/server/admin-readiness-route-json") as typeof import("../src/lib/compliance/server/admin-readiness-route-json");
  const { validateAdminReadinessIssue, validateAdminReadinessSnapshot } = require("../src/lib/compliance/server/admin-readiness-route-validation") as typeof import("../src/lib/compliance/server/admin-readiness-route-validation");
  const { createAdminReadinessCsrfValidator } = require("../src/lib/compliance/server/admin-readiness-route-csrf") as typeof import("../src/lib/compliance/server/admin-readiness-route-csrf");
  const { adminReadinessPreflight, checkAdminReadinessOrigin } = require("../src/lib/compliance/server/admin-readiness-route-cors") as typeof import("../src/lib/compliance/server/admin-readiness-route-cors");
  const { createAdminReadinessThrottle } = require("../src/lib/compliance/server/admin-readiness-route-rate-limit") as typeof import("../src/lib/compliance/server/admin-readiness-route-rate-limit");
  const { mapAdminReadinessRouteOutcome } = require("../src/lib/compliance/server/admin-readiness-route-response") as typeof import("../src/lib/compliance/server/admin-readiness-route-response");
  const { createAdminReadinessCorrelationId, createAdminReadinessOperationalEvent } = require("../src/lib/compliance/server/admin-readiness-route-logging") as typeof import("../src/lib/compliance/server/admin-readiness-route-logging");
  const body = (rawBody: string, contentType = "application/json") => readAdminReadinessJsonBody({ rawBody, contentType });
  assert.equal(body(JSON.stringify(issue), "text/plain").ok, false);
  assert.equal(readAdminReadinessJsonBody({ rawBody: JSON.stringify(issue), contentType: "application/json", maxBytes: 1 }).ok, false);
  for (const raw of ["{", "[]", "null", "1", '{"profileId":"a","profileId":"b"}', '{"outer":{"x":1,"x":2}}', '{"a\\u0062":1,"ab":2}', '{"a":"\\q"}']) assert.equal(body(raw).ok, false, raw);
  assert.equal(body('{"a":"profileId"}').ok, true);
  assert.equal(body('{"a":"profileId\\\": value"}').ok, true);
  const parsed = body(JSON.stringify(issue)); assert.equal(parsed.ok, true); if (parsed.ok) assert.equal(validateAdminReadinessIssue(parsed.value).ok, true);
  assert.equal(validateAdminReadinessSnapshot({ decisionRequestId: "00000000-0000-4000-8000-000000000002" }).ok, true);
  for (const candidate of [{ ...issue, role: "super_admin" }, { ...issue, idempotencyKey: "x" }, { ...issue, profileId: "bad" }, { ...issue, targetComplianceStatus: "bad" }, { ...issue, policyVersion: " " }, { ...issue, policyVersion: "x".repeat(129) }, { ...issue, reasonCode: "bad" }, { ...issue, extra: {} }]) assert.equal(validateAdminReadinessIssue(candidate).ok, false);
  assert.equal(validateAdminReadinessIssue({ ...issue, reasonCode: null }).ok, true);
  const csrfInput = { operation: "issue" as const, method: "POST" as const, csrfEvidence: "e".repeat(24), sessionBindingReference: "a".repeat(12) };
  assert.deepEqual(await createAdminReadinessCsrfValidator().validate(csrfInput), { kind: "unavailable", code: "csrf_unavailable" });
  assert.deepEqual(await createAdminReadinessCsrfValidator({ async validate() { return { kind: "allow" } as const; } }).validate(csrfInput), { kind: "allow" });
  assert.deepEqual(await createAdminReadinessCsrfValidator({ async validate() { return { kind: "deny", code: "csrf_denied" } as const; } }).validate({ ...csrfInput, csrfEvidence: null }), { kind: "deny", code: "csrf_denied" });
  assert.deepEqual(await createAdminReadinessCsrfValidator({ async validate() { return { kind: "unknown" } as never; } }).validate(csrfInput), { kind: "unavailable", code: "csrf_unavailable" });
  assert.deepEqual(await createAdminReadinessCsrfValidator({ async validate() { throw new Error("raw token"); } }).validate(csrfInput), { kind: "unavailable", code: "csrf_unavailable" });
  assert.equal(checkAdminReadinessOrigin("https://admin.example.test", "https://admin.example.test").ok, true);
  assert.equal(checkAdminReadinessOrigin("null", "https://admin.example.test").ok, false);
  assert.equal(checkAdminReadinessOrigin("https://other.example.test", "https://admin.example.test").ok, false);
  assert.equal(adminReadinessPreflight().status, 204);
  assert.equal((await createAdminReadinessThrottle().check({ operation: "issue", subjectHash: "a".repeat(12) })).kind, "unavailable");
  assert.deepEqual(await createAdminReadinessThrottle({ async check() { return { kind: "allow" } as const; } }).check({ operation: "snapshot", subjectHash: "b".repeat(12) }), { kind: "allow" });
  assert.deepEqual(await createAdminReadinessThrottle({ async check() { return { kind: "deny", code: "rate_limited" } as const; } }).check({ operation: "snapshot", subjectHash: "b".repeat(12) }), { kind: "deny", code: "rate_limited" });
  assert.deepEqual(await createAdminReadinessThrottle({ async check() { return { kind: "unknown" } as never; } }).check({ operation: "snapshot", subjectHash: "b".repeat(12) }), { kind: "unavailable", code: "throttle_unavailable" });
  assert.deepEqual(await createAdminReadinessThrottle({ async check() { throw new Error("raw checker error"); } }).check({ operation: "snapshot", subjectHash: "b".repeat(12) }), { kind: "unavailable", code: "throttle_unavailable" });
  assert.equal(mapAdminReadinessRouteOutcome({ kind: "created", decisionRequestId, decisionIdempotencyKey: "internal", diagnostics: [] }).status, 201);
  assert.equal(mapAdminReadinessRouteOutcome({ kind: "replay", decisionRequestId, decisionIdempotencyKey: "internal", diagnostics: [{ code: "canonical_request_v2_idempotent_replay" }] }).status, 200);
  assert.equal(mapAdminReadinessRouteOutcome({ kind: "ready", snapshot: readySnapshot, diagnostics: [] }).status, 200);
  assert.deepEqual(mapAdminReadinessRouteOutcome({ kind: "created", decisionRequestId: "request" }), { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } });
  assert.deepEqual(mapAdminReadinessRouteOutcome({ kind: "replay", decisionRequestId: "request" }), { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } });
  assert.deepEqual(mapAdminReadinessRouteOutcome({ kind: "ready", snapshot: {}, diagnostics: [] }), { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } });
  assert.deepEqual(mapAdminReadinessRouteOutcome({ kind: "ready", snapshot: { ...readySnapshot, merchantId: "00000000-0000-4000-8000-000000000005" }, diagnostics: [] }), { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } });
  assert.equal("decisionIdempotencyKey" in mapAdminReadinessRouteOutcome({ kind: "created", decisionRequestId, decisionIdempotencyKey: "internal" }).body, false);
  assert.equal(mapAdminReadinessRouteOutcome({ kind: "csrf_denied" }).status, 400);
  assert.equal(mapAdminReadinessRouteOutcome({ kind: "throttled" }).status, 429);
  assert.deepEqual(mapAdminReadinessRouteOutcome({ kind: "nope", error: "secret" }), { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } });
  assert.deepEqual(mapAdminReadinessRouteOutcome({ kind: "rejected", diagnostics: [{ code: "regex_shaped_but_unknown" }] }), { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } });
  assert.deepEqual(mapAdminReadinessRouteOutcome({ kind: "rejected", diagnostics: [{ code: "canonical_request_v2_idempotency_conflict" }] }), { status: 409, body: { kind: "conflict", code: "canonical_request_v2_idempotency_conflict" } });
  assert.deepEqual(mapAdminReadinessRouteOutcome({ kind: "rejected", diagnostics: "raw diagnostics" }), { status: 500, body: { kind: "unavailable", code: "internal_unavailable" } });
  const first = createAdminReadinessCorrelationId(), second = createAdminReadinessCorrelationId(); assert.notEqual(first, second);
  assert.ok(createAdminReadinessOperationalEvent({ operation: "issue", resultKind: "denied", resultCode: "invalid_request", redactedIdentifier: "...abcd" }));
  assert.equal(createAdminReadinessOperationalEvent({ operation: "issue", resultKind: "denied", resultCode: "invalid_request", redactedIdentifier: "full@example.test" }), null);
  for (const file of ["admin-readiness-route-json.ts", "admin-readiness-route-validation.ts", "admin-readiness-route-csrf.ts", "admin-readiness-route-cors.ts", "admin-readiness-route-rate-limit.ts", "admin-readiness-route-response.ts", "admin-readiness-route-logging.ts", "admin-readiness-route-security-composition.ts"]) {
    const source = readFileSync(`src/lib/compliance/server/${file}`, "utf8");
    assert.match(source, /^import\s+["']server-only["']/);
    assert.doesNotMatch(source, /canonical-approval-readiness-service-factory|createCanonicalApprovalReadinessServerService|createClient|auth\.admin|service.role|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
    assert.doesNotMatch(source, /src\/app|route\.ts|page\.tsx|webhook/i);
    assert.doesNotMatch(source, /activation|collection unlock|payment|provider|checkout|subscription|invoice|storefront|compliance_reviewer|support manager|compliance manager|compliance officer/i);
  }
  const primitive = /admin-readiness-route-(?:json|validation|csrf|cors|rate-limit|response|logging|security-composition)/;
  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    const normalized = normalizedPath(file);
    if (!normalized.includes("admin-readiness-route-") && !approvedPrimitiveRouteImports.has(normalized)) {
      assert.doesNotMatch(source, primitive);
    }
    if (/route\.ts$|page\.tsx$|action|webhook/i.test(normalized) && !approvedPrimitiveRouteImports.has(normalized)) {
      assert.doesNotMatch(source, primitive);
    }
  }
  assert.deepEqual(Object.keys(require("../src/lib/compliance/server/admin-readiness-route-json")).sort(), ["readAdminReadinessJsonBody"]);
  assert.deepEqual(Object.keys(require("../src/lib/compliance/server/admin-readiness-route-validation")).sort(), ["validateAdminReadinessIssue", "validateAdminReadinessSnapshot"]);
  assert.deepEqual(Object.keys(require("../src/lib/compliance/server/admin-readiness-route-csrf")).sort(), ["createAdminReadinessCsrfValidator", "createAdminReadinessLifecycleCsrfValidator"]);
  assert.deepEqual(Object.keys(require("../src/lib/compliance/server/admin-readiness-route-cors")).sort(), ["adminReadinessPreflight", "checkAdminReadinessOrigin", "createAdminReadinessConfiguredOriginChecker"]);
  assert.deepEqual(Object.keys(require("../src/lib/compliance/server/admin-readiness-route-rate-limit")).sort(), ["createAdminReadinessConfiguredRouteThrottle", "createAdminReadinessThrottle"]);
  assert.deepEqual(Object.keys(require("../src/lib/compliance/server/admin-readiness-route-security-composition")).sort(), ["createAdminReadinessRouteSecurityComposition"]);
  assert.deepEqual(Object.keys(require("../src/lib/compliance/server/admin-readiness-route-response")).sort(), ["mapAdminReadinessRouteOutcome"]);
  assert.deepEqual(Object.keys(require("../src/lib/compliance/server/admin-readiness-route-logging")).sort(), ["createAdminReadinessCorrelationId", "createAdminReadinessOperationalEvent"]);
  console.log("admin-readiness-route-security-primitives.test.ts passed");
}
void run();
