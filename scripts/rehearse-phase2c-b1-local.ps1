[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedPsql = 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
$DbHost = '127.0.0.1'
$DbPort = '55432'
$DbUser = 'postgres'
$MaintenanceDatabase = 'postgres'
$DatabasePrefix = 'deraledger_phase2c_b1_rehearsal_'
$ExpectedBranch = 'staging/phase-2-rebuild-safe-baseline'
$ExpectedHead = '38c3849'
$PgEnvironmentNames = @('PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS','PGSSLMODE')
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$MigrationPath = Join-Path $RepoRoot 'supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql'
$SourceContractPath = Join-Path $RepoRoot 'tests/phase2c-nonadopted-review-substrate.test.ts'
$ExpectedMigrationSha256 = '49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528'
$ExpectedSourceContractSha256 = '744C8E1E3311B46D649F2F4E9DD835F24370C6368DF8B5D599FD3C3E06644616'
$SqlRoot = Join-Path $PSScriptRoot 'phase2c-b1-local'
$Timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$RandomSuffix = ([Guid]::NewGuid().ToString('N')).Substring(0,8)
$DatabaseName = "$DatabasePrefix$($Timestamp.ToLowerInvariant())_$RandomSuffix"
$EvidenceRoot = Join-Path $RepoRoot ".local-evidence/phase2c-b1/$Timestamp"
$Logs = @{
  Environment = Join-Path $EvidenceRoot '00-environment.txt'; Bootstrap = Join-Path $EvidenceRoot '01-bootstrap.txt'
  Apply = Join-Path $EvidenceRoot '02-apply.txt'; Postflight = Join-Path $EvidenceRoot '03-postflight.txt'
  Behavior = Join-Path $EvidenceRoot '04-behavior.txt'; Concurrency = Join-Path $EvidenceRoot '05-concurrency.txt'
  Mixed = Join-Path $EvidenceRoot '06-mixed-writer.txt'; Cleanup = Join-Path $EvidenceRoot '07-cleanup.txt'
  Summary = Join-Path $EvidenceRoot 'summary.txt'
}
$SavedPgEnvironment = @{}
$DatabaseCreated = $false
$SecurePassword = $null
$PasswordBstr = [IntPtr]::Zero
$PlainPassword = $null
$OverallPassed = $false
$ActivePairHandles = [System.Collections.Generic.List[object]]::new()

function Add-Summary([string]$Kind,[string]$Message) {
  $line = "$Kind|$Message"
  [IO.File]::AppendAllText($Logs.Summary, $line + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  if ($Kind -ne 'PASS') { Write-Host $line }
}

function Add-PhaseLog([string]$Path,[string]$Message) {
  [IO.File]::AppendAllText($Path,$Message + [Environment]::NewLine,[Text.UTF8Encoding]::new($false))
}

function Quote-NativeArgument([string]$Value) {
  if ($Value -match '[\x00\r\n"]') { throw 'HARNESS_UNSAFE_NATIVE_ARGUMENT' }
  return '"' + $Value + '"'
}

function Start-PsqlProcess([string]$Database,[string[]]$ExtraArguments) {
  $all = @('-X','-w','-v','ON_ERROR_STOP=1','-h',$DbHost,'-p',$DbPort,'-U',$DbUser,'-d',$Database) + $ExtraArguments
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $ExpectedPsql
  $start.Arguments = (($all | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join ' ')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  if (-not $process.Start()) { throw 'HARNESS_PSQL_START_FAILED' }
  [pscustomobject]@{ Process=$process; Stdout=$process.StandardOutput.ReadToEndAsync(); Stderr=$process.StandardError.ReadToEndAsync() }
}

function Complete-PsqlProcess($Handle,[string]$LogPath,[int]$TimeoutSeconds=60,[switch]$Append) {
  if (-not $Handle.Process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $Handle.Process.Kill() } catch {}
    throw 'HARNESS_PSQL_TIMEOUT'
  }
  $stdout = $Handle.Stdout.GetAwaiter().GetResult()
  $stderr = $Handle.Stderr.GetAwaiter().GetResult()
  $text = "EXIT_CODE=$($Handle.Process.ExitCode)`r`nSTDOUT`r`n$stdout`r`nSTDERR`r`n$stderr`r`n"
  if ($Append) { [IO.File]::AppendAllText($LogPath,$text,[Text.UTF8Encoding]::new($false)) }
  else { [IO.File]::WriteAllText($LogPath,$text,[Text.UTF8Encoding]::new($false)) }
  [pscustomobject]@{ ExitCode=$Handle.Process.ExitCode; Stdout=$stdout; Stderr=$stderr }
}

function Invoke-Psql([string]$Database,[string]$LogPath,[string[]]$ExtraArguments,[switch]$AllowFailure,[switch]$Append) {
  $result = Complete-PsqlProcess (Start-PsqlProcess $Database $ExtraArguments) $LogPath 90 -Append:$Append
  if (-not $AllowFailure -and $result.ExitCode -ne 0) { throw "HARNESS_PSQL_FAILED:$([IO.Path]::GetFileName($LogPath))" }
  return $result
}

function Test-BarrierReleaseResult($Result,[string]$Scenario) {
  if ($null -eq $Result -or $Result -is [array] -or $Result.ExitCode -ne 0) { return $false }
  if (-not [string]::IsNullOrWhiteSpace([string]$Result.Stderr)) { return $false }
  $lines = @(([string]$Result.Stdout -split '\r?\n') | Where-Object { $_ -cne '' })
  return $lines.Count -eq 2 -and $lines[0] -ceq $Scenario -and $lines[1] -ceq 'UPDATE 1'
}

function Get-InstalledStateFingerprint([string]$FailureCode) {
  $fingerprintPath = Join-Path $SqlRoot '01-installed-state-fingerprint.sql'
  $result = Invoke-Psql $DatabaseName $Logs.Apply @('-At','-f',$fingerprintPath) -AllowFailure -Append
  if ($result.ExitCode -ne 0 -or $result.Stdout -notmatch '^B1_FINGERPRINT\|[0-9a-f]{64}\s*$') {
    throw $FailureCode
  }
  return $result.Stdout.Trim()
}

function Get-WorkerError([string]$Stderr) {
  $bounded = ($Stderr -replace '[\r\n]+',' ' -replace '[^\x20-\x7E]','?').Trim()
  if ($bounded.Length -gt 500) { return $bounded.Substring(0,500) }
  if ($bounded.Length -eq 0) { return '<empty>' }
  return $bounded
}

function Get-SessionPid([string]$LogPath,[string]$ApplicationName) {
  if ($ApplicationName -cnotmatch '^phase2c_b1_[a-z_-]+$') { throw 'HARNESS_READY_NAME_REJECTED' }
  $sql = "SELECT COALESCE((SELECT pid::text FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name='$ApplicationName' ORDER BY pid LIMIT 1),'WAIT')"
  return (Invoke-Psql $DatabaseName $LogPath @('-At','-c',$sql) -Append).Stdout.Trim()
}

function Get-BlockingProof([string]$LogPath,[string]$ReadyApplicationName,[string]$WorkerBApplicationName) {
  foreach ($name in @($ReadyApplicationName,$WorkerBApplicationName)) {
    if ($name -cnotmatch '^phase2c_b1_[a-z_-]+$') { throw 'HARNESS_BLOCKING_NAME_REJECTED' }
  }
  # Each probe uses a new PostgreSQL connection, so pg_stat_activity has a fresh snapshot.
  $sql = "SELECT COALESCE((SELECT 'BLOCKED|'||a.pid||'|'||b.pid FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_stat_activity b ON a.datname=b.datname WHERE a.datname=current_database() AND a.application_name='$ReadyApplicationName' AND b.application_name='$WorkerBApplicationName' AND b.query LIKE '%submit_draft_plan_review_v1%' AND b.wait_event_type='Lock' AND a.pid=ANY(pg_catalog.pg_blocking_pids(b.pid)) LIMIT 1),'WAIT')"
  return (Invoke-Psql $DatabaseName $LogPath @('-At','-c',$sql) -Append).Stdout.Trim()
}

function Release-RehearsalBarrier([string]$Scenario,[string]$LogPath) {
  if ($Scenario -cnotin @('identical','changed','different','mixed_writer')) { throw 'HARNESS_BARRIER_NAME_REJECTED' }
  $sql = "UPDATE public.phase2c_b1_rehearsal_barriers SET released=true WHERE scenario='$Scenario' RETURNING scenario"
  $result = Invoke-Psql $DatabaseName $LogPath @('-At','-c',$sql) -AllowFailure -Append
  if (-not (Test-BarrierReleaseResult $result $Scenario)) { throw "HARNESS_BARRIER_RELEASE_FAILED:$Scenario" }
  Add-PhaseLog $LogPath "BARRIER_RELEASED|$Scenario"
}

function Invoke-PsqlPair([string]$LogPath,[string]$Scenario,[string[]]$ArgsA,[string[]]$ArgsB,[string]$ReadyApplicationName,[string]$WorkerBApplicationName) {
  $a = $null; $b = $null; $ra = $null; $rb = $null
  $milestone = 'SCENARIO_START'
  Add-PhaseLog $LogPath "SCENARIO_START|$Scenario"
  try {
    $a = Start-PsqlProcess $DatabaseName $ArgsA
    $ActivePairHandles.Add($a)
    $milestone = 'WORKER_A_STARTED'
    Add-PhaseLog $LogPath "WORKER_A_STARTED|$Scenario"
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    $readyPid = 'WAIT'
    while ($deadline.Elapsed.TotalSeconds -lt 15) {
      if ($a.Process.HasExited) {
        $ra = Complete-PsqlProcess $a $LogPath 5 -Append
        [void]$ActivePairHandles.Remove($a)
        throw "HARNESS_WORKER_A_EXITED_BEFORE_LOCK_READY:$Scenario`:worker_a_exit=$($ra.ExitCode):worker_b_exit=not_started:stderr=$(Get-WorkerError $ra.Stderr):milestone=$milestone"
      }
      $readyPid = Get-SessionPid $LogPath $ReadyApplicationName
      if ($readyPid -match '^[0-9]+$') { break }
      if ($readyPid -cne 'WAIT') { throw "HARNESS_READY_PROBE_INVALID:$Scenario" }
      Start-Sleep -Milliseconds 100
    }
    if ($readyPid -notmatch '^[0-9]+$') { throw "HARNESS_FIRST_WORKER_LOCK_NOT_READY:$Scenario`:milestone=$milestone" }
    $milestone = 'WORKER_A_LOCK_READY'
    Add-PhaseLog $LogPath "WORKER_A_LOCK_READY|$Scenario|$readyPid"
    $b = Start-PsqlProcess $DatabaseName $ArgsB
    $ActivePairHandles.Add($b)
    $milestone = 'WORKER_B_STARTED'
    Add-PhaseLog $LogPath "WORKER_B_STARTED|$Scenario"
    $deadline.Restart()
    $proof = 'WAIT'
    while ($deadline.Elapsed.TotalSeconds -lt 15) {
      if ($a.Process.HasExited -or $b.Process.HasExited) { break }
      $proof = Get-BlockingProof $LogPath $ReadyApplicationName $WorkerBApplicationName
      if ($proof -match "^BLOCKED\|$readyPid\|[0-9]+$") { break }
      if ($proof -cne 'WAIT') { throw "HARNESS_BLOCKING_PROBE_INVALID:$Scenario" }
      Start-Sleep -Milliseconds 100
    }
    if ($proof -notmatch "^BLOCKED\|$readyPid\|[0-9]+$") {
      throw "HARNESS_BLOCKING_NOT_PROVEN:$Scenario`:milestone=$milestone`:worker_a_exited=$($a.Process.HasExited):worker_b_exited=$($b.Process.HasExited)"
    }
    $milestone = 'BLOCKING_PROVEN'
    Add-PhaseLog $LogPath "BLOCKING_PROVEN|$Scenario|$proof"
    if ($Scenario -ceq 'mixed_writer') { Add-PhaseLog $LogPath 'MIXED_B_BLOCKED_BY_A' }
    Release-RehearsalBarrier $Scenario $LogPath
    $ra = Complete-PsqlProcess $a $LogPath 60 -Append
    [void]$ActivePairHandles.Remove($a)
    $rb = Complete-PsqlProcess $b $LogPath 60 -Append
    [void]$ActivePairHandles.Remove($b)
    $milestone = 'WORKERS_COMPLETED'
    Add-PhaseLog $LogPath "WORKER_A_RESULT|$Scenario|exit=$($ra.ExitCode)|stderr=$(Get-WorkerError $ra.Stderr)"
    Add-PhaseLog $LogPath "WORKER_B_RESULT|$Scenario|exit=$($rb.ExitCode)|stderr=$(Get-WorkerError $rb.Stderr)"
    if ($ra.ExitCode -ne 0 -or $rb.ExitCode -ne 0) {
      throw "HARNESS_CONCURRENT_PSQL_FAILED:$Scenario`:worker_a_exit=$($ra.ExitCode):worker_b_exit=$($rb.ExitCode):worker_a_stderr=$(Get-WorkerError $ra.Stderr):worker_b_stderr=$(Get-WorkerError $rb.Stderr):milestone=$milestone"
    }
    $aMarker = if ($Scenario -ceq 'mixed_writer') {
      "(?m)^MILESTONE\|mixed_writer\|profile_locked\|$readyPid\r?$"
    } else {
      "(?m)^B1_WORKER_LOCK_READY\|$([regex]::Escape($Scenario))\|a\|$readyPid\r?$"
    }
    $blockedBackendPid = ($proof -split '\|')[2]
    $bMarker = "(?m)^B1_WORKER_LOCK_READY\|$([regex]::Escape($Scenario))\|b\|$blockedBackendPid\r?$"
    if ($ra.Stdout -notmatch $aMarker -or $rb.Stdout -notmatch $bMarker) {
      throw "HARNESS_BACKEND_PID_MISMATCH:$Scenario"
    }
    Add-PhaseLog $LogPath "BACKEND_PIDS_VERIFIED|$Scenario|a=$readyPid|b=$blockedBackendPid"
    return @($ra.Stdout,$rb.Stdout)
  } catch {
    $failure = $_
    $terminationClass = @{ a=$null; b=$null }
    foreach ($workerName in @('a','b')) {
      $handle = if ($workerName -ceq 'a') { $a } else { $b }
      $alreadyCompleted = if ($workerName -ceq 'a') { $null -ne $ra } else { $null -ne $rb }
      if ($null -ne $handle -and -not $alreadyCompleted) {
        try {
          $terminatedByHarness = -not $handle.Process.HasExited
          if ($terminatedByHarness) { $handle.Process.Kill(); [void]$handle.Process.WaitForExit(5000) }
          $stopped = Complete-PsqlProcess $handle $LogPath 5 -Append
          [void]$ActivePairHandles.Remove($handle)
          if ($workerName -ceq 'a') { $ra = $stopped } else { $rb = $stopped }
          if ($terminatedByHarness) {
            $terminationClass[$workerName] = 'HARNESS_TERMINATED'
            Add-PhaseLog $LogPath "WORKER_TERMINATED_BY_HARNESS|$Scenario|worker=$workerName|classification=HARNESS_TERMINATED|native_exit=$($stopped.ExitCode)|stderr=$(Get-WorkerError $stopped.Stderr)"
          } else {
            $terminationClass[$workerName] = 'NATURAL_EXIT'
            Add-PhaseLog $LogPath "WORKER_EXITED_BEFORE_FAILURE_CLEANUP|$Scenario|worker=$workerName|classification=NATURAL_EXIT|native_exit=$($stopped.ExitCode)|stderr=$(Get-WorkerError $stopped.Stderr)"
          }
        } catch { Add-PhaseLog $LogPath "WORKER_STOP_FAILED|$Scenario|worker=$workerName" }
      }
    }
    $aExit = if ($terminationClass.a -ceq 'HARNESS_TERMINATED') { "HARNESS_TERMINATED(native_exit=$($ra.ExitCode))" } elseif ($null -eq $ra) { '<not_started_or_unavailable>' } else { [string]$ra.ExitCode }
    $bExit = if ($terminationClass.b -ceq 'HARNESS_TERMINATED') { "HARNESS_TERMINATED(native_exit=$($rb.ExitCode))" } elseif ($null -eq $rb) { '<not_started_or_unavailable>' } else { [string]$rb.ExitCode }
    $aError = if ($null -eq $ra) { '<unavailable>' } else { Get-WorkerError $ra.Stderr }
    $bError = if ($null -eq $rb) { '<unavailable>' } else { Get-WorkerError $rb.Stderr }
    Add-PhaseLog $LogPath "SCENARIO_FAILED|$Scenario|milestone=$milestone|worker_a_exit=$aExit|worker_b_exit=$bExit|worker_a_stderr=$aError|worker_b_stderr=$bError|reason=$($failure.Exception.Message)"
    throw $failure
  }
}

function Get-WorkerKind([string]$Output,[string]$Scenario,[string]$Worker) {
  $resultMatches = [regex]::Matches($Output, "(?m)^B1_WORKER_RESULT\|$([regex]::Escape($Scenario))\|$([regex]::Escape($Worker))\|([a-z_]+)\r?$")
  if ($resultMatches.Count -ne 1) { return '<missing_or_duplicate>' }
  return $resultMatches[0].Groups[1].Value
}

function Assert-RacePair([string]$Scenario,[string[]]$Outputs,[string]$LoserKind,[int]$MerchantNumber) {
  $kindA = Get-WorkerKind $Outputs[0] $Scenario 'a'
  $kindB = Get-WorkerKind $Outputs[1] $Scenario 'b'
  if (@($kindA,$kindB) -notcontains 'applied' -or
      @($kindA,$kindB) -notcontains $LoserKind) {
    throw ('HARNESS_RACE_MISMATCH:{0}:expected=applied,{1}:worker_a={2}:worker_b={3}' -f
      $Scenario,$LoserKind,$kindA,$kindB)
  }
  $merchantId = '20000000-0000-4000-8000-' + $MerchantNumber.ToString().PadLeft(12,'0')
  $countSql = "SELECT (SELECT count(*) FROM public.merchant_compliance_reviews WHERE merchant_id='$merchantId')::text||'|'||(SELECT count(*) FROM public.merchant_compliance_events WHERE merchant_id='$merchantId' AND event_type='phase2c_draft_review_submit_v1')::text"
  $counts = (Invoke-Psql $DatabaseName $Logs.Concurrency @('-At','-c',$countSql) -Append).Stdout.Trim()
  if ($counts -cne '1|1') { throw "HARNESS_RACE_PERSISTENCE_MISMATCH:$Scenario`:counts=$counts" }
  Add-PhaseLog $Logs.Concurrency "WORKER_A_RESULT|$Scenario|$kindA"
  Add-PhaseLog $Logs.Concurrency "WORKER_B_RESULT|$Scenario|$kindB"
  Add-PhaseLog $Logs.Concurrency "STATE_COUNTS_OK|$Scenario|reviews=1|events=1"
  Add-PhaseLog $Logs.Concurrency "SCENARIO_PASS|$Scenario"
}

function WorkerArgs([string]$Scenario,[string]$Worker,[int]$Number,[string]$Key,[string]$PolicyId,[string]$Status,[string]$Reason,[string]$At,[int]$WaitForRelease) {
  $suffix = $Number.ToString().PadLeft(12,'0')
  $label = "$Scenario-$Worker"
  @('-At','-q','-v',"label=$label",'-v',"scenario=$Scenario",'-v',"worker=$Worker",'-v',"merchant_id=20000000-0000-4000-8000-$suffix",'-v',"workspace_id=30000000-0000-4000-8000-$suffix",
    '-v',"actor_id=10000000-0000-4000-8000-$suffix",'-v',"idempotency_key=$Key",'-v',"policy_id=$PolicyId",
    '-v',"finding_status=$Status",'-v',"reason_code=$Reason",'-v',"evaluated_at=$At",'-v',"wait_for_release=$WaitForRelease",
    '-f',(Join-Path $SqlRoot '03-concurrency-worker.sql'))
}

function Test-LocalMaintenanceIdentity([string]$Identity) {
  $parts = $Identity.Trim() -split '\|'
  if ($parts.Count -ne 5) { return $false }
  return $parts[0] -ceq 'postgres' -and $parts[1] -ceq 'postgres' -and $parts[2] -match '^15\d{4}$' -and
    $parts[3] -match '^127\.0\.0\.1(?:/32)?$' -and $parts[4] -ceq '55432'
}

try {
  New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
  [IO.File]::WriteAllText($Logs.Summary,"",[Text.UTF8Encoding]::new($false))
  if ($DbHost -notin @('127.0.0.1','localhost') -or $DbPort -ne '55432') { throw 'HARNESS_NONLOCAL_TARGET_REJECTED' }
  if ($ExpectedPsql -ne 'C:\Program Files\PostgreSQL\15\bin\psql.exe' -or -not (Test-Path -LiteralPath $ExpectedPsql -PathType Leaf)) { throw 'HARNESS_PSQL_PATH_REJECTED' }
  if ($DatabaseName -notmatch '^deraledger_phase2c_b1_rehearsal_[a-z0-9_]+$') { throw 'HARNESS_DATABASE_NAME_REJECTED' }
  if ($DatabaseName -in @('postgres','template0','template1')) { throw 'HARNESS_PROTECTED_DATABASE_REJECTED' }
  $branch = (& git -C $RepoRoot branch --show-current).Trim()
  $head = (& git -C $RepoRoot rev-parse --short=7 HEAD).Trim()
  if ($branch -cne $ExpectedBranch -or $head -cne $ExpectedHead) { throw 'HARNESS_REPOSITORY_GATE_REJECTED' }
  foreach ($required in @($MigrationPath,$SourceContractPath,(Join-Path $SqlRoot '00-bootstrap.sql'),(Join-Path $SqlRoot '01-postflight.sql'),(Join-Path $SqlRoot '01-installed-state-fingerprint.sql'),(Join-Path $SqlRoot '02-behavior.sql'),(Join-Path $SqlRoot '03-concurrency-worker.sql'),(Join-Path $SqlRoot '04-mixed-writer.sql'),(Join-Path $SqlRoot '05-final.sql'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "HARNESS_REQUIRED_SOURCE_MISSING:$required" }
  }
  $migrationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $MigrationPath).Hash
  $contractHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $SourceContractPath).Hash
  if ($migrationHash -cne $ExpectedMigrationSha256 -or $contractHash -cne $ExpectedSourceContractSha256) { throw 'HARNESS_APPROVED_SOURCE_HASH_REJECTED' }
  foreach ($name in $PgEnvironmentNames) { $SavedPgEnvironment[$name]=[Environment]::GetEnvironmentVariable($name,'Process'); [Environment]::SetEnvironmentVariable($name,$null,'Process') }
  $environmentText = @("host=$DbHost","port=$DbPort","maintenance_database=$MaintenanceDatabase","user=$DbUser","psql=$ExpectedPsql","branch=$branch","head=$head","disposable_database=$DatabaseName","migration_sha256=$migrationHash","source_contract_sha256=$contractHash") -join [Environment]::NewLine
  [IO.File]::WriteAllText($Logs.Environment,$environmentText+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  Add-Summary PASS 'preflight_source_and_target_guards'

  $SecurePassword = Read-Host 'Local PostgreSQL password (used in memory only)' -AsSecureString
  $PasswordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
  $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordBstr)
  [Environment]::SetEnvironmentVariable('PGPASSWORD',$PlainPassword,'Process')

  $identity = Invoke-Psql $MaintenanceDatabase $Logs.Environment @('-At','-c',"SELECT current_database()||'|'||current_user||'|'||current_setting('server_version_num')||'|'||inet_server_addr()||'|'||inet_server_port()") -Append
  if (-not (Test-LocalMaintenanceIdentity $identity.Stdout)) { throw 'HARNESS_DATABASE_IDENTITY_REJECTED' }
  Invoke-Psql $MaintenanceDatabase $Logs.Bootstrap @('-c',"CREATE DATABASE $DatabaseName") | Out-Null
  $DatabaseCreated = $true
  Invoke-Psql $DatabaseName $Logs.Bootstrap @('-f',(Join-Path $SqlRoot '00-bootstrap.sql')) -Append | Out-Null
  Add-Summary PASS 'disposable_database_and_exact_prerequisites'

  $firstApply = Invoke-Psql $DatabaseName $Logs.Apply @('-f',$MigrationPath)
  if ($firstApply.Stdout -notmatch '(?m)^COMMIT\s*$') { throw 'HARNESS_FIRST_APPLY_COMMIT_MISSING' }
  Add-Summary PASS 'first_migration_apply_committed'
  Invoke-Psql $DatabaseName $Logs.Postflight @('-f',(Join-Path $SqlRoot '01-postflight.sql')) | Out-Null
  $preRerunFingerprint = Get-InstalledStateFingerprint 'HARNESS_INSTALLED_STATE_PRE_FINGERPRINT_INVALID'
  $rerun = Invoke-Psql $DatabaseName $Logs.Apply @('-f',$MigrationPath) -AllowFailure -Append
  $expectedRerunStdout = '^BEGIN\r?\nSET\r?\nSET\r?\nSET\s*$'
  $expectedRerunError = '(?s)^psql:[^\r\n]*20261021000000_phase2c_nonadopted_review_substrate\.sql:175:\s*ERROR:\s+Phase 2C review substrate security prerequisite incompatible\r?\nCONTEXT:\s*PL/pgSQL function inline_code_block line 116 at RAISE\s*$'
  if ($rerun.ExitCode -ne 3 -or $rerun.Stdout -notmatch $expectedRerunStdout -or
      $rerun.Stderr -notmatch $expectedRerunError) { throw 'migration_rerun_unexpected_error' }
  $postRerunFingerprint = Get-InstalledStateFingerprint 'migration_rerun_changed_installed_state'
  if ($preRerunFingerprint -cne $postRerunFingerprint) { throw 'migration_rerun_changed_installed_state' }
  Invoke-Psql $DatabaseName $Logs.Postflight @('-f',(Join-Path $SqlRoot '01-postflight.sql')) | Out-Null
  Add-Summary PASS 'migration_rerun_rejected_without_state_change'
  Add-Summary PASS 'postflight_owner_rls_acl_trigger'
  Invoke-Psql $DatabaseName $Logs.Behavior @('-f',(Join-Path $SqlRoot '02-behavior.sql')) | Out-Null
  Add-Summary PASS 'functional_replay_immutability_isolation'
  Add-Summary PASS 'behavior_result_matrix'
  Add-Summary PASS 'immutability_and_future_lifecycle'
  Add-Summary PASS 'atomic_event_rollback'
  Add-Summary PASS 'service_role_direct_update_denied'
  Add-Summary PASS 'unsupported_isolation_rejected'

  $barrierSql = "CREATE TABLE public.phase2c_b1_rehearsal_barriers (scenario text PRIMARY KEY, released boolean NOT NULL DEFAULT false); INSERT INTO public.phase2c_b1_rehearsal_barriers(scenario) VALUES ('identical'),('changed'),('different'),('mixed_writer')"
  Invoke-Psql $DatabaseName $Logs.Concurrency @('-c',$barrierSql) -Append | Out-Null
  $pair = Invoke-PsqlPair $Logs.Concurrency 'identical' (WorkerArgs 'identical' 'a' 15 'race-identical-0015' 'solo_lite_evidence' 'unknown' 'evidence_unknown' '2026-10-22T12:00:00Z' 1) (WorkerArgs 'identical' 'b' 15 'race-identical-0015' 'solo_lite_evidence' 'unknown' 'evidence_unknown' '2026-10-22T12:00:00Z' 0) 'phase2c_b1_identical-a_lock_held' 'phase2c_b1_identical-b'
  Assert-RacePair 'identical' $pair 'already_processed' 15
  $pair = Invoke-PsqlPair $Logs.Concurrency 'changed' (WorkerArgs 'changed' 'a' 16 'race-changed-0016' 'solo_lite_evidence' 'unknown' 'evidence_unknown' '2026-10-22T12:00:00Z' 1) (WorkerArgs 'changed' 'b' 16 'race-changed-0016' 'solo_lite_evidence' 'missing' 'evidence_missing' '2026-10-22T12:01:00Z' 0) 'phase2c_b1_changed-a_lock_held' 'phase2c_b1_changed-b'
  Assert-RacePair 'changed' $pair 'state_conflict' 16
  $pair = Invoke-PsqlPair $Logs.Concurrency 'different' (WorkerArgs 'different' 'a' 17 'race-key-a-0017' 'business_kyb_evidence' 'unknown' 'evidence_unknown' '2026-10-22T12:00:00Z' 1) (WorkerArgs 'different' 'b' 17 'race-key-b-0017' 'business_kyb_evidence' 'unknown' 'evidence_unknown' '2026-10-22T12:00:00Z' 0) 'phase2c_b1_different-a_lock_held' 'phase2c_b1_different-b'
  Assert-RacePair 'different' $pair 'state_conflict' 17
  Add-Summary PASS 'read_committed_b1_concurrency'

  $mixedA = @('-At','-q','-v','merchant_id=20000000-0000-4000-8000-000000000018','-v','profile_id=40000000-0000-4000-8000-000000000018','-f',(Join-Path $SqlRoot '04-mixed-writer.sql'))
  $mixedB = WorkerArgs 'mixed_writer' 'b' 18 'mixed-b1-0018' 'business_kyb_evidence' 'unknown' 'evidence_unknown' '2026-10-22T12:00:00Z' 0
  $mixed = Invoke-PsqlPair $Logs.Mixed 'mixed_writer' $mixedA $mixedB 'phase2c_b1_mixed_writer_profile_locked' 'phase2c_b1_mixed_writer-b'
  $mixedKind = Get-WorkerKind $mixed[1] 'mixed_writer' 'b'
  $milestones = @('profile_locked','b_waiting_on_profile','event_inserted')
  $lastPosition = -1
  foreach ($milestoneName in $milestones) {
    $match = [regex]::Match($mixed[0], "(?m)^MILESTONE\|mixed_writer\|$([regex]::Escape($milestoneName))(?:\|[0-9]+)?\r?$")
    if (-not $match.Success -or $match.Index -le $lastPosition) { throw "HARNESS_MIXED_WRITER_MILESTONE_ORDER:$milestoneName" }
    $lastPosition = $match.Index
    Add-PhaseLog $Logs.Mixed "MIXED_A_$($milestoneName.ToUpperInvariant())"
  }
  if ($mixed[0] -notmatch '(?m)^RESULT\|mixed_writer\|committed\r?$' -or $mixedKind -cne 'applied') {
    throw "HARNESS_MIXED_WRITER_MISMATCH:worker_a_exit=0:worker_b_exit=0:worker_b_kind=$mixedKind"
  }
  Add-PhaseLog $Logs.Mixed 'MIXED_A_COMMITTED'
  Add-PhaseLog $Logs.Mixed 'MIXED_B_COMPLETED'
  $mixedCountSql = "SELECT (SELECT count(*) FROM public.merchant_compliance_reviews WHERE merchant_id='20000000-0000-4000-8000-000000000018')::text||'|'||(SELECT count(*) FROM public.merchant_compliance_events WHERE merchant_id='20000000-0000-4000-8000-000000000018' AND event_type='phase2c_draft_review_submit_v1')::text||'|'||(SELECT count(*) FROM public.merchant_compliance_events WHERE merchant_id='20000000-0000-4000-8000-000000000018' AND event_type='mixed_writer_probe')::text"
  $mixedCounts = (Invoke-Psql $DatabaseName $Logs.Mixed @('-At','-c',$mixedCountSql) -Append).Stdout.Trim()
  if ($mixedCounts -cne '1|1|1') { throw "HARNESS_MIXED_WRITER_PERSISTENCE_MISMATCH:counts=$mixedCounts" }
  Add-PhaseLog $Logs.Mixed 'MIXED_STATE_COUNTS_OK|reviews=1|b1_events=1|probe_events=1'
  Invoke-Psql $DatabaseName $Logs.Mixed @('-c','DROP TABLE public.phase2c_b1_rehearsal_barriers') -Append | Out-Null
  Invoke-Psql $DatabaseName $Logs.Mixed @('-f',(Join-Path $SqlRoot '05-final.sql')) -Append | Out-Null
  Add-Summary PASS 'final_state_and_non_adoption'
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $MigrationPath).Hash -cne $ExpectedMigrationSha256 -or
      (Get-FileHash -Algorithm SHA256 -LiteralPath $SourceContractPath).Hash -cne $ExpectedSourceContractSha256) { throw 'HARNESS_APPROVED_SOURCE_CHANGED_DURING_RUN' }
  Add-Summary PASS 'mixed_writer_no_reverse_fk_wait_cycle'
  Add-PhaseLog $Logs.Mixed 'MIXED_WRITER_PASS'
  $OverallPassed = $true
}
catch {
  Add-Summary FAIL $_.Exception.Message
}
finally {
  foreach ($handle in @($ActivePairHandles.ToArray())) {
    try {
      if (-not $handle.Process.HasExited) { $handle.Process.Kill(); [void]$handle.Process.WaitForExit(5000) }
      Complete-PsqlProcess $handle $Logs.Cleanup 5 -Append | Out-Null
      [void]$ActivePairHandles.Remove($handle)
    } catch { Add-Summary BLOCKED 'cleanup:child_process_not_stopped'; $OverallPassed=$false }
  }
  if ($DatabaseCreated) {
    try {
      if ($DatabaseName -notmatch '^deraledger_phase2c_b1_rehearsal_[a-z0-9_]+$') { throw 'HARNESS_CLEANUP_DATABASE_NAME_REJECTED' }
      Invoke-Psql $MaintenanceDatabase $Logs.Cleanup @('-c',"DROP DATABASE IF EXISTS $DatabaseName WITH (FORCE)") | Out-Null
      Add-Summary PASS 'disposable_database_dropped'
    } catch { Add-Summary BLOCKED "cleanup:$($_.Exception.Message)"; $OverallPassed=$false }
  }
  [Environment]::SetEnvironmentVariable('PGPASSWORD',$null,'Process')
  if ($PasswordBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordBstr) }
  $PlainPassword=$null; $SecurePassword=$null
  foreach ($name in $PgEnvironmentNames) { [Environment]::SetEnvironmentVariable($name,$SavedPgEnvironment[$name],'Process') }
}

if ($OverallPassed) { Add-Summary PASS 'phase2c_b1_local_rehearsal_complete'; Write-Host "PASS|Evidence: $EvidenceRoot"; exit 0 }
Write-Host "FAIL|Evidence: $EvidenceRoot"; exit 1
