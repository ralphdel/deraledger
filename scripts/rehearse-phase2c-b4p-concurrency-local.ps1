[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^deraledger_phase2c_b4p_rehearsal_[a-z0-9_]+$')]
  [string]$LocalDatabase,

  [Parameter(Mandatory = $true)]
  [switch]$Execute,

  [Parameter(Mandatory = $true)]
  [ValidateSet('RUN_PHASE2C_B4P_LOCAL_CONCURRENCY')]
  [string]$Confirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$approvedHost = '127.0.0.1'
$approvedPort = '55432'
$approvedUser = 'postgres'
$approvedMajor = '15'
$expectedMigrationHash = '12CDC46047AF9F39A02C9D4AF330256BCD8C48654101F49C5C9940D69BC036CF'
$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20261023000000_phase2c_draft_compliance_profile_provisioning.sql'
$testRoot = Join-Path $repoRoot 'supabase\tests'
$setupPath = Join-Path $testRoot 'phase2c_b4p_concurrency_setup.sql'
$workerPath = Join-Path $testRoot 'phase2c_b4p_concurrency_worker.sql'
$verifyPath = Join-Path $testRoot 'phase2c_b4p_concurrency_verify.sql'
$cleanupPath = Join-Path $testRoot 'phase2c_b4p_concurrency_cleanup.sql'
$timeoutMs = 45000

if (-not $Execute -or $Confirmation -ne 'RUN_PHASE2C_B4P_LOCAL_CONCURRENCY') {
  throw 'B4P_LOCAL_REHEARSAL_CONFIRMATION_REQUIRED'
}

if ($LocalDatabase -in @('postgres', 'template0', 'template1')) {
  throw 'B4P_LOCAL_REHEARSAL_DATABASE_REJECTED'
}

$actualMigrationHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualMigrationHash -ne $expectedMigrationHash) {
  throw 'B4P_LOCAL_REHEARSAL_MIGRATION_HASH_MISMATCH'
}

$psqlPath = Join-Path $env:ProgramFiles 'PostgreSQL\15\bin\psql.exe'
if (-not (Test-Path -LiteralPath $psqlPath -PathType Leaf)) {
  throw 'B4P_LOCAL_REHEARSAL_PSQL15_NOT_FOUND'
}

function ConvertTo-B4pWindowsCommandLineArgument {
  param([Parameter(Mandatory = $true)][string]$Value)

  if ($Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }

  # Windows CreateProcess argument escaping: preserve literal quotes and all
  # backslashes immediately preceding a quote or closing delimiter.
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append([char]34)
  $backslashCount = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq [char]92) {
      $backslashCount += 1
      continue
    }
    if ($character -eq [char]34) {
      [void]$builder.Append([char]92, ($backslashCount * 2) + 1)
      [void]$builder.Append([char]34)
      $backslashCount = 0
      continue
    }
    if ($backslashCount -gt 0) {
      [void]$builder.Append([char]92, $backslashCount)
      $backslashCount = 0
    }
    [void]$builder.Append($character)
  }
  if ($backslashCount -gt 0) {
    [void]$builder.Append([char]92, $backslashCount * 2)
  }
  [void]$builder.Append([char]34)
  return $builder.ToString()
}

function Start-B4pNativeProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [string[]]$RemoveEnvironmentVariables = @(),
    [hashtable]$SetEnvironmentVariables = @{}
  )

  if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw 'B4P_LOCAL_REHEARSAL_PROCESS_EXECUTABLE_NOT_FOUND'
  }
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = (($Arguments | ForEach-Object {
    ConvertTo-B4pWindowsCommandLineArgument -Value $_
  }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.CreateNoWindow = $true
  $startInfo.WorkingDirectory = $WorkingDirectory

  foreach ($name in $RemoveEnvironmentVariables) {
    [void]$startInfo.EnvironmentVariables.Remove($name)
  }
  foreach ($name in $SetEnvironmentVariables.Keys) {
    $startInfo.EnvironmentVariables[$name] = [string]$SetEnvironmentVariables[$name]
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'B4P_LOCAL_REHEARSAL_PROCESS_START_FAILED'
  }

  [pscustomobject]@{
    Process = $process
    Stdin = $process.StandardInput
    Stdout = $process.StandardOutput.ReadToEndAsync()
    Stderr = $process.StandardError.ReadToEndAsync()
  }
}

function Stop-B4pProcessTree {
  param([Parameter(Mandatory = $true)]$Process)

  if ($Process.HasExited) { return }
  $taskKillPath = Join-Path $env:SystemRoot 'System32\taskkill.exe'
  try {
    if (Test-Path -LiteralPath $taskKillPath -PathType Leaf) {
      $taskKillInfo = [System.Diagnostics.ProcessStartInfo]::new()
      $taskKillInfo.FileName = $taskKillPath
      $taskKillInfo.Arguments = "/PID $($Process.Id) /T /F"
      $taskKillInfo.UseShellExecute = $false
      $taskKillInfo.CreateNoWindow = $true
      $taskKill = [System.Diagnostics.Process]::Start($taskKillInfo)
      [void]$taskKill.WaitForExit(5000)
      $taskKill.Dispose()
    }
  }
  catch { }
  if (-not $Process.HasExited) {
    try { $Process.Kill() } catch { }
  }
}

function Start-B4pPsql {
  param(
    [AllowEmptyCollection()]
    [string[]]$AdditionalArguments = @()
  )

  $arguments = @('-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', $approvedHost, '-p', $approvedPort, '-U', $approvedUser, '-d', $LocalDatabase) + $AdditionalArguments
  return Start-B4pNativeProcess -FilePath $psqlPath -Arguments $arguments -WorkingDirectory $repoRoot `
    -RemoveEnvironmentVariables @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGCONNECT_TIMEOUT') `
    -SetEnvironmentVariables @{ PGSSLMODE = 'disable' }
}

function Complete-B4pPsql {
  param(
    [Parameter(Mandatory = $true)]$Handle,
    [int]$TimeoutMilliseconds = $timeoutMs
  )

  if (-not $Handle.Process.WaitForExit($TimeoutMilliseconds)) {
    Stop-B4pProcessTree -Process $Handle.Process
    [void]$Handle.Process.WaitForExit(5000)
    throw 'B4P_LOCAL_REHEARSAL_PROCESS_TIMEOUT'
  }

  $stdout = $Handle.Stdout.GetAwaiter().GetResult()
  $stderr = $Handle.Stderr.GetAwaiter().GetResult()
  $exitCode = $Handle.Process.ExitCode
  $Handle.Process.Dispose()

  if ($exitCode -ne 0) {
    $safeError = (($stderr -split "`r?`n") | Where-Object { $_ -match '^(psql:|ERROR:)' } | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($safeError)) { $safeError = 'psql returned a non-zero exit' }
    throw "B4P_LOCAL_REHEARSAL_PSQL_FAILED:EXIT_CODE:$exitCode|DETAIL:$safeError"
  }

  [pscustomobject]@{ Stdout = $stdout; Stderr = $stderr }
}

function Invoke-B4pPsql {
  param([Parameter(Mandatory = $true)][string[]]$AdditionalArguments)
  Complete-B4pPsql -Handle (Start-B4pPsql -AdditionalArguments $AdditionalArguments)
}

function Wait-B4pControl {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [Parameter(Mandatory = $true)][string]$Expected
  )

  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    $result = Invoke-B4pPsql -AdditionalArguments @('-c', $Sql)
    $lines = @($result.Stdout -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($lines.Count -eq 1 -and $lines[0] -eq $Expected) { return }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)

  throw 'B4P_LOCAL_REHEARSAL_COORDINATION_TIMEOUT'
}

$setupCompleted = $false
$coordinator = $null
$workerA = $null
$workerB = $null
try {
  $identitySql = "SELECT 'CONTROL|' || current_database() || '|' || session_user || '|' || current_setting('server_version_num') || '|' || host(inet_server_addr()) || '|' || inet_server_port();"
  $identity = Invoke-B4pPsql -AdditionalArguments @('-c', $identitySql)
  $identityLines = @($identity.Stdout -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($identityLines.Count -ne 1 -or $identityLines[0] -notmatch '^CONTROL\|([^|]+)\|postgres\|(15[0-9]{4})\|127\.0\.0\.1\|55432$') {
    throw 'B4P_LOCAL_REHEARSAL_TARGET_IDENTITY_REJECTED'
  }
  if ($Matches[1] -ne $LocalDatabase -or -not $Matches[2].StartsWith($approvedMajor)) {
    throw 'B4P_LOCAL_REHEARSAL_TARGET_IDENTITY_REJECTED'
  }

  [void](Invoke-B4pPsql -AdditionalArguments @('-f', $setupPath))
  $setupCompleted = $true

  $coordinator = Start-B4pPsql -AdditionalArguments @()
  $coordinator.Stdin.WriteLine("SELECT set_config('application_name', 'phase2c_b4p_coordinator', false);")
  $coordinator.Stdin.WriteLine('SELECT pg_advisory_lock(20261023, 5);')
  $coordinator.Stdin.Flush()
  $coordinatorReadySql = @"
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM pg_stat_activity activity
  JOIN pg_locks lock_state ON lock_state.pid = activity.pid
  WHERE activity.application_name = 'phase2c_b4p_coordinator'
    AND lock_state.locktype = 'advisory'
    AND lock_state.classid = 20261023
    AND lock_state.objid = 5
    AND lock_state.granted
) THEN 'CONTROL|COORDINATOR_READY' ELSE 'CONTROL|WAIT' END;
"@
  Wait-B4pControl -Sql $coordinatorReadySql -Expected 'CONTROL|COORDINATOR_READY'

  $workerA = Start-B4pPsql -AdditionalArguments @('-v', 'worker=A', '-f', $workerPath)
  $workerAReadySql = @"
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pg_stat_activity worker_a
  JOIN pg_stat_activity coordinator
    ON coordinator.pid = ANY(pg_blocking_pids(worker_a.pid))
  WHERE worker_a.application_name = 'phase2c_b4p_worker_a'
    AND coordinator.application_name = 'phase2c_b4p_coordinator'
    AND worker_a.wait_event_type = 'Lock'
    AND EXISTS (
      SELECT 1 FROM pg_locks marker
      WHERE marker.pid = worker_a.pid
        AND marker.locktype = 'advisory'
        AND marker.classid = 20261023
        AND marker.objid = 4
        AND marker.granted
    )
) THEN 'CONTROL|WORKER_A_READY' ELSE 'CONTROL|WAIT' END;
"@
  Wait-B4pControl -Sql $workerAReadySql -Expected 'CONTROL|WORKER_A_READY'

  $workerB = Start-B4pPsql -AdditionalArguments @('-v', 'worker=B', '-f', $workerPath)
  $workerBBlockedSql = @"
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM pg_stat_activity blocked
  JOIN pg_stat_activity blocker
    ON blocker.pid = ANY(pg_blocking_pids(blocked.pid))
  WHERE blocked.application_name = 'phase2c_b4p_worker_b'
    AND blocker.application_name = 'phase2c_b4p_worker_a'
    AND blocked.wait_event_type = 'Lock'
) THEN 'CONTROL|OVERLAP_PROVEN' ELSE 'CONTROL|WAIT' END;
"@
  Wait-B4pControl -Sql $workerBBlockedSql -Expected 'CONTROL|OVERLAP_PROVEN'

  $releaseSql = @"
UPDATE phase2c_b4p_rehearsal.barrier
SET worker_a_ready_observed = true,
    worker_b_blocked_observed = true,
    release_worker_a = true,
    released_at = clock_timestamp()
WHERE singleton;
"@
  [void](Invoke-B4pPsql -AdditionalArguments @('-c', $releaseSql))

  $coordinator.Stdin.WriteLine('SELECT pg_advisory_unlock(20261023, 5);')
  $coordinator.Stdin.WriteLine('\q')
  $coordinator.Stdin.Close()
  [void](Complete-B4pPsql -Handle $coordinator)
  $coordinator = $null

  [void](Complete-B4pPsql -Handle $workerA)
  $workerA = $null
  [void](Complete-B4pPsql -Handle $workerB)
  $workerB = $null

  $verification = Invoke-B4pPsql -AdditionalArguments @('-F', '|', '-f', $verifyPath)
  $verificationLines = @($verification.Stdout -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($verificationLines.Count -ne 1 -or $verificationLines[0] -notmatch '^M031_CONCURRENCY\|PASS\|') {
    throw 'B4P_LOCAL_REHEARSAL_VERIFICATION_FAILED'
  }

  Write-Output 'PHASE2C_B4P_CONCURRENCY_REHEARSAL=PASS'
}
finally {
  foreach ($handle in @($coordinator, $workerA, $workerB)) {
    if ($null -ne $handle -and -not $handle.Process.HasExited) {
      Stop-B4pProcessTree -Process $handle.Process
      [void]$handle.Process.WaitForExit(5000)
      $handle.Process.Dispose()
    }
  }
  if ($setupCompleted) {
    try { [void](Invoke-B4pPsql -AdditionalArguments @('-f', $cleanupPath)) } catch {
      Write-Error 'B4P_LOCAL_REHEARSAL_CLEANUP_FAILED'
    }
  }
}
