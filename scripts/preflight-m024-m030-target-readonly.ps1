[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('local', 'staging', 'production')]
  [string]$Target,
  [string]$ExpectedProjectRef,
  [string]$ExpectedDatabaseName,
  [string]$ExpectedConnectedRole,
  [switch]$RunReadOnlyChecks,
  [string]$PsqlPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This helper is intentionally read-only. It never includes a migration, DDL, DML,
# advisory lock, schema/data mutation, or route/runtime action.
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RequiredMigrations = @(
  '20260820_00_prd_phase_2_compliance_schema_substrate',
  '20260824_00_reviewed_profile_bootstrap_rpc',
  '20260825_00_reviewed_profile_approval_rpc',
  '20260825_01_cleanup_approval_rpc_diagnostics',
  '20260825_02_canonical_approval_snapshot_idempotency',
  '20260826_00_canonical_workspace_linkage',
  '20260827_00_m028_m029_readiness_integration'
)
$PgEnvironmentNames = @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSSLMODE')

function Write-Evidence {
  param([ValidateSet('PASS', 'FAIL', 'BLOCKED')] [string]$State, [string]$Check, [string]$Category)
  Write-Output ('{0}|{1}|{2}' -f $State, $Check, $Category)
}

function Assert-PlainField {
  param([string]$Value, [string]$Field)
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '(?i)://|[;\r\n]|password=|token=|secret=') {
    throw "INVALID_${Field}_INPUT"
  }
}

function Read-TargetConfiguration {
  $hostName = (Read-Host 'Database host').Trim().ToLowerInvariant()
  $port = (Read-Host 'Database port (press Enter for 55432)').Trim()
  $database = (Read-Host 'Database name').Trim()
  $userName = (Read-Host 'Database user (press Enter for postgres)').Trim()
  if ([string]::IsNullOrWhiteSpace($port)) { $port = '55432' }
  if ([string]::IsNullOrWhiteSpace($userName)) { $userName = 'postgres' }
  foreach ($item in @(@($hostName, 'HOST'), @($port, 'PORT'), @($database, 'DATABASE'), @($userName, 'USER'))) { Assert-PlainField -Value $item[0] -Field $item[1] }
  if ($port -notmatch '^[0-9]{1,5}$' -or [int]$port -lt 1 -or [int]$port -gt 65535) { throw 'INVALID_PORT_INPUT' }
  return [pscustomobject]@{ Host = $hostName; Port = $port; Database = $database; User = $userName }
}

function Assert-TargetGuards {
  param($Config)
  if ($Target -eq 'local') {
    if ($Config.Host -cne '127.0.0.1') { throw 'LOCAL_HOST_MUST_BE_127_0_0_1' }
    $exactBlockedLocalDatabaseNames = @('postgres', 'template0', 'template1', 'production', 'staging')
    $reservedLocalDatabaseTokenPattern = '(?i)(production|prod|staging|stage|preview|live|main|primary|shared|default|template|postgres|supabase)'
    if ($Config.Database -in $exactBlockedLocalDatabaseNames -or $Config.Database -match $reservedLocalDatabaseTokenPattern) {
      throw 'LOCAL_DATABASE_RESERVED_ENVIRONMENT_TOKEN'
    }
    if ($Config.Database -notmatch '(?i)^(?:deraledger_[a-z0-9_]*rehearsal[a-z0-9_]*|deraledger_[a-z0-9_]*(?:local|test|disposable)[a-z0-9_]*)$') {
      throw 'LOCAL_DISPOSABLE_DATABASE_NAME_REQUIRED'
    }
    if ($Config.Port -ne '55432') { throw 'LOCAL_PORT_MUST_BE_55432' }
    if ($Config.User -ine 'postgres') { throw 'LOCAL_USER_MUST_BE_POSTGRES' }
    if ((Read-Host 'Type LOCAL READONLY M024-M030 to continue').Trim() -cne 'LOCAL READONLY M024-M030') { throw 'LOCAL_CONFIRMATION_REQUIRED' }
    return
  }
  if ([string]::IsNullOrWhiteSpace($ExpectedProjectRef) -or [string]::IsNullOrWhiteSpace($ExpectedDatabaseName) -or [string]::IsNullOrWhiteSpace($ExpectedConnectedRole)) { throw 'EXPECTED_TARGET_IDENTITY_REQUIRED' }
  Assert-PlainField -Value $ExpectedProjectRef -Field 'EXPECTED_PROJECT_REF'
  Assert-PlainField -Value $ExpectedDatabaseName -Field 'EXPECTED_DATABASE'
  Assert-PlainField -Value $ExpectedConnectedRole -Field 'EXPECTED_CONNECTED_ROLE'
  $phrase = if ($Target -eq 'staging') { 'STAGING READONLY M024-M030' } else { 'PRODUCTION READONLY M024-M030' }
  if ((Read-Host "Type $phrase to continue").Trim() -cne $phrase) { throw 'TARGET_CONFIRMATION_REQUIRED' }
}

function Resolve-PsqlExecutable {
  $knownPaths = @(
    'C:\Program Files\PostgreSQL\15\bin\psql.exe',
    'C:\Program Files\PostgreSQL\17\bin\psql.exe'
  )

  if (-not [string]::IsNullOrWhiteSpace($PsqlPath)) {
    Assert-PlainField -Value $PsqlPath -Field 'PSQL_PATH'
    if (Test-Path -LiteralPath $PsqlPath -PathType Leaf) {
      return (Resolve-Path -LiteralPath $PsqlPath).Path
    }
  }

  $command = Get-Command -Name 'psql' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $command -and -not [string]::IsNullOrWhiteSpace($command.Source)) {
    return $command.Source
  }

  foreach ($knownPath in $knownPaths) {
    if (Test-Path -LiteralPath $knownPath -PathType Leaf) {
      return $knownPath
    }
  }

  throw 'PSQL_NOT_FOUND'
}

function ConvertTo-WindowsCommandLineArgument {
  param([Parameter(Mandatory = $true)][string]$Argument)
  if ($Argument.Length -eq 0) { return '""' }
  if ($Argument -notmatch '[\s"]') { return $Argument }
  $escaped = [regex]::Replace($Argument, '(\\*)"', '$1$1\\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Get-ReadOnlySql {
  # psql variables are safely literal-quoted via :'variable'. This batch is
  # SELECT-only inside a read-only transaction and emits categories, never values.
  return @'
BEGIN READ ONLY;
SELECT 'CONTROL|DATABASE_IDENTITY|' || CASE WHEN current_database() = :'expected_database' THEN 'PASS|expected_observed_match' ELSE 'FAIL|mismatch' END;
SELECT 'CONTROL|ROLE_IDENTITY|' || CASE WHEN current_user = :'expected_role' AND session_user = :'expected_role' THEN 'PASS|expected_observed_match' ELSE 'FAIL|mismatch' END;
SELECT 'CONTROL|SERVER_SESSION|' || CASE WHEN host(inet_server_addr()) IS NOT NULL AND inet_server_port() IS NOT NULL AND current_schema() IS NOT NULL AND current_setting('search_path', true) IS NOT NULL AND version() IS NOT NULL THEN 'PASS|address_port_schema_available' ELSE 'FAIL|session_metadata_unavailable' END;
SELECT 'CONTROL|PROJECT_REF|' || CASE
  WHEN :'target_label' = 'local' THEN 'PASS|not_required_local'
  ELSE 'FAIL|BLOCKED_PROJECT_REF_UNPROVEN'
END;
SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'false' ELSE 'true' END AS migration_history_exists \gset
\if :migration_history_exists
SELECT 'CONTROL|MIGRATION_HISTORY|PASS|history_table_present';
WITH expected(version_name, ordinal) AS (
  VALUES
    ('20260820_00_prd_phase_2_compliance_schema_substrate', 1),
    ('20260824_00_reviewed_profile_bootstrap_rpc', 2),
    ('20260825_00_reviewed_profile_approval_rpc', 3),
    ('20260825_01_cleanup_approval_rpc_diagnostics', 4),
    ('20260825_02_canonical_approval_snapshot_idempotency', 5),
    ('20260826_00_canonical_workspace_linkage', 6),
    ('20260827_00_m028_m029_readiness_integration', 7)
), observed AS (
  SELECT version::text AS version_name FROM supabase_migrations.schema_migrations
)
SELECT 'CONTROL|CHAIN_STATE|' || CASE
  WHEN count(observed.version_name) = 0 THEN 'PASS|CHAIN_ABSENT'
  WHEN count(observed.version_name) = 7 THEN 'PASS|CHAIN_FULL_RECORDED'
  ELSE 'FAIL|CHAIN_PARTIAL'
END
FROM expected LEFT JOIN observed USING (version_name);
SELECT count(*) AS history_recorded_count
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260820_00_prd_phase_2_compliance_schema_substrate','20260824_00_reviewed_profile_bootstrap_rpc','20260825_00_reviewed_profile_approval_rpc','20260825_01_cleanup_approval_rpc_diagnostics','20260825_02_canonical_approval_snapshot_idempotency','20260826_00_canonical_workspace_linkage','20260827_00_m028_m029_readiness_integration') \gset
\else
\set history_recorded_count 0
SELECT 'CONTROL|MIGRATION_HISTORY|FAIL|history_table_missing';
SELECT 'CONTROL|CHAIN_STATE|PASS|CHAIN_ABSENT';
\endif
WITH expected(name) AS (VALUES
  ('merchant_compliance_profiles'), ('merchant_compliance_reviews'), ('merchant_compliance_events'),
  ('merchant_collection_limit_windows'), ('merchant_collection_limit_reservations'),
  ('merchant_collection_limit_reservation_windows'), ('merchant_collection_usage_events'),
  ('approval_policy_versions'), ('approval_decision_requests'), ('merchant_canonical_workspaces')
)
SELECT 'CONTROL|TABLES|' || CASE
  WHEN (:'history_recorded_count')::integer = 0 AND count(to_regclass('public.' || name)) = 0 THEN 'PASS|absent_consistent'
  WHEN count(*) = count(to_regclass('public.' || name)) THEN 'PASS|required_tables_present'
  ELSE 'FAIL|history_object_conflict_or_missing_table'
END FROM expected;
WITH expected(signature) AS (VALUES
  ('public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)'),
  ('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)'),
  ('public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)'),
  ('public.read_canonical_approval_snapshot_v1(uuid)'),
  ('public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)'),
  ('public.issue_canonical_approval_decision_request_v2(uuid,uuid,text,text,text)'),
  ('public.read_canonical_approval_snapshot_v2(uuid)')
)
SELECT 'CONTROL|RPC_SIGNATURES|' || CASE
  WHEN (:'history_recorded_count')::integer = 0 AND count(to_regprocedure(signature)) = 0 THEN 'PASS|absent_consistent'
  WHEN count(*) = count(to_regprocedure(signature)) THEN 'PASS|expected_signatures_present'
  ELSE 'FAIL|history_object_conflict_or_missing_signature'
END FROM expected;
WITH expected(signature) AS (VALUES
  ('public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)'),
  ('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)'),
  ('public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)'),
  ('public.read_canonical_approval_snapshot_v1(uuid)'),
  ('public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)'),
  ('public.issue_canonical_approval_decision_request_v2(uuid,uuid,text,text,text)'),
  ('public.read_canonical_approval_snapshot_v2(uuid)')
), facts AS (
  SELECT p.oid, p.prosecdef, p.proconfig FROM expected e JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
)
SELECT 'CONTROL|RPC_SECURITY|' || CASE WHEN count(*) = 7 AND bool_and(NOT prosecdef AND COALESCE(proconfig @> ARRAY['search_path=pg_catalog, public'], false)) THEN 'PASS|invoker_and_search_path_hardened' ELSE 'FAIL|security_or_search_path_mismatch' END FROM facts;
WITH expected(signature) AS (VALUES
  ('public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)'),
  ('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)'),
  ('public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)'),
  ('public.read_canonical_approval_snapshot_v1(uuid)'),
  ('public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)'),
  ('public.issue_canonical_approval_decision_request_v2(uuid,uuid,text,text,text)'),
  ('public.read_canonical_approval_snapshot_v2(uuid)')
)
SELECT 'CONTROL|RPC_GRANTS|' || CASE WHEN count(*) = 7 AND bool_and(
  has_function_privilege('service_role', to_regprocedure(signature), 'EXECUTE')
  AND NOT has_function_privilege('anon', to_regprocedure(signature), 'EXECUTE')
  AND NOT has_function_privilege('authenticated', to_regprocedure(signature), 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc function_state
    CROSS JOIN LATERAL aclexplode(COALESCE(function_state.proacl, acldefault('f', function_state.proowner))) privilege_state
    WHERE function_state.oid = to_regprocedure(signature)
      AND privilege_state.grantee = 0
      AND privilege_state.privilege_type = 'EXECUTE'
  )
) THEN 'PASS|service_role_only' ELSE 'FAIL|function_grant_mismatch' END FROM expected;
SELECT 'CONTROL|M027_CLEANUP|' || CASE
  WHEN to_regprocedure('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)') IS NULL
    AND (:'history_recorded_count')::integer = 0 THEN 'PASS|absent_consistent'
  WHEN pg_get_functiondef(to_regprocedure('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)')) !~ 'LOCAL_APPROVAL_BRANCH|LOCAL_APPROVAL_EXCEPTION|deraledger\.local_approval_rehearsal_diagnostics|approval_rpc_internal_diagnostics|GET STACKED DIAGNOSTICS' THEN 'PASS|hardened_cleanup_state'
  ELSE 'FAIL|cleanup_or_function_drift'
END;
WITH required_tables(name) AS (VALUES
  ('merchant_compliance_profiles'), ('merchant_compliance_reviews'), ('merchant_compliance_events'),
  ('merchant_collection_limit_windows'), ('merchant_collection_limit_reservations'),
  ('merchant_collection_limit_reservation_windows'), ('merchant_collection_usage_events'),
  ('approval_policy_versions'), ('approval_decision_requests'), ('merchant_canonical_workspaces')
)
SELECT 'CONTROL|RLS|' || CASE WHEN bool_and(c.relrowsecurity AND NOT c.relforcerowsecurity) THEN 'PASS|enabled_not_forced' ELSE 'FAIL|disabled_missing_or_forced' END
FROM required_tables r LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || r.name);
SELECT 'CONTROL|BROWSER_POLICIES|' || CASE WHEN NOT EXISTS (
  SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events','merchant_collection_limit_windows','merchant_collection_limit_reservations','merchant_collection_limit_reservation_windows','merchant_collection_usage_events','approval_policy_versions','approval_decision_requests','merchant_canonical_workspaces')
) THEN 'PASS|zero' ELSE 'FAIL|present' END;
SELECT 'CONTROL|BROWSER_GRANTS|' || CASE WHEN NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee IN ('PUBLIC', 'anon', 'authenticated') AND table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events','merchant_collection_limit_windows','merchant_collection_limit_reservations','merchant_collection_limit_reservation_windows','merchant_collection_usage_events','approval_policy_versions','approval_decision_requests','merchant_canonical_workspaces')
) THEN 'PASS|revoked' ELSE 'FAIL|unexpected' END;
SELECT 'CONTROL|DELETE_GRANTS|' || CASE WHEN NOT EXISTS (
  SELECT 1 FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND table_name IN ('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events','merchant_collection_limit_windows','merchant_collection_limit_reservations','merchant_collection_limit_reservation_windows','merchant_collection_usage_events','approval_policy_versions','approval_decision_requests','merchant_canonical_workspaces') AND privilege_type = 'DELETE'
) THEN 'PASS|absent' ELSE 'FAIL|present' END;
WITH expected(table_name, required_privileges) AS (VALUES
  ('merchant_compliance_profiles', ARRAY['INSERT','SELECT','UPDATE']::text[]),
  ('merchant_compliance_reviews', ARRAY['INSERT','SELECT','UPDATE']::text[]),
  ('merchant_compliance_events', ARRAY['INSERT','SELECT']::text[]),
  ('merchant_collection_limit_windows', ARRAY['INSERT','SELECT','UPDATE']::text[]),
  ('merchant_collection_limit_reservations', ARRAY['INSERT','SELECT','UPDATE']::text[]),
  ('merchant_collection_limit_reservation_windows', ARRAY['INSERT','SELECT']::text[]),
  ('merchant_collection_usage_events', ARRAY['INSERT','SELECT']::text[]),
  ('approval_policy_versions', ARRAY['SELECT']::text[]),
  ('approval_decision_requests', ARRAY['INSERT','SELECT']::text[]),
  ('merchant_canonical_workspaces', ARRAY['INSERT','SELECT']::text[])
), actual AS (
  SELECT table_name, array_agg(privilege_type ORDER BY privilege_type)::text[] AS privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee = 'service_role'
    AND table_name IN (SELECT table_name FROM expected)
  GROUP BY table_name
)
SELECT 'CONTROL|SERVICE_ROLE_GRANTS|' || CASE
  WHEN bool_and(COALESCE(actual.privileges, ARRAY[]::text[]) = expected.required_privileges) THEN 'PASS|exact_manifest_privileges'
  ELSE 'FAIL|table_grant_mismatch'
END FROM expected LEFT JOIN actual USING (table_name);
ROLLBACK;
'@
}

function Invoke-ReadOnlyPsql {
  param($Config)
  $psql = Resolve-PsqlExecutable
  Write-Evidence PASS PSQL resolved
  $sqlPath = Join-Path ([System.IO.Path]::GetTempPath()) ('deraledger-m024-m030-readonly-{0}.sql' -f [guid]::NewGuid().ToString('N'))
  $saved = @{}; foreach ($name in $PgEnvironmentNames) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $bstr = [IntPtr]::Zero; $plainPassword = $null; $process = $null; $stderrText = ''
  try {
    [System.IO.File]::WriteAllText($sqlPath, (Get-ReadOnlySql), [System.Text.UTF8Encoding]::new($false))
    $securePassword = Read-Host 'Database password (secure prompt; never echoed or written)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Environment]::SetEnvironmentVariable('PGPASSWORD', $plainPassword, 'Process')
    $arguments = @('-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-v',("target_label={0}" -f $Target),'-v',("expected_database={0}" -f $(if ($Target -eq 'local') { $Config.Database } else { $ExpectedDatabaseName })),'-v',("expected_role={0}" -f $(if ($Target -eq 'local') { $Config.User } else { $ExpectedConnectedRole })),'-h',$Config.Host,'-p',$Config.Port,'-U',$Config.User,'-d',$Config.Database,'-f',$sqlPath)
    $start = [Diagnostics.ProcessStartInfo]::new(); $start.FileName = $psql; $start.Arguments = (($arguments | ForEach-Object { ConvertTo-WindowsCommandLineArgument -Argument $_ }) -join ' '); $start.UseShellExecute = $false; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true; $start.CreateNoWindow = $true
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $start
    try { [void]$process.Start() } catch { throw 'PSQL_INVOCATION_FAILED' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync(); $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(60000)) { try { $process.Kill() } catch {}; throw 'READONLY_PSQL_TIMEOUT' }
    [Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask)); $stderrText = $stderrTask.Result
    if ($process.ExitCode -ne 0) {
      if ($stderrText -match '(?im)\bERROR:') { throw 'READONLY_SQL_FAILED' }
      if ($stderrText -match '(?im)\bFATAL:' -or $stderrText -match '(?im)^\s*psql:') { throw 'PSQL_INVOCATION_FAILED' }
      throw 'PSQL_EXIT_NONZERO'
    }
    return @($stdoutTask.Result -split "`r?`n" | Where-Object { $_ -match '^CONTROL\|' })
  } finally {
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }; $plainPassword = $null
    if ($null -ne $process) { $process.Dispose() }
    Remove-Item -LiteralPath $sqlPath -Force -ErrorAction SilentlyContinue
    foreach ($name in $PgEnvironmentNames) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  }
}

try {
  $config = Read-TargetConfiguration; Assert-TargetGuards -Config $config
  Write-Evidence PASS TARGET_LABEL accepted
  if ($Target -ne 'local') { Write-Evidence PASS PROJECT_REF expected_ref_supplied_pending_independent_proof }
  if (-not $RunReadOnlyChecks) { Write-Evidence BLOCKED EXECUTION read_only_checks_require_explicit_RunReadOnlyChecks; exit 0 }
  $lines = Invoke-ReadOnlyPsql -Config $config
  if ($lines.Count -ne 16) { throw 'CONTROL_ROW_COUNT_INVALID' }
  $control = @{}
  foreach ($line in $lines) {
    $parts = $line -split '\|', 4
    if ($parts.Count -ne 4 -or $parts[0] -ne 'CONTROL' -or $parts[2] -notin @('PASS','FAIL')) { throw 'CONTROL_ROW_MALFORMED' }
    if ($control.ContainsKey($parts[1])) { throw 'CONTROL_ROW_DUPLICATE' }
    $control[$parts[1]] = [pscustomobject]@{ State = $parts[2]; Category = $parts[3] }
    Write-Evidence $parts[2] $parts[1] $parts[3]
  }
  $chain = $control['CHAIN_STATE'].Category
  $failures = @($control.GetEnumerator() | Where-Object { $_.Value.State -eq 'FAIL' } | ForEach-Object { $_.Key })
  $absenceCompatibleFailures = @('MIGRATION_HISTORY', 'RPC_SECURITY', 'RPC_GRANTS', 'RLS', 'SERVICE_ROLE_GRANTS')
  $effectiveFailures = if ($chain -eq 'CHAIN_ABSENT') { @($failures | Where-Object { $_ -notin $absenceCompatibleFailures }) } else { $failures }
  if ($control['PROJECT_REF'].Category -eq 'BLOCKED_PROJECT_REF_UNPROVEN') { Write-Evidence BLOCKED DECISION BLOCKED_PROJECT_REF_UNPROVEN; exit 1 }
  if ($chain -eq 'CHAIN_PARTIAL') { Write-Evidence BLOCKED DECISION BLOCKED_PARTIAL_CHAIN; exit 1 }
  if ($effectiveFailures.Count -gt 0) {
    $securityChecks = @('RPC_SECURITY', 'RPC_GRANTS', 'M027_CLEANUP', 'RLS', 'BROWSER_POLICIES', 'BROWSER_GRANTS', 'DELETE_GRANTS', 'SERVICE_ROLE_GRANTS')
    $decision = if (@($effectiveFailures | Where-Object { $_ -in $securityChecks }).Count -gt 0) { 'BLOCKED_SECURITY_MISMATCH' } else { 'BLOCKED_DRIFT' }
    Write-Evidence BLOCKED DECISION $decision; exit 1
  }
  if ($chain -eq 'CHAIN_FULL_RECORDED') { Write-Evidence PASS DECISION NO_APPLY_NEEDED_TARGET_ALREADY_MATCHES; exit 0 }
  if ($chain -eq 'CHAIN_ABSENT') {
    $decision = switch ($Target) { 'local' { 'READY_FOR_LOCAL_REHEARSAL' }; 'staging' { 'READY_FOR_STAGING_APPLY_REVIEW' }; 'production' { 'READY_FOR_PRODUCTION_APPLY_REVIEW' } }
    Write-Evidence PASS DECISION $decision; exit 0
  }
  Write-Evidence BLOCKED DECISION BLOCKED_DRIFT; exit 1
} catch {
  if ($_.Exception.Message -eq 'PSQL_NOT_FOUND') { Write-Evidence BLOCKED PSQL not_found }
  elseif ($_.Exception.Message -eq 'LOCAL_DATABASE_RESERVED_ENVIRONMENT_TOKEN') { Write-Evidence BLOCKED LOCAL_DATABASE reserved_environment_token }
  elseif ($_.Exception.Message -eq 'READONLY_PSQL_TIMEOUT') { Write-Evidence BLOCKED PREFLIGHT psql_timeout }
  elseif ($_.Exception.Message -eq 'PSQL_INVOCATION_FAILED') { Write-Evidence BLOCKED PREFLIGHT psql_invocation_failed }
  elseif ($_.Exception.Message -eq 'READONLY_SQL_FAILED') { Write-Evidence BLOCKED PREFLIGHT readonly_sql_failed }
  elseif ($_.Exception.Message -eq 'PSQL_EXIT_NONZERO') { Write-Evidence BLOCKED PREFLIGHT psql_exit_nonzero }
  else { Write-Evidence BLOCKED PREFLIGHT $_.Exception.Message }
  exit 1
}
