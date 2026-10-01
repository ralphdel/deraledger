import "server-only";

import {
  SOLO_PLUS_STAGING_ACCEPTANCE_DECISIONS,
  type SoloPlusStagingAcceptanceDecision,
} from "@/lib/solo-plus/review-action-contract";

export const SOLO_PLUS_REVIEW_ACTIONS_RELEASE_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED";
export const SOLO_PLUS_REVIEW_ACTION_CASE_ID_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID";
export const SOLO_PLUS_REVIEW_ACTION_DECISION_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION";
export const SOLO_PLUS_REVIEW_ACTION_RUN_ID_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const NON_PRODUCTION_VERCEL_ENVIRONMENTS = new Set(["development", "preview"]);

type SoloPlusReviewActionEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type SoloPlusReviewActionScope = Readonly<{
  caseId: string;
  decision: SoloPlusStagingAcceptanceDecision;
  runId: string;
}>;

export function resolveSoloPlusReviewActionScope(
  env: SoloPlusReviewActionEnvironment = process.env,
): SoloPlusReviewActionScope | null {
  const vercelEnvironment = env.VERCEL_ENV?.trim().toLowerCase() ?? "";
  if (!NON_PRODUCTION_VERCEL_ENVIRONMENTS.has(vercelEnvironment)) {
    return null;
  }

  if (env[SOLO_PLUS_REVIEW_ACTIONS_RELEASE_FLAG]?.trim().toLowerCase() !== "true") {
    return null;
  }

  const caseId = env[SOLO_PLUS_REVIEW_ACTION_CASE_ID_FLAG]?.trim() ?? "";
  const decision = env[SOLO_PLUS_REVIEW_ACTION_DECISION_FLAG]?.trim().toLowerCase() ?? "";
  const runId = env[SOLO_PLUS_REVIEW_ACTION_RUN_ID_FLAG]?.trim().toLowerCase() ?? "";

  if (!UUID_PATTERN.test(caseId) || !RUN_ID_PATTERN.test(runId)) {
    return null;
  }

  if (!(SOLO_PLUS_STAGING_ACCEPTANCE_DECISIONS as readonly string[]).includes(decision)) {
    return null;
  }

  return {
    caseId: caseId.toLowerCase(),
    decision: decision as SoloPlusStagingAcceptanceDecision,
    runId,
  };
}

export function isSoloPlusReviewActionWithinScope(
  scope: Readonly<{ caseId: string; decision: string }>,
  input: Readonly<{ caseId: string; decision: string }>,
): boolean {
  return scope.caseId === input.caseId.trim().toLowerCase()
    && scope.decision === input.decision.trim().toLowerCase();
}

export function areSoloPlusReviewActionsEnabled(
  env: SoloPlusReviewActionEnvironment = process.env,
): boolean {
  return resolveSoloPlusReviewActionScope(env) !== null;
}
