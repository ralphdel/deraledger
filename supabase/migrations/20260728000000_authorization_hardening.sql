-- ============================================================
-- Phase 2 closeout authorization hardening
-- Repairs legacy public merchant/disclosure write grants and
-- unsafe default ACL drift before the disclosure acknowledgement RPC.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_policy record;
  v_owner text;
  v_grantee text;
  v_can_alter_owner_defaults boolean;
BEGIN
  IF to_regclass('public.merchants') IS NULL THEN
    RAISE EXCEPTION 'public.merchants is required before authorization hardening';
  END IF;

  IF to_regclass('public.verification_disclosures') IS NULL THEN
    RAISE EXCEPTION 'public.verification_disclosures is required before authorization hardening';
  END IF;

  IF to_regclass('public.merchant_team') IS NULL THEN
    RAISE EXCEPTION 'public.merchant_team is required before authorization hardening';
  END IF;

  ALTER TABLE public.merchants
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

  ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.verification_disclosures ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "Allow public read merchants" ON public.merchants;
  DROP POLICY IF EXISTS "Allow public update merchants" ON public.merchants;

  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchants'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.merchants', v_policy.policyname);
  END LOOP;

  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'verification_disclosures'
      AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.verification_disclosures', v_policy.policyname);
  END LOOP;

  REVOKE ALL ON TABLE public.merchants FROM PUBLIC;
  REVOKE ALL ON TABLE public.verification_disclosures FROM PUBLIC;

  FOREACH v_grantee IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_grantee) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.merchants FROM %I', v_grantee);
      EXECUTE format('REVOKE ALL ON TABLE public.verification_disclosures FROM %I', v_grantee);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON TABLE public.merchants TO authenticated;
  END IF;

  FOR v_owner IN
    SELECT DISTINCT rolname
    FROM pg_roles
    WHERE rolname IN ('postgres', 'supabase_admin', current_user)
  LOOP
    v_can_alter_owner_defaults :=
      v_owner = current_user
      OR pg_has_role(current_user, v_owner, 'MEMBER');

    IF v_can_alter_owner_defaults THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC', v_owner);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC', v_owner);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC', v_owner);

      FOREACH v_grantee IN ARRAY ARRAY['anon', 'authenticated']
      LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_grantee) THEN
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', v_owner, v_grantee);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', v_owner, v_grantee);
          EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', v_owner, v_grantee);
        END IF;
      END LOOP;
    ELSE
      IF v_owner = 'supabase_admin' THEN
        RAISE WARNING
          'managed_role_default_acl_unmodifiable role=% current_user=% can_alter=false',
          v_owner,
          current_user;
      ELSE
        RAISE WARNING
          'default_acl_owner_unmodifiable role=% current_user=% can_alter=false',
          v_owner,
          current_user;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_merchant_row_v1(p_merchant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    auth.role() = 'authenticated'
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants owner_merchant
        WHERE owner_merchant.id = p_merchant_id
          AND owner_merchant.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team team_member
        WHERE team_member.merchant_id = p_merchant_id
          AND team_member.user_id = auth.uid()
          AND COALESCE(team_member.is_active, false) = true
      )
      OR EXISTS (
        SELECT 1
        FROM public.merchants admin_merchant
        WHERE admin_merchant.user_id = auth.uid()
          AND COALESCE(admin_merchant.is_super_admin, false) = true
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_merchant_row_v1(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_merchant_row_v1(UUID) TO authenticated;

DROP POLICY IF EXISTS "authenticated_read_own_team_or_admin_merchants" ON public.merchants;
CREATE POLICY "authenticated_read_own_team_or_admin_merchants"
  ON public.merchants
  FOR SELECT
  TO authenticated
  USING (public.can_read_merchant_row_v1(id));

COMMENT ON FUNCTION public.can_read_merchant_row_v1(UUID) IS
  'Phase 2 closeout helper for narrow authenticated merchant SELECT RLS. Browser roles cannot write merchants.';

COMMIT;
