-- Phase 2C-2C-B1: non-adopted, draft-only Lite/Business review substrate.
-- Installing this migration creates no review and changes no live access decision.
-- The published-policy approval and rejection branches are deliberately absent.

BEGIN;

SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

DO $phase2c_review_preflight$
DECLARE
  v_rpc regprocedure := to_regprocedure('public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)');
  v_guard regprocedure := to_regprocedure('public.freeze_submitted_plan_review_v1()');
BEGIN
  IF to_regclass('public.merchants') IS NULL
    OR to_regclass('public.merchant_canonical_workspaces') IS NULL
    OR to_regclass('public.merchant_compliance_profiles') IS NULL
    OR to_regclass('public.merchant_compliance_reviews') IS NULL
    OR to_regclass('public.merchant_compliance_events') IS NULL THEN
    RAISE EXCEPTION 'Phase 2C review substrate prerequisite missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('public.merchants'::regclass, 'id', 'uuid'::regtype),
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
      ('public.merchant_compliance_reviews'::regclass, 'review_type', 'text'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'target_plan_code', 'text'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'review_status', 'text'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'evidence_snapshot', 'jsonb'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'policy_version', 'text'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'submitted_at', 'timestamptz'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'idempotency_key', 'text'::regtype),
      ('public.merchant_compliance_reviews'::regclass, 'row_version', 'bigint'::regtype),
      ('public.merchant_compliance_events'::regclass, 'id', 'uuid'::regtype),
      ('public.merchant_compliance_events'::regclass, 'merchant_id', 'uuid'::regtype),
      ('public.merchant_compliance_events'::regclass, 'profile_id', 'uuid'::regtype),
      ('public.merchant_compliance_events'::regclass, 'event_type', 'text'::regtype),
      ('public.merchant_compliance_events'::regclass, 'actor_id', 'uuid'::regtype),
      ('public.merchant_compliance_events'::regclass, 'source_id', 'uuid'::regtype),
      ('public.merchant_compliance_events'::regclass, 'idempotency_key', 'text'::regtype),
      ('public.merchant_compliance_events'::regclass, 'metadata', 'jsonb'::regtype),
      ('public.merchant_compliance_events'::regclass, 'resulting_row_version', 'bigint'::regtype)
    ) AS expected(table_oid, column_name, type_oid)
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = expected.table_oid
      AND a.attname = expected.column_name AND a.attnum > 0 AND NOT a.attisdropped
    WHERE a.atttypid IS DISTINCT FROM expected.type_oid
  ) THEN
    RAISE EXCEPTION 'Phase 2C review substrate column prerequisite incompatible';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.merchant_compliance_profiles'::regclass
      AND conname = 'uq_merchant_compliance_profiles_merchant_id' AND contype = 'u'
      AND conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
        WHERE attrelid = 'public.merchant_compliance_profiles'::regclass AND attname = 'merchant_id')]
      AND NOT condeferrable AND convalidated
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = conindid AND indisvalid AND indisunique)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.merchant_compliance_reviews'::regclass
      AND conname = 'uq_merchant_compliance_reviews_idempotency' AND contype = 'u'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute
          WHERE attrelid = 'public.merchant_compliance_reviews'::regclass AND attname = 'merchant_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute
          WHERE attrelid = 'public.merchant_compliance_reviews'::regclass AND attname = 'idempotency_key')]
      AND NOT condeferrable AND convalidated
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = conindid AND indisvalid AND indisunique)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.merchant_compliance_events'::regclass
      AND conname = 'uq_merchant_compliance_events_idempotency' AND contype = 'u'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_catalog.pg_attribute
          WHERE attrelid = 'public.merchant_compliance_events'::regclass AND attname = 'merchant_id'),
        (SELECT attnum FROM pg_catalog.pg_attribute
          WHERE attrelid = 'public.merchant_compliance_events'::regclass AND attname = 'idempotency_key')]
      AND NOT condeferrable AND convalidated
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = conindid AND indisvalid AND indisunique)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.merchant_canonical_workspaces'::regclass
      AND conname = 'merchant_canonical_workspaces_pkey' AND contype = 'p'
      AND conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
        WHERE attrelid = 'public.merchant_canonical_workspaces'::regclass AND attname = 'merchant_id')]
      AND NOT condeferrable AND convalidated
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = conindid AND indisvalid AND indisunique)
  ) THEN
    RAISE EXCEPTION 'Phase 2C review substrate uniqueness prerequisite incompatible';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class WHERE oid = 'public.merchant_compliance_reviews'::regclass
      AND relrowsecurity AND NOT relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class WHERE oid = 'public.merchant_compliance_events'::regclass
      AND relrowsecurity AND NOT relforcerowsecurity
  ) OR has_table_privilege('anon', 'public.merchant_compliance_reviews', 'INSERT')
    OR has_table_privilege('anon', 'public.merchant_compliance_reviews', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.merchant_compliance_reviews', 'INSERT')
    OR has_table_privilege('authenticated', 'public.merchant_compliance_reviews', 'UPDATE')
    OR has_table_privilege('anon', 'public.merchant_compliance_events', 'INSERT')
    OR has_table_privilege('authenticated', 'public.merchant_compliance_events', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_reviews', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_reviews', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_reviews', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_events', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_events', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.merchants', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_profiles', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.merchant_compliance_profiles', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.merchant_canonical_workspaces', 'SELECT') THEN
    RAISE EXCEPTION 'Phase 2C review substrate security prerequisite incompatible';
  END IF;

  -- The trusted migration owner supplies row-lock privileges to the narrow
  -- SECURITY DEFINER command; service_role needs EXECUTE, not merchant UPDATE.
  IF current_user IN ('anon', 'authenticated', 'service_role')
    OR NOT has_table_privilege(current_user, 'public.merchants', 'SELECT')
    OR NOT has_table_privilege(current_user, 'public.merchants', 'UPDATE')
    OR NOT has_table_privilege(current_user, 'public.merchant_canonical_workspaces', 'SELECT')
    OR NOT has_table_privilege(current_user, 'public.merchant_compliance_profiles', 'SELECT')
    OR NOT has_table_privilege(current_user, 'public.merchant_compliance_profiles', 'UPDATE')
    OR NOT has_table_privilege(current_user, 'public.merchant_compliance_reviews', 'SELECT')
    OR NOT has_table_privilege(current_user, 'public.merchant_compliance_reviews', 'INSERT')
    OR NOT has_table_privilege(current_user, 'public.merchant_compliance_events', 'SELECT')
    OR NOT has_table_privilege(current_user, 'public.merchant_compliance_events', 'INSERT') THEN
    RAISE EXCEPTION 'Phase 2C review substrate function owner prerequisite incompatible';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles owner_role
    WHERE owner_role.rolname = current_user
      AND (owner_role.rolsuper OR owner_role.rolbypassrls OR NOT EXISTS (
        SELECT 1 FROM (VALUES
          ('public.merchants'::regclass),
          ('public.merchant_canonical_workspaces'::regclass),
          ('public.merchant_compliance_profiles'::regclass),
          ('public.merchant_compliance_reviews'::regclass),
          ('public.merchant_compliance_events'::regclass)
        ) AS target(table_oid)
        JOIN pg_catalog.pg_class table_class ON table_class.oid = target.table_oid
        WHERE table_class.relowner <> owner_role.oid OR table_class.relforcerowsecurity
      ))
  ) THEN
    RAISE EXCEPTION 'Phase 2C review substrate function owner RLS prerequisite incompatible';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('submit_draft_plan_review_v1', 'freeze_submitted_plan_review_v1')
      AND p.oid NOT IN (COALESCE(v_rpc::oid, 0::oid), COALESCE(v_guard::oid, 0::oid))
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.merchant_compliance_reviews'::regclass
      AND NOT tgisinternal
  ) OR v_rpc IS NOT NULL OR v_guard IS NOT NULL THEN
    -- No pre-existing object is silently replaced. A separately reviewed
    -- repeat-install guard can be added if this migration must be re-applied.
    RAISE EXCEPTION 'Phase 2C review substrate object already exists or overload is ambiguous';
  END IF;
END;
$phase2c_review_preflight$;

CREATE FUNCTION public.freeze_submitted_plan_review_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $freeze_submitted_plan_review_v1$
BEGIN
  IF (OLD.review_status <> 'draft' OR OLD.submitted_at IS NOT NULL)
    AND NEW.review_status = 'draft' THEN
    RAISE EXCEPTION 'Submitted review cannot return to draft';
  END IF;
  IF (OLD.review_status <> 'draft' OR OLD.submitted_at IS NOT NULL)
    AND (NEW.id, NEW.merchant_id, NEW.profile_id, NEW.review_type,
         NEW.target_plan_code, NEW.evidence_snapshot, NEW.policy_version,
         NEW.submitted_at, NEW.idempotency_key)
        IS DISTINCT FROM
        (OLD.id, OLD.merchant_id, OLD.profile_id, OLD.review_type,
         OLD.target_plan_code, OLD.evidence_snapshot, OLD.policy_version,
         OLD.submitted_at, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'Submitted review source is immutable';
  END IF;
  RETURN NEW;
END;
$freeze_submitted_plan_review_v1$;

REVOKE ALL ON FUNCTION public.freeze_submitted_plan_review_v1() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_freeze_submitted_plan_review_v1
BEFORE UPDATE ON public.merchant_compliance_reviews
FOR EACH ROW EXECUTE FUNCTION public.freeze_submitted_plan_review_v1();

-- No existing runtime writer updates canonical review rows. Bootstrap only
-- inserts them; the legacy approval RPC only reads them. Remove the broad
-- direct UPDATE path so a later decision must use a reviewed transaction RPC.
REVOKE UPDATE ON TABLE public.merchant_compliance_reviews FROM service_role;

CREATE FUNCTION public.submit_draft_plan_review_v1(
  p_merchant_id uuid,
  p_workspace_id uuid,
  p_expected_profile_row_version bigint,
  p_actor_id uuid,
  p_policy_version text,
  p_evidence_snapshot jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $submit_draft_plan_review_v1$
DECLARE
  v_merchant public.merchants%ROWTYPE;
  v_profile public.merchant_compliance_profiles%ROWTYPE;
  v_review public.merchant_compliance_reviews%ROWTYPE;
  v_event public.merchant_compliance_events%ROWTYPE;
  v_finding jsonb;
  v_plan text;
  v_review_type text;
  v_source_type text;
  v_policy_id text;
  v_workspace_id uuid;
  v_review_id uuid;
  v_review_version bigint;
  v_event_id uuid;
  v_snapshot_hash text;
  v_count integer;
  v_code text;
  v_status text;
  v_source_id text;
  v_source_version text;
  v_reason_code text;
  v_seen_codes text[] := ARRAY[]::text[];
  v_evaluated_at timestamptz;
BEGIN
  -- B1 deliberately has no RMI, approval, or rejection action. Decisions need
  -- separately reviewed reviewer-session authority and approved policies.
  -- Row locks on unchanged rows serialize submission checks only with a fresh
  -- statement snapshot. Reject isolation levels that can retain a stale one.
  IF pg_catalog.current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'unsupported_isolation');
  END IF;

  IF p_merchant_id IS NULL OR p_workspace_id IS NULL OR p_actor_id IS NULL
    OR p_expected_profile_row_version IS NULL OR p_expected_profile_row_version < 1
    OR p_policy_version IS DISTINCT FROM '2c-2b-draft-v1'
    OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9_:-]{7,127}$' THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'invalid_transition');
  END IF;

  -- B1 accepts the persisted merchant owner only. Reviewer decisions and
  -- DB-backed admin authority are deliberately deferred.
  -- Lock merchant, then profile. NO KEY UPDATE serializes B1 submissions while
  -- allowing event FK KEY SHARE checks. Profile FOR UPDATE protects its expected
  -- version; READ COMMITTED remains required by the guard above.
  SELECT * INTO v_merchant FROM public.merchants
  WHERE id = p_merchant_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict'); END IF;

  v_plan := CASE pg_catalog.lower(pg_catalog.btrim(v_merchant.subscription_plan))
    WHEN 'individual' THEN 'solo_lite' WHEN 'solo_lite' THEN 'solo_lite'
    WHEN 'corporate' THEN 'business' WHEN 'business' THEN 'business'
    ELSE NULL END;
  IF v_plan IS NULL THEN RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict'); END IF;

  SELECT workspace_id INTO v_workspace_id
  FROM public.merchant_canonical_workspaces
  WHERE merchant_id = p_merchant_id;
  IF NOT FOUND OR v_workspace_id IS DISTINCT FROM p_workspace_id THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;

  SELECT * INTO v_profile FROM public.merchant_compliance_profiles
  WHERE merchant_id = p_merchant_id FOR UPDATE;
  IF NOT FOUND OR v_profile.plan_code IS DISTINCT FROM v_plan
    OR v_profile.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;

  v_review_type := CASE v_plan WHEN 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END;
  v_source_type := CASE v_plan WHEN 'solo_lite' THEN 'solo_lite_review' ELSE 'business_kyb_review' END;
  v_policy_id := CASE v_plan WHEN 'solo_lite' THEN 'solo_lite_evidence' ELSE 'business_kyb_evidence' END;

  IF v_merchant.user_id IS DISTINCT FROM p_actor_id THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'actor_unauthorized');
  END IF;

  IF p_evidence_snapshot IS NULL OR pg_catalog.jsonb_typeof(p_evidence_snapshot) <> 'object'
      OR pg_catalog.octet_length(p_evidence_snapshot::text) > 16384 THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'evidence_conflict');
    END IF;
    IF p_evidence_snapshot ->> 'schemaVersion' IS DISTINCT FROM 'phase2c-review-v1'
      OR p_evidence_snapshot ->> 'policyId' IS DISTINCT FROM v_policy_id
      OR p_evidence_snapshot ->> 'policyVersion' IS DISTINCT FROM p_policy_version
      OR p_evidence_snapshot ->> 'policyStatus' IS DISTINCT FROM 'draft'
      OR p_evidence_snapshot ->> 'adapterVersion' IS DISTINCT FROM '2c-2b-v1'
      OR pg_catalog.jsonb_typeof(p_evidence_snapshot -> 'evaluatedAt') IS DISTINCT FROM 'string'
      OR (p_evidence_snapshot ->> 'evaluatedAt') !~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      OR pg_catalog.jsonb_typeof(p_evidence_snapshot -> 'findings') IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(p_evidence_snapshot) AS key(name)
        WHERE key.name NOT IN ('schemaVersion', 'policyId', 'policyVersion', 'policyStatus',
          'adapterVersion', 'evaluatedAt', 'findings')
      ) OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_evidence_snapshot)) <> 7 THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'evidence_conflict');
    END IF;
    IF pg_catalog.jsonb_array_length(p_evidence_snapshot -> 'findings') NOT BETWEEN 1 AND 32 THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'evidence_conflict');
    END IF;
    BEGIN
      v_evaluated_at := (p_evidence_snapshot ->> 'evaluatedAt')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'evidence_conflict');
    END;
    IF v_evaluated_at IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'evidence_conflict');
    END IF;

    -- The RPC accepts only a bounded diagnostic summary, never provider JSON,
    -- identifiers such as BVN/NIN, document paths, names, or free-text notes.
    FOR v_finding IN SELECT value FROM pg_catalog.jsonb_array_elements(p_evidence_snapshot -> 'findings') LOOP
      IF pg_catalog.jsonb_typeof(v_finding) IS DISTINCT FROM 'object' THEN
        RETURN pg_catalog.jsonb_build_object('kind', 'evidence_conflict');
      END IF;
      IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_finding)) <> 6 OR EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_object_keys(v_finding) AS key(name)
          WHERE key.name NOT IN ('code', 'status', 'reasonCode', 'sourceType', 'sourceId', 'sourceVersion')
        ) THEN
        RETURN pg_catalog.jsonb_build_object('kind', 'evidence_conflict');
      END IF;
      v_code := v_finding ->> 'code';
      v_status := v_finding ->> 'status';
      v_source_id := v_finding ->> 'sourceId';
      v_source_version := v_finding ->> 'sourceVersion';
      v_reason_code := v_finding ->> 'reasonCode';
      IF v_code IS NULL OR pg_catalog.jsonb_typeof(v_finding -> 'status') IS DISTINCT FROM 'string'
        OR v_code = ANY(v_seen_codes)
         OR (v_plan = 'solo_lite' AND v_code NOT IN
           ('legal_name', 'email_contact', 'phone', 'bvn', 'bvn_name_match',
            'selfie_face_match', 'distinct_liveness', 'nin', 'government_id', 'declared_address',
            'address_evidence', 'activity_nature', 'expected_transaction_profile', 'manual_review'))
         OR (v_plan = 'business' AND v_code NOT IN
           ('legal_name', 'registration_number', 'registration_status', 'registered_address',
            'operating_address', 'tin', 'activity_nature', 'expected_transaction_profile',
            'directors', 'shareholders_members', 'partners', 'trustees', 'representatives',
            'signatories', 'senior_management', 'beneficial_owners', 'controllers', 'documents',
            'approved_volume', 'manual_review'))
         OR v_status IS NULL OR v_status NOT IN
           ('verified', 'failed', 'missing', 'unknown', 'ambiguous', 'needs_review', 'not_applicable')
         OR v_reason_code IS NULL OR v_reason_code NOT IN
           ('evidence_verified', 'evidence_failed', 'evidence_missing', 'evidence_unknown',
            'evidence_ambiguous', 'evidence_needs_review', 'evidence_revoked',
            'evidence_expired', 'evidence_time_indeterminate',
            'positive_evidence_provenance_missing', 'unapproved_non_applicability')
        OR (v_finding ->> 'sourceType') IS NOT NULL AND (v_finding ->> 'sourceType') NOT IN
           ('merchant', 'verification_log', 'verification_step', 'registry_snapshot', 'director_verification',
           'affiliation', 'document', 'settlement_account', 'provider_mapping', 'review', 'risk_review', 'screening')
        OR v_source_id IS NOT NULL AND v_source_id !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR v_source_version IS NOT NULL AND (v_source_version !~ '^[1-9][0-9]{0,17}$')
        OR pg_catalog.jsonb_typeof(v_finding -> 'sourceVersion') IS NULL
        OR pg_catalog.jsonb_typeof(v_finding -> 'sourceVersion') NOT IN ('null', 'number')
        OR (v_status = 'verified' AND (v_source_id IS NULL OR v_source_version IS NULL
          OR v_finding ->> 'sourceType' IS NULL
          OR v_finding ->> 'sourceType' = 'merchant'
          OR v_reason_code IS DISTINCT FROM 'evidence_verified')) THEN
        RETURN pg_catalog.jsonb_build_object('kind', 'evidence_conflict');
      END IF;
      v_seen_codes := pg_catalog.array_append(v_seen_codes, v_code);
    END LOOP;
    v_snapshot_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_evidence_snapshot::text, 'UTF8')), 'hex');

  -- Idempotency is merchant-scoped, matching both (merchant_id, key) unique
  -- constraints. The same literal key belongs independently to another merchant.
  -- The merchant lock serializes same-key and same-plan workers at READ COMMITTED.
  -- Replay precedes expected-version checks so a completed retry is explicit.
  SELECT * INTO v_event FROM public.merchant_compliance_events
  WHERE merchant_id = p_merchant_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT * INTO v_review FROM public.merchant_compliance_reviews
    WHERE id = v_event.source_id AND merchant_id = p_merchant_id AND profile_id = v_profile.id;
    IF FOUND AND v_event.merchant_id = p_merchant_id
      AND v_event.profile_id = v_profile.id
      AND v_event.source_id = v_review.id
      AND v_event.event_type = 'phase2c_draft_review_submit_v1'
      AND v_event.source_type = v_source_type
      AND v_event.actor_type = 'merchant' AND v_event.actor_id = p_actor_id
      AND v_event.policy_version = p_policy_version
      AND v_event.from_state = '{}'::jsonb
      AND v_event.to_state = pg_catalog.jsonb_build_object('review_status', 'pending')
      AND v_event.reason_code IS NULL AND v_event.expected_row_version IS NULL
      AND v_review.idempotency_key = p_idempotency_key
      AND v_review.review_type = v_review_type
      AND v_review.target_plan_code = v_plan
      AND v_review.review_status = 'pending'
      AND v_review.submitted_at IS NOT NULL
      AND v_review.policy_version = p_policy_version
      AND v_review.row_version = 1
      AND v_event.resulting_row_version = v_review.row_version
      AND v_review.evidence_snapshot = p_evidence_snapshot
      AND v_event.metadata = pg_catalog.jsonb_build_object(
        'workspace_id', p_workspace_id, 'profile_row_version', p_expected_profile_row_version,
        'snapshot_sha256', v_snapshot_hash, 'policy_id', v_policy_id,
        'evidence_trust', 'unverified_diagnostic') THEN
      RETURN pg_catalog.jsonb_build_object('kind', 'already_processed', 'review_id', v_review.id,
        'event_id', v_event.id, 'row_version', v_event.resulting_row_version);
    END IF;
    RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict');
  END IF;

  IF v_profile.row_version <> p_expected_profile_row_version THEN
    RETURN pg_catalog.jsonb_build_object('kind', 'version_conflict');
  END IF;

  SELECT count(*) INTO v_count FROM public.merchant_compliance_reviews
  WHERE merchant_id = p_merchant_id AND target_plan_code = v_plan
    AND review_status IN ('pending', 'needs_attention');
  IF v_count <> 0 THEN RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.merchant_compliance_reviews
    WHERE merchant_id = p_merchant_id AND idempotency_key = p_idempotency_key
  ) THEN RETURN pg_catalog.jsonb_build_object('kind', 'state_conflict'); END IF;

  v_review_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.merchant_compliance_reviews (
    id, merchant_id, profile_id, review_type, target_plan_code, review_status,
    evidence_snapshot, policy_version, submitted_at, idempotency_key, row_version
  ) VALUES (
    v_review_id, p_merchant_id, v_profile.id, v_review_type, v_plan, 'pending',
    p_evidence_snapshot, p_policy_version, pg_catalog.now(), p_idempotency_key, 1
  ) RETURNING id, row_version INTO v_review_id, v_review_version;
  IF v_review_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Phase 2C review substrate initial version incompatible';
  END IF;

  v_event_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.merchant_compliance_events (
    id, merchant_id, profile_id, event_type, from_state, to_state,
    reason_code, actor_type, actor_id, source_type, source_id, policy_version,
    idempotency_key, expected_row_version, resulting_row_version, metadata
  ) VALUES (
    v_event_id, p_merchant_id, v_profile.id, 'phase2c_draft_review_submit_v1',
    '{}'::jsonb, pg_catalog.jsonb_build_object('review_status', 'pending'),
    NULL, 'merchant', p_actor_id, v_source_type, v_review_id,
    p_policy_version, p_idempotency_key, NULL, v_review_version,
    pg_catalog.jsonb_build_object('workspace_id', p_workspace_id, 'profile_row_version',
      p_expected_profile_row_version, 'snapshot_sha256', v_snapshot_hash, 'policy_id', v_policy_id,
      'evidence_trust', 'unverified_diagnostic')
  );
  RETURN pg_catalog.jsonb_build_object('kind', 'applied', 'review_id', v_review_id,
    'event_id', v_event_id, 'row_version', v_review_version);
END;
$submit_draft_plan_review_v1$;

REVOKE ALL ON FUNCTION public.submit_draft_plan_review_v1(
  uuid,uuid,bigint,uuid,text,jsonb,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_draft_plan_review_v1(
  uuid,uuid,bigint,uuid,text,jsonb,text
) TO service_role;

DO $phase2c_review_postflight$
BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = 'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)'::regprocedure
        AND p.prosecdef
        AND p.proowner = pg_catalog.to_regrole(current_user)::oid
        AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]
    )
    OR has_table_privilege('service_role', 'public.merchant_compliance_reviews', 'UPDATE')
    OR has_function_privilege('anon',
      'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('authenticated',
      'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.freeze_submitted_plan_review_v1()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.freeze_submitted_plan_review_v1()', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.freeze_submitted_plan_review_v1()', 'EXECUTE')
    OR NOT has_function_privilege('service_role',
      'public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Phase 2C review substrate security postcondition failed';
  END IF;
END;
$phase2c_review_postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
