[CmdletBinding()]
param(
  [switch]$RunReadOnlyChecks,
  [string]$PsqlPath = 'psql'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$MigrationPath = Join-Path $ProjectRoot 'supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql'
$EvidenceRoot = Join-Path $ProjectRoot 'local-evidence/admin-readiness-security'
$PostgresEnvironmentNames = @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSSLMODE')

function Write-Result { param([string]$State, [string]$Message) Write-Output ("{0}|{1}" -f $State, $Message) }
function Assert-RouteFlagDisabled {
  foreach ($scope in @('Process', 'User', 'Machine')) {
    if ([Environment]::GetEnvironmentVariable('DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED', $scope) -eq 'true') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_ROUTE_FLAG_MUST_REMAIN_DISABLED' }
  }
}
function Assert-PlainConnectionFields {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '(?i)://|(?:^|\s)(?:host|port|dbname|user|password)\s*=') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_CONNECTION_STRING_REJECTED' }
}
function Read-LocalTarget {
  $DbHost = (Read-Host 'Local database host (localhost or 127.0.0.1 only)').Trim().ToLowerInvariant()
  $DbPort = (Read-Host 'Local database port (default 5432)').Trim()
  $DbName = (Read-Host 'Disposable local database name').Trim().ToLowerInvariant()
  $DbUser = (Read-Host 'Local database user').Trim()
  if ([string]::IsNullOrWhiteSpace($DbPort)) { $DbPort = '5432' }
  foreach ($value in @($DbHost, $DbPort, $DbName, $DbUser)) { Assert-PlainConnectionFields $value }
  if ($DbHost -match '(?i)supabase\.(?:co|com)') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_SUPABASE_CLOUD_HOST_REJECTED' }
  if ($DbHost -notin @('localhost', '127.0.0.1')) { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_NONLOCAL_HOST_REJECTED' }
  if ($DbPort -notmatch '^[0-9]{1,5}$' -or [int]$DbPort -lt 1 -or [int]$DbPort -gt 65535) { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_PORT_REJECTED' }
  if ($DbName -match '(?i)(?:production|prod|staging|preview|main)') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_DATABASE_NAME_REJECTED' }
  $IsLocalSupabasePostgresDefault = $DbName -eq 'postgres'
  if ($IsLocalSupabasePostgresDefault) {
    if ($DbHost -notin @('localhost', '127.0.0.1') -or $DbPort -ne '55432' -or $DbUser -ine 'postgres') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_POSTGRES_DEFAULT_TARGET_REJECTED' }
  } elseif ($DbName -notmatch '(?i)(local|test|rehearsal|disposable|admin_readiness)') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_DISPOSABLE_DATABASE_NAME_REQUIRED' }
  [pscustomobject]@{ DbHost = $DbHost; DbPort = $DbPort; DbName = $DbName; DbUser = $DbUser; IsLocalSupabasePostgresDefault = $IsLocalSupabasePostgresDefault }
}
function Assert-LocalPostgresDefaultConfirmation {
  param($Target)
  if (-not $Target.IsLocalSupabasePostgresDefault) { return }
  $Confirmation = (Read-Host 'Type LOCAL DISPOSABLE POSTGRES TARGET to confirm the loopback Supabase default database').Trim()
  if ($Confirmation -cne 'LOCAL DISPOSABLE POSTGRES TARGET') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_POSTGRES_DEFAULT_CONFIRMATION_REQUIRED' }
}
function Invoke-ReadOnlyPsql {
  param($Target, [string]$Psql, [string]$Sql)
  $SavedPgEnvironment = @{}
  foreach ($environmentName in $PostgresEnvironmentNames) {
    $SavedPgEnvironment[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
    [Environment]::SetEnvironmentVariable($environmentName, $null, 'Process')
  }
  $SecurePassword = Read-Host 'Local database password (not stored or echoed)' -AsSecureString
  $PasswordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
  $PlainPassword = $null
  try {
    $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordBstr)
    [Environment]::SetEnvironmentVariable('PGPASSWORD', $PlainPassword, 'Process')
    $output = & $Psql -X -v ON_ERROR_STOP=1 -h $Target.DbHost -p $Target.DbPort -U $Target.DbUser -d $Target.DbName -At -c $Sql 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_READONLY_METADATA_FAILED' }
    return @($output)
  } finally {
    if ($null -ne $PasswordBstr) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordBstr) }
    $PlainPassword = $null
    foreach ($environmentName in $PostgresEnvironmentNames) { [Environment]::SetEnvironmentVariable($environmentName, $SavedPgEnvironment[$environmentName], 'Process') }
  }
}
function Write-SafeEvidence { param([string[]]$Lines)
  New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
  $EvidencePath = Join-Path $EvidenceRoot ("preflight-{0}.txt" -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
  [System.IO.File]::WriteAllLines($EvidencePath, $Lines, [System.Text.UTF8Encoding]::new($false))
}

try {
  Assert-RouteFlagDisabled
  if (-not (Test-Path -LiteralPath $MigrationPath -PathType Leaf)) { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_MIGRATION_MISSING' }
  $Psql = (Get-Command $PsqlPath -ErrorAction Stop).Source
  $Target = Read-LocalTarget
  Assert-LocalPostgresDefaultConfirmation -Target $Target
  $Confirmation = (Read-Host 'Type LOCAL DISPOSABLE PREFLIGHT to continue; localhost tunnels remain operator risk').Trim()
  if ($Confirmation -cne 'LOCAL DISPOSABLE PREFLIGHT') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_PREFLIGHT_CONFIRMATION_REQUIRED' }
  Write-Result 'PASS' 'local_target_guard_passed'; Write-Result 'PASS' 'migration_source_present'; Write-Result 'PASS' 'route_flag_disabled'
  if (-not $RunReadOnlyChecks) {
    Write-SafeEvidence @('PRELIGHT=PASS', 'TARGET=LOCAL_DISPOSABLE', 'READ_ONLY_METADATA=SKIPPED', 'ROUTE_FLAG=DISABLED')
    Write-Result 'SKIPPED' 'read_only_metadata_check_requires_RunReadOnlyChecks'; Write-Result 'PASS' 'preflight_complete'; exit 0
  }
  $IdentitySql = @'
SELECT 'connected_database=' || current_database();
SELECT 'server_address=' || coalesce(host(inet_server_addr()), 'unavailable');
SELECT 'server_port=' || coalesce(inet_server_port()::text, 'unavailable');
SELECT 'server_version=' || split_part(version(), E'\n', 1);
SELECT 'current_user=' || current_user;
SELECT 'service_role_exists=' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
SELECT 'service_role_bypassrls=' || coalesce((SELECT rolbypassrls::text FROM pg_roles WHERE rolname = 'service_role'), 'false');
SELECT 'service_role_assumable=' || CASE
  WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN false
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN true
  ELSE pg_has_role(current_user, 'service_role', 'MEMBER')
END;
SELECT 'business_schema_baseline=' || md5(coalesce(string_agg(c.relname || ':' || c.relfilenode || ':' || c.relnatts, ',' ORDER BY c.relname), 'empty')) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname NOT IN ('admin_readiness_csrf_tokens', 'admin_readiness_csrf_binding_index', 'admin_readiness_throttle_windows');
'@
  $Metadata = Invoke-ReadOnlyPsql -Target $Target -Psql $Psql -Sql $IdentitySql
  $ReportedDatabase = @($Metadata | Where-Object { $_ -match '^connected_database=' })[0]
  $ServerAddress = @($Metadata | Where-Object { $_ -match '^server_address=' })[0]
  $ServerPort = @($Metadata | Where-Object { $_ -match '^server_port=' })[0]
  $ServerVersion = @($Metadata | Where-Object { $_ -match '^server_version=' })[0]
  $ServiceRoleExists = @($Metadata | Where-Object { $_ -eq 'service_role_exists=true' })[0]
  $ServiceRoleBypassRls = @($Metadata | Where-Object { $_ -eq 'service_role_bypassrls=true' })[0]
  $ServiceRoleAssumable = @($Metadata | Where-Object { $_ -eq 'service_role_assumable=true' })[0]
  $Baseline = @($Metadata | Where-Object { $_ -match '^business_schema_baseline=[0-9a-f]{32}$' })[0]
  if ($ReportedDatabase -ne ("connected_database={0}" -f $Target.DbName)) { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_CONNECTED_DATABASE_MISMATCH' }
  if ($ServerAddress -notin @('server_address=127.0.0.1', 'server_address=::1')) { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_SERVER_ADDRESS_NOT_LOOPBACK' }
  if ($ServerPort -notmatch '^server_port=[0-9]{1,5}$' -or $ServerVersion -match '(?i)(supabase|cloud|amazon|neon)' -or [string]::IsNullOrWhiteSpace($Baseline)) { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_SUSPICIOUS_SERVER_METADATA' }
  if ($null -eq $ServiceRoleExists -or $null -eq $ServiceRoleBypassRls -or $null -eq $ServiceRoleAssumable) { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_SERVICE_ROLE_PREREQUISITE_FAILED' }
  $PostgresDefaultEvidence = if ($Target.IsLocalSupabasePostgresDefault) { 'LOCAL_POSTGRES_DEFAULT=PASS' } else { 'LOCAL_POSTGRES_DEFAULT=NOT_USED' }
  Write-SafeEvidence @('PRELIGHT=PASS', 'TARGET=LOCAL_DISPOSABLE', 'READ_ONLY_METADATA=PASS', $ReportedDatabase, $ServerAddress, $ServerPort, $ServerVersion, 'SERVICE_ROLE_EXISTS=PASS', 'SERVICE_ROLE_BYPASSRLS=PASS', 'SERVICE_ROLE_ASSUMABLE=PASS', $Baseline, $PostgresDefaultEvidence, 'ROUTE_FLAG=DISABLED')
  Write-Result 'PASS' 'connected_server_identity_verified'; Write-Result 'PASS' 'service_role_prerequisites_verified'; Write-Result 'PASS' 'preflight_complete'
} catch { Write-Result 'BLOCKED' $_.Exception.Message; exit 1 }
