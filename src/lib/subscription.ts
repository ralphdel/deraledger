export type PlanType = "individual" | "corporate" | "starter";

interface SubscriptionState {
  planType: PlanType;
  expiryDate: string; // ISO String
}

const DAILY_RATES = {
  starter: 0,
  individual: 5000 / 30, // ₦166.67/day
  corporate: 20000 / 30, // ₦666.67/day
};

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
  const newDailyRate = DAILY_RATES[newPlanType];

  if (newDailyRate === 0) {
    // Starter plan expires theoretically in 10 years (managed by invoice count instead)
    const d = new Date();
    d.setFullYear(d.getFullYear() + 10);
    return d;
  }

  const now = new Date();
  let remainingValue = 0;
  let baseDate = now;

  // Proration Logic
  if (currentSubscription) {
    const currentExpiry = new Date(currentSubscription.expiryDate);
    if (currentExpiry > now) {
      const daysRemaining = (currentExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      const currentDailyRate = DAILY_RATES[currentSubscription.planType];
      
      // Calculate how much NGN value they have left in their current plan
      remainingValue = Math.max(0, daysRemaining * currentDailyRate);
      
      // If they are renewing the SAME plan, we just append days to their existing expiry date
      // If upgrading, we convert their remaining value + new amount to days at the NEW rate from today.
      if (currentSubscription.planType === newPlanType) {
        baseDate = currentExpiry;
        remainingValue = 0; // Don't double count if we're extending baseDate
      }
    }
  }

  const totalValueToApply = amountPaid + remainingValue;
  const daysGranted = totalValueToApply / newDailyRate;

  // Add daysGranted to baseDate
  const newExpiry = new Date(baseDate.getTime() + daysGranted * 24 * 60 * 60 * 1000);
  
  return newExpiry;
}
