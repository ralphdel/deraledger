[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('RUN PHASE2C B4P STAGING PREFLIGHT')]
  [string]$Confirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This runner has no migration, recovery, or deployment path.  Its only SQL
# inputs are the established read-only identity probe and M031 preflight.
$PsqlPath = 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
$ExpectedProjectRef = 'fsjljliiyfchkwbjifzw'
$ForbiddenProductionRef = 'gznwibespgkwknnvbrlv'
$TargetHost = 'aws-1-eu-central-2.pooler.supabase.com'
$TargetPort = '5432'
$TargetDatabase = 'postgres'
$TargetUser = 'postgres.fsjljliiyfchkwbjifzw'
$ExpectedCurrentUser = 'postgres'
$ExpectedServerMajor = '17'
$ExpectedBranch = 'staging/phase-2-rebuild-safe-baseline'
$ReviewedB4PBaseline = 'c55c4e392f6d3d676e8545f2a180968f41d009cb'
$ExpectedStash = '81369efc059e7fe7e0e96f5b36533738c9f7c31f'
$ExpectedM031Hash = '12CDC46047AF9F39A02C9D4AF330256BCD8C48654101F49C5C9940D69BC036CF'
$ExpectedPreflightHash = '8DE0950018C308C7A8DF2D064D599E27A25408D47D0D072A9AF6ABDE939E370D'
$ExpectedIdentityHash = '6DE52A99C98C9DC5B20C64EABEC4A9BC9626D12638521F7D9B958827846A3EE2'
$RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$IdentitySql = Join-Path $RepoRoot 'scripts\phase2c-b1-b2-staging\00-identity.sql'
$PreflightSql = Join-Path $RepoRoot 'supabase\staging\preflight\031_phase2c_draft_compliance_profile_provisioning_snapshot.sql'
$M031Sql = Join-Path $RepoRoot 'supabase\migrations\20261023000000_phase2c_draft_compliance_profile_provisioning.sql'
$Stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ').ToLowerInvariant()
$EvidenceRoot = Join-Path $RepoRoot ".local-evidence/phase2c-b4p-staging-preflight/$Stamp"
$SummaryPath = Join-Path $EvidenceRoot 'summary.txt'
$EnvironmentNames = @(
  'PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGPASSFILE',
  'PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGSSLMODE','PGGSSENCMODE','PGCONNECT_TIMEOUT',
  'PGAPPNAME','PGTARGETSESSIONATTRS','PGREQUIREAUTH','PGSYSCONFDIR','PGSSLROOTCERT',
  'PGSSLCERT','PGSSLKEY','PGSSLCRL','PGSSLCRLDIR','PGSSLMINPROTOCOLVERSION','PGCHANNELBINDING'
)
$SavedEnvironment = @{}
$EnvironmentCaptured = $false
$PasswordPointer = [IntPtr]::Zero
$SecurePassword = $null
$PlainPassword = $null
$ExitCode = 1
$ReviewedRunnerPaths = @(
  'scripts/preflight-phase2c-b4p-staging.ps1',
  'tests/phase2c-b4p-staging-preflight-runner.test.ps1'
)

function Add-Marker([string]$Kind, [string]$Name) {
  $line = "$Kind|$Name"
  [IO.File]::AppendAllText($SummaryPath, $line + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
  [Console]::WriteLine($line)
}

function ConvertTo-StagingNativeArgument {
  param([Parameter(Mandatory = $true)][string]$Value)
  if ($Value -match '[\x00\r\n]') { throw 'unsafe_native_argument' }
  if ($Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function ConvertTo-SanitizedDiagnostic {
  param([AllowNull()][string]$Detail)
  if ([string]::IsNullOrWhiteSpace($Detail)) { return 'NO_NATIVE_DIAGNOSTIC_AVAILABLE' }
  $safe = $Detail -replace '[\r\n\t]+', ' ' -replace '\s+', ' '
  $safe = [regex]::Replace($safe, '(?i)\b(password|pwd)\s*=\s*(?:"[^"]*"|''[^'']*''|\S+)', '$1=<redacted>')
  $safe = [regex]::Replace($safe, '(?i)\bpostgres(?:ql)?://\S+', '<redacted-connection-string>')
  $safe = [regex]::Replace($safe, '(?i)\b(bearer|token|secret|api[_-]?key)\s+\S+', '$1 <redacted>')
  if ($safe.Length -gt 700) { $safe = $safe.Substring(0, 700) }
  return $safe.Trim()
}

function Stop-StagingProcessTree {
  param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)
  if ($Process.HasExited) { return }
  try {
    $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    if (Test-Path -LiteralPath $taskkill -PathType Leaf) {
      & $taskkill '/PID' $Process.Id '/T' '/F' *> $null
      [void]$Process.WaitForExit(5000)
    }
  } catch {}
  if (-not $Process.HasExited) { try { $Process.Kill() } catch {} }
  return $Process.HasExited
}

function Get-StagingTimeoutDisposition {
  param(
    [Parameter(Mandatory = $true)][bool]$ProcessExited,
    [Parameter(Mandatory = $true)][bool]$ReadersCompleted
  )
  if (-not $ProcessExited) { return 'PROCESS_TERMINATION_UNCONFIRMED' }
  if (-not $ReadersCompleted) { return 'OUTPUT_DRAIN_TIMEOUT' }
  return 'PROCESS_TIMEOUT'
}

function Invoke-StagingNative {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Stage,
    [int]$TimeoutSeconds = 120
  )
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $FilePath
  $start.Arguments = (($Arguments | ForEach-Object { ConvertTo-StagingNativeArgument $_ }) -join ' ')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) { throw "STAGING_PREFLIGHT_PROCESS_START_FAILED:$Stage" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
  if ($timedOut) {
    [void](Stop-StagingProcessTree -Process $process)
    $processExited = $process.HasExited -or $process.WaitForExit(5000)
    if (-not $processExited) {
      $process.Dispose()
      throw "STAGING_PREFLIGHT_NATIVE_FAILED:$Stage|DETAIL:$(Get-StagingTimeoutDisposition -ProcessExited $false -ReadersCompleted $false)"
    }
    $readersCompleted = [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), 5000)
    if (-not $readersCompleted) {
      $process.Dispose()
      throw "STAGING_PREFLIGHT_NATIVE_FAILED:$Stage|DETAIL:$(Get-StagingTimeoutDisposition -ProcessExited $true -ReadersCompleted $false)"
    }
  } else {
    $readersCompleted = [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), 5000)
    if (-not $readersCompleted) {
      $process.Dispose()
      throw "STAGING_PREFLIGHT_NATIVE_FAILED:$Stage|DETAIL:OUTPUT_DRAIN_TIMEOUT"
    }
  }
  $result = [pscustomobject]@{ ExitCode = if ($process.HasExited) { $process.ExitCode } else { -1 }; TimedOut = $timedOut; Stdout = $stdoutTask.Result; Stderr = $stderrTask.Result }
  $process.Dispose()
  if ($result.TimedOut -or $result.ExitCode -ne 0) {
    throw "STAGING_PREFLIGHT_NATIVE_FAILED:$Stage|EXIT_CODE:$($result.ExitCode)|DETAIL:$(ConvertTo-SanitizedDiagnostic $result.Stderr)"
  }
  return $result
}

function Invoke-StagingPsql {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$AdditionalArguments,
    [Parameter(Mandatory = $true)][string]$Stage
  )
  $arguments = @('-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
    '-h',$TargetHost,'-p',$TargetPort,'-U',$TargetUser,'-d',$TargetDatabase) + $AdditionalArguments
  return Invoke-StagingNative -FilePath $PsqlPath -Arguments $arguments -Stage $Stage
}

function Get-ControlValue {
  param([Parameter(Mandatory = $true)][string]$Output, [Parameter(Mandatory = $true)][string]$Prefix)
  $matches = @(($Output -split '\r?\n') | Where-Object { $_ -clike "CONTROL|$Prefix|*" })
  if ($matches.Count -ne 1) { throw "staging_control_row_invalid:$Prefix" }
  return $matches[0].Substring(("CONTROL|$Prefix|").Length)
}

function Assert-B4pStagingGitState {
  param([Parameter(Mandatory = $true)]$State)
  if ($State.Branch -cne $ExpectedBranch -or -not $State.BaselineIsAncestor -or -not $State.HeadIsCommit -or $State.HeadIsBaseline -or $State.LocalHead -cne $State.RemoteHead -or $State.Stash -cne $ExpectedStash) {
    throw 'repository_baseline_rejected'
  }
  if (@($State.StagedPaths).Count -ne 0) { throw 'repository_staged_changes_rejected' }
  if (@($State.TrackedChanges).Count -ne 0) { throw 'repository_tracked_changes_rejected' }
  if (@($State.UnexpectedUntracked).Count -ne 0) { throw 'repository_untracked_source_rejected' }
  $trackedRunnerPaths = @($State.TrackedPaths | Sort-Object -Unique)
  $expectedRunnerPaths = @($ReviewedRunnerPaths | Sort-Object -Unique)
  if (($trackedRunnerPaths -join "`n") -cne ($expectedRunnerPaths -join "`n")) { throw 'reviewed_runner_paths_not_tracked' }
  if ($State.ParentCount -ne 1 -or $State.DirectParent -cne $ReviewedB4PBaseline) { throw 'reviewed_runner_commit_history_invalid' }
  $expectedChanges = @($ReviewedRunnerPaths | Sort-Object | ForEach-Object { "A`t$_" })
  $actualChanges = @($State.CommitChanges | Sort-Object)
  if (($actualChanges -join "`n") -cne ($expectedChanges -join "`n")) { throw 'reviewed_runner_commit_content_invalid' }
}

try {
  [IO.Directory]::CreateDirectory($EvidenceRoot) | Out-Null
  if ($Confirmation -cne 'RUN PHASE2C B4P STAGING PREFLIGHT') { throw 'confirmation_rejected' }
  if ($ExpectedProjectRef -ceq $ForbiddenProductionRef -or $TargetUser -match [regex]::Escape($ForbiddenProductionRef) -or
    $TargetHost -cne 'aws-1-eu-central-2.pooler.supabase.com' -or $TargetPort -cne '5432' -or
    $TargetDatabase -cne 'postgres' -or $TargetUser -cne 'postgres.fsjljliiyfchkwbjifzw') { throw 'fixed_staging_target_rejected' }
  if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) { throw 'psql_15_missing' }
  $psqlVersion = (& $PsqlPath --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $psqlVersion -cnotmatch '^psql \(PostgreSQL\) 15\.') { throw 'psql_15_required' }
  foreach ($path in @($IdentitySql, $PreflightSql, $M031Sql)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'required_source_missing' } }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $M031Sql).Hash -cne $ExpectedM031Hash) { throw 'm031_hash_mismatch' }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $PreflightSql).Hash -cne $ExpectedPreflightHash) { throw 'preflight_hash_mismatch' }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $IdentitySql).Hash -cne $ExpectedIdentityHash) { throw 'identity_probe_hash_mismatch' }
  $branch = (& git -C $RepoRoot branch --show-current 2>$null | Out-String).Trim()
  $head = (& git -C $RepoRoot rev-parse HEAD 2>$null | Out-String).Trim()
  $remoteHead = (& git -C $RepoRoot rev-parse origin/$ExpectedBranch 2>$null | Out-String).Trim()
  $stash = (& git -C $RepoRoot rev-parse 'stash@{0}' 2>$null | Out-String).Trim()
  & git -C $RepoRoot cat-file -e "$head^{commit}" 2>$null
  $headIsCommit = $LASTEXITCODE -eq 0
  $parentLine = (& git -C $RepoRoot rev-list --parents -n 1 $head 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'repository_parent_state_unavailable' }
  $parentTokens = @($parentLine -split '\s+' | Where-Object { $_ })
  $parents = if ($parentTokens.Count -gt 1) { @($parentTokens | Select-Object -Skip 1) } else { @() }
  & git -C $RepoRoot merge-base --is-ancestor $ReviewedB4PBaseline $head 2>$null
  $baselineIsAncestor = $LASTEXITCODE -eq 0
  $statusLines = @(& git -C $RepoRoot status --porcelain=v1 --untracked-files=all 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'repository_status_unavailable' }
  $stagedPaths = @(& git -C $RepoRoot diff --cached --name-only 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'repository_staged_state_unavailable' }
  $trackedRunnerPaths = @()
  foreach ($path in $ReviewedRunnerPaths) {
    & git -C $RepoRoot ls-files --error-unmatch -- $path 2>$null
    if ($LASTEXITCODE -eq 0) { $trackedRunnerPaths += $path }
  }
  $unexpectedUntracked = @($statusLines | Where-Object { $_.StartsWith('?? ') } | ForEach-Object { $_.Substring(3).Replace('\','/') } | Where-Object {
    $_ -cne '.local-evidence/' -and -not $_.StartsWith('.local-evidence/') -and $_ -cne '.playwright-mcp/' -and -not $_.StartsWith('.playwright-mcp/')
  })
  $commitChanges = @(& git -C $RepoRoot diff-tree --no-commit-id --name-status -r --no-renames $head 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'repository_commit_diff_unavailable' }
  Assert-B4pStagingGitState -State ([pscustomobject]@{
    Branch = $branch; BaselineIsAncestor = $baselineIsAncestor; HeadIsCommit = $headIsCommit; HeadIsBaseline = $head -ceq $ReviewedB4PBaseline
    LocalHead = $head; RemoteHead = $remoteHead; Stash = $stash; ParentCount = $parents.Count; DirectParent = if ($parents.Count -eq 1) { $parents[0] } else { '' }
    StagedPaths = $stagedPaths; TrackedChanges = @($statusLines | Where-Object { -not $_.StartsWith('?? ') })
    UnexpectedUntracked = $unexpectedUntracked; TrackedPaths = $trackedRunnerPaths; CommitChanges = $commitChanges
  })
  [IO.File]::WriteAllText((Join-Path $EvidenceRoot '00-source.txt'), "head=$head`r`nm031_sha256=$ExpectedM031Hash`r`npreflight_sha256=$ExpectedPreflightHash`r`nidentity_sha256=$ExpectedIdentityHash`r`nproject_ref=$ExpectedProjectRef`r`n", [Text.UTF8Encoding]::new($false))
  Add-Marker 'PASS' 'source_integrity'

  foreach ($name in $EnvironmentNames) { $SavedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
  $EnvironmentCaptured = $true
  $SecurePassword = Read-Host 'Staging database password' -AsSecureString
  $PasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
  $PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordPointer)
  if ([string]::IsNullOrEmpty($PlainPassword)) { throw 'empty_password_rejected' }
  $env:PGPASSWORD = $PlainPassword
  $env:PGSSLMODE = 'require'; $env:PGGSSENCMODE = 'disable'; $env:PGCONNECT_TIMEOUT = '15'; $env:PGAPPNAME = 'phase2c_b4p_staging_preflight'
  Add-Marker 'PASS' 'fixed_staging_target_configuration'

  $identity = Invoke-StagingPsql -Stage 'identity' -AdditionalArguments @('-v',"expected_database=$TargetDatabase",'-v',"expected_current_user=$ExpectedCurrentUser",'-v',"expected_server_major=$ExpectedServerMajor",'-f',$IdentitySql)
  $expectedIdentity = "database=$TargetDatabase|current_user=$ExpectedCurrentUser|session_user=$ExpectedCurrentUser|server_major=$ExpectedServerMajor|client_ssl_required=true|backend_ssl="
  $identityValue = Get-ControlValue -Output $identity.Stdout -Prefix 'IDENTITY'
  if ($identityValue -notin @("${expectedIdentity}true|supabase_auth=true", "${expectedIdentity}false|supabase_auth=true")) { throw 'staging_identity_marker_invalid' }
  Add-Marker 'PASS' 'staging_connection_identity'

  $preflight = Invoke-StagingPsql -Stage 'm031_preflight' -AdditionalArguments @('-f',$PreflightSql)
  $preflightRows = @(($preflight.Stdout -split '\r?\n') | Where-Object { $_ -match '^M031_PREFLIGHT\|(?:PASS|FAIL)\|' })
  if ($preflightRows.Count -ne 1 -or $preflightRows[0] -notmatch '^M031_PREFLIGHT\|PASS\|') { throw 'm031_preflight_failed_or_unparseable' }
  [IO.File]::WriteAllText((Join-Path $EvidenceRoot '01-preflight.txt'), $preflight.Stdout, [Text.UTF8Encoding]::new($false))
  Add-Marker 'PASS' 'm031_read_only_preflight'
  Add-Marker 'WARN' 'm031_preflight_is_not_exhaustive_column_or_privilege_validation'
  Add-Marker 'PASS' 'phase2c_b4p_staging_preflight_complete'
  $ExitCode = 0
} catch {
  $reason = [regex]::Replace((ConvertTo-SanitizedDiagnostic $_.Exception.Message), '[^a-zA-Z0-9_:-]', '_').ToLowerInvariant()
  if ([string]::IsNullOrWhiteSpace($reason)) { $reason = 'unexpected_preflight_failure' }
  if (Test-Path -LiteralPath $SummaryPath) { Add-Marker 'BLOCKED' $reason } else { [Console]::WriteLine("BLOCKED|$reason") }
} finally {
  if ($EnvironmentCaptured) { foreach ($name in $EnvironmentNames) { [Environment]::SetEnvironmentVariable($name, $SavedEnvironment[$name], 'Process') } }
  if ($PasswordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordPointer) }
  $PlainPassword = $null
  if ($null -ne $SecurePassword) { $SecurePassword.Dispose() }
}

exit $ExitCode
