[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('SourceCheck', 'Preflight', 'PrepareFixture', 'Postflight')]
  [string]$Operation,
  [guid]$CaseId,
  [string]$RunId,
  [int]$ExpectedRowVersion = -1,
  [string]$Boundary,
  [string]$Confirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectRef = 'fsjljliiyfchkwbjifzw'
$hostName = 'aws-1-eu-central-2.pooler.supabase.com'
$dbUser = 'postgres.fsjljliiyfchkwbjifzw'
$connection = "host=$hostName port=5432 dbname=postgres user=$dbUser sslmode=require connect_timeout=15"
$sqlFiles = @{
  Preflight = 'supabase/ops/phase2b_reopen_staging_preflight.sql'
  PrepareFixture = 'supabase/ops/phase2b_reopen_staging_fixture.sql'
  Postflight = 'supabase/ops/phase2b_reopen_staging_postflight.sql'
}

function Stop-Blocked([string]$reason) {
  Write-Output "BLOCKED|REOPEN_STAGING|$reason"
  exit 1
}

try {
  foreach ($relative in @($sqlFiles.Values) + 'supabase/ops/phase2b_reopen_staging_boundary.sql') {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) {
      Stop-Blocked 'package_file_missing'
    }
  }
  if ($Operation -eq 'SourceCheck') {
    Write-Output 'PASS|REOPEN_STAGING|source_checked|password_prompts=0'
    exit 0
  }

  foreach ($name in @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER',
      'PGPASSWORD', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS',
      'PGSSLMODE', 'PGREQUIRESSL', 'PGCHANNELBINDING', 'PGTARGETSESSIONATTRS')) {
    if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) {
      Stop-Blocked 'inherited_libpq_override'
    }
  }
  if ($CaseId -eq [guid]::Empty) { Stop-Blocked 'case_id_required' }
  if ($RunId -cnotmatch '^phase2b-reject-[0-9]{8}-[a-z0-9]{3,16}$') {
    Stop-Blocked 'reject_run_id_required'
  }
  if ($Operation -in @('PrepareFixture', 'Postflight') -and $ExpectedRowVersion -lt 1) {
    Stop-Blocked 'preaction_row_version_required'
  }
  if ($Operation -eq 'Postflight' -and $Boundary -cnotmatch '^[0-9a-f]{32}$') {
    Stop-Blocked 'preaction_boundary_required'
  }
  if ($Operation -eq 'PrepareFixture' -and
      $Confirmation -cne "PREPARE REOPEN FIXTURE $RunId $CaseId") {
    Stop-Blocked 'separate_fixture_confirmation_required'
  }

  $psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
  $psql = if ($null -ne $psqlCommand) { $psqlCommand.Source } else { 'C:\Program Files\PostgreSQL\15\bin\psql.exe' }
  if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) { Stop-Blocked 'psql_unavailable' }

  $arguments = @('-X', '-W', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-v', "expected_project_ref=$projectRef",
    '-v', "fixture_case_id=$CaseId",
    '-v', "fixture_run_id=$RunId",
    '-d', $connection)
  if ($Operation -in @('PrepareFixture', 'Postflight')) {
    $arguments += @('-v', "expected_row_version=$ExpectedRowVersion")
  }
  if ($Operation -eq 'Postflight') {
    $arguments += @('-v', "expected_boundary=$Boundary")
  }
  $arguments += @('-f', (Join-Path $root $sqlFiles[$Operation]))

  # psql owns the single interactive -W prompt; this script never reads or stores the password.
  $lines = @(& $psql @arguments)
  $exitCode = $LASTEXITCODE
  foreach ($line in $lines) {
    if ($line -match '^(PASS|BLOCKED|FAIL)\|REOPEN_(PREFLIGHT|FIXTURE|POSTFLIGHT)\|[a-z0-9_|=.-]+$') {
      Write-Output $line
    }
  }
  $finalMarker = switch ($Operation) {
    Preflight { '^PASS\|REOPEN_PREFLIGHT\|(ready|candidate_requires_preparation)\|row_version=[0-9]+\|boundary=[0-9a-f]{32}$' }
    PrepareFixture { '^PASS\|REOPEN_FIXTURE\|prepared\|row_version=[0-9]+$' }
    Postflight { '^PASS\|REOPEN_POSTFLIGHT\|verification_pending_without_side_effects\|row_version=[0-9]+\|event_id=[0-9a-f-]+$' }
  }
  if ($exitCode -ne 0 -or @($lines | Where-Object { $_ -match $finalMarker }).Count -ne 1 -or
      @($lines | Where-Object { $_ -match '^(BLOCKED|FAIL)\|' }).Count -gt 0) {
    Stop-Blocked "$($Operation.ToLowerInvariant())_failed"
  }
} catch {
  Stop-Blocked "$($Operation.ToLowerInvariant())_failed"
}
