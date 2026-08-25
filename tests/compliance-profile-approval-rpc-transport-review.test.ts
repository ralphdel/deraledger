import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function run() {
  const rpcCore = readFileSync("src/lib/compliance/compliance-profile-approval-rpc-client-core.ts", "utf8");
  const rpcFacade = readFileSync("src/lib/compliance/compliance-profile-approval-rpc-client.ts", "utf8");
  const candidate = readFileSync("src/lib/solo-plus/server/supabase-repository.ts", "utf8");

  assert.match(rpcFacade, /import\s+["']server-only["']/);
  assert.match(rpcCore, /interface ReviewedProfileApprovalRpcTransport/);
  assert.doesNotMatch(rpcCore, /createSoloPlusServiceRoleClient|createSupabaseClient|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(candidate, /export function createSoloPlusServiceRoleClient/);
  assert.doesNotMatch(candidate, /^import\s+["']server-only["'];/m);
  assert.match(candidate, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(candidate, /\.from\(|\.insert\(|\.update\(|\.rpc\(/);

  for (const file of [...sourceFiles("src/app"), "src/lib/actions.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /compliance-profile-approval-(?:rpc-client|transaction-executor)/);
  }
  console.log("compliance-profile-approval-rpc-transport-review.test.ts passed");
}

run();
