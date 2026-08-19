import {
  PLAN_ALIASES,
  normalizePlanCode,
  type CanonicalPlanCode,
} from "@/lib/plans";

export type MerchantComplianceStatus =
  | "draft"
  | "lite_pending"
  | "lite_verified"
  | "enhanced_pending"
  | "enhanced_verified"
  | "business_pending"
  | "business_verified"
  | "needs_attention"
  | "restricted"
  | "rejected";

export type MerchantActivationStatus =
  | "test_mode"
  | "pre_approved"
  | "awaiting_review"
  | "approved"
  | "needs_attention"
  | "restricted"
  | "suspended";

export type MerchantRiskRating = "low" | "medium" | "high" | "restricted";
export type MerchantRestrictionState = "active" | "restricted" | "suspended";

export interface MerchantCapabilityFeatureFlags {
  storefrontEnabled?: boolean | null;
  instantSaleEnabled?: boolean | null;
  receivableSaleEnabled?: boolean | null;
  merchantConfirmationBeforeDepositEnabled?: boolean | null;
  customerRegistrationRequiredForReceivables?: boolean | null;
}

export interface MerchantSettlementReadiness {
  payoutAccountVerified?: boolean | null;
  providerMappingReady?: boolean | null;
}

export type CollectionLimitBasis =
  | "none"
  | "cumulative"
  | "monthly"
  | "approved_volume";

export interface MerchantCollectionLimitProfile {
  basis: CollectionLimitBasis;
  limitNgn: number | null;
  usedNgn: number | null;
  approved: boolean | null;
}

export interface ResolvedCollectionLimitProfile extends MerchantCollectionLimitProfile {
  remainingNgn: number | null;
}

export interface ResolveMerchantCapabilitiesInput {
  commercialPlan: string | null | undefined;
  complianceStatus?: MerchantComplianceStatus | string | null;
  activationStatus?: MerchantActivationStatus | string | null;
  riskRating?: MerchantRiskRating | string | null;
  restrictionState?: MerchantRestrictionState | string | null;
  setupMode?: boolean | null;
  liveFeaturesEnabled?: boolean | null;
  featureFlags?: MerchantCapabilityFeatureFlags | null;
  settlementReadiness?: MerchantSettlementReadiness | null;
  collectionLimit?: MerchantCollectionLimitProfile | null;
}

export type MerchantCapabilityBlockingReasonCode =
  | "unknown_plan"
  | "starter_plan"
  | "compliance_status_missing"
  | "lite_verification_required"
  | "enhanced_verification_required"
  | "business_verification_required"
  | "activation_status_missing"
  | "final_approval_required"
  | "risk_rating_missing"
  | "risk_review_required"
  | "restriction_state_missing"
  | "merchant_restricted"
  | "merchant_suspended"
  | "setup_mode_missing"
  | "setup_mode_active"
  | "live_features_state_missing"
  | "live_features_disabled"
  | "feature_flags_missing"
  | "settlement_readiness_missing"
  | "payout_account_not_verified"
  | "settlement_mapping_not_ready"
  | "collection_limit_missing"
  | "collection_limit_not_approved"
  | "collection_limit_invalid"
  | "collection_limit_reached"
  | "storefront_flag_missing"
  | "storefront_disabled"
  | "instant_sale_flag_missing"
  | "instant_sale_disabled"
  | "receivable_sale_not_in_plan"
  | "receivable_sale_flag_missing"
  | "receivable_sale_disabled"
  | "merchant_confirmation_flag_missing"
  | "merchant_confirmation_disabled"
  | "customer_registration_flag_missing"
  | "customer_registration_not_required";

export interface MerchantCapabilityBlockingReason {
  code: MerchantCapabilityBlockingReasonCode;
  message: string;
}

export interface MerchantCapabilityBlockingReasons {
  collectionInvoice: MerchantCapabilityBlockingReason[];
  checkout: MerchantCapabilityBlockingReason[];
  liveStorefront: MerchantCapabilityBlockingReason[];
  instantSale: MerchantCapabilityBlockingReason[];
  receivableSale: MerchantCapabilityBlockingReason[];
  depositBalance: MerchantCapabilityBlockingReason[];
}

export interface MerchantCapabilities {
  normalizedPlan: CanonicalPlanCode;
  isKnownPlan: boolean;
  canCreateRecordInvoice: boolean;
  canCreateCollectionInvoice: boolean;
  canUseCheckout: boolean;
  canPreviewStorefront: boolean;
  canUseLiveStorefront: boolean;
  canUseInstantSale: boolean;
  canUseReceivableSale: boolean;
  canUseDepositBalance: boolean;
  requiresVerification: boolean;
  collectionLimit: ResolvedCollectionLimitProfile | null;
  requiredBlockingReasons: MerchantCapabilityBlockingReason[];
  blockingReasons: MerchantCapabilityBlockingReasons;
}

const REQUIRED_COMPLIANCE_STATUS: Record<
  Exclude<CanonicalPlanCode, "starter">,
  MerchantComplianceStatus
> = {
  solo_lite: "lite_verified",
  solo_plus: "enhanced_verified",
  business: "business_verified",
};

function reason(
  code: MerchantCapabilityBlockingReasonCode,
  message: string,
): MerchantCapabilityBlockingReason {
  return { code, message };
}

function uniqueReasons(
  reasons: MerchantCapabilityBlockingReason[],
): MerchantCapabilityBlockingReason[] {
  const seen = new Set<MerchantCapabilityBlockingReasonCode>();
  return reasons.filter((item) => {
    if (seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  });
}

function isFiniteNonNegative(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function resolveLimitProfile(
  profile: MerchantCollectionLimitProfile | null | undefined,
): ResolvedCollectionLimitProfile | null {
  if (!profile) return null;

  const remainingNgn =
    isFiniteNonNegative(profile.limitNgn) && isFiniteNonNegative(profile.usedNgn)
      ? Math.max(0, profile.limitNgn - profile.usedNgn)
      : null;

  return { ...profile, remainingNgn };
}

function getComplianceReason(
  plan: Exclude<CanonicalPlanCode, "starter">,
): MerchantCapabilityBlockingReason {
  if (plan === "solo_lite") {
    return reason(
      "lite_verification_required",
      "Solo Lite requires completed Lite verification before live collection.",
    );
  }
  if (plan === "solo_plus") {
    return reason(
      "enhanced_verification_required",
      "Solo Plus requires Enhanced verification before live or receivable collection.",
    );
  }
  return reason(
    "business_verification_required",
    "Business requires completed KYB verification before live collection.",
  );
}

function resolveBaseLiveReasons(
  input: ResolveMerchantCapabilitiesInput,
  plan: CanonicalPlanCode,
  isKnownPlan: boolean,
): MerchantCapabilityBlockingReason[] {
  const reasons: MerchantCapabilityBlockingReason[] = [];

  if (!isKnownPlan) {
    reasons.push(reason("unknown_plan", "The commercial plan could not be recognized."));
  }

  if (plan === "starter") {
    reasons.push(
      reason("starter_plan", "Starter supports offline Record Invoices only."),
    );
    return reasons;
  }

  if (!input.complianceStatus) {
    reasons.push(
      reason("compliance_status_missing", "Compliance status is required for live access."),
    );
  } else if (input.complianceStatus !== REQUIRED_COMPLIANCE_STATUS[plan]) {
    reasons.push(getComplianceReason(plan));
  }

  if (!input.activationStatus) {
    reasons.push(
      reason("activation_status_missing", "Activation status is required for live access."),
    );
  } else if (input.activationStatus !== "approved") {
    reasons.push(
      reason("final_approval_required", "Final compliance approval is required for live access."),
    );
  }

  if (!input.riskRating) {
    reasons.push(reason("risk_rating_missing", "Risk rating is required for live access."));
  } else if (input.riskRating !== "low" && input.riskRating !== "medium") {
    reasons.push(
      reason("risk_review_required", "The merchant risk state requires review before live access."),
    );
  }

  if (!input.restrictionState) {
    reasons.push(
      reason("restriction_state_missing", "Restriction state is required for live access."),
    );
  } else if (input.restrictionState === "suspended") {
    reasons.push(reason("merchant_suspended", "The merchant is suspended from live access."));
  } else if (input.restrictionState !== "active") {
    reasons.push(reason("merchant_restricted", "The merchant is restricted from live access."));
  }

  if (input.setupMode === undefined || input.setupMode === null) {
    reasons.push(reason("setup_mode_missing", "Setup-mode state is required for live access."));
  } else if (input.setupMode) {
    reasons.push(reason("setup_mode_active", "Setup must be completed before live access."));
  }

  if (input.liveFeaturesEnabled === undefined || input.liveFeaturesEnabled === null) {
    reasons.push(
      reason("live_features_state_missing", "Live-feature state is required for live access."),
    );
  } else if (!input.liveFeaturesEnabled) {
    reasons.push(
      reason("live_features_disabled", "Live features have not been enabled for this merchant."),
    );
  }

  if (!input.featureFlags) {
    reasons.push(
      reason("feature_flags_missing", "Feature-flag state is required for live access."),
    );
  }

  if (!input.settlementReadiness) {
    reasons.push(
      reason(
        "settlement_readiness_missing",
        "Verified payout and settlement readiness are required for live access.",
      ),
    );
  } else {
    if (input.settlementReadiness.payoutAccountVerified !== true) {
      reasons.push(
        reason(
          "payout_account_not_verified",
          "A verified payout account is required for live access.",
        ),
      );
    }
    if (input.settlementReadiness.providerMappingReady !== true) {
      reasons.push(
        reason(
          "settlement_mapping_not_ready",
          "A verified provider settlement mapping is required for live access.",
        ),
      );
    }
  }

  if (!input.collectionLimit) {
    reasons.push(
      reason("collection_limit_missing", "An approved collection limit is required for live access."),
    );
  } else if (input.collectionLimit.approved !== true) {
    reasons.push(
      reason(
        "collection_limit_not_approved",
        "The merchant collection limit has not been approved.",
      ),
    );
  } else if (
    input.collectionLimit.basis === "none" ||
    !isFiniteNonNegative(input.collectionLimit.limitNgn) ||
    input.collectionLimit.limitNgn <= 0 ||
    !isFiniteNonNegative(input.collectionLimit.usedNgn)
  ) {
    reasons.push(
      reason("collection_limit_invalid", "The approved collection limit is invalid."),
    );
  } else if (input.collectionLimit.usedNgn >= input.collectionLimit.limitNgn) {
    reasons.push(reason("collection_limit_reached", "The approved collection limit has been reached."));
  }

  return uniqueReasons(reasons);
}

function resolveBooleanFlagReason(
  value: boolean | null | undefined,
  missingCode: MerchantCapabilityBlockingReasonCode,
  disabledCode: MerchantCapabilityBlockingReasonCode,
  missingMessage: string,
  disabledMessage: string,
): MerchantCapabilityBlockingReason[] {
  if (value === undefined || value === null) {
    return [reason(missingCode, missingMessage)];
  }
  return value ? [] : [reason(disabledCode, disabledMessage)];
}

export function resolveMerchantCapabilities(
  input: ResolveMerchantCapabilitiesInput,
): MerchantCapabilities {
  const rawPlan = String(input.commercialPlan ?? "").trim().toLowerCase();
  const isKnownPlan = Object.prototype.hasOwnProperty.call(PLAN_ALIASES, rawPlan);
  const normalizedPlan = normalizePlanCode(input.commercialPlan);
  const collectionLimit = resolveLimitProfile(input.collectionLimit);
  const baseLiveReasons = resolveBaseLiveReasons(input, normalizedPlan, isKnownPlan);

  const storefrontReasons = uniqueReasons([
    ...baseLiveReasons,
    ...resolveBooleanFlagReason(
      input.featureFlags?.storefrontEnabled,
      "storefront_flag_missing",
      "storefront_disabled",
      "The storefront feature flag is missing.",
      "The storefront feature is disabled.",
    ),
  ]);

  const instantSaleReasons = uniqueReasons([
    ...storefrontReasons,
    ...resolveBooleanFlagReason(
      input.featureFlags?.instantSaleEnabled,
      "instant_sale_flag_missing",
      "instant_sale_disabled",
      "The Instant Sale feature flag is missing.",
      "Instant Sale is disabled.",
    ),
  ]);

  const planAllowsReceivables = normalizedPlan === "solo_plus" || normalizedPlan === "business";
  const receivableSaleReasons = uniqueReasons([
    ...storefrontReasons,
    ...(planAllowsReceivables
      ? []
      : [
          reason(
            "receivable_sale_not_in_plan",
            "Receivable Sale and Deposit & Balance are not available on this plan.",
          ),
        ]),
    ...resolveBooleanFlagReason(
      input.featureFlags?.receivableSaleEnabled,
      "receivable_sale_flag_missing",
      "receivable_sale_disabled",
      "The Receivable Sale feature flag is missing.",
      "Receivable Sale is disabled.",
    ),
    ...resolveBooleanFlagReason(
      input.featureFlags?.merchantConfirmationBeforeDepositEnabled,
      "merchant_confirmation_flag_missing",
      "merchant_confirmation_disabled",
      "The merchant-confirmation feature flag is missing.",
      "Merchant confirmation before deposit is disabled.",
    ),
    ...resolveBooleanFlagReason(
      input.featureFlags?.customerRegistrationRequiredForReceivables,
      "customer_registration_flag_missing",
      "customer_registration_not_required",
      "The receivable customer-registration feature flag is missing.",
      "Registered-customer enforcement for receivables is disabled.",
    ),
  ]);

  const blockingReasons: MerchantCapabilityBlockingReasons = {
    collectionInvoice: baseLiveReasons,
    checkout: baseLiveReasons,
    liveStorefront: storefrontReasons,
    instantSale: instantSaleReasons,
    receivableSale: receivableSaleReasons,
    depositBalance: receivableSaleReasons,
  };

  const requiredBlockingReasons = uniqueReasons([
    ...baseLiveReasons,
    ...storefrontReasons,
    ...instantSaleReasons,
    ...receivableSaleReasons,
  ]);
  const complianceApproved =
    normalizedPlan !== "starter" &&
    input.complianceStatus === REQUIRED_COMPLIANCE_STATUS[normalizedPlan];
  const requiresVerification =
    normalizedPlan !== "starter" &&
    (!complianceApproved ||
      input.activationStatus !== "approved" ||
      input.settlementReadiness?.payoutAccountVerified !== true);

  return {
    normalizedPlan,
    isKnownPlan,
    // Record Invoice is offline bookkeeping. It deliberately does not inherit
    // live checkout, settlement, compliance, or storefront activation gates.
    canCreateRecordInvoice: true,
    canCreateCollectionInvoice: baseLiveReasons.length === 0,
    canUseCheckout: baseLiveReasons.length === 0,
    canPreviewStorefront: isKnownPlan && input.restrictionState === "active",
    canUseLiveStorefront: storefrontReasons.length === 0,
    canUseInstantSale: instantSaleReasons.length === 0,
    canUseReceivableSale: receivableSaleReasons.length === 0,
    canUseDepositBalance: receivableSaleReasons.length === 0,
    requiresVerification,
    collectionLimit,
    requiredBlockingReasons,
    blockingReasons,
  };
}
