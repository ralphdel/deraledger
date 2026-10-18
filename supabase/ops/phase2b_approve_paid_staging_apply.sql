\set ON_ERROR_STOP on
-- This file is only used after a separately approved predecessor-only preflight.
\ir phase2b_approve_paid_staging_preflight.sql
BEGIN READ ONLY;
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
DO $guard$
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
     OR (SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))
         FROM pg_proc WHERE oid = to_regprocedure(
          'public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)'))
        IS DISTINCT FROM '59a78faa12cc7abad8d93637b4a60125'
     OR (SELECT count(*) FROM pg_trigger
         WHERE NOT tgisinternal AND tgname LIKE 'trg_phase2b_approve_%') IS DISTINCT FROM 0
     OR to_regprocedure('public.phase2b_approve_child_version_guard_v1()') IS NOT NULL
     OR to_regprocedure('public.phase2b_approve_case_link_guard_v1()') IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|apply_prestate_changed';
  END IF;
END
$guard$;
ROLLBACK;
-- The migration's own pre-DDL guards check exact columns, policies, grants,
-- constraints, indexes, triggers, RLS, and reviewed RPC bodies before replace.
\ir ../migrations/20261015000000_phase2b_approve_success_atomic.sql
BEGIN READ ONLY;
DO $post$
BEGIN
  IF (SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))
      FROM pg_proc WHERE oid = to_regprocedure(
       'public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)'))
      IS DISTINCT FROM '5cc81f443c678a15bed43de6df472077'
     OR (SELECT count(*) FROM pg_trigger
         WHERE NOT tgisinternal AND tgname LIKE 'trg_phase2b_approve_%') IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'FAIL|APPROVE_STAGING|apply_postflight';
  END IF;
END
$post$;
SELECT 'PASS|APPROVE_STAGING|success_applied';
ROLLBACK;
