-- Phase 2B approve atomicity source gate. Forward-only; no fixture or action enabled.
-- Preserve the reviewed RMI/reject/reopen v1 body while closing its old approve branch.
BEGIN;
SET LOCAL search_path = public, pg_temp;

DO $$
DECLARE
  v_old_oid OID := to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::OID;
  v_new_oid OID := to_regprocedure('public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)')::OID;
  v_old pg_catalog.pg_proc%ROWTYPE;
  v_new pg_catalog.pg_proc%ROWTYPE;
  v_old_body_hash TEXT;
  v_service_role_oid OID := to_regrole('service_role')::OID;
  v_expected_payment_policy TEXT;
BEGIN
  IF v_old_oid IS NULL
     OR to_regclass('public.solo_plus_cases') IS NULL
     OR to_regclass('public.solo_plus_case_requirements') IS NULL
     OR to_regclass('public.solo_plus_case_events') IS NULL
     OR to_regclass('public.payment_records') IS NULL
     OR to_regprocedure('public.touch_updated_at()') IS NULL
     OR v_service_role_oid IS NULL
     OR to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity prerequisites missing';
  END IF;

  -- An existing overload, changed argument name/default, or changed function
  -- body is unsafe to overwrite. Normalize line endings only: the reviewed
  -- migration body itself is the source of these exact hashes.
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'review_solo_plus_case_v1') <> 1
     OR (SELECT count(*) FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'review_solo_plus_case_approve_atomic_v1')
        <> CASE WHEN v_new_oid IS NULL THEN 0 ELSE 1 END THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: unexpected RPC overload';
  END IF;

  SELECT p.* INTO STRICT v_old FROM pg_catalog.pg_proc p WHERE p.oid = v_old_oid;
  v_old_body_hash := md5(replace(replace(v_old.prosrc, E'\r\n', E'\n'), E'\r', E'\n'));
  IF v_old_body_hash NOT IN (
       '57fa7f166f81f24cb3ec077acc3449eb', -- reviewed pre-cutover v1
       '27710a7819d8413aa8764d8762a6a0ca'  -- this fail-closed v1
     )
     OR (v_old_body_hash = '57fa7f166f81f24cb3ec077acc3449eb' AND v_new_oid IS NOT NULL)
     OR (v_old_body_hash = '27710a7819d8413aa8764d8762a6a0ca' AND v_new_oid IS NULL)
     OR v_old.proargnames IS DISTINCT FROM ARRAY[
       'p_case_id', 'p_expected_row_version', 'p_request_idempotency_key',
       'p_decision', 'p_reviewer_admin_id', 'p_reason', 'p_policy_version'
     ]::TEXT[]
     OR v_old.pronargdefaults <> 2
     OR pg_catalog.pg_get_expr(v_old.proargdefaults, 0) IS DISTINCT FROM
        'NULL::text, NULL::text'
     OR v_old.prorettype <> 'jsonb'::regtype
     OR v_old.proretset OR v_old.prosecdef OR v_old.proisstrict
     OR v_old.prokind <> 'f' OR v_old.provolatile <> 'v'
     OR v_old.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
     OR v_old.proowner IS DISTINCT FROM to_regrole(current_user)::OID
     OR COALESCE(array_length(v_old.proconfig, 1), 0) <> 1
     OR replace(v_old.proconfig[1], ' ', '') IS DISTINCT FROM 'search_path=public,pg_temp' THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: reviewed v1 function drift';
  END IF;

  IF v_new_oid IS NOT NULL THEN
    SELECT p.* INTO STRICT v_new FROM pg_catalog.pg_proc p WHERE p.oid = v_new_oid;
    IF md5(replace(replace(v_new.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
         <> '368f905cc19f574df1617acd5a7d812f'
       OR v_new.proargnames IS DISTINCT FROM ARRAY[
         'p_case_id', 'p_expected_row_version', 'p_request_idempotency_key',
         'p_decision', 'p_reviewer_admin_id', 'p_reason', 'p_policy_version',
         'p_expected_fixture_run_id'
       ]::TEXT[]
       OR v_new.pronargdefaults <> 0
       OR v_new.prorettype <> 'jsonb'::regtype
       OR v_new.proretset OR v_new.prosecdef OR v_new.proisstrict
       OR v_new.prokind <> 'f' OR v_new.provolatile <> 'v'
       OR v_new.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
       OR v_new.proowner IS DISTINCT FROM to_regrole(current_user)::OID
       OR COALESCE(array_length(v_new.proconfig, 1), 0) <> 1
       OR replace(v_new.proconfig[1], ' ', '') IS DISTINCT FROM 'search_path=public,pg_temp' THEN
      RAISE EXCEPTION 'Phase 2B approve atomicity blocked: approve RPC drift';
    END IF;
  END IF;

  -- The previous migration granted only service_role EXECUTE. Check explicit
  -- ACL entries, including PUBLIC, before replacing either function.
  IF NOT EXISTS (
       SELECT 1 FROM aclexplode(COALESCE(v_old.proacl, acldefault('f', v_old.proowner))) acl
       WHERE acl.grantee = v_service_role_oid AND acl.privilege_type = 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1 FROM aclexplode(COALESCE(v_old.proacl, acldefault('f', v_old.proowner))) acl
       WHERE acl.privilege_type = 'EXECUTE'
         AND acl.grantee NOT IN (v_old.proowner, v_service_role_oid)
     )
     OR (v_new_oid IS NOT NULL AND (
       NOT EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(v_new.proacl, acldefault('f', v_new.proowner))) acl
         WHERE acl.grantee = v_service_role_oid AND acl.privilege_type = 'EXECUTE'
       ) OR EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(v_new.proacl, acldefault('f', v_new.proowner))) acl
         WHERE acl.privilege_type = 'EXECUTE'
           AND acl.grantee NOT IN (v_new.proowner, v_service_role_oid)
       )
     )) THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: RPC grant drift';
  END IF;

  IF EXISTS (
    WITH expected(table_name, column_name, type_name, required_not_null) AS (
      VALUES
        ('solo_plus_cases', 'id', 'uuid', true),
        ('solo_plus_cases', 'merchant_id', 'uuid', false),
        ('solo_plus_cases', 'flow_origin', 'text', true),
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
        ('solo_plus_cases', 'rejected_at', 'timestamp with time zone', false),
        ('solo_plus_cases', 'reopened_at', 'timestamp with time zone', false),
        ('solo_plus_cases', 'row_version', 'integer', true),
        ('solo_plus_cases', 'audit_metadata', 'jsonb', true),
        ('payment_records', 'id', 'uuid', true),
        ('payment_records', 'solo_plus_case_id', 'uuid', false),
        ('payment_records', 'merchant_id', 'uuid', false),
        ('payment_records', 'payment_status', 'character varying(50)', true),
        ('payment_records', 'payment_purpose', 'character varying(50)', true),
        ('payment_records', 'amount_paid', 'numeric(18,2)', true),
        ('payment_records', 'expected_amount', 'numeric(18,2)', false),
        ('payment_records', 'currency', 'character varying(10)', true),
        ('payment_records', 'provider_name', 'character varying(50)', false),
        ('payment_records', 'provider_reference', 'character varying(255)', false),
        ('payment_records', 'metadata', 'jsonb', true),
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
        ('solo_plus_case_events', 'id', 'uuid', true),
        ('solo_plus_case_events', 'case_id', 'uuid', true),
        ('solo_plus_case_events', 'event_type', 'text', true),
        ('solo_plus_case_events', 'request_idempotency_key', 'text', false)
    )
    SELECT 1 FROM expected e
    LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
      AND a.attname = e.column_name AND a.attnum > 0 AND NOT a.attisdropped
    WHERE a.attnum IS NULL
       OR pg_catalog.format_type(a.atttypid, a.atttypmod) IS DISTINCT FROM e.type_name
       OR a.attnotnull IS DISTINCT FROM e.required_not_null
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: prerequisite column drift';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'solo_plus_cases', 'solo_plus_case_requirements',
        'solo_plus_case_events', 'payment_records'
      )
      AND (c.relkind <> 'r' OR c.relrowsecurity IS NOT TRUE OR c.relforcerowsecurity IS NOT FALSE)
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: table kind or RLS drift';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'public.solo_plus_cases'::regclass
         AND p.polname = 'merchant_read_solo_plus_cases'
         AND p.polcmd = 'r' AND p.polpermissive
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = 'public.solo_plus_case_requirements'::regclass
         AND p.polname = 'merchant_read_solo_plus_case_requirements'
         AND p.polcmd = 'r' AND p.polpermissive
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid IN (
         'public.solo_plus_cases'::regclass,
         'public.solo_plus_case_requirements'::regclass,
         'public.solo_plus_case_events'::regclass
       ) AND (
         p.polcmd <> 'r'
         OR (p.polrelid = 'public.solo_plus_cases'::regclass
             AND p.polname <> 'merchant_read_solo_plus_cases')
         OR (p.polrelid = 'public.solo_plus_case_requirements'::regclass
             AND p.polname <> 'merchant_read_solo_plus_case_requirements')
         OR p.polrelid = 'public.solo_plus_case_events'::regclass
       )
     ) THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: RLS policy drift';
  END IF;

  -- Compare complete policy expressions, not fragments. These renderings come
  -- from the canonical Solo Plus and payment-substrate migrations. Whitespace
  -- is the only normalization; a different role or expression is unsafe drift.
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
    WHERE p.oid IS NULL
       OR p.polcmd <> 'r' OR p.polpermissive IS NOT TRUE
       OR p.polroles IS DISTINCT FROM ARRAY[0]::OID[]
       OR regexp_replace(btrim(pg_catalog.pg_get_expr(p.polqual, p.polrelid, false)), '[[:space:]]+', ' ', 'g')
          IS DISTINCT FROM e.using_expression
       OR p.polwithcheck IS NOT NULL
  ) OR (SELECT count(*) FROM pg_catalog.pg_policy p
        WHERE p.polrelid = 'public.payment_records'::regclass) <> 1 THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: policy role or expression drift';
  END IF;

  IF EXISTS (
    WITH expected(table_name, constraint_name, constraint_kind) AS (
      VALUES
        ('solo_plus_cases', 'solo_plus_cases_pkey', 'p'),
        ('solo_plus_cases', 'solo_plus_cases_payment_record_id_fkey', 'f'),
        ('solo_plus_cases', 'solo_plus_cases_approved_consistency_chk', 'c'),
        ('solo_plus_case_requirements', 'solo_plus_case_requirements_pkey', 'p'),
        ('solo_plus_case_requirements', 'solo_plus_case_requirements_case_id_fkey', 'f'),
        ('solo_plus_case_requirements', 'solo_plus_case_requirements_unique_case_code', 'u'),
        ('solo_plus_case_events', 'solo_plus_case_events_pkey', 'p'),
        ('solo_plus_case_events', 'solo_plus_case_events_case_id_fkey', 'f'),
        ('payment_records', 'payment_records_pkey', 'p'),
        ('payment_records', 'payment_records_solo_plus_case_id_fkey', 'f'),
        ('payment_records', 'payment_records_payment_status_check', 'c')
    )
    SELECT 1 FROM expected e
    LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_catalog.pg_class t ON t.relnamespace = n.oid AND t.relname = e.table_name
    LEFT JOIN pg_catalog.pg_constraint c ON c.conrelid = t.oid
      AND c.conname = e.constraint_name AND c.contype = e.constraint_kind::"char"
      AND c.convalidated IS TRUE
    WHERE c.oid IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.solo_plus_case_requirements'::regclass
      AND c.conname = 'solo_plus_case_requirements_unique_case_code'
      AND c.conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute
         WHERE attrelid = c.conrelid AND attname = 'case_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute
         WHERE attrelid = c.conrelid AND attname = 'requirement_code')
      ]::SMALLINT[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class ix ON ix.oid = i.indexrelid
    WHERE ix.relnamespace = 'public'::regnamespace
      AND ix.relname = 'idx_solo_plus_case_events_review_request_intent'
      AND i.indrelid = 'public.solo_plus_case_events'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      AND i.indnkeyatts = 1 AND i.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: constraint or index drift';
  END IF;

  -- Same-name constraints can still point at another table, use another
  -- action, or enforce a weaker expression. Compare their full relevant shape.
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
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: key or foreign-key semantic drift';
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
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: check constraint expression drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class ix ON ix.oid = i.indexrelid
    JOIN pg_catalog.pg_am am ON am.oid = ix.relam
    JOIN pg_catalog.pg_attribute key_attribute ON key_attribute.attrelid = i.indrelid
      AND key_attribute.attname = 'request_idempotency_key'
    JOIN pg_catalog.pg_opclass key_opclass ON key_opclass.oid = i.indclass[0]
    JOIN pg_catalog.pg_collation key_collation ON key_collation.oid = i.indcollation[0]
    WHERE ix.relnamespace = 'public'::regnamespace
      AND ix.relname = 'idx_solo_plus_case_events_review_request_intent'
      AND i.indrelid = 'public.solo_plus_case_events'::regclass
      AND am.amname = 'btree' AND i.indisunique AND i.indisvalid
      AND i.indisready AND i.indislive AND i.indisprimary IS FALSE
      AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indexprs IS NULL
      AND key_attribute.atttypid = 'text'::regtype
      AND key_collation.collnamespace = 'pg_catalog'::regnamespace
      AND key_collation.collname = 'default'
      AND key_attribute.attcollation = key_collation.oid
      AND key_opclass.opcnamespace = 'pg_catalog'::regnamespace
      AND key_opclass.opcname = 'text_ops' AND key_opclass.opcdefault
      AND key_opclass.opcintype = 'text'::regtype
      AND key_opclass.opcmethod = ix.relam
      AND ARRAY(SELECT a.attname::TEXT FROM unnest(i.indkey::SMALLINT[]) WITH ORDINALITY k(attnum, ord)
                JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                ORDER BY k.ord) = ARRAY['request_idempotency_key']::TEXT[]
      AND regexp_replace(btrim(pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)), '[[:space:]]+', ' ', 'g')
          = $predicate$((request_idempotency_key IS NOT NULL) AND (event_type = ANY (ARRAY['case_review_requested_more_information'::text, 'case_approved'::text, 'case_rejected'::text, 'case_reopened'::text])))$predicate$
  ) THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: review intent index semantic drift';
  END IF;

  -- Only the three reviewed updated_at triggers may be user-defined on these
  -- rows. Unexpected triggers would change future writer behavior.
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.oid IN (
        'public.solo_plus_cases'::regclass,
        'public.solo_plus_case_requirements'::regclass,
        'public.solo_plus_case_events'::regclass,
        'public.payment_records'::regclass
      )) <> 3
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger t
       JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.oid IN (
         'public.solo_plus_cases'::regclass,
         'public.solo_plus_case_requirements'::regclass,
         'public.solo_plus_case_events'::regclass,
         'public.payment_records'::regclass
       ) AND (
         ROW(c.relname, t.tgname) NOT IN (
           ROW('solo_plus_cases', 'trg_solo_plus_cases_updated_at'),
           ROW('solo_plus_case_requirements', 'trg_solo_plus_case_requirements_updated_at'),
           ROW('payment_records', 'trg_payment_records_updated_at')
         )
         OR t.tgfoid IS DISTINCT FROM to_regprocedure('public.touch_updated_at()')::OID
         OR t.tgtype <> 19 OR t.tgenabled <> 'O' OR t.tgqual IS NOT NULL
       )
     ) THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity blocked: trigger drift';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.review_solo_plus_case_v1(
  p_case_id UUID,
  p_expected_row_version BIGINT,
  p_request_idempotency_key TEXT,
  p_decision TEXT,
  p_reviewer_admin_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_policy_version TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_case public.solo_plus_cases%ROWTYPE;
  v_previous_case public.solo_plus_cases%ROWTYPE;
  v_existing_event public.solo_plus_case_events%ROWTYPE;
  v_inserted_event public.solo_plus_case_events%ROWTYPE;
  v_now TIMESTAMPTZ := now();
  v_decision TEXT;
  v_reason TEXT;
  v_effective_policy_version TEXT;
  v_event_type TEXT;
  v_target_status TEXT;
  v_target_refund_status TEXT;
  v_reason_required BOOLEAN := false;
  v_requirement_count INTEGER;
  v_satisfied_requirement_count INTEGER;
BEGIN
  IF p_case_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus review case_id is required';
  END IF;

  IF p_expected_row_version IS NULL OR p_expected_row_version < 0 THEN
    RAISE EXCEPTION 'Solo Plus review expected_row_version must be a non-negative integer';
  END IF;

  IF p_request_idempotency_key IS NULL OR btrim(p_request_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Solo Plus review request idempotency key is required';
  END IF;

  IF p_reviewer_admin_id IS NULL THEN
    RAISE EXCEPTION 'Solo Plus reviewer_admin_id is required';
  END IF;

  v_decision := lower(btrim(COALESCE(p_decision, '')));
  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');

  IF v_reason IS NOT NULL AND char_length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Solo Plus review reason must be at most 1000 characters';
  END IF;

  CASE v_decision
    WHEN 'request_more_information' THEN
      v_event_type := 'case_review_requested_more_information';
      v_target_status := 'verification_pending';
      v_reason_required := true;
    WHEN 'approve' THEN
      v_event_type := 'case_approved';
      v_target_status := 'approved';
    WHEN 'reject' THEN
      v_event_type := 'case_rejected';
      v_target_status := 'rejected';
      v_reason_required := true;
    WHEN 'reopen' THEN
      v_event_type := 'case_reopened';
      v_target_status := 'verification_pending';
    ELSE
      RAISE EXCEPTION 'Solo Plus review decision must be one of request_more_information, approve, reject, or reopen';
  END CASE;

  IF v_reason_required AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Solo Plus review reason is required for %', v_decision;
  END IF;

  SELECT *
  INTO v_case
  FROM public.solo_plus_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  -- The seven-argument RPC has no trusted fixture run ID. It must not approve.
  IF v_decision = 'approve' THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END IF;

  v_effective_policy_version := COALESCE(
    NULLIF(btrim(COALESCE(p_policy_version, '')), ''),
    v_case.requirements_policy_version
  );

  SELECT *
  INTO v_existing_event
  FROM public.solo_plus_case_events
  WHERE request_idempotency_key = p_request_idempotency_key
    AND event_type IN (
      'case_review_requested_more_information',
      'case_approved',
      'case_rejected',
      'case_reopened'
    )
  ORDER BY created_at ASC, id ASC
  LIMIT 1;

  IF FOUND THEN
    IF v_existing_event.case_id = p_case_id
       AND v_existing_event.event_type = v_event_type
       AND v_existing_event.actor_type = 'admin'
       AND v_existing_event.actor_id IS NOT DISTINCT FROM p_reviewer_admin_id
       AND v_existing_event.reason IS NOT DISTINCT FROM v_reason
       AND v_existing_event.policy_version = v_effective_policy_version
       AND v_existing_event.previous_state ->> 'rowVersion' = p_expected_row_version::text THEN
      RETURN jsonb_build_object(
        'kind', 'idempotent_replay',
        'case', to_jsonb(v_case),
        'event', to_jsonb(v_existing_event)
      );
    END IF;

    RETURN jsonb_build_object(
      'kind', 'idempotency_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF v_case.row_version::BIGINT <> p_expected_row_version THEN
    RETURN jsonb_build_object(
      'kind', 'version_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF (v_decision IN ('request_more_information', 'approve', 'reject') AND v_case.case_status <> 'manual_review')
     OR (v_decision = 'reopen' AND v_case.case_status <> 'rejected') THEN
    RETURN jsonb_build_object(
      'kind', 'state_conflict',
      'case', to_jsonb(v_case)
    );
  END IF;

  IF v_decision = 'approve' THEN
    SELECT
      count(*)::INTEGER,
      count(*) FILTER (
        WHERE requirement_code IN (
          'bvn',
          'selfie_liveness',
          'id_document',
          'proof_of_address',
          'settlement_account',
          'activity_profile'
        )
          AND requirement_state IN ('passed', 'reused', 'waived')
      )::INTEGER
    INTO v_requirement_count, v_satisfied_requirement_count
    FROM public.solo_plus_case_requirements
    WHERE case_id = p_case_id;

    IF v_case.payment_status <> 'paid'
       OR v_case.payment_record_id IS NULL
       OR v_requirement_count <> 6
       OR v_satisfied_requirement_count <> 6
       OR NOT EXISTS (
         SELECT 1
         FROM public.payment_records p
         WHERE p.id = v_case.payment_record_id
           AND p.solo_plus_case_id = p_case_id
           AND p.payment_status = 'successful'
       ) THEN
      RETURN jsonb_build_object(
        'kind', 'state_conflict',
        'case', to_jsonb(v_case)
      );
    END IF;
  END IF;

  v_target_refund_status := CASE
    WHEN v_decision = 'request_more_information' THEN v_case.refund_status
    WHEN v_decision = 'approve' THEN 'none'
    WHEN v_decision = 'reject' THEN CASE WHEN v_case.payment_status = 'paid' THEN 'review_required' ELSE 'none' END
    WHEN v_decision = 'reopen' THEN 'none'
    ELSE v_case.refund_status
  END;

  v_previous_case := v_case;

  UPDATE public.solo_plus_cases
  SET
    case_status = v_target_status,
    refund_status = v_target_refund_status,
    approved_at = CASE WHEN v_decision = 'approve' THEN v_now ELSE approved_at END,
    approved_by_admin_id = CASE WHEN v_decision = 'approve' THEN p_reviewer_admin_id ELSE approved_by_admin_id END,
    rejected_at = CASE
      WHEN v_decision = 'reject' THEN v_now
      WHEN v_decision = 'reopen' THEN NULL
      ELSE rejected_at
    END,
    rejected_by_admin_id = CASE
      WHEN v_decision = 'reject' THEN p_reviewer_admin_id
      WHEN v_decision = 'reopen' THEN NULL
      ELSE rejected_by_admin_id
    END,
    reopened_at = CASE WHEN v_decision = 'reopen' THEN v_now ELSE reopened_at END,
    reopened_by_admin_id = CASE WHEN v_decision = 'reopen' THEN p_reviewer_admin_id ELSE reopened_by_admin_id END,
    rejection_reason = CASE
      WHEN v_decision = 'reject' THEN v_reason
      WHEN v_decision = 'reopen' THEN NULL
      ELSE rejection_reason
    END,
    refund_idempotency_key = CASE WHEN v_decision = 'reopen' THEN NULL ELSE refund_idempotency_key END,
    row_version = row_version + 1,
    updated_at = v_now
  WHERE id = p_case_id
  RETURNING * INTO v_case;

  INSERT INTO public.solo_plus_case_events (
    case_id,
    event_type,
    previous_state,
    new_state,
    actor_type,
    actor_id,
    request_idempotency_key,
    reason,
    policy_version,
    created_at
  )
  VALUES (
    p_case_id,
    v_event_type,
    jsonb_build_object(
      'caseStatus', v_previous_case.case_status,
      'refundStatus', v_previous_case.refund_status,
      'approvedAt', v_previous_case.approved_at,
      'approvedByAdminId', v_previous_case.approved_by_admin_id,
      'rejectedAt', v_previous_case.rejected_at,
      'rejectedByAdminId', v_previous_case.rejected_by_admin_id,
      'reopenedAt', v_previous_case.reopened_at,
      'reopenedByAdminId', v_previous_case.reopened_by_admin_id,
      'rejectionReason', v_previous_case.rejection_reason,
      'rowVersion', p_expected_row_version
    ),
    jsonb_build_object(
      'caseStatus', v_case.case_status,
      'refundStatus', v_case.refund_status,
      'approvedAt', v_case.approved_at,
      'approvedByAdminId', v_case.approved_by_admin_id,
      'rejectedAt', v_case.rejected_at,
      'rejectedByAdminId', v_case.rejected_by_admin_id,
      'reopenedAt', v_case.reopened_at,
      'reopenedByAdminId', v_case.reopened_by_admin_id,
      'rejectionReason', v_case.rejection_reason,
      'rowVersion', v_case.row_version
    ),
    'admin',
    p_reviewer_admin_id,
    p_request_idempotency_key,
    v_reason,
    v_effective_policy_version,
    v_now
  )
  RETURNING * INTO v_inserted_event;

  RETURN jsonb_build_object(
    'kind', 'updated',
    'case', to_jsonb(v_case),
    'event', to_jsonb(v_inserted_event)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_solo_plus_case_v1(UUID, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(UUID, BIGINT, TEXT, TEXT, UUID, TEXT, TEXT)
  TO service_role;

-- The new RPC owns the exact run marker and obtains locks in the intended
-- case -> payment -> canonical requirements order. Its final writer guard is
-- deliberately closed until every linked payment and requirement writer has
-- the parent-case/version protocol and disposable concurrency proof.
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
  v_payment public.payment_records%ROWTYPE;
  v_requirement public.solo_plus_case_requirements%ROWTYPE;
  v_requirement_code TEXT;
  v_requirement_count INTEGER;
BEGIN
  IF p_case_id IS NULL
     OR p_expected_row_version IS NULL
     OR p_expected_row_version < 0
     OR p_request_idempotency_key IS NULL
     OR btrim(p_request_idempotency_key) = ''
     OR p_reviewer_admin_id IS NULL
     OR p_decision IS DISTINCT FROM 'approve'
     OR p_expected_fixture_run_id IS NULL
     OR p_expected_fixture_run_id !~ '^phase2b-approve-[0-9]{8}-[a-z0-9]{3,16}$'
     OR p_policy_version IS NULL
     OR btrim(p_policy_version) = ''
     OR char_length(COALESCE(p_reason, '')) > 1000 THEN
    RAISE EXCEPTION 'Solo Plus atomic approve input is invalid';
  END IF;

  SELECT * INTO v_case
  FROM public.solo_plus_cases
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  IF v_case.row_version::BIGINT <> p_expected_row_version THEN
    RETURN jsonb_build_object('kind', 'version_conflict', 'case', to_jsonb(v_case));
  END IF;

  IF v_case.case_status <> 'manual_review'
     OR v_case.payment_status <> 'paid'
     OR v_case.payment_record_id IS NULL
     OR v_case.refund_status <> 'none'
     OR v_case.activation_idempotency_key IS NOT NULL
     OR v_case.refund_idempotency_key IS NOT NULL
     OR v_case.approved_at IS NOT NULL
     OR v_case.rejected_at IS NOT NULL
     OR v_case.reopened_at IS NOT NULL
     OR v_case.audit_metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
     OR v_case.audit_metadata ->> 'fixture_run_id' IS DISTINCT FROM p_expected_fixture_run_id
     OR v_case.audit_metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
     OR v_case.requirements_policy_version IS DISTINCT FROM p_policy_version
     OR EXISTS (
       SELECT 1 FROM public.solo_plus_case_events e
       WHERE e.case_id = p_case_id
         AND e.event_type IN (
           'case_review_requested_more_information', 'case_approved',
           'case_rejected', 'case_reopened', 'case_activated'
         )
     )
     OR EXISTS (
       SELECT 1 FROM public.solo_plus_case_events e
       WHERE e.request_idempotency_key = p_request_idempotency_key
         AND e.event_type IN (
           'case_review_requested_more_information', 'case_approved',
           'case_rejected', 'case_reopened'
         )
     ) THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END IF;

  BEGIN
    SELECT * INTO v_payment
    FROM public.payment_records
    WHERE id = v_case.payment_record_id
    FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END;

  IF v_payment.id IS NULL
     OR v_payment.solo_plus_case_id IS DISTINCT FROM p_case_id
     OR v_payment.merchant_id IS DISTINCT FROM v_case.merchant_id
     OR v_payment.payment_status IS DISTINCT FROM 'successful'
     OR v_payment.amount_paid IS DISTINCT FROM v_case.expected_amount
     OR v_payment.expected_amount IS DISTINCT FROM v_case.expected_amount
     OR v_payment.currency IS DISTINCT FROM v_case.payment_currency
     OR v_payment.payment_purpose IS DISTINCT FROM
       CASE WHEN v_case.flow_origin = 'upgrade' THEN 'plan_upgrade' ELSE 'plan_subscription' END
     OR v_payment.metadata ->> 'fixture_scope' IS DISTINCT FROM 'phase2b_approve_acceptance'
     OR v_payment.metadata ->> 'fixture_run_id' IS DISTINCT FROM p_expected_fixture_run_id
     OR v_payment.metadata ->> 'synthetic_approve_acceptance' IS DISTINCT FROM 'true'
     OR v_payment.provider_name IS NOT NULL
     OR v_payment.provider_reference IS NOT NULL THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END IF;

  FOREACH v_requirement_code IN ARRAY ARRAY[
    'activity_profile', 'bvn', 'id_document', 'proof_of_address',
    'selfie_liveness', 'settlement_account'
  ] LOOP
    BEGIN
      SELECT * INTO v_requirement
      FROM public.solo_plus_case_requirements
      WHERE case_id = p_case_id
        AND requirement_code = v_requirement_code
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
  FROM public.solo_plus_case_requirements
  WHERE case_id = p_case_id;

  IF v_requirement_count <> 6 THEN
    RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
  END IF;

  -- This return is an intentional release blocker, not an approval outcome.
  -- The writer protocol and two-session PostgreSQL races remain unproven.
  RETURN jsonb_build_object('kind', 'state_conflict', 'case', to_jsonb(v_case));
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
  v_old_oid OID := to_regprocedure('public.review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)')::OID;
  v_new_oid OID := to_regprocedure('public.review_solo_plus_case_approve_atomic_v1(uuid,bigint,text,text,uuid,text,text,text)')::OID;
  v_service_role_oid OID := to_regrole('service_role')::OID;
  v_rpc pg_catalog.pg_proc%ROWTYPE;
  v_expected_hash TEXT;
BEGIN
  IF v_old_oid IS NULL OR v_new_oid IS NULL
     OR (SELECT count(*) FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN (
             'review_solo_plus_case_v1', 'review_solo_plus_case_approve_atomic_v1'
           )) <> 2 THEN
    RAISE EXCEPTION 'Phase 2B approve atomicity verification failed: RPC identity';
  END IF;

  FOR v_rpc IN
    SELECT p.* FROM pg_catalog.pg_proc p WHERE p.oid IN (v_old_oid, v_new_oid)
  LOOP
    v_expected_hash := CASE v_rpc.proname
      WHEN 'review_solo_plus_case_v1' THEN '27710a7819d8413aa8764d8762a6a0ca'
      WHEN 'review_solo_plus_case_approve_atomic_v1' THEN '368f905cc19f574df1617acd5a7d812f'
      ELSE NULL
    END;
    IF v_expected_hash IS NULL
       OR md5(replace(replace(v_rpc.prosrc, E'\r\n', E'\n'), E'\r', E'\n'))
          IS DISTINCT FROM v_expected_hash
       OR v_rpc.proowner IS DISTINCT FROM to_regrole(current_user)::OID
       OR v_rpc.prosecdef OR v_rpc.proretset OR v_rpc.proisstrict
       OR v_rpc.prokind <> 'f' OR v_rpc.provolatile <> 'v'
       OR v_rpc.prorettype <> 'jsonb'::regtype
       OR v_rpc.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
       OR COALESCE(array_length(v_rpc.proconfig, 1), 0) <> 1
       OR replace(v_rpc.proconfig[1], ' ', '') IS DISTINCT FROM 'search_path=public,pg_temp'
       OR NOT EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(v_rpc.proacl, acldefault('f', v_rpc.proowner))) acl
         WHERE acl.grantee = v_service_role_oid AND acl.privilege_type = 'EXECUTE'
       )
       OR EXISTS (
         SELECT 1 FROM aclexplode(COALESCE(v_rpc.proacl, acldefault('f', v_rpc.proowner))) acl
         WHERE acl.privilege_type = 'EXECUTE'
           AND acl.grantee NOT IN (v_rpc.proowner, v_service_role_oid)
       ) THEN
      RAISE EXCEPTION 'Phase 2B approve atomicity verification failed: RPC body or security';
    END IF;
  END LOOP;
END;
$$;

COMMIT;
