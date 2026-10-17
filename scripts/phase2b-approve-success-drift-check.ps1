param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('flow_origin', 'flow_ownership')]
  [string]$Scenario
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sqlName = if ($Scenario -eq 'flow_origin') { 'drift-flow-origin.sql' } else { 'drift-flow-ownership.sql' }
$sqlFile = Join-Path $repoRoot "tests/sql/phase2b-approve-success/$sqlName"
$psql = Get-Command psql.exe -ErrorAction SilentlyContinue
if (-not $psql -or -not (Test-Path -LiteralPath $sqlFile)) {
  Write-Output "BLOCKED|APPROVE_SUCCESS|drift_${Scenario}_local_tool_or_source_missing"
  exit 2
}
if (-not (Test-NetConnection 127.0.0.1 -Port 55432 -InformationLevel Quiet)) {
  Write-Output "BLOCKED|APPROVE_SUCCESS|drift_${Scenario}_local_postgres_unavailable"
  exit 2
}
# The password is entered by psql's own console prompt. This script never reads it.
Write-Host 'Enter the local PostgreSQL password once when psql requests it.'
# psql is expected to return one PostgreSQL ERROR for a successful drift test.
# Windows PowerShell must therefore not promote native stderr to a terminating
# NativeCommandError before the checker can inspect the exit code/output.
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'

$lines = @(& $psql.Source -X -W -q -A -t -v ON_ERROR_STOP=1 `
  -h 127.0.0.1 -p 55432 -U postgres -d postgres -f $sqlFile 2>&1 |
  ForEach-Object { [string]$_ })

$status = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
$errors = @($lines | Where-Object { $_ -match '(?i)\bERROR:\s' })
$expected = 'ERROR:\s+Phase 2B approve success blocked: flow CHECK expression drift\s*$'
if ($status -ne 0 -and $errors.Count -eq 1 -and $errors[0] -match $expected `
    -and -not ($lines | Where-Object { $_ -match 'FAIL\|APPROVE_SUCCESS\|' })) {
  Write-Output "PASS|APPROVE_SUCCESS|drift_${Scenario}_guard"
  exit 0
}
$category = if ($status -eq 0) { 'migration_accepted_drift' } `
  elseif ($errors.Count -ne 1) { 'error_cardinality' } else { 'wrong_error_category' }
Write-Output "FAIL|APPROVE_SUCCESS|drift_${Scenario}|$category"
exit 1
