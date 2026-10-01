[CmdletBinding()]
param(
  [ValidateSet('Preflight', 'Apply', 'Postflight', 'OfflineProcessTest')]
  [string]$Operation = 'Preflight',
  [string]$ProjectRef = '',
  [string]$DbHost = '',
  [int]$DbPort = 0,
  [string]$DbName = '',
  [string]$DbUser = '',
  [string]$ApprovedPreflightEvidencePath = '',
  [switch]$OfflineValidationOnly,
  [string]$OfflineFlagConfirmation = '',
  [string]$OfflineApplyConfirmation = '',
  [string]$OfflineMigrationPath = '',
  [ValidateSet(
    'Timeout',
    'PrimaryFailureFallbackSuccess',
    'UnconfirmedTermination',
    'AuthenticationFailure',
    'GenericFailure'
  )]
  [string]$OfflineProcessScenario = 'Timeout'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ExpectedProjectRef = 'fsjljliiyfchkwbjifzw'
$script:BlockedProductionRef = 'gznwibespgkwknnvbrlv'
$script:ExpectedDbHost = 'aws-1-eu-central-2.pooler.supabase.com'
$script:ExpectedDbPort = 5432
$script:ExpectedDbName = 'postgres'
$script:ExpectedDbUser = 'postgres.fsjljliiyfchkwbjifzw'
$script:ExpectedMigrationHash = 'bac24995ad801432c6ba53e06d820d7495b0d6bc0bd6e4d1be35e03908648ba9'
$script:FlagConfirmationText = 'STAGING REVIEW ACTION FLAGS DISABLED'
$script:ApplyConfirmationText = 'STAGING APPLY PHASE2B REVIEW HARDENING'
$script:RepoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$script:CanonicalMigrationPath = (Resolve-Path -LiteralPath (Join-Path $script:RepoRoot 'supabase\migrations\20260930000000_phase2b_review_action_intent_hardening.sql')).Path
$script:PreflightPath = (Resolve-Path -LiteralPath (Join-Path $script:RepoRoot 'supabase\ops\phase2b_review_action_hardening_staging_preflight.sql')).Path
$script:PostflightPath = (Resolve-Path -LiteralPath (Join-Path $script:RepoRoot 'supabase\ops\phase2b_review_action_hardening_staging_postflight.sql')).Path
$script:ReviewFlagNames = @(
  'DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED',
  'DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID',
  'DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION',
  'DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID'
)
$script:PgEnvironmentNames = @(
  'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
  'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSSLMODE',
  'PGCONNECT_TIMEOUT', 'PGAPPNAME'
)
$script:BoundaryCounts = [ordered]@{
  PasswordPrompt = 0
  PsqlResolve = 0
  Process = 0
}
$script:JobObjectInteropLoaded = $false

function Write-CompactBlock {
  param(
    [Parameter(Mandatory)][string]$Area,
    [Parameter(Mandatory)][string]$Reason
  )

  throw "BLOCKED|$Area|$Reason"
}

function Assert-StagingTarget {
  $targetText = "$ProjectRef|$DbHost|$DbName|$DbUser"
  if ($ProjectRef -ceq $script:BlockedProductionRef) {
    Write-CompactBlock -Area 'TARGET' -Reason 'production_ref_blocked'
  }
  if ($targetText -match '(?i)gznwibespgkwknnvbrlv|production|\bprod\b|\blive\b') {
    Write-CompactBlock -Area 'TARGET' -Reason 'production_indicator_blocked'
  }
  if ($ProjectRef -cne $script:ExpectedProjectRef -or
      $DbHost -cne $script:ExpectedDbHost -or
      $DbPort -ne $script:ExpectedDbPort -or
      $DbName -cne $script:ExpectedDbName -or
      $DbUser -cne $script:ExpectedDbUser) {
    Write-CompactBlock -Area 'TARGET' -Reason 'staging_tuple_mismatch'
  }
}

function Assert-ReviewFlagsAbsent {
  foreach ($flagName in $script:ReviewFlagNames) {
    $flagValue = [Environment]::GetEnvironmentVariable($flagName, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($flagValue)) {
      Write-CompactBlock -Area 'FLAGS' -Reason 'review_action_flag_present'
    }
  }
}

function Confirm-ReviewFlagsDisabled {
  $confirmation = if ($OfflineValidationOnly) {
    $OfflineFlagConfirmation
  } else {
    (Read-Host 'Type STAGING REVIEW ACTION FLAGS DISABLED').Trim()
  }
  if ($confirmation -cne $script:FlagConfirmationText) {
    Write-CompactBlock -Area 'FLAGS' -Reason 'disabled_confirmation_required'
  }
}

function Confirm-Apply {
  $confirmation = if ($OfflineValidationOnly) {
    $OfflineApplyConfirmation
  } else {
    (Read-Host 'Type STAGING APPLY PHASE2B REVIEW HARDENING').Trim()
  }
  if ($confirmation -cne $script:ApplyConfirmationText) {
    Write-CompactBlock -Area 'APPLY' -Reason 'typed_confirmation_required'
  }
}

function Get-SelectedMigrationPath {
  if (-not [string]::IsNullOrWhiteSpace($OfflineMigrationPath)) {
    if (-not $OfflineValidationOnly) {
      Write-CompactBlock -Area 'SOURCE_HASH' -Reason 'offline_override_not_allowed'
    }
    return (Resolve-Path -LiteralPath $OfflineMigrationPath).Path
  }
  return $script:CanonicalMigrationPath
}

function Assert-MigrationHash {
  param([Parameter(Mandatory)][string]$MigrationPath)

  $freshHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $MigrationPath).Hash.ToLowerInvariant()
  if ($freshHash -cne $script:ExpectedMigrationHash) {
    Write-CompactBlock -Area 'SOURCE_HASH' -Reason 'migration_hash_mismatch'
  }
  return $freshHash
}

function Get-ApprovedPreflightBusinessCounts {
  if ([string]::IsNullOrWhiteSpace($ApprovedPreflightEvidencePath)) {
    Write-CompactBlock -Area 'PREFLIGHT_EVIDENCE' -Reason 'approved_file_required'
  }
  $resolvedEvidencePath = (Resolve-Path -LiteralPath $ApprovedPreflightEvidencePath).Path
  $lines = @(Get-Content -LiteralPath $resolvedEvidencePath | ForEach-Object { ([string]$_).Trim() })
  if ($lines | Where-Object { $_ -match '^(BLOCKED|FAIL)\|' }) {
    Write-CompactBlock -Area 'PREFLIGHT_EVIDENCE' -Reason 'blocked_or_failed'
  }
  foreach ($requiredLine in @(
      'PASS|TARGET|staging_guarded',
      'PASS|PRODUCTION_REF|blocked',
      'PASS|FLAGS|operator_confirmed_disabled',
      'PASS|SOURCE_HASH|20260930000000|matched',
      'PASS|DECISION|READY_FOR_STAGING_REVIEW_HARDENING_APPLY'
    )) {
    if (@($lines | Where-Object { $_ -ceq $requiredLine }).Count -ne 1) {
      Write-CompactBlock -Area 'PREFLIGHT_EVIDENCE' -Reason 'required_line_missing_or_duplicate'
    }
  }
  $businessCounts = @($lines | Where-Object { $_ -match '^PASS\|BUSINESS_ROW_COUNTS\|cases=\d+\|requirements=\d+\|events=\d+\|payments=\d+$' })
  if ($businessCounts.Count -ne 1) {
    Write-CompactBlock -Area 'PREFLIGHT_EVIDENCE' -Reason 'business_counts_invalid'
  }
  return $businessCounts[0]
}

function Resolve-PsqlExecutable {
  $script:BoundaryCounts.PsqlResolve++
  $candidates = @(
    (Get-Command psql.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    (Get-Command psql -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    'C:\Program Files\PostgreSQL\17\bin\psql.exe',
    'C:\Program Files\PostgreSQL\16\bin\psql.exe',
    'C:\Program Files\PostgreSQL\15\bin\psql.exe'
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $resolved = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($resolved)) {
    Write-CompactBlock -Area 'PSQL' -Reason 'not_found'
  }
  return [string]$resolved
}

function ConvertTo-NativeCommandLineArgument {
  param([AllowEmptyString()][string]$Value)

  if ($Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Ensure-JobObjectInterop {
  if ($script:JobObjectInteropLoaded -or $env:OS -ne 'Windows_NT') { return }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class DeraLedgerPhase2BStagingJobObject
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll")]
    private static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll")]
    public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);

    public static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr pointer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(info, pointer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, (uint)length))
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
            return job;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }
}
"@
  $script:JobObjectInteropLoaded = $true
}

function Get-BoundedRedirectedOutput {
  param(
    [Parameter(Mandatory)]$StdoutTask,
    [Parameter(Mandatory)]$StderrTask,
    [int]$TimeoutMilliseconds = 2000
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $stdoutRemaining = [Math]::Max(0, $TimeoutMilliseconds - [int]$stopwatch.ElapsedMilliseconds)
    $stdoutCompleted = $StdoutTask.Wait($stdoutRemaining)
    $stderrRemaining = [Math]::Max(0, $TimeoutMilliseconds - [int]$stopwatch.ElapsedMilliseconds)
    $stderrCompleted = $StderrTask.Wait($stderrRemaining)
    if (-not $stdoutCompleted -or -not $stderrCompleted) {
      return [pscustomobject]@{ Drained = $false; Stdout = ''; Stderr = '' }
    }
    return [pscustomobject]@{
      Drained = $true
      Stdout = [string]$StdoutTask.GetAwaiter().GetResult()
      Stderr = [string]$StderrTask.GetAwaiter().GetResult()
    }
  } catch {
    return [pscustomobject]@{ Drained = $false; Stdout = ''; Stderr = '' }
  } finally {
    $stopwatch.Stop()
  }
}

function Invoke-BoundedTaskKill {
  param([Parameter(Mandatory)][System.Diagnostics.Process]$Process)

  if ($Process.HasExited) { return $false }
  $taskkillPath = "$env:SystemRoot\System32\taskkill.exe"
  if (-not (Test-Path -LiteralPath $taskkillPath -PathType Leaf)) { return $false }
  $taskkillInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $taskkillInfo.FileName = $taskkillPath
  $taskkillInfo.Arguments = "/PID $($Process.Id) /T /F"
  $taskkillInfo.RedirectStandardOutput = $true
  $taskkillInfo.RedirectStandardError = $true
  $taskkillInfo.UseShellExecute = $false
  $taskkillInfo.CreateNoWindow = $true
  $taskkill = [System.Diagnostics.Process]::new()
  $taskkill.StartInfo = $taskkillInfo
  try {
    [void]$taskkill.Start()
    $stdoutTask = $taskkill.StandardOutput.ReadToEndAsync()
    $stderrTask = $taskkill.StandardError.ReadToEndAsync()
    if (-not $taskkill.WaitForExit(5000)) {
      try { $taskkill.Kill() } catch {}
      [void]$taskkill.WaitForExit(1000)
      return $false
    }
    [void](Get-BoundedRedirectedOutput -StdoutTask $stdoutTask -StderrTask $stderrTask -TimeoutMilliseconds 500)
    return $taskkill.ExitCode -eq 0
  } catch {
    return $false
  } finally {
    $taskkill.Dispose()
  }
}

function Invoke-LastChanceProcessTreeTermination {
  param([Parameter(Mandatory)][System.Diagnostics.Process]$Process)

  if ($env:OS -eq 'Windows_NT') {
    return Invoke-BoundedTaskKill -Process $Process
  }
  try {
    $Process.Kill($true)
    return $true
  } catch {
    try {
      $Process.Kill()
      return $true
    } catch {
      return $false
    }
  }
}

function Invoke-TimeoutTermination {
  param(
    [Parameter(Mandatory)][scriptblock]$PrimaryTerminate,
    [Parameter(Mandatory)][scriptblock]$FallbackTerminate,
    [Parameter(Mandatory)][scriptblock]$WaitForExit
  )

  $primary = & $PrimaryTerminate
  $rootExited = [bool](& $WaitForExit 2000)
  $terminationConfirmed = [bool]$primary.Requested -and $rootExited
  $fallbackAttempted = $false
  $fallbackSucceeded = $false
  if (-not $terminationConfirmed) {
    $fallbackAttempted = $true
    $fallbackSucceeded = [bool](& $FallbackTerminate)
    $rootExited = [bool](& $WaitForExit 3000)
    $terminationConfirmed = $fallbackSucceeded -and $rootExited
  }
  return [pscustomobject]@{
    TerminationConfirmed = $terminationConfirmed
    RootExited = $rootExited
    PrimaryRequested = [bool]$primary.Requested
    FallbackAttempted = $fallbackAttempted
    FallbackSucceeded = $fallbackSucceeded
    JobHandleClosed = [bool]$primary.HandleClosed
  }
}

function Invoke-CapturedNativeProcess {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$NativeArguments,
    [Parameter(Mandatory)][int]$TimeoutSeconds
  )

  $script:BoundaryCounts.Process++
  $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = $FilePath
  $processInfo.Arguments = (($NativeArguments | ForEach-Object { ConvertTo-NativeCommandLineArgument -Value $_ }) -join ' ')
  $processInfo.WorkingDirectory = $script:RepoRoot
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $processInfo
  $jobHandle = [IntPtr]::Zero
  $jobOwnsProcessTree = $false
  try {
    [void]$process.Start()
    if ($env:OS -eq 'Windows_NT') {
      Ensure-JobObjectInterop
      $jobHandle = [DeraLedgerPhase2BStagingJobObject]::CreateKillOnCloseJob()
      if ($jobHandle -ne [IntPtr]::Zero) {
        $jobOwnsProcessTree = [DeraLedgerPhase2BStagingJobObject]::AssignProcessToJobObject($jobHandle, $process.Handle)
      }
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
    $processTreeTerminated = $false
    if ($timedOut) {
      $termination = Invoke-TimeoutTermination `
        -PrimaryTerminate {
          if ($jobOwnsProcessTree -and $jobHandle -ne [IntPtr]::Zero) {
            $closed = [DeraLedgerPhase2BStagingJobObject]::CloseHandle($jobHandle)
            return [pscustomobject]@{ Requested = $closed; HandleClosed = $closed }
          }
          return [pscustomobject]@{ Requested = $false; HandleClosed = $false }
        } `
        -FallbackTerminate { Invoke-LastChanceProcessTreeTermination -Process $process } `
        -WaitForExit { param($milliseconds) $process.WaitForExit([int]$milliseconds) }
      $processTreeTerminated = $termination.TerminationConfirmed
      if ($termination.JobHandleClosed) { $jobHandle = [IntPtr]::Zero }
    }
    $output = Get-BoundedRedirectedOutput `
      -StdoutTask $stdoutTask `
      -StderrTask $stderrTask `
      -TimeoutMilliseconds 2000
    return [pscustomobject]@{
      ExitCode = if ($timedOut) { 124 } else { $process.ExitCode }
      TimedOut = $timedOut
      ProcessTreeTerminated = $processTreeTerminated
      OutputDrained = $output.Drained
      Stdout = [string]$output.Stdout
      Stderr = [string]$output.Stderr
    }
  }
  finally {
    if ($jobHandle -ne [IntPtr]::Zero) {
      [void][DeraLedgerPhase2BStagingJobObject]::CloseHandle($jobHandle)
    }
    $process.Dispose()
  }
}

function Get-SafeDiagnosticCategory {
  param(
    [AllowNull()][string]$Stdout,
    [AllowNull()][string]$Stderr
  )

  $combined = (($Stderr, $Stdout) -join "`n")
  if ($combined.Length -gt 1048576) { $combined = $combined.Substring(0, 1048576) }
  if ($combined -match '(?i)password authentication failed|authentication failed|no password supplied|SASL') { return 'authentication_failed' }
  if ($combined -match '(?i)lock timeout|canceling statement due to lock timeout|could not obtain lock') { return 'lock_timeout' }
  if ($combined -match '(?i)statement timeout|canceling statement due to statement timeout') { return 'statement_timeout' }
  if ($combined -match '(?i)could not connect|connection refused|connection timed out|server closed the connection|could not translate host name|network is unreachable|SSL SYSCALL|timeout expired') { return 'network_or_tls_failure' }
  if ($combined -match '(?i)permission denied|must be owner|insufficient privilege') { return 'permission_denied' }
  if ($combined -match '(?i)syntax error') { return 'syntax_error' }
  if ($combined -match '(?i)does not exist|already exists|duplicate object|undefined (?:table|function|column)|catalog') { return 'catalog_mismatch' }
  return 'psql_error'
}

function Get-NativeFailureEvidence {
  param(
    [Parameter(Mandatory)][string]$Phase,
    [Parameter(Mandatory)]$Result
  )

  if ($Result.TimedOut) {
    $terminationCategory = if ($Result.ProcessTreeTerminated) {
      'timeout_process_tree_terminated'
    } else {
      'timeout_process_tree_termination_unconfirmed'
    }
    return @(
      "BLOCKED|$Phase|native_process_timeout",
      "BLOCKED|${Phase}_DIAGNOSTIC|$terminationCategory"
    )
  }
  if (-not $Result.OutputDrained) {
    return @(
      "BLOCKED|$Phase|output_drain_timeout",
      "BLOCKED|${Phase}_DIAGNOSTIC|output_drain_incomplete"
    )
  }
  if ($Result.ExitCode -ne 0) {
    $category = Get-SafeDiagnosticCategory -Stdout $Result.Stdout -Stderr $Result.Stderr
    return @(
      "BLOCKED|$Phase|psql_exit_nonzero",
      "BLOCKED|${Phase}_DIAGNOSTIC|$category"
    )
  }
  return @()
}

function Get-PhaseTimeoutSettings {
  param([Parameter(Mandatory)][string]$Phase)

  switch ($Phase) {
    'APPLY' {
      return [pscustomobject]@{ NativeSeconds = 900; StatementMs = 840000; LockMs = 30000 }
    }
    default {
      return [pscustomobject]@{ NativeSeconds = 120; StatementMs = 90000; LockMs = 10000 }
    }
  }
}

function Invoke-StagingSqlPhase {
  param(
    [Parameter(Mandatory)][ValidateSet('PREFLIGHT', 'APPLY', 'POSTFLIGHT')][string]$Phase,
    [Parameter(Mandatory)][string]$SqlFile,
    [Parameter(Mandatory)][string]$MigrationPath
  )

  # This is the credential boundary. Every invocation revalidates the complete
  # target and protected flags before executable resolution or password input.
  Assert-StagingTarget
  Assert-ReviewFlagsAbsent
  if ($Phase -eq 'APPLY') { [void](Assert-MigrationHash -MigrationPath $MigrationPath) }

  if ($OfflineValidationOnly) {
    return [pscustomobject]@{
      Evidence = @('PASS|OFFLINE_BOUNDARIES|password=0|psql_resolve=0|process=0')
    }
  }

  $psqlExecutable = Resolve-PsqlExecutable
  $script:BoundaryCounts.PasswordPrompt++
  $securePassword = Read-Host 'Staging database password (local prompt; never echoed)' -AsSecureString
  $passwordBstr = [IntPtr]::Zero
  $savedEnvironment = @{}
  $settings = Get-PhaseTimeoutSettings -Phase $Phase
  try {
    foreach ($name in $script:PgEnvironmentNames) {
      $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
      [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    [Environment]::SetEnvironmentVariable('PGPASSWORD', [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr), 'Process')
    [Environment]::SetEnvironmentVariable('PGSSLMODE', 'require', 'Process')
    [Environment]::SetEnvironmentVariable('PGCONNECT_TIMEOUT', '15', 'Process')
    [Environment]::SetEnvironmentVariable('PGAPPNAME', 'deraledger_phase2b_review_hardening', 'Process')
    [Environment]::SetEnvironmentVariable(
      'PGOPTIONS',
      "-c lock_timeout=$($settings.LockMs) -c statement_timeout=$($settings.StatementMs) -c idle_in_transaction_session_timeout=$($settings.StatementMs)",
      'Process'
    )

    # Revalidate again immediately before the native boundary. APPLY also
    # recomputes the source hash here, after any password-entry delay.
    Assert-StagingTarget
    Assert-ReviewFlagsAbsent
    if ($Phase -eq 'APPLY') { [void](Assert-MigrationHash -MigrationPath $MigrationPath) }

    $psqlArguments = @(
      '-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
      '-h', $DbHost, '-p', ([string]$DbPort), '-U', $DbUser, '-d', $DbName,
      '-f', $SqlFile
    )
    $result = Invoke-CapturedNativeProcess -FilePath $psqlExecutable -NativeArguments $psqlArguments -TimeoutSeconds $settings.NativeSeconds
    $failureEvidence = @(Get-NativeFailureEvidence -Phase $Phase -Result $result)
    if ($failureEvidence.Count -gt 0) {
      throw ($failureEvidence -join "`n")
    }

    $evidence = @(
      (($result.Stdout, $result.Stderr) -join "`n") -split "(`r`n|`n|`r)" |
        ForEach-Object { ([string]$_).Trim() } |
        Where-Object { $_ -match '^(PASS|BLOCKED|FAIL)\|' }
    )
    if ($evidence | Where-Object { $_ -match '^(BLOCKED|FAIL)\|' }) {
      throw ($evidence -join "`n")
    }
    return [pscustomobject]@{ Evidence = $evidence }
  }
  finally {
    if ($passwordBstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
    }
    foreach ($name in $script:PgEnvironmentNames) {
      [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
  }
}

function Invoke-OfflineProcessTest {
  $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('deraledger-phase2b-process-' + [guid]::NewGuid().ToString('N'))
  [void](New-Item -ItemType Directory -Path $tempRoot)
  $childScript = Join-Path $tempRoot 'child.ps1'
  $grandchildPidPath = Join-Path $tempRoot 'grandchild.pid'
  $powerShellExecutable = (Get-Process -Id $PID).Path
  try {
    switch ($OfflineProcessScenario) {
      'Timeout' {
        $childSource = @"
Start-Sleep -Milliseconds 800
`$childInfo = [System.Diagnostics.ProcessStartInfo]::new()
`$childInfo.FileName = '$($powerShellExecutable.Replace("'", "''"))'
`$childInfo.Arguments = '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 30"'
`$childInfo.UseShellExecute = `$false
`$child = [System.Diagnostics.Process]::Start(`$childInfo)
[IO.File]::WriteAllText('$($grandchildPidPath.Replace("'", "''"))', [string]`$child.Id)
Start-Sleep -Seconds 30
"@
        [IO.File]::WriteAllText($childScript, $childSource, [Text.UTF8Encoding]::new($false))
        $result = Invoke-CapturedNativeProcess -FilePath $powerShellExecutable -NativeArguments @('-NoProfile', '-NonInteractive', '-File', $childScript) -TimeoutSeconds 3
        if (-not $result.TimedOut -or -not $result.ProcessTreeTerminated) {
          Write-CompactBlock -Area 'OFFLINE_PROCESS_TEST' -Reason 'timeout_tree_termination_failed'
        }
        if (Test-Path -LiteralPath $grandchildPidPath) {
          $grandchildId = [int](Get-Content -Raw -LiteralPath $grandchildPidPath)
          Start-Sleep -Milliseconds 300
          if (Get-Process -Id $grandchildId -ErrorAction SilentlyContinue) {
            Write-CompactBlock -Area 'OFFLINE_PROCESS_TEST' -Reason 'orphaned_descendant'
          }
        }
        $failureEvidence = @(Get-NativeFailureEvidence -Phase 'SELFTEST' -Result $result)
        if ($failureEvidence -notcontains 'BLOCKED|SELFTEST|native_process_timeout' -or
            $failureEvidence -notcontains 'BLOCKED|SELFTEST_DIAGNOSTIC|timeout_process_tree_terminated') {
          Write-CompactBlock -Area 'OFFLINE_PROCESS_TEST' -Reason 'timeout_evidence_failed'
        }
        foreach ($line in $failureEvidence) { Write-Output $line }
        Write-Output 'PASS|OFFLINE_PROCESS_TEST|timeout_process_tree_terminated'
      }
      'PrimaryFailureFallbackSuccess' {
        $state = [pscustomobject]@{ Primary = 0; Fallback = 0; Wait = 0 }
        $termination = Invoke-TimeoutTermination `
          -PrimaryTerminate {
            $state.Primary++
            [pscustomobject]@{ Requested = $false; HandleClosed = $false }
          } `
          -FallbackTerminate {
            $state.Fallback++
            $true
          } `
          -WaitForExit {
            param($milliseconds)
            $state.Wait++
            return $state.Wait -ge 2
          }
        if (-not $termination.TerminationConfirmed -or
            $termination.JobHandleClosed -or
            $state.Primary -ne 1 -or
            $state.Fallback -ne 1 -or
            $state.Wait -ne 2) {
          Write-CompactBlock -Area 'OFFLINE_PROCESS_TEST' -Reason 'fallback_success_contract_failed'
        }
        $failureEvidence = @(Get-NativeFailureEvidence -Phase 'SELFTEST' -Result ([pscustomobject]@{
          TimedOut = $true
          ProcessTreeTerminated = $termination.TerminationConfirmed
          OutputDrained = $false
          ExitCode = 124
          Stdout = ''
          Stderr = ''
        }))
        foreach ($line in $failureEvidence) { Write-Output $line }
        Write-Output 'PASS|OFFLINE_PROCESS_TEST|primary_failed_fallback_succeeded|handle_cleanup_preserved'
      }
      'UnconfirmedTermination' {
        $state = [pscustomobject]@{ Primary = 0; Fallback = 0; Wait = 0 }
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $termination = Invoke-TimeoutTermination `
          -PrimaryTerminate {
            $state.Primary++
            [pscustomobject]@{ Requested = $false; HandleClosed = $false }
          } `
          -FallbackTerminate {
            $state.Fallback++
            $false
          } `
          -WaitForExit {
            param($milliseconds)
            $state.Wait++
            Start-Sleep -Milliseconds 50
            return $false
          }
        $stopwatch.Stop()
        if ($termination.TerminationConfirmed -or
            $termination.JobHandleClosed -or
            $state.Primary -ne 1 -or
            $state.Fallback -ne 1 -or
            $state.Wait -ne 2 -or
            $stopwatch.ElapsedMilliseconds -gt 1000) {
          Write-CompactBlock -Area 'OFFLINE_PROCESS_TEST' -Reason 'unconfirmed_termination_contract_failed'
        }
        $openStdout = [System.Threading.Tasks.TaskCompletionSource[string]]::new()
        $openStderr = [System.Threading.Tasks.TaskCompletionSource[string]]::new()
        $drainStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $boundedOutput = Get-BoundedRedirectedOutput `
          -StdoutTask $openStdout.Task `
          -StderrTask $openStderr.Task `
          -TimeoutMilliseconds 200
        $drainStopwatch.Stop()
        if ($boundedOutput.Drained -or $drainStopwatch.ElapsedMilliseconds -gt 1000) {
          Write-CompactBlock -Area 'OFFLINE_PROCESS_TEST' -Reason 'open_stream_drain_not_bounded'
        }
        $failureEvidence = @(Get-NativeFailureEvidence -Phase 'SELFTEST' -Result ([pscustomobject]@{
          TimedOut = $true
          ProcessTreeTerminated = $false
          OutputDrained = $false
          ExitCode = 124
          Stdout = 'raw-output-must-not-appear'
          Stderr = 'postgresql-secret-must-not-appear'
        }))
        foreach ($line in $failureEvidence) { Write-Output $line }
        Write-Output 'PASS|OFFLINE_PROCESS_TEST|termination_unconfirmed_returned_promptly|handle_cleanup_preserved'
      }
      'AuthenticationFailure' {
        [IO.File]::WriteAllText(
          $childScript,
          "[Console]::Error.WriteLine('password authentication failed ' + 'postgres' + 'ql://user:secret@host/db token=abcdefghijklmnopqrstuvwxyz0123456789'); exit 2",
          [Text.UTF8Encoding]::new($false)
        )
        $result = Invoke-CapturedNativeProcess -FilePath $powerShellExecutable -NativeArguments @('-NoProfile', '-NonInteractive', '-File', $childScript) -TimeoutSeconds 10
        $failureEvidence = @(Get-NativeFailureEvidence -Phase 'SELFTEST' -Result $result)
        if ($result.ExitCode -eq 0 -or
            $failureEvidence -notcontains 'BLOCKED|SELFTEST_DIAGNOSTIC|authentication_failed') {
          Write-CompactBlock -Area 'OFFLINE_PROCESS_TEST' -Reason 'authentication_classification_failed'
        }
        foreach ($line in $failureEvidence) { Write-Output $line }
        Write-Output 'PASS|OFFLINE_PROCESS_TEST|authentication_failed_redacted'
      }
      'GenericFailure' {
        [IO.File]::WriteAllText($childScript, 'exit 3', [Text.UTF8Encoding]::new($false))
        $result = Invoke-CapturedNativeProcess -FilePath $powerShellExecutable -NativeArguments @('-NoProfile', '-NonInteractive', '-File', $childScript) -TimeoutSeconds 10
        $failureEvidence = @(Get-NativeFailureEvidence -Phase 'SELFTEST' -Result $result)
        if ($result.ExitCode -eq 0 -or
            $failureEvidence -notcontains 'BLOCKED|SELFTEST_DIAGNOSTIC|psql_error') {
          Write-CompactBlock -Area 'OFFLINE_PROCESS_TEST' -Reason 'generic_classification_failed'
        }
        foreach ($line in $failureEvidence) { Write-Output $line }
        Write-Output 'PASS|OFFLINE_PROCESS_TEST|generic_failure_bounded'
      }
    }
  }
  finally {
    if (Test-Path -LiteralPath $tempRoot) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
  }
}

function Invoke-Main {
  if ($Operation -eq 'OfflineProcessTest') {
    Invoke-OfflineProcessTest
    return
  }

  Assert-StagingTarget
  Assert-ReviewFlagsAbsent
  Confirm-ReviewFlagsDisabled
  $migrationPath = Get-SelectedMigrationPath
  [void](Assert-MigrationHash -MigrationPath $migrationPath)

  $preflightCounts = $null
  if ($Operation -in @('Apply', 'Postflight')) {
    $preflightCounts = Get-ApprovedPreflightBusinessCounts
  }
  if ($Operation -eq 'Apply') { Confirm-Apply }

  Write-Output 'PASS|TARGET|staging_guarded'
  Write-Output 'PASS|PRODUCTION_REF|blocked'
  Write-Output 'PASS|FLAGS|operator_confirmed_disabled'
  Write-Output 'PASS|SOURCE_HASH|20260930000000|matched'

  switch ($Operation) {
    'Preflight' {
      $result = Invoke-StagingSqlPhase -Phase 'PREFLIGHT' -SqlFile $script:PreflightPath -MigrationPath $migrationPath
      foreach ($line in $result.Evidence) { Write-Output $line }
      if ($OfflineValidationOnly) { return }
      if ($result.Evidence -notcontains 'PASS|DECISION|READY_FOR_STAGING_REVIEW_HARDENING_APPLY') {
        Write-CompactBlock -Area 'PREFLIGHT' -Reason 'final_pass_missing'
      }
    }
    'Apply' {
      $result = Invoke-StagingSqlPhase -Phase 'APPLY' -SqlFile $migrationPath -MigrationPath $migrationPath
      foreach ($line in $result.Evidence) { Write-Output $line }
      if ($OfflineValidationOnly) { return }
      Write-Output 'PASS|APPLY|20260930000000|committed'
    }
    'Postflight' {
      $result = Invoke-StagingSqlPhase -Phase 'POSTFLIGHT' -SqlFile $script:PostflightPath -MigrationPath $migrationPath
      foreach ($line in $result.Evidence) { Write-Output $line }
      if ($OfflineValidationOnly) { return }
      if ($result.Evidence -notcontains 'PASS|POSTFLIGHT|OBJECTS_AND_SECURITY_EXACT') {
        Write-CompactBlock -Area 'POSTFLIGHT' -Reason 'final_pass_missing'
      }
      $postflightCounts = @($result.Evidence | Where-Object { $_ -match '^PASS\|BUSINESS_ROW_COUNTS\|' })
      if ($postflightCounts.Count -ne 1 -or $postflightCounts[0] -cne $preflightCounts) {
        Write-CompactBlock -Area 'BUSINESS_DATA' -Reason 'row_counts_changed'
      }
      Write-Output 'PASS|BUSINESS_DATA|row_counts_unchanged'
      Write-Output 'PASS|DECISION|STAGING_REVIEW_HARDENING_MIGRATION_VERIFIED'
    }
  }
}

try {
  Invoke-Main
  exit 0
} catch {
  $safeFailureLines = @(
    ([string]$_.Exception.Message) -split "(`r`n|`n|`r)" |
      ForEach-Object { ([string]$_).Trim() } |
      Where-Object { $_ -match '^(BLOCKED|FAIL)\|[A-Za-z0-9_|=.-]+$' }
  )
  if ($safeFailureLines.Count -eq 0) {
    Write-Output 'BLOCKED|SCRIPT|unclassified_error'
  } else {
    foreach ($line in $safeFailureLines | Select-Object -First 5) { Write-Output $line }
  }
  if ($OfflineValidationOnly) {
    Write-Output ("BLOCKED|OFFLINE_BOUNDARIES|password={0}|psql_resolve={1}|process={2}" -f
      $script:BoundaryCounts.PasswordPrompt,
      $script:BoundaryCounts.PsqlResolve,
      $script:BoundaryCounts.Process)
  }
  exit 1
}
