[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('APPLY PHASE2C B1 B2 TO STAGING')]
  [string]$Confirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PsqlPath = 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
$TargetProjectRef = 'fsjljliiyfchkwbjifzw'
$ForbiddenProductionRef = 'gznwibespgkwknnvbrlv'
$TargetHost = 'aws-1-eu-central-2.pooler.supabase.com'
$TargetPort = '5432'
$TargetDatabase = 'postgres'
$TargetUser = 'postgres.fsjljliiyfchkwbjifzw'
$ExpectedCurrentUser = 'postgres'
$ExpectedBranch = 'staging/phase-2-rebuild-safe-baseline'
$ExpectedHead = '336d090a769a15b127e0101ff88bbfadaef77fae'
$ExpectedB1Hash = '49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528'
$ExpectedB2Hash = '23F66A123C89CB2E2C6C2F7001FF83840538DEF9CCB0AAFDADC0BB755A12ADF2'
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$SqlRoot = Join-Path $PSScriptRoot 'phase2c-b1-b2-staging'
$B1Migration = Join-Path $RepoRoot 'supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql'
$B2Migration = Join-Path $RepoRoot 'supabase/migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql'
$Stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ').ToLowerInvariant()
$EvidenceRoot = Join-Path $RepoRoot ".local-evidence/phase2c-b1-b2-staging/$Stamp"
$SummaryPath = Join-Path $EvidenceRoot 'summary.txt'
$EnvironmentNames = @('PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD',
  'PGPASSFILE','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGSSLMODE','PGCONNECT_TIMEOUT','PGAPPNAME')
$SavedEnvironment = @{}
$EnvironmentCaptured = $false
$PasswordPointer = [IntPtr]::Zero
$SecurePassword = $null
$PlainPassword = $null
$ExitCode = 1

function Add-Marker([string]$Kind,[string]$Name) {
  $line = "$Kind|$Name"
  [IO.File]::AppendAllText($SummaryPath,$line + [Environment]::NewLine,[Text.UTF8Encoding]::new($false))
  [Console]::WriteLine($line)
}

function Quote-NativeArgument([string]$Value) {
  if ($Value -match '[\x00\r\n"]') { throw 'unsafe_native_argument' }
  return '"' + $Value + '"'
}

function Invoke-StagingPsql([string]$LogName,[string[]]$ExtraArguments,[switch]$Append,[int]$TimeoutSeconds = 120) {
  $arguments = @('-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1',
    '-h',$TargetHost,'-p',$TargetPort,'-U',$TargetUser,'-d',$TargetDatabase) + $ExtraArguments
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $PsqlPath
  $start.Arguments = (($arguments | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join ' ')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  if (-not $process.Start()) { throw "psql_start_failed:$LogName" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
  if ($timedOut) {
    try { $process.Kill(); [void]$process.WaitForExit(5000) } catch {}
    if (-not $process.HasExited) {
      $process.Dispose()
      throw "psql_timeout_unterminated:$LogName"
    }
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  $nativeExitCode = if ($process.HasExited) { $process.ExitCode } else { -1 }
  $mode = if ($Append) { [IO.FileMode]::Append } else { [IO.FileMode]::Create }
  $logPath = Join-Path $EvidenceRoot $LogName
  $stream = [IO.FileStream]::new($logPath,$mode,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try {
    $writer = [IO.StreamWriter]::new($stream,[Text.UTF8Encoding]::new($false))
    try {
      $writer.WriteLine("EXIT_CODE=$nativeExitCode")
      $writer.WriteLine("TIMED_OUT=$timedOut")
      $writer.WriteLine('STDOUT')
      $writer.Write($stdout)
      $writer.WriteLine()
      $writer.WriteLine('STDERR')
      $writer.Write($stderr)
      $writer.WriteLine()
    } finally { $writer.Dispose() }
  } finally { $stream.Dispose() }
  $process.Dispose()
  return [pscustomobject]@{
    ExitCode = $nativeExitCode
    Stdout = $stdout
    Stderr = $stderr
    TimedOut = $timedOut
  }
}

function Assert-PsqlResult($Result,[string]$Phase) {
  if ($null -eq $Result -or $Result -is [array] -or $Result.TimedOut -or $Result.ExitCode -ne 0) {
    throw "psql_failed:$Phase"
  }
}

function Get-ControlValue([string]$Output,[string]$Prefix) {
  $matches = @(($Output -split '\r?\n') | Where-Object { $_ -clike "CONTROL|$Prefix|*" })
  if ($matches.Count -ne 1) { throw "control_row_invalid:$Prefix" }
  return $matches[0].Substring(("CONTROL|$Prefix|").Length)
}

function Get-InstalledState([switch]$Append) {
  $result = Invoke-StagingPsql '02-installed-state.txt' @('-f',(Join-Path $SqlRoot '01-installed-state.sql')) -Append:$Append
  Assert-PsqlResult $result 'installed_state'
  $b1 = Get-ControlValue $result.Stdout 'B1_STATE'
  $b2 = Get-ControlValue $result.Stdout 'B2_STATE'
  $ledger = Get-ControlValue $result.Stdout 'LEDGER'
  if (($b1 -notin @('ABSENT','EXACTLY_INSTALLED','PARTIALLY_INSTALLED','INCOMPATIBLE')) -or
      ($b2 -notin @('ABSENT','EXACTLY_INSTALLED','PARTIALLY_INSTALLED','INCOMPATIBLE')) -or
      ($ledger -cnotmatch '^b1=(ABSENT|RECORDED|INCOMPATIBLE)\|b2=(ABSENT|RECORDED|INCOMPATIBLE)$')) {
    throw 'installed_state_unparseable'
  }
  return [pscustomobject]@{ B1 = $b1; B2 = $b2; Ledger = $ledger }
}

function Assert-InstallableState($State) {
  if ($State.B1 -in @('PARTIALLY_INSTALLED','INCOMPATIBLE')) { throw "b1_$($State.B1.ToLowerInvariant())" }
  if ($State.B2 -in @('PARTIALLY_INSTALLED','INCOMPATIBLE')) { throw "b2_$($State.B2.ToLowerInvariant())" }
  if ($State.B1 -eq 'ABSENT' -and $State.B2 -ne 'ABSENT') { throw 'b2_present_without_exact_b1' }
  if ($State.Ledger -match 'INCOMPATIBLE') { throw 'migration_ledger_incompatible' }
  $b1Ledger = [regex]::Match($State.Ledger,'^b1=([^|]+)').Groups[1].Value
  $b2Ledger = [regex]::Match($State.Ledger,'\|b2=([^|]+)$').Groups[1].Value
  if ($b1Ledger -eq 'RECORDED' -and $State.B1 -eq 'ABSENT') { throw 'b1_ledger_object_contradiction' }
  if ($b2Ledger -eq 'RECORDED' -and $State.B2 -eq 'ABSENT') { throw 'b2_ledger_object_contradiction' }
}

function Invoke-Preflight($State,[switch]$Append) {
  $result = Invoke-StagingPsql '03-preflight.txt' @('-v',"b1_state=$($State.B1)",
    '-v',"b2_state=$($State.B2)",'-f',(Join-Path $SqlRoot '02-preflight.sql')) -Append:$Append
  Assert-PsqlResult $result 'preflight'
  if ((Get-ControlValue $result.Stdout 'PREFLIGHT') -cne 'PASS') { throw 'preflight_marker_invalid' }
}

try {
  [IO.Directory]::CreateDirectory($EvidenceRoot) | Out-Null
  if ($Confirmation -cne 'APPLY PHASE2C B1 B2 TO STAGING') { throw 'confirmation_rejected' }
  if (($TargetProjectRef -ceq $ForbiddenProductionRef) -or
      ($TargetUser -match [regex]::Escape($ForbiddenProductionRef)) -or
      ($TargetHost -cne 'aws-1-eu-central-2.pooler.supabase.com') -or
      ($TargetPort -cne '5432') -or ($TargetDatabase -cne 'postgres') -or
      ($TargetUser -cne 'postgres.fsjljliiyfchkwbjifzw')) {
    throw 'fixed_staging_target_rejected'
  }
  if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) { throw 'psql_15_missing' }
  $psqlVersion = (& $PsqlPath --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $psqlVersion -cnotmatch '^psql \(PostgreSQL\) 15\.') { throw 'psql_15_required' }
  $branch = (& git -C $RepoRoot branch --show-current 2>$null | Out-String).Trim()
  $head = (& git -C $RepoRoot rev-parse HEAD 2>$null | Out-String).Trim()
  $upstream = (& git -C $RepoRoot rev-parse '@{upstream}' 2>$null | Out-String).Trim()
  if ($branch -cne $ExpectedBranch -or $head -cne $ExpectedHead -or $upstream -cne $ExpectedHead) {
    throw 'repository_baseline_rejected'
  }
  foreach ($path in @($B1Migration,$B2Migration,$PSCommandPath,
      (Join-Path $SqlRoot '00-identity.sql'),(Join-Path $SqlRoot '01-installed-state.sql'),
      (Join-Path $SqlRoot '02-preflight.sql'),(Join-Path $SqlRoot '03-b1-postflight.sql'),
      (Join-Path $SqlRoot '04-b2-postflight.sql'),(Join-Path $SqlRoot '05-final.sql'))) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'required_source_missing' }
  }
  $b1Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $B1Migration).Hash
  $b2Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $B2Migration).Hash
  if ($b1Hash -cne $ExpectedB1Hash -or $b2Hash -cne $ExpectedB2Hash) { throw 'frozen_migration_hash_mismatch' }
  [IO.File]::WriteAllText((Join-Path $EvidenceRoot '00-environment.txt'),
    "branch=$branch`r`nhead=$head`r`nupstream=$upstream`r`nproject_ref=$TargetProjectRef`r`nhost=$TargetHost`r`nport=$TargetPort`r`ndatabase=$TargetDatabase`r`nlogin_user=$TargetUser`r`npsql=$psqlVersion`r`n",
    [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $EvidenceRoot '01-source-hashes.txt'),
    "B1=$b1Hash`r`nB2=$b2Hash`r`n",[Text.UTF8Encoding]::new($false))
  Add-Marker 'PASS' 'b1_b2_source_hashes'

  foreach ($name in $EnvironmentNames) {
    $SavedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name,'Process')
    [Environment]::SetEnvironmentVariable($name,$null,'Process')
  }
  $EnvironmentCaptured = $true
  $SecurePassword = Read-Host 'Staging database password' -AsSecureString
  $PasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
  $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordPointer)
  if ([string]::IsNullOrEmpty($PlainPassword)) { throw 'empty_password_rejected' }
  $env:PGPASSWORD = $PlainPassword
  $env:PGSSLMODE = 'require'
  $env:PGCONNECT_TIMEOUT = '15'
  $env:PGAPPNAME = 'phase2c_b1_b2_staging_gate'

  $identity = Invoke-StagingPsql '00-environment.txt' @('-v',"expected_database=$TargetDatabase",
    '-v',"expected_current_user=$ExpectedCurrentUser",'-f',(Join-Path $SqlRoot '00-identity.sql')) -Append
  Assert-PsqlResult $identity 'identity'
  if ((Get-ControlValue $identity.Stdout 'IDENTITY') -cnotmatch '^database=postgres\|current_user=postgres\|server_major=15\|ssl=true\|supabase_auth=true$') {
    throw 'staging_identity_marker_invalid'
  }
  Add-Marker 'PASS' 'staging_target_identity'

  $state = Get-InstalledState
  Assert-InstallableState $state
  Add-Marker 'PASS' 'migration_ledger_inspected_unmodified'
  Invoke-Preflight $state
  Add-Marker 'PASS' 'staging_schema_compatibility'

  if ($state.B1 -eq 'ABSENT') {
    $applyB1 = Invoke-StagingPsql '04-b1-apply.txt' @('-f',$B1Migration)
    Assert-PsqlResult $applyB1 'b1_apply'
    $state = Get-InstalledState -Append
    Assert-InstallableState $state
    if ($state.B1 -cne 'EXACTLY_INSTALLED') { throw 'b1_apply_not_exact' }
    Add-Marker 'PASS' 'b1_applied'
  } else {
    Add-Marker 'PASS' 'b1_exactly_installed'
  }
  $b1Postflight = Invoke-StagingPsql '05-b1-postflight.txt' @('-f',(Join-Path $SqlRoot '03-b1-postflight.sql'))
  Assert-PsqlResult $b1Postflight 'b1_postflight'
  if ((Get-ControlValue $b1Postflight.Stdout 'B1_POSTFLIGHT') -cne 'PASS') { throw 'b1_postflight_marker_invalid' }
  Add-Marker 'PASS' 'b1_security_postflight'

  Invoke-Preflight $state -Append
  if ($state.B2 -eq 'ABSENT') {
    $applyB2 = Invoke-StagingPsql '06-b2-apply.txt' @('-f',$B2Migration)
    Assert-PsqlResult $applyB2 'b2_apply'
    $state = Get-InstalledState -Append
    Assert-InstallableState $state
    if ($state.B2 -cne 'EXACTLY_INSTALLED') { throw 'b2_apply_not_exact' }
    Add-Marker 'PASS' 'b2_applied'
  } else {
    Add-Marker 'PASS' 'b2_exactly_installed'
  }
  $b2Postflight = Invoke-StagingPsql '07-b2-postflight.txt' @('-f',(Join-Path $SqlRoot '04-b2-postflight.sql'))
  Assert-PsqlResult $b2Postflight 'b2_postflight'
  if ((Get-ControlValue $b2Postflight.Stdout 'B2_POSTFLIGHT') -cne 'PASS') { throw 'b2_postflight_marker_invalid' }
  Add-Marker 'PASS' 'b2_security_postflight'

  $final = Invoke-StagingPsql '08-final.txt' @('-f',(Join-Path $SqlRoot '05-final.sql'))
  Assert-PsqlResult $final 'final'
  if ((Get-ControlValue $final.Stdout 'FINAL') -cne 'PASS') { throw 'final_marker_invalid' }
  Add-Marker 'PASS' 'draft_policy_nonadoption'
  Add-Marker 'PASS' 'profile_activation_firewall'
  Add-Marker 'PASS' 'staging_b1_b2_database_gate_complete'
  $ExitCode = 0
} catch {
  $reason = [regex]::Replace($_.Exception.Message,'[^a-zA-Z0-9_:-]','_').ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($reason)) { $reason = 'unexpected_gate_failure' }
  if (Test-Path -LiteralPath $SummaryPath) { Add-Marker 'BLOCKED' $reason }
  else { [Console]::WriteLine("BLOCKED|$reason") }
} finally {
  if ($EnvironmentCaptured) {
    foreach ($name in $EnvironmentNames) {
      [Environment]::SetEnvironmentVariable($name,$SavedEnvironment[$name],'Process')
    }
  }
  if ($PasswordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordPointer)
    $PasswordPointer = [IntPtr]::Zero
  }
  $PlainPassword = $null
  if ($null -ne $SecurePassword) { $SecurePassword.Dispose(); $SecurePassword = $null }
}

exit $ExitCode
