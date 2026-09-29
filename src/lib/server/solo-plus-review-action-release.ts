import "server-only";

export const SOLO_PLUS_REVIEW_ACTIONS_RELEASE_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED";

type SoloPlusReviewActionEnvironment = Readonly<
  Record<string, string | undefined>
>;

export function areSoloPlusReviewActionsEnabled(
  env: SoloPlusReviewActionEnvironment = process.env,
): boolean {
  if (env.VERCEL_ENV?.trim().toLowerCase() === "production") {
    return false;
  }

  return env[SOLO_PLUS_REVIEW_ACTIONS_RELEASE_FLAG]?.trim().toLowerCase() === "true";
}
