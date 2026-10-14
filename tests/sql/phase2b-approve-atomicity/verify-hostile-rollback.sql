-- The candidate migration must have failed after hostile setup, before DDL.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT count(*) FROM local_phase2b_hostile_snapshot) <> 1
     OR to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)') IS NULL
     OR EXISTS (
       SELECT 1 FROM local_phase2b_hostile_snapshot s
       JOIN pg_proc p ON p.oid = to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')
       WHERE s.old_body_hash IS DISTINCT FROM md5(replace(replace(p.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
          OR s.new_rpc_oid IS DISTINCT FROM
            to_regprocedure('public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)')::oid
     ) THEN
    RAISE EXCEPTION 'FAIL|APPROVE_ATOMICITY|hostile_apply_changed_rpc';
  END IF;
END $$;
\echo PASS|APPROVE_ATOMICITY|hostile_guard_rolled_back
