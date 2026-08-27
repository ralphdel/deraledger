[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$LocalConnectionString,
  [Parameter(Mandatory = $true)][string]$Confirmation,
  [switch]$Execute,
  [string]$PsqlPath = 'psql'
)

$ErrorActionPreference = 'Stop'
$ConfirmationPhrase = 'REHEARSE MIGRATION 030 LOCAL DISPOSABLE DB ONLY'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Migration024 = Join-Path $ProjectRoot 'supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql'
$Migration025 = Join-Path $ProjectRoot 'supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql'
$Migration026 = Join-Path $ProjectRoot 'supabase/migrations/20260825_00_reviewed_profile_approval_rpc.sql'
$Migration027 = Join-Path $ProjectRoot 'supabase/migrations/20260825_01_cleanup_approval_rpc_diagnostics.sql'
$Migration028 = Join-Path $ProjectRoot 'supabase/migrations/20260825_02_canonical_approval_snapshot_idempotency.sql'
$Migration029 = Join-Path $ProjectRoot 'supabase/migrations/20260826_00_canonical_workspace_linkage.sql'
$Migration030 = Join-Path $ProjectRoot 'supabase/migrations/20260827_00_m028_m029_readiness_integration.sql'
$Preflight026 = Join-Path $ProjectRoot 'supabase/staging/preflight/026_reviewed_profile_approval_rpc_snapshot.sql'
$Postflight026 = Join-Path $ProjectRoot 'supabase/staging/postflight/026_reviewed_profile_approval_rpc_verify.sql'
$Preflight027 = Join-Path $ProjectRoot 'supabase/staging/preflight/027_cleanup_approval_rpc_diagnostics_snapshot.sql'
$Postflight027 = Join-Path $ProjectRoot 'supabase/staging/postflight/027_cleanup_approval_rpc_diagnostics_verify.sql'
$Preflight028 = Join-Path $ProjectRoot 'supabase/staging/preflight/028_canonical_approval_snapshot_idempotency_snapshot.sql'
$Postflight028 = Join-Path $ProjectRoot 'supabase/staging/postflight/028_canonical_approval_snapshot_idempotency_verify.sql'
$Preflight029 = Join-Path $ProjectRoot 'supabase/staging/preflight/029_canonical_workspace_linkage_snapshot.sql'
$Postflight029 = Join-Path $ProjectRoot 'supabase/staging/postflight/029_canonical_workspace_linkage_verify.sql'
$Preflight030 = Join-Path $ProjectRoot 'supabase/staging/preflight/030_m028_m029_readiness_integration_snapshot.sql'
$Postflight030 = Join-Path $ProjectRoot 'supabase/staging/postflight/030_m028_m029_readiness_integration_verify.sql'

function Get-LocalPgKeywordConnectionValue {
  param([Parameter(Mandatory = $true)][string]$ConnectionString, [Parameter(Mandatory = $true)][string]$Name)
  $pattern = '(?i)(?:^|\s)' + [regex]::Escape($Name) + '\s*=\s*(?:"(?<double>[^"]*)"|''(?<single>[^'']*)''|(?<bare>[^\s;]+))'
  $matches = [regex]::Matches($ConnectionString, $pattern)
  if ($matches.Count -eq 0) { return $null }
  if ($matches.Count -ne 1) { throw "LOCAL_M030_REHEARSAL_CONNECTION_VALUE_AMBIGUOUS: $Name" }
  foreach ($groupName in @('double', 'single', 'bare')) {
    if ($matches[0].Groups[$groupName].Success) { return $matches[0].Groups[$groupName].Value.Trim() }
  }
  throw "LOCAL_M030_REHEARSAL_CONNECTION_VALUE_INVALID: $Name"
}

function Get-LocalPgConnectionParts {
  param([Parameter(Mandatory = $true)][string]$ConnectionString)
  if ($ConnectionString -match '^(?i:postgres(?:ql)?://)') { throw 'LOCAL_M030_REHEARSAL_KEYWORD_CONNECTION_STRING_REQUIRED' }
  $hostName = Get-LocalPgKeywordConnectionValue $ConnectionString 'host'
  $port = Get-LocalPgKeywordConnectionValue $ConnectionString 'port'
  $databaseName = Get-LocalPgKeywordConnectionValue $ConnectionString 'dbname'
  $userName = Get-LocalPgKeywordConnectionValue $ConnectionString 'user'
  if ([string]::IsNullOrWhiteSpace($hostName)) { throw 'LOCAL_M030_REHEARSAL_HOST_MISSING' }
  if ([string]::IsNullOrWhiteSpace($port)) { throw 'LOCAL_M030_REHEARSAL_PORT_REQUIRED' }
  if ([string]::IsNullOrWhiteSpace($databaseName)) { throw 'LOCAL_M030_REHEARSAL_DATABASE_NAME_REQUIRED' }
  if ([string]::IsNullOrWhiteSpace($userName)) { throw 'LOCAL_M030_REHEARSAL_USER_REQUIRED' }
  @{ Host = $hostName.ToLowerInvariant(); Port = $port; Database = $databaseName; User = $userName }
}

function Assert-LocalDisposableConnectionString {
  param([Parameter(Mandatory = $true)][string]$ConnectionString)
  if ([string]::IsNullOrWhiteSpace($ConnectionString)) { throw 'LOCAL_M030_REHEARSAL_CONNECTION_STRING_REQUIRED' }
  if ($ConnectionString -match '(?i)(supabase\.(?:co|com)|vercel|production|staging|service_role|anon|eyJ|password\s*=|://[^/\s]*:|[&|<>()^"%])') {
    throw 'LOCAL_M030_REHEARSAL_CONNECTION_STRING_REJECTED'
  }
  $target = Get-LocalPgConnectionParts $ConnectionString
  if ($target.Host -notin @('localhost', '127.0.0.1')) { throw 'LOCAL_M030_REHEARSAL_NONLOCAL_HOST_REJECTED' }
  if ($target.Port -notmatch '^\d+$' -or [int]$target.Port -ne 55432) { throw 'LOCAL_M030_REHEARSAL_LOCAL_PORT_REQUIRED' }
  if ($target.Database -notmatch '^deraledger_m030_disposable_[a-z0-9_]+$') { throw 'LOCAL_M030_REHEARSAL_DISPOSABLE_DATABASE_NAME_REQUIRED' }
  if ($target.User -notmatch '^[A-Za-z_][A-Za-z0-9_$-]*$') { throw 'LOCAL_M030_REHEARSAL_USER_INVALID' }
  return $target
}

function Write-LocalSqlFileNoBom {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Content)
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

if ($Confirmation.Trim() -cne $ConfirmationPhrase) { throw 'LOCAL_M030_REHEARSAL_CONFIRMATION_REQUIRED' }
$Target = Assert-LocalDisposableConnectionString $LocalConnectionString.Trim()
Write-Host "LOCAL-ONLY DISPOSABLE TARGET: $($Target.Host):$($Target.Port)/$($Target.Database)"
Write-Host 'FORBIDDEN: staging, production, Supabase projects, runtime adoption, approval execution against real data, activation, collection unlock, and payment/provider testing.'
if (-not $Execute) {
  Write-Host 'DRY RUN ONLY. Re-run with -Execute only for the named disposable local database.'
  exit 0
}

foreach ($path in @(
  $Migration024, $Migration025, $Migration026, $Migration027, $Migration028, $Migration029, $Migration030,
  $Preflight026, $Postflight026, $Preflight027, $Postflight027, $Preflight028, $Postflight028,
  $Preflight029, $Postflight029, $Preflight030, $Postflight030
)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "LOCAL_M030_REHEARSAL_SOURCE_MISSING: $path" }
}

$Psql = if (Test-Path -LiteralPath $PsqlPath) { (Resolve-Path -LiteralPath $PsqlPath).Path } else { (Resolve-Path -LiteralPath (Get-Command $PsqlPath -ErrorAction Stop).Source).Path }
$TempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("deraledger-m030-readiness-" + [guid]::NewGuid().ToString('N'))
$EvidenceDirectory = Join-Path $ProjectRoot ("local-evidence/migration-030-local-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $TempDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$BaselineSql = Join-Path $TempDirectory '024-029-workspace-prerequisites.sql'
$BehaviorSql = Join-Path $TempDirectory '030-readiness-behavior.sql'
$OriginalPGOPTIONS = $env:PGOPTIONS
$env:PGOPTIONS = '-c client_min_messages=warning'

try {
  # Owner-only fixture schema. It establishes the historic local workspace
  # contract needed by M029; this is never a staging/production repair path.
  Write-LocalSqlFileNoBom $BaselineSql @'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.merchants (id uuid PRIMARY KEY, setup_mode boolean NOT NULL DEFAULT true, live_features_enabled boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS public.workspaces (id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE, CONSTRAINT workspaces_merchant_id_key UNIQUE (merchant_id));
CREATE TABLE IF NOT EXISTS public.invoices (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.payment_records (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.solo_plus_cases (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id), target_plan text NOT NULL,
  case_status text NOT NULL, requirements_policy_version text NOT NULL, approved_at timestamptz,
  approved_by_admin_id uuid, rejected_at timestamptz, rejected_by_admin_id uuid, row_version bigint NOT NULL DEFAULT 1
);
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT ON TABLE auth.users, public.merchants, public.workspaces, public.solo_plus_cases TO service_role;
'@

  Write-LocalSqlFileNoBom $BehaviorSql @'
BEGIN;
RESET ROLE;

-- Owner/admin seeds precede every service-role and hostile-role check.
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000003001');
INSERT INTO public.merchants(id) VALUES
  ('00000000-0000-4000-8000-000000003011'), ('00000000-0000-4000-8000-000000003012'),
  ('00000000-0000-4000-8000-000000003013'), ('00000000-0000-4000-8000-000000003014'),
  ('00000000-0000-4000-8000-000000003015'), ('00000000-0000-4000-8000-000000003016'),
  ('00000000-0000-4000-8000-000000003017');
INSERT INTO public.workspaces(id, merchant_id) VALUES
  ('00000000-0000-4000-8000-000000003021','00000000-0000-4000-8000-000000003011'),
  ('00000000-0000-4000-8000-000000003022','00000000-0000-4000-8000-000000003012'),
  ('00000000-0000-4000-8000-000000003023','00000000-0000-4000-8000-000000003013'),
  ('00000000-0000-4000-8000-000000003024','00000000-0000-4000-8000-000000003014'),
  ('00000000-0000-4000-8000-000000003025','00000000-0000-4000-8000-000000003015'),
  ('00000000-0000-4000-8000-000000003026','00000000-0000-4000-8000-000000003016'),
  ('00000000-0000-4000-8000-000000003027','00000000-0000-4000-8000-000000003017');
INSERT INTO public.merchant_compliance_profiles(
  id, merchant_id, plan_code, compliance_status, activation_status, decision_source_type, decision_source_id, decision_source_version, row_version
) VALUES
  ('00000000-0000-4000-8000-000000003101','00000000-0000-4000-8000-000000003011','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000003201',1,1),
  ('00000000-0000-4000-8000-000000003102','00000000-0000-4000-8000-000000003012','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000003202',1,1),
  ('00000000-0000-4000-8000-000000003103','00000000-0000-4000-8000-000000003013','business','business_pending','test_mode','business_kyb_review','00000000-0000-4000-8000-000000003203',1,1),
  ('00000000-0000-4000-8000-000000003104','00000000-0000-4000-8000-000000003014','solo_plus','enhanced_pending','test_mode','solo_plus_case','00000000-0000-4000-8000-000000003204',1,1),
  ('00000000-0000-4000-8000-000000003105','00000000-0000-4000-8000-000000003015','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000003205',1,1),
  ('00000000-0000-4000-8000-000000003106','00000000-0000-4000-8000-000000003016','solo_lite','lite_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000003206',1,1),
  ('00000000-0000-4000-8000-000000003107','00000000-0000-4000-8000-000000003017','solo_lite','business_pending','test_mode','solo_lite_review','00000000-0000-4000-8000-000000003207',1,1);
INSERT INTO public.merchant_compliance_reviews(id,merchant_id,profile_id,review_type,target_plan_code,review_status,idempotency_key,row_version) VALUES
  ('00000000-0000-4000-8000-000000003201','00000000-0000-4000-8000-000000003011','00000000-0000-4000-8000-000000003101','solo_lite','solo_lite','pending','m030-no-link',1),
  ('00000000-0000-4000-8000-000000003202','00000000-0000-4000-8000-000000003012','00000000-0000-4000-8000-000000003102','solo_lite','solo_lite','pending','m030-lite',1),
  ('00000000-0000-4000-8000-000000003203','00000000-0000-4000-8000-000000003013','00000000-0000-4000-8000-000000003103','business_kyb','business','pending','m030-business',1),
  ('00000000-0000-4000-8000-000000003205','00000000-0000-4000-8000-000000003015','00000000-0000-4000-8000-000000003105','solo_lite','solo_lite','pending','m030-stale-profile',1),
  ('00000000-0000-4000-8000-000000003206','00000000-0000-4000-8000-000000003016','00000000-0000-4000-8000-000000003106','solo_lite','solo_lite','pending','m030-stale-source',1),
  ('00000000-0000-4000-8000-000000003207','00000000-0000-4000-8000-000000003017','00000000-0000-4000-8000-000000003107','solo_lite','solo_lite','pending','m030-plan-status',1);
INSERT INTO public.solo_plus_cases(id,merchant_id,target_plan,case_status,requirements_policy_version,approved_at,approved_by_admin_id,row_version) VALUES
  ('00000000-0000-4000-8000-000000003204','00000000-0000-4000-8000-000000003014','solo_plus','approved','m030-policy-solo-plus','2026-08-27T00:00:00Z','00000000-0000-4000-8000-000000003001',1);
INSERT INTO public.approval_policy_versions(policy_version,plan_code,source_type) VALUES
  ('m030-policy-lite','solo_lite','solo_lite_review'), ('m030-policy-business','business','business_kyb_review'), ('m030-policy-solo-plus','solo_plus','solo_plus_case');

CREATE TEMP TABLE m030_results(scenario_name text NOT NULL, expected_result text NOT NULL, actual_result text NOT NULL, passed boolean NOT NULL, safe_failure_code text);
GRANT SELECT, INSERT ON m030_results TO service_role, anon, authenticated;
CREATE OR REPLACE FUNCTION pg_temp.record_m030(p_name text,p_expected text,p_actual text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO pg_temp.m030_results VALUES (p_name,p_expected,p_actual,p_expected=p_actual,CASE WHEN p_expected=p_actual THEN NULL ELSE p_actual END); END; $$;
CREATE OR REPLACE FUNCTION pg_temp.capture_issue(p_name text,p_expected text,p_profile uuid,p_target text,p_policy text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_actual text := 'canonical_request_v2_failed'; v_before bigint; v_after bigint; BEGIN
  SELECT count(*) INTO v_before FROM public.approval_decision_requests;
  BEGIN SELECT result_code INTO v_actual FROM public.issue_canonical_approval_decision_request_v2(p_profile,'00000000-0000-4000-8000-000000003001',p_target,p_policy,p_reason); EXCEPTION WHEN OTHERS THEN v_actual := 'canonical_request_v2_invocation_failed'; END;
  SELECT count(*) INTO v_after FROM public.approval_decision_requests;
  IF p_name = 'failed_issue_has_no_partial_request' AND v_after <> v_before THEN v_actual := 'partial_request_written'; END IF;
  PERFORM pg_temp.record_m030(p_name,p_expected,v_actual);
END; $$;
CREATE OR REPLACE FUNCTION pg_temp.capture_snapshot(p_name text,p_expected text,p_request uuid) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE v_actual text := 'canonical_snapshot_v2_failed'; BEGIN
  BEGIN SELECT result_code INTO v_actual FROM public.read_canonical_approval_snapshot_v2(p_request); EXCEPTION WHEN OTHERS THEN v_actual := 'canonical_snapshot_v2_invocation_failed'; END;
  PERFORM pg_temp.record_m030(p_name,p_expected,v_actual);
END; $$;
-- Optional commerce relations vary across historical local baselines. Capture
-- their state through to_regclass so absent relations are evidence, not errors.
CREATE TEMP TABLE m030_forbidden_business_before(
  category text NOT NULL,
  table_name text NOT NULL,
  relation_was_present boolean NOT NULL,
  before_count bigint,
  presence_status text NOT NULL,
  PRIMARY KEY(category, table_name)
);
CREATE OR REPLACE FUNCTION pg_temp.snapshot_forbidden_business_table(p_category text,p_table_name text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_relation regclass; v_count bigint; BEGIN
  v_relation := to_regclass(format('public.%I', p_table_name));
  IF v_relation IS NULL THEN
    INSERT INTO pg_temp.m030_forbidden_business_before(category,table_name,relation_was_present,before_count,presence_status)
    VALUES (p_category,p_table_name,false,NULL,'not_present');
  ELSE
    EXECUTE format('SELECT count(*) FROM %s', v_relation) INTO v_count;
    INSERT INTO pg_temp.m030_forbidden_business_before(category,table_name,relation_was_present,before_count,presence_status)
    VALUES (p_category,p_table_name,true,v_count,'present');
  END IF;
END; $$;
CREATE OR REPLACE FUNCTION pg_temp.forbidden_business_category_unchanged(p_category text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_row record; v_relation regclass; v_after_count bigint; BEGIN
  FOR v_row IN SELECT * FROM pg_temp.m030_forbidden_business_before WHERE category=p_category LOOP
    v_relation := to_regclass(format('public.%I', v_row.table_name));
    IF v_row.relation_was_present IS DISTINCT FROM (v_relation IS NOT NULL) THEN RETURN false; END IF;
    IF v_relation IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %s', v_relation) INTO v_after_count;
      IF v_after_count IS DISTINCT FROM v_row.before_count THEN RETURN false; END IF;
    END IF;
  END LOOP;
  RETURN true;
END; $$;
DO $$ BEGIN
  PERFORM pg_temp.snapshot_forbidden_business_table('subscriptions','subscriptions');
  PERFORM pg_temp.snapshot_forbidden_business_table('subscriptions','subscription_payments');
  PERFORM pg_temp.snapshot_forbidden_business_table('subscriptions','manual_payments');
  PERFORM pg_temp.snapshot_forbidden_business_table('providers_settlements','payment_records');
  PERFORM pg_temp.snapshot_forbidden_business_table('providers_settlements','payments');
  PERFORM pg_temp.snapshot_forbidden_business_table('providers_settlements','payment_providers');
  PERFORM pg_temp.snapshot_forbidden_business_table('providers_settlements','providers');
  PERFORM pg_temp.snapshot_forbidden_business_table('providers_settlements','provider_accounts');
  PERFORM pg_temp.snapshot_forbidden_business_table('providers_settlements','provider_settlement_accounts');
  PERFORM pg_temp.snapshot_forbidden_business_table('providers_settlements','settlements');
  PERFORM pg_temp.snapshot_forbidden_business_table('providers_settlements','payment_settlements');
  PERFORM pg_temp.snapshot_forbidden_business_table('checkout','checkout_sessions');
  PERFORM pg_temp.snapshot_forbidden_business_table('checkout','checkout_session');
  PERFORM pg_temp.snapshot_forbidden_business_table('checkout','payment_intents');
  PERFORM pg_temp.snapshot_forbidden_business_table('checkout','payment_intent');
  PERFORM pg_temp.snapshot_forbidden_business_table('checkout','payment_sessions');
  PERFORM pg_temp.snapshot_forbidden_business_table('checkout','checkout_payment_sessions');
  PERFORM pg_temp.snapshot_forbidden_business_table('storefront','storefronts');
  PERFORM pg_temp.snapshot_forbidden_business_table('storefront','storefront_products');
  PERFORM pg_temp.snapshot_forbidden_business_table('storefront','products');
  PERFORM pg_temp.snapshot_forbidden_business_table('storefront','storefront_orders');
  PERFORM pg_temp.snapshot_forbidden_business_table('storefront','orders');
  PERFORM pg_temp.snapshot_forbidden_business_table('storefront','storefront_carts');
  PERFORM pg_temp.snapshot_forbidden_business_table('storefront','carts');
  PERFORM pg_temp.snapshot_forbidden_business_table('storefront','storefront_customers');
  PERFORM pg_temp.snapshot_forbidden_business_table('storefront','customers');
  PERFORM pg_temp.snapshot_forbidden_business_table('invoices_limits','invoices');
  PERFORM pg_temp.snapshot_forbidden_business_table('invoices_limits','merchant_collection_limit_windows');
  PERFORM pg_temp.snapshot_forbidden_business_table('invoices_limits','merchant_collection_limit_reservations');
  PERFORM pg_temp.snapshot_forbidden_business_table('invoices_limits','merchant_collection_limit_reservation_windows');
  PERFORM pg_temp.snapshot_forbidden_business_table('invoices_limits','merchant_collection_usage_events');
END $$;
SELECT 'FORBIDDEN_TABLE_BASELINE|' || category || '|' || table_name || '|' || presence_status || '|' || COALESCE(before_count::text,'skipped')
FROM pg_temp.m030_forbidden_business_before ORDER BY category,table_name;
GRANT EXECUTE ON FUNCTION pg_temp.capture_issue(text,text,uuid,text,text,text), pg_temp.capture_snapshot(text,text,uuid) TO service_role;

SET LOCAL ROLE service_role;
SELECT pg_temp.capture_issue('no_canonical_link_issue_blocked','canonical_request_v2_workspace_linkage_unavailable','00000000-0000-4000-8000-000000003101','lite_verified','m030-policy-lite',NULL);
SELECT pg_temp.capture_snapshot('no_canonical_link_snapshot_blocked','canonical_snapshot_v2_request_missing','00000000-0000-4000-8000-000000003101');
DO $$ DECLARE v_actual text; BEGIN
  SELECT result_code INTO v_actual FROM public.issue_canonical_approval_decision_request_v1('00000000-0000-4000-8000-000000003102','00000000-0000-4000-8000-000000003001','lite_verified','m030-policy-lite',NULL);
  PERFORM pg_temp.record_m030('m028_v1_still_fail_closed','canonical_request_workspace_linkage_unavailable',v_actual);
END $$;
RESET ROLE;

-- M029 reconciliation is a prerequisite fixture; M030 never creates links.
SET LOCAL ROLE service_role;
DO $$ DECLARE v_actual text; BEGIN
  SELECT result_code INTO v_actual FROM public.reconcile_canonical_merchant_workspace_link_v1('00000000-0000-4000-8000-000000003012','00000000-0000-4000-8000-000000003001','m030-link-lite');
  PERFORM pg_temp.record_m030('m029_link_prerequisite','canonical_workspace_link_created',v_actual);
  PERFORM public.reconcile_canonical_merchant_workspace_link_v1('00000000-0000-4000-8000-000000003013','00000000-0000-4000-8000-000000003001','m030-link-business');
  PERFORM public.reconcile_canonical_merchant_workspace_link_v1('00000000-0000-4000-8000-000000003014','00000000-0000-4000-8000-000000003001','m030-link-solo');
  PERFORM public.reconcile_canonical_merchant_workspace_link_v1('00000000-0000-4000-8000-000000003015','00000000-0000-4000-8000-000000003001','m030-link-stale-profile');
  PERFORM public.reconcile_canonical_merchant_workspace_link_v1('00000000-0000-4000-8000-000000003016','00000000-0000-4000-8000-000000003001','m030-link-stale-source');
END $$;
SELECT pg_temp.capture_issue('lite_issue_created','canonical_request_v2_created','00000000-0000-4000-8000-000000003102','lite_verified','m030-policy-lite',NULL);
SELECT pg_temp.capture_issue('business_issue_created','canonical_request_v2_created','00000000-0000-4000-8000-000000003103','business_verified','m030-policy-business',NULL);
SELECT pg_temp.capture_issue('solo_plus_issue_created','canonical_request_v2_created','00000000-0000-4000-8000-000000003104','enhanced_verified','m030-policy-solo-plus',NULL);
SELECT pg_temp.capture_issue('matching_retry_replay','canonical_request_v2_idempotent_replay','00000000-0000-4000-8000-000000003102','lite_verified','m030-policy-lite',NULL);
SELECT pg_temp.capture_snapshot('matching_snapshot_ready','canonical_snapshot_v2_ready',(SELECT id FROM public.approval_decision_requests WHERE profile_id='00000000-0000-4000-8000-000000003102'));
SELECT pg_temp.capture_issue('incompatible_plan_status_blocked','canonical_request_v2_profile_state_invalid','00000000-0000-4000-8000-000000003107','lite_verified','m030-policy-lite',NULL);
SELECT pg_temp.capture_issue('failed_issue_has_no_partial_request','canonical_request_v2_payload_invalid','00000000-0000-4000-8000-000000003102','not-a-status','m030-policy-lite',NULL);
RESET ROLE;

-- Owner-only stale fixtures occur before the no-v2-mutation boundary snapshot.
SET LOCAL ROLE service_role;
SELECT pg_temp.capture_issue('stale_profile_issue_created','canonical_request_v2_created','00000000-0000-4000-8000-000000003105','lite_verified','m030-policy-lite',NULL);
SELECT pg_temp.capture_issue('stale_source_issue_created','canonical_request_v2_created','00000000-0000-4000-8000-000000003106','lite_verified','m030-policy-lite',NULL);
RESET ROLE;
UPDATE public.merchant_compliance_profiles SET row_version=2 WHERE id='00000000-0000-4000-8000-000000003105';
UPDATE public.merchant_compliance_reviews SET row_version=2 WHERE id='00000000-0000-4000-8000-000000003206';
SET LOCAL ROLE service_role;
SELECT pg_temp.capture_snapshot('stale_profile_version_blocked','canonical_snapshot_v2_stale_or_conflicting',(SELECT id FROM public.approval_decision_requests WHERE profile_id='00000000-0000-4000-8000-000000003105'));
SELECT pg_temp.capture_snapshot('stale_source_version_blocked','canonical_snapshot_v2_source_invalid',(SELECT id FROM public.approval_decision_requests WHERE profile_id='00000000-0000-4000-8000-000000003106'));
RESET ROLE;

CREATE TEMP TABLE m030_authority_before AS SELECT merchant_id,workspace_id,link_version FROM public.merchant_canonical_workspaces;
CREATE TEMP TABLE m030_merchant_workspace_before AS
  SELECT m.id AS merchant_id,m.setup_mode,m.live_features_enabled,w.id AS workspace_id,w.merchant_id AS workspace_merchant_id
  FROM public.merchants m JOIN public.workspaces w ON w.merchant_id=m.id;
CREATE TEMP TABLE m030_profile_event_before AS SELECT id,row_version,compliance_status,activation_status,can_collect_payments FROM public.merchant_compliance_profiles;
CREATE TEMP TABLE m030_event_before AS SELECT id FROM public.merchant_compliance_events;

-- Browser roles remain hostile after all owner seed/setup work.
SET LOCAL ROLE anon;
DO $$ DECLARE v_actual text := 'unexpected'; BEGIN BEGIN PERFORM * FROM public.issue_canonical_approval_decision_request_v2('00000000-0000-4000-8000-000000003102','00000000-0000-4000-8000-000000003001','lite_verified','m030-policy-lite',NULL); v_actual:='execute_allowed'; EXCEPTION WHEN insufficient_privilege THEN v_actual:='execute_denied'; END; PERFORM pg_temp.record_m030('anon_execute_denied','execute_denied',v_actual); END $$;
DO $$ DECLARE v_actual text := 'unexpected'; BEGIN BEGIN PERFORM 1 FROM public.approval_decision_requests; v_actual:='table_allowed'; EXCEPTION WHEN insufficient_privilege THEN v_actual:='table_denied'; END; PERFORM pg_temp.record_m030('anon_table_denied','table_denied',v_actual); END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_actual text := 'unexpected'; BEGIN BEGIN PERFORM * FROM public.read_canonical_approval_snapshot_v2('00000000-0000-4000-8000-000000003101'); v_actual:='execute_allowed'; EXCEPTION WHEN insufficient_privilege THEN v_actual:='execute_denied'; END; PERFORM pg_temp.record_m030('authenticated_execute_denied','execute_denied',v_actual); END $$;
DO $$ DECLARE v_actual text := 'unexpected'; BEGIN BEGIN PERFORM 1 FROM public.merchant_canonical_workspaces; v_actual:='table_allowed'; EXCEPTION WHEN insufficient_privilege THEN v_actual:='table_denied'; END; PERFORM pg_temp.record_m030('authenticated_table_denied','table_denied',v_actual); END $$;
RESET ROLE;

-- Durable-idempotency and ownership corruption attempts are owner fixture probes, not M030 writes.
DO $$ DECLARE v_actual text := 'idempotency_reuse_allowed'; BEGIN
  BEGIN INSERT INTO public.approval_decision_requests(decision_idempotency_key,reviewer_id,merchant_id,workspace_id,profile_id,plan_code,source_type,source_id,source_version,expected_profile_row_version,target_compliance_status,policy_version,reviewed_at)
    SELECT decision_idempotency_key,reviewer_id,merchant_id,workspace_id,profile_id,plan_code,source_type,source_id,source_version,expected_profile_row_version,target_compliance_status,policy_version,reviewed_at FROM public.approval_decision_requests WHERE profile_id='00000000-0000-4000-8000-000000003102';
  EXCEPTION WHEN unique_violation THEN v_actual:='idempotency_key_reuse_blocked'; END;
  PERFORM pg_temp.record_m030('conflicting_idempotency_reuse_blocked','idempotency_key_reuse_blocked',v_actual);
END $$;
DO $$ DECLARE v_actual text := 'corrupt_ownership_allowed'; BEGIN
  BEGIN INSERT INTO public.merchant_canonical_workspaces(merchant_id,workspace_id,link_version,reconcile_idempotency_key,created_by) VALUES ('00000000-0000-4000-8000-000000003011','00000000-0000-4000-8000-000000003023',1,'m030-corrupt','00000000-0000-4000-8000-000000003001');
  EXCEPTION WHEN foreign_key_violation THEN v_actual:='corrupt_ownership_blocked'; END;
  PERFORM pg_temp.record_m030('cross_merchant_ownership_blocked','corrupt_ownership_blocked',v_actual);
END $$;

-- A request tied to the wrong otherwise-valid workspace must not become ready.
INSERT INTO public.approval_decision_requests(reviewer_id,merchant_id,workspace_id,profile_id,plan_code,source_type,source_id,source_version,expected_profile_row_version,target_compliance_status,policy_version,reviewed_at)
SELECT reviewer_id,merchant_id,'00000000-0000-4000-8000-000000003023',profile_id,plan_code,source_type,source_id,source_version,expected_profile_row_version,target_compliance_status,policy_version,reviewed_at FROM public.approval_decision_requests WHERE profile_id='00000000-0000-4000-8000-000000003102';
SET LOCAL ROLE service_role;
SELECT pg_temp.capture_snapshot('request_workspace_mismatch_blocked','canonical_snapshot_v2_workspace_linkage_conflict',(SELECT id FROM public.approval_decision_requests WHERE profile_id='00000000-0000-4000-8000-000000003102' AND workspace_id='00000000-0000-4000-8000-000000003023'));
DO $$ DECLARE v_actual text; BEGIN
  SELECT CASE WHEN has_table_privilege(current_user,'public.merchant_compliance_profiles','SELECT') AND has_table_privilege(current_user,'public.approval_decision_requests','INSERT') AND NOT has_table_privilege(current_user,'public.merchant_compliance_profiles','UPDATE') AND NOT has_table_privilege(current_user,'public.merchant_canonical_workspaces','UPDATE') THEN 'minimum_reads_inserts_only' ELSE 'grant_boundary_invalid' END INTO v_actual;
  PERFORM pg_temp.record_m030('service_role_minimum_reads_inserts_only','minimum_reads_inserts_only',v_actual);
END $$;
RESET ROLE;

DO $$ DECLARE v_actual text; BEGIN
  SELECT CASE WHEN NOT EXISTS (
    (SELECT * FROM pg_temp.m030_merchant_workspace_before EXCEPT SELECT m.id,m.setup_mode,m.live_features_enabled,w.id,w.merchant_id FROM public.merchants m JOIN public.workspaces w ON w.merchant_id=m.id)
    UNION ALL
    (SELECT m.id,m.setup_mode,m.live_features_enabled,w.id,w.merchant_id FROM public.merchants m JOIN public.workspaces w ON w.merchant_id=m.id EXCEPT SELECT * FROM pg_temp.m030_merchant_workspace_before)
  ) THEN 'merchant_workspace_unchanged' ELSE 'merchant_workspace_mutated' END INTO v_actual;
  PERFORM pg_temp.record_m030('merchant_workspace_unchanged','merchant_workspace_unchanged',v_actual);
  SELECT CASE WHEN NOT EXISTS ((SELECT merchant_id,workspace_id,link_version FROM pg_temp.m030_authority_before EXCEPT SELECT merchant_id,workspace_id,link_version FROM public.merchant_canonical_workspaces) UNION ALL (SELECT merchant_id,workspace_id,link_version FROM public.merchant_canonical_workspaces EXCEPT SELECT merchant_id,workspace_id,link_version FROM pg_temp.m030_authority_before)) THEN 'merchant_workspace_canonical_link_unchanged' ELSE 'merchant_workspace_canonical_link_mutated' END INTO v_actual;
  PERFORM pg_temp.record_m030('merchant_workspace_canonical_link_unchanged','merchant_workspace_canonical_link_unchanged',v_actual);
  SELECT CASE WHEN NOT EXISTS ((SELECT * FROM pg_temp.m030_profile_event_before EXCEPT SELECT id,row_version,compliance_status,activation_status,can_collect_payments FROM public.merchant_compliance_profiles) UNION ALL (SELECT id,row_version,compliance_status,activation_status,can_collect_payments FROM public.merchant_compliance_profiles EXCEPT SELECT * FROM pg_temp.m030_profile_event_before)) AND NOT EXISTS ((SELECT id FROM pg_temp.m030_event_before EXCEPT SELECT id FROM public.merchant_compliance_events) UNION ALL (SELECT id FROM public.merchant_compliance_events EXCEPT SELECT id FROM pg_temp.m030_event_before)) THEN 'no_m026_profile_event_mutation' ELSE 'profile_or_event_mutated' END INTO v_actual;
  PERFORM pg_temp.record_m030('no_m026_profile_event_mutation','no_m026_profile_event_mutation',v_actual);
  SELECT CASE WHEN pg_temp.forbidden_business_category_unchanged('subscriptions') THEN 'subscriptions_unchanged' ELSE 'subscriptions_mutated' END INTO v_actual;
  PERFORM pg_temp.record_m030('subscriptions_unchanged','subscriptions_unchanged',v_actual);
  SELECT CASE WHEN pg_temp.forbidden_business_category_unchanged('providers_settlements') THEN 'providers_settlements_unchanged' ELSE 'providers_settlements_mutated' END INTO v_actual;
  PERFORM pg_temp.record_m030('providers_settlements_unchanged','providers_settlements_unchanged',v_actual);
  SELECT CASE WHEN pg_temp.forbidden_business_category_unchanged('checkout') THEN 'checkout_unchanged' ELSE 'checkout_mutated' END INTO v_actual;
  PERFORM pg_temp.record_m030('checkout_unchanged','checkout_unchanged',v_actual);
  SELECT CASE WHEN pg_temp.forbidden_business_category_unchanged('storefront') THEN 'storefront_unchanged' ELSE 'storefront_mutated' END INTO v_actual;
  PERFORM pg_temp.record_m030('storefront_unchanged','storefront_unchanged',v_actual);
  SELECT CASE WHEN pg_temp.forbidden_business_category_unchanged('invoices_limits') THEN 'invoice_payment_limit_tables_unchanged' ELSE 'invoice_payment_limit_tables_mutated' END INTO v_actual;
  PERFORM pg_temp.record_m030('invoice_payment_limit_tables_unchanged','invoice_payment_limit_tables_unchanged',v_actual);
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.merchants WHERE NOT setup_mode OR live_features_enabled) AND NOT EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE can_collect_payments OR activation_status='active') AND pg_temp.forbidden_business_category_unchanged('subscriptions') AND pg_temp.forbidden_business_category_unchanged('providers_settlements') AND pg_temp.forbidden_business_category_unchanged('checkout') AND pg_temp.forbidden_business_category_unchanged('storefront') AND pg_temp.forbidden_business_category_unchanged('invoices_limits') THEN 'forbidden_writes_absent' ELSE 'forbidden_write_detected' END INTO v_actual;
  PERFORM pg_temp.record_m030('activation_collection_payment_forbidden_writes_absent','forbidden_writes_absent',v_actual);
  SELECT CASE WHEN v_actual='forbidden_writes_absent' THEN 'forbidden_business_writes_absent' ELSE 'forbidden_business_write_detected' END INTO v_actual;
  PERFORM pg_temp.record_m030('forbidden_business_writes_absent','forbidden_business_writes_absent',v_actual);
END $$;

SELECT scenario_name, expected_result, actual_result, CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS pass_fail, safe_failure_code FROM pg_temp.m030_results ORDER BY scenario_name;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_temp.m030_results WHERE NOT passed) THEN RAISE EXCEPTION 'LOCAL_M030_READINESS_SCENARIOS_FAILED'; END IF; END $$;
ROLLBACK;
SELECT 'CONTROL|LOCAL_M028_M029_READINESS_INTEGRATION_REHEARSAL=PASS';
'@

  function Invoke-LocalPsqlFile([string]$Label, [string]$FilePath) {
    $EvidencePath = Join-Path $EvidenceDirectory ("$Label.txt")
    $StdoutPath = Join-Path $EvidenceDirectory ("$Label.stdout.txt")
    $StderrPath = Join-Path $EvidenceDirectory ("$Label.stderr.txt")
    $Process = Start-Process -FilePath $Psql -ArgumentList @('-X','-w','-v','ON_ERROR_STOP=1','-h',$Target.Host,'-p',$Target.Port,'-U',$Target.User,'-d',$Target.Database,'-f',$FilePath) -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -Wait -PassThru -NoNewWindow
    $Stdout = if (Test-Path -LiteralPath $StdoutPath) { Get-Content -LiteralPath $StdoutPath -Raw } else { '' }
    $Stderr = if (Test-Path -LiteralPath $StderrPath) { Get-Content -LiteralPath $StderrPath -Raw } else { '' }
    $Evidence = "===== STDOUT =====$([Environment]::NewLine)$Stdout$([Environment]::NewLine)===== STDERR =====$([Environment]::NewLine)$Stderr"
    Write-LocalSqlFileNoBom $EvidencePath $Evidence
    Write-Host "===== LOCAL M030 EVIDENCE: $Label ====="; Write-Host $Evidence -NoNewline; Write-Host "`n===== END LOCAL M030 EVIDENCE: $Label ====="
    if ($Process.ExitCode -ne 0) { throw "LOCAL_M030_REHEARSAL_PSQL_FAILED: $Label" }
    if ($Label -match '(?:preflight|postflight|behavior)' -and $Evidence -match '(?m)^\s*[^|\r\n]+\|\s*FAIL\s*\|') { throw "LOCAL_M030_REHEARSAL_VERIFICATION_FAILED: $Label" }
  }

  Invoke-LocalPsqlFile 'baseline' $BaselineSql
  foreach ($stage in @(
    @('024-apply',$Migration024), @('025-apply',$Migration025), @('026-preflight',$Preflight026), @('026-apply-first',$Migration026), @('026-apply-rerun',$Migration026), @('026-postflight',$Postflight026),
    @('027-preflight',$Preflight027), @('027-apply-first',$Migration027), @('027-apply-rerun',$Migration027), @('027-postflight',$Postflight027),
    @('028-preflight',$Preflight028), @('028-apply-first',$Migration028), @('028-apply-rerun',$Migration028), @('028-postflight',$Postflight028),
    @('029-preflight',$Preflight029), @('029-apply-first',$Migration029), @('029-apply-rerun',$Migration029), @('029-postflight',$Postflight029),
    @('030-preflight',$Preflight030), @('030-apply-first',$Migration030), @('030-apply-rerun',$Migration030), @('030-postflight',$Postflight030), @('030-behavior',$BehaviorSql)
  )) { Invoke-LocalPsqlFile $stage[0] $stage[1] }
  Write-Host "LOCAL EVIDENCE DIRECTORY: $EvidenceDirectory"
} finally {
  if ($null -eq $OriginalPGOPTIONS) { Remove-Item -Path Env:PGOPTIONS -ErrorAction SilentlyContinue } else { $env:PGOPTIONS = $OriginalPGOPTIONS }
  if (Test-Path -LiteralPath $TempDirectory) { Remove-Item -LiteralPath $TempDirectory -Recurse -Force }
}
