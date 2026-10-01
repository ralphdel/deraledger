import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";

async function run() {
  const require = createRequire(import.meta.url);
  const serverOnlyShimPath = require.resolve("server-only");
  const serverOnlyShimModule = new Module(serverOnlyShimPath);
  serverOnlyShimModule.filename = serverOnlyShimPath;
  serverOnlyShimModule.loaded = true;
  serverOnlyShimModule.exports = {};
  require.cache[serverOnlyShimPath] = serverOnlyShimModule as never;

  const {
    areSoloPlusReviewActionsEnabled,
    isSoloPlusReviewActionWithinScope,
    resolveSoloPlusReviewActionScope,
  } = await import(
    new URL("../src/lib/server/solo-plus-review-action-release.ts", import.meta.url).href
  );

  assert.equal(areSoloPlusReviewActionsEnabled({}), false);
  assert.equal(
    areSoloPlusReviewActionsEnabled({
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: "",
      VERCEL_ENV: "preview",
    }),
    false,
  );
  assert.equal(
    areSoloPlusReviewActionsEnabled({
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: "false",
      VERCEL_ENV: "preview",
    }),
    false,
  );
  assert.equal(
    areSoloPlusReviewActionsEnabled({
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: "true",
      VERCEL_ENV: "preview",
    }),
    false,
  );
  assert.equal(
    areSoloPlusReviewActionsEnabled({
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: " TRUE ",
      VERCEL_ENV: "production",
    }),
    false,
  );

  const enabledEnv = {
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: "true",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID:
      "11111111-1111-4111-8111-111111111111",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION:
      "request_more_information",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID:
      "phase2b-action-fixture-20260930",
    VERCEL_ENV: "preview",
  };
  const enabledScope = resolveSoloPlusReviewActionScope(enabledEnv);
  assert.deepEqual(enabledScope, {
    caseId: "11111111-1111-4111-8111-111111111111",
    decision: "request_more_information",
    runId: "phase2b-action-fixture-20260930",
  });
  assert.equal(areSoloPlusReviewActionsEnabled(enabledEnv), true);
  assert.equal(
    isSoloPlusReviewActionWithinScope(enabledScope!, {
      caseId: "11111111-1111-4111-8111-111111111111",
      decision: "request_more_information",
    }),
    true,
  );
  assert.equal(
    isSoloPlusReviewActionWithinScope(enabledScope!, {
      caseId: "22222222-2222-4222-8222-222222222222",
      decision: "request_more_information",
    }),
    false,
  );
  assert.equal(
    isSoloPlusReviewActionWithinScope(enabledScope!, {
      caseId: "11111111-1111-4111-8111-111111111111",
      decision: "reject",
    }),
    false,
  );

  for (const missingName of [
    "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID",
    "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION",
    "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID",
  ] as const) {
    assert.equal(
      resolveSoloPlusReviewActionScope({ ...enabledEnv, [missingName]: "" }),
      null,
    );
  }

  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...enabledEnv,
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID: "not-a-uuid",
    }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...enabledEnv,
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: "approve",
    }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...enabledEnv,
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: "reopen",
    }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({ ...enabledEnv, VERCEL_ENV: "production" }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({ ...enabledEnv, VERCEL_ENV: "" }),
    null,
  );

  console.log("solo-plus-review-action-release.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
