-- Phase 2B Solo Plus synthetic approve success path. Forward-only source.
-- The reviewed 20261014 fail-closed cutover and legacy v1 RPC are unchanged.
BEGIN;
SET LOCAL search_path = public, pg_temp;

DO $$
DECLARE
  v_approve_oid OID := to_regprocedure('public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)')::OID;
  v_legacy_oid OID := to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::OID;
  v_approve pg_catalog.pg_proc%ROWTYPE;
  v_legacy pg_catalog.pg_proc%ROWTYPE;
  v_service_role_oid OID := to_regrole('service_role')::OID;
  v_guard_name TEXT;
  v_guard pg_catalog.pg_proc%ROWTYPE;
  v_expected_payment_policy TEXT;
BEGIN
  IF v_approve_oid IS NULL OR v_legacy_oid IS NULL OR v_service_role_oid IS NULL
     OR to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL
     OR to_regclass('public.solo_plus_cases') IS NULL
     OR to_regclass('public.solo_plus_case_requirements') IS NULL
     OR to_regclass('public.solo_plus_case_events') IS NULL
     OR to_regclass('public.payment_records') IS NULL
     OR to_regclass('public.idx_solo_plus_case_events_review_request_intent') IS NULL THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: prerequisite missing';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'review_solo_plus_case_approve_atomic_v1') <> 1
     OR (SELECT count(*) FROM pg_catalog.pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'review_solo_plus_case_v1') <> 1 THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: unexpected RPC overload';
  END IF;

  SELECT * INTO STRICT v_approve FROM pg_catalog.pg_proc WHERE oid = v_approve_oid;
  SELECT * INTO STRICT v_legacy FROM pg_catalog.pg_proc WHERE oid = v_legacy_oid;
  IF md5(replace(replace(v_legacy.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
       <> '27710a7819d8413aa8764d8762a6a0ca'
     OR md5(replace(replace(v_approve.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
        NOT IN (
          '59a78faa12cc7abad8d93637b4a60125',
          '5cc81f443c678a15bed43de6df472077'
        )
     OR v_approve.proargnames IS DISTINCT FROM ARRAY[
       'p_case_id', 'p_expected_row_version', 'p_request_idempotency_key',
       'p_decision', 'p_reviewer_admin_id', 'p_reason', 'p_policy_version',
       'p_expected_fixture_run_id'
     ]::TEXT[]
     OR v_approve.pronargdefaults <> 0
     OR v_approve.prorettype <> 'jsonb'::regtype
     OR v_approve.proretset OR v_approve.prosecdef OR v_approve.proisstrict
     OR v_approve.prokind <> 'f' OR v_approve.provolatile <> 'v'
     OR v_approve.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
     OR v_approve.proowner IS DISTINCT FROM to_regrole(current_user)::OID
     OR COALESCE(array_length(v_approve.proconfig, 1), 0) <> 1
     OR replace(v_approve.proconfig[1], ' ', '') IS DISTINCT FROM 'search_path=public,pg_temp'
     OR v_legacy.proowner IS DISTINCT FROM to_regrole(current_user)::OID
     OR v_legacy.prosecdef OR v_legacy.prorettype <> 'jsonb'::regtype THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: reviewed RPC drift';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM aclexplode(COALESCE(v_approve.proacl, acldefault('f', v_approve.proowner))) acl
       WHERE acl.grantee = v_service_role_oid AND acl.privilege_type = 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1 FROM aclexplode(COALESCE(v_approve.proacl, acldefault('f', v_approve.proowner))) acl
       WHERE acl.privilege_type = 'EXECUTE'
         AND acl.grantee NOT IN (v_approve.proowner, v_service_role_oid)
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_index i
       WHERE i.indexrelid = 'public.idx_solo_plus_case_events_review_request_intent'::regclass
         AND i.indrelid = 'public.solo_plus_case_events'::regclass
         AND i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint c
       WHERE c.conrelid = 'public.solo_plus_case_requirements'::regclass
         AND c.conname = 'solo_plus_case_requirements_unique_case_code'
         AND c.contype = 'u' AND c.convalidated
     ) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: grant or uniqueness drift';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_index i ON i.indexrelid = c.conindid
    WHERE c.conrelid = 'public.solo_plus_case_requirements'::regclass
      AND c.conname = 'solo_plus_case_requirements_unique_case_code'
      AND c.contype = 'u' AND c.convalidated AND NOT c.condeferrable
      AND NOT c.condeferred
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 2
      AND ARRAY(
        SELECT a.attname::TEXT
        FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
        JOIN pg_catalog.pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        ORDER BY k.ord
      ) = ARRAY['case_id', 'requirement_code']::TEXT[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class ix ON ix.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = ix.relam
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = i.indrelid AND a.attname = 'request_idempotency_key'
    JOIN pg_catalog.pg_opclass opc ON opc.oid = i.indclass[0]
    JOIN pg_catalog.pg_collation col ON col.oid = i.indcollation[0]
    WHERE i.indexrelid = 'public.idx_solo_plus_case_events_review_request_intent'::regclass
      AND i.indrelid = 'public.solo_plus_case_events'::regclass
      AND am.amname = 'btree' AND i.indisunique AND i.indisvalid
      AND i.indisready AND i.indislive AND NOT i.indisprimary
      AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indexprs IS NULL
      AND a.atttypid = 'text'::regtype AND a.attcollation = col.oid
      AND col.collnamespace = 'pg_catalog'::regnamespace
      AND col.collname = 'default'
      AND opc.opcnamespace = 'pg_catalog'::regnamespace
      AND opc.opcname = 'text_ops' AND opc.opcdefault
      AND opc.opcintype = 'text'::regtype AND opc.opcmethod = ix.relam
      AND ARRAY(
        SELECT key_attribute.attname::TEXT
        FROM unnest(i.indkey::SMALLINT[]) WITH ORDINALITY k(attnum, ord)
        JOIN pg_catalog.pg_attribute key_attribute
          ON key_attribute.attrelid = i.indrelid
         AND key_attribute.attnum = k.attnum
        ORDER BY k.ord
      ) = ARRAY['request_idempotency_key']::TEXT[]
      AND regexp_replace(
        btrim(pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)),
        '[[:space:]]+', ' ', 'g'
      ) = $predicate$((request_idempotency_key IS NOT NULL) AND (event_type = ANY (ARRAY['case_review_requested_more_information'::text, 'case_approved'::text, 'case_rejected'::text, 'case_reopened'::text])))$predicate$
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: exact uniqueness drift';
  END IF;

  -- An existing same-name guard/trigger is never overwritten without a
  -- reviewed hash/identity. On first apply both triggers must be absent.
  IF to_regprocedure('public.phase2b_approve_child_version_guard_v1()') IS NOT NULL
     AND md5(replace(replace(
       (SELECT prosrc FROM pg_catalog.pg_proc
        WHERE oid = to_regprocedure('public.phase2b_approve_child_version_guard_v1()')::OID),
       E'\r\n', E'\n'), E'\r', E'\n')) <> '44b875480dccc0be4fdc8c8b09b107a5' THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: child guard drift';
  END IF;
  IF to_regprocedure('public.phase2b_approve_case_link_guard_v1()') IS NOT NULL
     AND md5(replace(replace(
       (SELECT prosrc FROM pg_catalog.pg_proc
        WHERE oid = to_regprocedure('public.phase2b_approve_case_link_guard_v1()')::OID),
       E'\r\n', E'\n'), E'\r', E'\n')) <> 'e4f9dcec38dbcdcc9848dcadcb360dbe' THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: case guard drift';
  END IF;
  FOREACH v_guard_name IN ARRAY ARRAY[
    'phase2b_approve_child_version_guard_v1',
    'phase2b_approve_case_link_guard_v1'
  ] LOOP
    IF to_regprocedure(format('public.%I()', v_guard_name)) IS NOT NULL THEN
      SELECT * INTO STRICT v_guard FROM pg_catalog.pg_proc
      WHERE oid = to_regprocedure(format('public.%I()', v_guard_name))::OID;
      IF NOT v_guard.prosecdef
         OR v_guard.proowner IS DISTINCT FROM to_regrole(current_user)::OID
         OR v_guard.prorettype <> 'trigger'::regtype
         OR v_guard.pronargs <> 0 OR v_guard.proretset OR v_guard.proisstrict
         OR v_guard.prokind <> 'f' OR v_guard.provolatile <> 'v'
         OR v_guard.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
         OR COALESCE(array_length(v_guard.proconfig, 1), 0) <> 1
         OR replace(v_guard.proconfig[1], ' ', '') IS DISTINCT FROM 'search_path=public,pg_temp'
         OR EXISTS (
           SELECT 1 FROM aclexplode(COALESCE(v_guard.proacl, acldefault('f', v_guard.proowner))) acl
           WHERE acl.privilege_type = 'EXECUTE' AND acl.grantee <> v_guard.proowner
         ) THEN
        RAISE EXCEPTION 'Phase 2B approve success blocked: guard security drift';
      END IF;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgname IN (
      'trg_phase2b_approve_payment_version',
      'trg_phase2b_approve_payment_insert_version',
      'trg_phase2b_approve_payment_delete_version',
      'trg_phase2b_approve_requirement_version',
      'trg_phase2b_approve_requirement_insert_version',
      'trg_phase2b_approve_requirement_delete_version',
      'trg_phase2b_approve_case_link_version'
    )
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('trg_phase2b_approve_payment_version', 'public.payment_records'::regclass, 16,
           'old_rows', 'new_rows',
           to_regprocedure('public.phase2b_approve_child_version_guard_v1()')::OID),
          ('trg_phase2b_approve_payment_insert_version', 'public.payment_records'::regclass, 4,
           NULL::TEXT, 'new_rows',
           to_regprocedure('public.phase2b_approve_child_version_guard_v1()')::OID),
          ('trg_phase2b_approve_payment_delete_version', 'public.payment_records'::regclass, 8,
           'old_rows', NULL::TEXT,
           to_regprocedure('public.phase2b_approve_child_version_guard_v1()')::OID),
          ('trg_phase2b_approve_requirement_version', 'public.solo_plus_case_requirements'::regclass, 16,
           'old_rows', 'new_rows',
           to_regprocedure('public.phase2b_approve_child_version_guard_v1()')::OID),
          ('trg_phase2b_approve_requirement_insert_version', 'public.solo_plus_case_requirements'::regclass, 4,
           NULL::TEXT, 'new_rows',
           to_regprocedure('public.phase2b_approve_child_version_guard_v1()')::OID),
          ('trg_phase2b_approve_requirement_delete_version', 'public.solo_plus_case_requirements'::regclass, 8,
           'old_rows', NULL::TEXT,
           to_regprocedure('public.phase2b_approve_child_version_guard_v1()')::OID),
          ('trg_phase2b_approve_case_link_version', 'public.solo_plus_cases'::regclass, 19,
           NULL::TEXT, NULL::TEXT,
           to_regprocedure('public.phase2b_approve_case_link_guard_v1()')::OID)
        ) expected(name, relation_id, trigger_type, old_table, new_table, function_id)
        WHERE t.tgname = expected.name
          AND t.tgrelid = expected.relation_id
          AND t.tgtype = expected.trigger_type
          AND t.tgfoid IS NOT DISTINCT FROM expected.function_id
          AND t.tgoldtable::TEXT IS NOT DISTINCT FROM expected.old_table
          AND t.tgnewtable::TEXT IS NOT DISTINCT FROM expected.new_table
          AND t.tgenabled = 'O' AND t.tgqual IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: child trigger drift';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger
      WHERE tgname IN (
        'trg_phase2b_approve_payment_version',
        'trg_phase2b_approve_payment_insert_version',
        'trg_phase2b_approve_payment_delete_version',
        'trg_phase2b_approve_requirement_version',
        'trg_phase2b_approve_requirement_insert_version',
        'trg_phase2b_approve_requirement_delete_version',
        'trg_phase2b_approve_case_link_version'
      )) NOT IN (0, 7) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: partial child trigger set';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgrelid IN (
        'public.solo_plus_cases'::regclass,
        'public.solo_plus_case_requirements'::regclass,
        'public.solo_plus_case_events'::regclass,
        'public.payment_records'::regclass
      )
      AND t.tgname NOT IN (
        'trg_solo_plus_cases_updated_at',
        'trg_solo_plus_case_requirements_updated_at',
        'trg_payment_records_updated_at',
        'trg_phase2b_approve_payment_version',
        'trg_phase2b_approve_payment_insert_version',
        'trg_phase2b_approve_payment_delete_version',
        'trg_phase2b_approve_requirement_version',
        'trg_phase2b_approve_requirement_insert_version',
        'trg_phase2b_approve_requirement_delete_version',
        'trg_phase2b_approve_case_link_version'
      )
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: unexpected writer trigger';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      WHERE (t.tgrelid, t.tgname) IN (
        ('public.solo_plus_cases'::regclass, 'trg_solo_plus_cases_updated_at'),
        ('public.solo_plus_case_requirements'::regclass, 'trg_solo_plus_case_requirements_updated_at'),
        ('public.payment_records'::regclass, 'trg_payment_records_updated_at')
      )
        AND NOT t.tgisinternal AND t.tgtype = 19 AND t.tgenabled = 'O'
        AND t.tgqual IS NULL
        AND t.tgfoid = to_regprocedure('public.touch_updated_at()')::OID) <> 3
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
       WHERE c.oid IN (
         'public.solo_plus_cases'::regclass,
         'public.solo_plus_case_requirements'::regclass,
         'public.solo_plus_case_events'::regclass,
         'public.payment_records'::regclass
       )
         AND (c.relkind <> 'r' OR NOT c.relrowsecurity OR c.relforcerowsecurity)
     )
     OR (SELECT count(*) FROM pg_catalog.pg_class c
         WHERE c.oid IN (
           'public.solo_plus_cases'::regclass,
           'public.solo_plus_case_requirements'::regclass,
           'public.solo_plus_case_events'::regclass,
           'public.payment_records'::regclass
         )) <> 4 THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: trigger or RLS drift';
  END IF;

  -- Recheck the exact table shape that the success writer and its child
  -- triggers read. The predecessor may have been applied earlier; its catalog
  -- assertions do not freeze later schema or privilege changes.
  IF EXISTS (
    WITH expected(table_name, column_name, type_name, required_not_null) AS (
      VALUES
        ('solo_plus_cases', 'id', 'uuid', true),
        ('solo_plus_cases', 'merchant_id', 'uuid', false),
        ('solo_plus_cases', 'onboarding_session_id', 'uuid', false),
        ('solo_plus_cases', 'flow_origin', 'text', true),
        ('solo_plus_cases', 'source_plan', 'text', false),
        ('solo_plus_cases', 'case_status', 'text', true),
        ('solo_plus_cases', 'payment_status', 'text', true),
        ('solo_plus_cases', 'refund_status', 'text', true),
        ('solo_plus_cases', 'payment_record_id', 'uuid', false),
        ('solo_plus_cases', 'expected_amount', 'numeric(18,2)', true),
        ('solo_plus_cases', 'payment_currency', 'character varying(10)', true),
        ('solo_plus_cases', 'requirements_policy_version', 'text', true),
        ('solo_plus_cases', 'activation_idempotency_key', 'text', false),
        ('solo_plus_cases', 'refund_idempotency_key', 'text', false),
        ('solo_plus_cases', 'approved_at', 'timestamp with time zone', false),
        ('solo_plus_cases', 'approved_by_admin_id', 'uuid', false),
        ('solo_plus_cases', 'rejected_at', 'timestamp with time zone', false),
        ('solo_plus_cases', 'reopened_at', 'timestamp with time zone', false),
        ('solo_plus_cases', 'row_version', 'integer', true),
        ('solo_plus_cases', 'audit_metadata', 'jsonb', true),
        ('solo_plus_cases', 'updated_at', 'timestamp with time zone', true),
        ('payment_records', 'id', 'uuid', true),
        ('payment_records', 'solo_plus_case_id', 'uuid', false),
        ('payment_records', 'onboarding_session_id', 'uuid', false),
        ('payment_records', 'merchant_id', 'uuid', false),
        ('payment_records', 'payment_status', 'character varying(50)', true),
        ('payment_records', 'payment_purpose', 'character varying(50)', true),
        ('payment_records', 'amount_paid', 'numeric(18,2)', true),
        ('payment_records', 'expected_amount', 'numeric(18,2)', false),
        ('payment_records', 'currency', 'character varying(10)', true),
        ('payment_records', 'provider_name', 'character varying(50)', false),
        ('payment_records', 'provider_reference', 'character varying(255)', false),
        ('payment_records', 'metadata', 'jsonb', true),
        ('payment_records', 'updated_at', 'timestamp with time zone', true),
        ('solo_plus_case_requirements', 'id', 'uuid', true),
        ('solo_plus_case_requirements', 'case_id', 'uuid', true),
        ('solo_plus_case_requirements', 'requirement_code', 'text', true),
        ('solo_plus_case_requirements', 'requirement_state', 'text', true),
        ('solo_plus_case_requirements', 'evidence_source_type', 'text', false),
        ('solo_plus_case_requirements', 'evidence_source_id', 'uuid', false),
        ('solo_plus_case_requirements', 'completed_at', 'timestamp with time zone', false),
        ('solo_plus_case_requirements', 'provider_name', 'text', false),
        ('solo_plus_case_requirements', 'provider_reference', 'text', false),
        ('solo_plus_case_requirements', 'metadata', 'jsonb', true),
        ('solo_plus_case_requirements', 'updated_at', 'timestamp with time zone', true),
        ('solo_plus_case_events', 'id', 'uuid', true),
        ('solo_plus_case_events', 'case_id', 'uuid', true),
        ('solo_plus_case_events', 'event_type', 'text', true),
        ('solo_plus_case_events', 'request_idempotency_key', 'text', false),
        ('solo_plus_case_events', 'previous_state', 'jsonb', true),
        ('solo_plus_case_events', 'new_state', 'jsonb', true),
        ('solo_plus_case_events', 'actor_type', 'text', true),
        ('solo_plus_case_events', 'actor_id', 'uuid', false),
        ('solo_plus_case_events', 'reason', 'text', false),
        ('solo_plus_case_events', 'policy_version', 'text', true),
        ('solo_plus_case_events', 'created_at', 'timestamp with time zone', true)
    )
    SELECT 1 FROM expected e
    LEFT JOIN pg_catalog.pg_class t ON t.oid = format('public.%I', e.table_name)::regclass
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
      AND a.attname = e.column_name AND a.attnum > 0 AND NOT a.attisdropped
    WHERE a.attnum IS NULL
       OR pg_catalog.format_type(a.atttypid, a.atttypmod) IS DISTINCT FROM e.type_name
       OR a.attnotnull IS DISTINCT FROM e.required_not_null
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.solo_plus_case_events'::regclass
      AND a.attname = 'id' AND a.atthasdef
      AND pg_catalog.pg_get_expr(d.adbin, d.adrelid, false) = 'gen_random_uuid()'
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: prerequisite column or event default drift';
  END IF;

  IF EXISTS (
    WITH expected(table_name, constraint_name, local_columns, target_table,
                  target_columns, delete_action) AS (
      VALUES
        ('solo_plus_cases', 'solo_plus_cases_payment_record_id_fkey',
          ARRAY['payment_record_id']::TEXT[], 'payment_records', ARRAY['id']::TEXT[], 'n'),
        ('solo_plus_case_requirements', 'solo_plus_case_requirements_case_id_fkey',
          ARRAY['case_id']::TEXT[], 'solo_plus_cases', ARRAY['id']::TEXT[], 'c'),
        ('solo_plus_case_events', 'solo_plus_case_events_case_id_fkey',
          ARRAY['case_id']::TEXT[], 'solo_plus_cases', ARRAY['id']::TEXT[], 'r'),
        ('payment_records', 'payment_records_solo_plus_case_id_fkey',
          ARRAY['solo_plus_case_id']::TEXT[], 'solo_plus_cases', ARRAY['id']::TEXT[], 'n')
    )
    SELECT 1 FROM expected e
    JOIN pg_catalog.pg_class t ON t.oid = format('public.%I', e.table_name)::regclass
    LEFT JOIN pg_catalog.pg_constraint c ON c.conrelid = t.oid AND c.conname = e.constraint_name
    WHERE c.oid IS NULL OR c.contype <> 'f' OR c.convalidated IS NOT TRUE
       OR c.confrelid IS DISTINCT FROM format('public.%I', e.target_table)::regclass
       OR c.confupdtype::TEXT <> 'a' OR c.confdeltype::TEXT <> e.delete_action
       OR c.confmatchtype::TEXT <> 's' OR c.condeferrable OR c.condeferred
       OR ARRAY(SELECT a.attname::TEXT FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                ORDER BY k.ord) IS DISTINCT FROM e.local_columns
       OR ARRAY(SELECT a.attname::TEXT FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
                ORDER BY k.ord) IS DISTINCT FROM e.target_columns
  ) OR EXISTS (
    WITH expected(table_name, constraint_name, constraint_type, key_columns) AS (
      VALUES
        ('solo_plus_cases', 'solo_plus_cases_pkey', 'p', ARRAY['id']::TEXT[]),
        ('solo_plus_case_requirements', 'solo_plus_case_requirements_pkey', 'p', ARRAY['id']::TEXT[]),
        ('solo_plus_case_requirements', 'solo_plus_case_requirements_unique_case_code', 'u', ARRAY['case_id', 'requirement_code']::TEXT[]),
        ('solo_plus_case_events', 'solo_plus_case_events_pkey', 'p', ARRAY['id']::TEXT[]),
        ('payment_records', 'payment_records_pkey', 'p', ARRAY['id']::TEXT[])
    )
    SELECT 1 FROM expected e
    JOIN pg_catalog.pg_class t ON t.oid = format('public.%I', e.table_name)::regclass
    LEFT JOIN pg_catalog.pg_constraint c ON c.conrelid = t.oid AND c.conname = e.constraint_name
    LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.conindid
    WHERE c.oid IS NULL OR c.contype::TEXT <> e.constraint_type
       OR c.convalidated IS NOT TRUE OR c.condeferrable OR c.condeferred
       OR i.indexrelid IS NULL OR i.indisunique IS NOT TRUE
       OR i.indisvalid IS NOT TRUE OR i.indisready IS NOT TRUE OR i.indislive IS NOT TRUE
       OR i.indpred IS NOT NULL OR i.indexprs IS NOT NULL
       OR i.indnkeyatts <> cardinality(e.key_columns)
       OR ARRAY(SELECT a.attname::TEXT FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
                JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                ORDER BY k.ord) IS DISTINCT FROM e.key_columns
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: key or foreign-key semantic drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.solo_plus_cases'::regclass
      AND c.conname = 'solo_plus_cases_case_status_check'
      AND c.contype = 'c' AND c.convalidated
      AND regexp_replace(btrim(pg_catalog.pg_get_expr(c.conbin, c.conrelid, false)), '[[:space:]]+', ' ', 'g')
          = $check$(case_status = ANY (ARRAY['draft'::text, 'awaiting_payment'::text, 'verification_pending'::text, 'manual_review'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text]))$check$
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.solo_plus_cases'::regclass
      AND c.conname = 'solo_plus_cases_approved_consistency_chk'
      AND c.contype = 'c' AND c.convalidated
      AND regexp_replace(btrim(pg_catalog.pg_get_expr(c.conbin, c.conrelid, false)), '[[:space:]]+', ' ', 'g')
          = $check$((case_status <> 'approved'::text) OR ((payment_status = 'paid'::text) AND (approved_at IS NOT NULL) AND (approved_by_admin_id IS NOT NULL) AND (refund_status = 'none'::text)))$check$
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.payment_records'::regclass
      AND c.conname = 'payment_records_payment_status_check'
      AND c.contype = 'c' AND c.convalidated
      AND regexp_replace(btrim(pg_catalog.pg_get_expr(c.conbin, c.conrelid, false)), '[[:space:]]+', ' ', 'g')
          = $check$((payment_status)::text = ANY ((ARRAY['pending'::character varying, 'successful'::character varying, 'failed'::character varying, 'abandoned'::character varying, 'reversed'::character varying, 'refunded'::character varying])::text[]))$check$
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.solo_plus_case_requirements'::regclass
      AND c.conname = 'solo_plus_case_requirements_requirement_code_check'
      AND c.contype = 'c' AND c.convalidated
      AND regexp_replace(btrim(pg_catalog.pg_get_expr(c.conbin, c.conrelid, false)), '[[:space:]]+', ' ', 'g')
          = $check$(requirement_code = ANY (ARRAY['bvn'::text, 'selfie_liveness'::text, 'id_document'::text, 'proof_of_address'::text, 'settlement_account'::text, 'activity_profile'::text]))$check$
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.solo_plus_case_requirements'::regclass
      AND c.conname = 'solo_plus_case_requirements_requirement_state_check'
      AND c.contype = 'c' AND c.convalidated
      AND regexp_replace(btrim(pg_catalog.pg_get_expr(c.conbin, c.conrelid, false)), '[[:space:]]+', ' ', 'g')
          = $check$(requirement_state = ANY (ARRAY['not_started'::text, 'pending'::text, 'processing'::text, 'passed'::text, 'failed'::text, 'needs_review'::text, 'reused'::text, 'waived'::text]))$check$
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: approval CHECK expression drift';
  END IF;

  -- Approval's flow-specific linkage checks depend on both canonical CHECKs.
  -- Compare the full deparsed expressions; only formatting immediately inside
  -- parentheses and whitespace runs may differ. Quoted literals remain exact.
  IF EXISTS (
    WITH expected(constraint_name, check_expression) AS (
      VALUES
        ('solo_plus_cases_flow_origin_check',
          $check$(flow_origin = ANY (ARRAY['onboarding'::text, 'upgrade'::text]))$check$),
        ('solo_plus_cases_flow_ownership_chk',
          $check$(((flow_origin = 'onboarding'::text) AND (onboarding_session_id IS NOT NULL) AND (source_plan IS NULL)) OR ((flow_origin = 'upgrade'::text) AND (merchant_id IS NOT NULL) AND (onboarding_session_id IS NULL) AND (source_plan = 'solo_lite'::text)))$check$)
    )
    SELECT 1 FROM expected e
    LEFT JOIN pg_catalog.pg_constraint c
      ON c.conrelid = 'public.solo_plus_cases'::regclass
     AND c.conname = e.constraint_name
    WHERE c.oid IS NULL OR c.contype <> 'c' OR c.convalidated IS NOT TRUE
       OR ARRAY(
            SELECT (actual_literal.parts)[1]
            FROM pg_catalog.regexp_matches(
              pg_catalog.pg_get_expr(c.conbin, c.conrelid, false),
              $quoted$('([^']|'')*')$quoted$, 'g'
            ) AS actual_literal(parts)
          ) IS DISTINCT FROM ARRAY(
            SELECT (expected_literal.parts)[1]
            FROM pg_catalog.regexp_matches(
              e.check_expression, $quoted$('([^']|'')*')$quoted$, 'g'
            ) AS expected_literal(parts)
          )
       OR pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(
                btrim(pg_catalog.pg_get_expr(c.conbin, c.conrelid, false)),
                '[[:space:]]+', ' ', 'g'
              ), '[(][[:space:]]+', '(', 'g'
            ), '[[:space:]]+[)]', ')', 'g'
          ) IS DISTINCT FROM pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(
                btrim(e.check_expression), '[[:space:]]+', ' ', 'g'
              ), '[(][[:space:]]+', '(', 'g'
            ), '[[:space:]]+[)]', ')', 'g'
          )
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: flow CHECK expression drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class t
    CROSS JOIN LATERAL aclexplode(COALESCE(t.relacl, acldefault('r', t.relowner))) acl
    WHERE t.oid IN ('public.solo_plus_cases'::regclass,
                    'public.solo_plus_case_requirements'::regclass,
                    'public.payment_records'::regclass,
                    'public.solo_plus_case_events'::regclass)
      AND acl.grantee IN (0, to_regrole('anon')::OID, to_regrole('authenticated')::OID)
      AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) OR NOT has_table_privilege('service_role', 'public.solo_plus_cases', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.solo_plus_cases', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.solo_plus_case_requirements', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.payment_records', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.solo_plus_case_events', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.solo_plus_case_events', 'INSERT') THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: table grant drift';
  END IF;

  -- Use the predecessor's reviewed full-expression comparison. Quoted
  -- literals remain exact while only PostgreSQL's insignificant whitespace
  -- inside parentheses is normalized.
  v_expected_payment_policy := CASE
    WHEN to_regclass('public.merchant_team') IS NULL THEN
      $policy$((auth.role() = 'authenticated'::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = payment_records.merchant_id) AND (m.user_id = auth.uid()))))))$policy$
    ELSE
      $policy$((auth.role() = 'authenticated'::text) AND ((EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = payment_records.merchant_id) AND (m.user_id = auth.uid())))) OR (EXISTS (SELECT 1 FROM merchant_team mt WHERE ((mt.merchant_id = payment_records.merchant_id) AND (mt.user_id = auth.uid()) AND (COALESCE(mt.is_active, false) = true))))))$policy$
  END;
  IF EXISTS (
    WITH expected(table_name, policy_name, using_expression) AS (
      VALUES
        ('solo_plus_cases', 'merchant_read_solo_plus_cases',
          $policy$((auth.role() = 'authenticated'::text) AND (merchant_id IS NOT NULL) AND (EXISTS (SELECT 1 FROM merchants m WHERE ((m.id = solo_plus_cases.merchant_id) AND (m.user_id = auth.uid())))))$policy$),
        ('solo_plus_case_requirements', 'merchant_read_solo_plus_case_requirements',
          $policy$((auth.role() = 'authenticated'::text) AND (EXISTS (SELECT 1 FROM (solo_plus_cases c JOIN merchants m ON ((m.id = c.merchant_id))) WHERE ((c.id = solo_plus_case_requirements.case_id) AND (m.user_id = auth.uid())))))$policy$),
        ('payment_records', 'merchant_read_payment_records', v_expected_payment_policy)
    )
    SELECT 1 FROM expected e
    JOIN pg_catalog.pg_class t ON t.oid = format('public.%I', e.table_name)::regclass
    LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = t.oid AND p.polname = e.policy_name
    WHERE p.oid IS NULL OR p.polcmd <> 'r' OR p.polpermissive IS NOT TRUE
       OR p.polroles IS DISTINCT FROM ARRAY[0]::OID[]
       OR ARRAY(
            SELECT (actual_literal.parts)[1]
            FROM pg_catalog.regexp_matches(
              pg_catalog.pg_get_expr(p.polqual, p.polrelid, false),
              $quoted$('([^']|'')*')$quoted$, 'g'
            ) AS actual_literal(parts)
          ) IS DISTINCT FROM ARRAY(
            SELECT (expected_literal.parts)[1]
            FROM pg_catalog.regexp_matches(
              e.using_expression, $quoted$('([^']|'')*')$quoted$, 'g'
            ) AS expected_literal(parts)
          )
       OR pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(
                btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid, false)),
                '[[:space:]]+', ' ', 'g'
              ), '[(][[:space:]]+', '(', 'g'
            ), '[[:space:]]+[)]', ')', 'g'
          ) IS DISTINCT FROM pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(
                btrim(e.using_expression), '[[:space:]]+', ' ', 'g'
              ), '[(][[:space:]]+', '(', 'g'
            ), '[[:space:]]+[)]', ')', 'g'
          )
       OR p.polwithcheck IS NOT NULL
  ) OR (SELECT count(*) FROM pg_catalog.pg_policy p
        WHERE p.polrelid = 'public.payment_records'::regclass) <> 1
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_policy p
      WHERE p.polrelid IN ('public.solo_plus_cases'::regclass,
                           'public.solo_plus_case_requirements'::regclass,
                           'public.solo_plus_case_events'::regclass)
        AND (p.polcmd <> 'r'
             OR (p.polrelid = 'public.solo_plus_cases'::regclass
                 AND p.polname <> 'merchant_read_solo_plus_cases')
             OR (p.polrelid = 'public.solo_plus_case_requirements'::regclass
                 AND p.polname <> 'merchant_read_solo_plus_case_requirements')
             OR p.polrelid = 'public.solo_plus_case_events'::regclass)
    ) THEN
    RAISE EXCEPTION 'Phase 2B approve success blocked: policy role or expression drift';
  END IF;
END;
$$;

-- One AFTER STATEMENT trigger per operation sees all changed rows, locks each
-- affected case once, and advances its version once per firing. A mixed
-- INSERT ... ON CONFLICT DO UPDATE can fire both INSERT and UPDATE triggers.
-- A writer that reaches
-- this trigger after approval must roll back its entire child statement.
-- Approval uses NOWAIT child locks to avoid waiting behind payment-first RPCs.
CREATE OR REPLACE FUNCTION public.phase2b_approve_child_version_guard_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case_ids UUID[];
  v_case_id UUID;
  v_case public.solo_plus_cases%ROWTYPE;
BEGIN
  IF TG_LEVEL <> 'STATEMENT' OR TG_TABLE_SCHEMA <> 'public'
     OR TG_TABLE_NAME NOT IN ('payment_records', 'solo_plus_case_requirements')
     OR TG_OP NOT IN ('INSERT', 'UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Phase 2B approve child writer blocked: invalid trigger context';
  END IF;
  IF TG_TABLE_NAME = 'payment_records' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT ARRAY(
        SELECT DISTINCT c.id FROM public.solo_plus_cases c
        JOIN new_rows n ON c.payment_record_id = n.id
          OR (n.payment_status = 'successful' AND c.id = n.solo_plus_case_id)
          OR (n.payment_status = 'successful' AND n.payment_purpose = 'plan_subscription'
              AND c.flow_origin = 'onboarding'
              AND c.onboarding_session_id = n.onboarding_session_id)
        ORDER BY c.id
      ) INTO v_case_ids;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT ARRAY(
        SELECT DISTINCT c.id FROM public.solo_plus_cases c
        JOIN old_rows o ON c.payment_record_id = o.id
          OR (o.payment_status = 'successful' AND c.id = o.solo_plus_case_id)
          OR (o.payment_status = 'successful' AND o.payment_purpose = 'plan_subscription'
              AND c.flow_origin = 'onboarding'
              AND c.onboarding_session_id = o.onboarding_session_id)
        ORDER BY c.id
      ) INTO v_case_ids;
    ELSE
      IF (SELECT count(*) FROM old_rows) <>
         (SELECT count(*) FROM old_rows o JOIN new_rows n USING (id)) THEN
        RAISE EXCEPTION 'Phase 2B approve child writer blocked: payment identity changed';
      END IF;
      SELECT ARRAY(
        SELECT DISTINCT c.id FROM old_rows o
        JOIN new_rows n ON n.id = o.id
        JOIN public.solo_plus_cases c ON c.payment_record_id = o.id
          OR (o.payment_status = 'successful' AND c.id = o.solo_plus_case_id)
          OR (n.payment_status = 'successful' AND c.id = n.solo_plus_case_id)
          OR (c.flow_origin = 'onboarding'
              AND ((o.payment_status = 'successful' AND o.payment_purpose = 'plan_subscription'
                    AND c.onboarding_session_id = o.onboarding_session_id)
                OR (n.payment_status = 'successful' AND n.payment_purpose = 'plan_subscription'
                    AND c.onboarding_session_id = n.onboarding_session_id)))
        WHERE ROW(o.solo_plus_case_id, o.onboarding_session_id, o.payment_status,
                  o.payment_purpose, o.merchant_id, o.amount_paid,
                  o.expected_amount, o.currency, o.provider_name,
                  o.provider_reference, o.metadata)
          IS DISTINCT FROM ROW(n.solo_plus_case_id, n.onboarding_session_id,
                               n.payment_status, n.payment_purpose, n.merchant_id,
                               n.amount_paid, n.expected_amount, n.currency,
                               n.provider_name, n.provider_reference, n.metadata)
        ORDER BY c.id
      ) INTO v_case_ids;
    END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN
      SELECT ARRAY(SELECT DISTINCT case_id FROM new_rows ORDER BY case_id)
      INTO v_case_ids;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT ARRAY(SELECT DISTINCT case_id FROM old_rows ORDER BY case_id)
      INTO v_case_ids;
    ELSE
      IF (SELECT count(*) FROM old_rows) <>
         (SELECT count(*) FROM old_rows o JOIN new_rows n USING (id)) THEN
        RAISE EXCEPTION 'Phase 2B approve child writer blocked: requirement identity changed';
      END IF;
      SELECT ARRAY(
        SELECT DISTINCT affected.case_id
        FROM old_rows o JOIN new_rows n USING (id)
        CROSS JOIN LATERAL (VALUES (o.case_id), (n.case_id)) affected(case_id)
        WHERE ROW(o.case_id, o.requirement_code, o.requirement_state,
                  o.evidence_source_type, o.evidence_source_id, o.completed_at,
                  o.provider_name, o.provider_reference, o.metadata)
          IS DISTINCT FROM ROW(n.case_id, n.requirement_code, n.requirement_state,
                               n.evidence_source_type, n.evidence_source_id, n.completed_at,
                               n.provider_name, n.provider_reference, n.metadata)
        ORDER BY affected.case_id
      ) INTO v_case_ids;
    END IF;
  END IF;

  FOREACH v_case_id IN ARRAY v_case_ids LOOP
    SELECT * INTO v_case
    FROM public.solo_plus_cases
    WHERE id = v_case_id
    FOR UPDATE;
    IF v_case.audit_metadata ->> 'fixture_scope' = 'phase2b_approve_acceptance'
       AND v_case.audit_metadata ->> 'synthetic_approve_acceptance' = 'true' THEN
      IF v_case.case_status = 'approved' THEN
        RAISE EXCEPTION 'Phase 2B approve child writer blocked: approved case';
      END IF;
      IF v_case.payment_status = 'paid'
         AND v_case.case_status IN ('verification_pending', 'manual_review') THEN
        UPDATE public.solo_plus_cases
        SET row_version = row_version + 1, updated_at = now()
        WHERE id = v_case_id;
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.phase2b_approve_child_version_guard_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- Case-side linkage changes must advance the version too; direct edits after
-- approval cannot silently invalidate the reviewed payment snapshot.
CREATE OR REPLACE FUNCTION public.phase2b_approve_case_link_guard_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scoped BOOLEAN;
  v_eligibility_changed BOOLEAN;
  v_payment public.payment_records%ROWTYPE;
  v_qualifying_id UUID;
  v_duplicate_count INTEGER := 0;
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'solo_plus_cases'
     OR TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'Phase 2B approve case writer blocked: invalid trigger context';
  END IF;
  v_scoped :=
    COALESCE(
      OLD.audit_metadata ->> 'fixture_scope' = 'phase2b_approve_acceptance'
      AND OLD.audit_metadata ->> 'synthetic_approve_acceptance' = 'true', false)
    OR COALESCE(
      NEW.audit_metadata ->> 'fixture_scope' = 'phase2b_approve_acceptance'
      AND NEW.audit_metadata ->> 'synthetic_approve_acceptance' = 'true', false);
  IF NOT v_scoped THEN RETURN NEW; END IF;

  v_eligibility_changed :=
    OLD.payment_record_id IS DISTINCT FROM NEW.payment_record_id
    OR OLD.payment_status IS DISTINCT FROM NEW.payment_status
    OR OLD.payment_currency IS DISTINCT FROM NEW.payment_currency
    OR OLD.expected_amount IS DISTINCT FROM NEW.expected_amount
    OR OLD.merchant_id IS DISTINCT FROM NEW.merchant_id
    OR OLD.onboarding_session_id IS DISTINCT FROM NEW.onboarding_session_id
    OR OLD.flow_origin IS DISTINCT FROM NEW.flow_origin
    OR OLD.requirements_policy_version IS DISTINCT FROM NEW.requirements_policy_version
    OR OLD.audit_metadata IS DISTINCT FROM NEW.audit_metadata;
  IF OLD.payment_record_id IS DISTINCT FROM NEW.payment_record_id THEN
    IF OLD.payment_status = 'paid'
       OR OLD.case_status IN ('verification_pending', 'manual_review', 'approved') THEN
      RAISE EXCEPTION 'Phase 2B approve case writer blocked: paid payment relink';
    END IF;
  END IF;
  IF (OLD.payment_status = 'paid'
      OR OLD.case_status IN ('verification_pending', 'manual_review', 'approved'))
     AND (OLD.merchant_id IS DISTINCT FROM NEW.merchant_id
          OR OLD.flow_origin IS DISTINCT FROM NEW.flow_origin
          OR OLD.onboarding_session_id IS DISTINCT FROM NEW.onboarding_session_id
          OR OLD.source_plan IS DISTINCT FROM NEW.source_plan
          OR OLD.expected_amount IS DISTINCT FROM NEW.expected_amount
          OR OLD.payment_currency IS DISTINCT FROM NEW.payment_currency) THEN
    RAISE EXCEPTION 'Phase 2B approve case writer blocked: protected payment definition';
  END IF;
  IF OLD.payment_record_id IS DISTINCT FROM NEW.payment_record_id
     OR (NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid') THEN
    IF NEW.payment_record_id IS NULL THEN
      RAISE EXCEPTION 'Phase 2B approve case writer blocked: payment pointer missing';
    END IF;
    BEGIN
      SELECT * INTO v_payment FROM public.payment_records
      WHERE id = NEW.payment_record_id FOR SHARE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION 'Phase 2B approve case writer blocked: payment lock conflict';
    END;
    IF v_payment.id IS NULL
       OR NEW.flow_origin NOT IN ('onboarding', 'upgrade')
       OR (NEW.flow_origin = 'onboarding'
           AND (NEW.onboarding_session_id IS NULL OR NEW.source_plan IS NOT NULL))
       OR (NEW.flow_origin = 'upgrade'
           AND (NEW.merchant_id IS NULL
                OR NEW.onboarding_session_id IS NOT NULL
                OR NEW.source_plan IS DISTINCT FROM 'solo_lite'))
       OR v_payment.solo_plus_case_id IS DISTINCT FROM NEW.id
       OR v_payment.merchant_id IS DISTINCT FROM NEW.merchant_id
       OR v_payment.payment_purpose IS DISTINCT FROM
          (CASE WHEN NEW.flow_origin = 'upgrade' THEN 'plan_upgrade' ELSE 'plan_subscription' END)
       OR (NEW.flow_origin = 'onboarding'
           AND v_payment.onboarding_session_id IS DISTINCT FROM NEW.onboarding_session_id)
       OR (NEW.flow_origin = 'upgrade' AND v_payment.onboarding_session_id IS NOT NULL)
       OR v_payment.currency IS DISTINCT FROM NEW.payment_currency
       OR v_payment.expected_amount IS DISTINCT FROM NEW.expected_amount
       OR (NEW.payment_status = 'paid'
           AND (v_payment.payment_status IS DISTINCT FROM 'successful'
                OR v_payment.amount_paid IS DISTINCT FROM NEW.expected_amount)) THEN
      RAISE EXCEPTION 'Phase 2B approve case writer blocked: payment linkage';
    END IF;
    IF NEW.payment_status = 'paid' THEN
      BEGIN
        FOR v_qualifying_id IN
          SELECT p.id FROM public.payment_records p
          WHERE p.payment_status = 'successful'
            AND (p.solo_plus_case_id = NEW.id
                 OR (NEW.flow_origin = 'onboarding'
                     AND p.onboarding_session_id = NEW.onboarding_session_id
                     AND p.payment_purpose = 'plan_subscription'))
          ORDER BY p.id FOR SHARE NOWAIT
        LOOP
          v_duplicate_count := v_duplicate_count + 1;
          IF v_qualifying_id IS DISTINCT FROM v_payment.id THEN
            RAISE EXCEPTION 'Phase 2B approve case writer blocked: ambiguous successful payment';
          END IF;
        END LOOP;
      EXCEPTION WHEN lock_not_available THEN
        RAISE EXCEPTION 'Phase 2B approve case writer blocked: payment lock conflict';
      END;
      IF v_duplicate_count <> 1 THEN
        RAISE EXCEPTION 'Phase 2B approve case writer blocked: ambiguous successful payment';
      END IF;
    END IF;
  END IF;
  IF OLD.case_status = 'approved'
     AND (v_eligibility_changed
          OR NEW.case_status IS DISTINCT FROM OLD.case_status
          OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
          OR NEW.approved_by_admin_id IS DISTINCT FROM OLD.approved_by_admin_id) THEN
    RAISE EXCEPTION 'Phase 2B approve case writer blocked: approved eligibility';
  END IF;
  IF v_eligibility_changed AND NEW.row_version <= OLD.row_version THEN
    RAISE EXCEPTION 'Phase 2B approve case writer blocked: version required';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.phase2b_approve_case_link_guard_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.payment_records'::regclass
      AND tgname = 'trg_phase2b_approve_payment_version'
  ) THEN
    CREATE TRIGGER trg_phase2b_approve_payment_version
    AFTER UPDATE ON public.payment_records
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.phase2b_approve_child_version_guard_v1();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.payment_records'::regclass
      AND tgname = 'trg_phase2b_approve_payment_insert_version'
  ) THEN
    CREATE TRIGGER trg_phase2b_approve_payment_insert_version
    AFTER INSERT ON public.payment_records
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.phase2b_approve_child_version_guard_v1();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.payment_records'::regclass
      AND tgname = 'trg_phase2b_approve_payment_delete_version'
  ) THEN
    CREATE TRIGGER trg_phase2b_approve_payment_delete_version
    AFTER DELETE ON public.payment_records
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.phase2b_approve_child_version_guard_v1();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.solo_plus_case_requirements'::regclass
      AND tgname = 'trg_phase2b_approve_requirement_version'
  ) THEN
    CREATE TRIGGER trg_phase2b_approve_requirement_version
    AFTER UPDATE ON public.solo_plus_case_requirements
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.phase2b_approve_child_version_guard_v1();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.solo_plus_case_requirements'::regclass
      AND tgname = 'trg_phase2b_approve_requirement_insert_version'
  ) THEN
    CREATE TRIGGER trg_phase2b_approve_requirement_insert_version
    AFTER INSERT ON public.solo_plus_case_requirements
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.phase2b_approve_child_version_guard_v1();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.solo_plus_case_requirements'::regclass
      AND tgname = 'trg_phase2b_approve_requirement_delete_version'
  ) THEN
    CREATE TRIGGER trg_phase2b_approve_requirement_delete_version
    AFTER DELETE ON public.solo_plus_case_requirements
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT EXECUTE FUNCTION public.phase2b_approve_child_version_guard_v1();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.solo_plus_cases'::regclass
      AND tgname = 'trg_phase2b_approve_case_link_version'
  ) THEN
    CREATE TRIGGER trg_phase2b_approve_case_link_version
    BEFORE UPDATE ON public.solo_plus_cases
    FOR EACH ROW EXECUTE FUNCTION public.phase2b_approve_case_link_guard_v1();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_solo_plus_case_approve_atomic_v1(
  p_case_id UUID,
  p_expected_row_version BIGINT,
  p_request_idempotency_key TEXT,
  p_decision TEXT,
  p_reviewer_admin_id UUID,
  p_reason TEXT,
  p_policy_version TEXT,
  p_expected_fixture_run_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_previous_case public.solo_plus_cases%ROWTYPE;
  v_payment public.payment_records%ROWTYPE;
  v_qualifying_payment public.payment_records%ROWTYPE;
  v_requirement public.solo_plus_case_requirements%ROWTYPE;
  v_existing_event public.solo_plus_case_events%ROWTYPE;
  v_inserted_event public.solo_plus_case_events%ROWTYPE;
  v_requirement_code TEXT;
  v_requirement_count INTEGER;
  v_payment_count INTEGER := 0;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_case_id IS NULL OR p_expected_row_version IS NULL
     OR p_expected_row_version < 0
     OR p_request_idempotency_key IS NULL
     OR btrim(p_request_idempotency_key) = ''
     OR p_reviewer_admin_id IS NULL
     OR p_decision IS DISTINCT FROM 'approve'
     OR p_expected_fixture_run_id IS NULL
     OR p_expected_fixture_run_id !~ '^phase2b-approve-[0-9]{8}-[a-z0-9]{3,16}$'
     OR p_policy_version IS NULL OR btrim(p_policy_version) = ''
     OR char_length(COALESCE(p_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'Solo Plus atomic approve input is invalid';
  END IF;

  SELECT * INTO v_case FROM public.solo_plus_cases
  WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'not_found'); END IF;

  -- Review-intent keys are globally unique across review decisions. Replay
  -- precedes the version check because a successful write increments it.
  SELECT * INTO v_existing_event
  FROM public.solo_plus_case_events
  WHERE request_idempotency_key = p_request_idempotency_key
    AND event_type IN (
      'case_review_requested_more_information', 'case_approved',
      'case_rejected', 'case_reopened'
    )
  ORDER BY created_at, id LIMIT 1;
  IF FOUND THEN
    IF v_existing_event.case_id = p_case_id
       AND v_existing_event.event_type = 'case_approved'
       AND v_existing_event.actor_type = 'admin'
       AND v_existing_event.actor_id IS NOT DISTINCT FROM p_reviewer_admin_id
       AND v_existing_event.reason IS NOT DISTINCT FROM v_reason
       AND v_existing_event.policy_version = p_policy_version
       AND v_existing_event.previous_state ->> 'rowVersion' = p_expected_row_version::text
       AND v_case.case_status = 'approved'
       AND v_case.audit_metadata ->> 'fixture_scope' = 'phase2b_approve_acceptance'
       AND v_case.audit_metadata ->> 'fixture_run_id' = p_expected_fixture_run_id
       AND v_case.audit_metadata ->> 'synthetic_approve_acceptance' = 'true'
       AND v_case.requirements_policy_version = p_policy_version
       AND v_case.approved_by_admin_id IS NOT DISTINCT FROM p_reviewer_admin_id THEN
      RETURN jsonb_build_object(
        'kind', 'idempotent_replay', 'case', to_jsonb(v_case),
        'event', to_jsonb(v_existing_event));
    END IF;
    RETURN jsonb_build_object('kind', 'idempotency_conflict', 'case', to_jsonb(v_case));
  END IF;

  IF v_case.row_version::BIGINT <> p_expected_row_version THEN
    RETURN jsonb_build_object('kind', 'version_conflict', 'case', to_jsonb(v_case));
  END IF;
  IF v_case.audit_metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
     OR v_case.audit_metadata ->> 'fixture_run_id' IS DISTINCT FROM p_expected_fixture_run_id
     OR v_case.audit_metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
     OR v_case.requirements_policy_version IS DISTINCT FROM p_policy_version THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END IF;
  IF v_case.case_status <> 'manual_review'
     OR v_case.payment_status <> 'paid'
     OR v_case.flow_origin NOT IN ('onboarding', 'upgrade')
     OR (v_case.flow_origin = 'onboarding'
         AND (v_case.onboarding_session_id IS NULL OR v_case.source_plan IS NOT NULL))
     OR (v_case.flow_origin = 'upgrade'
         AND (v_case.merchant_id IS NULL
              OR v_case.onboarding_session_id IS NOT NULL
              OR v_case.source_plan IS DISTINCT FROM 'solo_lite'))
     OR v_case.payment_record_id IS NULL
     OR v_case.refund_status <> 'none'
     OR v_case.activation_idempotency_key IS NOT NULL
     OR v_case.refund_idempotency_key IS NOT NULL
     OR v_case.approved_at IS NOT NULL OR v_case.rejected_at IS NOT NULL
     OR v_case.reopened_at IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.solo_plus_case_events e
       WHERE e.case_id = p_case_id
         AND e.event_type IN (
           'case_review_requested_more_information', 'case_approved',
           'case_rejected', 'case_reopened', 'case_activated'
         )
     ) THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END IF;

  BEGIN
    SELECT * INTO v_payment FROM public.payment_records
    WHERE id = v_case.payment_record_id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END;
  IF v_payment.id IS NULL
     OR v_payment.solo_plus_case_id IS DISTINCT FROM p_case_id
     OR v_payment.merchant_id IS DISTINCT FROM v_case.merchant_id
     OR (v_case.flow_origin = 'onboarding'
         AND v_payment.onboarding_session_id IS DISTINCT FROM v_case.onboarding_session_id)
     OR (v_case.flow_origin = 'upgrade'
         AND v_payment.onboarding_session_id IS NOT NULL)
     OR v_payment.payment_status IS DISTINCT FROM 'successful'
     OR v_payment.amount_paid IS DISTINCT FROM v_case.expected_amount
     OR v_payment.expected_amount IS DISTINCT FROM v_case.expected_amount
     OR v_payment.currency IS DISTINCT FROM v_case.payment_currency
     OR v_payment.payment_purpose IS DISTINCT FROM
        (CASE WHEN v_case.flow_origin = 'upgrade' THEN 'plan_upgrade' ELSE 'plan_subscription' END)
     OR v_payment.metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
     OR v_payment.metadata ->> 'fixture_run_id' IS DISTINCT FROM p_expected_fixture_run_id
     OR v_payment.metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
     OR v_payment.provider_name IS NOT NULL
     OR v_payment.provider_reference IS NOT NULL THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END IF;

  -- Lock every successful payment linked to this case, including wrong-purpose
  -- rows, and any same-onboarding-session subscription success. The parent
  -- trigger prevents a concurrent qualifying insert from becoming a phantom.
  BEGIN
    FOR v_qualifying_payment IN
      SELECT * FROM public.payment_records
      WHERE payment_status = 'successful'
        AND (
          solo_plus_case_id = p_case_id
          OR (v_case.flow_origin = 'onboarding'
              AND onboarding_session_id = v_case.onboarding_session_id
              AND payment_purpose = 'plan_subscription')
        )
      ORDER BY id FOR SHARE NOWAIT
    LOOP
      v_payment_count := v_payment_count + 1;
      IF v_qualifying_payment.id IS DISTINCT FROM v_payment.id THEN
        RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
      END IF;
    END LOOP;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END;
  IF v_payment_count <> 1 THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END IF;

  FOREACH v_requirement_code IN ARRAY ARRAY[
    'activity_profile', 'bvn', 'id_document', 'proof_of_address',
    'selfie_liveness', 'settlement_account'
  ] LOOP
    BEGIN
      SELECT * INTO v_requirement
      FROM public.solo_plus_case_requirements
      WHERE case_id = p_case_id AND requirement_code = v_requirement_code
      FOR SHARE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
    END;
    IF v_requirement.id IS NULL
       OR v_requirement.requirement_state IS DISTINCT FROM 'passed'
       OR v_requirement.evidence_source_type IS DISTINCT FROM 'manual_submission'
       OR v_requirement.evidence_source_id IS NULL
       OR v_requirement.completed_at IS NULL
       OR v_requirement.metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
       OR v_requirement.metadata ->> 'fixture_run_id' IS DISTINCT FROM p_expected_fixture_run_id
       OR v_requirement.metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
       OR v_requirement.provider_name IS NOT NULL
       OR v_requirement.provider_reference IS NOT NULL THEN
      RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
    END IF;
  END LOOP;
  SELECT count(*)::INTEGER INTO v_requirement_count
  FROM public.solo_plus_case_requirements WHERE case_id = p_case_id;
  IF v_requirement_count <> 6 THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END IF;

  v_previous_case := v_case;
  -- A caught uniqueness error rolls this whole subblock back, including the
  -- case update. No approved case can commit without the event.
  BEGIN
    UPDATE public.solo_plus_cases
    SET case_status = 'approved', approved_at = v_now,
        approved_by_admin_id = p_reviewer_admin_id,
        row_version = row_version + 1, updated_at = v_now
    WHERE id = p_case_id AND row_version::BIGINT = p_expected_row_version
      AND case_status = 'manual_review'
    RETURNING * INTO v_case;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('kind', 'version_conflict', 'case', to_jsonb(v_previous_case));
    END IF;

    INSERT INTO public.solo_plus_case_events (
      case_id, event_type, previous_state, new_state, actor_type, actor_id,
      request_idempotency_key, reason, policy_version, created_at
    ) VALUES (
      p_case_id, 'case_approved',
      jsonb_build_object(
        'caseStatus', v_previous_case.case_status,
        'refundStatus', v_previous_case.refund_status,
        'approvedAt', v_previous_case.approved_at,
        'approvedByAdminId', v_previous_case.approved_by_admin_id,
        'rowVersion', p_expected_row_version
      ),
      jsonb_build_object(
        'caseStatus', v_case.case_status,
        'refundStatus', v_case.refund_status,
        'approvedAt', v_case.approved_at,
        'approvedByAdminId', v_case.approved_by_admin_id,
        'rowVersion', v_case.row_version
      ),
      'admin', p_reviewer_admin_id, p_request_idempotency_key,
      v_reason, p_policy_version, v_now
    ) RETURNING * INTO v_inserted_event;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('kind', 'idempotency_conflict', 'case', to_jsonb(v_previous_case));
  END;
  RETURN jsonb_build_object(
    'kind', 'updated', 'case', to_jsonb(v_case), 'event', to_jsonb(v_inserted_event));
END;
$$;

REVOKE ALL ON FUNCTION public.review_solo_plus_case_approve_atomic_v1(
  UUID, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_approve_atomic_v1(
  UUID, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT
) TO service_role;

DO $$
DECLARE
  v_approve OID := to_regprocedure('public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)')::OID;
  v_guard OID := to_regprocedure('public.phase2b_approve_child_version_guard_v1()')::OID;
  v_case_guard OID := to_regprocedure('public.phase2b_approve_case_link_guard_v1()')::OID;
BEGIN
  IF md5(replace(replace(
       (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_approve),
       E'\r\n', E'\n'), E'\r', E'\n')) <> '5cc81f443c678a15bed43de6df472077'
     OR md5(replace(replace(
       (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_guard),
       E'\r\n', E'\n'), E'\r', E'\n')) <> '44b875480dccc0be4fdc8c8b09b107a5'
     OR md5(replace(replace(
       (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_case_guard),
       E'\r\n', E'\n'), E'\r', E'\n')) <> 'e4f9dcec38dbcdcc9848dcadcb360dbe'
     OR md5(replace(replace(
       (SELECT prosrc FROM pg_catalog.pg_proc
        WHERE oid = to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::OID),
       E'\r\n', E'\n'), E'\r', E'\n')) <> '27710a7819d8413aa8764d8762a6a0ca'
     OR (SELECT count(*) FROM pg_catalog.pg_trigger t
         JOIN (VALUES
           ('trg_phase2b_approve_payment_version', 'public.payment_records'::regclass, 16, 'old_rows', 'new_rows'),
           ('trg_phase2b_approve_payment_insert_version', 'public.payment_records'::regclass, 4, NULL::TEXT, 'new_rows'),
           ('trg_phase2b_approve_payment_delete_version', 'public.payment_records'::regclass, 8, 'old_rows', NULL::TEXT),
           ('trg_phase2b_approve_requirement_version', 'public.solo_plus_case_requirements'::regclass, 16, 'old_rows', 'new_rows'),
           ('trg_phase2b_approve_requirement_insert_version', 'public.solo_plus_case_requirements'::regclass, 4, NULL::TEXT, 'new_rows'),
           ('trg_phase2b_approve_requirement_delete_version', 'public.solo_plus_case_requirements'::regclass, 8, 'old_rows', NULL::TEXT)
         ) expected(name, relation_id, trigger_type, old_table, new_table)
           ON t.tgname = expected.name AND t.tgrelid = expected.relation_id
         WHERE t.tgfoid = v_guard AND NOT t.tgisinternal
           AND t.tgenabled = 'O' AND t.tgtype = expected.trigger_type
           AND t.tgoldtable::TEXT IS NOT DISTINCT FROM expected.old_table
           AND t.tgnewtable::TEXT IS NOT DISTINCT FROM expected.new_table
           AND t.tgqual IS NULL) <> 6
     OR (SELECT count(*) FROM pg_catalog.pg_trigger
         WHERE tgfoid = v_case_guard AND NOT tgisinternal
           AND tgname = 'trg_phase2b_approve_case_link_version'
           AND tgrelid = 'public.solo_plus_cases'::regclass
           AND tgenabled = 'O' AND tgtype = 19) <> 1
     OR has_function_privilege('anon', v_approve, 'EXECUTE')
     OR has_function_privilege('authenticated', v_approve, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_approve, 'EXECUTE')
     OR has_function_privilege('anon', v_guard, 'EXECUTE')
     OR has_function_privilege('authenticated', v_guard, 'EXECUTE')
     OR has_function_privilege('service_role', v_guard, 'EXECUTE')
     OR has_function_privilege('anon', v_case_guard, 'EXECUTE')
     OR has_function_privilege('authenticated', v_case_guard, 'EXECUTE')
     OR has_function_privilege('service_role', v_case_guard, 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid IN (v_guard, v_case_guard)
         AND acl.privilege_type = 'EXECUTE' AND acl.grantee <> p.proowner
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = v_approve AND acl.privilege_type = 'EXECUTE'
         AND acl.grantee NOT IN (p.proowner, to_regrole('service_role')::OID)
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid IN (v_guard, v_case_guard)
         AND (NOT p.prosecdef
              OR p.proowner IS DISTINCT FROM to_regrole(current_user)::OID
              OR COALESCE(array_length(p.proconfig, 1), 0) <> 1
              OR replace(p.proconfig[1], ' ', '') IS DISTINCT FROM 'search_path=public,pg_temp')
     ) THEN
    RAISE EXCEPTION 'Phase 2B approve success post-DDL verification failed';
  END IF;
END;
$$;
COMMIT;
