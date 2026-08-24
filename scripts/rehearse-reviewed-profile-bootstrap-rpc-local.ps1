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
$ConfirmationPhrase = 'REHEARSE LOCAL DISPOSABLE DB ONLY'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Migration024 = Join-Path $ProjectRoot 'supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql'
$Migration025 = Join-Path $ProjectRoot 'supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql'
$Preflight025 = Join-Path $ProjectRoot 'supabase/staging/preflight/025_reviewed_profile_bootstrap_rpc_snapshot.sql'
$Postflight025 = Join-Path $ProjectRoot 'supabase/staging/postflight/025_reviewed_profile_bootstrap_rpc_verify.sql'

function Get-LocalPgHost {
  param([Parameter(Mandatory = $true)][string]$ConnectionString)
  if ($ConnectionString -match '^(?i:postgres(?:ql)?://)') {
    try { return ([Uri]$ConnectionString).Host.ToLowerInvariant() } catch { throw 'LOCAL_REHEARSAL_CONNECTION_STRING_INVALID' }
  }
  if ($ConnectionString -match '(?i)(?:^|\s)host\s*=\s*([^\s;]+)') { return $Matches[1].Trim('"', "'").ToLowerInvariant() }
  throw 'LOCAL_REHEARSAL_HOST_MISSING'
}

function Assert-LocalDisposableConnectionString {
  param([Parameter(Mandatory = $true)][string]$ConnectionString)
  if ([string]::IsNullOrWhiteSpace($ConnectionString)) { throw 'LOCAL_REHEARSAL_CONNECTION_STRING_REQUIRED' }
  if ($ConnectionString -match '(?i)(supabase\.co|supabase\.com|vercel|production|staging|service_role|anon|eyJ|password\s*=|://[^/\s]*:)') {
    throw 'LOCAL_REHEARSAL_CONNECTION_STRING_REJECTED'
  }
  $hostName = Get-LocalPgHost -ConnectionString $ConnectionString
  if ($hostName -notin @('localhost', '127.0.0.1', 'host.docker.internal')) { throw 'LOCAL_REHEARSAL_NONLOCAL_HOST_REJECTED' }
  if ($ConnectionString -notmatch '(?i)(?:/|dbname\s*=)[^\s;/]*?(?:rehearsal|disposable|local)') {
    throw 'LOCAL_REHEARSAL_DISPOSABLE_DATABASE_NAME_REQUIRED'
  }
  return $hostName
}

if ($Confirmation -cne $ConfirmationPhrase) { throw 'LOCAL_REHEARSAL_CONFIRMATION_REQUIRED' }
$TargetHost = Assert-LocalDisposableConnectionString -ConnectionString $LocalConnectionString
Write-Host "LOCAL-ONLY TARGET HOST: $TargetHost"
Write-Host 'FORBIDDEN: staging, production, Supabase projects, provider/payment testing, and runtime route adoption.'
if (-not $Execute) {
  Write-Host 'DRY RUN ONLY. Re-run with -Execute only for a disposable local database.'
  exit 0
}

foreach ($path in @($Migration024, $Migration025, $Preflight025, $Postflight025)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "LOCAL_REHEARSAL_SOURCE_MISSING: $path" }
}
$Psql = (Get-Command $PsqlPath -ErrorAction Stop).Source
$TempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("deraledger-bootstrap-rpc-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $TempDirectory -Force | Out-Null
$BaselineSql = Join-Path $TempDirectory '024-local-prerequisites.sql'
$BehaviorSql = Join-Path $TempDirectory '025-rpc-behavior.sql'
try {
  @'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.merchants (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.invoices (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.payment_records (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.solo_plus_cases (id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants(id));
'@ | Set-Content -LiteralPath $BaselineSql -Encoding utf8
  @'
BEGIN;
SET LOCAL ROLE service_role;
DO $rehearsal$
DECLARE
  lite_merchant uuid := gen_random_uuid(); business_merchant uuid := gen_random_uuid(); plus_merchant uuid := gen_random_uuid();
  case_id uuid := gen_random_uuid(); reviewer uuid := gen_random_uuid(); r record;
BEGIN
  INSERT INTO public.merchants(id) VALUES (lite_merchant),(business_merchant),(plus_merchant);
  INSERT INTO public.solo_plus_cases(id,merchant_id) VALUES (case_id,plus_merchant);
  SELECT * INTO r FROM public.bootstrap_reviewed_profile_v1(lite_merchant,gen_random_uuid(),'solo_lite','lite_pending','test_mode',NULL,'local-lite',gen_random_uuid(),reviewer,now());
  IF r.result_code <> 'bootstrap_created' THEN RAISE EXCEPTION 'lite bootstrap failed'; END IF;
  SELECT * INTO r FROM public.bootstrap_reviewed_profile_v1(lite_merchant,gen_random_uuid(),'solo_lite','lite_pending','test_mode',NULL,'local-lite',gen_random_uuid(),reviewer,now());
  IF r.result_code <> 'bootstrap_existing_result' THEN RAISE EXCEPTION 'idempotent replay failed'; END IF;
  SELECT * INTO r FROM public.bootstrap_reviewed_profile_v1(business_merchant,gen_random_uuid(),'business','business_pending','test_mode',NULL,'local-business',gen_random_uuid(),reviewer,now());
  IF r.result_code <> 'bootstrap_created' THEN RAISE EXCEPTION 'business bootstrap failed'; END IF;
  SELECT * INTO r FROM public.bootstrap_reviewed_profile_v1(plus_merchant,gen_random_uuid(),'solo_plus','enhanced_pending','test_mode',NULL,'local-plus',case_id,reviewer,now());
  IF r.result_code <> 'bootstrap_created' OR r.review_id IS NOT NULL THEN RAISE EXCEPTION 'solo plus case binding failed'; END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_reviews WHERE merchant_id=plus_merchant) THEN RAISE EXCEPTION 'solo plus created review row'; END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_compliance_profiles WHERE can_collect_payments OR can_use_instant_sale OR can_use_receivable_sale OR can_use_storefront OR can_activate_settlement OR can_use_deposit_balance OR activation_status='approved' OR restriction_state='active') THEN RAISE EXCEPTION 'unsafe bootstrap state'; END IF;
END;
$rehearsal$;
ROLLBACK;
SELECT 'CONTROL|LOCAL_BOOTSTRAP_REHEARSAL=PASS';
'@ | Set-Content -LiteralPath $BehaviorSql -Encoding utf8
  function Invoke-LocalPsqlFile([string]$FilePath) { & $Psql -X -w -v ON_ERROR_STOP=1 -d $LocalConnectionString -f $FilePath; if ($LASTEXITCODE -ne 0) { throw "LOCAL_REHEARSAL_PSQL_FAILED: $FilePath" } }
  Write-Host 'Applying disposable Migration 024 baseline only.'; Invoke-LocalPsqlFile $BaselineSql; Invoke-LocalPsqlFile $Migration024
  Write-Host 'Running Migration 025 preflight.'; Invoke-LocalPsqlFile $Preflight025
  Write-Host 'Applying Migration 025 first time.'; Invoke-LocalPsqlFile $Migration025
  Write-Host 'Applying Migration 025 second time for idempotency.'; Invoke-LocalPsqlFile $Migration025
  Write-Host 'Running Migration 025 postflight.'; Invoke-LocalPsqlFile $Postflight025
  Write-Host 'Rehearsing Lite, Business, Solo Plus, idempotency, grant, and rollback safety.'; Invoke-LocalPsqlFile $BehaviorSql
} finally {
  if (Test-Path -LiteralPath $TempDirectory) { Remove-Item -LiteralPath $TempDirectory -Recurse -Force }
}
