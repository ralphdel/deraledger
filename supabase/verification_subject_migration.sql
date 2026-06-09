-- ============================================================================
-- DeraLedger — Verification Subject and Clarity Columns Migration
-- Run this in your Supabase SQL Editor.
-- ============================================================================

-- 1. Add invitation_id to business_director_verifications
ALTER TABLE business_director_verifications
  ADD COLUMN IF NOT EXISTS invitation_id UUID REFERENCES director_invitations(id) ON DELETE SET NULL;

-- 2. Drop existing CHECK constraint on verification_type if it exists, and create extended check constraint
ALTER TABLE verification_logs DROP CONSTRAINT IF EXISTS verification_logs_verification_type_check;
ALTER TABLE verification_logs
  ADD CONSTRAINT verification_logs_verification_type_check
  CHECK (verification_type IN (
    'bvn_selfie', 
    'business', 
    'director', 
    'identity', 
    'representative_bvn_selfie', 
    'business_registry', 
    'director_bvn_selfie'
  ));

-- 3. Add subject and clarity metadata columns to verification_logs
ALTER TABLE verification_logs
  ADD COLUMN IF NOT EXISTS verification_subject TEXT CHECK (verification_subject IN ('representative', 'business', 'director')),
  ADD COLUMN IF NOT EXISTS invitation_id UUID REFERENCES director_invitations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_affiliation_id UUID REFERENCES business_affiliations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_director_name TEXT,
  ADD COLUMN IF NOT EXISTS returned_bvn_name TEXT,
  ADD COLUMN IF NOT EXISTS name_match_status TEXT;
