export const SOLO_PLUS_REVIEW_REASON_MAX_LENGTH = 1_000;

export const SOLO_PLUS_REVIEWER_DECISIONS = [
  "request_more_information",
  "approve",
  "reject",
  "reopen",
] as const;

export type SoloPlusReviewerDecision =
  (typeof SOLO_PLUS_REVIEWER_DECISIONS)[number];

export const SOLO_PLUS_STAGING_ACCEPTANCE_DECISIONS = [
  "request_more_information",
  "reject",
] as const satisfies readonly SoloPlusReviewerDecision[];

export type SoloPlusStagingAcceptanceDecision =
  (typeof SOLO_PLUS_STAGING_ACCEPTANCE_DECISIONS)[number];

export const SOLO_PLUS_CANONICAL_REQUIREMENT_CODES = [
  "activity_profile",
  "bvn",
  "id_document",
  "proof_of_address",
  "selfie_liveness",
  "settlement_account",
] as const;

export const SOLO_PLUS_APPROVAL_ELIGIBLE_REQUIREMENT_STATES = [
  "passed",
  "reused",
  "waived",
] as const;
