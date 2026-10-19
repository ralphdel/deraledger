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
    resolveSoloPlusReviewActionScope({
      ...enabledEnv,
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: "reject",
    }),
    null,
  );

  const dedicatedStagingProductionEnv = {
    ...enabledEnv,
    DERALEDGER_DEPLOYMENT_TARGET: "staging",
    NEXT_PUBLIC_SUPABASE_URL: "https://fsjljliiyfchkwbjifzw.supabase.co",
    VERCEL_ENV: "production",
    VERCEL_PROJECT_PRODUCTION_URL: "deraledger-staging.vercel.app",
  };
  assert.deepEqual(
    resolveSoloPlusReviewActionScope(dedicatedStagingProductionEnv),
    enabledScope,
  );

  for (const missingStagingIdentity of [
    { DERALEDGER_DEPLOYMENT_TARGET: "" },
    { NEXT_PUBLIC_SUPABASE_URL: "" },
    { VERCEL_PROJECT_PRODUCTION_URL: "" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://another-project.supabase.co" },
    { VERCEL_PROJECT_PRODUCTION_URL: "another-staging.vercel.app" },
  ]) {
    assert.equal(
      resolveSoloPlusReviewActionScope({
        ...dedicatedStagingProductionEnv,
        ...missingStagingIdentity,
      }),
      null,
    );
  }

  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...dedicatedStagingProductionEnv,
      DERALEDGER_DEPLOYMENT_TARGET: "all",
    }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...dedicatedStagingProductionEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://gznwibespgkwknnvbrlv.supabase.co",
    }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...dedicatedStagingProductionEnv,
      NEXT_PUBLIC_APP_URL: "https://www.deraledger.com",
    }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...dedicatedStagingProductionEnv,
      SUPABASE_URL: "https://another-project.supabase.co",
    }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...dedicatedStagingProductionEnv,
      NEXT_PUBLIC_APP_URL: "https://another-staging.vercel.app",
    }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...enabledEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://gznwibespgkwknnvbrlv.supabase.co",
    }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({
      ...dedicatedStagingProductionEnv,
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID:
        "22222222-2222-4222-8222-222222222222,33333333-3333-4333-8333-333333333333",
    }),
    null,
  );
  for (const broadRunId of ["all", "any", "*"]) {
    assert.equal(
      resolveSoloPlusReviewActionScope({
        ...dedicatedStagingProductionEnv,
        DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: broadRunId,
      }),
      null,
    );
  }
  const rejectEnv = {
    ...dedicatedStagingProductionEnv,
    DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED: "true",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: "reject",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-reject-20261013-a1b2",
  };
  const rejectScope = resolveSoloPlusReviewActionScope(rejectEnv);
  assert.deepEqual(rejectScope, {
    caseId: "11111111-1111-4111-8111-111111111111",
    decision: "reject",
    runId: "phase2b-reject-20261013-a1b2",
  });
  assert.equal(areSoloPlusReviewActionsEnabled(rejectEnv), true);
  assert.deepEqual(resolveSoloPlusReviewActionScope({ ...rejectEnv, VERCEL_ENV: "preview" }), rejectScope);
  assert.equal(resolveSoloPlusReviewActionScope({
    ...enabledEnv,
    DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED: "true",
  }), null);
  assert.equal(resolveSoloPlusReviewActionScope({
    ...enabledEnv,
    DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED: "false",
  }), null);
  assert.equal(isSoloPlusReviewActionWithinScope(rejectScope!, {
    caseId: rejectScope!.caseId,
    decision: "reject",
  }), true);
  for (const blockedDecision of ["request_more_information", "approve", "reopen"]) {
    assert.equal(isSoloPlusReviewActionWithinScope(rejectScope!, {
      caseId: rejectScope!.caseId,
      decision: blockedDecision,
    }), false);
    assert.equal(resolveSoloPlusReviewActionScope({
      ...rejectEnv,
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: blockedDecision,
    }), null);
  }
  assert.equal(isSoloPlusReviewActionWithinScope(rejectScope!, {
    caseId: "22222222-2222-4222-8222-222222222222",
    decision: "reject",
  }), false);

  for (const wrongRejectScope of [
    { DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED: "" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED: "false" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED: "all" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: "" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID: "*" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID: "11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "all" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-rmi-20261001-002" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-reject-20261013-" },
    { DERALEDGER_DEPLOYMENT_TARGET: "" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://another-project.supabase.co" },
    { VERCEL_PROJECT_PRODUCTION_URL: "another-staging.vercel.app" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://gznwibespgkwknnvbrlv.supabase.co" },
    { NEXT_PUBLIC_APP_URL: "https://www.deraledger.com" },
    { VERCEL_ENV: "" },
  ]) {
    assert.equal(resolveSoloPlusReviewActionScope({ ...rejectEnv, ...wrongRejectScope }), null);
  }
  assert.equal(resolveSoloPlusReviewActionScope({
    ...rejectEnv,
    VERCEL_ENV: "preview",
    DERALEDGER_DEPLOYMENT_TARGET: "",
  }), null);
  assert.equal(resolveSoloPlusReviewActionScope({
    ...dedicatedStagingProductionEnv,
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-reject-20261013-a1b2",
  }), null);
  assert.equal(
    resolveSoloPlusReviewActionScope({ ...enabledEnv, VERCEL_ENV: "production" }),
    null,
  );
  assert.equal(
    resolveSoloPlusReviewActionScope({ ...enabledEnv, VERCEL_ENV: "" }),
    null,
  );

  const approveEnv = {
    ...dedicatedStagingProductionEnv,
    DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED: "true",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: "approve",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-approve-20261014-a1b2",
  };
  const approveScope = resolveSoloPlusReviewActionScope(approveEnv);
  assert.deepEqual(approveScope, {
    caseId: "11111111-1111-4111-8111-111111111111",
    decision: "approve",
    runId: "phase2b-approve-20261014-a1b2",
  });
  assert.equal(areSoloPlusReviewActionsEnabled(approveEnv), true);
  assert.deepEqual(resolveSoloPlusReviewActionScope({ ...approveEnv, VERCEL_ENV: "preview" }), approveScope);
  for (const blockedDecision of ["request_more_information", "reject", "reopen"]) {
    assert.equal(isSoloPlusReviewActionWithinScope(approveScope!, {
      caseId: approveScope!.caseId,
      decision: blockedDecision,
    }), false);
    assert.equal(resolveSoloPlusReviewActionScope({
      ...approveEnv,
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: blockedDecision,
    }), null);
  }
  assert.equal(isSoloPlusReviewActionWithinScope(approveScope!, {
    caseId: "22222222-2222-4222-8222-222222222222",
    decision: "approve",
  }), false);
  for (const wrongApproveScope of [
    { DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED: "" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED: "false" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED: "all" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED: "true" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: "" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID: "*" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID: "11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "*" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-rmi-20261001-002" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-reject-20261013-a1b2" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-approve-20261014-" },
    { DERALEDGER_DEPLOYMENT_TARGET: "" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://another-project.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://gznwibespgkwknnvbrlv.supabase.co" },
    { VERCEL_PROJECT_PRODUCTION_URL: "another-staging.vercel.app" },
    { NEXT_PUBLIC_APP_URL: "https://www.deraledger.com" },
    { VERCEL_ENV: "" },
  ]) {
    assert.equal(resolveSoloPlusReviewActionScope({ ...approveEnv, ...wrongApproveScope }), null);
  }
  assert.equal(resolveSoloPlusReviewActionScope({
    ...dedicatedStagingProductionEnv,
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: "approve",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-approve-20261014-a1b2",
  }), null);

  const reopenEnv = {
    ...dedicatedStagingProductionEnv,
    DERALEDGER_PHASE2B_SOLO_PLUS_REOPEN_ACCEPTANCE_ENABLED: "true",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: "reopen",
    DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-reject-20261013-a1b2",
  };
  const reopenScope = resolveSoloPlusReviewActionScope(reopenEnv);
  assert.deepEqual(reopenScope, {
    caseId: "11111111-1111-4111-8111-111111111111",
    decision: "reopen",
    runId: "phase2b-reject-20261013-a1b2",
  });
  assert.equal(areSoloPlusReviewActionsEnabled(reopenEnv), true);
  assert.deepEqual(resolveSoloPlusReviewActionScope({ ...reopenEnv, VERCEL_ENV: "preview" }), reopenScope);
  for (const blockedDecision of ["request_more_information", "reject", "approve"]) {
    assert.equal(isSoloPlusReviewActionWithinScope(reopenScope!, {
      caseId: reopenScope!.caseId,
      decision: blockedDecision,
    }), false);
    assert.equal(resolveSoloPlusReviewActionScope({
      ...reopenEnv,
      DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION: blockedDecision,
    }), null);
  }
  for (const wrongReopenScope of [
    { DERALEDGER_PHASE2B_SOLO_PLUS_REOPEN_ACCEPTANCE_ENABLED: "" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REOPEN_ACCEPTANCE_ENABLED: "false" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REOPEN_ACCEPTANCE_ENABLED: "all" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED: "true" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED: "true" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED: "" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID: "*" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "*" },
    { DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID: "phase2b-approve-20261019-a1b2" },
    { DERALEDGER_DEPLOYMENT_TARGET: "" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://another-project.supabase.co" },
    { VERCEL_PROJECT_PRODUCTION_URL: "another-staging.vercel.app" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://gznwibespgkwknnvbrlv.supabase.co" },
    { NEXT_PUBLIC_APP_URL: "https://www.deraledger.com" },
    { VERCEL_ENV: "" },
  ]) {
    assert.equal(resolveSoloPlusReviewActionScope({ ...reopenEnv, ...wrongReopenScope }), null);
  }

  console.log("solo-plus-review-action-release.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
