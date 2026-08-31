[CmdletBinding()]
param(
  [switch]$RunReadOnlyChecks,
  [string]$PsqlPath = 'psql'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$MigrationPath = Join-Path $ProjectRoot 'supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql'
$EvidenceRoot = Join-Path $ProjectRoot 'local-evidence/admin-readiness-security/staging'
$PostgresEnvironmentNames = @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSSLMODE')
$ApprovedStagingProjectRef = 'fsjljliiyfchkwbjifzw'
$ApprovedStagingDbHost = 'db.fsjljliiyfchkwbjifzw.supabase.co'

function Write-Result { param([string]$State, [string]$Message) Write-Output ("{0}|{1}" -f $State, $Message) }
function Assert-RouteFlagDisabled {
  foreach ($scope in @('Process', 'User', 'Machine')) {
    if ([Environment]::GetEnvironmentVariable('DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED', $scope) -eq 'true') { throw 'ADMIN_READINESS_STAGING_ROUTE_FLAG_MUST_REMAIN_DISABLED' }
  }
}
function Assert-PlainConnectionField {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '(?i)://|(?:^|\s)(?:host|port|dbname|user|password)\s*=') { throw 'ADMIN_READINESS_STAGING_CONNECTION_STRING_REJECTED' }
}
function Get-Sha256Hex { param([string]$Value) return ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value)))).ToLowerInvariant() }
function Read-StagingTarget {
  $DbHost = (Read-Host 'Exact reviewed staging Supabase database host').Trim().ToLowerInvariant()
  $DbPort = (Read-Host 'Staging database port (default 5432)').Trim()
  $DbName = (Read-Host 'Staging database name').Trim().ToLowerInvariant()
  $DbUser = (Read-Host 'Staging database user').Trim()
  $ConfirmedStagingProjectRef = (Read-Host 'Confirm the reviewed staging Supabase project ref').Trim().ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($DbPort)) { $DbPort = '5432' }
  foreach ($value in @($DbHost, $DbPort, $DbName, $DbUser, $ConfirmedStagingProjectRef)) { Assert-PlainConnectionField $value }
  if ($DbHost -in @('localhost', '127.0.0.1', '::1')) { throw 'ADMIN_READINESS_STAGING_LOCALHOST_REJECTED' }
  $HostMatch = [regex]::Match($DbHost, '^db\.([a-z0-9-]+)\.supabase\.co$')
  if (-not $HostMatch.Success) { throw 'ADMIN_READINESS_STAGING_UNRECOGNIZED_HOST_REJECTED' }
  $ParsedStagingProjectRef = $HostMatch.Groups[1].Value
  if ($ApprovedStagingDbHost -cne "db.$ApprovedStagingProjectRef.supabase.co") { throw 'ADMIN_READINESS_STAGING_APPROVED_IDENTITY_MANIFEST_INVALID' }
  if ($DbHost -cne $ApprovedStagingDbHost) { throw 'ADMIN_READINESS_STAGING_HOST_NOT_APPROVED' }
  if ($ParsedStagingProjectRef -cne $ApprovedStagingProjectRef) { throw 'ADMIN_READINESS_STAGING_PROJECT_REF_NOT_APPROVED' }
  if ($ConfirmedStagingProjectRef -cne $ApprovedStagingProjectRef) { throw 'ADMIN_READINESS_STAGING_PROJECT_REF_CONFIRMATION_MISMATCH' }
  if ($DbHost -match '(?i)(prod|production|live)' -or $DbName -match '(?i)(prod|production|live)' -or $DbUser -match '(?i)(prod|production|live)') { throw 'ADMIN_READINESS_STAGING_PRODUCTION_INDICATOR_REJECTED' }
  if ($DbPort -notmatch '^[0-9]{1,5}$' -or [int]$DbPort -lt 1 -or [int]$DbPort -gt 65535) { throw 'ADMIN_READINESS_STAGING_PORT_REJECTED' }
  $TargetFingerprint = Get-Sha256Hex "$DbHost|$DbPort|$DbName|$DbUser|$ApprovedStagingProjectRef"
  [pscustomobject]@{ DbHost=$DbHost; DbPort=$DbPort; DbName=$DbName; DbUser=$DbUser; ApprovedStagingProjectRef=$ApprovedStagingProjectRef; ApprovedStagingDbHost=$ApprovedStagingDbHost; TargetFingerprint=$TargetFingerprint }
}
function Invoke-StagingPsql {
  param($Target, [string]$Psql, [string]$Sql)
  $SavedPgEnvironment = @{}
  foreach ($environmentName in $PostgresEnvironmentNames) { $SavedPgEnvironment[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process'); [Environment]::SetEnvironmentVariable($environmentName, $null, 'Process') }
  $SecurePassword = Read-Host 'Staging database password (entered locally; not stored or echoed)' -AsSecureString
  $PasswordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
  $PlainPassword = $null
  try {
    $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordBstr)
    [Environment]::SetEnvironmentVariable('PGPASSWORD', $PlainPassword, 'Process')
    $output = & $Psql -X -v ON_ERROR_STOP=1 -h $Target.DbHost -p $Target.DbPort -U $Target.DbUser -d $Target.DbName -At -c $Sql 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'ADMIN_READINESS_STAGING_READONLY_PREFLIGHT_FAILED' }
    return @($output)
  } finally {
    if ($null -ne $PasswordBstr) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordBstr) }
    $PlainPassword = $null
    foreach ($environmentName in $PostgresEnvironmentNames) { [Environment]::SetEnvironmentVariable($environmentName, $SavedPgEnvironment[$environmentName], 'Process') }
  }
}
function Write-SafeEvidence {
  param([string[]]$Lines)
  New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
  $EvidencePath = Join-Path $EvidenceRoot ("preflight-{0}.txt" -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
  [System.IO.File]::WriteAllLines($EvidencePath, $Lines, [System.Text.UTF8Encoding]::new($false))
}

try {
  Assert-RouteFlagDisabled
  if (-not (Test-Path -LiteralPath $MigrationPath -PathType Leaf)) { throw 'ADMIN_READINESS_STAGING_MIGRATION_MISSING' }
  $Psql = (Get-Command $PsqlPath -ErrorAction Stop).Source
  $Target = Read-StagingTarget
  $Confirmation = (Read-Host 'Type STAGING PREFLIGHT TARGET CONFIRMED to confirm this is staging, never production').Trim()
  if ($Confirmation -cne 'STAGING PREFLIGHT TARGET CONFIRMED') { throw 'ADMIN_READINESS_STAGING_PREFLIGHT_CONFIRMATION_REQUIRED' }
  $MigrationHash = (Get-FileHash -LiteralPath $MigrationPath -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Result 'PASS' 'staging_target_guard_passed'; Write-Result 'PASS' 'migration_source_present'; Write-Result 'PASS' 'route_flag_disabled'
  if (-not $RunReadOnlyChecks) {
    Write-SafeEvidence @('PREFLIGHT=PASS', 'TARGET=STAGING', ("TARGET_FINGERPRINT={0}" -f $Target.TargetFingerprint), ("MIGRATION_SHA256={0}" -f $MigrationHash), 'READ_ONLY_METADATA=SKIPPED', 'ROUTE_FLAG=DISABLED')
    Write-Result 'SKIPPED' 'read_only_metadata_check_requires_RunReadOnlyChecks'; Write-Result 'PASS' 'preflight_complete'; exit 0
  }
  $PreflightSql = @'
SELECT 'connected_database=' || current_database();
SELECT 'server_address=' || coalesce(host(inet_server_addr()), 'unavailable');
SELECT 'server_port=' || coalesce(inet_server_port()::text, 'unavailable');
SELECT 'server_version=' || split_part(version(), E'\n', 1);
SELECT 'current_user=' || current_user;
SELECT 'service_role_exists=' || EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role');
SELECT 'service_role_bypassrls=' || coalesce((SELECT rolbypassrls::text FROM pg_roles WHERE rolname='service_role'), 'false');
SELECT 'service_role_assumable=' || CASE
  WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN false
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN true
  ELSE pg_has_role(current_user, 'service_role', 'MEMBER')
END;
SELECT 'operator_can_apply=' || (current_user IN (SELECT rolname FROM pg_roles WHERE rolsuper) OR pg_has_schema_privilege(current_user, 'public', 'CREATE'));
SELECT 'existing_security_tables=' || count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('admin_readiness_csrf_tokens','admin_readiness_csrf_binding_index','admin_readiness_throttle_windows');
SELECT 'existing_security_functions=' || count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('create_admin_readiness_csrf_token_v1','read_admin_readiness_csrf_token_v1','rotate_admin_readiness_csrf_token_v1','invalidate_admin_readiness_csrf_binding_v1','decide_admin_readiness_throttle_v1','cleanup_admin_readiness_security_storage_v1');
SELECT 'business_schema_baseline=' || md5(coalesce(string_agg(c.relname || ':' || c.relfilenode || ':' || c.relnatts, ',' ORDER BY c.relname), 'empty')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT IN ('admin_readiness_csrf_tokens','admin_readiness_csrf_binding_index','admin_readiness_throttle_windows');
SELECT 'security_table_bytes=' || coalesce(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('admin_readiness_csrf_tokens','admin_readiness_csrf_binding_index','admin_readiness_throttle_windows');
'@
  $Output = Invoke-StagingPsql -Target $Target -Psql $Psql -Sql $PreflightSql
  foreach ($required in @(("connected_database={0}" -f $Target.DbName), 'service_role_exists=true', 'service_role_bypassrls=true', 'service_role_assumable=true', 'operator_can_apply=true', 'existing_security_tables=0', 'existing_security_functions=0')) { if ($Output -notcontains $required) { throw "ADMIN_READINESS_STAGING_PREFLIGHT_FAILED:$required" } }
  $ServerAddress = @($Output | Where-Object { $_ -match '^server_address=' })[0]
  $ServerVersion = @($Output | Where-Object { $_ -match '^server_version=' })[0]
  $Baseline = @($Output | Where-Object { $_ -match '^business_schema_baseline=[0-9a-f]{32}$' })[0]
  if ([string]::IsNullOrWhiteSpace($ServerAddress) -or $ServerAddress -match '(?i)(localhost|127\.0\.0\.1|::1)' -or $ServerVersion -match '(?i)(local|docker)') { throw 'ADMIN_READINESS_STAGING_AMBIGUOUS_OR_LOCAL_SERVER_IDENTITY' }
  if ([string]::IsNullOrWhiteSpace($Baseline)) { throw 'ADMIN_READINESS_STAGING_BASELINE_CAPTURE_FAILED' }
  Write-SafeEvidence @('PREFLIGHT=PASS', 'TARGET=STAGING', ("TARGET_FINGERPRINT={0}" -f $Target.TargetFingerprint), ("MIGRATION_SHA256={0}" -f $MigrationHash), 'CONNECTED_IDENTITY=PASS', 'SERVICE_ROLE=PASS', 'SERVICE_ROLE_BYPASSRLS=PASS', 'SERVICE_ROLE_ASSUMABLE=PASS', 'OPERATOR_APPLY=PASS', $Baseline, 'TABLE_SIZE_BASELINE=CAPTURED', 'READ_ONLY_METADATA=PASS', 'ROUTE_FLAG=DISABLED')
  Write-Result 'PASS' 'connected_staging_identity_verified'; Write-Result 'PASS' 'staging_security_prerequisites_verified'; Write-Result 'PASS' 'preflight_complete'
} catch { Write-Result 'BLOCKED' $_.Exception.Message; exit 1 }
