-- Add notification tracking to merchants table
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS subscription_notifications_sent JSONB DEFAULT '{}';

-- Create comment for documentation
COMMENT ON COLUMN merchants.subscription_notifications_sent IS 'Stores which notification thresholds have fired for the current billing cycle (e.g. { "7_day": "2026-05-08T07:00:00Z" }).';
