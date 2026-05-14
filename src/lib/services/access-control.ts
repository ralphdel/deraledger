/**
 * DeraLedger — Centralized Access Control Service
 *
 * Single source of truth for all plan-gated feature checks.
 * All server actions and UI components MUST call these functions.
 * Never duplicate plan logic elsewhere.
 */

import type { Merchant } from "@/lib/types";

// ── Plan limits (mirrors platform_settings in DB) ─────────────────────────────
export const PLAN_LIMITS = {
  starter: {
    invoiceLimit: 10,          // Lifetime record invoice cap
    teamLimit: 2,              // Owner + 1 invited = 2 seats total
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
    teamLimit: 2,
    activeCollectionLimit: 20,
    monthlyCollectionNgn: 5_000_000,
    canCollect: true,          // Requires verified KYC
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
  if (raw === "individual" || raw === "corporate") return raw;
  return "starter";
}

// ── Access check result ────────────────────────────────────────────────────────
export interface AccessResult {
  allowed: boolean;
  reason?: string;
  upgradeRequired?: "individual" | "corporate";
}

// ── Gate: Create any invoice ──────────────────────────────────────────────────
/**
 * Check if merchant can create a new invoice (any type).
 * For Starter: counts ALL invoices ever created (including archived/deleted soft-counts).
 */
export function canCreateInvoice(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier">,
  currentLifetimeInvoiceCount: number
): AccessResult {
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
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier" | "verification_status">
): AccessResult {
  const plan = getPlan(merchant);
  const limits = PLAN_LIMITS[plan];

  if (!limits.canCollect) {
    return {
      allowed: false,
      reason: "Collection invoices are not available on the Starter plan. Upgrade to Individual or Business.",
      upgradeRequired: "individual",
    };
  }

  if (merchant.verification_status !== "verified") {
    return {
      allowed: false,
      reason: "Collection invoices require completed KYC verification. Please complete verification in Settings.",
    };
  }

  return { allowed: true };
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
      reason: `You have reached the limit of ${limits.activeCollectionLimit} active collection invoices on the Individual plan. Close some invoices or upgrade to Business.`,
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
    const planLabel = plan === "starter" ? "Individual" : "Business";
    return {
      allowed: false,
      reason: `Team seat limit reached (${limits.teamLimit} seats on ${plan} plan). Upgrade to ${planLabel} to invite more members.`,
      upgradeRequired: plan === "starter" ? "individual" : "corporate",
    };
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
  | "settlement_exports";

const FEATURE_PLAN_MAP: Record<FeatureKey, PlanKey> = {
  collection_invoice: "individual",
  custom_roles: "corporate",
  watermark_removal: "corporate",
  api_webhooks: "corporate",
  crypto_collections: "corporate",
  advanced_analytics: "individual",
  settlement_exports: "corporate",
};

export function canAccessFeature(
  merchant: Pick<Merchant, "subscription_plan" | "merchant_tier">,
  feature: FeatureKey
): AccessResult {
  const plan = getPlan(merchant);
  const required = FEATURE_PLAN_MAP[feature];

  const planOrder: PlanKey[] = ["starter", "individual", "corporate"];
  const currentLevel = planOrder.indexOf(plan);
  const requiredLevel = planOrder.indexOf(required);

  if (currentLevel < requiredLevel) {
    return {
      allowed: false,
      reason: `This feature requires the ${required === "individual" ? "Individual" : "Business"} plan.`,
      upgradeRequired: required === "individual" ? "individual" : "corporate",
    };
  }
  return { allowed: true };
}
