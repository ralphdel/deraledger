-- Fix: Update the single 'subscriptions' row with the latest 'subscription_payments' data for each merchant
UPDATE subscriptions s
SET 
  plan_type = sp.plan::subscription_plan_type,
  amount_paid = sp.amount_ngn,
  start_date = sp.period_start,
  expiry_date = sp.period_end,
  status = 'active',
  updated_at = NOW()
FROM (
  SELECT DISTINCT ON (merchant_id)
    merchant_id, plan, amount_ngn, period_start, period_end
  FROM subscription_payments
  ORDER BY merchant_id, created_at DESC
) sp
WHERE s.merchant_id = sp.merchant_id
  AND sp.period_end > NOW(); -- Only mark active if the latest payment period is actually in the future
