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

  const { areSoloPlusReviewActionsEnabled } = await import(
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
    true,
  );
  assert.equal(
    areSoloPlusReviewActionsEnabled({
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: " TRUE ",
      VERCEL_ENV: "production",
    }),
    false,
  );

  console.log("solo-plus-review-action-release.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
