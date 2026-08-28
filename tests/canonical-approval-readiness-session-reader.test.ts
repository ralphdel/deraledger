import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire, Module } from "node:module";

type SessionReaderModule = typeof import("../src/lib/compliance/server/canonical-approval-readiness-session-reader");

const userId = "00000000-0000-4000-8000-000000000103";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function installServerOnlyShim(require: NodeRequire): void {
  const path = require.resolve("server-only");
  const shim = new Module(path);
  shim.filename = path;
  shim.loaded = true;
  shim.exports = {};
  require.cache[path] = shim as never;
}

async function run() {
  const require = createRequire(import.meta.url);
  installServerOnlyShim(require);

  let calls = 0;
  let response: unknown = {
    data: { user: { id: userId, app_metadata: { is_super_admin: true }, user_metadata: { is_super_admin: false } } },
    error: null,
  };
  let clientFailure = false;
  const serverPath = require.resolve("../src/lib/supabase/server");
  const serverShim = new Module(serverPath);
  serverShim.filename = serverPath;
  serverShim.loaded = true;
  serverShim.exports = {
    async createClient() {
      if (clientFailure) throw new Error("missing request context");
      return {
        auth: {
          async getUser() {
            calls += 1;
            return response;
          },
        },
      };
    },
  };
  require.cache[serverPath] = serverShim as never;

  const module = require("../src/lib/compliance/server/canonical-approval-readiness-session-reader") as SessionReaderModule;
  assert.equal(module.createCanonicalApprovalReadinessSessionReader.length, 0);
  const reader = module.createCanonicalApprovalReadinessSessionReader();
  assert.deepEqual(await reader.readAuthenticatedServerSessionUser(), {
    id: userId,
    app_metadata: { is_super_admin: true },
    user_metadata: { is_super_admin: false },
  });
  assert.equal(calls, 1);

  for (const unsafeResponse of [
    { data: { user: null }, error: null },
    { data: { user: { id: "invalid", app_metadata: {}, user_metadata: {} } }, error: null },
    { data: { user: { id: userId, app_metadata: [], user_metadata: {} } }, error: null },
    { data: { user: { id: userId, app_metadata: {}, user_metadata: [] } }, error: null },
    { data: { user: { id: userId, app_metadata: {}, user_metadata: {} } }, error: { message: "private auth failure" } },
  ]) {
    response = unsafeResponse;
    assert.equal(await module.createCanonicalApprovalReadinessSessionReader().readAuthenticatedServerSessionUser(), null);
  }

  clientFailure = true;
  assert.equal(await module.createCanonicalApprovalReadinessSessionReader().readAuthenticatedServerSessionUser(), null);

  const source = readFileSync("src/lib/compliance/server/canonical-approval-readiness-session-reader.ts", "utf8");
  assert.match(source, /^import\s+["']server-only["']/);
  assert.match(source, /await client\.auth\.getUser\(\)/);
  assert.match(source, /export function createCanonicalApprovalReadinessSessionReader/);
  assert.doesNotMatch(source, /requireAdminPortalSession|requireSuperAdminSession|auth\.admin|service.role|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/i);
  assert.doesNotMatch(source, /issue_canonical_approval|read_canonical_approval_snapshot|review_compliance_profile_decision/i);
  assert.doesNotMatch(source, /activation|collection|payment|provider|checkout|subscription|invoice|storefront/i);
  assert.doesNotMatch(source, /export\s+(?:const|class|interface|type)\s+(?:.*Client|.*Supabase|.*Auth|.*Table|.*Rpc)/);

  for (const file of sourceFiles("src/app")) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /canonical-approval-readiness-session-reader|canonicalApprovalReadinessSessionReader/);
  }
  for (const file of sourceFiles("src/lib")) {
    if (file.endsWith("canonical-approval-readiness-session-reader.ts")) continue;
    if (/route\.ts$|page\.tsx$|action|webhook|payment|provider|checkout|subscription|invoice|storefront/i.test(file)) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /canonical-approval-readiness-session-reader|canonicalApprovalReadinessSessionReader/);
    }
  }
  console.log("canonical-approval-readiness-session-reader.test.ts passed");
}

void run();
