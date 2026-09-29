-- Canonical private evidence storage baseline.
-- Source decisions:
--   - KYC evidence remains in private bucket kyc-documents.
--   - Dispute evidence uses separate private bucket dispute-evidence.
--   - Browser roles receive no storage.objects policy for either bucket.
--   - Server service-role clients own upload and signed-read authorization.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_bucket RECORD;
  v_expected_mimes TEXT[] := ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::TEXT[];
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Supabase storage baseline is required before private evidence storage';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Supabase managed roles are required before private evidence storage';
  END IF;

  FOR v_bucket IN
    SELECT id, name, public, file_size_limit, allowed_mime_types
    FROM storage.buckets
    WHERE id IN ('kyc-documents', 'dispute-evidence')
  LOOP
    IF v_bucket.name IS DISTINCT FROM v_bucket.id
       OR v_bucket.public IS DISTINCT FROM FALSE
       OR v_bucket.file_size_limit IS DISTINCT FROM 10485760
       OR v_bucket.allowed_mime_types IS NULL
       OR NOT (v_bucket.allowed_mime_types @> v_expected_mimes AND v_expected_mimes @> v_bucket.allowed_mime_types) THEN
      RAISE EXCEPTION 'Private evidence bucket % has conflicting configuration', v_bucket.id;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_policy policy
    WHERE policy.polrelid = 'storage.objects'::regclass
      AND (
        COALESCE(pg_get_expr(policy.polqual, policy.polrelid), '') ~ '(kyc-documents|dispute-evidence)'
        OR COALESCE(pg_get_expr(policy.polwithcheck, policy.polrelid), '') ~ '(kyc-documents|dispute-evidence)'
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected browser/storage policy already references a private evidence bucket';
  END IF;
END
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('kyc-documents', 'kyc-documents', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('dispute-evidence', 'dispute-evidence', FALSE, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_expected_mimes TEXT[] := ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::TEXT[];
BEGIN
  IF (SELECT COUNT(*) FROM storage.buckets WHERE id IN ('kyc-documents', 'dispute-evidence')) <> 2 THEN
    RAISE EXCEPTION 'Private evidence buckets were not created';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id IN ('kyc-documents', 'dispute-evidence')
      AND (
        public IS DISTINCT FROM FALSE
        OR file_size_limit IS DISTINCT FROM 10485760
        OR allowed_mime_types IS NULL
        OR NOT (allowed_mime_types @> v_expected_mimes AND v_expected_mimes @> allowed_mime_types)
      )
  ) THEN
    RAISE EXCEPTION 'Private evidence bucket post-apply configuration mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'storage.objects'::regclass
      AND relrowsecurity = TRUE
  ) THEN
    RAISE EXCEPTION 'storage.objects RLS must remain enabled';
  END IF;
END
$$;

COMMIT;
