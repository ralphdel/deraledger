import {
  PLAN_ALIASES,
  normalizePlanCode,
  type CanonicalPlanCode,
} from "@/lib/plans";
import type {
  CollectionLimitBasis,
  MerchantActivationStatus,
  MerchantCapabilityFeatureFlags,
  MerchantCollectionLimitProfile,
  MerchantComplianceStatus,
  MerchantRestrictionState,
  MerchantRiskRating,
  MerchantSettlementReadiness,
  ResolveMerchantCapabilitiesInput,
} from "./merchant-capabilities";

/**
 * A server-side loader must populate this from an already-authorized merchant
 * and workspace context. This module deliberately performs no Auth, Supabase,
 * provider, or feature-flag query.
 */
export interface TrustedRuntimeCapabilitySource {
  merchantId?: string | null;
  workspaceId?: string | null;
  commercialPlan?: string | null;
  subscriptionStatus?: string | null;
  paymentEntitlementState?: string | null;
  setupMode?: boolean | null;
  liveFeaturesEnabled?: boolean | null;
  complianceStatus?: MerchantComplianceStatus | string | null;
  activationStatus?: MerchantActivationStatus | string | null;
  riskRating?: MerchantRiskRating | string | null;
  restrictionState?: MerchantRestrictionState | string | null;
  approvedMonthlyVolumeNgn?: number | null;
  cumulativeCollectionCapNgn?: number | null;
  cumulativeCollectionUsedNgn?: number | null;
  hiddenDailyVelocityLimitNgn?: number | null;
  singleTransactionLimitNgn?: number | null;
  collectionLimit?: MerchantCollectionLimitProfile | null;
  featureFlags?: MerchantCapabilityFeatureFlags | null;
  settlementReadiness?: MerchantSettlementReadiness | null;
  soloPlusEnhancedVerificationStatus?: string | null;
  businessKybVerificationStatus?: string | null;
}

export interface RuntimeCollectionLimitContext {
  approvedMonthlyVolumeNgn: number | null;
  cumulativeCollectionCapNgn: number | null;
  cumulativeCollectionUsedNgn: number | null;
  hiddenDailyVelocityLimitNgn: number | null;
  singleTransactionLimitNgn: number | null;
  /**
   * The explicitly selected, approved profile consumed by the current resolver.
   * It is never inferred from commercial plan, payment, or any raw limit field.
   */
  collectionLimit: MerchantCollectionLimitProfile | null;
}

export interface TrustedRuntimeCapabilityContext {
  merchantId: string | null;
  workspaceId: string | null;
  hasTrustedMerchantWorkspace: boolean;
  rawCommercialPlan: string | null;
  commercialPlan: CanonicalPlanCode;
  isKnownCommercialPlan: boolean;
  subscriptionStatus: string | null;
  paymentEntitlementState: string | null;
  setupMode: boolean | null;
  liveFeaturesEnabled: boolean | null;
  complianceStatus: MerchantComplianceStatus | string | null;
  activationStatus: MerchantActivationStatus | string | null;
  riskRating: MerchantRiskRating | string | null;
  restrictionState: MerchantRestrictionState | string | null;
  limits: RuntimeCollectionLimitContext;
  featureFlags: MerchantCapabilityFeatureFlags | null;
  settlementReadiness: MerchantSettlementReadiness | null;
  soloPlusEnhancedVerificationStatus: string | null;
  businessKybVerificationStatus: string | null;
}

const LIMIT_BASES = new Set<CollectionLimitBasis>([
  "none",
  "cumulative",
  "monthly",
  "approved_volume",
]);

function nullableText(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || null;
}

function nullableIdentifier(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function nullableBoolean(value: boolean | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nullableNonNegativeNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizeFeatureFlags(
  flags: MerchantCapabilityFeatureFlags | null | undefined,
): MerchantCapabilityFeatureFlags | null {
  if (!flags) return null;
  return {
    storefrontEnabled: nullableBoolean(flags.storefrontEnabled),
    instantSaleEnabled: nullableBoolean(flags.instantSaleEnabled),
    receivableSaleEnabled: nullableBoolean(flags.receivableSaleEnabled),
    merchantConfirmationBeforeDepositEnabled: nullableBoolean(
      flags.merchantConfirmationBeforeDepositEnabled,
    ),
    customerRegistrationRequiredForReceivables: nullableBoolean(
      flags.customerRegistrationRequiredForReceivables,
    ),
  };
}

function normalizeSettlementReadiness(
  readiness: MerchantSettlementReadiness | null | undefined,
): MerchantSettlementReadiness | null {
  if (!readiness) return null;
  return {
    payoutAccountVerified: nullableBoolean(readiness.payoutAccountVerified),
    providerMappingReady: nullableBoolean(readiness.providerMappingReady),
  };
}

function normalizeCollectionLimit(
  profile: MerchantCollectionLimitProfile | null | undefined,
): MerchantCollectionLimitProfile | null {
  if (!profile || !LIMIT_BASES.has(profile.basis)) return null;
  return {
    basis: profile.basis,
    limitNgn: nullableNonNegativeNumber(profile.limitNgn),
    usedNgn: nullableNonNegativeNumber(profile.usedNgn),
    approved: nullableBoolean(profile.approved),
  };
}

/**
 * Normalizes trusted loader output without deriving approval from a plan,
 * subscription payment, legacy verification field, or sandbox identity.
 */
export function buildTrustedRuntimeCapabilityContext(
  source: TrustedRuntimeCapabilitySource,
): TrustedRuntimeCapabilityContext {
  const rawCommercialPlan = nullableText(source.commercialPlan);
  const isKnownCommercialPlan = Boolean(
    rawCommercialPlan && Object.prototype.hasOwnProperty.call(PLAN_ALIASES, rawCommercialPlan),
  );
  const merchantId = nullableIdentifier(source.merchantId);
  const workspaceId = nullableIdentifier(source.workspaceId);

  return {
    merchantId,
    workspaceId,
    hasTrustedMerchantWorkspace: merchantId !== null && workspaceId !== null,
    rawCommercialPlan,
    commercialPlan: normalizePlanCode(rawCommercialPlan),
    isKnownCommercialPlan,
    subscriptionStatus: nullableText(source.subscriptionStatus),
    paymentEntitlementState: nullableText(source.paymentEntitlementState),
    setupMode: nullableBoolean(source.setupMode),
    liveFeaturesEnabled: nullableBoolean(source.liveFeaturesEnabled),
    complianceStatus: nullableText(source.complianceStatus),
    activationStatus: nullableText(source.activationStatus),
    riskRating: nullableText(source.riskRating),
    restrictionState: nullableText(source.restrictionState),
    limits: {
      approvedMonthlyVolumeNgn: nullableNonNegativeNumber(source.approvedMonthlyVolumeNgn),
      cumulativeCollectionCapNgn: nullableNonNegativeNumber(source.cumulativeCollectionCapNgn),
      cumulativeCollectionUsedNgn: nullableNonNegativeNumber(source.cumulativeCollectionUsedNgn),
      hiddenDailyVelocityLimitNgn: nullableNonNegativeNumber(source.hiddenDailyVelocityLimitNgn),
      singleTransactionLimitNgn: nullableNonNegativeNumber(source.singleTransactionLimitNgn),
      collectionLimit: normalizeCollectionLimit(source.collectionLimit),
    },
    featureFlags: normalizeFeatureFlags(source.featureFlags),
    settlementReadiness: normalizeSettlementReadiness(source.settlementReadiness),
    soloPlusEnhancedVerificationStatus: nullableText(
      source.soloPlusEnhancedVerificationStatus,
    ),
    businessKybVerificationStatus: nullableText(source.businessKybVerificationStatus),
  };
}

/**
 * Converts this context to the current pure resolver input. Missing trusted
 * merchant/workspace identity deliberately produces an unknown plan input so
 * later live capability integration fails closed. Record Invoice remains an
 * independent offline/RBAC decision outside this conversion.
 */
export function toResolveMerchantCapabilitiesInput(
  context: TrustedRuntimeCapabilityContext,
): ResolveMerchantCapabilitiesInput {
  return {
    commercialPlan: context.hasTrustedMerchantWorkspace
      ? (context.isKnownCommercialPlan ? context.commercialPlan : context.rawCommercialPlan)
      : null,
    complianceStatus: context.complianceStatus,
    activationStatus: context.activationStatus,
    riskRating: context.riskRating,
    restrictionState: context.restrictionState,
    setupMode: context.setupMode,
    liveFeaturesEnabled: context.liveFeaturesEnabled,
    featureFlags: context.featureFlags,
    settlementReadiness: context.settlementReadiness,
    collectionLimit: context.limits.collectionLimit,
  };
}
