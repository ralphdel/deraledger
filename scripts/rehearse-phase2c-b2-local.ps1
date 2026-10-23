[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PsqlPath = 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
$DbHost = '127.0.0.1'
$DbPort = '55432'
$DbUser = 'postgres'
$MaintenanceDatabase = 'postgres'
$DbPrefix = 'deraledger_phase2c_b2_rehearsal_'
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$SqlRoot = Join-Path $PSScriptRoot 'phase2c-b2-local'
$B1Root = Join-Path $PSScriptRoot 'phase2c-b1-local'
$B1Migration = Join-Path $RepoRoot 'supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql'
$B1Contract = Join-Path $RepoRoot 'tests/phase2c-nonadopted-review-substrate.test.ts'
$B2Migration = Join-Path $RepoRoot 'supabase/migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql'
$ExpectedB1MigrationHash = '49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528'
$ExpectedB1ContractHash = '4CD41A85B4302F4906EFCED634A5470ADE437DDAFA00A7A815EF5DC9A445696F'
$ExpectedB2MigrationHash = '23F66A123C89CB2E2C6C2F7001FF83840538DEF9CCB0AAFDADC0BB755A12ADF2'
$Stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ').ToLowerInvariant()
$DatabaseName = $DbPrefix + $Stamp + '_' + ([Guid]::NewGuid().ToString('N')).Substring(0,8)
$EvidenceRoot = Join-Path $RepoRoot ".local-evidence/phase2c-b2/$Stamp"
$SummaryPath = Join-Path $EvidenceRoot 'summary.txt'
$EnvironmentNames = @('PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS','PGSSLMODE','PGCONNECT_TIMEOUT','PGAPPNAME')
$SavedEnvironment = @{}
$EnvironmentCaptured = $false
$Created = $false
$Passed = $false
$PasswordPointer = [IntPtr]::Zero
$Password = $null
$PlainPassword = $null
$ActiveHandles = [System.Collections.Generic.List[object]]::new()
$SourceHashes=@{}

function Add-Marker([string]$Kind,[string]$Name) {
  $line = "$Kind|$Name"
  [IO.File]::AppendAllText($SummaryPath,$line+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  Write-Host $line
}

function Quote-Argument([string]$Value) {
  if ($Value -match '[\x00\r\n"]') { throw 'B2_UNSAFE_NATIVE_ARGUMENT' }
  return '"' + $Value + '"'
}

function Start-LocalPsql([string]$Database,[string[]]$ExtraArguments) {
  $arguments = @('-X','-w','-v','ON_ERROR_STOP=1','-h',$DbHost,'-p',$DbPort,'-U',$DbUser,'-d',$Database) + $ExtraArguments
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $PsqlPath
  $start.Arguments = (($arguments | ForEach-Object { Quote-Argument ([string]$_) }) -join ' ')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  if (-not $process.Start()) { throw 'B2_PSQL_START_FAILED' }
  $handle=[pscustomobject]@{ Process=$process; Stdout=$process.StandardOutput.ReadToEndAsync()
    Stderr=$process.StandardError.ReadToEndAsync() }
  $ActiveHandles.Add($handle)
  return $handle
}

function Complete-LocalPsql($Handle,[string]$LogName,[int]$TimeoutSeconds=110) {
  $timedOut=-not $Handle.Process.WaitForExit($TimeoutSeconds*1000)
  if ($timedOut) {
    try { $Handle.Process.Kill(); [void]$Handle.Process.WaitForExit(5000) } catch {}
    if (-not $Handle.Process.HasExited) { throw "B2_CHILD_NOT_STOPPED:$LogName" }
  }
  $stdout = $Handle.Stdout.GetAwaiter().GetResult()
  $stderr = $Handle.Stderr.GetAwaiter().GetResult()
  $exitCode=$Handle.Process.ExitCode
  $logPath = Join-Path $EvidenceRoot $LogName
  [IO.File]::AppendAllText($logPath,"EXIT_CODE=$exitCode`r`nTIMED_OUT=$timedOut`r`nSTDOUT`r`n$stdout`r`nSTDERR`r`n$stderr`r`n",[Text.UTF8Encoding]::new($false))
  [void]$ActiveHandles.Remove($Handle)
  $Handle.Process.Dispose()
  return [pscustomobject]@{ ExitCode=$exitCode; Stdout=$stdout; Stderr=$stderr; TimedOut=$timedOut }
}

function Invoke-LocalPsql([string]$Database,[string]$LogName,[string[]]$ExtraArguments) {
  return (Complete-LocalPsql (Start-LocalPsql $Database $ExtraArguments) $LogName)
}

function Assert-LocalResult($Result,[string]$Name) {
  if ($null -eq $Result -or $Result -is [array] -or $Result.ExitCode -ne 0 -or $Result.TimedOut) {
    throw "B2_PSQL_FAILED:$Name"
  }
}

function Get-Control([string]$Output) {
  $lines=@(($Output.TrimStart([char]0xfeff) -split '\r?\n') | Where-Object { $_.Length -gt 0 })
  if ($lines.Count -ne 1 -or $lines[0] -cnotmatch '^CONTROL\|[^\r\n]+$') { throw 'B2_CONTROL_ROW_INVALID' }
  return $lines[0].Substring(8)
}

function Get-InstalledFingerprint {
  $result=Invoke-LocalPsql $DatabaseName '06-installed-state.txt' @('-qAt','-f',(Join-Path $SqlRoot '01-installed-state.sql'))
  Assert-LocalResult $result 'installed_state'
  $value=Get-Control $result.Stdout
  if ($value -cnotmatch '^[0-9a-f]{64}$') { throw 'B2_FINGERPRINT_INVALID' }
  return $value
}

function Add-ConcurrencyLog([string]$Line) {
  [IO.File]::AppendAllText((Join-Path $EvidenceRoot '09-concurrency.txt'),$Line+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
}

function Get-WorkerKind([string]$Output,[string]$Scenario,[string]$Worker) {
  $matchesFound=[regex]::Matches($Output,"(?m)^B2_WORKER_RESULT\|$Scenario\|$Worker\|([a-z_]+)\r?$")
  if ($matchesFound.Count -ne 1) { throw ('B2_WORKER_RESULT_INVALID:{0}:{1}' -f $Scenario,$Worker) }
  return $matchesFound[0].Groups[1].Value
}

function Test-ResultPair([string]$A,[string]$B,[string[]]$Expected) {
  return (($(@($A,$B) | Sort-Object) -join '|') -ceq ($($Expected | Sort-Object) -join '|'))
}

function Invoke-B2Race([string]$Scenario,[string[]]$Expected,[switch]$Probe,[switch]$Revoke) {
  if ($Scenario -cnotmatch '^[a-z_]+$') { throw 'B2_SCENARIO_REJECTED' }
  $milestone='SCENARIO_START'
  Add-ConcurrencyLog "SCENARIO_START|$Scenario"
  $workerPath=Join-Path $SqlRoot '04-concurrency-worker.sql'
  $common=@('-qAt','-v',"scenario=$Scenario",'-f',$workerPath)
  $a=Start-LocalPsql $DatabaseName (@('-v','worker=a','-v','hold=true','-v',"probe=$($Probe.IsPresent.ToString().ToLowerInvariant())",'-v',"revoke=$($Revoke.IsPresent.ToString().ToLowerInvariant())")+$common)
  $b=$null; $ra=$null; $rb=$null
  try {
    $clock=[Diagnostics.Stopwatch]::StartNew()
    $aBackend=''
    while ($clock.Elapsed.TotalSeconds -lt 20) {
      if ($a.Process.HasExited) { throw "B2_WORKER_A_EXITED_BEFORE_READY:$Scenario" }
      $query="SELECT 'CONTROL|'||COALESCE((SELECT pid::text FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name='phase2c_b2_$($Scenario)_a_ready'),'WAIT')"
      $ready=Invoke-LocalPsql $DatabaseName '09-concurrency.txt' @('-qAt','-c',$query)
      Assert-LocalResult $ready 'readiness'
      $aBackend=Get-Control $ready.Stdout
      if ($aBackend -cmatch '^[0-9]+$') { break }
      if ($aBackend -cne 'WAIT') { throw 'B2_READINESS_INVALID' }
      Start-Sleep -Milliseconds 100
    }
    if ($aBackend -cnotmatch '^[0-9]+$') { throw "B2_READY_TIMEOUT:$Scenario" }
    $milestone='A_LOCK_READY'
    Add-ConcurrencyLog "A_LOCK_READY|$Scenario|$aBackend"
    $b=Start-LocalPsql $DatabaseName (@('-v','worker=b','-v','hold=false','-v','probe=false','-v','revoke=false')+$common)
    Add-ConcurrencyLog "B_STARTED|$Scenario"
    $clock.Restart(); $proof='WAIT'
    while ($clock.Elapsed.TotalSeconds -lt 20) {
      if ($a.Process.HasExited -or $b.Process.HasExited) { throw "B2_WORKER_EXITED_BEFORE_BLOCKING:$Scenario" }
      # Every poll is a fresh connection: no cached pg_stat_activity snapshot.
      $query="SELECT 'CONTROL|'||COALESCE((SELECT 'BLOCKED|'||b.pid FROM pg_catalog.pg_stat_activity b WHERE b.datname=current_database() AND b.application_name='phase2c_b2_$($Scenario)_b' AND b.wait_event_type='Lock' AND $aBackend=ANY(pg_catalog.pg_blocking_pids(b.pid))),'WAIT')"
      $blocked=Invoke-LocalPsql $DatabaseName '09-concurrency.txt' @('-qAt','-c',$query)
      Assert-LocalResult $blocked 'blocking'
      $proof=Get-Control $blocked.Stdout
      if ($proof -cmatch '^BLOCKED\|[0-9]+$') { break }
      if ($proof -cne 'WAIT') { throw 'B2_BLOCKING_INVALID' }
      Start-Sleep -Milliseconds 100
    }
    if ($proof -cnotmatch '^BLOCKED\|[0-9]+$') { throw "B2_BLOCKING_TIMEOUT:$Scenario" }
    $milestone='BLOCKING_PROVEN'
    $bBackend=($proof -split '\|')[1]
    Add-ConcurrencyLog "BLOCKING_PROVEN|$Scenario|$aBackend|$bBackend"
    # One CONTROL aggregate proves exactly one intended row changed; no command-tag parser.
    $release=Invoke-LocalPsql $DatabaseName '09-concurrency.txt' @('-qAt','-c',
      "WITH changed AS (UPDATE public.b2_rehearsal_cases SET released=true WHERE scenario='$Scenario' AND NOT released RETURNING scenario) SELECT 'CONTROL|'||count(*)||'|'||COALESCE(min(scenario),'NONE') FROM changed")
    Assert-LocalResult $release 'barrier'
    if ((Get-Control $release.Stdout) -cne "1|$Scenario") { throw "B2_BARRIER_RELEASE_INVALID:$Scenario" }
    Add-ConcurrencyLog "BARRIER_RELEASED|$Scenario"
    $ra=Complete-LocalPsql $a '09-concurrency.txt'
    $rb=Complete-LocalPsql $b '09-concurrency.txt'
    Assert-LocalResult $ra "worker_a:$Scenario"
    Assert-LocalResult $rb "worker_b:$Scenario"
    foreach ($pair in @(@($ra,'a',$aBackend),@($rb,'b',$bBackend))) {
      if ($pair[0].Stdout -notmatch "(?m)^B2_BACKEND\|$Scenario\|$($pair[1])\|$($pair[2])\r?$" -or
          $pair[0].Stdout -notmatch "(?m)^B2_COMMITTED\|$Scenario\|$($pair[1])\r?$") {
        throw "B2_BACKEND_OR_COMMIT_MARKER_INVALID:$Scenario"
      }
    }
    $kindA=Get-WorkerKind $ra.Stdout $Scenario 'a'
    $kindB=Get-WorkerKind $rb.Stdout $Scenario 'b'
    if (-not (Test-ResultPair $kindA $kindB $Expected)) {
      throw ('B2_RACE_RESULT:{0}:{1}:{2}' -f $Scenario,$kindA,$kindB)
    }
    Add-ConcurrencyLog "SCENARIO_PASS|$Scenario|$kindA|$kindB"
  } catch {
    $rootFailure=$_
    foreach ($entry in @(@($a,$ra,'a'),@($b,$rb,'b'))) {
      if ($null -ne $entry[0] -and $null -eq $entry[1]) {
        try {
          $terminated=-not $entry[0].Process.HasExited
          if ($terminated) { $entry[0].Process.Kill(); [void]$entry[0].Process.WaitForExit(5000) }
          $failureResult=Complete-LocalPsql $entry[0] '09-concurrency.txt' 5
          $classification=if ($terminated) { 'HARNESS_TERMINATED' } else { 'NATURAL_EXIT' }
          Add-ConcurrencyLog "WORKER_FAILURE|$Scenario|$($entry[2])|$classification|exit=$($failureResult.ExitCode)|stderr=$($failureResult.Stderr)"
        } catch { Add-ConcurrencyLog "WORKER_CLEANUP_FAILED|$Scenario|$($entry[2])" }
      }
    }
    Add-ConcurrencyLog "ROOT_FAILURE|$Scenario|$milestone|$($rootFailure.Exception.Message)"
    throw $rootFailure
  }
}

try {
  New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
  [IO.File]::WriteAllText($SummaryPath,'',[Text.UTF8Encoding]::new($false))
  if (($DbHost -cne '127.0.0.1') -or ($DbPort -cne '55432') -or ($DbUser -cne 'postgres') -or
      ($MaintenanceDatabase -cne 'postgres') -or
      ($PsqlPath -cne 'C:\Program Files\PostgreSQL\15\bin\psql.exe') -or
      (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf))) { throw 'B2_NONLOCAL_TARGET_REJECTED' }
  if (($DatabaseName -cnotmatch '^deraledger_phase2c_b2_rehearsal_[a-z0-9_]+$') -or
      ($DatabaseName -in @('postgres','template0','template1'))) { throw 'B2_DATABASE_NAME_REJECTED' }
  $branch = (& git -C $RepoRoot branch --show-current).Trim()
  $baseHead = (& git -C $RepoRoot rev-parse 'affcb21^{commit}').Trim()
  $actualHead = (& git -C $RepoRoot rev-parse HEAD).Trim()
  if ($branch -cne 'staging/phase-2-rebuild-safe-baseline' -or $actualHead -cne $baseHead) {
    throw 'B2_REPOSITORY_BASELINE_REJECTED'
  }
  foreach ($path in @($B1Migration,$B1Contract,$B2Migration,
      (Join-Path $B1Root '00-bootstrap.sql'),(Join-Path $SqlRoot '00-prerequisite.sql'),
      (Join-Path $SqlRoot '01-installed-state.sql'),(Join-Path $SqlRoot '01-behavior.sql'),
      (Join-Path $SqlRoot '02-contract-matrix.sql'),(Join-Path $SqlRoot '03-concurrency-setup.sql'),
      (Join-Path $SqlRoot '04-concurrency-worker.sql'),(Join-Path $SqlRoot '05-final.sql'),
      $PSCommandPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'B2_REQUIRED_SOURCE_MISSING' }
    $SourceHashes[$path]=(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash
  }
  if (((Get-FileHash -Algorithm SHA256 -LiteralPath $B1Migration).Hash -cne $ExpectedB1MigrationHash) -or
      ((Get-FileHash -Algorithm SHA256 -LiteralPath $B1Contract).Hash -cne $ExpectedB1ContractHash)) {
    throw 'B2_APPROVED_B1_HASH_REJECTED'
  }
  $b2Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $B2Migration).Hash
  if ($b2Hash -cne $ExpectedB2MigrationHash) { throw 'B2_REVIEWED_SOURCE_HASH_REJECTED' }
  [IO.File]::WriteAllText((Join-Path $EvidenceRoot '00-source.txt'),
    "branch=$branch`r`nbase_head=$actualHead`r`nb1_hash=$ExpectedB1MigrationHash`r`nb2_hash=$b2Hash`r`n",
    [Text.UTF8Encoding]::new($false))
  foreach ($name in $EnvironmentNames) {
    $SavedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
  }
  $EnvironmentCaptured = $true
  foreach ($name in $EnvironmentNames) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
  [Environment]::SetEnvironmentVariable('PGSSLMODE','disable','Process')
  [Environment]::SetEnvironmentVariable('PGCONNECT_TIMEOUT','5','Process')
  $manifest=($SourceHashes.GetEnumerator() | Sort-Object Key | ForEach-Object { "$($_.Value)|$($_.Key)" }) -join [Environment]::NewLine
  [IO.File]::WriteAllText((Join-Path $EvidenceRoot '00-artifacts.txt'),$manifest,[Text.UTF8Encoding]::new($false))
  Add-Marker PASS 'source_and_local_target_preflight'
  $Password = Read-Host 'Local PostgreSQL password (memory only)' -AsSecureString
  $PasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
  $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordPointer)
  [Environment]::SetEnvironmentVariable('PGPASSWORD',$PlainPassword,'Process')
  $identity = Invoke-LocalPsql $MaintenanceDatabase '01-identity.txt' @('-At','-c',
    "SELECT current_database()||'|'||current_user||'|'||current_setting('server_version_num')||'|'||host(inet_server_addr())||'|'||inet_server_port()")
  Assert-LocalResult $identity 'identity'
  if ($identity.Stdout.Trim() -cnotmatch '^postgres\|postgres\|15[0-9]{4}\|127\.0\.0\.1(?:/32)?\|55432$') {
    throw 'B2_DATABASE_IDENTITY_REJECTED'
  }
  Add-Marker PASS 'postgres_15_loopback_identity'
  $created = Invoke-LocalPsql $MaintenanceDatabase '02-create.txt' @('-c',"CREATE DATABASE $DatabaseName")
  Assert-LocalResult $created 'create'
  $Created = $true
  $bootstrap = Invoke-LocalPsql $DatabaseName '03-bootstrap.txt' @('-f',(Join-Path $B1Root '00-bootstrap.sql'))
  Assert-LocalResult $bootstrap 'bootstrap'
  $prerequisite = Invoke-LocalPsql $DatabaseName '04-b2-prerequisite.txt' @('-f',(Join-Path $SqlRoot '00-prerequisite.sql'))
  Assert-LocalResult $prerequisite 'b2_prerequisite'
  $b1 = Invoke-LocalPsql $DatabaseName '05-b1-apply.txt' @('-f',$B1Migration)
  Assert-LocalResult $b1 'b1_apply'
  Add-Marker PASS 'disposable_b1_and_authority_prerequisite'
  $b2 = Invoke-LocalPsql $DatabaseName '06-b2-apply.txt' @('-f',$B2Migration)
  Assert-LocalResult $b2 'b2_apply'
  if ($b2.Stdout -notmatch '(?m)^COMMIT\s*$') { throw 'B2_COMMIT_MARKER_MISSING' }
  Add-Marker PASS 'b2_migration_compiled_and_committed'
  $preRerunFingerprint=Get-InstalledFingerprint
  $rerun=Invoke-LocalPsql $DatabaseName '06-rerun.txt' @('-f',$B2Migration)
  if ($rerun.ExitCode -ne 3 -or $rerun.TimedOut -or
      $rerun.Stdout -notmatch '^BEGIN\r?\nSET\r?\nSET\r?\nSET\s*$' -or
      $rerun.Stderr -notmatch '(?s)^psql:[^\r\n]*20261022000000_phase2c_nonadopted_review_triage_resubmission\.sql:\d+:\s*ERROR:\s+Phase 2C B2 RPC already exists\r?\nCONTEXT:\s*PL/pgSQL function inline_code_block line \d+ at RAISE\s*$') {
    throw 'B2_MIGRATION_RERUN_UNEXPECTED'
  }
  $postRerunFingerprint=Get-InstalledFingerprint
  if ($preRerunFingerprint -cne $postRerunFingerprint) { throw 'B2_RERUN_CHANGED_INSTALLED_STATE' }
  Add-Marker PASS 'b2_rerun_rejected_without_state_change'
  Add-Marker PASS 'b2_postflight_owner_rls_acl_trigger'
  $behavior = Invoke-LocalPsql $DatabaseName '07-behavior.txt' @('-f',(Join-Path $SqlRoot '01-behavior.sql'))
  Assert-LocalResult $behavior 'behavior'
  if ($behavior.Stdout -notmatch 'PASS\|b2_draft_triage_resubmission_behavior') {
    throw 'B2_BEHAVIOR_MARKER_MISSING'
  }
  Add-Marker PASS 'b2_draft_triage_resubmission_behavior'
  $matrix=Invoke-LocalPsql $DatabaseName '08-contract-matrix.txt' @('-f',(Join-Path $SqlRoot '02-contract-matrix.sql'))
  Assert-LocalResult $matrix 'contract_matrix'
  if ($matrix.Stdout -notmatch 'PASS\|b2_contract_matrix_rolled_back') { throw 'B2_MATRIX_MARKER_MISSING' }
  Add-Marker PASS 'b2_authority_replay_snapshot_acl_matrix'
  $setup=Invoke-LocalPsql $DatabaseName '09-concurrency.txt' @('-f',(Join-Path $SqlRoot '03-concurrency-setup.sql'))
  Assert-LocalResult $setup 'concurrency_setup'
  Invoke-B2Race 'rmi_same' @('applied','already_processed')
  Invoke-B2Race 'rmi_changed' @('applied','state_conflict')
  Invoke-B2Race 'rmi_different' @('applied','version_conflict')
  Add-Marker PASS 'b2_rmi_concurrency'
  Invoke-B2Race 'resubmit_same' @('applied','already_processed')
  Invoke-B2Race 'resubmit_changed' @('applied','state_conflict')
  Invoke-B2Race 'resubmit_different' @('applied','version_conflict')
  Add-Marker PASS 'b2_resubmission_concurrency'
  Invoke-B2Race 'cross_pending' @('applied','version_conflict')
  Invoke-B2Race 'cross_retry' @('already_processed','applied')
  Add-Marker PASS 'b2_cross_action_serialization'
  Invoke-B2Race 'authority_revoked' @('revoked','reviewer_unauthorized') -Revoke
  Add-Marker PASS 'b2_authority_revocation_serialized'
  Invoke-B2Race 'mixed_rmi' @('probe_inserted','applied') -Probe
  Invoke-B2Race 'mixed_resubmit' @('probe_inserted','applied') -Probe
  Add-Marker PASS 'b2_mixed_writer_fk_compatibility'
  $final=Invoke-LocalPsql $DatabaseName '10-final.txt' @('-f',(Join-Path $SqlRoot '05-final.sql'))
  Assert-LocalResult $final 'final_state'
  if ($final.Stdout -notmatch 'PASS\|b2_final_counts_and_profile_firewall') { throw 'B2_FINAL_MARKER_MISSING' }
  Add-Marker PASS 'b2_final_counts_and_profile_firewall'
  foreach ($entry in $SourceHashes.GetEnumerator()) {
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $entry.Key).Hash -cne $entry.Value) {
      throw 'B2_SOURCE_CHANGED_DURING_RUN'
    }
  }
  $Passed = $true
} catch {
  Add-Marker FAIL $_.Exception.Message
} finally {
  foreach ($handle in @($ActiveHandles.ToArray())) {
    try {
      if (-not $handle.Process.HasExited) { $handle.Process.Kill(); [void]$handle.Process.WaitForExit(5000) }
      Complete-LocalPsql $handle '11-cleanup.txt' 5 | Out-Null
    } catch { Add-Marker BLOCKED 'B2_CHILD_CLEANUP_FAILED'; $Passed=$false }
  }
  if ($Created) {
    try {
      if ($DatabaseName -cnotmatch '^deraledger_phase2c_b2_rehearsal_[a-z0-9_]+$') {
        throw 'B2_CLEANUP_NAME_REJECTED'
      }
      $drop = Invoke-LocalPsql $MaintenanceDatabase '11-cleanup.txt' @('-c',
        "DROP DATABASE IF EXISTS $DatabaseName WITH (FORCE)")
      Assert-LocalResult $drop 'cleanup'
      Add-Marker PASS 'disposable_database_dropped'
    } catch {
      Add-Marker BLOCKED "cleanup:$($_.Exception.Message)"
      $Passed = $false
    }
  }
  if ($EnvironmentCaptured) { [Environment]::SetEnvironmentVariable('PGPASSWORD',$null,'Process') }
  if ($PasswordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordPointer)
  }
  $PlainPassword = $null
  $Password = $null
  if ($EnvironmentCaptured) {
    foreach ($name in $EnvironmentNames) {
      [Environment]::SetEnvironmentVariable($name,$SavedEnvironment[$name],'Process')
    }
  }
}
if ($Passed) { Add-Marker PASS 'phase2c_b2_local_rehearsal_complete'; exit 0 }
exit 1
