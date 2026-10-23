-- Phase 2C-2C-B2: draft-only, non-adopted review triage and correction.
-- The existing B1 submit command owns all replacement snapshot validation.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $b2_preflight$
BEGIN
  IF to_regprocedure('public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)') IS NULL
    OR to_regprocedure('public.freeze_submitted_plan_review_v1()') IS NULL
    OR to_regclass('public.merchants') IS NULL
    OR to_regclass('public.merchant_canonical_workspaces') IS NULL
    OR to_regclass('public.merchant_compliance_profiles') IS NULL
    OR to_regclass('public.merchant_compliance_reviews') IS NULL
    OR to_regclass('public.merchant_compliance_events') IS NULL THEN
    RAISE EXCEPTION 'Phase 2C B2 prerequisite missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.merchants'::regclass, 'is_super_admin', 'boolean'::regtype),
      ('public.merchants'::regclass, 'user_id', 'uuid'::regtype),
      ('public.merchants'::regclass, 'subscription_plan', 'text'::regtype),
      ('public.merchant_canonical_workspaces'::regclass, 'merchant_id', 'uuid'::regtype),
      ('public.merchant_canonical_workspaces'::regclass, 'workspace_id', 'uuid'::regtype),
      ('public.merchant_compliance_profiles'::regclass, 'id', 'uuid'::regtype),
      ('public.merchant_compliance_profiles'::regclass, 'merchant_id', 'uuid'::regtype),
      ('public.merchant_compliance_profiles'::regclass, 'plan_code', 'text'::regtype),
      ('public.merchant_compliance_profiles'::regclass, 'row_version', 'bigint'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'id', 'uuid'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'merchant_id', 'uuid'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'profile_id', 'uuid'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'review_status', 'text'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'evidence_snapshot', 'jsonb'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'decision_reason_code', 'text'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'reviewed_by', 'uuid'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'reviewed_at', 'timestamp with time zone'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'row_version', 'bigint'::regtype),
      ('public.merchant_compliance_events'::regclass, 'resulting_row_version', 'bigint'::regtype)
    ) AS expected(table_oid, column_name, type_oid)
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = expected.table_oid
      AND a.attname = expected.column_name AND a.attnum > 0 AND NOT a.attisdropped
    WHERE a.atttypid IS DISTINCT FROM expected.type_oid
  ) THEN RAISE EXCEPTION 'Phase 2C B2 column prerequisite incompatible'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.merchant_compliance_reviews'::regclass
      AND tgname = 'trg_freeze_submitted_plan_review_v1' AND NOT tgisinternal AND tgenabled = 'O'
      AND tgtype = 19 AND tgqual IS NULL AND tgattr = ''::int2vector
      AND tgfoid = 'public.freeze_submitted_plan_review_v1()'::regprocedure
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)'::regprocedure
      AND p.prosecdef AND p.proowner = pg_catalog.to_regrole(current_user)::oid
      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
  ) OR has_table_privilege('service_role', 'public.merchant_compliance_reviews', 'UPDATE')
    OR NOT has_function_privilege('service_role',
      'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('anon',
      'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 2C B2 B1 security prerequisite incompatible';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid IN ('public.merchant_compliance_profiles'::regclass,
        'public.merchant_compliance_reviews'::regclass,'public.merchant_compliance_events'::regclass)
        AND NOT tgisinternal AND NOT (tgrelid='public.merchant_compliance_reviews'::regclass
          AND tgname='trg_freeze_submitted_plan_review_v1'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class
      WHERE oid IN ('public.merchant_compliance_profiles'::regclass,
        'public.merchant_compliance_reviews'::regclass,'public.merchant_compliance_events'::regclass)
        AND (NOT relrowsecurity OR relforcerowsecurity))
    OR EXISTS (SELECT 1 FROM (VALUES
      ('public.merchant_compliance_reviews','anon'),('public.merchant_compliance_reviews','authenticated'),
      ('public.merchant_compliance_events','anon'),('public.merchant_compliance_events','authenticated')
    ) AS target(table_name,role_name)
      WHERE has_table_privilege(target.role_name,target.table_name,'INSERT')
        OR has_table_privilege(target.role_name,target.table_name,'UPDATE')) THEN
    RAISE EXCEPTION 'Phase 2C B2 trigger or table security prerequisite incompatible';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
    ('public.merchant_compliance_reviews'::regclass,'uq_merchant_compliance_reviews_idempotency'),
    ('public.merchant_compliance_events'::regclass,'uq_merchant_compliance_events_idempotency')
  ) AS target(table_oid,constraint_name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid=target.table_oid AND c.conname=target.constraint_name AND c.contype='u'
        AND c.convalidated AND NOT c.condeferrable
        AND c.conkey=ARRAY[
          (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=target.table_oid AND attname='merchant_id'),
          (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=target.table_oid AND attname='idempotency_key')]
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i
          WHERE i.indexrelid=c.conindid AND i.indisvalid AND i.indisunique))) THEN
    RAISE EXCEPTION 'Phase 2C B2 merchant idempotency prerequisite incompatible';
  END IF;
  IF current_user IN ('anon', 'authenticated', 'service_role')
    OR NOT has_table_privilege(current_user, 'public.merchants', 'UPDATE')
    OR NOT has_table_privilege(current_user, 'public.merchant_compliance_profiles', 'UPDATE')
    OR NOT has_table_privilege(current_user, 'public.merchant_compliance_reviews', 'UPDATE')
    OR NOT has_table_privilege(current_user, 'public.merchant_compliance_events', 'INSERT')
    OR EXISTS (SELECT 1 FROM (VALUES ('public.merchants'),
      ('public.merchant_canonical_workspaces'),('public.merchant_compliance_profiles'),
      ('public.merchant_compliance_reviews'),('public.merchant_compliance_events')) AS t(name)
      WHERE NOT has_table_privilege(current_user,t.name,'SELECT'))
    OR NOT has_table_privilege(current_user,'public.merchant_compliance_reviews','INSERT')
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = current_user
        AND (r.rolsuper OR r.rolbypassrls OR NOT EXISTS (
          SELECT 1 FROM (VALUES ('public.merchants'::regclass),
            ('public.merchant_canonical_workspaces'::regclass),
            ('public.merchant_compliance_profiles'::regclass),
            ('public.merchant_compliance_reviews'::regclass),
            ('public.merchant_compliance_events'::regclass)) AS t(oid)
          JOIN pg_catalog.pg_class c ON c.oid = t.oid
          WHERE c.relowner <> r.oid OR c.relforcerowsecurity
        ))
    ) THEN RAISE EXCEPTION 'Phase 2C B2 function owner prerequisite incompatible'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN
      ('request_draft_plan_review_correction_v1', 'resubmit_corrected_draft_plan_review_v1')
  ) THEN RAISE EXCEPTION 'Phase 2C B2 RPC already exists'; END IF;
END;
$b2_preflight$;

CREATE FUNCTION public.request_draft_plan_review_correction_v1(
  p_merchant_id uuid, p_workspace_id uuid, p_profile_id uuid, p_review_id uuid,
  p_expected_review_row_version bigint, p_expected_profile_row_version bigint,
  p_reviewer_id uuid, p_policy_version text, p_reason_code text,
  p_requested_finding_codes text[], p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $b2_rmi$
DECLARE
  v_admin_merchant_id uuid;
  v_merchant public.merchants%ROWTYPE;
  v_profile public.merchant_compliance_profiles%ROWTYPE;
  v_review public.merchant_compliance_reviews%ROWTYPE;
  v_event public.merchant_compliance_events%ROWTYPE;
  v_workspace_id uuid;
  v_plan text;
  v_source_type text;
  v_codes text[];
  v_event_id uuid;
  v_new_version bigint;
  v_snapshot_hash text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'unsupported_isolation');
  END IF;
  IF p_merchant_id IS NULL OR p_workspace_id IS NULL OR p_profile_id IS NULL OR p_review_id IS NULL
    OR p_reviewer_id IS NULL OR p_expected_review_row_version IS NULL OR p_expected_review_row_version < 1
    OR p_expected_review_row_version = 9223372036854775807
    OR p_expected_profile_row_version IS NULL OR p_expected_profile_row_version < 1
    OR p_policy_version IS DISTINCT FROM '2c-2b-draft-v1'
    OR p_reason_code IS NULL OR p_reason_code NOT IN
      ('evidence_incomplete', 'evidence_expired', 'evidence_mismatch', 'reviewer_requested_correction')
    OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9_:-]{7,127}$'
    OR p_requested_finding_codes IS NULL
    OR pg_catalog.array_ndims(p_requested_finding_codes) IS DISTINCT FROM 1
    OR COALESCE(pg_catalog.cardinality(p_requested_finding_codes), 0) NOT BETWEEN 1 AND 32 THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'invalid_transition');
  END IF;
  -- The server supplies an authenticated identity; this lookup is rechecked
  -- under ordered merchant locks so a concurrent authority revocation wins or waits.
  SELECT id INTO v_admin_merchant_id FROM public.merchants
  WHERE user_id = p_reviewer_id AND is_super_admin = true ORDER BY id LIMIT 1;
  IF v_admin_merchant_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'reviewer_unauthorized');
  END IF;
  -- Lock all involved merchant rows in ID order, then profile, then review.
  -- NO KEY UPDATE serializes B1/B2 but permits event-FK KEY SHARE checks.
  PERFORM 1 FROM public.merchants
  WHERE id IN (p_merchant_id, v_admin_merchant_id) ORDER BY id FOR NO KEY UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE id = v_admin_merchant_id
      AND user_id = p_reviewer_id AND is_super_admin = true) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'reviewer_unauthorized');
  END IF;
  SELECT * INTO v_merchant FROM public.merchants WHERE id = p_merchant_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict'); END IF;
  v_plan := CASE pg_catalog.lower(pg_catalog.btrim(v_merchant.subscription_plan))
    WHEN 'individual' THEN 'solo_lite' WHEN 'solo_lite' THEN 'solo_lite'
    WHEN 'corporate' THEN 'business' WHEN 'business' THEN 'business' ELSE NULL END;
  IF v_plan IS NULL THEN RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict'); END IF;
  v_source_type := CASE v_plan WHEN 'solo_lite' THEN 'solo_lite_review' ELSE 'business_kyb_review' END;
  SELECT workspace_id INTO v_workspace_id FROM public.merchant_canonical_workspaces
  WHERE merchant_id = p_merchant_id;
  IF NOT FOUND OR v_workspace_id IS DISTINCT FROM p_workspace_id THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  SELECT * INTO v_profile FROM public.merchant_compliance_profiles
  WHERE merchant_id = p_merchant_id FOR UPDATE;
  IF NOT FOUND OR v_profile.id IS DISTINCT FROM p_profile_id
    OR v_profile.plan_code IS DISTINCT FROM v_plan THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  SELECT * INTO v_review FROM public.merchant_compliance_reviews
  WHERE id = p_review_id AND merchant_id = p_merchant_id AND profile_id = p_profile_id FOR UPDATE;
  IF NOT FOUND OR v_review.target_plan_code IS DISTINCT FROM v_plan
    OR v_review.review_type IS DISTINCT FROM (CASE v_plan WHEN 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END)
    OR v_review.policy_version IS DISTINCT FROM p_policy_version
    OR v_review.submitted_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF pg_catalog.jsonb_typeof(v_review.evidence_snapshot -> 'findings') IS DISTINCT FROM 'array' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(p_requested_finding_codes) AS requested(code)
      WHERE requested.code IS NULL OR requested.code !~ '^[a-z][a-z0-9_]{1,63}$'
        OR (v_plan = 'solo_lite' AND requested.code NOT IN
          ('legal_name','email_contact','phone','bvn','bvn_name_match',
           'selfie_face_match','distinct_liveness','nin','government_id','declared_address',
           'address_evidence','activity_nature','expected_transaction_profile','manual_review'))
        OR (v_plan = 'business' AND requested.code NOT IN
          ('legal_name','registration_number','registration_status','registered_address',
           'operating_address','tin','activity_nature','expected_transaction_profile',
           'directors','shareholders_members','partners','trustees','representatives',
           'signatories','senior_management','beneficial_owners','controllers','documents',
           'approved_volume','manual_review'))
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_review.evidence_snapshot -> 'findings') AS f(value)
          WHERE f.value ->> 'code' = requested.code))
    OR (SELECT count(*) FROM pg_catalog.unnest(p_requested_finding_codes)) <>
       (SELECT count(DISTINCT requested.code) FROM pg_catalog.unnest(p_requested_finding_codes) AS requested(code)) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'invalid_transition');
  END IF;
  SELECT pg_catalog.array_agg(requested.code ORDER BY requested.code) INTO v_codes
  FROM pg_catalog.unnest(p_requested_finding_codes) AS requested(code);
  v_snapshot_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_review.evidence_snapshot::text, 'UTF8')), 'hex');
  SELECT * INTO v_event FROM public.merchant_compliance_events
  WHERE merchant_id = p_merchant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_event.profile_id = p_profile_id AND v_event.source_id = p_review_id
      AND v_event.source_type = v_source_type
      AND v_event.event_type = 'phase2c_draft_review_needs_attention_v1'
      AND v_event.actor_type = 'admin' AND v_event.actor_id = p_reviewer_id
      AND v_event.policy_version = p_policy_version AND v_event.reason_code = p_reason_code
      AND v_event.notes IS NULL
      AND (SELECT count(*) FROM public.merchant_compliance_events duplicate
        WHERE duplicate.merchant_id=p_merchant_id AND duplicate.profile_id=p_profile_id
          AND duplicate.source_id=p_review_id
          AND duplicate.event_type='phase2c_draft_review_needs_attention_v1'
          AND duplicate.resulting_row_version=p_expected_review_row_version+1)=1
      AND v_event.expected_row_version = p_expected_review_row_version
      AND v_event.resulting_row_version = p_expected_review_row_version + 1
      AND v_event.from_state = '{"review_status":"pending"}'::jsonb
      AND v_event.to_state = '{"review_status":"needs_attention"}'::jsonb
      AND v_event.metadata = pg_catalog.jsonb_build_object(
        'workspace_id', p_workspace_id, 'profile_row_version', p_expected_profile_row_version,
        'requested_finding_codes', pg_catalog.to_jsonb(v_codes),
        'snapshot_sha256', v_snapshot_hash, 'evidence_trust', 'unverified_diagnostic')
      AND v_review.reviewed_by = p_reviewer_id
      AND (
        (v_review.row_version = v_event.resulting_row_version
          AND v_review.review_status = 'needs_attention'
          AND v_review.decision_reason_code = p_reason_code)
        OR (v_review.row_version - v_event.resulting_row_version = 1
          AND v_review.review_status = 'cancelled'
          AND v_review.decision_reason_code = 'superseded_by_corrected_submission'
          AND (SELECT count(*) FROM public.merchant_compliance_events duplicate
            WHERE duplicate.merchant_id=p_merchant_id AND duplicate.profile_id=p_profile_id
              AND duplicate.source_id=p_review_id
              AND duplicate.event_type='phase2c_draft_review_superseded_v1'
              AND duplicate.resulting_row_version=v_review.row_version)=1
          AND (SELECT count(*) FROM public.merchant_compliance_events successor
            JOIN public.merchant_compliance_reviews replacement
              ON replacement.id::text = successor.metadata ->> 'new_review_id'
            JOIN public.merchant_compliance_events submitted
              ON submitted.id::text = successor.metadata ->> 'new_event_id'
            WHERE successor.merchant_id = p_merchant_id AND successor.profile_id = p_profile_id
              AND successor.source_id = p_review_id AND successor.source_type = v_source_type
              AND successor.event_type = 'phase2c_draft_review_superseded_v1'
              AND successor.actor_type = 'merchant' AND successor.actor_id IS NOT NULL
              AND successor.policy_version = p_policy_version
              AND successor.reason_code = 'superseded_by_corrected_submission'
              AND successor.notes IS NULL
              AND successor.expected_row_version = v_event.resulting_row_version
              AND successor.resulting_row_version = v_review.row_version
              AND successor.from_state = '{"review_status":"needs_attention"}'::jsonb
              AND successor.to_state = '{"review_status":"cancelled"}'::jsonb
              AND replacement.id <> p_review_id AND replacement.merchant_id = p_merchant_id
              AND replacement.profile_id = p_profile_id AND replacement.review_type = v_review.review_type
              AND replacement.target_plan_code = v_plan AND replacement.policy_version = p_policy_version
              AND replacement.submitted_at IS NOT NULL AND replacement.row_version >= 1
              AND replacement.review_status <> 'draft'
              AND replacement.idempotency_key = successor.idempotency_key || ':new'
              AND submitted.merchant_id = p_merchant_id AND submitted.profile_id = p_profile_id
              AND submitted.source_id = replacement.id AND submitted.source_type = v_source_type
              AND submitted.event_type = 'phase2c_draft_review_submit_v1'
              AND submitted.actor_type = 'merchant' AND submitted.actor_id = successor.actor_id
              AND submitted.policy_version = p_policy_version
              AND submitted.idempotency_key = replacement.idempotency_key
              AND (SELECT count(*) FROM public.merchant_compliance_events duplicate
                WHERE duplicate.merchant_id=p_merchant_id AND duplicate.source_id=replacement.id
                  AND duplicate.event_type='phase2c_draft_review_submit_v1'
                  AND duplicate.resulting_row_version=1)=1
              AND submitted.expected_row_version IS NULL AND submitted.resulting_row_version = 1
              AND submitted.reason_code IS NULL AND submitted.from_state = '{}'::jsonb
              AND submitted.notes IS NULL
              AND submitted.to_state = '{"review_status":"pending"}'::jsonb
              AND submitted.metadata = pg_catalog.jsonb_build_object(
                'workspace_id', p_workspace_id, 'profile_row_version', p_expected_profile_row_version,
                'snapshot_sha256', pg_catalog.encode(pg_catalog.sha256(
                  pg_catalog.convert_to(replacement.evidence_snapshot::text, 'UTF8')), 'hex'),
                'policy_id', CASE v_plan WHEN 'solo_lite' THEN 'solo_lite_evidence' ELSE 'business_kyb_evidence' END,
                'evidence_trust', 'unverified_diagnostic')
              AND successor.metadata = pg_catalog.jsonb_build_object(
                'workspace_id', p_workspace_id, 'profile_row_version', p_expected_profile_row_version,
                'old_snapshot_sha256', v_snapshot_hash,
                'new_snapshot_sha256', submitted.metadata ->> 'snapshot_sha256',
                'new_review_id', replacement.id, 'new_event_id', submitted.id,
                'new_idempotency_key', replacement.idempotency_key,
                'evidence_trust', 'unverified_diagnostic')) = 1)
      ) THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'already_processed', 'review_id', p_review_id,
        'event_id', v_event.id, 'row_version', v_event.resulting_row_version);
    END IF;
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_reviews
      WHERE merchant_id = p_merchant_id AND idempotency_key = p_idempotency_key) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF (SELECT count(*) FROM public.merchant_compliance_reviews
      WHERE merchant_id = p_merchant_id AND target_plan_code = v_plan
        AND review_status IN ('pending', 'needs_attention') AND id <> p_review_id) <> 0 THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF v_profile.row_version IS DISTINCT FROM p_expected_profile_row_version
    OR v_review.row_version IS DISTINCT FROM p_expected_review_row_version THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'version_conflict');
  END IF;
  IF v_review.review_status IS DISTINCT FROM 'pending' OR v_review.row_version IS DISTINCT FROM 1
    OR v_review.decision_reason_code IS NOT NULL OR v_review.reviewed_by IS NOT NULL
    OR v_review.reviewed_at IS NOT NULL
    OR (SELECT count(*) FROM public.merchant_compliance_events duplicate
      WHERE duplicate.merchant_id=p_merchant_id AND duplicate.source_id=p_review_id
        AND duplicate.event_type='phase2c_draft_review_submit_v1'
        AND duplicate.resulting_row_version=1)<>1
    OR NOT EXISTS (SELECT 1 FROM public.merchant_compliance_events e
      WHERE e.merchant_id = p_merchant_id AND e.profile_id = p_profile_id
        AND e.source_id = p_review_id AND e.source_type = v_source_type
        AND e.idempotency_key = v_review.idempotency_key
        AND e.event_type = 'phase2c_draft_review_submit_v1'
        AND e.actor_type = 'merchant' AND e.actor_id = v_merchant.user_id
        AND e.policy_version = p_policy_version AND e.resulting_row_version = 1
        AND e.expected_row_version IS NULL AND e.reason_code IS NULL
        AND e.from_state = '{}'::jsonb
        AND e.to_state = '{"review_status":"pending"}'::jsonb
        AND e.metadata = pg_catalog.jsonb_build_object(
          'workspace_id', p_workspace_id, 'profile_row_version', p_expected_profile_row_version,
          'snapshot_sha256', v_snapshot_hash,
          'policy_id', CASE v_plan WHEN 'solo_lite' THEN 'solo_lite_evidence' ELSE 'business_kyb_evidence' END,
          'evidence_trust', 'unverified_diagnostic')) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  BEGIN
    UPDATE public.merchant_compliance_reviews SET review_status = 'needs_attention',
      decision_reason_code = p_reason_code, reviewed_by = p_reviewer_id,
      reviewed_at = pg_catalog.now(), row_version = row_version + 1,
      updated_at = pg_catalog.now()
    WHERE id = p_review_id AND row_version = p_expected_review_row_version
    RETURNING row_version INTO v_new_version;
    IF v_new_version IS DISTINCT FROM p_expected_review_row_version + 1 THEN
      RAISE EXCEPTION 'Phase 2C B2 RMI version incompatible';
    END IF;
    v_event_id := pg_catalog.gen_random_uuid();
    INSERT INTO public.merchant_compliance_events (
      id, merchant_id, profile_id, event_type, from_state, to_state, reason_code,
      actor_type, actor_id, source_type, source_id, policy_version, idempotency_key,
      expected_row_version, resulting_row_version, metadata
    ) VALUES (
      v_event_id, p_merchant_id, p_profile_id, 'phase2c_draft_review_needs_attention_v1',
      '{"review_status":"pending"}'::jsonb, '{"review_status":"needs_attention"}'::jsonb,
      p_reason_code, 'admin', p_reviewer_id, v_source_type, p_review_id, p_policy_version,
      p_idempotency_key, p_expected_review_row_version, v_new_version,
      pg_catalog.jsonb_build_object('workspace_id', p_workspace_id,
        'profile_row_version', p_expected_profile_row_version,
        'requested_finding_codes', pg_catalog.to_jsonb(v_codes),
        'snapshot_sha256', v_snapshot_hash, 'evidence_trust', 'unverified_diagnostic')
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END;
  RETURN pg_catalog.jsonb_build_object('kind', 'applied', 'review_id', p_review_id,
    'event_id', v_event_id, 'row_version', v_new_version);
END;
$b2_rmi$;

REVOKE ALL ON FUNCTION public.request_draft_plan_review_correction_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_draft_plan_review_correction_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text
) TO service_role;

CREATE FUNCTION public.resubmit_corrected_draft_plan_review_v1(
  p_merchant_id uuid, p_workspace_id uuid, p_profile_id uuid, p_old_review_id uuid,
  p_expected_old_row_version bigint, p_expected_profile_row_version bigint,
  p_actor_id uuid, p_policy_version text, p_new_evidence_snapshot jsonb, p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $b2_resubmit$
DECLARE
  v_merchant public.merchants%ROWTYPE;
  v_profile public.merchant_compliance_profiles%ROWTYPE;
  v_old public.merchant_compliance_reviews%ROWTYPE;
  v_event public.merchant_compliance_events%ROWTYPE;
  v_new_event public.merchant_compliance_events%ROWTYPE;
  v_new_review public.merchant_compliance_reviews%ROWTYPE;
  v_rmi_event public.merchant_compliance_events%ROWTYPE;
  v_plan text;
  v_source_type text;
  v_workspace_id uuid;
  v_old_hash text;
  v_new_hash text;
  v_new_key text;
  v_new_version bigint;
  v_submit jsonb;
  v_event_id uuid;
  v_abort_kind text;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'unsupported_isolation');
  END IF;
  IF p_merchant_id IS NULL OR p_workspace_id IS NULL OR p_profile_id IS NULL
    OR p_old_review_id IS NULL OR p_actor_id IS NULL
    OR p_expected_old_row_version IS NULL OR p_expected_old_row_version < 1
    OR p_expected_old_row_version = 9223372036854775807
    OR p_expected_profile_row_version IS NULL OR p_expected_profile_row_version < 1
    OR p_policy_version IS DISTINCT FROM '2c-2b-draft-v1'
    OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9_:-]{7,123}$' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'invalid_transition');
  END IF;
  v_new_key := p_idempotency_key || ':new';
  SELECT * INTO v_merchant FROM public.merchants
  WHERE id = p_merchant_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_merchant.user_id IS DISTINCT FROM p_actor_id THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'actor_unauthorized');
  END IF;
  v_plan := CASE pg_catalog.lower(pg_catalog.btrim(v_merchant.subscription_plan))
    WHEN 'individual' THEN 'solo_lite' WHEN 'solo_lite' THEN 'solo_lite'
    WHEN 'corporate' THEN 'business' WHEN 'business' THEN 'business' ELSE NULL END;
  IF v_plan IS NULL THEN RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict'); END IF;
  v_source_type := CASE v_plan WHEN 'solo_lite' THEN 'solo_lite_review' ELSE 'business_kyb_review' END;
  SELECT workspace_id INTO v_workspace_id FROM public.merchant_canonical_workspaces
  WHERE merchant_id = p_merchant_id;
  IF NOT FOUND OR v_workspace_id IS DISTINCT FROM p_workspace_id THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  SELECT * INTO v_profile FROM public.merchant_compliance_profiles
  WHERE merchant_id = p_merchant_id FOR UPDATE;
  IF NOT FOUND OR v_profile.id IS DISTINCT FROM p_profile_id
    OR v_profile.plan_code IS DISTINCT FROM v_plan THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  SELECT * INTO v_old FROM public.merchant_compliance_reviews
  WHERE id = p_old_review_id AND merchant_id = p_merchant_id AND profile_id = p_profile_id FOR UPDATE;
  IF NOT FOUND OR v_old.target_plan_code IS DISTINCT FROM v_plan
    OR v_old.review_type IS DISTINCT FROM (CASE v_plan WHEN 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END)
    OR v_old.policy_version IS DISTINCT FROM p_policy_version OR v_old.submitted_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF p_new_evidence_snapshot IS NULL OR p_new_evidence_snapshot = v_old.evidence_snapshot
    OR pg_catalog.jsonb_typeof(p_new_evidence_snapshot) IS DISTINCT FROM 'object'
    OR pg_catalog.octet_length(p_new_evidence_snapshot::text) > 16384 THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'evidence_conflict');
  END IF;
  v_old_hash := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(v_old.evidence_snapshot::text, 'UTF8')), 'hex');
  v_new_hash := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(p_new_evidence_snapshot::text, 'UTF8')), 'hex');
  SELECT * INTO v_event FROM public.merchant_compliance_events
  WHERE merchant_id = p_merchant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT * INTO v_new_event FROM public.merchant_compliance_events
    WHERE merchant_id = p_merchant_id AND idempotency_key = v_new_key;
    IF FOUND THEN
      SELECT * INTO v_new_review FROM public.merchant_compliance_reviews
      WHERE id = v_new_event.source_id AND merchant_id = p_merchant_id AND profile_id = p_profile_id;
    END IF;
    IF v_event.profile_id = p_profile_id AND v_event.source_id = p_old_review_id
      AND v_event.source_type = v_source_type
      AND v_event.event_type = 'phase2c_draft_review_superseded_v1'
      AND v_event.actor_type = 'merchant' AND v_event.actor_id = p_actor_id
      AND v_event.policy_version = p_policy_version
      AND v_event.reason_code = 'superseded_by_corrected_submission'
      AND v_event.notes IS NULL
      AND (SELECT count(*) FROM public.merchant_compliance_events duplicate
        WHERE duplicate.merchant_id=p_merchant_id AND duplicate.profile_id=p_profile_id
          AND duplicate.source_id=p_old_review_id
          AND duplicate.event_type='phase2c_draft_review_superseded_v1'
          AND duplicate.resulting_row_version=p_expected_old_row_version+1)=1
      AND v_event.expected_row_version = p_expected_old_row_version
      AND v_event.resulting_row_version = p_expected_old_row_version + 1
      AND v_event.from_state = '{"review_status":"needs_attention"}'::jsonb
      AND v_event.to_state = '{"review_status":"cancelled"}'::jsonb
      AND v_event.metadata = pg_catalog.jsonb_build_object(
        'workspace_id', p_workspace_id, 'profile_row_version', p_expected_profile_row_version,
        'old_snapshot_sha256', v_old_hash, 'new_snapshot_sha256', v_new_hash,
        'new_review_id', v_new_review.id, 'new_event_id', v_new_event.id,
        'new_idempotency_key', v_new_key, 'evidence_trust', 'unverified_diagnostic')
      AND v_old.review_status = 'cancelled' AND v_old.row_version = v_event.resulting_row_version
      AND v_old.decision_reason_code = 'superseded_by_corrected_submission'
      AND v_new_event.profile_id = p_profile_id AND v_new_event.source_id = v_new_review.id
      AND v_new_event.source_type = v_source_type
      AND v_new_event.event_type = 'phase2c_draft_review_submit_v1'
      AND v_new_event.actor_type = 'merchant' AND v_new_event.actor_id = p_actor_id
      AND v_new_event.policy_version = p_policy_version
      AND v_new_event.resulting_row_version = 1
      AND (SELECT count(*) FROM public.merchant_compliance_events duplicate
        WHERE duplicate.merchant_id=p_merchant_id AND duplicate.source_id=v_new_review.id
          AND duplicate.event_type='phase2c_draft_review_submit_v1'
          AND duplicate.resulting_row_version=1)=1
      AND v_new_event.expected_row_version IS NULL AND v_new_event.reason_code IS NULL
      AND v_new_event.notes IS NULL
      AND v_new_event.from_state = '{}'::jsonb
      AND v_new_event.to_state = '{"review_status":"pending"}'::jsonb
      AND v_new_event.metadata = pg_catalog.jsonb_build_object(
        'workspace_id', p_workspace_id, 'profile_row_version', p_expected_profile_row_version,
        'snapshot_sha256', v_new_hash,
        'policy_id', CASE v_plan WHEN 'solo_lite' THEN 'solo_lite_evidence' ELSE 'business_kyb_evidence' END,
        'evidence_trust', 'unverified_diagnostic')
      AND v_new_review.idempotency_key = v_new_key
      AND v_new_review.evidence_snapshot = p_new_evidence_snapshot
      AND v_new_review.policy_version = p_policy_version
      AND v_new_review.review_type = (CASE v_plan WHEN 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END)
      AND v_new_review.target_plan_code = v_plan AND v_new_review.submitted_at IS NOT NULL
      AND v_new_review.id <> p_old_review_id
      AND v_new_review.row_version >= 1 AND v_new_review.review_status <> 'draft' THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'already_processed',
        'old_review_id', p_old_review_id, 'new_review_id', v_new_review.id,
        'event_id', v_event.id, 'new_event_id', v_new_event.id,
        'old_row_version', v_event.resulting_row_version,
        'new_row_version', v_new_event.resulting_row_version);
    END IF;
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_reviews
      WHERE merchant_id = p_merchant_id AND idempotency_key IN (p_idempotency_key, v_new_key))
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_events
      WHERE merchant_id = p_merchant_id AND idempotency_key = v_new_key) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF v_profile.row_version IS DISTINCT FROM p_expected_profile_row_version
    OR v_old.row_version IS DISTINCT FROM p_expected_old_row_version THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'version_conflict');
  END IF;
  IF v_old.review_status IS DISTINCT FROM 'needs_attention'
    OR v_old.row_version IS DISTINCT FROM 2 OR v_old.reviewed_by IS NULL OR v_old.reviewed_at IS NULL
    OR v_old.decision_reason_code IS NULL OR v_old.decision_reason_code NOT IN
      ('evidence_incomplete', 'evidence_expired', 'evidence_mismatch', 'reviewer_requested_correction')
    OR (SELECT count(*) FROM public.merchant_compliance_reviews
      WHERE merchant_id = p_merchant_id AND target_plan_code = v_plan
        AND review_status IN ('pending', 'needs_attention')) <> 1 THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  SELECT * INTO v_rmi_event FROM public.merchant_compliance_events
  WHERE merchant_id = p_merchant_id AND profile_id = p_profile_id
    AND source_id = p_old_review_id AND source_type = v_source_type
    AND event_type = 'phase2c_draft_review_needs_attention_v1'
    AND resulting_row_version = v_old.row_version;
  IF NOT FOUND OR v_rmi_event.policy_version IS DISTINCT FROM p_policy_version
    OR (SELECT count(*) FROM public.merchant_compliance_events
      WHERE merchant_id = p_merchant_id AND profile_id = p_profile_id
        AND source_id = p_old_review_id AND source_type = v_source_type
        AND event_type = 'phase2c_draft_review_needs_attention_v1'
        AND resulting_row_version = v_old.row_version) <> 1
    OR v_rmi_event.actor_type IS DISTINCT FROM 'admin'
    OR v_rmi_event.actor_id IS DISTINCT FROM v_old.reviewed_by
    OR v_rmi_event.reason_code IS DISTINCT FROM v_old.decision_reason_code
    OR v_rmi_event.notes IS NOT NULL
    OR v_rmi_event.expected_row_version IS DISTINCT FROM v_old.row_version - 1
    OR v_rmi_event.from_state IS DISTINCT FROM '{"review_status":"pending"}'::jsonb
    OR v_rmi_event.to_state IS DISTINCT FROM '{"review_status":"needs_attention"}'::jsonb
    OR v_rmi_event.metadata ->> 'workspace_id' IS DISTINCT FROM p_workspace_id::text
    OR v_rmi_event.metadata ->> 'profile_row_version' IS DISTINCT FROM p_expected_profile_row_version::text
    OR v_rmi_event.metadata ->> 'snapshot_sha256' IS DISTINCT FROM v_old_hash
    OR v_rmi_event.metadata ->> 'evidence_trust' IS DISTINCT FROM 'unverified_diagnostic' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF pg_catalog.jsonb_typeof(v_rmi_event.metadata -> 'requested_finding_codes') IS DISTINCT FROM 'array' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF pg_catalog.jsonb_typeof(v_old.evidence_snapshot -> 'findings') IS DISTINCT FROM 'array' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  IF pg_catalog.jsonb_array_length(v_rmi_event.metadata -> 'requested_finding_codes') NOT BETWEEN 1 AND 32
    OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(
      v_rmi_event.metadata -> 'requested_finding_codes') AS requested(value)
      WHERE pg_catalog.jsonb_typeof(requested.value) IS DISTINCT FROM 'string'
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(
          v_old.evidence_snapshot -> 'findings') AS finding(value)
          WHERE finding.value ->> 'code' = (requested.value #>> '{}')))
    OR v_rmi_event.metadata -> 'requested_finding_codes' IS DISTINCT FROM
      (SELECT pg_catalog.jsonb_agg(code ORDER BY code) FROM
        (SELECT DISTINCT requested.code FROM pg_catalog.jsonb_array_elements_text(
          v_rmi_event.metadata -> 'requested_finding_codes') AS requested(code)) AS codes)
    OR v_rmi_event.metadata IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'workspace_id', p_workspace_id, 'profile_row_version', p_expected_profile_row_version,
      'requested_finding_codes', v_rmi_event.metadata -> 'requested_finding_codes',
      'snapshot_sha256', v_old_hash, 'evidence_trust', 'unverified_diagnostic')
    OR NOT EXISTS (SELECT 1 FROM public.merchant_compliance_events submitted
      WHERE submitted.merchant_id = p_merchant_id AND submitted.profile_id = p_profile_id
        AND submitted.source_id = p_old_review_id AND submitted.source_type = v_source_type
        AND submitted.idempotency_key = v_old.idempotency_key
        AND submitted.event_type = 'phase2c_draft_review_submit_v1'
        AND submitted.actor_type = 'merchant' AND submitted.actor_id = p_actor_id
        AND submitted.policy_version = p_policy_version AND submitted.resulting_row_version = 1
        AND submitted.expected_row_version IS NULL AND submitted.reason_code IS NULL
        AND submitted.from_state = '{}'::jsonb
        AND submitted.to_state = '{"review_status":"pending"}'::jsonb
        AND submitted.metadata = pg_catalog.jsonb_build_object(
          'workspace_id', p_workspace_id, 'profile_row_version', p_expected_profile_row_version,
          'snapshot_sha256', v_old_hash,
          'policy_id', CASE v_plan WHEN 'solo_lite' THEN 'solo_lite_evidence' ELSE 'business_kyb_evidence' END,
          'evidence_trust', 'unverified_diagnostic')) THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;
  BEGIN
    UPDATE public.merchant_compliance_reviews SET review_status = 'cancelled',
      decision_reason_code = 'superseded_by_corrected_submission',
      row_version = row_version + 1, updated_at = pg_catalog.now()
    WHERE id = p_old_review_id AND row_version = p_expected_old_row_version
    RETURNING row_version INTO v_new_version;
    IF v_new_version IS DISTINCT FROM p_expected_old_row_version + 1 THEN
      RAISE EXCEPTION 'Phase 2C B2 supersession version incompatible';
    END IF;
    -- B1 validates the complete closed snapshot schema, plan, policy, owner,
    -- profile version and open-review uniqueness, then inserts the new review
    -- and its submission event in this SAME transaction.
    v_submit := public.submit_draft_plan_review_v1(
      p_merchant_id, p_workspace_id, p_expected_profile_row_version,
      p_actor_id, p_policy_version, p_new_evidence_snapshot, v_new_key);
    IF v_submit ->> 'kind' IS DISTINCT FROM 'applied' THEN
      -- Only an OUTER coherent receipt can mean already_processed. A nested
      -- non-applied result must roll back supersession, including nested replay.
      v_abort_kind := CASE WHEN v_submit ->> 'kind' IN
        ('state_conflict','version_conflict','actor_unauthorized','evidence_conflict',
         'invalid_transition','unsupported_isolation') THEN v_submit ->> 'kind'
        ELSE 'state_conflict' END;
      RAISE EXCEPTION USING ERRCODE = 'P2B01', MESSAGE = 'B2 nested submission not applied';
    END IF;
    IF (v_submit ->> 'row_version')::bigint IS DISTINCT FROM 1
      OR v_submit ->> 'review_id' IS NULL OR v_submit ->> 'event_id' IS NULL
      OR (v_submit ->> 'review_id')::uuid IS NOT DISTINCT FROM p_old_review_id THEN
      RAISE EXCEPTION 'Phase 2C B2 replacement version incompatible';
    END IF;
    v_event_id := pg_catalog.gen_random_uuid();
    INSERT INTO public.merchant_compliance_events (
      id, merchant_id, profile_id, event_type, from_state, to_state, reason_code,
      actor_type, actor_id, source_type, source_id, policy_version, idempotency_key,
      expected_row_version, resulting_row_version, metadata
    ) VALUES (
      v_event_id, p_merchant_id, p_profile_id, 'phase2c_draft_review_superseded_v1',
      '{"review_status":"needs_attention"}'::jsonb, '{"review_status":"cancelled"}'::jsonb,
      'superseded_by_corrected_submission', 'merchant', p_actor_id, v_source_type,
      p_old_review_id, p_policy_version, p_idempotency_key,
      p_expected_old_row_version, v_new_version,
      pg_catalog.jsonb_build_object('workspace_id', p_workspace_id,
        'profile_row_version', p_expected_profile_row_version,
        'old_snapshot_sha256', v_old_hash, 'new_snapshot_sha256', v_new_hash,
        'new_review_id', (v_submit ->> 'review_id')::uuid,
        'new_event_id', (v_submit ->> 'event_id')::uuid,
        'new_idempotency_key', v_new_key, 'evidence_trust', 'unverified_diagnostic')
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  WHEN SQLSTATE 'P2B01' THEN
    IF v_abort_kind IS NULL THEN RAISE; END IF;
    RETURN pg_catalog.jsonb_build_object('kind', v_abort_kind);
  END;
  RETURN pg_catalog.jsonb_build_object('kind', 'applied',
    'old_review_id', p_old_review_id, 'new_review_id', (v_submit ->> 'review_id')::uuid,
    'event_id', v_event_id, 'new_event_id', (v_submit ->> 'event_id')::uuid,
    'old_row_version', v_new_version, 'new_row_version', (v_submit ->> 'row_version')::bigint);
END;
$b2_resubmit$;

REVOKE ALL ON FUNCTION public.resubmit_corrected_draft_plan_review_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resubmit_corrected_draft_plan_review_v1(
  uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text
) TO service_role;

DO $b2_postflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid IN (
      'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)'::regprocedure,
      'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)'::regprocedure)
      AND (NOT p.prosecdef OR p.proowner <> pg_catalog.to_regrole(current_user)::oid
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
        OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
          COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          WHERE acl.privilege_type='EXECUTE'
            AND acl.grantee NOT IN (p.proowner,pg_catalog.to_regrole('service_role')::oid)))
  ) OR has_table_privilege('service_role', 'public.merchant_compliance_reviews', 'UPDATE')
    OR has_function_privilege('anon',
      'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role',
      'public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)', 'EXECUTE')
    OR has_function_privilege('anon',
      'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role',
      'public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 2C B2 security postcondition failed';
  END IF;
END;
$b2_postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;
