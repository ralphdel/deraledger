[CmdletBinding()]
param(
  [switch]$RunBootstrap,
  [string]$PsqlPath,
  [string]$DbHost = 'aws-1-eu-central-2.pooler.supabase.com',
  [string]$DbPort = '5432',
  [string]$DbName = 'postgres',
  [string]$DbUser = 'postgres.fsjljliiyfchkwbjifzw',
  [string]$ProjectRef = 'fsjljliiyfchkwbjifzw'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ExpectedProjectRef = 'fsjljliiyfchkwbjifzw'
$ExpectedDbHost = 'aws-1-eu-central-2.pooler.supabase.com'
$ExpectedDbUser = 'postgres.fsjljliiyfchkwbjifzw'
$ProtectedTables = @('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events','merchant_collection_limit_windows','merchant_collection_limit_reservations','merchant_collection_limit_reservation_windows','merchant_collection_usage_events','approval_policy_versions','approval_decision_requests','canonical_approval_snapshots','merchant_canonical_workspaces')
$ProtectedFunctions = @('bootstrap_reviewed_profile_v1','review_compliance_profile_decision_v1','issue_canonical_approval_decision_request_v1','read_canonical_approval_snapshot_v1','reconcile_canonical_merchant_workspace_link_v1','issue_canonical_approval_decision_request_v2','read_canonical_approval_snapshot_v2')
$PgEnvironmentNames = @('PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS','PGSSLMODE')

function Write-Evidence { param([string]$Line) Write-Host $Line }
function Stop-Blocked { param([string]$Line) Write-Evidence $Line; exit 1 }
function Resolve-Psql {
  param([string]$RequestedPath)
  $candidates = @($RequestedPath, (Get-Command psql -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue), 'C:\Program Files\PostgreSQL\15\bin\psql.exe', 'C:\Program Files\PostgreSQL\17\bin\psql.exe') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
  throw 'psql_not_found'
}
function Assert-Target {
  if ($ProjectRef -cne $ExpectedProjectRef -or $DbHost -cne $ExpectedDbHost -or $DbPort -cne '5432' -or $DbName -cne 'postgres' -or $DbUser -cne $ExpectedDbUser) { throw 'target_mismatch' }
  if ("$ProjectRef|$DbHost|$DbName|$DbUser" -match '(?i)gznwibespgkwknnvbrlv|production|prod|live') { throw 'production_indicator' }
}
function Invoke-Psql {
  param([string]$PsqlExe,[string]$Sql,[switch]$Mutation)
  $saved = @{}; foreach ($name in $PgEnvironmentNames) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $passwordBstr = $null
  try {
    $securePassword = Read-Host 'Staging password (local prompt; never echoed)' -AsSecureString
    $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    [Environment]::SetEnvironmentVariable('PGPASSWORD', [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr), 'Process')
    [Environment]::SetEnvironmentVariable('PGSSLMODE', 'require', 'Process')
    $args = @('-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',$DbHost,'-p',$DbPort,'-U',$DbUser,'-d',$DbName,'-c',$Sql)
    $output = & $PsqlExe @args 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'psql_exit_nonzero' }
    return @($output)
  } finally {
    if ($null -ne $passwordBstr) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr) }
    foreach ($name in $PgEnvironmentNames) { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
  }
}

try {
  Assert-Target
  if (-not $RunBootstrap) { Stop-Blocked 'BLOCKED|BOOTSTRAP|RunBootstrap_required' }
  $confirmation = (Read-Host 'Type STAGING BOOTSTRAP MIGRATION LEDGER').Trim()
  if ($confirmation -cne 'STAGING BOOTSTRAP MIGRATION LEDGER') { Stop-Blocked 'BLOCKED|BOOTSTRAP|confirmation_required' }
  $psql = Resolve-Psql $PsqlPath
  Write-Evidence 'PASS|TARGET|staging_guarded'; Write-Evidence 'PASS|SSL|required'; Write-Evidence 'PASS|PSQL|resolved'
  $tableList = ($ProtectedTables | ForEach-Object { "'$_'" }) -join ','
  $functionList = ($ProtectedFunctions | ForEach-Object { "'$_'" }) -join ','
  $precheckSql = "SELECT 'CONTROL|db=' || current_database() || '|role=' || current_user || '|ledger=' || CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'missing' ELSE 'present' END || '|protected=' || ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ($tableList)) + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ($functionList)))::text;"
  $control = @(Invoke-Psql -PsqlExe $psql -Sql $precheckSql)[0]
  if ($control -notmatch '^CONTROL\|db=postgres\|role=(postgres|service_role)\|ledger=(missing|present)\|protected=[0-9]+$') { Stop-Blocked 'BLOCKED|BOOTSTRAP|target_session_unconfirmed' }
  if ($control -match '\|protected=(?!0$)') { Stop-Blocked 'BLOCKED|DRIFT|protected_objects_without_history' }
  if ($control -match '\|ledger=present') { Stop-Blocked 'BLOCKED|LEDGER|already_present_requires_reconciliation' }
  Write-Evidence 'PASS|SESSION|database|postgres'; Write-Evidence ("PASS|SESSION|role|{0}" -f ($control -replace '^.*\|role=([^|]+)\|.*$','$1')); Write-Evidence 'PASS|PROTECTED_OBJECTS|absent'; Write-Evidence 'PASS|MIGRATION_HISTORY_TABLE|missing'
  $bootstrapSql = @'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);
'@
  [void](Invoke-Psql -PsqlExe $psql -Sql $bootstrapSql -Mutation)
  Write-Evidence 'PASS|SCHEMA|supabase_migrations|exists'; Write-Evidence 'PASS|TABLE|schema_migrations|created'; Write-Evidence 'PASS|BOOTSTRAP|ledger_container_only'
} catch {
  $reason = switch -Regex ($_.Exception.Message) { 'psql_not_found' {'psql_not_found'; break} 'target_mismatch' {'target_mismatch'; break} 'production_indicator' {'production_indicator'; break} 'psql_exit_nonzero' {'psql_exit_nonzero'; break} default {'bootstrap_failed'} }
  Stop-Blocked "BLOCKED|BOOTSTRAP|$reason"
}
