[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('SourceCheck', 'Preflight', 'ApplySuccess', 'CreateFixture', 'FixturePreflight', 'Postflight', 'EmergencyCleanup', 'PostCleanup')]
  [string]$Operation,
  [string]$RunId,
  [guid]$CaseId,
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
$scripts = @{
  Preflight = 'supabase/ops/phase2b_approve_paid_staging_preflight.sql'
  ApplySuccess = 'supabase/ops/phase2b_approve_paid_staging_apply.sql'
  CreateFixture = 'supabase/ops/phase2b_approve_paid_staging_fixture.sql'
  FixturePreflight = 'supabase/ops/phase2b_approve_paid_staging_fixture_preflight.sql'
  Postflight = 'supabase/ops/phase2b_approve_paid_staging_postflight.sql'
  EmergencyCleanup = 'supabase/ops/phase2b_approve_paid_staging_cleanup.sql'
  PostCleanup = 'supabase/ops/phase2b_approve_paid_staging_postcleanup.sql'
}
$expectedHash = @{
  'supabase/migrations/20261014000000_phase2b_approve_atomicity_fail_closed.sql' = '4AAF436A2B1694EA7A04583A9C2F5FA1516B6141C98FD11058300A11C61BE89F'
  'supabase/migrations/20261015000000_phase2b_approve_success_atomic.sql' = 'AEAC9A9EC31923C41A082C760C88D60095AA501975A6C624029D7B41CF7DABF1'
}

function Stop-Blocked([string]$reason) {
  Write-Output "BLOCKED|APPROVE_STAGING|$reason"
  exit 1
}

try {
  foreach ($relative in $expectedHash.Keys) {
    $path = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -cne $expectedHash[$relative]) {
      Stop-Blocked 'reviewed_migration_source_changed'
    }
  }
  foreach ($relative in $scripts.Values) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $relative) -PathType Leaf)) {
      Stop-Blocked 'package_file_missing'
    }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $root 'supabase/ops/phase2b_approve_paid_staging_boundary.sql') -PathType Leaf)) {
    Stop-Blocked 'package_file_missing'
  }
  if ($Operation -eq 'SourceCheck') {
    Write-Output 'PASS|APPROVE_STAGING|source_checked|password_prompts=0'
    exit 0
  }

  # A pooler username binds the project. Never accept a caller-supplied target.
  # Libpq hostaddr/service/password overrides could bypass that fixed tuple.
  foreach ($name in @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER',
      'PGPASSWORD', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS',
      'PGSSLMODE', 'PGREQUIRESSL', 'PGCHANNELBINDING', 'PGTARGETSESSIONATTRS')) {
    if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) {
      Stop-Blocked 'inherited_libpq_override'
    }
  }
  if ($Operation -in @('CreateFixture', 'FixturePreflight', 'Postflight', 'EmergencyCleanup', 'PostCleanup')) {
    if ($RunId -cnotmatch '^phase2b-approve-[0-9]{8}-[a-z0-9]{3,16}$') {
      Stop-Blocked 'run_id_invalid'
    }
  }
  if ($Operation -in @('FixturePreflight', 'Postflight', 'EmergencyCleanup', 'PostCleanup') -and $CaseId -eq [guid]::Empty) {
    Stop-Blocked 'case_id_required'
  }
  if ($Operation -eq 'Postflight' -and $ExpectedRowVersion -lt 1) {
    Stop-Blocked 'observed_row_version_required'
  }
  if ($Operation -eq 'Postflight' -and $Boundary -cnotmatch '^[0-9a-f]{32}$') {
    Stop-Blocked 'preaction_boundary_required'
  }
  $requiredConfirmation = switch ($Operation) {
    ApplySuccess { 'APPLY APPROVE SUCCESS TO STAGING' }
    CreateFixture { "CREATE SYNTHETIC APPROVE $RunId" }
    EmergencyCleanup { "ABANDON SYNTHETIC APPROVE $RunId $CaseId" }
    default { '' }
  }
  if ($requiredConfirmation -and $Confirmation -cne $requiredConfirmation) {
    Stop-Blocked 'separate_mutation_confirmation_required'
  }
  $psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
  $psql = if ($null -ne $psqlCommand) { $psqlCommand.Source } else { 'C:\Program Files\PostgreSQL\15\bin\psql.exe' }
  if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) {
    Stop-Blocked 'psql_unavailable'
  }
  $sqlFile = Join-Path $root $scripts[$Operation]
  $arguments = @('-X', '-W', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-v', "expected_project_ref=$projectRef", '-d', $connection)
  if ($RunId) { $arguments += @('-v', "fixture_run_id=$RunId") }
  if ($CaseId -ne [guid]::Empty) { $arguments += @('-v', "fixture_case_id=$CaseId") }
  if ($ExpectedRowVersion -ge 1) { $arguments += @('-v', "expected_row_version=$ExpectedRowVersion") }
  if ($Boundary) { $arguments += @('-v', "expected_boundary=$Boundary") }
  $arguments += @('-f', $sqlFile)

  # -W prompts in psql. No password is read by this wrapper or passed to a child.
  $lines = @(& $psql @arguments)
  $exitCode = $LASTEXITCODE
  foreach ($line in $lines) {
    if ($line -match '^(PASS|BLOCKED|FAIL)\|APPROVE_(STAGING|SUCCESS|PREFLIGHT|POSTFLIGHT)\|[a-z0-9_|=.-]+$') {
      Write-Output $line
    }
  }
  $finalMarker = switch ($Operation) {
    Preflight { '^PASS\|APPROVE_STAGING\|migration_(success_installed|predecessor_only)$' }
    ApplySuccess { '^PASS\|APPROVE_STAGING\|success_applied$' }
    CreateFixture { '^PASS\|APPROVE_PREFLIGHT\|ready\|row_version=[0-9]+\|boundary=[0-9a-f]{32}$' }
    FixturePreflight { '^PASS\|APPROVE_PREFLIGHT\|ready\|row_version=[0-9]+\|boundary=[0-9a-f]{32}$' }
    Postflight { '^PASS\|APPROVE_POSTFLIGHT\|approved_without_activation\|row_version=[0-9]+\|event_id=[0-9a-f-]+$' }
    EmergencyCleanup { '^PASS\|APPROVE_STAGING\|emergency_cleanup_done$' }
    PostCleanup { '^PASS\|APPROVE_STAGING\|postcleanup_absent$' }
  }
  if ($exitCode -ne 0 -or @($lines | Where-Object { $_ -match $finalMarker }).Count -ne 1 -or
      @($lines | Where-Object { $_ -match '^(BLOCKED|FAIL)\|' }).Count -gt 0) {
    Stop-Blocked "$($Operation.ToLowerInvariant())_failed"
  }
  if ($Operation -eq 'CreateFixture' -and
      @($lines | Where-Object { $_ -match '^PASS\|APPROVE_STAGING\|fixture_created\|case_id=[0-9a-f-]+\|row_version=[0-9]+$' }).Count -ne 1) {
    Stop-Blocked 'fixture_created_marker_missing'
  }
  if ($Operation -eq 'ApplySuccess' -and
      @($lines | Where-Object { $_ -ceq 'PASS|APPROVE_STAGING|migration_predecessor_only' }).Count -ne 1) {
    Stop-Blocked 'predecessor_only_marker_missing'
  }
  if ($Operation -in @('CreateFixture', 'FixturePreflight', 'Postflight', 'EmergencyCleanup', 'PostCleanup') -and
      @($lines | Where-Object { $_ -ceq 'PASS|APPROVE_STAGING|migration_success_installed' }).Count -lt 1) {
    Stop-Blocked 'success_install_marker_missing'
  }
} catch {
  Stop-Blocked "$($Operation.ToLowerInvariant())_failed"
}
