-- ============================================================================
-- DeraLedger — Verification Status Migration (TEXT column fix)
-- The verification_status column is TEXT, not an enum type.
-- Run this in your Supabase SQL Editor.
-- ============================================================================

-- Step 1: Find and drop the existing CHECK constraint on verification_status
-- (Run this first to see the constraint name, then drop it)
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT tc.constraint_name
    INTO constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON tc.constraint_name = cc.constraint_name
   WHERE tc.table_name = 'merchants'
     AND tc.constraint_type = 'CHECK'
     AND cc.check_clause ILIKE '%verification_status%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE merchants DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Dropped constraint: %', constraint_name;
  ELSE
    RAISE NOTICE 'No existing verification_status CHECK constraint found — skipping drop.';
  END IF;
END $$;

-- Step 2: Add new CHECK constraint with all required values
ALTER TABLE merchants
  ADD CONSTRAINT merchants_verification_status_check
  CHECK (verification_status IN (
    'unverified',
    'pending',
    'pending_admin_review',
    'requires_reupload',
    'verified',
    'rejected',
    'suspended',
    'restricted'
  ));

-- Step 3: Add kyc_rejection_reason column if it doesn't exist
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kyc_rejection_reason TEXT;

-- Step 4: Add kyc_reviewed_at column if it doesn't exist
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kyc_reviewed_at TIMESTAMPTZ;

-- Step 5: Add kyc_reset_at column for tracking verification resets
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS kyc_reset_at TIMESTAMPTZ;

-- Step 6: Verify everything looks correct
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'merchants'
  AND column_name IN (
    'verification_status',
    'kyc_rejection_reason',
    'kyc_reviewed_at',
    'kyc_reset_at'
  )
ORDER BY column_name;
