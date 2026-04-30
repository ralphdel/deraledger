-- Migration: Re-verify merchants missing owner_name
-- Run this in Supabase SQL Editor

-- Step 1: Downgrade 'verified' merchants who are missing owner_name to 'unverified'
-- This enforces the new requirement that owner_name must be present for BVN-based verification
UPDATE merchants
SET 
  verification_status = 'unverified',
  bvn_status = CASE WHEN bvn_status = 'verified' THEN 'unverified' ELSE bvn_status END
WHERE 
  verification_status = 'verified'
  AND (owner_name IS NULL OR owner_name = '');

-- Step 2: Show which merchants were affected
SELECT id, business_name, email, subscription_plan, verification_status, owner_name
FROM merchants
WHERE owner_name IS NULL OR owner_name = '';
