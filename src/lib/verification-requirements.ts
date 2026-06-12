export type VerificationRequirementKey =
  | "basic_profile"
  | "no_payment_collection"
  | "bvn"
  | "selfie_liveness"
  | "valid_id_document"
  | "proof_of_address"
  | "additional_manual_review"
  | "business_registration_check"
  | "owner_or_director_kyc"
  | "director_or_representative_flow"
  | "director_kyc"
  | "business_document"
  | "business_documents"
  | "utility_bill"
  | "settlement_account"
  | "admin_review"
  | "lower_collection_limit"
  | "higher_collection_limit";

export type VerificationStepStatus =
  | "not_started"
  | "pending"
  | "verified"
  | "manual_review"
  | "rejected"
  | "locked";

export type VerificationStepRecord = {
  admin_reset_status?: "not_requested" | "requested" | "approved" | "completed" | string | null;
  plan_tier?: string | null;
  provider?: string | null;
  provider_reference?: string | null;
  rejection_reason?: string | null;
  requirement_key?: VerificationRequirementKey | string | null;
  reviewed_at?: string | null;
  status?: VerificationStepStatus | string | null;
  submitted_at?: string | null;
  verified_at?: string | null;
};

export type VerificationStepState = Partial<
  Record<VerificationRequirementKey, VerificationStepRecord>
>;

export type RequirementAwareMerchant = {
  subscription_plan?: string | null;
  merchant_tier?: string | null;
  verification_status?: string | null;
  bvn_status?: string | null;
  selfie_status?: string | null;
  cac_status?: string | null;
  cac_document_url?: string | null;
  utility_status?: string | null;
  utility_document_url?: string | null;
  business_affiliation_status?: string | null;
  live_features_enabled?: boolean | null;
  setup_mode?: boolean | null;
  settlement_account_number?: string | null;
  settlement_bank_name?: string | null;
  settlement_account_name?: string | null;
  verification_step_state?: VerificationStepState | null;
};

export const PLAN_REQUIREMENTS: Record<string, VerificationRequirementKey[]> = {
  starter: ["basic_profile", "no_payment_collection"],
  individual_tier_1: [
    "basic_profile",
    "bvn",
    "selfie_liveness",
    "settlement_account",
    "lower_collection_limit",
    "admin_review",
  ],
  individual_tier_2: [
    "basic_profile",
    "bvn",
    "selfie_liveness",
    "valid_id_document",
    "proof_of_address",
    "additional_manual_review",
    "settlement_account",
    "higher_collection_limit",
    "admin_review",
  ],
  business: [
    "basic_profile",
    "business_registration_check",
    "owner_or_director_kyc",
    "business_document",
    "utility_bill",
    "settlement_account",
    "admin_review",
    "higher_collection_limit",
  ],
  corporate: [
    "basic_profile",
    "business_registration_check",
    "director_or_representative_flow",
    "owner_or_director_kyc",
    "director_kyc",
    "business_documents",
    "utility_bill",
    "settlement_account",
    "admin_review",
    "higher_collection_limit",
  ],
};

const PLAN_ALIASES: Record<string, string> = {
  starter: "starter",
  individual: "individual_tier_1",
  business: "business",
  corporate: "corporate",
};

export function normalizePlanTier(planTier: string | null | undefined) {
  const normalized = String(planTier || "").trim().toLowerCase();
  return PLAN_ALIASES[normalized] || normalized || "starter";
}

export function getVerificationRequirements(planTier: string | null | undefined) {
  const normalized = normalizePlanTier(planTier);
  return PLAN_REQUIREMENTS[normalized] || PLAN_REQUIREMENTS.starter;
}

export function hasVerificationRequirement(
  planTier: string | null | undefined,
  requirement: VerificationRequirementKey,
) {
  return getVerificationRequirements(planTier).includes(requirement);
}

export function getCollectionLimitLabel(planTier: string | null | undefined) {
  const requirements = getVerificationRequirements(planTier);
  if (requirements.includes("no_payment_collection")) return "Payment collection not available";
  if (requirements.includes("higher_collection_limit")) return "Higher collection limit";
  if (requirements.includes("lower_collection_limit")) return "Lower collection limit";
  return "Plan-defined collection limit";
}

export function getStoredRequirementStep(
  merchant: RequirementAwareMerchant,
  requirement: VerificationRequirementKey,
) {
  return merchant.verification_step_state?.[requirement] || null;
}

function completionFromStatus(
  status: string | null | undefined,
): "complete" | "pending" | "rejected" | "locked" {
  if (!status || status === "not_started" || status === "unverified") return "pending";
  if (
    status === "verified" ||
    status === "active" ||
    status === "strong_match" ||
    status === "director_approved"
  ) {
    return "complete";
  }
  if (status === "rejected" || status === "requires_reupload") return "rejected";
  if (status === "locked") return "locked";
  return "pending";
}

export function getRequirementCompletion(
  merchant: RequirementAwareMerchant,
  requirement: VerificationRequirementKey,
): "complete" | "pending" | "rejected" | "locked" {
  const storedStep = getStoredRequirementStep(merchant, requirement);
  if (storedStep?.status) {
    return completionFromStatus(storedStep.status);
  }

  switch (requirement) {
    case "basic_profile":
      return "complete";
    case "no_payment_collection":
      return "locked";
    case "bvn":
      return completionFromStatus(merchant.bvn_status);
    case "selfie_liveness":
      return completionFromStatus(merchant.selfie_status);
    case "business_registration_check":
      return completionFromStatus(merchant.cac_status);
    case "business_document":
    case "business_documents":
      return storedStep?.status
        ? completionFromStatus(storedStep.status)
        : merchant.cac_document_url
          ? "pending"
          : "pending";
    case "utility_bill":
    case "proof_of_address":
      return storedStep?.status
        ? completionFromStatus(storedStep.status)
        : merchant.utility_document_url
          ? completionFromStatus(merchant.utility_status)
          : "pending";
    case "owner_or_director_kyc":
      return merchant.bvn_status === "verified" && merchant.selfie_status === "verified"
        ? "complete"
        : "pending";
    case "director_or_representative_flow":
    case "director_kyc":
      return completionFromStatus(merchant.business_affiliation_status);
    case "settlement_account":
      return merchant.settlement_account_number &&
        merchant.settlement_bank_name &&
        merchant.settlement_account_name
        ? "complete"
        : "pending";
    case "additional_manual_review":
    case "admin_review":
      return completionFromStatus(merchant.verification_status);
    case "valid_id_document":
      return completionFromStatus(storedStep?.status);
    case "lower_collection_limit":
    case "higher_collection_limit":
      return "complete";
    default:
      return "pending";
  }
}

export function getIncompleteRequirements(merchant: RequirementAwareMerchant) {
  const planTier = merchant.subscription_plan || merchant.merchant_tier;
  return getVerificationRequirements(planTier).filter((requirement) => {
    if (requirement === "lower_collection_limit" || requirement === "higher_collection_limit") {
      return false;
    }
    const completion = getRequirementCompletion(merchant, requirement);
    return completion !== "complete";
  });
}
