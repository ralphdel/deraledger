import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire, Module } from "node:module";

type FactoryModule = typeof import("../src/lib/compliance/server/canonical-approval-readiness-service-factory");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

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

  const sessionReader = { async readAuthenticatedServerSessionUser() { return null; } };
  const reviewerResolver = { async resolveServerSessionReviewer() { return null; } };
  let sessionFactoryCalls = 0;
  let resolverFactoryCalls = 0;
  let serviceFactoryCalls = 0;
  let issued = 0;
  let snapshotsRead = 0;
  const issue = async () => { issued += 1; return { kind: "rejected" as const, diagnostics: [{ code: "canonical_readiness_authority_denied" as const }] }; };
  const readSnapshot = async () => { snapshotsRead += 1; return { kind: "rejected" as const, diagnostics: [{ code: "canonical_readiness_authority_denied" as const }] }; };

  const sessionReaderPath = require.resolve("../src/lib/compliance/server/canonical-approval-readiness-session-reader");
  require.cache[sessionReaderPath] = moduleShim(sessionReaderPath, {
    createCanonicalApprovalReadinessSessionReader() { sessionFactoryCalls += 1; return sessionReader; },
  }) as never;
  const resolverPath = require.resolve("../src/lib/compliance/server/canonical-approval-readiness-reviewer-resolver");
  require.cache[resolverPath] = moduleShim(resolverPath, {
    createCanonicalApprovalReadinessReviewerResolver(dependencies: { sessionUserReader: unknown }) {
      resolverFactoryCalls += 1;
      assert.equal(dependencies.sessionUserReader, sessionReader);
      return reviewerResolver;
    },
  }) as never;
  const servicePath = require.resolve("../src/lib/compliance/server/canonical-approval-readiness-service");
  require.cache[servicePath] = moduleShim(servicePath, {
    createCanonicalApprovalReadinessService(dependencies: { reviewerResolver: unknown }) {
      serviceFactoryCalls += 1;
      assert.equal(dependencies.reviewerResolver, reviewerResolver);
      return { issue, readSnapshot };
    },
  }) as never;

  const module = require("../src/lib/compliance/server/canonical-approval-readiness-service-factory") as FactoryModule;
  assert.deepEqual(Object.keys(module), ["createCanonicalApprovalReadinessServerService"]);
  assert.equal(module.createCanonicalApprovalReadinessServerService.length, 0);
  const service = module.createCanonicalApprovalReadinessServerService();
  assert.equal(sessionFactoryCalls, 1);
  assert.equal(resolverFactoryCalls, 1);
  assert.equal(serviceFactoryCalls, 1);
  assert.deepEqual(Object.keys(service).sort(), ["issue", "readSnapshot"]);
  assert.equal(issued, 0);
  assert.equal(snapshotsRead, 0);

  await service.issue({
    profileId: "00000000-0000-4000-8000-000000000104",
    targetComplianceStatus: "lite_verified",
    policyVersion: "policy-v1",
  });
  await service.readSnapshot({ decisionRequestId: "00000000-0000-4000-8000-000000000105" });
  assert.equal(issued, 1);
  assert.equal(snapshotsRead, 1);

  const source = readFileSync("src/lib/compliance/server/canonical-approval-readiness-service-factory.ts", "utf8");
  assert.match(source, /^import\s+["']server-only["']/);
  assert.match(source, /export function createCanonicalApprovalReadinessServerService\(\)/);
  assert.match(source, /createCanonicalApprovalReadinessSessionReader\(\)/);
  assert.match(source, /createCanonicalApprovalReadinessReviewerResolver\(\{ sessionUserReader \}\)/);
  assert.match(source, /createCanonicalApprovalReadinessService\(\{ reviewerResolver \}\)/);
  assert.doesNotMatch(source, /createCanonicalApprovalReadinessServerService\([^)]/);
  assert.doesNotMatch(source, /createClient|Supabase|auth\.admin|service.role|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
  assert.doesNotMatch(source, /createCanonicalApprovalReadinessService\(\{[^}]*?(?:transport|reviewerId|authority|role|metadata|userId|email)/i);
  assert.doesNotMatch(source, /createCanonicalApprovalReadinessReviewerResolver\(\{[^}]*?(?:authority|role|metadata|userId|email)/i);
  assert.doesNotMatch(source, /issue\(|readSnapshot\(/);
  assert.doesNotMatch(source, /activation|collection|payment|provider|checkout|subscription|invoice|storefront|compliance_reviewer|support manager|compliance manager|compliance officer/i);
  assert.doesNotMatch(source, /deraledger\.com\/admin/i);
  assert.doesNotMatch(source, /export\s+(?:const|class|interface|type)\s+(?:.*Client|.*Auth|.*Session|.*Reader|.*Rpc|.*Table|.*Role)/);

  for (const file of sourceFiles("src/app")) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /canonical-approval-readiness-service-factory|canonicalApprovalReadinessServerService/);
  }
  for (const file of sourceFiles("src/lib")) {
    if (file.endsWith("canonical-approval-readiness-service-factory.ts")) continue;
    if (/route\.ts$|page\.tsx$|action|webhook|admin|payment|provider|checkout|subscription|invoice|storefront/i.test(file)) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /canonical-approval-readiness-service-factory|canonicalApprovalReadinessServerService/);
    }
  }
  console.log("canonical-approval-readiness-service-factory.test.ts passed");
}

void run();
