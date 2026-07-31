BEGIN;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.verification_disclosures', 'INSERT') THEN
    RAISE EXCEPTION 'anon must not insert verification_disclosures';
  END IF;
  IF has_table_privilege('anon', 'public.verification_disclosures', 'UPDATE') THEN
    RAISE EXCEPTION 'anon must not update verification_disclosures';
  END IF;
  IF has_table_privilege('anon', 'public.verification_disclosures', 'DELETE') THEN
    RAISE EXCEPTION 'anon must not delete verification_disclosures';
  END IF;
  IF has_table_privilege('authenticated', 'public.verification_disclosures', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated must not insert verification_disclosures';
  END IF;
  IF has_table_privilege('authenticated', 'public.verification_disclosures', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated must not update verification_disclosures';
  END IF;
  IF has_table_privilege('authenticated', 'public.verification_disclosures', 'DELETE') THEN
    RAISE EXCEPTION 'authenticated must not delete verification_disclosures';
  END IF;
  IF has_table_privilege('anon', 'public.merchants', 'UPDATE') THEN
    RAISE EXCEPTION 'anon must not update merchants';
  END IF;
  IF has_table_privilege('authenticated', 'public.merchants', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated must not update merchants directly';
  END IF;
  IF has_table_privilege('anon', 'public.merchants', 'SELECT') THEN
    RAISE EXCEPTION 'anon must not read full merchant rows';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.merchants', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated owner/team/admin merchant read grant must remain available';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchants'
      AND policyname IN ('Allow public read merchants', 'Allow public update merchants')
  ) THEN
    RAISE EXCEPTION 'legacy public merchant policies must be removed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'merchants'
      AND policyname = 'authenticated_read_own_team_or_admin_merchants'
      AND cmd = 'SELECT'
      AND roles && ARRAY['authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'narrow authenticated merchant SELECT policy must exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'verification_disclosures'
      AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'verification_disclosures must not expose browser policies';
  END IF;
END;
$$;

DO $$
DECLARE
  v_oid oid := to_regprocedure('public.can_read_merchant_row_v1(uuid)');
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'merchant read helper is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = v_oid
      AND p.prosecdef
      AND pg_get_function_result(p.oid) = 'boolean'
      AND array_to_string(p.proconfig, ' ') ILIKE '%search_path=public, pg_temp%'
  ) THEN
    RAISE EXCEPTION 'merchant read helper must be SECURITY DEFINER boolean with safe search_path';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute merchant read helper directly';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute merchant read helper for RLS';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
    LEFT JOIN LATERAL aclexplode(d.defaclacl) acl ON true
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND (
        owner_role.rolname IN ('postgres', current_user)
        OR pg_has_role(current_user, owner_role.rolname, 'MEMBER')
      )
      AND COALESCE(grantee_role.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
      AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'unsafe browser default ACLs owned by postgres/current/alterable roles must be removed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
    LEFT JOIN LATERAL aclexplode(d.defaclacl) acl ON true
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND owner_role.rolname = 'supabase_admin'
      AND NOT (owner_role.rolname = current_user OR pg_has_role(current_user, owner_role.rolname, 'MEMBER'))
      AND COALESCE(grantee_role.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
      AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'EXECUTE')
  ) THEN
    RAISE WARNING 'managed_role_default_acl_unmodifiable role=supabase_admin';
  END IF;
END;
$$;

ROLLBACK;
