\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT set_config('deraledger.phase2b_expected_project_ref', :'expected_project_ref', true);
DO $guard$
DECLARE
  v_old oid := to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::oid;
  v_approve oid := to_regprocedure('public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)')::oid;
  v_child_guard oid := to_regprocedure('public.phase2b_approve_child_version_guard_v1()')::oid;
  v_case_guard oid := to_regprocedure('public.phase2b_approve_case_link_guard_v1()')::oid;
  v_hash text;
  v_trigger_count integer;
  v_payment_policy text;
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref') IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_database() IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
     OR v_old IS NULL OR v_approve IS NULL
     OR to_regrole('service_role') IS NULL
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname = 'review_solo_plus_case_v1') IS DISTINCT FROM 1
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
         AND proname = 'review_solo_plus_case_approve_atomic_v1') IS DISTINCT FROM 1
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['solo_plus_cases','solo_plus_case_requirements',
         'solo_plus_case_events','payment_records']) t(name)
         WHERE to_regclass('public.' || t.name) IS NULL)
     OR EXISTS (SELECT 1 FROM pg_class c
         WHERE c.oid IN ('public.solo_plus_cases'::regclass,
             'public.solo_plus_case_requirements'::regclass,
             'public.solo_plus_case_events'::regclass,
             'public.payment_records'::regclass)
           AND (NOT c.relrowsecurity OR c.relforcerowsecurity))
     OR (SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))
         FROM pg_proc WHERE oid = v_old) IS DISTINCT FROM '27710a7819d8413aa8764d8762a6a0ca'
     OR has_function_privilege('anon', v_approve, 'EXECUTE')
     OR has_function_privilege('authenticated', v_approve, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_approve, 'EXECUTE')
     OR has_function_privilege('anon', v_old, 'EXECUTE')
     OR has_function_privilege('authenticated', v_old, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_old, 'EXECUTE')
     OR (SELECT prosecdef FROM pg_proc WHERE oid = v_approve)
     OR (SELECT prosecdef FROM pg_proc WHERE oid = v_old)
     OR (SELECT proowner FROM pg_proc WHERE oid = v_approve) IS DISTINCT FROM to_regrole(current_user)::oid
     OR (SELECT proowner FROM pg_proc WHERE oid = v_old) IS DISTINCT FROM to_regrole(current_user)::oid
     OR (SELECT prorettype FROM pg_proc WHERE oid = v_approve) IS DISTINCT FROM 'jsonb'::regtype
     OR (SELECT prorettype FROM pg_proc WHERE oid = v_old) IS DISTINCT FROM 'jsonb'::regtype
     OR (SELECT pronargdefaults FROM pg_proc WHERE oid = v_approve) IS DISTINCT FROM 0
     OR (SELECT pronargdefaults FROM pg_proc WHERE oid = v_old) IS DISTINCT FROM 2
     OR (SELECT pg_get_expr(proargdefaults, 0) FROM pg_proc WHERE oid = v_old)
         IS DISTINCT FROM 'NULL::text, NULL::text'
     OR (SELECT proargnames FROM pg_proc WHERE oid = v_approve) IS DISTINCT FROM ARRAY[
          'p_case_id','p_expected_row_version','p_request_idempotency_key',
          'p_decision','p_reviewer_admin_id','p_reason','p_policy_version',
          'p_expected_fixture_run_id']::text[]
     OR (SELECT proargnames FROM pg_proc WHERE oid = v_old) IS DISTINCT FROM ARRAY[
          'p_case_id','p_expected_row_version','p_request_idempotency_key',
          'p_decision','p_reviewer_admin_id','p_reason','p_policy_version']::text[]
     OR (SELECT coalesce(array_length(proconfig,1),0) FROM pg_proc WHERE oid = v_approve) IS DISTINCT FROM 1
     OR (SELECT coalesce(array_length(proconfig,1),0) FROM pg_proc WHERE oid = v_old) IS DISTINCT FROM 1
     OR (SELECT replace(proconfig[1], ' ', '') FROM pg_proc WHERE oid = v_approve)
         IS DISTINCT FROM 'search_path=public,pg_temp'
     OR (SELECT replace(proconfig[1], ' ', '') FROM pg_proc WHERE oid = v_old)
         IS DISTINCT FROM 'search_path=public,pg_temp'
     OR NOT EXISTS (SELECT 1 FROM pg_proc p,
          LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE p.oid = v_approve AND a.grantee = to_regrole('service_role')::oid
            AND a.privilege_type = 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p,
          LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE p.oid = v_old AND a.grantee = to_regrole('service_role')::oid
            AND a.privilege_type = 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p,
          LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE p.oid IN (v_approve, v_old) AND a.privilege_type = 'EXECUTE'
            AND a.grantee NOT IN (p.proowner, to_regrole('service_role')::oid)) THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|identity_or_predecessor_drift';
  END IF;
  SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n')) INTO v_hash
  FROM pg_proc WHERE oid = v_approve;
  SELECT count(*) INTO v_trigger_count FROM pg_trigger
  WHERE NOT tgisinternal AND tgname LIKE 'trg_phase2b_approve_%';
  IF NOT ((v_hash = '59a78faa12cc7abad8d93637b4a60125' AND v_trigger_count = 0
           AND v_child_guard IS NULL AND v_case_guard IS NULL)
      OR (v_hash = '5cc81f443c678a15bed43de6df472077' AND v_trigger_count = 7
        AND v_child_guard IS NOT NULL AND v_case_guard IS NOT NULL
        AND (SELECT count(*) FROM pg_proc
             WHERE pronamespace = 'public'::regnamespace
               AND proname = 'phase2b_approve_child_version_guard_v1') = 1
        AND (SELECT count(*) FROM pg_proc
             WHERE pronamespace = 'public'::regnamespace
               AND proname = 'phase2b_approve_case_link_guard_v1') = 1
        AND (SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))
             FROM pg_proc WHERE oid = v_child_guard)
             = '44b875480dccc0be4fdc8c8b09b107a5'
        AND (SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))
             FROM pg_proc WHERE oid = v_case_guard)
             = 'e4f9dcec38dbcdcc9848dcadcb360dbe'
        AND (SELECT count(*) FROM pg_trigger t
             JOIN (VALUES
               ('trg_phase2b_approve_payment_version', 'public.payment_records'::regclass, 16, 'old_rows', 'new_rows', v_child_guard),
               ('trg_phase2b_approve_payment_insert_version', 'public.payment_records'::regclass, 4, NULL::text, 'new_rows', v_child_guard),
               ('trg_phase2b_approve_payment_delete_version', 'public.payment_records'::regclass, 8, 'old_rows', NULL::text, v_child_guard),
               ('trg_phase2b_approve_requirement_version', 'public.solo_plus_case_requirements'::regclass, 16, 'old_rows', 'new_rows', v_child_guard),
               ('trg_phase2b_approve_requirement_insert_version', 'public.solo_plus_case_requirements'::regclass, 4, NULL::text, 'new_rows', v_child_guard),
               ('trg_phase2b_approve_requirement_delete_version', 'public.solo_plus_case_requirements'::regclass, 8, 'old_rows', NULL::text, v_child_guard),
               ('trg_phase2b_approve_case_link_version', 'public.solo_plus_cases'::regclass, 19, NULL::text, NULL::text, v_case_guard)
             ) e(name, table_id, trigger_type, old_table, new_table, function_id)
               ON t.tgname = e.name AND t.tgrelid = e.table_id
             WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
               AND t.tgtype = e.trigger_type AND t.tgfoid = e.function_id
               AND t.tgoldtable::text IS NOT DISTINCT FROM e.old_table
               AND t.tgnewtable::text IS NOT DISTINCT FROM e.new_table
               AND t.tgqual IS NULL) = 7)) THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|migration_state_incompatible';
  END IF;
  IF v_hash = '5cc81f443c678a15bed43de6df472077'
     AND (EXISTS (SELECT 1 FROM pg_proc p
           WHERE p.oid IN (v_child_guard, v_case_guard)
             AND (NOT p.prosecdef
               OR p.proowner IS DISTINCT FROM to_regrole(current_user)::oid
               OR replace(p.proconfig[1], ' ', '') IS DISTINCT FROM 'search_path=public,pg_temp'))
       OR EXISTS (SELECT 1 FROM pg_proc p,
           LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
           WHERE p.oid IN (v_child_guard, v_case_guard)
             AND a.privilege_type = 'EXECUTE' AND a.grantee IS DISTINCT FROM p.proowner)) THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|guard_function_security_drift';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class t,
      LATERAL aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) a
      WHERE t.oid IN ('public.solo_plus_cases'::regclass,
          'public.solo_plus_case_requirements'::regclass,
          'public.solo_plus_case_events'::regclass,
          'public.payment_records'::regclass)
        AND a.grantee IN (0, to_regrole('anon')::oid, to_regrole('authenticated')::oid)
        AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
     OR NOT has_table_privilege('service_role', 'public.solo_plus_cases', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.solo_plus_cases', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.solo_plus_case_requirements', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.payment_records', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.solo_plus_case_events', 'INSERT') THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|table_grant_drift';
  END IF;
  v_payment_policy := CASE WHEN to_regclass('public.merchant_team') IS NULL THEN
    $policy$((auth.role() = 'authenticated'::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = payment_records.merchant_id) AND (m.user_id = auth.uid()))))))$policy$
    ELSE $policy$((auth.role() = 'authenticated'::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = payment_records.merchant_id) AND (m.user_id = auth.uid())))) OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = payment_records.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))))$policy$ END;
  IF EXISTS (
    WITH expected(table_name, policy_name, using_expression) AS (VALUES
      ('solo_plus_cases', 'merchant_read_solo_plus_cases',
        $policy$((auth.role() = 'authenticated'::text) AND (merchant_id IS NOT NULL) AND (EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = solo_plus_cases.merchant_id) AND (m.user_id = auth.uid())))))$policy$),
      ('solo_plus_case_requirements', 'merchant_read_solo_plus_case_requirements',
        $policy$((auth.role() = 'authenticated'::text) AND (EXISTS (SELECT 1 FROM (solo_plus_cases c JOIN merchants m ON ((m.id = c.merchant_id))) WHERE ((c.id = solo_plus_case_requirements.case_id) AND (m.user_id = auth.uid())))))$policy$),
      ('payment_records', 'merchant_read_payment_records', v_payment_policy)
    )
    SELECT 1 FROM expected e
    JOIN pg_class t ON t.oid = format('public.%I', e.table_name)::regclass
    LEFT JOIN pg_policy p ON p.polrelid = t.oid AND p.polname = e.policy_name
    WHERE p.oid IS NULL OR p.polcmd IS DISTINCT FROM 'r' OR p.polpermissive IS NOT TRUE
       OR p.polroles IS DISTINCT FROM ARRAY[0]::oid[] OR p.polwithcheck IS NOT NULL
       OR ARRAY(SELECT (x.parts)[1] FROM regexp_matches(
            pg_get_expr(p.polqual, p.polrelid, false),
            $quoted$('([^']|'')*')$quoted$, 'g') x(parts))
          IS DISTINCT FROM ARRAY(SELECT (x.parts)[1] FROM regexp_matches(
            e.using_expression, $quoted$('([^']|'')*')$quoted$, 'g') x(parts))
       OR regexp_replace(regexp_replace(regexp_replace(
            btrim(pg_get_expr(p.polqual, p.polrelid, false)),
            '[[:space:]]+', ' ', 'g'), '[(][[:space:]]+', '(', 'g'),
            '[[:space:]]+[)]', ')', 'g')
          IS DISTINCT FROM regexp_replace(regexp_replace(regexp_replace(
            btrim(e.using_expression), '[[:space:]]+', ' ', 'g'),
            '[(][[:space:]]+', '(', 'g'), '[[:space:]]+[)]', ')', 'g')
  ) OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.payment_records'::regclass) IS DISTINCT FROM 1
    OR EXISTS (SELECT 1 FROM pg_policy p
      WHERE p.polrelid IN ('public.solo_plus_cases'::regclass,
          'public.solo_plus_case_requirements'::regclass,
          'public.solo_plus_case_events'::regclass)
        AND (p.polcmd IS DISTINCT FROM 'r'
          OR (p.polrelid = 'public.solo_plus_cases'::regclass
              AND p.polname IS DISTINCT FROM 'merchant_read_solo_plus_cases')
          OR (p.polrelid = 'public.solo_plus_case_requirements'::regclass
              AND p.polname IS DISTINCT FROM 'merchant_read_solo_plus_case_requirements')
          OR p.polrelid = 'public.solo_plus_case_events'::regclass)) THEN
    RAISE EXCEPTION 'BLOCKED|APPROVE_STAGING|policy_semantic_drift';
  END IF;
END
$guard$;
SELECT CASE
  WHEN (SELECT md5(replace(replace(prosrc,E'\r\n',E'\n'),E'\r',E'\n'))
        FROM pg_proc WHERE oid = to_regprocedure(
          'public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)'))
       = '5cc81f443c678a15bed43de6df472077'
  THEN 'PASS|APPROVE_STAGING|migration_success_installed'
  ELSE 'PASS|APPROVE_STAGING|migration_predecessor_only'
END;
ROLLBACK;
