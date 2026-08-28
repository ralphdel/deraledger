import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire, Module } from "node:module";

type ResolverModule = typeof import("../src/lib/compliance/server/canonical-approval-readiness-reviewer-resolver");

const reviewerId = "00000000-0000-4000-8000-000000000102";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyShimPath = require.resolve("server-only");
  const serverOnlyShim = new Module(serverOnlyShimPath);
  serverOnlyShim.filename = serverOnlyShimPath;
  serverOnlyShim.loaded = true;
  serverOnlyShim.exports = {};
  require.cache[serverOnlyShimPath] = serverOnlyShim as never;
  const module = require("../src/lib/compliance/server/canonical-approval-readiness-reviewer-resolver") as ResolverModule;

  let reads = 0;
  const accepted = module.createCanonicalApprovalReadinessReviewerResolver({
    sessionUserReader: {
      async readAuthenticatedServerSessionUser() {
        reads += 1;
        return { id: reviewerId, app_metadata: { is_super_admin: true }, user_metadata: { is_super_admin: false } };
      },
    },
  });
  assert.deepEqual(await accepted.resolveServerSessionReviewer(), { actorKind: "super_admin", reviewerId });
  assert.equal(reads, 1);

  for (const sessionUser of [
    null,
    { id: reviewerId, user_metadata: { is_super_admin: true } },
    { id: reviewerId, app_metadata: { is_super_admin: false } },
    { id: "not-a-uuid", app_metadata: { is_super_admin: true } },
    { id: reviewerId, app_metadata: { is_super_admin: "true" } },
    { id: reviewerId, app_metadata: null },
    { id: reviewerId, app_metadata: { is_super_admin: true, role: "merchant_owner" } },
  ]) {
    const resolver = module.createCanonicalApprovalReadinessReviewerResolver({
      sessionUserReader: { async readAuthenticatedServerSessionUser() { return sessionUser; } },
    });
    const expected = (sessionUser as { app_metadata?: { is_super_admin?: unknown } } | null)?.app_metadata?.is_super_admin === true
      && (sessionUser as { id?: string } | null)?.id === reviewerId
      && !(sessionUser as { app_metadata?: { role?: unknown } } | null)?.app_metadata?.role
      ? { actorKind: "super_admin", reviewerId }
      : null;
    assert.deepEqual(await resolver.resolveServerSessionReviewer(), expected);
  }

  const readerFailure = module.createCanonicalApprovalReadinessReviewerResolver({
    sessionUserReader: { async readAuthenticatedServerSessionUser() { throw new Error("private session failure"); } },
  });
  assert.equal(await readerFailure.resolveServerSessionReviewer(), null);

  const source = readFileSync("src/lib/compliance/server/canonical-approval-readiness-reviewer-resolver.ts", "utf8");
  assert.match(source, /^import\s+["']server-only["']/);
  assert.match(source, /readAuthenticatedServerSessionUser\(\)/);
  assert.match(source, /app_metadata\.is_super_admin === true/);
  assert.doesNotMatch(source, /user_metadata\.is_super_admin === true/);
  assert.doesNotMatch(source, /createClient|Supabase|service.role|auth\.admin|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
  assert.doesNotMatch(source, /issue_canonical_approval|read_canonical_approval_snapshot|review_compliance_profile_decision/i);
  assert.doesNotMatch(source, /activation|collection|payment|provider|checkout|subscription|invoice|storefront/i);
  assert.doesNotMatch(source, /psql|Invoke-RestMethod|Invoke-WebRequest|child_process|exec\(/i);
  assert.match(source, /export function createCanonicalApprovalReadinessReviewerResolver/);
  assert.doesNotMatch(source, /export\s+(?:const|class|interface)\s+(?:.*Client|.*Reader|.*Auth|.*Supabase)/);

  for (const file of sourceFiles("src/app")) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /canonical-approval-readiness-reviewer-resolver|canonicalApprovalReadinessReviewerResolver/);
  }
  for (const file of sourceFiles("src/lib")) {
    if (file.endsWith("canonical-approval-readiness-reviewer-resolver.ts")) continue;
    const content = readFileSync(file, "utf8");
    if (/route\.ts$|page\.tsx$|action|webhook|payment|provider|checkout|subscription|invoice|storefront/i.test(file)) {
      assert.doesNotMatch(content, /canonical-approval-readiness-reviewer-resolver|canonicalApprovalReadinessReviewerResolver/);
    }
  }
  console.log("canonical-approval-readiness-reviewer-resolver.test.ts passed");
}

void run();
