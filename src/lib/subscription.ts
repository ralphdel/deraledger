import { normalizeCapabilityPlanCode } from "@/lib/plans";

export type PlanType = "individual" | "corporate" | "starter" | "solo_plus";

interface SubscriptionState {
  planType: PlanType;
  expiryDate: string; // ISO String
}

const DAILY_RATES: Record<PlanType, number> = {
  starter: 0,
  individual: 5000 / 30,
  solo_plus: 13000 / 30,
  corporate: 20000 / 30,
};

function resolveRatePlan(planType: PlanType): PlanType {
  if (planType === "starter" || planType === "solo_plus") return planType;
  return normalizeCapabilityPlanCode(planType);
}

/**
 * Calculates the new expiry date for a subscription, accounting for prorated upgrades.
 * @param amountPaid Amount paid in NGN (not kobo)
 * @param newPlanType The plan being purchased
 * @param currentSubscription Optional current subscription state for proration
 * @returns Date object of the new expiry
 */
export function calculateSubscriptionExpiry(
  amountPaid: number,
  newPlanType: PlanType,
  currentSubscription?: SubscriptionState
): Date {
  const newDailyRate = DAILY_RATES[resolveRatePlan(newPlanType)];

  if (newDailyRate === 0) {
    // Starter plan expires theoretically in 10 years (managed by invoice count instead)
    const d = new Date();
    d.setFullYear(d.getFullYear() + 10);
    return d;
  }

  const now = new Date();
  let remainingValue = 0;
  let baseDate = now;

  if (currentSubscription) {
    const currentExpiry = new Date(currentSubscription.expiryDate);
    if (currentExpiry > now) {
      const daysRemaining = (currentExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      const currentDailyRate = DAILY_RATES[resolveRatePlan(currentSubscription.planType)];

      remainingValue = Math.max(0, daysRemaining * currentDailyRate);

      if (resolveRatePlan(currentSubscription.planType) === resolveRatePlan(newPlanType)) {
        baseDate = currentExpiry;
        remainingValue = 0;
      }
    }
  }

  const totalValueToApply = amountPaid + remainingValue;
  const daysGranted = totalValueToApply / newDailyRate;

  return new Date(baseDate.getTime() + daysGranted * 24 * 60 * 60 * 1000);
}
