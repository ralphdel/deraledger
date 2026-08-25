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

-- service_role invokes only the two reviewed-profile RPC contracts. It has no
-- direct table write in the behavior phase.
SET LOCAL ROLE service_role;
DO $rehearsal$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000301','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000401',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-approve-lite','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_applied' THEN RAISE EXCEPTION 'lite verified failed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000301','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000401',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-approve-lite','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_idempotent_replay' THEN RAISE EXCEPTION 'sequential idempotent replay failed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000302','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000402',1,'needs_attention',1,'00000000-0000-4000-8000-000000000101','local-026-needs-attention','local-policy-v1','2026-08-25T00:00:00Z','evidence_incomplete');
  IF r.result_code <> 'approval_applied' THEN RAISE EXCEPTION 'lite needs attention failed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000303','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000403',1,'rejected',1,'00000000-0000-4000-8000-000000000101','local-026-rejected','local-policy-v1','2026-08-25T00:00:00Z','review_rejected');
  IF r.result_code <> 'approval_applied' THEN RAISE EXCEPTION 'lite rejected failed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000204','00000000-0000-4000-8000-000000000304','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000404',1,'restricted',1,'00000000-0000-4000-8000-000000000101','local-026-restricted','local-policy-v1','2026-08-25T00:00:00Z','risk_restricted');
  IF r.result_code <> 'approval_applied' THEN RAISE EXCEPTION 'lite restricted failed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000205','00000000-0000-4000-8000-000000000305','business','business_kyb_review','00000000-0000-4000-8000-000000000405',1,'business_verified',1,'00000000-0000-4000-8000-000000000101','local-026-business','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_applied' THEN RAISE EXCEPTION 'business verified failed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000206','00000000-0000-4000-8000-000000000306','solo_plus','solo_plus_case','00000000-0000-4000-8000-000000000406',1,'enhanced_verified',1,'00000000-0000-4000-8000-000000000101','local-026-plus-approved','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_applied' THEN RAISE EXCEPTION 'solo plus approved failed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000207','00000000-0000-4000-8000-000000000307','solo_plus','solo_plus_case','00000000-0000-4000-8000-000000000407',1,'rejected',1,'00000000-0000-4000-8000-000000000101','local-026-plus-rejected','local-policy-v1','2026-08-25T00:01:00Z','review_rejected');
  IF r.result_code <> 'approval_applied' THEN RAISE EXCEPTION 'solo plus rejected failed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000208','00000000-0000-4000-8000-000000000308','solo_plus','solo_plus_case','00000000-0000-4000-8000-000000000408',1,'needs_attention',1,'00000000-0000-4000-8000-000000000101','local-026-plus-attention','local-policy-v1','2026-08-25T00:00:00Z','evidence_incomplete');
  IF r.result_code <> 'approval_applied' THEN RAISE EXCEPTION 'solo plus manual review failed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1(gen_random_uuid(),gen_random_uuid(),'solo_lite','solo_lite_review',gen_random_uuid(),1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-missing','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_profile_missing' THEN RAISE EXCEPTION 'missing profile did not fail closed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000209','00000000-0000-4000-8000-000000000309','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000409',1,'lite_verified',2,'00000000-0000-4000-8000-000000000101','local-026-stale','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_profile_state_invalid' THEN RAISE EXCEPTION 'stale version did not fail closed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000209','00000000-0000-4000-8000-000000000309','business','solo_lite_review','00000000-0000-4000-8000-000000000409',1,'business_verified',1,'00000000-0000-4000-8000-000000000101','local-026-plan-mismatch','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_payload_invalid' THEN RAISE EXCEPTION 'plan/source mismatch did not fail closed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000209','00000000-0000-4000-8000-000000000309','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000409',1,'enhanced_verified',1,'00000000-0000-4000-8000-000000000101','local-026-transition','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_payload_invalid' THEN RAISE EXCEPTION 'unsupported transition did not fail closed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000301','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000401',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-approve-lite','different-policy','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_idempotency_conflict' THEN RAISE EXCEPTION 'idempotency mismatch did not fail closed: %', r.result_code; END IF;
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000310','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000410',1,'lite_verified',1,'00000000-0000-4000-8000-000000000102','local-026-missing-reviewer','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_reviewer_invalid' THEN RAISE EXCEPTION 'missing reviewer did not fail closed: %', r.result_code; END IF;
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

-- Deliberately remove an approved writer privilege late in the RPC and verify
-- that the exception returns a safe failure with no profile/event partial state.
REVOKE UPDATE ON TABLE public.merchant_compliance_profiles FROM service_role;
SET LOCAL ROLE service_role;
DO $rehearsal$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000310','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000410',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-profile-write-failure','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_atomic_write_failed' THEN RAISE EXCEPTION 'profile rollback was not fail closed: %', r.result_code; END IF;
END;
$rehearsal$;
RESET ROLE;
GRANT UPDATE ON TABLE public.merchant_compliance_profiles TO service_role;

REVOKE INSERT ON TABLE public.merchant_compliance_events FROM service_role;
SET LOCAL ROLE service_role;
DO $rehearsal$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.review_compliance_profile_decision_v1('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000311','solo_lite','solo_lite_review','00000000-0000-4000-8000-000000000411',1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-event-write-failure','local-policy-v1','2026-08-25T00:00:00Z',NULL);
  IF r.result_code <> 'approval_atomic_write_failed' THEN RAISE EXCEPTION 'event rollback was not fail closed: %', r.result_code; END IF;
END;
$rehearsal$;
RESET ROLE;
GRANT INSERT ON TABLE public.merchant_compliance_events TO service_role;

DO $rehearsal$
DECLARE
  v_relation text;
  v_has_rows boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE id IN ('00000000-0000-4000-8000-000000000310','00000000-0000-4000-8000-000000000311') AND compliance_status <> 'lite_pending')
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_events WHERE idempotency_key IN ('local-026-profile-write-failure','local-026-event-write-failure')) THEN
    RAISE EXCEPTION 'rollback left partial profile decision or event';
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchants WHERE NOT setup_mode OR live_features_enabled)
    OR EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE can_collect_payments OR activation_status = 'active')
    OR EXISTS (SELECT 1 FROM public.merchant_collection_limit_windows)
    OR EXISTS (SELECT 1 FROM public.merchant_collection_limit_reservations)
    OR EXISTS (SELECT 1 FROM public.merchant_collection_limit_reservation_windows)
    OR EXISTS (SELECT 1 FROM public.merchant_collection_usage_events) THEN
    RAISE EXCEPTION 'forbidden write detected';
  END IF;
  FOREACH v_relation IN ARRAY ARRAY[
    'public.invoices', 'public.payment_records', 'public.subscriptions',
    'public.payment_providers', 'public.provider_settlement_accounts'
  ] LOOP
    IF to_regclass(v_relation) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s)', v_relation) INTO v_has_rows;
      IF v_has_rows THEN RAISE EXCEPTION 'forbidden table row detected: %', v_relation; END IF;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE')
    OR has_function_privilege('PUBLIC', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'hostile role grant check failed';
  END IF;
END;
$rehearsal$;

-- Hostile role invocation checks run only after admin seeding and service-role
-- contract behavior. They must receive insufficient_privilege, never a result.
SET LOCAL ROLE anon;
DO $rehearsal$
DECLARE r record;
BEGIN
  BEGIN
    SELECT * INTO r FROM public.review_compliance_profile_decision_v1(gen_random_uuid(),gen_random_uuid(),'solo_lite','solo_lite_review',gen_random_uuid(),1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-anon','local-policy-v1','2026-08-25T00:00:00Z',NULL);
    RAISE EXCEPTION 'anon executed approval RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$rehearsal$;
SET LOCAL ROLE authenticated;
DO $rehearsal$
DECLARE r record;
BEGIN
  BEGIN
    SELECT * INTO r FROM public.review_compliance_profile_decision_v1(gen_random_uuid(),gen_random_uuid(),'solo_lite','solo_lite_review',gen_random_uuid(),1,'lite_verified',1,'00000000-0000-4000-8000-000000000101','local-026-authenticated','local-policy-v1','2026-08-25T00:00:00Z',NULL);
    RAISE EXCEPTION 'authenticated executed approval RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
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
