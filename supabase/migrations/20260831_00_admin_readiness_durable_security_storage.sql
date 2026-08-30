BEGIN;

-- Phase 2 admin-readiness durable security storage. This migration is
-- additive, service-only, and intentionally contains no business-data DDL.
-- It remains inert until a separately reviewed server adapter is introduced.
DO $admin_readiness_security_prerequisites$
DECLARE
  v_required_role text;
  v_existing_object text;
BEGIN
  FOREACH v_required_role IN ARRAY ARRAY['service_role', 'anon', 'authenticated']
  LOOP
    IF to_regrole(v_required_role) IS NULL THEN
      RAISE EXCEPTION 'Admin readiness security migration prerequisite failed: required role % is unavailable', v_required_role;
    END IF;
  END LOOP;

  FOREACH v_existing_object IN ARRAY ARRAY[
    'public.admin_readiness_csrf_tokens',
    'public.admin_readiness_csrf_binding_index',
    'public.admin_readiness_throttle_windows'
  ]
  LOOP
    IF to_regclass(v_existing_object) IS NOT NULL THEN
      RAISE EXCEPTION 'Admin readiness security migration prerequisite failed: target relation % already exists', v_existing_object;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_admin_readiness_csrf_token_v1',
        'read_admin_readiness_csrf_token_v1',
        'rotate_admin_readiness_csrf_token_v1',
        'invalidate_admin_readiness_csrf_binding_v1',
        'decide_admin_readiness_throttle_v1',
        'cleanup_admin_readiness_security_storage_v1'
      )
  ) THEN
    RAISE EXCEPTION 'Admin readiness security migration prerequisite failed: a target RPC name already exists';
  END IF;
END
$admin_readiness_security_prerequisites$;

CREATE TABLE public.admin_readiness_csrf_tokens (
  token_digest text PRIMARY KEY,
  session_binding_digest text NOT NULL,
  operation text NOT NULL,
  method text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  replaced_by_token_digest text NULL,
  CONSTRAINT admin_readiness_csrf_tokens_token_digest_check
    CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_readiness_csrf_tokens_session_binding_digest_check
    CHECK (session_binding_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_readiness_csrf_tokens_operation_check
    CHECK (operation IN ('readiness_issue', 'readiness_snapshot')),
  CONSTRAINT admin_readiness_csrf_tokens_method_check
    CHECK (method = 'POST'),
  CONSTRAINT admin_readiness_csrf_tokens_expiry_check
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes'),
  CONSTRAINT admin_readiness_csrf_tokens_replacement_digest_check
    CHECK (
      replaced_by_token_digest IS NULL
      OR (
        replaced_by_token_digest ~ '^[0-9a-f]{64}$'
        AND replaced_by_token_digest <> token_digest
      )
    )
);

COMMENT ON TABLE public.admin_readiness_csrf_tokens IS
  'Short-lived digest-only admin readiness CSRF records; service-role-only; not audit or business history. Cleanup is required before production use.';

CREATE INDEX admin_readiness_csrf_tokens_expires_at_idx
  ON public.admin_readiness_csrf_tokens (expires_at);

CREATE TABLE public.admin_readiness_csrf_binding_index (
  token_digest text PRIMARY KEY,
  session_binding_digest text NOT NULL,
  operation text NOT NULL,
  method text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_readiness_csrf_binding_index_token_digest_fkey
    FOREIGN KEY (token_digest)
    REFERENCES public.admin_readiness_csrf_tokens (token_digest)
    ON DELETE CASCADE,
  CONSTRAINT admin_readiness_csrf_binding_index_token_digest_check
    CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_readiness_csrf_binding_index_session_binding_digest_check
    CHECK (session_binding_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_readiness_csrf_binding_index_operation_check
    CHECK (operation IN ('readiness_issue', 'readiness_snapshot')),
  CONSTRAINT admin_readiness_csrf_binding_index_method_check
    CHECK (method = 'POST'),
  CONSTRAINT admin_readiness_csrf_binding_index_expiry_check
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes')
);

COMMENT ON TABLE public.admin_readiness_csrf_binding_index IS
  'Bounded admin readiness CSRF binding index; service-role-only; no raw session material.';

CREATE INDEX admin_readiness_csrf_binding_index_binding_expiry_created_idx
  ON public.admin_readiness_csrf_binding_index (session_binding_digest, expires_at, created_at);

CREATE TABLE public.admin_readiness_throttle_windows (
  security_namespace text NOT NULL,
  operation text NOT NULL,
  subject_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  window_expires_at timestamptz NOT NULL,
  request_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_readiness_throttle_windows_pkey
    PRIMARY KEY (security_namespace, operation, subject_hash, window_started_at),
  CONSTRAINT admin_readiness_throttle_windows_namespace_check
    CHECK (
      security_namespace IN (
        'admin_readiness_local_v1',
        'admin_readiness_staging_v1',
        'admin_readiness_preview_v1',
        'admin_readiness_production_v1'
      )
    ),
  CONSTRAINT admin_readiness_throttle_windows_operation_check
    CHECK (operation IN ('readiness_issue', 'readiness_snapshot')),
  CONSTRAINT admin_readiness_throttle_windows_subject_hash_check
    CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_readiness_throttle_windows_window_check
    CHECK (
      window_expires_at > window_started_at
      AND window_expires_at <= window_started_at + interval '3600 seconds'
      AND window_expires_at >= window_started_at + interval '60 seconds'
    ),
  CONSTRAINT admin_readiness_throttle_windows_request_count_check
    CHECK (request_count BETWEEN 1 AND 1000)
);

COMMENT ON TABLE public.admin_readiness_throttle_windows IS
  'Short-lived bounded admin readiness throttle windows; service-role-only; not audit or business history. Retain no longer than the reviewed 24-hour cleanup buffer.';

CREATE INDEX admin_readiness_throttle_windows_expires_at_idx
  ON public.admin_readiness_throttle_windows (window_expires_at);

ALTER TABLE public.admin_readiness_csrf_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_readiness_csrf_binding_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_readiness_throttle_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_readiness_csrf_tokens NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_readiness_csrf_binding_index NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_readiness_throttle_windows NO FORCE ROW LEVEL SECURITY;

-- No browser policies are created. Direct table access is service-role-only.
REVOKE ALL ON TABLE public.admin_readiness_csrf_tokens,
  public.admin_readiness_csrf_binding_index,
  public.admin_readiness_throttle_windows
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_readiness_csrf_tokens,
  public.admin_readiness_csrf_binding_index,
  public.admin_readiness_throttle_windows
  TO service_role;

CREATE FUNCTION public.create_admin_readiness_csrf_token_v1(
  p_token_digest text,
  p_session_binding_digest text,
  p_operation text,
  p_method text,
  p_expires_at timestamptz
)
RETURNS TABLE(result_code text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $create_admin_readiness_csrf_token_v1$
DECLARE
  v_now timestamptz := now();
  v_active_count integer;
  v_inserted integer;
BEGIN
  IF p_token_digest IS NULL
    OR p_session_binding_digest IS NULL
    OR p_token_digest !~ '^[0-9a-f]{64}$'
    OR p_session_binding_digest !~ '^[0-9a-f]{64}$'
    OR p_operation NOT IN ('readiness_issue', 'readiness_snapshot')
    OR p_method <> 'POST'
    OR p_expires_at IS NULL
    OR p_expires_at <= v_now
    OR p_expires_at > v_now + interval '30 minutes'
  THEN
    RETURN QUERY SELECT 'invalid'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_binding_digest, 931001));

  DELETE FROM public.admin_readiness_csrf_binding_index AS i
  WHERE i.session_binding_digest = p_session_binding_digest
    AND i.expires_at <= v_now;

  SELECT count(*)::integer
  INTO v_active_count
  FROM public.admin_readiness_csrf_binding_index AS i
  WHERE i.session_binding_digest = p_session_binding_digest
    AND i.expires_at > v_now;

  IF v_active_count >= 4 THEN
    RETURN QUERY SELECT 'conflict'::text;
    RETURN;
  END IF;

  INSERT INTO public.admin_readiness_csrf_tokens (
    token_digest,
    session_binding_digest,
    operation,
    method,
    expires_at
  ) VALUES (
    p_token_digest,
    p_session_binding_digest,
    p_operation,
    p_method,
    p_expires_at
  ) ON CONFLICT (token_digest) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RETURN QUERY SELECT 'conflict'::text;
    RETURN;
  END IF;

  INSERT INTO public.admin_readiness_csrf_binding_index (
    token_digest,
    session_binding_digest,
    operation,
    method,
    expires_at
  ) VALUES (
    p_token_digest,
    p_session_binding_digest,
    p_operation,
    p_method,
    p_expires_at
  );

  RETURN QUERY SELECT 'created'::text;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'csrf_unavailable'::text;
END
$create_admin_readiness_csrf_token_v1$;

CREATE FUNCTION public.read_admin_readiness_csrf_token_v1(
  p_token_digest text
)
RETURNS TABLE(
  result_code text,
  operation text,
  method text,
  session_binding_digest text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $read_admin_readiness_csrf_token_v1$
DECLARE
  v_now timestamptz := now();
  v_token public.admin_readiness_csrf_tokens%ROWTYPE;
BEGIN
  IF p_token_digest IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT t.*
  INTO v_token
  FROM public.admin_readiness_csrf_tokens AS t
  WHERE t.token_digest = p_token_digest;

  IF NOT FOUND OR v_token.replaced_by_token_digest IS NOT NULL THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_token.expires_at <= v_now THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    'found'::text,
    v_token.operation,
    v_token.method,
    v_token.session_binding_digest,
    v_token.expires_at;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'csrf_unavailable'::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz;
END
$read_admin_readiness_csrf_token_v1$;

CREATE FUNCTION public.rotate_admin_readiness_csrf_token_v1(
  p_previous_token_digest text,
  p_new_token_digest text,
  p_session_binding_digest text,
  p_operation text,
  p_method text,
  p_expires_at timestamptz
)
RETURNS TABLE(result_code text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $rotate_admin_readiness_csrf_token_v1$
DECLARE
  v_now timestamptz := now();
  v_previous public.admin_readiness_csrf_tokens%ROWTYPE;
  v_active_count integer;
  v_inserted integer;
  v_updated integer;
BEGIN
  IF p_previous_token_digest IS NULL
    OR p_new_token_digest IS NULL
    OR p_session_binding_digest IS NULL
    OR p_previous_token_digest !~ '^[0-9a-f]{64}$'
    OR p_new_token_digest !~ '^[0-9a-f]{64}$'
    OR p_session_binding_digest !~ '^[0-9a-f]{64}$'
    OR p_previous_token_digest = p_new_token_digest
    OR p_operation NOT IN ('readiness_issue', 'readiness_snapshot')
    OR p_method <> 'POST'
    OR p_expires_at IS NULL
    OR p_expires_at <= v_now
    OR p_expires_at > v_now + interval '30 minutes'
  THEN
    RETURN QUERY SELECT 'invalid'::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_binding_digest, 931001));

  DELETE FROM public.admin_readiness_csrf_binding_index AS i
  WHERE i.session_binding_digest = p_session_binding_digest
    AND i.expires_at <= v_now;

  SELECT t.*
  INTO v_previous
  FROM public.admin_readiness_csrf_tokens AS t
  WHERE t.token_digest = p_previous_token_digest
  FOR UPDATE;

  IF NOT FOUND OR v_previous.replaced_by_token_digest IS NOT NULL THEN
    RETURN QUERY SELECT 'missing'::text;
    RETURN;
  END IF;

  IF v_previous.expires_at <= v_now THEN
    RETURN QUERY SELECT 'expired'::text;
    RETURN;
  END IF;

  IF v_previous.session_binding_digest <> p_session_binding_digest THEN
    RETURN QUERY SELECT 'binding_mismatch'::text;
    RETURN;
  END IF;

  IF v_previous.operation <> p_operation THEN
    RETURN QUERY SELECT 'operation_mismatch'::text;
    RETURN;
  END IF;

  IF v_previous.method <> p_method THEN
    RETURN QUERY SELECT 'method_mismatch'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.admin_readiness_csrf_binding_index AS i
    WHERE i.token_digest = p_previous_token_digest
      AND i.session_binding_digest = p_session_binding_digest
      AND i.operation = p_operation
      AND i.method = p_method
      AND i.expires_at > v_now
  ) THEN
    RETURN QUERY SELECT 'missing'::text;
    RETURN;
  END IF;

  SELECT count(*)::integer
  INTO v_active_count
  FROM public.admin_readiness_csrf_binding_index AS i
  WHERE i.session_binding_digest = p_session_binding_digest
    AND i.expires_at > v_now;

  IF v_active_count > 4 THEN
    RETURN QUERY SELECT 'csrf_unavailable'::text;
    RETURN;
  END IF;

  INSERT INTO public.admin_readiness_csrf_tokens (
    token_digest,
    session_binding_digest,
    operation,
    method,
    expires_at
  ) VALUES (
    p_new_token_digest,
    p_session_binding_digest,
    p_operation,
    p_method,
    p_expires_at
  ) ON CONFLICT (token_digest) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> 1 THEN
    RETURN QUERY SELECT 'conflict'::text;
    RETURN;
  END IF;

  UPDATE public.admin_readiness_csrf_tokens AS t
  SET replaced_by_token_digest = p_new_token_digest
  WHERE t.token_digest = p_previous_token_digest
    AND t.replaced_by_token_digest IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Admin readiness CSRF predecessor changed during rotation';
  END IF;

  UPDATE public.admin_readiness_csrf_binding_index AS i
  SET token_digest = p_new_token_digest,
      expires_at = p_expires_at,
      created_at = v_now
  WHERE i.token_digest = p_previous_token_digest
    AND i.session_binding_digest = p_session_binding_digest;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Admin readiness CSRF binding index changed during rotation';
  END IF;

  RETURN QUERY SELECT 'rotated'::text;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'csrf_unavailable'::text;
END
$rotate_admin_readiness_csrf_token_v1$;

CREATE FUNCTION public.invalidate_admin_readiness_csrf_binding_v1(
  p_session_binding_digest text,
  p_max_delete_count integer
)
RETURNS TABLE(result_code text, deleted_count integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $invalidate_admin_readiness_csrf_binding_v1$
DECLARE
  v_matching_count integer;
  v_deleted_count integer;
BEGIN
  IF p_session_binding_digest IS NULL
    OR p_session_binding_digest !~ '^[0-9a-f]{64}$'
    OR p_max_delete_count IS NULL
    OR p_max_delete_count NOT BETWEEN 1 AND 1000
  THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::integer;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_session_binding_digest, 931001));

  SELECT count(*)::integer
  INTO v_matching_count
  FROM public.admin_readiness_csrf_binding_index AS i
  WHERE i.session_binding_digest = p_session_binding_digest;

  IF v_matching_count = 0 THEN
    RETURN QUERY SELECT 'missing'::text, 0;
    RETURN;
  END IF;

  IF v_matching_count > p_max_delete_count THEN
    RETURN QUERY SELECT 'csrf_unavailable'::text, NULL::integer;
    RETURN;
  END IF;

  DELETE FROM public.admin_readiness_csrf_tokens AS t
  WHERE t.token_digest IN (
    SELECT i.token_digest
    FROM public.admin_readiness_csrf_binding_index AS i
    WHERE i.session_binding_digest = p_session_binding_digest
    ORDER BY i.created_at, i.token_digest
    LIMIT p_max_delete_count
  );

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> v_matching_count THEN
    RAISE EXCEPTION 'Admin readiness CSRF binding invalidation did not delete its exact bounded set';
  END IF;

  RETURN QUERY SELECT 'invalidated'::text, v_deleted_count;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'csrf_unavailable'::text, NULL::integer;
END
$invalidate_admin_readiness_csrf_binding_v1$;

CREATE FUNCTION public.decide_admin_readiness_throttle_v1(
  p_security_namespace text,
  p_operation text,
  p_subject_hash text,
  p_window_started_at timestamptz,
  p_window_expires_at timestamptz,
  p_limit integer
)
RETURNS TABLE(result_code text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $decide_admin_readiness_throttle_v1$
DECLARE
  v_now timestamptz := now();
  v_request_count integer;
BEGIN
  IF p_security_namespace NOT IN (
      'admin_readiness_local_v1',
      'admin_readiness_staging_v1',
      'admin_readiness_preview_v1',
      'admin_readiness_production_v1'
    )
    OR p_operation NOT IN ('readiness_issue', 'readiness_snapshot')
    OR p_subject_hash IS NULL
    OR p_subject_hash !~ '^[0-9a-f]{64}$'
    OR p_window_started_at IS NULL
    OR p_window_expires_at IS NULL
    OR p_window_started_at > v_now
    OR p_window_started_at < v_now - interval '3600 seconds'
    OR p_window_expires_at <= v_now
    OR p_window_expires_at < p_window_started_at + interval '60 seconds'
    OR p_window_expires_at > p_window_started_at + interval '3600 seconds'
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 100
  THEN
    RETURN QUERY SELECT 'invalid'::text;
    RETURN;
  END IF;

  INSERT INTO public.admin_readiness_throttle_windows AS w (
    security_namespace,
    operation,
    subject_hash,
    window_started_at,
    window_expires_at,
    request_count,
    updated_at
  ) VALUES (
    p_security_namespace,
    p_operation,
    p_subject_hash,
    p_window_started_at,
    p_window_expires_at,
    1,
    v_now
  ) ON CONFLICT (security_namespace, operation, subject_hash, window_started_at)
  DO UPDATE SET
    request_count = LEAST(w.request_count + 1, 1000),
    updated_at = v_now
  WHERE w.window_expires_at > v_now
    AND w.window_expires_at = EXCLUDED.window_expires_at
  RETURNING request_count INTO v_request_count;

  IF v_request_count IS NULL THEN
    RETURN QUERY SELECT 'throttle_unavailable'::text;
    RETURN;
  END IF;

  IF v_request_count < p_limit THEN
    RETURN QUERY SELECT 'allow'::text;
  ELSE
    RETURN QUERY SELECT 'rate_limited'::text;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'throttle_unavailable'::text;
END
$decide_admin_readiness_throttle_v1$;

CREATE FUNCTION public.cleanup_admin_readiness_security_storage_v1(
  p_max_delete_count integer
)
RETURNS TABLE(result_code text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO pg_catalog, public
AS $cleanup_admin_readiness_security_storage_v1$
DECLARE
  v_now timestamptz := now();
  v_remaining integer;
  v_deleted integer;
  v_total_deleted integer := 0;
BEGIN
  IF p_max_delete_count IS NULL OR p_max_delete_count NOT BETWEEN 1 AND 1000 THEN
    RETURN QUERY SELECT 'invalid'::text;
    RETURN;
  END IF;

  v_remaining := p_max_delete_count;

  DELETE FROM public.admin_readiness_csrf_tokens AS t
  WHERE t.token_digest IN (
    SELECT expired.token_digest
    FROM public.admin_readiness_csrf_tokens AS expired
    WHERE expired.expires_at <= v_now
    ORDER BY expired.expires_at, expired.token_digest
    LIMIT v_remaining
  );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_total_deleted := v_total_deleted + v_deleted;
  v_remaining := v_remaining - v_deleted;

  IF v_remaining > 0 THEN
    WITH eligible_index_rows AS (
      SELECT i.token_digest
      FROM public.admin_readiness_csrf_binding_index AS i
      LEFT JOIN public.admin_readiness_csrf_tokens AS t
        ON t.token_digest = i.token_digest
      WHERE t.token_digest IS NULL
        OR (i.expires_at <= v_now AND t.expires_at <= v_now)
      ORDER BY i.expires_at, i.token_digest
      LIMIT v_remaining
    )
    DELETE FROM public.admin_readiness_csrf_binding_index AS i
    USING eligible_index_rows AS e
    WHERE i.token_digest = e.token_digest;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_deleted;
    v_remaining := v_remaining - v_deleted;
  END IF;

  IF v_remaining > 0 THEN
    DELETE FROM public.admin_readiness_throttle_windows AS w
    WHERE (w.security_namespace, w.operation, w.subject_hash, w.window_started_at) IN (
      SELECT expired.security_namespace,
        expired.operation,
        expired.subject_hash,
        expired.window_started_at
      FROM public.admin_readiness_throttle_windows AS expired
      WHERE expired.window_expires_at <= v_now - interval '24 hours'
      ORDER BY expired.window_expires_at,
        expired.security_namespace,
        expired.operation,
        expired.subject_hash
      LIMIT v_remaining
    );
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_total_deleted := v_total_deleted + v_deleted;
  END IF;

  IF v_total_deleted > 0 THEN
    RETURN QUERY SELECT 'cleaned'::text;
  ELSE
    RETURN QUERY SELECT 'nothing_to_clean'::text;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 'security_storage_unavailable'::text;
END
$cleanup_admin_readiness_security_storage_v1$;

REVOKE ALL ON FUNCTION public.create_admin_readiness_csrf_token_v1(text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_admin_readiness_csrf_token_v1(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.rotate_admin_readiness_csrf_token_v1(text, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.invalidate_admin_readiness_csrf_binding_v1(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.decide_admin_readiness_throttle_v1(text, text, text, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleanup_admin_readiness_security_storage_v1(integer)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_admin_readiness_csrf_token_v1(text, text, text, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.read_admin_readiness_csrf_token_v1(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_admin_readiness_csrf_token_v1(text, text, text, text, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.invalidate_admin_readiness_csrf_binding_v1(text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_admin_readiness_throttle_v1(text, text, text, timestamptz, timestamptz, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_admin_readiness_security_storage_v1(integer)
  TO service_role;

-- Rollback is intentionally user-controlled and separately reviewed. Keep the
-- route flag disabled; revoke exact RPC grants, drop exact RPCs, revoke table
-- grants, then drop only these three security tables.
COMMIT;
