[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$LocalConnectionString,
  [Parameter(Mandatory = $true)]
  [string]$Confirmation,
  [switch]$Execute,
  [string]$PsqlPath = 'psql'
)

$ErrorActionPreference = 'Stop'
$ConfirmationPhrase = 'REHEARSE MIGRATION 026 LOCAL DISPOSABLE DB ONLY'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Migration024 = Join-Path $ProjectRoot 'supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql'
$Migration025 = Join-Path $ProjectRoot 'supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql'
$Migration026 = Join-Path $ProjectRoot 'supabase/migrations/20260825_00_reviewed_profile_approval_rpc.sql'
$Preflight026 = Join-Path $ProjectRoot 'supabase/staging/preflight/026_reviewed_profile_approval_rpc_snapshot.sql'
$Postflight026 = Join-Path $ProjectRoot 'supabase/staging/postflight/026_reviewed_profile_approval_rpc_verify.sql'

function Get-LocalPgHost {
  param([Parameter(Mandatory = $true)][string]$ConnectionString)
  if ($ConnectionString -match '^(?i:postgres(?:ql)?://)') {
    try { return ([Uri]$ConnectionString).Host.ToLowerInvariant() } catch { throw 'LOCAL_APPROVAL_REHEARSAL_CONNECTION_STRING_INVALID' }
  }
  if ($ConnectionString -match '(?i)(?:^|\s)host\s*=\s*([^\s;]+)') { return $Matches[1].Trim('"', "'").ToLowerInvariant() }
  throw 'LOCAL_APPROVAL_REHEARSAL_HOST_MISSING'
}

function Assert-LocalDisposableConnectionString {
  param([Parameter(Mandatory = $true)][string]$ConnectionString)
  if ([string]::IsNullOrWhiteSpace($ConnectionString)) { throw 'LOCAL_APPROVAL_REHEARSAL_CONNECTION_STRING_REQUIRED' }
  if ($ConnectionString -match '(?i)(supabase\.co|supabase\.com|vercel|production|staging|service_role|anon|eyJ|password\s*=|://[^/\s]*:)') {
    throw 'LOCAL_APPROVAL_REHEARSAL_CONNECTION_STRING_REJECTED'
  }
  $hostName = Get-LocalPgHost -ConnectionString $ConnectionString
  if ($hostName -notin @('localhost', '127.0.0.1', 'host.docker.internal')) { throw 'LOCAL_APPROVAL_REHEARSAL_NONLOCAL_HOST_REJECTED' }
  if ($ConnectionString -notmatch '(?i)(?:/|dbname\s*=)[^\s;/]*?(?:rehearsal|disposable|local)') {
    throw 'LOCAL_APPROVAL_REHEARSAL_DISPOSABLE_DATABASE_NAME_REQUIRED'
  }
  return $hostName
}

function Write-LocalSqlFileNoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

if ($Confirmation.Trim() -cne $ConfirmationPhrase) { throw 'LOCAL_APPROVAL_REHEARSAL_CONFIRMATION_REQUIRED' }
$TargetHost = Assert-LocalDisposableConnectionString -ConnectionString $LocalConnectionString.Trim()
Write-Host "LOCAL-ONLY DISPOSABLE TARGET HOST: $TargetHost"
Write-Host 'FORBIDDEN: staging, production, Supabase projects, runtime adoption, collection unlock, and provider/payment testing.'
if (-not $Execute) {
  Write-Host 'DRY RUN ONLY. Re-run with -Execute only for a disposable local database.'
  exit 0
}

foreach ($path in @($Migration024, $Migration025, $Migration026, $Preflight026, $Postflight026)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "LOCAL_APPROVAL_REHEARSAL_SOURCE_MISSING: $path" }
}

$Psql = (Get-Command $PsqlPath -ErrorAction Stop).Source
$TempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("deraledger-approval-rpc-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $TempDirectory -Force | Out-Null
$BaselineSql = Join-Path $TempDirectory '024-025-026-local-prerequisites.sql'
$BehaviorSql = Join-Path $TempDirectory '026-rpc-behavior.sql'

try {
  # This baseline is deliberately limited to the pre-024 objects required by the
  # three migrations and the local-only service-role execution contract.
  Write-LocalSqlFileNoBom -Path $BaselineSql -Content @'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.merchants (
  id uuid PRIMARY KEY,
  setup_mode boolean NOT NULL DEFAULT true,
  live_features_enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS public.invoices (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.payment_records (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.solo_plus_cases (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  target_plan text NOT NULL,
  case_status text NOT NULL,
  requirements_policy_version text NOT NULL,
  approved_at timestamptz,
  approved_by_admin_id uuid,
  rejected_at timestamptz,
  rejected_by_admin_id uuid,
  row_version bigint NOT NULL DEFAULT 1
);
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT ON TABLE auth.users TO service_role;
GRANT SELECT ON TABLE public.solo_plus_cases TO service_role;
'@

  Write-LocalSqlFileNoBom -Path $BehaviorSql -Content @'
BEGIN;
RESET ROLE;

-- Owner/admin-only disposable seed setup. No service_role direct merchant,
-- auth-user, review, profile, case, invoice, payment, provider, or limit write
-- occurs in this section or in service-role behavior checks.
INSERT INTO auth.users(id) VALUES
  ('00000000-0000-4000-8000-000000000101'),
  ('00000000-0000-4000-8000-000000000102');
INSERT INTO public.merchants(id) VALUES
  ('00000000-0000-4000-8000-000000000201'),
  ('00000000-0000-4000-8000-000000000202'),
  ('00000000-0000-4000-8000-000000000203'),
  ('00000000-0000-4000-8000-000000000204'),
  ('00000000-0000-4000-8000-000000000205'),
  ('00000000-0000-4000-8000-000000000206'),
  ('00000000-0000-4000-8000-000000000207'),
  ('00000000-0000-4000-8000-000000000208'),
  ('00000000-0000-4000-8000-000000000209'),
  ('00000000-0000-4000-8000-000000000210'),
  ('00000000-0000-4000-8000-000000000211');

INSERT INTO public.merchant_compliance_profiles(
  id, merchant_id, plan_code, compliance_status, activation_status,
  decision_source_type, decision_source_id, row_version
) VALUES
  ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000201','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000000401',1),
  ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000202','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000000402',1),
  ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000203','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000000403',1),
  ('00000000-0000-4000-8000-000000000304','00000000-0000-4000-8000-000000000204','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000000404',1),
  ('00000000-0000-4000-8000-000000000305','00000000-0000-4000-8000-000000000205','business','business_pending','test_mode','business_kyb_review','00000000-0000-4000-8000-000000000405',1),
  ('00000000-0000-4000-8000-000000000306','00000000-0000-4000-8000-000000000206','solo_plus','enhanced_pending','test_mode','solo_plus_case','00000000-0000-4000-8000-000000000406',1),
  ('00000000-0000-4000-8000-000000000307','00000000-0000-4000-8000-000000000207','solo_plus','enhanced_pending','test_mode','solo_plus_case','00000000-0000-4000-8000-000000000407',1),
  ('00000000-0000-4000-8000-000000000308','00000000-0000-4000-8000-000000000208','solo_plus','enhanced_pending','test_mode','solo_plus_case','00000000-0000-4000-8000-000000000408',1),
  ('00000000-0000-4000-8000-000000000309','00000000-0000-4000-8000-000000000209','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000000409',1),
  ('00000000-0000-4000-8000-000000000310','00000000-0000-4000-8000-000000000210','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000000410',1),
  ('00000000-0000-4000-8000-000000000311','00000000-0000-4000-8000-000000000211','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000000411',1);

INSERT INTO public.merchant_compliance_reviews(
  id, merchant_id, profile_id, review_type, target_plan_code, review_status, idempotency_key, row_version
) VALUES
  ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000301','solo_lite','solo_lite','pending','local-026-lite-verified',1),
  ('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000302','solo_lite','solo_lite','needs_attention','local-026-lite-attention',1),
  ('00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000303','solo_lite','solo_lite','pending','local-026-lite-rejected',1),
  ('00000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000204','00000000-0000-4000-8000-000000000304','solo_lite','solo_lite','pending','local-026-lite-restricted',1),
  ('00000000-0000-4000-8000-000000000405','00000000-0000-4000-8000-000000000205','00000000-0000-4000-8000-000000000305','business_kyb','business','pending','local-026-business-verified',1),
  ('00000000-0000-4000-8000-000000000409','00000000-0000-4000-8000-000000000209','00000000-0000-4000-8000-000000000309','solo_lite','solo_lite','pending','local-026-stale',1),
  ('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000310','solo_lite','solo_lite','pending','local-026-profile-rollback',1),
  ('00000000-0000-4000-8000-000000000411','00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000311','solo_lite','solo_lite','pending','local-026-event-rollback',1);

INSERT INTO public.solo_plus_cases(
  id, merchant_id, target_plan, case_status, requirements_policy_version,
  approved_at, approved_by_admin_id, rejected_at, rejected_by_admin_id, row_version
) VALUES
  ('00000000-0000-4000-8000-000000000406','00000000-0000-4000-8000-000000000206','solo_plus','approved','local-policy-v1','2026-08-25T00:00:00Z','00000000-0000-4000-8000-000000000101',NULL,NULL,1),
  ('00000000-0000-4000-8000-000000000407','00000000-0000-4000-8000-000000000207','solo_plus','rejected','local-policy-v1',NULL,NULL,'2026-08-25T00:01:00Z','00000000-0000-4000-8000-000000000101',1),
  ('00000000-0000-4000-8000-000000000408','00000000-0000-4000-8000-000000000208','solo_plus','manual_review','local-policy-v1',NULL,NULL,NULL,NULL,1);

-- Scenario results are accumulated first. The script prints every safe result
-- and fails only once after all required local behavior checks have run.
CREATE TEMP TABLE approval_scenario_results (
  scenario_name text NOT NULL,
  expected_result text NOT NULL,
  actual_result text NOT NULL,
  passed boolean NOT NULL,
  safe_failure_code text
);
GRANT SELECT, INSERT ON TABLE approval_scenario_results TO service_role, anon, authenticated;

INSERT INTO approval_scenario_results
SELECT 'probe.fixture_shape', 'fixture_ready',
  CASE WHEN (SELECT count(*) FROM public.merchant_compliance_profiles) = 11
          AND (SELECT count(*) FROM public.merchant_compliance_reviews) = 8
          AND (SELECT count(*) FROM public.solo_plus_cases) = 3
       THEN 'fixture_ready' ELSE 'fixture_mismatch' END,
  (SELECT count(*) FROM public.merchant_compliance_profiles) = 11
    AND (SELECT count(*) FROM public.merchant_compliance_reviews) = 8
    AND (SELECT count(*) FROM public.solo_plus_cases) = 3,
  CASE WHEN (SELECT count(*) FROM public.merchant_compliance_profiles) = 11
          AND (SELECT count(*) FROM public.merchant_compliance_reviews) = 8
          AND (SELECT count(*) FROM public.solo_plus_cases) = 3
       THEN NULL ELSE 'fixture_mismatch' END;

CREATE OR REPLACE FUNCTION pg_temp.capture_approval_scenario(
  p_scenario_name text, p_expected_result text,
  p_merchant_id uuid, p_profile_id uuid, p_plan_code text, p_source_type text,
  p_source_id uuid, p_source_version bigint, p_target_status text, p_expected_row_version bigint,
  p_reviewer_id uuid, p_idempotency_key text, p_policy_version text, p_reviewed_at timestamptz, p_reason_code text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $capture$
DECLARE v_actual_result text := 'approval_rpc_invocation_failed';
BEGIN
  BEGIN
    SELECT result_code INTO v_actual_result
    FROM public.review_compliance_profile_decision_v1(
      p_merchant_id, p_profile_id, p_plan_code, p_source_type, p_source_id, p_source_version,
      p_target_status, p_expected_row_version, p_reviewer_id, p_idempotency_key,
      p_policy_version, p_reviewed_at, p_reason_code
    );
  EXCEPTION WHEN OTHERS THEN
    v_actual_result := 'approval_rpc_invocation_failed';
  END;
  INSERT INTO pg_temp.approval_scenario_results
    (scenario_name, expected_result, actual_result, passed, safe_failure_code)
  VALUES (
    p_scenario_name, p_expected_result, v_actual_result, v_actual_result = p_expected_result,
    CASE WHEN v_actual_result = p_expected_result THEN NULL ELSE v_actual_result END
  );
END;
$capture$;
GRANT EXECUTE ON FUNCTION pg_temp.capture_approval_scenario(text,text,uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)
  TO service_role;

-- Local-only probes distinguish fixture, profile-write, event-write, and replay
-- privilege/RLS readiness without exposing PostgreSQL errors or business data.
SET LOCAL ROLE service_role;
INSERT INTO pg_temp.approval_scenario_results
SELECT 'probe.profile_update_privilege_rls', 'probe_ready',
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_profiles', 'UPDATE')
          AND EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE id = '00000000-0000-4000-8000-000000000301' AND row_version = 1)
       THEN 'probe_ready' ELSE 'profile_update_privilege_or_condition_failed' END,
  has_table_privilege(current_user, 'public.merchant_compliance_profiles', 'UPDATE')
    AND EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE id = '00000000-0000-4000-8000-000000000301' AND row_version = 1),
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_profiles', 'UPDATE')
          AND EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE id = '00000000-0000-4000-8000-000000000301' AND row_version = 1)
       THEN NULL ELSE 'profile_update_privilege_or_condition_failed' END;
INSERT INTO pg_temp.approval_scenario_results
SELECT 'probe.event_insert_privilege_rls', 'probe_ready',
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_events', 'SELECT')
          AND has_table_privilege(current_user, 'public.merchant_compliance_events', 'INSERT')
       THEN 'probe_ready' ELSE 'event_insert_privilege_or_rls_failed' END,
  has_table_privilege(current_user, 'public.merchant_compliance_events', 'SELECT')
    AND has_table_privilege(current_user, 'public.merchant_compliance_events', 'INSERT'),
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_events', 'SELECT')
          AND has_table_privilege(current_user, 'public.merchant_compliance_events', 'INSERT')
       THEN NULL ELSE 'event_insert_privilege_or_rls_failed' END;
INSERT INTO pg_temp.approval_scenario_results
SELECT 'probe.replay_lookup_privilege', 'probe_ready',
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_events', 'SELECT')
       THEN 'probe_ready' ELSE 'replay_lookup_privilege_failed' END,
  has_table_privilege(current_user, 'public.merchant_compliance_events', 'SELECT'),
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_events', 'SELECT')
        THEN NULL ELSE 'replay_lookup_privilege_failed' END;
INSERT INTO pg_temp.approval_scenario_results
SELECT 'probe.lite_review_source_exact', 'probe_ready',
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_reviews', 'SELECT')
          AND (SELECT count(*) FROM public.merchant_compliance_reviews
               WHERE id = '00000000-0000-4000-8000-000000000401'
                 AND merchant_id = '00000000-0000-4000-8000-000000000201'
                 AND profile_id = '00000000-0000-4000-8000-000000000301'
                 AND review_type = CASE WHEN 'solo_lite' = 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END
                 AND target_plan_code = 'solo_lite'
                 AND review_status IN ('pending', 'needs_attention')
                 AND row_version = 1) = 1
       THEN 'probe_ready' ELSE 'lite_review_source_predicate_failed' END,
  has_table_privilege(current_user, 'public.merchant_compliance_reviews', 'SELECT')
    AND (SELECT count(*) FROM public.merchant_compliance_reviews
         WHERE id = '00000000-0000-4000-8000-000000000401'
           AND merchant_id = '00000000-0000-4000-8000-000000000201'
           AND profile_id = '00000000-0000-4000-8000-000000000301'
           AND review_type = CASE WHEN 'solo_lite' = 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END
           AND target_plan_code = 'solo_lite'
           AND review_status IN ('pending', 'needs_attention')
           AND row_version = 1) = 1,
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_reviews', 'SELECT')
          AND (SELECT count(*) FROM public.merchant_compliance_reviews
               WHERE id = '00000000-0000-4000-8000-000000000401'
                 AND merchant_id = '00000000-0000-4000-8000-000000000201'
                 AND profile_id = '00000000-0000-4000-8000-000000000301'
                 AND review_type = CASE WHEN 'solo_lite' = 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END
                 AND target_plan_code = 'solo_lite'
                 AND review_status IN ('pending', 'needs_attention')
                 AND row_version = 1) = 1
       THEN NULL ELSE 'lite_review_source_predicate_failed' END;
INSERT INTO pg_temp.approval_scenario_results
SELECT 'probe.business_review_source_exact', 'probe_ready',
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_reviews', 'SELECT')
          AND (SELECT count(*) FROM public.merchant_compliance_reviews
               WHERE id = '00000000-0000-4000-8000-000000000405'
                 AND merchant_id = '00000000-0000-4000-8000-000000000205'
                 AND profile_id = '00000000-0000-4000-8000-000000000305'
                 AND review_type = CASE WHEN 'business' = 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END
                 AND target_plan_code = 'business'
                 AND review_status IN ('pending', 'needs_attention')
                 AND row_version = 1) = 1
       THEN 'probe_ready' ELSE 'business_review_source_predicate_failed' END,
  has_table_privilege(current_user, 'public.merchant_compliance_reviews', 'SELECT')
    AND (SELECT count(*) FROM public.merchant_compliance_reviews
         WHERE id = '00000000-0000-4000-8000-000000000405'
           AND merchant_id = '00000000-0000-4000-8000-000000000205'
           AND profile_id = '00000000-0000-4000-8000-000000000305'
           AND review_type = CASE WHEN 'business' = 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END
           AND target_plan_code = 'business'
           AND review_status IN ('pending', 'needs_attention')
           AND row_version = 1) = 1,
  CASE WHEN has_table_privilege(current_user, 'public.merchant_compliance_reviews', 'SELECT')
          AND (SELECT count(*) FROM public.merchant_compliance_reviews
               WHERE id = '00000000-0000-4000-8000-000000000405'
                 AND merchant_id = '00000000-0000-4000-8000-000000000205'
                 AND profile_id = '00000000-0000-4000-8000-000000000305'
                 AND review_type = CASE WHEN 'business' = 'solo_lite' THEN 'solo_lite' ELSE 'business_kyb' END
                 AND target_plan_code = 'business'
                 AND review_status IN ('pending', 'needs_attention')
                 AND row_version = 1) = 1
       THEN NULL ELSE 'business_review_source_predicate_failed' END;
INSERT INTO pg_temp.approval_scenario_results
SELECT 'probe.case_source_read', 'probe_ready',
  CASE WHEN has_table_privilege(current_user, 'public.solo_plus_cases', 'SELECT')
          AND EXISTS (
            SELECT 1 FROM public.solo_plus_cases
            WHERE id = '00000000-0000-4000-8000-000000000406'
              AND merchant_id = '00000000-0000-4000-8000-000000000206'
              AND target_plan = 'solo_plus'
              AND case_status = 'approved'
              AND requirements_policy_version = 'local-policy-v1'
              AND row_version = 1
          )
       THEN 'probe_ready' ELSE 'case_source_read_or_fixture_failed' END,
  has_table_privilege(current_user, 'public.solo_plus_cases', 'SELECT')
    AND EXISTS (
      SELECT 1 FROM public.solo_plus_cases
      WHERE id = '00000000-0000-4000-8000-000000000406'
        AND merchant_id = '00000000-0000-4000-8000-000000000206'
        AND target_plan = 'solo_plus'
        AND case_status = 'approved'
        AND requirements_policy_version = 'local-policy-v1'
        AND row_version = 1
    ),
  CASE WHEN has_table_privilege(current_user, 'public.solo_plus_cases', 'SELECT')
          AND EXISTS (SELECT 1 FROM public.solo_plus_cases WHERE id = '00000000-0000-4000-8000-000000000406')
       THEN NULL ELSE 'case_source_read_or_fixture_failed' END;

DO $rehearsal$
BEGIN
PERFORM pg_temp.capture_approval_scenario('lite.pending_to_verified','approval_applied','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000301','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000401',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-approve-lite','local-policy-v1','2026-08-25T00:00:00Z',NULL);
PERFORM pg_temp.capture_approval_scenario('lite.exact_replay','approval_idempotent_replay','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000301','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000401',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-approve-lite','local-policy-v1','2026-08-25T00:00:00Z',NULL);
PERFORM pg_temp.capture_approval_scenario('lite.needs_attention','approval_applied','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000302','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000402',1,'needs_attention',1,'00000000-0000-4000-8000-000000000101','local-026-needs-attention','local-policy-v1','2026-08-25T00:00:00Z','evidence_incomplete');
PERFORM pg_temp.capture_approval_scenario('lite.rejected','approval_applied','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000303','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000403',1,'rejected',1,'00000000-0000-4000-8000-000000000101','local-026-rejected','local-policy-v1','2026-08-25T00:00:00Z','review_rejected');
PERFORM pg_temp.capture_approval_scenario('lite.restricted','approval_applied','00000000-0000-4000-8000-000000000204','00000000-0000-4000-8000-000000000304','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000404',1,'restricted',1,'00000000-0000-4000-8000-000000000101','local-026-restricted','local-policy-v1','2026-08-25T00:00:00Z','risk_restricted');
PERFORM pg_temp.capture_approval_scenario('business.pending_to_verified','approval_applied','00000000-0000-4000-8000-000000000205','00000000-0000-4000-8000-000000000305','business','business_kyb_review','00000000-0000-4000-8000-000000000405',1,'business_verified',1,'00000000-0000-4000-8000-000000000101','local-026-business','local-policy-v1','2026-08-25T00:00:00Z',NULL);
PERFORM pg_temp.capture_approval_scenario('solo_plus.approved_to_verified','approval_applied','00000000-0000-4000-8000-000000000206','00000000-0000-4000-8000-000000000306','solo_plus','solo_plus_case','00000000-0000-4000-8000-000000000406',1,'enhanced_verified',1,'00000000-0000-4000-8000-000000000101','local-026-plus-approved','local-policy-v1','2026-08-25T00:00:00Z',NULL);
PERFORM pg_temp.capture_approval_scenario('solo_plus.rejected','approval_applied','00000000-0000-4000-8000-000000000207','00000000-0000-4000-8000-000000000307','solo_plus','solo_plus_case','00000000-0000-4000-8000-000000000407',1,'rejected',1,'00000000-0000-4000-8000-000000000101','local-026-plus-rejected','local-policy-v1','2026-08-25T00:01:00Z','review_rejected');
PERFORM pg_temp.capture_approval_scenario('solo_plus.manual_review','approval_applied','00000000-0000-4000-8000-000000000208','00000000-0000-4000-8000-000000000308','solo_plus','solo_plus_case','00000000-0000-4000-8000-000000000408',1,'needs_attention',1,'00000000-0000-4000-8000-000000000101','local-026-plus-attention','local-policy-v1','2026-08-25T00:00:00Z','evidence_incomplete');
PERFORM pg_temp.capture_approval_scenario('missing_profile','approval_profile_missing',gen_random_uuid(),gen_random_uuid(),'solo_lite','solo_lite_review',gen_random_uuid(),1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-missing','local-policy-v1','2026-08-25T00:00:00Z',NULL);
PERFORM pg_temp.capture_approval_scenario('stale_row_version','approval_profile_state_invalid','00000000-0000-4000-8000-000000000209','00000000-0000-4000-8000-000000000309','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000409',1,'lite_verified',2,'00000000-0000-4000-8000-000000000101','local-026-stale','local-policy-v1','2026-08-25T00:00:00Z',NULL);
PERFORM pg_temp.capture_approval_scenario('mismatched_plan_source','approval_payload_invalid','00000000-0000-4000-8000-000000000209','00000000-0000-4000-8000-000000000309','business','solo_lite_review','00000000-0000-4000-8000-000000000409',1,'business_verified',1,'00000000-0000-4000-8000-000000000101','local-026-plan-mismatch','local-policy-v1','2026-08-25T00:00:00Z',NULL);
PERFORM pg_temp.capture_approval_scenario('unsupported_transition','approval_payload_invalid','00000000-0000-4000-8000-000000000209','00000000-0000-4000-8000-000000000309','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000409',1,'enhanced_verified',1,'00000000-0000-4000-8000-000000000101','local-026-transition','local-policy-v1','2026-08-25T00:00:00Z',NULL);
PERFORM pg_temp.capture_approval_scenario('reused_idempotency_mismatch','approval_idempotency_conflict','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000301','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000401',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-approve-lite','different-policy','2026-08-25T00:00:00Z',NULL);
PERFORM pg_temp.capture_approval_scenario('missing_reviewer','approval_reviewer_invalid','00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000310','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000410',1,'lite_verified',1,'00000000-0000-4000-8000-000000000112','local-026-missing-reviewer','local-policy-v1','2026-08-25T00:00:00Z',NULL);
END;
$rehearsal$;
RESET ROLE;

-- Structural duplicates are prevented by the Migration 024 primary/unique keys.
DO $rehearsal$
BEGIN
  BEGIN
    INSERT INTO public.merchant_compliance_profiles(id, merchant_id, plan_code) VALUES ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000201','solo_lite');
    RAISE EXCEPTION 'duplicate profile was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.merchant_compliance_reviews(id, merchant_id, profile_id, review_type, target_plan_code, idempotency_key) VALUES ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000301','solo_lite','solo_lite','duplicate-source');
    RAISE EXCEPTION 'duplicate source was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$rehearsal$;

-- Fail the profile update after the profile lock/read succeeds, without
-- withdrawing the UPDATE privilege that SELECT ... FOR UPDATE requires.
CREATE OR REPLACE FUNCTION public.local_026_rehearsal_reject_profile_update()
RETURNS trigger LANGUAGE plpgsql AS $trigger$
BEGIN
  IF NEW.id = '00000000-0000-4000-8000-000000000310' THEN
    RAISE EXCEPTION 'local rehearsal profile update failure';
  END IF;
  RETURN NEW;
END;
$trigger$;
CREATE TRIGGER local_026_rehearsal_reject_profile_update
  BEFORE UPDATE ON public.merchant_compliance_profiles
  FOR EACH ROW EXECUTE FUNCTION public.local_026_rehearsal_reject_profile_update();
SET LOCAL ROLE service_role;
DO $rehearsal$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000310','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000410',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-profile-write-failure','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  INSERT INTO pg_temp.approval_scenario_results VALUES ('rollback.profile_update_failure','approval_profile_update_failed',r.result_code,r.result_code = 'approval_profile_update_failed',CASE WHEN r.result_code = 'approval_profile_update_failed' THEN NULL ELSE r.result_code END);
END;
$rehearsal$;
RESET ROLE;
DROP TRIGGER local_026_rehearsal_reject_profile_update ON public.merchant_compliance_profiles;
DROP FUNCTION public.local_026_rehearsal_reject_profile_update();

REVOKE INSERT ON TABLE public.merchant_compliance_events FROM service_role;
SET LOCAL ROLE service_role;
DO $rehearsal$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000311','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000411',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-event-write-failure','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  INSERT INTO pg_temp.approval_scenario_results VALUES ('rollback.event_insert_failure','approval_event_insert_failed',r.result_code,r.result_code = 'approval_event_insert_failed',CASE WHEN r.result_code = 'approval_event_insert_failed' THEN NULL ELSE r.result_code END);
END;
$rehearsal$;
RESET ROLE;
GRANT INSERT ON TABLE public.merchant_compliance_events TO service_role;

DO $rehearsal$
DECLARE
  v_relation text;
  v_has_rows boolean;
  v_rollback_safe boolean;
  v_forbidden_writes_absent boolean := true;
  v_grants_safe boolean;
BEGIN
  v_rollback_safe := NOT EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE id IN ('00000000-0000-4000-8000-000000000310','00000000-0000-4000-8000-000000000311') AND compliance_status <> 'lite_pending')
    AND NOT EXISTS (SELECT 1 FROM public.merchant_compliance_events WHERE idempotency_key IN ('local-026-profile-write-failure','local-026-event-write-failure'));
  INSERT INTO pg_temp.approval_scenario_results VALUES ('rollback.no_partial_profile_or_event','rollback_safe',CASE WHEN v_rollback_safe THEN 'rollback_safe' ELSE 'rollback_partial_state_detected' END,v_rollback_safe,CASE WHEN v_rollback_safe THEN NULL ELSE 'rollback_partial_state_detected' END);
  IF EXISTS (SELECT 1 FROM public.merchants WHERE NOT setup_mode OR live_features_enabled)
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE can_collect_payments OR activation_status = 'active')
    OR EXISTS (SELECT 1 FROM public.merchant_collection_limit_windows)
    OR EXISTS (SELECT 1 FROM public.merchant_collection_limit_reservations)
    OR EXISTS (SELECT 1 FROM public.merchant_collection_limit_reservation_windows)
    OR EXISTS (SELECT 1 FROM public.merchant_collection_usage_events) THEN
    v_forbidden_writes_absent := false;
  END IF;
  FOREACH v_relation IN ARRAY ARRAY[
    'public.invoices', 'public.payment_records', 'public.subscriptions',
    'public.payment_providers', 'public.provider_settlement_accounts'
  ] LOOP
    IF to_regclass(v_relation) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s)', v_relation) INTO v_has_rows;
      IF v_has_rows THEN v_forbidden_writes_absent := false; END IF;
    END IF;
  END LOOP;
  INSERT INTO pg_temp.approval_scenario_results VALUES ('forbidden_writes_absent','forbidden_writes_absent',CASE WHEN v_forbidden_writes_absent THEN 'forbidden_writes_absent' ELSE 'forbidden_write_detected' END,v_forbidden_writes_absent,CASE WHEN v_forbidden_writes_absent THEN NULL ELSE 'forbidden_write_detected' END);
  -- PUBLIC is a grant pseudo-role, not a role that may be assumed or supplied
  -- to has_function_privilege. Inspect the exact RPC ACL instead.
  v_grants_safe := NOT has_function_privilege('anon', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure_state
      CROSS JOIN LATERAL aclexplode(COALESCE(
        procedure_state.proacl,
        acldefault('f', procedure_state.proowner)
      )) privilege_state
      WHERE procedure_state.oid = to_regprocedure(
        'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)'
      )
        AND privilege_state.grantee = 0
        AND privilege_state.privilege_type = 'EXECUTE'
    )
    AND has_function_privilege('service_role', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE');
  INSERT INTO pg_temp.approval_scenario_results VALUES ('hostile_role_grant_boundary','grants_safe',CASE WHEN v_grants_safe THEN 'grants_safe' ELSE 'hostile_role_grant_leak' END,v_grants_safe,CASE WHEN v_grants_safe THEN NULL ELSE 'hostile_role_grant_leak' END);
END;
$rehearsal$;

-- Hostile role invocation checks run only after admin seeding and service-role
-- contract behavior. They must receive insufficient_privilege, never a result.
SET LOCAL ROLE anon;
DO $rehearsal$
DECLARE
  r record;
  v_actual text := 'hostile_execute_other_failure';
BEGIN
  BEGIN
    SELECT * INTO r FROM public.review_compliance_profile_decision_v1(gen_random_uuid(),gen_random_uuid(),'solo_lite','solo_lite_review',gen_random_uuid(),1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-anon','local-policy-v1','2026-08-25T00:00:00Z',NULL);
    v_actual := 'hostile_execute_unexpected_result';
  EXCEPTION WHEN insufficient_privilege THEN v_actual := 'execute_denied';
  END;
  INSERT INTO pg_temp.approval_scenario_results VALUES ('anon_execute_denied','execute_denied',v_actual,v_actual = 'execute_denied',CASE WHEN v_actual = 'execute_denied' THEN NULL ELSE v_actual END);
END;
$rehearsal$;
SET LOCAL ROLE authenticated;
DO $rehearsal$
DECLARE
  r record;
  v_actual text := 'hostile_execute_other_failure';
BEGIN
  BEGIN
    SELECT * INTO r FROM public.review_compliance_profile_decision_v1(gen_random_uuid(),gen_random_uuid(),'solo_lite','solo_lite_review',gen_random_uuid(),1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-authenticated','local-policy-v1','2026-08-25T00:00:00Z',NULL);
    v_actual := 'hostile_execute_unexpected_result';
  EXCEPTION WHEN insufficient_privilege THEN v_actual := 'execute_denied';
  END;
  INSERT INTO pg_temp.approval_scenario_results VALUES ('authenticated_execute_denied','execute_denied',v_actual,v_actual = 'execute_denied',CASE WHEN v_actual = 'execute_denied' THEN NULL ELSE v_actual END);
END;
$rehearsal$;
RESET ROLE;
SELECT scenario_name, expected_result, actual_result, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS pass_fail, safe_failure_code
FROM pg_temp.approval_scenario_results
ORDER BY scenario_name;
DO $rehearsal$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.approval_scenario_results WHERE NOT passed) THEN
    RAISE EXCEPTION 'LOCAL_APPROVAL_SCENARIOS_FAILED';
  END IF;
END;
$rehearsal$;
ROLLBACK;
SELECT 'CONTROL|LOCAL_APPROVAL_REHEARSAL=PASS';
'@

  function Invoke-LocalPsqlFile([string]$FilePath) {
    & $Psql -X -w -v ON_ERROR_STOP=1 -d $LocalConnectionString.Trim() -f $FilePath
    if ($LASTEXITCODE -ne 0) { throw "LOCAL_APPROVAL_REHEARSAL_PSQL_FAILED: $FilePath" }
  }

  Write-Host 'Applying disposable local prerequisites, Migration 024, and Migration 025.'
  Invoke-LocalPsqlFile $BaselineSql
  Invoke-LocalPsqlFile $Migration024
  Invoke-LocalPsqlFile $Migration025
  Write-Host 'Running Migration 026 preflight.'
  Invoke-LocalPsqlFile $Preflight026
  Write-Host 'Applying Migration 026 first time.'
  Invoke-LocalPsqlFile $Migration026
  Write-Host 'Applying Migration 026 second time for idempotency.'
  Invoke-LocalPsqlFile $Migration026
  Write-Host 'Running Migration 026 postflight before disposable behavior seeding.'
  Invoke-LocalPsqlFile $Postflight026
  Write-Host 'Rehearsing approval, fail-closed, idempotency, rollback, hostile-role, and forbidden-write safety.'
  Invoke-LocalPsqlFile $BehaviorSql
} finally {
  if (Test-Path -LiteralPath $TempDirectory) { Remove-Item -LiteralPath $TempDirectory -Recurse -Force }
}
