[CmdletBinding()]
param(
  [ValidateSet('local', 'staging', 'production')]
  [string]$Target,
  [string]$ExpectedProjectRef,
  [string]$ExpectedDatabaseName,
  [string]$ExpectedConnectedRole,
  [switch]$RunReadOnlyChecks,
  [switch]$RunOfflineParserSelfTests,
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
$RequiredControlKeys = @('DATABASE_IDENTITY', 'ROLE_IDENTITY', 'SERVER_SESSION', 'PROJECT_REF', 'MIGRATION_HISTORY', 'CHAIN_STATE', 'TABLES', 'RPC_SIGNATURES', 'RPC_SECURITY', 'ROLE_BASELINE', 'RPC_GRANTS', 'M027_CLEANUP', 'RLS', 'BROWSER_POLICIES', 'BROWSER_GRANTS', 'DELETE_GRANTS', 'SERVICE_ROLE_GRANTS')

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
    Write-Evidence PASS LOCAL_TARGET loopback
    $exactBlockedLocalDatabaseNames = @('postgres', 'template0', 'template1', 'production', 'staging')
    $reservedLocalDatabaseTokenPattern = '(?i)(production|prod|staging|stage|preview|live|main|primary|shared|default|template|postgres|supabase)'
    if ($Config.Database -in $exactBlockedLocalDatabaseNames -or $Config.Database -match $reservedLocalDatabaseTokenPattern) {
      throw 'LOCAL_DATABASE_RESERVED_ENVIRONMENT_TOKEN'
    }
    if ($Config.Database -notmatch '(?i)^(?:deraledger_[a-z0-9_]*rehearsal[a-z0-9_]*|deraledger_[a-z0-9_]*(?:local|test|disposable)[a-z0-9_]*)$') {
      throw 'LOCAL_DISPOSABLE_DATABASE_NAME_REQUIRED'
    }
    Write-Evidence PASS LOCAL_DATABASE disposable
    if ($Config.Port -ne '55432') { throw 'LOCAL_PORT_MUST_BE_55432' }
    Write-Evidence PASS LOCAL_PORT 55432
    if ($Config.User -ine 'postgres') { throw 'LOCAL_USER_MUST_BE_POSTGRES' }
    Write-Evidence PASS LOCAL_USER postgres
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

function Convert-ControlRows {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Lines)
  $control = @{}
  $sawControl = $false

  foreach ($line in @($Lines)) {
    $normalized = $line.Trim().TrimStart([char]0xFEFF)
    if ([string]::IsNullOrWhiteSpace($normalized)) { continue }
    if ($normalized -notmatch '^CONTROL\|') { continue }
    $sawControl = $true
    $parts = $normalized -split '\|', 4
    if ($parts.Count -ne 4 -or $parts[0] -ne 'CONTROL' -or $parts[1] -notin $RequiredControlKeys -or $parts[2] -notin @('PASS', 'FAIL') -or [string]::IsNullOrWhiteSpace($parts[3])) {
      throw 'CONTROL_ROW_MALFORMED'
    }
    if ($control.ContainsKey($parts[1])) { throw 'CONTROL_ROW_DUPLICATE' }
    $control[$parts[1]] = [pscustomobject]@{ State = $parts[2]; Category = $parts[3] }
  }

  if (-not $sawControl) { throw 'CONTROL_ROW_MISSING' }
  foreach ($key in $RequiredControlKeys) {
    if (-not $control.ContainsKey($key)) { throw 'CONTROL_ROW_MISSING' }
  }
  return $control
}

function Get-ControlRowFailureCategory {
  param([Parameter(Mandatory = $true)][string]$Reason)
  switch ($Reason) {
    'CONTROL_ROW_MISSING' { return 'control_row_missing' }
    'CONTROL_ROW_DUPLICATE' { return 'control_row_duplicate' }
    'CONTROL_ROW_MALFORMED' { return 'control_row_malformed' }
    default { throw 'UNKNOWN_CONTROL_ROW_FAILURE' }
  }
}

function Get-PreflightAssessment {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Control,
    [string]$TargetLabel = $Target
  )
  $chain = $Control['CHAIN_STATE'].Category
  $failures = @($Control.GetEnumerator() | Where-Object { $_.Value.State -eq 'FAIL' } | ForEach-Object { $_.Key })
  $absenceCompatibleFailures = @('MIGRATION_HISTORY', 'RPC_SECURITY', 'RPC_GRANTS', 'RLS', 'SERVICE_ROLE_GRANTS')
  $effectiveFailures = @()
  if ($chain -eq 'CHAIN_ABSENT') {
    $effectiveFailures = @($failures | Where-Object { $_ -notin $absenceCompatibleFailures })
  } else {
    $effectiveFailures = @($failures)
  }

  if ($Control['PROJECT_REF'].Category -eq 'BLOCKED_PROJECT_REF_UNPROVEN') { return [pscustomobject]@{ Chain = $chain; Decision = 'BLOCKED_PROJECT_REF_UNPROVEN'; Blocked = $true; CleanLocalAbsent = $false } }
  if ($chain -eq 'CHAIN_PARTIAL') { return [pscustomobject]@{ Chain = $chain; Decision = 'BLOCKED_PARTIAL_CHAIN'; Blocked = $true; CleanLocalAbsent = $false } }
  if ($effectiveFailures.Count -gt 0) {
    $securityChecks = @('ROLE_BASELINE', 'RPC_SECURITY', 'RPC_GRANTS', 'M027_CLEANUP', 'RLS', 'BROWSER_POLICIES', 'BROWSER_GRANTS', 'DELETE_GRANTS', 'SERVICE_ROLE_GRANTS')
    $decision = if (@($effectiveFailures | Where-Object { $_ -in $securityChecks }).Count -gt 0) { 'BLOCKED_SECURITY_MISMATCH' } else { 'BLOCKED_DRIFT' }
    return [pscustomobject]@{ Chain = $chain; Decision = $decision; Blocked = $true; CleanLocalAbsent = $false }
  }
  if ($chain -eq 'CHAIN_FULL_RECORDED') { return [pscustomobject]@{ Chain = $chain; Decision = 'NO_APPLY_NEEDED_TARGET_ALREADY_MATCHES'; Blocked = $false; CleanLocalAbsent = $false } }
  if ($chain -eq 'CHAIN_ABSENT') {
    $decision = switch ($TargetLabel) { 'local' { 'READY_FOR_LOCAL_REHEARSAL' }; 'staging' { 'READY_FOR_STAGING_APPLY_REVIEW' }; 'production' { 'READY_FOR_PRODUCTION_APPLY_REVIEW' } }
    return [pscustomobject]@{ Chain = $chain; Decision = $decision; Blocked = $false; CleanLocalAbsent = ($TargetLabel -eq 'local') }
  }
  return [pscustomobject]@{ Chain = $chain; Decision = 'BLOCKED_DRIFT'; Blocked = $true; CleanLocalAbsent = $false }
}

function Write-ControlEvidence {
  param([Parameter(Mandatory = $true)][hashtable]$Control, [Parameter(Mandatory = $true)]$Assessment)
  if ($Assessment.CleanLocalAbsent) {
    Write-Evidence $Control['ROLE_BASELINE'].State ROLE_BASELINE $Control['ROLE_BASELINE'].Category
    Write-Evidence PASS MIGRATION_HISTORY chain_absent
    Write-Evidence PASS OBJECT_STATE protected_objects_absent
    Write-Evidence PASS SECURITY_BASELINE clean_local_absent
    return
  }
  foreach ($key in $RequiredControlKeys) {
    Write-Evidence $Control[$key].State $key $Control[$key].Category
  }
}

function Invoke-OfflineParserSelfTests {
  $cleanLocalRows = @(
    'CONTROL|DATABASE_IDENTITY|PASS|expected_observed_match', 'CONTROL|ROLE_IDENTITY|PASS|expected_observed_match', 'CONTROL|SERVER_SESSION|PASS|address_port_schema_available', 'CONTROL|PROJECT_REF|PASS|not_required_local',
    'CONTROL|MIGRATION_HISTORY|FAIL|history_table_missing', 'CONTROL|CHAIN_STATE|PASS|CHAIN_ABSENT', 'CONTROL|TABLES|PASS|absent_consistent', 'CONTROL|RPC_SIGNATURES|PASS|absent_consistent',
    'CONTROL|ROLE_BASELINE|PASS|supabase_roles_absent_clean_local',
    'CONTROL|RPC_SECURITY|FAIL|security_or_search_path_mismatch', 'CONTROL|RPC_GRANTS|FAIL|function_grant_mismatch', 'CONTROL|M027_CLEANUP|PASS|absent_consistent', 'CONTROL|RLS|FAIL|disabled_missing_or_forced',
    'CONTROL|BROWSER_POLICIES|PASS|zero', 'CONTROL|BROWSER_GRANTS|PASS|revoked', 'CONTROL|DELETE_GRANTS|PASS|absent', 'CONTROL|SERVICE_ROLE_GRANTS|FAIL|table_grant_mismatch'
  )
  $control = Convert-ControlRows -Lines $cleanLocalRows
  $assessment = Get-PreflightAssessment -Control $control -TargetLabel 'local'
  if ($assessment.Decision -ne 'READY_FOR_LOCAL_REHEARSAL') { throw 'OFFLINE_CLEAN_LOCAL_DECISION_FAILED' }
  $evidence = @(Write-ControlEvidence -Control $control -Assessment $assessment)
  foreach ($expectedEvidence in @('PASS|ROLE_BASELINE|supabase_roles_absent_clean_local', 'PASS|MIGRATION_HISTORY|chain_absent', 'PASS|OBJECT_STATE|protected_objects_absent', 'PASS|SECURITY_BASELINE|clean_local_absent')) {
    if ($evidence -notcontains $expectedEvidence) { throw 'OFFLINE_EVIDENCE_ORDER_OR_CONTENT_FAILED' }
  }
  $bomAndCrLfRows = @($cleanLocalRows | ForEach-Object { $_ + "`r" })
  $bomAndCrLfRows[0] = [string][char]0xFEFF + $bomAndCrLfRows[0]
  if ((Convert-ControlRows -Lines $bomAndCrLfRows)['CHAIN_STATE'].Category -ne 'CHAIN_ABSENT') { throw 'OFFLINE_BOM_OR_CRLF_NORMALIZATION_FAILED' }
  $nonCleanRoleMissingRows = @($cleanLocalRows | ForEach-Object {
    $_.Replace('CONTROL|MIGRATION_HISTORY|FAIL|history_table_missing', 'CONTROL|MIGRATION_HISTORY|PASS|history_table_present').Replace('CONTROL|CHAIN_STATE|PASS|CHAIN_ABSENT', 'CONTROL|CHAIN_STATE|PASS|CHAIN_FULL_RECORDED').Replace('CONTROL|TABLES|PASS|absent_consistent', 'CONTROL|TABLES|PASS|required_tables_present').Replace('CONTROL|RPC_SIGNATURES|PASS|absent_consistent', 'CONTROL|RPC_SIGNATURES|PASS|expected_signatures_present').Replace('CONTROL|ROLE_BASELINE|PASS|supabase_roles_absent_clean_local', 'CONTROL|ROLE_BASELINE|FAIL|required_role_missing').Replace('CONTROL|RPC_SECURITY|FAIL|security_or_search_path_mismatch', 'CONTROL|RPC_SECURITY|PASS|invoker_and_search_path_hardened').Replace('CONTROL|RPC_GRANTS|FAIL|function_grant_mismatch', 'CONTROL|RPC_GRANTS|FAIL|required_role_missing_or_function_grant_mismatch').Replace('CONTROL|M027_CLEANUP|PASS|absent_consistent', 'CONTROL|M027_CLEANUP|PASS|hardened_cleanup_state').Replace('CONTROL|RLS|FAIL|disabled_missing_or_forced', 'CONTROL|RLS|PASS|enabled_not_forced').Replace('CONTROL|SERVICE_ROLE_GRANTS|FAIL|table_grant_mismatch', 'CONTROL|SERVICE_ROLE_GRANTS|PASS|exact_manifest_privileges')
  })
  $nonCleanRoleMissingAssessment = Get-PreflightAssessment -Control (Convert-ControlRows -Lines $nonCleanRoleMissingRows) -TargetLabel 'local'
  if (-not $nonCleanRoleMissingAssessment.Blocked -or $nonCleanRoleMissingAssessment.Decision -ne 'BLOCKED_SECURITY_MISMATCH') { throw 'OFFLINE_REQUIRED_ROLE_MISSING_NOT_BLOCKED' }
  $cases = @(
    @{ Lines = @(); Expected = 'CONTROL_ROW_MISSING'; Evidence = 'BLOCKED|PREFLIGHT|control_row_missing' },
    @{ Lines = @($cleanLocalRows + 'CONTROL|CHAIN_STATE|PASS|CHAIN_ABSENT'); Expected = 'CONTROL_ROW_DUPLICATE'; Evidence = 'BLOCKED|PREFLIGHT|control_row_duplicate' },
    @{ Lines = @('CONTROL|CHAIN_STATE|PASS'); Expected = 'CONTROL_ROW_MALFORMED'; Evidence = 'BLOCKED|PREFLIGHT|control_row_malformed' }
  )
  foreach ($case in $cases) {
    try { Convert-ControlRows -Lines $case.Lines | Out-Null; throw 'OFFLINE_PARSER_EXPECTED_FAILURE_MISSING' }
    catch {
      if ($_.Exception.Message -ne $case.Expected) { throw }
      if (('BLOCKED|PREFLIGHT|' + (Get-ControlRowFailureCategory -Reason $_.Exception.Message)) -ne $case.Evidence) { throw 'OFFLINE_CONTROL_FAILURE_EVIDENCE_FAILED' }
    }
  }
  Write-Evidence PASS OFFLINE_PARSER clean_local_and_control_failures_mapped
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
WITH required_roles(role_name) AS (VALUES ('service_role'), ('anon'), ('authenticated')),
observed_roles AS (
  SELECT required_roles.role_name, pg_roles.oid
  FROM required_roles LEFT JOIN pg_roles ON pg_roles.rolname = required_roles.role_name
)
SELECT 'CONTROL|ROLE_BASELINE|' || CASE
  WHEN count(*) FILTER (WHERE oid IS NOT NULL) = 3 THEN 'PASS|required_roles_present'
  WHEN :'target_label' = 'local' AND (:'history_recorded_count')::integer = 0 AND count(*) FILTER (WHERE oid IS NOT NULL) = 0 THEN 'PASS|supabase_roles_absent_clean_local'
  ELSE 'FAIL|required_role_missing'
END FROM observed_roles;
WITH expected(signature) AS (VALUES
  ('public.bootstrap_reviewed_profile_v1(uuid,uuid,text,text,text,text,text,uuid,uuid,timestamptz)'),
  ('public.review_compliance_profile_decision_v1(uuid,uuid,text,text,uuid,bigint,text,bigint,uuid,text,text,timestamptz,text)'),
  ('public.issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)'),
  ('public.read_canonical_approval_snapshot_v1(uuid)'),
  ('public.reconcile_canonical_merchant_workspace_link_v1(uuid,uuid,text)'),
  ('public.issue_canonical_approval_decision_request_v2(uuid,uuid,text,text,text)'),
  ('public.read_canonical_approval_snapshot_v2(uuid)')
), role_oids AS (
  SELECT
    max(oid) FILTER (WHERE rolname = 'service_role') AS service_role_oid,
    max(oid) FILTER (WHERE rolname = 'anon') AS anon_oid,
    max(oid) FILTER (WHERE rolname = 'authenticated') AS authenticated_oid
  FROM pg_roles
  WHERE rolname IN ('service_role', 'anon', 'authenticated')
), function_acl AS (
  SELECT function_state.oid,
    EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(function_state.proacl, acldefault('f', function_state.proowner))) privilege_state
      WHERE privilege_state.grantee = role_oids.service_role_oid AND privilege_state.privilege_type = 'EXECUTE'
    ) AS service_role_execute,
    NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(function_state.proacl, acldefault('f', function_state.proowner))) privilege_state
      WHERE privilege_state.grantee = role_oids.anon_oid AND privilege_state.privilege_type = 'EXECUTE'
    ) AS anon_execute_revoked,
    NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(function_state.proacl, acldefault('f', function_state.proowner))) privilege_state
      WHERE privilege_state.grantee = role_oids.authenticated_oid AND privilege_state.privilege_type = 'EXECUTE'
    ) AS authenticated_execute_revoked,
    NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(function_state.proacl, acldefault('f', function_state.proowner))) privilege_state
      WHERE privilege_state.grantee = 0 AND privilege_state.privilege_type = 'EXECUTE'
    ) AS public_execute_revoked
  FROM expected
  JOIN pg_proc function_state ON function_state.oid = to_regprocedure(expected.signature)
  CROSS JOIN role_oids
)
SELECT 'CONTROL|RPC_GRANTS|' || CASE
  WHEN :'target_label' = 'local' AND (:'history_recorded_count')::integer = 0
    AND (SELECT count(*) FROM function_acl) = 0
    AND (SELECT service_role_oid IS NULL AND anon_oid IS NULL AND authenticated_oid IS NULL FROM role_oids)
    THEN 'PASS|supabase_roles_absent_clean_local'
  WHEN (SELECT service_role_oid IS NOT NULL AND anon_oid IS NOT NULL AND authenticated_oid IS NOT NULL FROM role_oids)
    AND (SELECT count(*) FROM function_acl) = 7
    AND COALESCE((SELECT bool_and(service_role_execute AND anon_execute_revoked AND authenticated_execute_revoked AND public_execute_revoked) FROM function_acl), false)
    THEN 'PASS|service_role_only'
  ELSE 'FAIL|required_role_missing_or_function_grant_mismatch'
END;
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
  param($Config, [Parameter(Mandatory = $true)][string]$PsqlExecutable)
  $psql = $PsqlExecutable
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

if ($RunOfflineParserSelfTests) {
  try { Invoke-OfflineParserSelfTests; exit 0 }
  catch { Write-Evidence BLOCKED PREFLIGHT offline_parser_self_test_failed; Write-Evidence BLOCKED DECISION BLOCKED_CONTROL_ROWS; exit 1 }
}

try {
  if ([string]::IsNullOrWhiteSpace($Target)) { throw 'TARGET_LABEL_REQUIRED' }
  Write-Evidence PASS TARGET_LABEL accepted
  $config = Read-TargetConfiguration
  Assert-TargetGuards -Config $config
  if ($Target -ne 'local') { Write-Evidence PASS PROJECT_REF expected_ref_supplied_pending_independent_proof }
  if (-not $RunReadOnlyChecks) { Write-Evidence BLOCKED EXECUTION read_only_checks_require_explicit_RunReadOnlyChecks; Write-Evidence BLOCKED DECISION BLOCKED_PREFLIGHT; exit 1 }
  $psql = Resolve-PsqlExecutable
  Write-Evidence PASS PSQL resolved
  $lines = Invoke-ReadOnlyPsql -Config $config -PsqlExecutable $psql
  $control = Convert-ControlRows -Lines $lines
  $assessment = Get-PreflightAssessment -Control $control
  Write-ControlEvidence -Control $control -Assessment $assessment
  if ($assessment.Blocked) { Write-Evidence BLOCKED DECISION $assessment.Decision; exit 1 }
  Write-Evidence PASS DECISION $assessment.Decision; exit 0
} catch {
  $message = $_.Exception.Message
  if ($message -eq 'PSQL_NOT_FOUND') { Write-Evidence BLOCKED PSQL not_found; Write-Evidence BLOCKED DECISION BLOCKED_PSQL }
  elseif ($message -eq 'LOCAL_DATABASE_RESERVED_ENVIRONMENT_TOKEN') { Write-Evidence BLOCKED LOCAL_DATABASE reserved_environment_token; Write-Evidence BLOCKED DECISION BLOCKED_TARGET_MISMATCH }
  elseif ($message -in @('CONTROL_ROW_MISSING', 'CONTROL_ROW_DUPLICATE', 'CONTROL_ROW_MALFORMED')) { Write-Evidence BLOCKED PREFLIGHT (Get-ControlRowFailureCategory -Reason $message); Write-Evidence BLOCKED DECISION BLOCKED_CONTROL_ROWS }
  elseif ($message -eq 'READONLY_PSQL_TIMEOUT') { Write-Evidence BLOCKED PREFLIGHT psql_timeout; Write-Evidence BLOCKED DECISION BLOCKED_PSQL }
  elseif ($message -eq 'PSQL_INVOCATION_FAILED') { Write-Evidence BLOCKED PREFLIGHT psql_invocation_failed; Write-Evidence BLOCKED DECISION BLOCKED_PSQL }
  elseif ($message -eq 'READONLY_SQL_FAILED') { Write-Evidence BLOCKED PREFLIGHT readonly_sql_failed; Write-Evidence BLOCKED DECISION BLOCKED_PREFLIGHT }
  elseif ($message -eq 'PSQL_EXIT_NONZERO') { Write-Evidence BLOCKED PREFLIGHT psql_exit_nonzero; Write-Evidence BLOCKED DECISION BLOCKED_PSQL }
  elseif ($message -match '^LOCAL_|^INVALID_|^TARGET_') { Write-Evidence BLOCKED PREFLIGHT target_guard_failed; Write-Evidence BLOCKED DECISION BLOCKED_TARGET_MISMATCH }
  else { Write-Evidence BLOCKED PREFLIGHT unexpected_preflight_failure; Write-Evidence BLOCKED DECISION BLOCKED_PREFLIGHT }
  exit 1
}
