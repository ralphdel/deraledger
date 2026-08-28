import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";

const sessionA = "a".repeat(32);
const sessionB = "b".repeat(32);

function moduleShim(path: string, exports: object): Module {
  const shim = new Module(path);
  shim.filename = path;
  shim.loaded = true;
  shim.exports = exports;
  return shim;
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = moduleShim(serverOnlyPath, {}) as never;
  const token = require("../src/lib/compliance/server/admin-readiness-csrf-token") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-token");
  const storageModule = require("../src/lib/compliance/server/admin-readiness-csrf-storage") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-storage");
  const lifecycle = require("../src/lib/compliance/server/admin-readiness-csrf-issuer") as typeof import("../src/lib/compliance/server/admin-readiness-csrf-issuer");

  const firstToken = token.createAdminReadinessCsrfToken();
  const secondToken = token.createAdminReadinessCsrfToken();
  assert.match(firstToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(firstToken, secondToken);

  let now = 1_000_000;
  const storage = storageModule.createInMemoryAdminReadinessCsrfStorage();
  const issuer = lifecycle.createAdminReadinessCsrfIssuer({ storage, now: () => now });
  const validator = lifecycle.createAdminReadinessCsrfLifecycleValidator({ storage, now: () => now });
  const issued = await issuer.issue({ operation: "issue", method: "POST", sessionBindingReference: sessionA, expiresInMs: 1_000 });
  assert.ok(issued);
  if (!issued) throw new Error("issuance unexpectedly failed");
  assert.equal(issued.token.length, 43);
  assert.equal(issued.expiresAt, new Date(now + 1_000).toISOString());
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: issued.token, sessionBindingReference: sessionA }), { kind: "allow" });
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: null, sessionBindingReference: sessionA }), { kind: "deny", code: "csrf_denied" });
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: "malformed", sessionBindingReference: sessionA }), { kind: "deny", code: "csrf_denied" });
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: issued.token, sessionBindingReference: sessionB }), { kind: "deny", code: "csrf_denied" });

  now += 1_001;
  assert.deepEqual(await validator.validate({ operation: "issue", method: "POST", csrfEvidence: issued.token, sessionBindingReference: sessionA }), { kind: "deny", code: "csrf_denied" });

  now = 2_000_000;
  const rotating = await issuer.issue({ operation: "snapshot", method: "POST", sessionBindingReference: sessionA });
  assert.ok(rotating);
  if (!rotating) throw new Error("issuance unexpectedly failed");
  const rotated = await issuer.rotate({ operation: "snapshot", method: "POST", sessionBindingReference: sessionA, previousToken: rotating.token });
  assert.ok(rotated);
  if (!rotated) throw new Error("rotation unexpectedly failed");
  assert.deepEqual(await validator.validate({ operation: "snapshot", method: "POST", csrfEvidence: rotating.token, sessionBindingReference: sessionA }), { kind: "deny", code: "csrf_denied" });
  assert.deepEqual(await validator.validate({ operation: "snapshot", method: "POST", csrfEvidence: rotated.token, sessionBindingReference: sessionA }), { kind: "allow" });
  assert.equal(await issuer.invalidateSessionBinding(sessionA), true);
  assert.deepEqual(await validator.validate({ operation: "snapshot", method: "POST", csrfEvidence: rotated.token, sessionBindingReference: sessionA }), { kind: "deny", code: "csrf_denied" });

  const unavailable = lifecycle.createAdminReadinessCsrfLifecycleValidator({ storage: null, now: () => now });
  assert.deepEqual(await unavailable.validate({ operation: "issue", method: "POST", csrfEvidence: firstToken, sessionBindingReference: sessionA }), { kind: "unavailable", code: "csrf_unavailable" });
  const throwingStorage = {
    async write() { throw new Error("storage failure"); },
    async read() { throw new Error("storage failure"); },
    async remove() { throw new Error("storage failure"); },
    async invalidateSessionBinding() { throw new Error("storage failure"); },
  };
  const unavailableIssuer = lifecycle.createAdminReadinessCsrfIssuer({ storage: throwingStorage, now: () => now });
  assert.equal(await unavailableIssuer.issue({ operation: "issue", method: "POST", sessionBindingReference: sessionA }), null);
  assert.equal(await unavailableIssuer.invalidateSessionBinding(sessionA), false);
  const unavailableValidator = lifecycle.createAdminReadinessCsrfLifecycleValidator({ storage: throwingStorage, now: () => now });
  assert.deepEqual(await unavailableValidator.validate({ operation: "issue", method: "POST", csrfEvidence: firstToken, sessionBindingReference: sessionA }), { kind: "unavailable", code: "csrf_unavailable" });

  const files = [
    "src/lib/compliance/server/admin-readiness-csrf-token.ts",
    "src/lib/compliance/server/admin-readiness-csrf-storage.ts",
    "src/lib/compliance/server/admin-readiness-csrf-issuer.ts",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /^import\s+["']server-only["']/);
    assert.doesNotMatch(source, /canonical-approval-readiness-service-factory|createCanonicalApprovalReadinessServerService|src\/app|route\.ts|page\.tsx|webhook|createClient|auth\.admin|service.role/i);
    assert.doesNotMatch(source, /\b(?:supabase|client)\.(?:from|rpc)\(|\b(?:supabase|client)\.(?:insert|update|delete)\(/i);
    assert.doesNotMatch(source, /approval execution|activation|collection unlock|payment|provider|checkout|subscription|invoice|storefront|compliance_reviewer|support manager|compliance manager|compliance officer/i);
    assert.doesNotMatch(source, /console\.|logger|localStorage|sessionStorage|query string/i);
  }
  const issueRoute = readFileSync("src/app/api/internal/admin/compliance/readiness/issue/route.ts", "utf8");
  const snapshotRoute = readFileSync("src/app/api/internal/admin/compliance/readiness/snapshot/route.ts", "utf8");
  assert.match(issueRoute, /DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED/);
  assert.match(snapshotRoute, /DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED/);
  assert.doesNotMatch(issueRoute, /admin-readiness-csrf-(?:token|storage|issuer)/);
  assert.doesNotMatch(snapshotRoute, /admin-readiness-csrf-(?:token|storage|issuer)/);
  console.log("admin-readiness-csrf-lifecycle.test.ts passed");
}

void run();
