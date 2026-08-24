WITH checks AS (
  SELECT 'prerequisite.tables'::text check_name,
    CASE WHEN EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.merchant_compliance_profiles'::regclass)
      AND EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.merchant_compliance_reviews'::regclass)
      AND EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.merchant_compliance_events'::regclass)
      AND EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.solo_plus_cases'::regclass) THEN 'PASS' ELSE 'FAIL' END status,
    'Migration 024 compliance tables and solo_plus_cases exist'::text details
  UNION ALL SELECT 'prerequisite.rls', CASE WHEN NOT EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.merchant_compliance_profiles'::regclass,'public.merchant_compliance_reviews'::regclass,'public.merchant_compliance_events'::regclass) AND (NOT relrowsecurity OR relforcerowsecurity)) THEN 'PASS' ELSE 'FAIL' END, 'RLS enabled and not forced on three compliance tables'
  UNION ALL SELECT 'prerequisite.browser_grants', CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events') AND grantee IN ('PUBLIC','anon','authenticated')) THEN 'PASS' ELSE 'FAIL' END, 'No browser/public compliance-table grants'
  UNION ALL SELECT 'rpc.overloads', CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='bootstrap_reviewed_profile_v1') <= 1 THEN 'PASS' ELSE 'FAIL' END, 'No conflicting bootstrap RPC overload'
)
SELECT check_name, 'schema/security'::text object_type, status, details FROM checks
UNION ALL SELECT 'summary','summary',CASE WHEN bool_and(status='PASS') THEN 'PASS' ELSE 'FAIL' END,'Stop on FAIL; apply only after all prerequisites pass' FROM checks;
