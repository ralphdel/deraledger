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
$ConfirmationPhrase = 'REHEARSE MIGRATION 029 LOCAL DISPOSABLE DB ONLY'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Migration024 = Join-Path $ProjectRoot 'supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql'
$Migration025 = Join-Path $ProjectRoot 'supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql'
$Migration026 = Join-Path $ProjectRoot 'supabase/migrations/20260825_00_reviewed_profile_approval_rpc.sql'
$Migration027 = Join-Path $ProjectRoot 'supabase/migrations/20260825_01_cleanup_approval_rpc_diagnostics.sql'
$Migration028 = Join-Path $ProjectRoot 'supabase/migrations/20260825_02_canonical_approval_snapshot_idempotency.sql'
$Migration029 = Join-Path $ProjectRoot 'supabase/migrations/20260826_00_canonical_workspace_linkage.sql'
$Preflight026 = Join-Path $ProjectRoot 'supabase/staging/preflight/026_reviewed_profile_approval_rpc_snapshot.sql'
$Postflight026 = Join-Path $ProjectRoot 'supabase/staging/postflight/026_reviewed_profile_approval_rpc_verify.sql'
$Preflight027 = Join-Path $ProjectRoot 'supabase/staging/preflight/027_cleanup_approval_rpc_diagnostics_snapshot.sql'
$Postflight027 = Join-Path $ProjectRoot 'supabase/staging/postflight/027_cleanup_approval_rpc_diagnostics_verify.sql'
$Preflight028 = Join-Path $ProjectRoot 'supabase/staging/preflight/028_canonical_approval_snapshot_idempotency_snapshot.sql'
$Postflight028 = Join-Path $ProjectRoot 'supabase/staging/postflight/028_canonical_approval_snapshot_idempotency_verify.sql'
$Preflight029 = Join-Path $ProjectRoot 'supabase/staging/preflight/029_canonical_workspace_linkage_snapshot.sql'
$Postflight029 = Join-Path $ProjectRoot 'supabase/staging/postflight/029_canonical_workspace_linkage_verify.sql'

function Get-LocalPgHost {
  param([Parameter(Mandatory = $true)][string]$ConnectionString)
  if ($ConnectionString -match '^(?i:postgres(?:ql)?://)') {
    try { return ([Uri]$ConnectionString).Host.ToLowerInvariant() } catch { throw 'LOCAL_M029_REHEARSAL_CONNECTION_STRING_INVALID' }
  }
  if ($ConnectionString -match '(?i)(?:^|\s)host\s*=\s*([^\s;]+)') { return $Matches[1].Trim('"', "'").ToLowerInvariant() }
  throw 'LOCAL_M029_REHEARSAL_HOST_MISSING'
}

function Get-LocalPgDatabaseName {
  param([Parameter(Mandatory = $true)][string]$ConnectionString)
  if ($ConnectionString -match '^(?i:postgres(?:ql)?://)') {
    try { return ([Uri]$ConnectionString).AbsolutePath.Trim('/').Trim() } catch { throw 'LOCAL_M029_REHEARSAL_CONNECTION_STRING_INVALID' }
  }
  if ($ConnectionString -match '(?i)(?:^|\s)dbname\s*=\s*([^\s;]+)') { return $Matches[1].Trim('"', "'").Trim() }
  throw 'LOCAL_M029_REHEARSAL_DATABASE_NAME_REQUIRED'
}

function Assert-LocalDisposableConnectionString {
  param([Parameter(Mandatory = $true)][string]$ConnectionString)
  if ([string]::IsNullOrWhiteSpace($ConnectionString)) { throw 'LOCAL_M029_REHEARSAL_CONNECTION_STRING_REQUIRED' }
  # The local-only connection string is passed as a distinct Start-Process
  # argument. Reject shell metacharacters as a defence-in-depth local guard.
  if ($ConnectionString -match '(?i)(supabase\.co|supabase\.com|vercel|production|staging|service_role|anon|eyJ|password\s*=|://[^/\s]*:|[&|<>()^"%])') {
    throw 'LOCAL_M029_REHEARSAL_CONNECTION_STRING_REJECTED'
  }
  $hostName = Get-LocalPgHost -ConnectionString $ConnectionString
  if ($hostName -notin @('localhost', '127.0.0.1', 'host.docker.internal')) { throw 'LOCAL_M029_REHEARSAL_NONLOCAL_HOST_REJECTED' }
  $databaseName = Get-LocalPgDatabaseName -ConnectionString $ConnectionString
  if ($databaseName -notmatch '^deraledger_m029_disposable_[a-z0-9_]+$') { throw 'LOCAL_M029_REHEARSAL_DISPOSABLE_DATABASE_NAME_REQUIRED' }
  return @{ Host = $hostName; Database = $databaseName }
}

function Write-LocalSqlFileNoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

if ($Confirmation.Trim() -cne $ConfirmationPhrase) { throw 'LOCAL_M029_REHEARSAL_CONFIRMATION_REQUIRED' }
$Target = Assert-LocalDisposableConnectionString -ConnectionString $LocalConnectionString.Trim()
Write-Host "LOCAL-ONLY DISPOSABLE TARGET: $($Target.Host)/$($Target.Database)"
Write-Host 'FORBIDDEN: staging, production, Supabase projects, runtime adoption, collection unlock, activation, and provider/payment testing.'
if (-not $Execute) {
  Write-Host 'DRY RUN ONLY. Re-run with -Execute only for the named disposable local database.'
  exit 0
}

foreach ($path in @(
  $Migration024, $Migration025, $Migration026, $Migration027, $Migration028, $Migration029,
  $Preflight026, $Postflight026, $Preflight027, $Postflight027,
  $Preflight028, $Postflight028, $Preflight029, $Postflight029
)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "LOCAL_M029_REHEARSAL_SOURCE_MISSING: $path" }
}

$Psql = (Resolve-Path -LiteralPath (Get-Command $PsqlPath -ErrorAction Stop).Source).Path
$TempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("deraledger-m029-workspace-linkage-" + [guid]::NewGuid().ToString('N'))
$EvidenceDirectory = Join-Path $ProjectRoot ("local-evidence/migration-029-local-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $TempDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$BaselineSql = Join-Path $TempDirectory '024-028-workspace-prerequisites.sql'
$BehaviorSql = Join-Path $TempDirectory '029-workspace-linkage-behavior.sql'
$OriginalPGOPTIONS = $env:PGOPTIONS
$env:PGOPTIONS = '-c client_min_messages=warning'

try {
  # Local owner/admin setup only. This establishes the historical workspace
  # contract required by M029; it is never a staging/production repair path.
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
CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY,
  merchant_id uuid REFERENCES public.merchants(id) ON DELETE CASCADE,
  CONSTRAINT workspaces_merchant_id_key UNIQUE (merchant_id)
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
GRANT SELECT ON TABLE auth.users, public.merchants, public.workspaces, public.solo_plus_cases TO service_role;
'@

  Write-LocalSqlFileNoBom -Path $BehaviorSql -Content @'
BEGIN;
RESET ROLE;

-- Owner/admin seeds are deliberately complete before service_role and hostile
-- checks. service_role performs no direct merchant/workspace write.
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000002901');
INSERT INTO public.merchants(id) VALUES
  ('00000000-0000-4000-8000-000000002911'),
  ('00000000-0000-4000-8000-000000002912'),
  ('00000000-0000-4000-8000-000000002913'),
  ('00000000-0000-4000-8000-000000002914');
INSERT INTO public.workspaces(id, merchant_id) VALUES
  ('00000000-0000-4000-8000-000000002921', '00000000-0000-4000-8000-000000002912'),
  ('00000000-0000-4000-8000-000000002922', '00000000-0000-4000-8000-000000002913'),
  ('00000000-0000-4000-8000-000000002923', '00000000-0000-4000-8000-000000002914');

CREATE TEMP TABLE canonical_workspace_scenario_results (
  scenario_name text NOT NULL,
  expected_result text NOT NULL,
  actual_result text NOT NULL,
  passed boolean NOT NULL,
  safe_failure_code text
);
CREATE TEMP TABLE workspace_contract_before AS
  SELECT id, merchant_id FROM public.workspaces;
GRANT SELECT, INSERT ON canonical_workspace_scenario_results TO service_role, anon, authenticated;

CREATE OR REPLACE FUNCTION pg_temp.capture_canonical_workspace_scenario(
  p_scenario_name text, p_expected_result text, p_merchant_id uuid, p_reconciled_by uuid, p_key text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $capture$
DECLARE v_actual_result text := 'canonical_workspace_link_invocation_failed';
BEGIN
  BEGIN
    SELECT result_code INTO v_actual_result
    FROM public.reconcile_canonical_merchant_workspace_link_v1(p_merchant_id, p_reconciled_by, p_key);
  EXCEPTION WHEN OTHERS THEN
    v_actual_result := 'canonical_workspace_link_invocation_failed';
  END;
  INSERT INTO pg_temp.canonical_workspace_scenario_results
    (scenario_name, expected_result, actual_result, passed, safe_failure_code)
  VALUES (
    p_scenario_name, p_expected_result, v_actual_result, v_actual_result = p_expected_result,
    CASE WHEN v_actual_result = p_expected_result THEN NULL ELSE v_actual_result END
  );
END;
$capture$;
GRANT EXECUTE ON FUNCTION pg_temp.capture_canonical_workspace_scenario(text,text,uuid,uuid,text)
  TO service_role;

-- The schema's unique merchant_id contract blocks duplicate workspace
-- candidates before an approval-owned link can be created.
DO $duplicate_candidate$
DECLARE v_actual text := 'duplicate_candidate_unexpectedly_allowed';
BEGIN
  BEGIN
    INSERT INTO public.workspaces(id, merchant_id)
    VALUES ('00000000-0000-4000-8000-000000002924', '00000000-0000-4000-8000-000000002912');
  EXCEPTION WHEN unique_violation THEN
    v_actual := 'duplicate_candidate_blocked';
  END;
  INSERT INTO pg_temp.canonical_workspace_scenario_results VALUES
    ('duplicate_candidate_blocked', 'duplicate_candidate_blocked', v_actual,
     v_actual = 'duplicate_candidate_blocked',
     CASE WHEN v_actual = 'duplicate_candidate_blocked' THEN NULL ELSE v_actual END);
END;
$duplicate_candidate$;

SET LOCAL ROLE service_role;
SELECT pg_temp.capture_canonical_workspace_scenario(
  'zero_candidate_fails_closed', 'canonical_workspace_link_unavailable',
  '00000000-0000-4000-8000-000000002911', '00000000-0000-4000-8000-000000002901', 'local-m029-zero'
);
SELECT pg_temp.capture_canonical_workspace_scenario(
  'one_candidate_creates_link', 'canonical_workspace_link_created',
  '00000000-0000-4000-8000-000000002912', '00000000-0000-4000-8000-000000002901', 'local-m029-create'
);
SELECT pg_temp.capture_canonical_workspace_scenario(
  'exact_replay_preserved', 'canonical_workspace_link_replay',
  '00000000-0000-4000-8000-000000002912', '00000000-0000-4000-8000-000000002901', 'local-m029-create'
);
SELECT pg_temp.capture_canonical_workspace_scenario(
  'conflicting_idempotency_fails_closed', 'canonical_workspace_link_idempotency_mismatch',
  '00000000-0000-4000-8000-000000002913', '00000000-0000-4000-8000-000000002901', 'local-m029-create'
);
SELECT pg_temp.capture_canonical_workspace_scenario(
  'cross_merchant_workspace_fails_closed', 'canonical_workspace_link_unavailable',
  '00000000-0000-4000-8000-000000002911', '00000000-0000-4000-8000-000000002901', 'local-m029-cross-merchant'
);
RESET ROLE;

-- No M029 path may mutate merchant/workspace state or operational data.
DO $boundaries$
DECLARE
  v_workspace_unchanged boolean;
  v_forbidden_writes_absent boolean := true;
  v_relation text;
  v_has_rows boolean;
BEGIN
  v_workspace_unchanged := NOT EXISTS (
    (SELECT id, merchant_id FROM pg_temp.workspace_contract_before EXCEPT SELECT id, merchant_id FROM public.workspaces)
    UNION ALL
    (SELECT id, merchant_id FROM public.workspaces EXCEPT SELECT id, merchant_id FROM pg_temp.workspace_contract_before)
  );
  INSERT INTO pg_temp.canonical_workspace_scenario_results VALUES
    ('merchant_workspace_unchanged', 'merchant_workspace_unchanged',
     CASE WHEN v_workspace_unchanged THEN 'merchant_workspace_unchanged' ELSE 'merchant_workspace_mutated' END,
     v_workspace_unchanged,
     CASE WHEN v_workspace_unchanged THEN NULL ELSE 'merchant_workspace_mutated' END);

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
  INSERT INTO pg_temp.canonical_workspace_scenario_results VALUES
    ('forbidden_writes_absent', 'forbidden_writes_absent',
     CASE WHEN v_forbidden_writes_absent THEN 'forbidden_writes_absent' ELSE 'forbidden_write_detected' END,
     v_forbidden_writes_absent,
     CASE WHEN v_forbidden_writes_absent THEN NULL ELSE 'forbidden_write_detected' END);
END;
$boundaries$;

-- Hostile browser roles execute only after owner seeding and service behavior.
SET LOCAL ROLE anon;
DO $anon$
DECLARE
  v_actual text := 'hostile_execute_other_failure';
  v_table_actual text := 'hostile_table_other_failure';
BEGIN
  BEGIN
    PERFORM * FROM public.reconcile_canonical_merchant_workspace_link_v1(
      '00000000-0000-4000-8000-000000002912', '00000000-0000-4000-8000-000000002901', 'local-m029-anon'
    );
    v_actual := 'hostile_execute_unexpected_result';
  EXCEPTION WHEN insufficient_privilege THEN v_actual := 'execute_denied';
  END;
  INSERT INTO pg_temp.canonical_workspace_scenario_results VALUES
    ('anon_execute_denied', 'execute_denied', v_actual, v_actual = 'execute_denied',
     CASE WHEN v_actual = 'execute_denied' THEN NULL ELSE v_actual END);
  BEGIN
    PERFORM 1 FROM public.merchant_canonical_workspaces;
    v_table_actual := 'hostile_table_unexpected_access';
  EXCEPTION WHEN insufficient_privilege THEN v_table_actual := 'table_denied';
  END;
  INSERT INTO pg_temp.canonical_workspace_scenario_results VALUES
    ('anon_table_denied', 'table_denied', v_table_actual, v_table_actual = 'table_denied',
     CASE WHEN v_table_actual = 'table_denied' THEN NULL ELSE v_table_actual END);
END;
$anon$;
SET LOCAL ROLE authenticated;
DO $authenticated$
DECLARE
  v_actual text := 'hostile_execute_other_failure';
  v_table_actual text := 'hostile_table_other_failure';
BEGIN
  BEGIN
    PERFORM * FROM public.reconcile_canonical_merchant_workspace_link_v1(
      '00000000-0000-4000-8000-000000002912', '00000000-0000-4000-8000-000000002901', 'local-m029-authenticated'
    );
    v_actual := 'hostile_execute_unexpected_result';
  EXCEPTION WHEN insufficient_privilege THEN v_actual := 'execute_denied';
  END;
  INSERT INTO pg_temp.canonical_workspace_scenario_results VALUES
    ('authenticated_execute_denied', 'execute_denied', v_actual, v_actual = 'execute_denied',
     CASE WHEN v_actual = 'execute_denied' THEN NULL ELSE v_actual END);
  BEGIN
    PERFORM 1 FROM public.merchant_canonical_workspaces;
    v_table_actual := 'hostile_table_unexpected_access';
  EXCEPTION WHEN insufficient_privilege THEN v_table_actual := 'table_denied';
  END;
  INSERT INTO pg_temp.canonical_workspace_scenario_results VALUES
    ('authenticated_table_denied', 'table_denied', v_table_actual, v_table_actual = 'table_denied',
     CASE WHEN v_table_actual = 'table_denied' THEN NULL ELSE v_table_actual END);
END;
$authenticated$;
RESET ROLE;

SELECT scenario_name, expected_result, actual_result,
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS pass_fail, safe_failure_code
FROM pg_temp.canonical_workspace_scenario_results
ORDER BY scenario_name;
DO $final_assert$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.canonical_workspace_scenario_results WHERE NOT passed) THEN
    RAISE EXCEPTION 'LOCAL_M029_WORKSPACE_LINKAGE_SCENARIOS_FAILED';
  END IF;
END;
$final_assert$;
ROLLBACK;
SELECT 'CONTROL|LOCAL_CANONICAL_WORKSPACE_LINKAGE_REHEARSAL=PASS';
'@

  function Invoke-LocalPsqlFile([string]$Label, [string]$FilePath) {
    $EvidencePath = Join-Path $EvidenceDirectory ("$Label.txt")
    $StdoutPath = Join-Path $EvidenceDirectory ("$Label.stdout.txt")
    $StderrPath = Join-Path $EvidenceDirectory ("$Label.stderr.txt")
    # Start-Process passes FilePath and ArgumentList independently, so the
    # standard Windows psql path with spaces is never parsed by cmd.exe.
    # stderr remains evidence rather than a PowerShell NativeCommandError.
    $PsqlProcess = Start-Process -FilePath $Psql -ArgumentList @(
      '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-d', $LocalConnectionString.Trim(), '-f', $FilePath
    ) -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -Wait -PassThru -NoNewWindow
    $PsqlExitCode = $PsqlProcess.ExitCode

    $Stdout = if (Test-Path -LiteralPath $StdoutPath) { Get-Content -LiteralPath $StdoutPath -Raw } else { '' }
    $Stderr = if (Test-Path -LiteralPath $StderrPath) { Get-Content -LiteralPath $StderrPath -Raw } else { '' }
    $Evidence = "===== STDOUT =====$([Environment]::NewLine)$Stdout$([Environment]::NewLine)===== STDERR =====$([Environment]::NewLine)$Stderr"
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($EvidencePath, $Evidence, $utf8NoBom)
    Write-Host "===== LOCAL M029 EVIDENCE: $Label ====="
    Write-Host $Evidence -NoNewline
    Write-Host "===== END LOCAL M029 EVIDENCE: $Label ====="

    if ($PsqlExitCode -ne 0) { throw "LOCAL_M029_REHEARSAL_PSQL_FAILED: $Label" }
    if ($Label -match '(?:preflight|postflight)' -and $Evidence -match '(?m)^\s*[^|\r\n]+\|\s*FAIL\s*\|') {
      throw "LOCAL_M029_REHEARSAL_VERIFICATION_FAILED: $Label"
    }
  }

  Write-Host 'Applying disposable local prerequisites and M024--M028 baseline.'
  Invoke-LocalPsqlFile 'baseline' $BaselineSql
  Invoke-LocalPsqlFile '024-apply' $Migration024
  Invoke-LocalPsqlFile '025-apply' $Migration025
  Invoke-LocalPsqlFile '026-preflight' $Preflight026
  Invoke-LocalPsqlFile '026-apply-first' $Migration026
  Invoke-LocalPsqlFile '026-apply-rerun' $Migration026
  Invoke-LocalPsqlFile '026-postflight' $Postflight026
  Invoke-LocalPsqlFile '027-preflight' $Preflight027
  Invoke-LocalPsqlFile '027-apply-first' $Migration027
  Invoke-LocalPsqlFile '027-apply-rerun' $Migration027
  Invoke-LocalPsqlFile '027-postflight' $Postflight027
  Invoke-LocalPsqlFile '028-preflight' $Preflight028
  Invoke-LocalPsqlFile '028-apply-first' $Migration028
  Invoke-LocalPsqlFile '028-apply-rerun' $Migration028
  Invoke-LocalPsqlFile '028-postflight' $Postflight028
  Write-Host 'Running M029 preflight, first apply, rerun, and postflight.'
  Invoke-LocalPsqlFile '029-preflight' $Preflight029
  Invoke-LocalPsqlFile '029-apply-first' $Migration029
  Invoke-LocalPsqlFile '029-apply-rerun' $Migration029
  Invoke-LocalPsqlFile '029-postflight' $Postflight029
  Write-Host 'Running M029 disposable behavior, hostile-role, and forbidden-write rehearsal.'
  Invoke-LocalPsqlFile '029-behavior' $BehaviorSql
  Write-Host "LOCAL EVIDENCE DIRECTORY: $EvidenceDirectory"
} finally {
  if ($null -eq $OriginalPGOPTIONS) {
    Remove-Item -Path Env:PGOPTIONS -ErrorAction SilentlyContinue
  } else {
    $env:PGOPTIONS = $OriginalPGOPTIONS
  }
  if (Test-Path -LiteralPath $TempDirectory) { Remove-Item -LiteralPath $TempDirectory -Recurse -Force }
}
