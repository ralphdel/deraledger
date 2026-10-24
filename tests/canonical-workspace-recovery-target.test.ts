import assert from "node:assert/strict";
import { createRequire } from "node:module";

import type { CanonicalWorkspaceRecoveryTargetInput } from "../src/lib/server/canonical-workspace-recovery-target";

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyId = require.resolve("server-only");
  require.cache[serverOnlyId] = {
    exports: {}, filename: serverOnlyId, id: serverOnlyId, loaded: true, path: serverOnlyId,
    children: [], paths: [], isPreloading: false, parent: null, require,
  } as NodeModule;

  const target = await import("../src/lib/server/canonical-workspace-recovery-target");
  const {
    CANONICAL_WORKSPACE_RECOVERY_PRODUCTION_PROJECT_REF,
    CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF,
    CanonicalWorkspaceRecoveryTargetError,
    validateCanonicalWorkspaceRecoveryTarget,
  } = target;

  const stagingUrl = `https://${CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF}.supabase.co`;
  const validInput: CanonicalWorkspaceRecoveryTargetInput = {
    requestedEnvironment: "staging",
    recoveryEnvironment: "staging",
    vercelEnvironment: "preview",
    supabaseUrl: stagingUrl,
  };

  assert.deepEqual(validateCanonicalWorkspaceRecoveryTarget(validInput), {
    projectRef: CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF,
    supabaseUrl: stagingUrl,
  });

  function expectBlocked(
    overrides: Partial<typeof validInput>,
    expectedCode: InstanceType<typeof CanonicalWorkspaceRecoveryTargetError>["code"],
  ) {
    assert.throws(
      () => validateCanonicalWorkspaceRecoveryTarget({ ...validInput, ...overrides }),
      (error: unknown) => error instanceof CanonicalWorkspaceRecoveryTargetError
        && error.code === expectedCode,
    );
  }

  expectBlocked({ requestedEnvironment: "production" }, "PRODUCTION_TARGET_BLOCKED");
  expectBlocked({ requestedEnvironment: undefined }, "PRODUCTION_TARGET_BLOCKED");
  expectBlocked({ requestedEnvironment: "preview" }, "PRODUCTION_TARGET_BLOCKED");
  expectBlocked({ recoveryEnvironment: undefined }, "PRODUCTION_TARGET_BLOCKED");
  expectBlocked({ recoveryEnvironment: "production" }, "PRODUCTION_TARGET_BLOCKED");
  expectBlocked({ vercelEnvironment: "production" }, "PRODUCTION_TARGET_BLOCKED");
  expectBlocked({
    vercelEnvironment: undefined,
    supabaseUrl: `https://${CANONICAL_WORKSPACE_RECOVERY_PRODUCTION_PROJECT_REF}.supabase.co`,
  }, "PRODUCTION_TARGET_BLOCKED");
  expectBlocked({
    vercelEnvironment: "preview",
    supabaseUrl: `https://${CANONICAL_WORKSPACE_RECOVERY_PRODUCTION_PROJECT_REF}.supabase.co`,
  }, "PRODUCTION_TARGET_BLOCKED");
  expectBlocked({
    vercelEnvironment: "development",
    supabaseUrl: `https://${CANONICAL_WORKSPACE_RECOVERY_PRODUCTION_PROJECT_REF}.supabase.co`,
  }, "PRODUCTION_TARGET_BLOCKED");
  expectBlocked({ supabaseUrl: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co" }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: `${stagingUrl}.example.com` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: `https://${CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF}.attacker.example` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: `https://prefix-${CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF}.supabase.co` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: `https://${CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF}x.supabase.co` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: `https://ｆ${CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF.slice(1)}.supabase.co` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: `https://%EF%BD%86${CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF.slice(1)}.supabase.co` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: stagingUrl.replace("https:", "http:") }, "INSECURE_TARGET_BLOCKED");
  expectBlocked({ supabaseUrl: stagingUrl.replace("https:", "ftp:") }, "INSECURE_TARGET_BLOCKED");
  expectBlocked({ supabaseUrl: stagingUrl.replace("https:", "file:") }, "INSECURE_TARGET_BLOCKED");
  expectBlocked({ supabaseUrl: "not a URL" }, "STAGING_CONFIGURATION_REQUIRED");
  expectBlocked({ supabaseUrl: "" }, "STAGING_CONFIGURATION_REQUIRED");
  expectBlocked({ supabaseUrl: `${stagingUrl}:8443` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: `${stagingUrl}/unexpected-path` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: `${stagingUrl}?target=staging` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: `${stagingUrl}#staging` }, "STAGING_TARGET_MISMATCH");
  expectBlocked({ supabaseUrl: stagingUrl.replace("https://", "https://operator:secret@") }, "STAGING_TARGET_MISMATCH");

  console.log("canonical-workspace-recovery-target.test.ts passed");
}

void run();
