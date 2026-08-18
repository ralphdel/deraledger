/**
 * DeraLedger — Centralized Access Control Service
 *
 * Single source of truth for all plan-gated feature checks.
 * All server actions and UI components MUST call these functions.
 * Never duplicate plan logic elsewhere.
 */

import type { Merchant } from "@/lib/types";
import { getLiveFeatureLockReasons, isLiveFeatureEnabled, isSuperadminSandboxMerchant } from "@/lib/services/onboarding-flow.service";
import { getPlanDisplayName, normalizeCapabilityPlanCode } from "@/lib/plans";

// ── Plan limits (mirrors platform_settings in DB) ─────────────────────────────
export const PLAN_LIMITS = {
  starter: {
    invoiceLimit: 10,          // Lifetime record invoice cap
    teamLimit: 2,              // Owner only + 1 predefined role = 2 seats total
    activeCollectionLimit: 0,  // No collection invoices
    monthlyCollectionNgn: 0,
    canCollect: false,
    canCustomRoles: false,
    canRemoveWatermark: false,
    canAccessApi: false,
    canAccessCrypto: false,
  },
  individual: {
    invoiceLimit: Infinity,
    teamLimit: 4,              // Owner + up to 3 predefined role members
    activeCollectionLimit: 20,
    monthlyCollectionNgn: 5_000_000,
    canCollect: true,          // Requires verified KYC
    canCustomRoles: false,
    canRemoveWatermark: false,
    canAccessApi: false,
    canAccessCrypto: false,
  },
  solo_plus: {
    invoiceLimit: Infinity,
    teamLimit: 4,
    activeCollectionLimit: 20,
    monthlyCollectionNgn: 5_000_000,
    canCollect: true,
    canCustomRoles: false,
    canRemoveWatermark: false,
    canAccessApi: false,
    canAccessCrypto: false,
  },
  corporate: {
    invoiceLimit: Infinity,
    teamLimit: Infinity,
    activeCollectionLimit: Infinity,
    monthlyCollectionNgn: Infinity,
    canCollect: true,
    canCustomRoles: true,
    canRemoveWatermark: true,
    canAccessApi: true,
    canAccessCrypto: true,
  },
} as const;

type PlanKey = keyof typeof PLAN_LIMITS;

function getPlan(merchant: Pick<Merchant, "subscription_plan" | "merchant_tier">): PlanKey {
  const raw = merchant.subscription_plan || merchant.merchant_tier || "starter";
  if (raw === "solo_plus") return "solo_plus";
  const capabilityPlan = normalizeCapabilityPlanCode(raw);
  if (capabilityPlan === "individual" || capabilityPlan === "corporate") return capabilityPlan;
  return "starter";
}

// ── Access check result ────────────────────────────────────────────────────────
export interface AccessResult {
  allowed: boolean;
  reason?: string;
  upgradeRequired?: "individual" | "corporate";
}

type InvoiceCreationMerchant = Pick<Merchant,
  "subscription_plan" | "merchant_tier" | "verification_status" | "bvn_status" | "cac_status" | "live_features_enabled" | "setup_mode"
> & Pick<Partial<Merchant>,
  "selfie_status" | "utility_status" | "business_affiliation_status" | "email" | "is_super_admin"
>;

export type InvoiceCreationAccessResult =
  | {
      allowed: true;
      invoiceType: "record" | "collection";
      shouldSyncMerchantSetup: boolean;
    }
  | {
      allowed: false;
      reason: string;
      upgradeRequired?: "individual" | "corporate";
    };

function liveCollectionEnabled(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier" | "verification_status" | "bvn_status" | "cac_status" | "live_features_enabled" | "setup_mode"> & Pick<Partial<Merchant>, "selfie_status" | "utility_status" | "business_affiliation_status" | "email" | "is_super_admin">
): boolean {
  return isLiveFeatureEnabled(merchant);
}

// ── Gate: Create any invoice ──────────────────────────────────────────────────
/**
 * Check if merchant can create a new invoice (any type).
 * For Starter: counts ALL invoices ever created (including archived/deleted soft-counts).
 */
export function canCreateInvoice(
  merchant: (Pick<Merchant, "subscription_plan" | "merchant_tier"> & Pick<Partial<Merchant>, "email" | "is_super_admin">) | null | undefined,
  currentLifetimeInvoiceCount: number
): AccessResult {
  if (!merchant) {
    return { allowed: false, reason: "Workspace could not be resolved. Please refresh and try again." };
  }
  if (isSuperadminSandboxMerchant(merchant)) return { allowed: true };
  const plan = getPlan(merchant);
  const limits = PLAN_LIMITS[plan];

  if (limits.invoiceLimit !== Infinity && currentLifetimeInvoiceCount >= limits.invoiceLimit) {
    return {
      allowed: false,
      reason: `Starter plan limit reached: You have used ${currentLifetimeInvoiceCount} of ${limits.invoiceLimit} lifetime invoices. Upgrade to continue.`,
      upgradeRequired: "individual",
    };
  }
  return { allowed: true };
}

// ── Gate: Create collection invoice ──────────────────────────────────────────
export function canCreateCollectionInvoice(
  merchant: (Pick<Merchant, "subscription_plan" | "merchant_tier" | "verification_status" | "bvn_status" | "cac_status" | "live_features_enabled" | "setup_mode"> & Pick<Partial<Merchant>, "selfie_status" | "utility_status" | "business_affiliation_status" | "email" | "is_super_admin">) | null | undefined
): AccessResult {
  if (!merchant) {
    return { allowed: false, reason: "Workspace could not be resolved. Please refresh and try again." };
  }
  if (isSuperadminSandboxMerchant(merchant)) return { allowed: true };
  const plan = getPlan(merchant);
  const limits = PLAN_LIMITS[plan];

  if (!limits.canCollect) {
    return {
      allowed: false,
      reason: `Collection invoices are not available on the ${getPlanDisplayName("starter")} plan. Upgrade to ${getPlanDisplayName("individual")} or ${getPlanDisplayName("corporate")}.`,
      upgradeRequired: "individual",
    };
  }

  if (!liveCollectionEnabled(merchant)) {
    const reasons = getLiveFeatureLockReasons(merchant);
    return {
      allowed: false,
      reason: reasons.length > 0
        ? `Live payment collection is locked. Remaining requirement: ${reasons.join(", ")}.`
        : "Live payment collection is disabled until verification is completed. You can continue setting up your workspace.",
    };
  }

  return { allowed: true };
}

/**
 * Keeps invoice creation on the record-invoice path until a collection invoice
 * explicitly passes its existing plan and live-feature gates.
 */
export function getInvoiceCreationAccess(
  merchant: InvoiceCreationMerchant | null | undefined,
  requestedInvoiceType: "record" | "collection",
  currentLifetimeInvoiceCount: number,
): InvoiceCreationAccessResult {
  const createCheck = canCreateInvoice(merchant, currentLifetimeInvoiceCount);
  if (!createCheck.allowed) {
    return {
      allowed: false,
      reason: createCheck.reason || "Invoice creation is unavailable for this workspace.",
      ...(createCheck.upgradeRequired ? { upgradeRequired: createCheck.upgradeRequired } : {}),
    };
  }

  if (!merchant) {
    return { allowed: false, reason: "Workspace could not be resolved. Please refresh and try again." };
  }

  if (requestedInvoiceType === "collection") {
    const collectionCheck = canCreateCollectionInvoice(merchant);
    if (!collectionCheck.allowed) {
      return {
        allowed: false,
        reason: collectionCheck.reason || "Collection invoices are unavailable for this workspace.",
        ...(collectionCheck.upgradeRequired ? { upgradeRequired: collectionCheck.upgradeRequired } : {}),
      };
    }
  }

  return {
    allowed: true,
    invoiceType: requestedInvoiceType,
    // Starter record invoices are offline bookkeeping and must never enter
    // the verification/live-payment setup path.
    shouldSyncMerchantSetup: getPlan(merchant) !== "starter",
  };
}

// ── Gate: Check active collection invoice count ───────────────────────────────
export function canAddActiveCollectionInvoice(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier">,
  activeCollectionCount: number
): AccessResult {
  const plan = getPlan(merchant);
  const limits = PLAN_LIMITS[plan];

  if (
    limits.activeCollectionLimit !== Infinity &&
    activeCollectionCount >= limits.activeCollectionLimit
  ) {
    return {
      allowed: false,
      reason: `You have reached the limit of ${limits.activeCollectionLimit} active collection invoices on the ${getPlanDisplayName("individual")} plan. Close some invoices or upgrade to ${getPlanDisplayName("corporate")}.`,
      upgradeRequired: "corporate",
    };
  }
  return { allowed: true };
}

// ── Gate: Monthly collection limit ───────────────────────────────────────────
export function validateMonthlyCollectionLimit(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier">,
  currentMonthlyTotalNgn: number,
  newAmountNgn: number
): AccessResult {
  const plan = getPlan(merchant);
  const limits = PLAN_LIMITS[plan];

  if (limits.monthlyCollectionNgn === Infinity) return { allowed: true };

  const projected = currentMonthlyTotalNgn + newAmountNgn;
  if (projected > limits.monthlyCollectionNgn) {
    const remaining = Math.max(0, limits.monthlyCollectionNgn - currentMonthlyTotalNgn);
    return {
      allowed: false,
      reason: `Monthly collection limit reached (₦${limits.monthlyCollectionNgn.toLocaleString()}). Remaining this month: ₦${remaining.toLocaleString()}. Upgrade to Business for unlimited collections.`,
      upgradeRequired: "corporate",
    };
  }
  return { allowed: true };
}

// ── Gate: Invite team member ──────────────────────────────────────────────────
export function canInviteTeamMember(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier">,
  currentActiveSeatCount: number // includes owner
): AccessResult {
  const plan = getPlan(merchant);
  const limits = PLAN_LIMITS[plan];

  if (limits.teamLimit !== Infinity && currentActiveSeatCount >= limits.teamLimit) {
    if (plan === "starter") {
      return {
        allowed: false,
        reason: `Starter plan only supports 1 team member (owner + 1 invited). Upgrade to Solo Lite to invite up to 3 predefined-role members.`,
        upgradeRequired: "individual",
      };
    }
    if (plan === "individual" || plan === "solo_plus") {
      return {
        allowed: false,
        reason: `Solo Lite and Solo Plus support up to 3 invited members (4 seats total including owner). Upgrade to Business for unlimited team members and custom roles.`,
        upgradeRequired: "corporate",
      };
    }
  }
  return { allowed: true };
}

// ── Gate: Create custom role ──────────────────────────────────────────────────
export function canCreateCustomRole(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier">
): AccessResult {
  const plan = getPlan(merchant);
  if (!PLAN_LIMITS[plan].canCustomRoles) {
    return {
      allowed: false,
      reason: "Custom roles are only available on the Business plan.",
      upgradeRequired: "corporate",
    };
  }
  return { allowed: true };
}

// ── Gate: Remove watermark ────────────────────────────────────────────────────
export function canRemoveWatermark(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier">
): AccessResult {
  const plan = getPlan(merchant);
  if (!PLAN_LIMITS[plan].canRemoveWatermark) {
    return {
      allowed: false,
      reason: "Watermark removal is only available on the Business plan.",
      upgradeRequired: "corporate",
    };
  }
  return { allowed: true };
}

// ── Gate: Generic feature access ─────────────────────────────────────────────
export type FeatureKey =
  | "collection_invoice"
  | "custom_roles"
  | "watermark_removal"
  | "api_webhooks"
  | "crypto_collections"
  | "advanced_analytics"
  | "settlement_exports"
  | "view_references";

const FEATURE_PLAN_MAP: Record<FeatureKey, PlanKey> = {
  collection_invoice: "individual",
  custom_roles: "corporate",
  watermark_removal: "corporate",
  api_webhooks: "corporate",
  crypto_collections: "corporate",
  advanced_analytics: "corporate",  // Business plan only — matches pricing page
  settlement_exports: "individual",  // Fixed: was corporate, available from Individual
  view_references: "individual",     // Individual and Business plans only
};

export function canAccessFeature(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier">,
  feature: FeatureKey
): AccessResult {
  const plan = getPlan(merchant);
  const required = FEATURE_PLAN_MAP[feature];

  const planOrder: PlanKey[] = ["starter", "individual", "solo_plus", "corporate"];
  const currentLevel = planOrder.indexOf(plan);
  const requiredLevel = planOrder.indexOf(required);

  if (currentLevel < requiredLevel) {
    return {
      allowed: false,
      reason: `This feature requires the ${required === "individual" ? "Solo Lite" : "Business"} plan.`,
      upgradeRequired: required === "individual" ? "individual" : "corporate",
    };
  }
  return { allowed: true };
}

// ── NEW: Identity-verified capability gate ────────────────────────────────────
/**
 * Checks if a merchant can collect payments based on identity verification alone.
 *
 * This is the PROGRESSIVE unlock gate:
 * - Solo Lite/Business merchants with identity_verified = true can collect
 *   without waiting for full business CAC verification.
 *
 * This runs ALONGSIDE the existing canCreateCollectionInvoice() check.
 * Existing verified merchants (verification_status = "verified") are unaffected.
 *
 * Usage: Call this when canCreateCollectionInvoice() returns false due to
 * verification_status, to check if the merchant qualifies via progressive unlock.
 */
export function canCollectAfterIdentityVerification(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier" | "identity_verified">
): AccessResult {
  const plan = getPlan(merchant);

  if (plan === "starter") {
    return {
      allowed: false,
      reason: `Collection invoices are not available on the ${getPlanDisplayName("starter")} plan. Upgrade to ${getPlanDisplayName("individual")} or ${getPlanDisplayName("corporate")}.`,
      upgradeRequired: "individual",
    };
  }

  if (!merchant.identity_verified) {
    return {
      allowed: false,
      reason: `Complete BVN and selfie verification first to enable ${getPlanDisplayName("individual")} payment collection.`,
    };
  }

  return { allowed: true };
}

// ── NEW: Check if merchant has identity verified ───────────────────────────────
/**
 * Simple helper to check if identity verification is complete.
 * Does NOT check plan — only verifies the identity_verified flag.
 */
export function isIdentityVerified(
  merchant: Pick<Merchant, "identity_verified">
): boolean {
  return merchant.identity_verified === true;
}
