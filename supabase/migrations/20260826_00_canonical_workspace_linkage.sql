BEGIN;

-- Migration 029 is additive. It establishes only approval-owned canonical
-- merchant/workspace linkage; it does not enable M028 readiness or approval.
DO $migration_029_prerequisites$
DECLARE
  v_workspaces_oid regclass := to_regclass('public.workspaces');
  v_merchants_oid regclass := to_regclass('public.merchants');
  v_auth_users_oid regclass := to_regclass('auth.users');
  v_workspace_id_attnum smallint;
  v_workspace_merchant_attnum smallint;
  v_merchant_id_attnum smallint;
  v_workspace_merchant_fk_count integer;
  v_workspace_merchant_fk_total integer;
  v_workspace_merchant_unique_count integer;
  v_workspace_primary_key_count integer;
  v_composite_support_count integer;
  v_link_table_oid regclass := to_regclass('public.merchant_canonical_workspaces');
  v_link_merchant_attnum smallint;
  v_link_workspace_attnum smallint;
  v_link_created_by_attnum smallint;
  v_existing_link_contract_ok boolean := false;
  v_column record;
  v_approval_signature text := 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)';
  v_issue_signature text := 'public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)';
  v_snapshot_signature text := 'public.read_canonical_approval_snapshot_v1(uuid)';
BEGIN
  IF to_regrole('service_role') IS NULL OR to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'Migration 029 prerequisite failed: required managed roles are unavailable';
  END IF;

  IF v_merchants_oid IS NULL OR v_workspaces_oid IS NULL OR v_auth_users_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 029 prerequisite failed: public.merchants, public.workspaces, and auth.users must exist';
  END IF;

  FOR v_column IN
    SELECT * FROM (VALUES
      ('public.merchants'::text, 'id'::text),
      ('public.workspaces'::text, 'id'::text),
      ('public.workspaces'::text, 'merchant_id'::text)
    ) AS required(relation_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass(v_column.relation_name)
        AND a.attname = v_column.column_name
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND format_type(a.atttypid, a.atttypmod) = 'uuid'
    ) THEN
      RAISE EXCEPTION 'Migration 029 prerequisite failed: required uuid column %.% is unavailable', v_column.relation_name, v_column.column_name;
    END IF;
  END LOOP;

  SELECT a.attnum INTO v_workspace_id_attnum
  FROM pg_attribute a WHERE a.attrelid = v_workspaces_oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT a.attnum INTO v_workspace_merchant_attnum
  FROM pg_attribute a WHERE a.attrelid = v_workspaces_oid AND a.attname = 'merchant_id' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT a.attnum INTO v_merchant_id_attnum
  FROM pg_attribute a WHERE a.attrelid = v_merchants_oid AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;

  SELECT count(*) INTO v_workspace_primary_key_count
  FROM pg_constraint c
  WHERE c.conrelid = v_workspaces_oid
    AND c.contype = 'p'::"char"
    AND c.conkey = ARRAY[v_workspace_id_attnum]::smallint[]
    AND c.convalidated;

  SELECT count(*) INTO v_workspace_merchant_fk_count
  FROM pg_constraint c
  WHERE c.conrelid = v_workspaces_oid
    AND c.contype = 'f'::"char"
    AND c.conkey = ARRAY[v_workspace_merchant_attnum]::smallint[]
    AND c.confrelid = v_merchants_oid
    AND c.confkey = ARRAY[v_merchant_id_attnum]::smallint[]
    AND c.confdeltype = 'c'::"char"
    AND c.convalidated;

  SELECT count(*) INTO v_workspace_merchant_fk_total
  FROM pg_constraint c
  WHERE c.conrelid = v_workspaces_oid
    AND c.contype = 'f'::"char"
    AND c.conkey = ARRAY[v_workspace_merchant_attnum]::smallint[];

  SELECT count(*) INTO v_workspace_merchant_unique_count
  FROM pg_constraint c
  WHERE c.conrelid = v_workspaces_oid
    AND c.contype = 'u'::"char"
    AND c.conkey = ARRAY[v_workspace_merchant_attnum]::smallint[]
    AND c.convalidated;

  SELECT count(*) INTO v_composite_support_count
  FROM pg_index i
  WHERE i.indrelid = v_workspaces_oid
    AND i.indisunique
    AND i.indpred IS NULL
    AND i.indkey::smallint[] = ARRAY[v_workspace_id_attnum, v_workspace_merchant_attnum]::smallint[];

  IF v_workspace_primary_key_count <> 1
    OR v_workspace_merchant_fk_count <> 1
    OR v_workspace_merchant_fk_total <> 1
    OR v_workspace_merchant_unique_count <> 1
    OR v_composite_support_count > 1 THEN
    RAISE EXCEPTION 'Migration 029 prerequisite failed: workspace identity/linkage contract is incompatible';
  END IF;

  IF to_regprocedure(v_approval_signature) IS NULL
    OR to_regprocedure(v_issue_signature) IS NULL
    OR to_regprocedure(v_snapshot_signature) IS NULL
    OR EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('review_compliance_profile_decision_v1', 'issue_canonical_approval_decision_request_v1', 'read_canonical_approval_snapshot_v1')
        AND p.oid NOT IN (to_regprocedure(v_approval_signature), to_regprocedure(v_issue_signature), to_regprocedure(v_snapshot_signature))
    )
    OR EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid IN (to_regprocedure(v_approval_signature), to_regprocedure(v_issue_signature), to_regprocedure(v_snapshot_signature))
        AND (p.prosecdef OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog, public']))
    )
    OR has_function_privilege('PUBLIC', v_approval_signature, 'EXECUTE')
    OR has_function_privilege('anon', v_approval_signature, 'EXECUTE')
    OR has_function_privilege('authenticated', v_approval_signature, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_approval_signature, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 029 prerequisite failed: M026-M028 RPC security/signature posture is incompatible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    WHERE c.oid IN (
      to_regclass('public.merchant_compliance_profiles'),
      to_regclass('public.merchant_compliance_reviews'),
      to_regclass('public.merchant_compliance_events'),
      to_regclass('public.approval_policy_versions'),
      to_regclass('public.approval_decision_requests')
    )
      AND (NOT c.relrowsecurity OR c.relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name IN (
        'merchant_compliance_profiles', 'merchant_compliance_reviews', 'merchant_compliance_events',
        'approval_policy_versions', 'approval_decision_requests'
      )
      AND g.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'Migration 029 prerequisite failed: compliance/M028 table security posture is incompatible';
  END IF;

  IF v_link_table_oid IS NOT NULL THEN
    SELECT a.attnum INTO v_link_merchant_attnum
    FROM pg_attribute a WHERE a.attrelid=v_link_table_oid AND a.attname='merchant_id' AND a.attnum>0 AND NOT a.attisdropped;
    SELECT a.attnum INTO v_link_workspace_attnum
    FROM pg_attribute a WHERE a.attrelid=v_link_table_oid AND a.attname='workspace_id' AND a.attnum>0 AND NOT a.attisdropped;
    SELECT a.attnum INTO v_link_created_by_attnum
    FROM pg_attribute a WHERE a.attrelid=v_link_table_oid AND a.attname='created_by' AND a.attnum>0 AND NOT a.attisdropped;

    SELECT
      EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=v_link_table_oid AND a.attname='merchant_id' AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND format_type(a.atttypid,a.atttypmod)='uuid')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=v_link_table_oid AND a.attname='workspace_id' AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND format_type(a.atttypid,a.atttypmod)='uuid')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=v_link_table_oid AND a.attname='link_version' AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND format_type(a.atttypid,a.atttypmod)='bigint')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=v_link_table_oid AND a.attname='reconcile_idempotency_key' AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND format_type(a.atttypid,a.atttypmod)='text')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=v_link_table_oid AND a.attname='created_by' AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND format_type(a.atttypid,a.atttypmod)='uuid')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=v_link_table_oid AND a.attname='created_at' AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND format_type(a.atttypid,a.atttypmod)='timestamp with time zone')
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_link_table_oid AND c.conname='merchant_canonical_workspaces_pkey' AND c.contype='p'::"char" AND c.conkey=ARRAY[v_link_merchant_attnum]::smallint[] AND c.convalidated)
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_link_table_oid AND c.conname='merchant_canonical_workspaces_workspace_key' AND c.contype='u'::"char" AND c.conkey=ARRAY[v_link_workspace_attnum]::smallint[] AND c.convalidated)
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_link_table_oid AND c.conname='merchant_canonical_workspaces_reconcile_key' AND c.contype='u'::"char" AND c.convalidated)
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_link_table_oid AND c.conname='merchant_canonical_workspaces_merchant_fkey' AND c.contype='f'::"char" AND c.conkey=ARRAY[v_link_merchant_attnum]::smallint[] AND c.confrelid=v_merchants_oid AND c.confkey=ARRAY[v_merchant_id_attnum]::smallint[] AND c.convalidated)
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_link_table_oid AND c.conname='merchant_canonical_workspaces_created_by_fkey' AND c.contype='f'::"char" AND c.conkey=ARRAY[v_link_created_by_attnum]::smallint[] AND c.confrelid=v_auth_users_oid AND c.convalidated)
      AND EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid=v_link_table_oid AND c.conname='merchant_canonical_workspaces_workspace_owner_fkey' AND c.contype='f'::"char" AND c.conkey=ARRAY[v_link_workspace_attnum,v_link_merchant_attnum]::smallint[] AND c.confrelid=v_workspaces_oid AND c.confkey=ARRAY[v_workspace_id_attnum,v_workspace_merchant_attnum]::smallint[] AND c.convalidated)
    INTO v_existing_link_contract_ok;

    IF NOT v_existing_link_contract_ok THEN
      RAISE EXCEPTION 'Migration 029 prerequisite failed: existing canonical workspace authority is incompatible';
    END IF;
  END IF;
END;
$migration_029_prerequisites$;

-- A unique composite index is supporting metadata only. It allows the
-- canonical table to prove that its workspace is owned by its merchant.
CREATE UNIQUE INDEX IF NOT EXISTS merchant_canonical_workspace_supporting_owner_key
  ON public.workspaces (id, merchant_id);

CREATE TABLE IF NOT EXISTS public.merchant_canonical_workspaces (
  merchant_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  link_version bigint NOT NULL DEFAULT 1,
  reconcile_idempotency_key text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_canonical_workspaces_pkey PRIMARY KEY (merchant_id),
  CONSTRAINT merchant_canonical_workspaces_workspace_key UNIQUE (workspace_id),
  CONSTRAINT merchant_canonical_workspaces_reconcile_key UNIQUE (reconcile_idempotency_key),
  CONSTRAINT merchant_canonical_workspaces_version_check CHECK (link_version = 1),
  CONSTRAINT merchant_canonical_workspaces_key_check CHECK (length(btrim(reconcile_idempotency_key)) > 0),
  CONSTRAINT merchant_canonical_workspaces_merchant_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_canonical_workspaces_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT merchant_canonical_workspaces_workspace_owner_fkey
    FOREIGN KEY (workspace_id, merchant_id)
    REFERENCES public.workspaces(id, merchant_id) ON DELETE RESTRICT
);

ALTER TABLE public.merchant_canonical_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_canonical_workspaces NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.merchant_canonical_workspaces FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.merchant_canonical_workspaces TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_canonical_merchant_workspace_link_v1(
  p_merchant_id uuid,
  p_reconciled_by uuid,
  p_reconcile_idempotency_key text
)
RETURNS TABLE(result_code text, merchant_id uuid, workspace_id uuid, link_version bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $reconcile_canonical_merchant_workspace_link_v1$
DECLARE
  v_workspace_candidate_count integer;
  v_workspace_candidate_id uuid;
  v_existing public.merchant_canonical_workspaces%ROWTYPE;
  v_existing_key_merchant_id uuid;
  v_key text;
BEGIN
  v_key := NULLIF(btrim(COALESCE(p_reconcile_idempotency_key, '')), '');
  IF p_merchant_id IS NULL OR p_reconciled_by IS NULL OR v_key IS NULL THEN
    RETURN QUERY SELECT 'canonical_workspace_link_payload_invalid', NULL::uuid, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_reconciled_by) THEN
    RETURN QUERY SELECT 'canonical_workspace_link_reconciler_invalid', NULL::uuid, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;

  PERFORM 1 FROM public.merchants m WHERE m.id = p_merchant_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'canonical_workspace_link_merchant_missing', NULL::uuid, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;

  SELECT count(*)
  INTO v_workspace_candidate_count
  FROM public.workspaces workspace_candidate
  WHERE workspace_candidate.merchant_id = p_merchant_id;

  IF v_workspace_candidate_count = 0 THEN
    RETURN QUERY SELECT 'canonical_workspace_link_unavailable', p_merchant_id, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;
  IF v_workspace_candidate_count <> 1 THEN
    RETURN QUERY SELECT 'canonical_workspace_link_ambiguous', p_merchant_id, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;

  SELECT workspace_candidate.id INTO v_workspace_candidate_id
  FROM public.workspaces workspace_candidate
  WHERE workspace_candidate.merchant_id = p_merchant_id;

  SELECT * INTO v_existing
  FROM public.merchant_canonical_workspaces canonical_link
  WHERE canonical_link.merchant_id = p_merchant_id;
  IF FOUND THEN
    IF v_existing.workspace_id = v_workspace_candidate_id
      AND v_existing.reconcile_idempotency_key = v_key
      AND v_existing.created_by = p_reconciled_by THEN
      RETURN QUERY SELECT 'canonical_workspace_link_replay', v_existing.merchant_id, v_existing.workspace_id, v_existing.link_version;
    ELSIF v_existing.workspace_id = v_workspace_candidate_id THEN
      RETURN QUERY SELECT 'canonical_workspace_link_idempotency_mismatch', p_merchant_id, NULL::uuid, NULL::bigint;
    ELSE
      RETURN QUERY SELECT 'canonical_workspace_link_conflict', p_merchant_id, NULL::uuid, NULL::bigint;
    END IF;
    RETURN;
  END IF;

  SELECT canonical_link.merchant_id INTO v_existing_key_merchant_id
  FROM public.merchant_canonical_workspaces canonical_link
  WHERE canonical_link.reconcile_idempotency_key = v_key;
  IF FOUND THEN
    RETURN QUERY SELECT 'canonical_workspace_link_idempotency_mismatch', NULL::uuid, NULL::uuid, NULL::bigint;
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.merchant_canonical_workspaces (
      merchant_id, workspace_id, link_version, reconcile_idempotency_key, created_by
    ) VALUES (
      p_merchant_id, v_workspace_candidate_id, 1, v_key, p_reconciled_by
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.merchant_canonical_workspaces canonical_link
    WHERE canonical_link.merchant_id = p_merchant_id;
    IF FOUND AND v_existing.workspace_id = v_workspace_candidate_id
      AND v_existing.reconcile_idempotency_key = v_key
      AND v_existing.created_by = p_reconciled_by THEN
      RETURN QUERY SELECT 'canonical_workspace_link_replay', v_existing.merchant_id, v_existing.workspace_id, v_existing.link_version;
    END IF;
    RETURN QUERY SELECT 'canonical_workspace_link_conflict', p_merchant_id, NULL::uuid, NULL::bigint;
    RETURN;
  WHEN OTHERS THEN
    RETURN QUERY SELECT 'canonical_workspace_link_failed', NULL::uuid, NULL::uuid, NULL::bigint;
    RETURN;
  END;

  RETURN QUERY SELECT 'canonical_workspace_link_created', p_merchant_id, v_workspace_candidate_id, 1::bigint;
END;
$reconcile_canonical_merchant_workspace_link_v1$;

REVOKE ALL ON FUNCTION public.reconcile_canonical_merchant_workspace_link_v1(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_canonical_merchant_workspace_link_v1(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
