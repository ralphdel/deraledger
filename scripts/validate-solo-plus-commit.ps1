[CmdletBinding()]
param(
  [switch]$CollectAllFailures = $true,
  [int]$CommitNumber = 10,
  [string]$OutputDirectory,
  [string]$TestDatabaseUrl = $env:TEST_DATABASE_URL,
  [int]$PsqlTimeoutSeconds = 120,
  [switch]$RunValidatorSelfTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$script:RunId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$script:LogRoot = if ($OutputDirectory) {
  $OutputDirectory
} else {
  Join-Path $env:TEMP ("deraledger-validation\" + $script:RunId)
}
$script:CheckResults = [System.Collections.Generic.List[object]]::new()
$script:CheckResultMap = @{}
$script:ApprovedCommit12Migration = 'supabase/migrations/20260718_01_solo_plus_payment_recovery.sql'
$script:ApprovedCommit13Migrations = @(
  'supabase/migrations/20260728_00_authorization_hardening.sql',
  'supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql',
  'supabase/migrations/20260731_00_verification_disclosure_identity_hardening.sql'
)
$script:JobObjectInteropLoaded = $false

New-Item -ItemType Directory -Path $script:LogRoot -Force | Out-Null

function Ensure-JobObjectInterop {
  if ($script:JobObjectInteropLoaded -or $env:OS -ne 'Windows_NT') {
    return
  }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class DeraLedgerValidatorJobObject
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
    private static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll")]
    public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr hObject);

    public static IntPtr CreateKillOnCloseJob()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            return IntPtr.Zero;
        }

        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr infoPtr = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(info, infoPtr, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, infoPtr, (uint)length))
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
            return job;
        }
        finally
        {
            Marshal.FreeHGlobal(infoPtr);
        }
    }
}
"@
  $script:JobObjectInteropLoaded = $true
}

function Redact-SensitiveText {
  param([AllowNull()][string]$Value)

  if ($null -eq $Value) {
    return ''
  }

  $redacted = [string]$Value
  $password = Get-Item -Path 'Env:PGPASSWORD' -ErrorAction SilentlyContinue
  if ($password -and -not [string]::IsNullOrEmpty([string]$password.Value)) {
    $redacted = $redacted -replace [regex]::Escape([string]$password.Value), '<redacted-password>'
  }

  return [regex]::Replace(
    $redacted,
    '(postgres(?:ql)?://)([^/\s:@]+):([^@\s/]*)@',
    '$1$2:***@',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
}

function New-CheckLogPaths {
  param([string]$CheckId)

  $safeId = $CheckId -replace '[^A-Za-z0-9._-]', '_'
  [pscustomobject]@{
    Stdout = Join-Path $script:LogRoot "$safeId.stdout.log"
    Stderr = Join-Path $script:LogRoot "$safeId.stderr.log"
    Meta   = Join-Path $script:LogRoot "$safeId.meta.json"
  }
}

function Get-ErrorExcerpt {
  param(
    [string]$Stdout,
    [string]$Stderr
  )

  $combined = @($Stderr, $Stdout) -join [Environment]::NewLine
  if ([string]::IsNullOrWhiteSpace($combined)) {
    return ''
  }

  $lines = $combined -split "(`r`n|`n|`r)" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  return ($lines | Select-Object -First 8) -join [Environment]::NewLine
}

function Invoke-CapturedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [int]$TimeoutSeconds = 1800
  )

  $resolvedFilePath = $FilePath
  if (-not ($FilePath -match '[\\/]') -and -not (Test-Path $FilePath)) {
    $resolvedCommand = Get-Command $FilePath -ErrorAction SilentlyContinue
    if ($resolvedCommand) {
      $resolvedFilePath = $resolvedCommand.Source
    }
  }

  $joinedArguments = (($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') {
          '"' + ($_ -replace '"', '\"') + '"'
        } else {
          $_
        }
      }) -join ' ')

  $effectiveFilePath = $resolvedFilePath
  $effectiveArguments = $joinedArguments
  if ($resolvedFilePath -match '\.(cmd|bat)$') {
    $cmdTail = if ([string]::IsNullOrWhiteSpace($joinedArguments)) { '' } else { ' ' + $joinedArguments }
    $effectiveFilePath = $env:ComSpec
    $effectiveArguments = '/d /c ""' + $resolvedFilePath + '"' + $cmdTail + '"'
  }

  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $effectiveFilePath
  $psi.Arguments = $effectiveArguments
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $psi

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $jobHandle = [IntPtr]::Zero
  $jobOwnsProcessTree = $false
  try {
    [void]$process.Start()
    if ($env:OS -eq 'Windows_NT') {
      try {
        Ensure-JobObjectInterop
        $jobHandle = [DeraLedgerValidatorJobObject]::CreateKillOnCloseJob()
        if ($jobHandle -ne [IntPtr]::Zero) {
          $jobOwnsProcessTree = [DeraLedgerValidatorJobObject]::AssignProcessToJobObject($jobHandle, $process.Handle)
        }
      } catch {
        $jobHandle = [IntPtr]::Zero
        $jobOwnsProcessTree = $false
      }
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
    if ($timedOut) {
      try {
        if ($jobOwnsProcessTree -and $jobHandle -ne [IntPtr]::Zero) {
          [void][DeraLedgerValidatorJobObject]::CloseHandle($jobHandle)
          $jobHandle = [IntPtr]::Zero
        } else {
          $process.Kill($true)
        }
      } catch {
        try {
          $process.Kill()
        } catch {
        }
      }
      $process.WaitForExit()
    }

    $stdout = Redact-SensitiveText ($stdoutTask.GetAwaiter().GetResult())
    $stderr = Redact-SensitiveText ($stderrTask.GetAwaiter().GetResult())

    return [pscustomobject]@{
      ExitCode   = if ($timedOut) { 124 } else { $process.ExitCode }
      TimedOut   = $timedOut
      Stdout     = $stdout
      Stderr     = $stderr
      DurationMs = [int][Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
      Command    = Redact-SensitiveText ((@($effectiveFilePath) + @($effectiveArguments)) -join ' ')
    }
  }
  finally {
    $stopwatch.Stop()
    if ($jobHandle -ne [IntPtr]::Zero) {
      try {
        [void][DeraLedgerValidatorJobObject]::CloseHandle($jobHandle)
      } catch {
      }
    }
    $process.Dispose()
  }
}

function Resolve-PsqlPath {
  $command = Get-Command psql.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    $command = Get-Command psql -ErrorAction SilentlyContinue
  }

  if ($command) {
    return $command.Source
  }

  $candidates = @(
    'C:\Program Files\PostgreSQL\17\bin\psql.exe',
    'C:\Program Files\PostgreSQL\16\bin\psql.exe',
    'C:\Program Files\PostgreSQL\15\bin\psql.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Get-BranchName {
  $result = Invoke-CapturedProcess -FilePath 'git' -Arguments @('branch', '--show-current') -WorkingDirectory $script:RepoRoot -TimeoutSeconds 60
  if ($result.ExitCode -ne 0) {
    return $null
  }

  return ($result.Stdout.Trim())
}

function Redact-ConnectionString {
  param([string]$ConnectionString)

  if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
    return '<missing>'
  }

  try {
    $uri = [Uri]$ConnectionString
    $userInfo = if ([string]::IsNullOrWhiteSpace($uri.UserInfo)) { '' } else { ($uri.UserInfo.Split(':')[0] + ':***@') }
    $port = if ($uri.IsDefaultPort) { '' } else { ':' + $uri.Port }
    return '{0}://{1}{2}{3}{4}' -f $uri.Scheme, $userInfo, $uri.Host, $port, $uri.AbsolutePath
  }
  catch {
    return '<unparseable>'
  }
}

function Get-ConnectionStringQueryParameterValue {
  param(
    [Parameter(Mandatory = $true)][Uri]$Uri,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if ([string]::IsNullOrWhiteSpace($Uri.Query)) {
    return $null
  }

  $pattern = '(?:^|[?&])' + [regex]::Escape($Name) + '=([^&]*)'
  $match = [regex]::Match($Uri.Query, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $match.Success) {
    return $null
  }

  return [Uri]::UnescapeDataString($match.Groups[1].Value)
}

function Get-LibpqEnvironmentSnapshot {
  param([string[]]$VariableNames)

  $snapshot = @{}
  foreach ($name in $VariableNames) {
    $entry = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    $snapshot[$name] = if ($null -ne $entry) { [pscustomobject]@{ Present = $true; Value = [string]$entry.Value } } else { [pscustomobject]@{ Present = $false; Value = $null } }
  }

  return $snapshot
}

function Restore-LibpqEnvironment {
  param([hashtable]$Snapshot)

  foreach ($entry in $Snapshot.GetEnumerator()) {
    if ($entry.Value.Present) {
      Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value.Value
    } else {
      Remove-Item -Path "Env:$($entry.Key)" -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-WithLocalDisposableDatabaseEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$ConnectionString,
    [Parameter(Mandatory = $true)][scriptblock]$Operation
  )

  $variableNames = @(
    "PGSSLMODE",
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGDATABASE",
    "PGPASSWORD",
    "PGCONNECT_TIMEOUT",
    "PGSERVICE",
    "PGSERVICEFILE"
  )

  $snapshot = Get-LibpqEnvironmentSnapshot -VariableNames $variableNames
  $originalSslMode = Get-Item -Path "Env:PGSSLMODE" -ErrorAction SilentlyContinue

  try {
    Remove-Item -Path "Env:PGHOST" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGPORT" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGUSER" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGDATABASE" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGCONNECT_TIMEOUT" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGSERVICE" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGSERVICEFILE" -ErrorAction SilentlyContinue

    $uri = [Uri]$ConnectionString
    $explicitSslMode = Get-ConnectionStringQueryParameterValue -Uri $uri -Name "sslmode"
    if ($explicitSslMode -and $explicitSslMode.Trim().ToLowerInvariant() -ne "disable") {
      throw "TEST_DATABASE_URL must not request a contradictory SSL mode for local disposable validation."
    }

    Set-Item -Path "Env:PGSSLMODE" -Value "disable"
    Set-Item -Path "Env:PGCONNECT_TIMEOUT" -Value "10"

    return & $Operation
  }
  finally {
    Restore-LibpqEnvironment -Snapshot $snapshot
    if ($null -eq $originalSslMode) {
      Remove-Item -Path "Env:PGSSLMODE" -ErrorAction SilentlyContinue
    }
  }
}

function Get-DatabaseSafety {
  param([string]$ConnectionString)

  $result = [ordered]@{
    IsSafe          = $false
    Errors          = [System.Collections.Generic.List[string]]::new()
    Host            = $null
    DatabaseName    = $null
    Port            = $null
    RedactedUrl     = Redact-ConnectionString $ConnectionString
    IsLocalHost     = $false
    IsDisposableDb  = $false
  }

  if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
    $result.Errors.Add('TEST_DATABASE_URL is missing.')
    return [pscustomobject]$result
  }

  try {
    $uri = [Uri]$ConnectionString
  }
  catch {
    $result.Errors.Add('TEST_DATABASE_URL is not a valid URI.')
    return [pscustomobject]$result
  }

  if ($uri.Scheme -notin @('postgresql', 'postgres')) {
    $result.Errors.Add("Unsupported database scheme '$($uri.Scheme)'.")
  }

  $dbName = $uri.AbsolutePath.Trim('/')
  $result.Host = $uri.Host
  $result.DatabaseName = $dbName
  $result.Port = if ($uri.IsDefaultPort) { $null } else { $uri.Port }
  $explicitSslMode = Get-ConnectionStringQueryParameterValue -Uri $uri -Name "sslmode"
  if ($explicitSslMode -and $explicitSslMode.Trim().ToLowerInvariant() -ne "disable") {
    $result.Errors.Add("TEST_DATABASE_URL must not request a contradictory SSL mode for local disposable validation.")
  }

  $isLoopback = $false
  if ($uri.Host -in @('localhost', '127.0.0.1', '::1')) {
    $isLoopback = $true
  } else {
    $parsedIp = $null
    if ([System.Net.IPAddress]::TryParse($uri.Host, [ref]$parsedIp)) {
      $isLoopback = [System.Net.IPAddress]::IsLoopback($parsedIp)
    }
  }

  $result.IsLocalHost = $isLoopback
  if (-not $isLoopback) {
    $result.Errors.Add("Database host '$($uri.Host)' is not an approved local disposable host.")
  }

  $disposablePattern = '^(test|tmp|temp|local|dev|commit)[A-Za-z0-9_-]*$'
  $result.IsDisposableDb = $dbName -match $disposablePattern
  if (-not $result.IsDisposableDb) {
    $result.Errors.Add("Database name '$dbName' does not match the disposable-test naming convention.")
  }

  if ($ConnectionString -match '(staging|prod|production|supabase\.co)') {
    $result.Errors.Add('Connection string appears to target staging or production.')
  }

  $result.IsSafe = $result.Errors.Count -eq 0
  return [pscustomobject]$result
}

function Write-CheckResultArtifacts {
  param(
    [Parameter(Mandatory = $true)][pscustomobject]$Result,
    [Parameter(Mandatory = $true)]$LogPaths
  )

  Set-Content -Path $LogPaths.Stdout -Value $Result.Stdout -Encoding UTF8
  Set-Content -Path $LogPaths.Stderr -Value $Result.Stderr -Encoding UTF8
  Set-Content -Path $LogPaths.Meta -Value ($Result | ConvertTo-Json -Depth 6) -Encoding UTF8
}

function Save-CheckResult {
  param([pscustomobject]$Result)

  $script:CheckResults.Add($Result) | Out-Null
  $script:CheckResultMap[$Result.Id] = $Result
}

function New-BlockedResult {
  param(
    [pscustomobject]$Check,
    [string]$Reason
  )

  $logPaths = New-CheckLogPaths -CheckId $Check.Id
  $result = [pscustomobject]@{
    Id                = $Check.Id
    Name              = $Check.Name
    Phase             = $Check.Phase
    Status            = 'BLOCKED'
    ExitCode          = $null
    DurationMs        = 0
    RootCauseCategory = $Check.RootCauseCategory
    Command           = $Check.CommandDisplay
    Stdout            = ''
    Stderr            = $Reason
    ErrorExcerpt      = $Reason
    StdoutLog         = $logPaths.Stdout
    StderrLog         = $logPaths.Stderr
    MetaLog           = $logPaths.Meta
  }
  Write-CheckResultArtifacts -Result $result -LogPaths $logPaths
  return $result
}

function Test-NeedsSanitizedLibpqEnvironment {
  param([pscustomobject]$Check)

  return (
    $Check.Id -like 'SQL-*' -or
    $Check.RootCauseCategory -in @(
      'sql-suite-foundation',
      'sql-suite-commit7',
      'sql-suite-commit9',
      'sql-suite-commit10',
      'sql-suite-commit12',
      'migration-rerun',
      'harness-safety',
      'hostile-harness'
    )
  )
}

function Invoke-ManifestCheck {
  param(
    [pscustomobject]$Check,
    [hashtable]$Context
  )

  foreach ($dependencyId in $Check.DependsOn) {
    $dependencyResult = $script:CheckResultMap[$dependencyId]
    if (-not $dependencyResult -or $dependencyResult.Status -ne 'PASS') {
      $dependencyStatus = if ($dependencyResult) { $dependencyResult.Status } else { 'missing' }
      return (New-BlockedResult -Check $Check -Reason "Blocked by dependency $dependencyId with status $dependencyStatus.")
    }
  }

  $logPaths = New-CheckLogPaths -CheckId $Check.Id
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $operation = {
      if ($Check.Type -eq 'command') {
        $commandResult = Invoke-CapturedProcess -FilePath $Check.FilePath -Arguments $Check.Arguments -WorkingDirectory $Check.WorkingDirectory -TimeoutSeconds $Check.TimeoutSeconds
        $status = if ($commandResult.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }
        return [pscustomobject]@{
          Id                = $Check.Id
          Name              = $Check.Name
          Phase             = $Check.Phase
          Status            = $status
          ExitCode          = $commandResult.ExitCode
          DurationMs        = $commandResult.DurationMs
          RootCauseCategory = $Check.RootCauseCategory
          Command           = $commandResult.Command
          Stdout            = $commandResult.Stdout
          Stderr            = $commandResult.Stderr
          ErrorExcerpt      = Get-ErrorExcerpt -Stdout $commandResult.Stdout -Stderr $commandResult.Stderr
          StdoutLog         = $logPaths.Stdout
          StderrLog         = $logPaths.Stderr
          MetaLog           = $logPaths.Meta
        }
      }

      $callbackResult = & $Check.Callback $Context
      $stdout = if ($null -ne $callbackResult.Stdout) { [string]$callbackResult.Stdout } else { '' }
      $stderr = if ($null -ne $callbackResult.Stderr) { [string]$callbackResult.Stderr } else { '' }
      $status = if ($null -ne $callbackResult.Status) { [string]$callbackResult.Status } else { 'FAIL' }
      $exitCode = $callbackResult.ExitCode
      return [pscustomobject]@{
        Id                = $Check.Id
        Name              = $Check.Name
        Phase             = $Check.Phase
        Status            = $status
        ExitCode          = $exitCode
        DurationMs        = [int][Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
        RootCauseCategory = $Check.RootCauseCategory
        Command           = $Check.CommandDisplay
        Stdout            = $stdout
        Stderr            = $stderr
        ErrorExcerpt      = Get-ErrorExcerpt -Stdout $stdout -Stderr $stderr
        StdoutLog         = $logPaths.Stdout
        StderrLog         = $logPaths.Stderr
        MetaLog           = $logPaths.Meta
      }
    }

    $result = if (Test-NeedsSanitizedLibpqEnvironment -Check $Check) {
      Invoke-WithLocalDisposableDatabaseEnvironment -ConnectionString $Context.TestDatabaseUrl -Operation $operation
    } else {
      & $operation
    }
    Write-CheckResultArtifacts -Result $result -LogPaths $logPaths
    return $result
  }
  catch {
    $result = [pscustomobject]@{
      Id                = $Check.Id
      Name              = $Check.Name
      Phase             = $Check.Phase
      Status            = 'FAIL'
      ExitCode          = 1
      DurationMs        = [int][Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
      RootCauseCategory = $Check.RootCauseCategory
      Command           = $Check.CommandDisplay
      Stdout            = ''
      Stderr            = $_ | Out-String
      ErrorExcerpt      = ($_ | Out-String).Trim()
      StdoutLog         = $logPaths.Stdout
      StderrLog         = $logPaths.Stderr
      MetaLog           = $logPaths.Meta
    }
    Write-CheckResultArtifacts -Result $result -LogPaths $logPaths
    return $result
  }
  finally {
    $stopwatch.Stop()
  }
}

function New-CommandCheck {
  param(
    [string]$Id,
    [string]$Name,
    [string]$Phase,
    [string]$RootCauseCategory,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = $script:RepoRoot,
    [int]$TimeoutSeconds = 1800,
    [string[]]$DependsOn = @()
  )

  return [pscustomobject]@{
    Id                = $Id
    Name              = $Name
    Phase             = $Phase
    Type              = 'command'
    RootCauseCategory = $RootCauseCategory
    FilePath          = $FilePath
    Arguments         = $Arguments
    WorkingDirectory  = $WorkingDirectory
    TimeoutSeconds    = $TimeoutSeconds
    DependsOn         = $DependsOn
    CommandDisplay    = (@($FilePath) + $Arguments) -join ' '
    Callback          = $null
  }
}

function New-CallbackCheck {
  param(
    [string]$Id,
    [string]$Name,
    [string]$Phase,
    [string]$RootCauseCategory,
    [scriptblock]$Callback,
    [string]$CommandDisplay,
    [string[]]$DependsOn = @()
  )

  return [pscustomobject]@{
    Id                = $Id
    Name              = $Name
    Phase             = $Phase
    Type              = 'callback'
    RootCauseCategory = $RootCauseCategory
    FilePath          = $null
    Arguments         = @()
    WorkingDirectory  = $script:RepoRoot
    TimeoutSeconds    = 1800
    DependsOn         = $DependsOn
    CommandDisplay    = $CommandDisplay
    Callback          = $Callback
  }
}

function Invoke-PsqlCaptured {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Context,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [int]$TimeoutSeconds = $PsqlTimeoutSeconds
  )

  return Invoke-CapturedProcess -FilePath $Context.PsqlPath -Arguments $Arguments -WorkingDirectory $script:RepoRoot -TimeoutSeconds $TimeoutSeconds
}

function Invoke-PsqlFileStrict {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Context,
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [int]$TimeoutSeconds = $PsqlTimeoutSeconds
  )

  $fullPath = Join-Path $script:RepoRoot $RelativePath
  if (-not (Test-Path $fullPath)) {
    throw "Missing SQL file: $RelativePath"
  }

  $result = Invoke-PsqlCaptured -Context $Context -Arguments @('-X', '-w', '-v', 'ON_ERROR_STOP=1', '-d', $Context.TestDatabaseUrl, '-f', $fullPath) -TimeoutSeconds $TimeoutSeconds
  if ($result.ExitCode -ne 0) {
    if ($result.TimedOut) {
      throw "$RelativePath timed out after $TimeoutSeconds seconds. The psql child process tree was terminated.`n$($result.Stderr)`n$($result.Stdout)"
    }
    throw "$RelativePath failed with exit code $($result.ExitCode)`n$($result.Stderr)`n$($result.Stdout)"
  }

  return $result
}

function Invoke-PsqlSqlStrict {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Context,
    [Parameter(Mandatory = $true)][string]$Sql,
    [int]$TimeoutSeconds = $PsqlTimeoutSeconds
  )

  $tempFile = Join-Path $env:TEMP ("solo-plus-validate-" + [guid]::NewGuid().ToString('N') + '.sql')
  try {
    Set-Content -Path $tempFile -Value $Sql -Encoding UTF8
    $result = Invoke-PsqlCaptured -Context $Context -Arguments @('-X', '-w', '-v', 'ON_ERROR_STOP=1', '-d', $Context.TestDatabaseUrl, '-f', $tempFile) -TimeoutSeconds $TimeoutSeconds
    if ($result.ExitCode -ne 0) {
      if ($result.TimedOut) {
        throw "Inline SQL timed out after $TimeoutSeconds seconds. The psql child process tree was terminated.`n$($result.Stderr)`n$($result.Stdout)"
      }
      throw "Inline SQL failed with exit code $($result.ExitCode)`n$($result.Stderr)`n$($result.Stdout)"
    }
    return $result
  }
  finally {
    if (Test-Path $tempFile) {
      Remove-Item -LiteralPath $tempFile -Force
    }
  }
}

function Reset-DisposableDatabase {
  param([hashtable]$Context)

  $resetSql = @'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULL::uuid $$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$ SELECT 'authenticated'::text $$;
'@

  Invoke-PsqlSqlStrict -Context $Context -Sql $resetSql | Out-Null
}

function Initialize-HostileBrowserDefaultTableAndFunctionGrants {
  param([hashtable]$Context)

  $sql = @'
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;
'@

  Invoke-PsqlSqlStrict -Context $Context -Sql $sql | Out-Null
}

function Initialize-PaymentRecordsStagingDriftFixture {
  param([hashtable]$Context)

  $sql = @'
ALTER TABLE public.payment_records DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_read_payment_records ON public.payment_records;

REVOKE ALL ON TABLE public.payment_records FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_records FROM anon;
REVOKE ALL ON TABLE public.payment_records FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payment_records TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payment_records TO authenticated;
'@

  Invoke-PsqlSqlStrict -Context $Context -Sql $sql | Out-Null
}

function Initialize-FoundationFixture {
  param([hashtable]$Context)

  $fixtureFiles = @(
    'supabase/staging/001_schema_only.sql',
    'supabase/staging/002_onboarding_verification_upgrade_flow.sql',
    'supabase/staging/003_rls_policies.sql',
    'supabase/staging/004_phase1_plan_compatibility.sql',
    'supabase/staging/006_solo_plus_prerequisites.sql',
    'supabase/staging/007_solo_plus_case_foundation.sql'
  )

  foreach ($file in $fixtureFiles) {
    Invoke-PsqlFileStrict -Context $Context -RelativePath $file | Out-Null
  }

  Initialize-HostileBrowserDefaultTableAndFunctionGrants -Context $Context
  Initialize-PaymentRecordsStagingDriftFixture -Context $Context
}

function Initialize-CoreFixture {
  param([hashtable]$Context)

  Initialize-FoundationFixture -Context $Context
  Invoke-PsqlFileStrict -Context $Context -RelativePath 'supabase/staging/008_solo_plus_transactional_repository_rpcs.sql' | Out-Null
}

function Bootstrap-ThroughCommit10 {
  param([hashtable]$Context)

  Reset-DisposableDatabase -Context $Context
  Initialize-CoreFixture -Context $Context

  foreach ($file in @(
    'supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql',
    'supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql',
    'supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql',
    'supabase/migrations/20260711_01_solo_plus_activation_rpc.sql'
  )) {
    Invoke-PsqlFileStrict -Context $Context -RelativePath $file | Out-Null
  }
}

function Bootstrap-ThroughCommit12 {
  param([hashtable]$Context)

  Bootstrap-ThroughCommit10 -Context $Context
  Invoke-PsqlFileStrict -Context $Context -RelativePath 'supabase/migrations/20260718_01_solo_plus_payment_recovery.sql' | Out-Null
}

function Bootstrap-ThroughCommit13 {
  param([hashtable]$Context)

  Bootstrap-ThroughCommit12 -Context $Context
  Invoke-PsqlFileStrict -Context $Context -RelativePath 'supabase/migrations/20260728_00_authorization_hardening.sql' | Out-Null
  Invoke-PsqlFileStrict -Context $Context -RelativePath 'supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
  Invoke-PsqlFileStrict -Context $Context -RelativePath 'supabase/migrations/20260731_00_verification_disclosure_identity_hardening.sql' | Out-Null
}

function Bootstrap-ThroughCommit9 {
  param([hashtable]$Context)

  Reset-DisposableDatabase -Context $Context
  Initialize-CoreFixture -Context $Context

  foreach ($file in @(
    'supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql',
    'supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql',
    'supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql'
  )) {
    Invoke-PsqlFileStrict -Context $Context -RelativePath $file | Out-Null
  }
}

function Bootstrap-ThroughCommit7 {
  param([hashtable]$Context)

  Reset-DisposableDatabase -Context $Context
  Initialize-CoreFixture -Context $Context

  foreach ($file in @(
    'supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql',
    'supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql'
  )) {
    Invoke-PsqlFileStrict -Context $Context -RelativePath $file | Out-Null
  }
}

function Bootstrap-FoundationOnly {
  param([hashtable]$Context)

  Reset-DisposableDatabase -Context $Context
  Initialize-FoundationFixture -Context $Context
}

function Bootstrap-CoreOnly {
  param([hashtable]$Context)

  Reset-DisposableDatabase -Context $Context
  Initialize-CoreFixture -Context $Context
}

function Get-GitStatusLines {
  $result = Invoke-CapturedProcess -FilePath 'git' -Arguments @('status', '--short') -WorkingDirectory $script:RepoRoot -TimeoutSeconds 60
  return ($result.Stdout -split "(`r`n|`n|`r)") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

function Get-ChangedFileNames {
  $result = Invoke-CapturedProcess -FilePath 'git' -Arguments @('diff', '--name-only') -WorkingDirectory $script:RepoRoot -TimeoutSeconds 60
  return ($result.Stdout -split "(`r`n|`n|`r)") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

function Get-UntrackedFileNames {
  $result = Invoke-CapturedProcess -FilePath 'git' -Arguments @('ls-files', '--others', '--exclude-standard') -WorkingDirectory $script:RepoRoot -TimeoutSeconds 60
  return ($result.Stdout -split "(`r`n|`n|`r)") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

function Get-GitStatusPath {
  param([string]$StatusLine)

  if ([string]::IsNullOrWhiteSpace($StatusLine) -or $StatusLine.Length -lt 4) {
    return $null
  }

  $path = $StatusLine.Substring(3).Trim()
  if ($path -match ' -> ') {
    $path = ($path -split ' -> ' | Select-Object -Last 1).Trim()
  }

  return ($path -replace '\\', '/')
}

function Get-UnexpectedMigrationStatusLines {
  param(
    [string[]]$StatusLines,
    [int]$CommitNumber
  )

  $approved = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  if ($CommitNumber -ge 12) {
    [void]$approved.Add($script:ApprovedCommit12Migration)
  }
  if ($CommitNumber -ge 13) {
    foreach ($migration in $script:ApprovedCommit13Migrations) {
      [void]$approved.Add($migration)
    }
  }

  return @($StatusLines | Where-Object {
    $path = Get-GitStatusPath -StatusLine $_
    if (-not $path -or -not $path.StartsWith('supabase/migrations/')) {
      return $false
    }

    return -not $approved.Contains($path)
  })
}

function Assert-ValidatorSelfTest {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Get-CurrentLibpqEnvironment {
  $names = @(
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGDATABASE',
    'PGSSLMODE',
    'PGPASSWORD',
    'PGCONNECT_TIMEOUT',
    'PGSERVICE',
    'PGSERVICEFILE'
  )
  $snapshot = @{}
  foreach ($name in $names) {
    $entry = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    $snapshot[$name] = if ($entry) { [string]$entry.Value } else { $null }
  }
  return $snapshot
}

function Assert-LibpqEnvironmentRestored {
  param([hashtable]$Expected)

  $current = Get-CurrentLibpqEnvironment
  foreach ($name in $Expected.Keys) {
    Assert-ValidatorSelfTest -Condition ([string]$current[$name] -eq [string]$Expected[$name]) -Message "$name was not restored."
  }
}

function Invoke-ValidatorSelfTests {
  $secret = 'validator-self-test-password'
  $localUrl = 'postgresql://postgres@127.0.0.1:55432/test_commit12_solo_plus_recovery?sslmode=disable'
  $fakePsql = Join-Path $env:TEMP ("fake-psql-" + [guid]::NewGuid().ToString('N') + ".cmd")
  $original = Get-CurrentLibpqEnvironment

  try {
    Set-Content -LiteralPath $fakePsql -Encoding ASCII -Value @'
@echo off
echo args:%*
if "%PGPASSWORD%"=="" (
  echo fe_sendauth: no password supplied 1>&2
  exit /b 2
)
echo has-password
exit /b 0
'@

    $migrationStatus = @('?? supabase/migrations/20260719_01_unexpected.sql')
    Assert-ValidatorSelfTest -Condition (@(Get-UnexpectedMigrationStatusLines -StatusLines $migrationStatus -CommitNumber 11).Count -eq 1) -Message 'Commit 11 did not reject an unexpected migration.'

    $commit12RecoveryStatus = @("?? $script:ApprovedCommit12Migration")
    Assert-ValidatorSelfTest -Condition (@(Get-UnexpectedMigrationStatusLines -StatusLines $commit12RecoveryStatus -CommitNumber 12).Count -eq 0) -Message 'Commit 12 did not accept the approved recovery migration.'
    Assert-ValidatorSelfTest -Condition (@(Get-UnexpectedMigrationStatusLines -StatusLines $commit12RecoveryStatus -CommitNumber 11).Count -eq 1) -Message 'Dirty Commit 12 migration was incorrectly treated as Commit 11-safe.'

    $commit12MixedStatus = @(
      "?? $script:ApprovedCommit12Migration",
      '?? supabase/migrations/20260719_01_unexpected.sql'
    )
    Assert-ValidatorSelfTest -Condition (@(Get-UnexpectedMigrationStatusLines -StatusLines $commit12MixedStatus -CommitNumber 12).Count -eq 1) -Message 'Commit 12 did not reject an unrelated additional migration.'

    $commit13MigrationStatus = @($script:ApprovedCommit13Migrations | ForEach-Object { "?? $_" })
    Assert-ValidatorSelfTest -Condition (@(Get-UnexpectedMigrationStatusLines -StatusLines $commit13MigrationStatus -CommitNumber 13).Count -eq 0) -Message 'Commit 13 did not accept the approved authorization and disclosure migrations.'
    Assert-ValidatorSelfTest -Condition (@(Get-UnexpectedMigrationStatusLines -StatusLines $commit13MigrationStatus -CommitNumber 12).Count -eq 3) -Message 'Dirty Commit 13 migrations were incorrectly treated as Commit 12-safe.'

    $commit13MixedStatus = @(
      "?? $script:ApprovedCommit12Migration",
      "?? $($script:ApprovedCommit13Migrations[0])",
      "?? $($script:ApprovedCommit13Migrations[1])",
      "?? $($script:ApprovedCommit13Migrations[2])",
      '?? supabase/migrations/20260729_01_unexpected.sql'
    )
    Assert-ValidatorSelfTest -Condition (@(Get-UnexpectedMigrationStatusLines -StatusLines $commit13MixedStatus -CommitNumber 13).Count -eq 1) -Message 'Commit 13 did not reject an unrelated additional migration.'

    $safe = Get-DatabaseSafety -ConnectionString $localUrl
    Assert-ValidatorSelfTest -Condition $safe.IsSafe -Message 'Disposable URL safety check did not accept the local test database URL.'
    $unsafe = Get-DatabaseSafety -ConnectionString 'postgresql://postgres@db.supabase.co/postgres?sslmode=require'
    Assert-ValidatorSelfTest -Condition (-not $unsafe.IsSafe) -Message 'Disposable URL safety check accepted a non-local database URL.'

    Set-Item -Path 'Env:PGPASSWORD' -Value $secret
    $beforeSuccess = Get-CurrentLibpqEnvironment

    Invoke-WithLocalDisposableDatabaseEnvironment -ConnectionString $localUrl -Operation {
      $ctx = @{
        PsqlPath = $fakePsql
        TestDatabaseUrl = $localUrl
      }
      $result = Invoke-PsqlSqlStrict -Context $ctx -Sql 'select 1;' -TimeoutSeconds 5
      Assert-ValidatorSelfTest -Condition ($result.Stdout -match 'args:.* -w ') -Message 'psql arguments did not include -w.'
      Assert-ValidatorSelfTest -Condition ($result.Stdout -match 'has-password') -Message 'fake psql child did not receive PGPASSWORD.'
      Assert-ValidatorSelfTest -Condition ($result.Stdout -notmatch [regex]::Escape($secret)) -Message 'PGPASSWORD leaked to stdout.'
      Assert-ValidatorSelfTest -Condition ($result.Stderr -notmatch [regex]::Escape($secret)) -Message 'PGPASSWORD leaked to stderr.'
      Assert-ValidatorSelfTest -Condition ($result.Command -notmatch [regex]::Escape($secret)) -Message 'PGPASSWORD leaked to command display.'
    }
    Assert-LibpqEnvironmentRestored -Expected $beforeSuccess

    Remove-Item -Path 'Env:PGPASSWORD' -ErrorAction SilentlyContinue
    $beforeMissingAuth = Get-CurrentLibpqEnvironment
    $missingAuthFailed = $false
    try {
      Invoke-WithLocalDisposableDatabaseEnvironment -ConnectionString $localUrl -Operation {
        $ctx = @{
          PsqlPath = $fakePsql
          TestDatabaseUrl = $localUrl
        }
        Invoke-PsqlSqlStrict -Context $ctx -Sql 'select 1;' -TimeoutSeconds 5 | Out-Null
      }
    }
    catch {
      $missingAuthFailed = $_.Exception.Message -match 'no password supplied'
    }
    Assert-ValidatorSelfTest -Condition $missingAuthFailed -Message 'Missing authentication did not fail quickly.'
    Assert-LibpqEnvironmentRestored -Expected $beforeMissingAuth

    Set-Item -Path 'Env:PGPASSWORD' -Value $secret
    $beforeTimeout = Get-CurrentLibpqEnvironment
    $timeoutResult = Invoke-WithLocalDisposableDatabaseEnvironment -ConnectionString $localUrl -Operation {
      Invoke-CapturedProcess -FilePath 'powershell.exe' -Arguments @('-NoProfile', '-Command', 'Start-Sleep -Seconds 5') -WorkingDirectory $script:RepoRoot -TimeoutSeconds 1
    }
    Assert-ValidatorSelfTest -Condition ($timeoutResult.TimedOut -and $timeoutResult.ExitCode -eq 124) -Message 'Hung child process was not terminated after timeout.'
    Assert-LibpqEnvironmentRestored -Expected $beforeTimeout

    $redactionResult = Invoke-WithLocalDisposableDatabaseEnvironment -ConnectionString $localUrl -Operation {
      Invoke-CapturedProcess -FilePath 'powershell.exe' -Arguments @('-NoProfile', '-Command', 'Write-Output $env:PGPASSWORD; [Console]::Error.WriteLine($env:PGPASSWORD)') -WorkingDirectory $script:RepoRoot -TimeoutSeconds 5
    }
    Assert-ValidatorSelfTest -Condition ($redactionResult.Stdout -notmatch [regex]::Escape($secret)) -Message 'Secret appeared in captured stdout.'
    Assert-ValidatorSelfTest -Condition ($redactionResult.Stderr -notmatch [regex]::Escape($secret)) -Message 'Secret appeared in captured stderr.'
    Assert-ValidatorSelfTest -Condition ($redactionResult.Command -notmatch [regex]::Escape($secret)) -Message 'Secret appeared in captured command.'
    Assert-ValidatorSelfTest -Condition ($redactionResult.Stdout -match '<redacted-password>') -Message 'Captured stdout was not redacted.'
    Assert-LibpqEnvironmentRestored -Expected $beforeTimeout

    Write-Host 'validator self-tests passed'
  }
  finally {
    foreach ($name in $original.Keys) {
      if ($null -eq $original[$name]) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
      } else {
        Set-Item -Path "Env:$name" -Value $original[$name]
      }
    }

    if (Test-Path -LiteralPath $fakePsql) {
      Remove-Item -LiteralPath $fakePsql -Force
    }
  }
}

if ($RunValidatorSelfTests) {
  Invoke-ValidatorSelfTests
  exit 0
}

$psqlPath = Resolve-PsqlPath
$databaseSafety = Get-DatabaseSafety -ConnectionString $TestDatabaseUrl
$context = @{
  RepoRoot       = [string]$script:RepoRoot
  LogRoot        = $script:LogRoot
  PsqlPath       = $psqlPath
  TestDatabaseUrl = $TestDatabaseUrl
  RedactedDbUrl  = $databaseSafety.RedactedUrl
  DatabaseSafety = $databaseSafety
  BranchName     = Get-BranchName
}
$resolvedPsqlForHarness = if ($psqlPath) { $psqlPath } else { 'psql' }

$checks = @(
  (New-CommandCheck -Id 'ENV-001' -Name 'Current branch' -Phase 'A' -RootCauseCategory 'repository-state' -FilePath 'git' -Arguments @('branch', '--show-current') -TimeoutSeconds 60),
  (New-CallbackCheck -Id 'ENV-002' -Name 'Repository root exists' -Phase 'A' -RootCauseCategory 'repository-state' -CommandDisplay 'Test-Path repo root' -Callback {
      param($ctx)
      if (Test-Path $ctx.RepoRoot) {
        return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = $ctx.RepoRoot; Stderr = '' }
      }
      return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ''; Stderr = "Missing repository root: $($ctx.RepoRoot)" }
    }),
  (New-CommandCheck -Id 'ENV-003' -Name 'Node version' -Phase 'A' -RootCauseCategory 'environment-tooling' -FilePath 'node' -Arguments @('--version') -TimeoutSeconds 60),
  (New-CommandCheck -Id 'ENV-004' -Name 'npm version' -Phase 'A' -RootCauseCategory 'environment-tooling' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npm --version") -TimeoutSeconds 60),
  (New-CommandCheck -Id 'ENV-005' -Name 'PowerShell version' -Phase 'A' -RootCauseCategory 'environment-tooling' -FilePath 'powershell.exe' -Arguments @('-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()') -TimeoutSeconds 60),
  (New-CallbackCheck -Id 'ENV-006' -Name 'psql executable resolved' -Phase 'A' -RootCauseCategory 'environment-tooling' -CommandDisplay 'Resolve psql.exe path' -Callback {
      param($ctx)
      if ($ctx.PsqlPath -and (Test-Path $ctx.PsqlPath)) {
        return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = $ctx.PsqlPath; Stderr = '' }
      }
      return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ''; Stderr = 'Unable to resolve psql.exe.' }
    }),
  (New-CommandCheck -Id 'ENV-007' -Name 'PostgreSQL client version' -Phase 'A' -RootCauseCategory 'environment-tooling' -FilePath ($(if ($psqlPath) { $psqlPath } else { 'psql' })) -Arguments @('--version') -TimeoutSeconds 60 -DependsOn @('ENV-006')),
  (New-CallbackCheck -Id 'ENV-008' -Name 'TEST_DATABASE_URL present' -Phase 'A' -RootCauseCategory 'database-safety' -CommandDisplay 'Validate TEST_DATABASE_URL presence' -Callback {
      param($ctx)
      if ([string]::IsNullOrWhiteSpace($ctx.TestDatabaseUrl)) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ''; Stderr = 'TEST_DATABASE_URL is missing.' }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = $ctx.RedactedDbUrl; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-009' -Name 'Local disposable database safety' -Phase 'A' -RootCauseCategory 'database-safety' -CommandDisplay 'Validate local disposable database URL safety' -Callback {
      param($ctx)
      if ($ctx.DatabaseSafety.IsSafe) {
        $details = "host=$($ctx.DatabaseSafety.Host); db=$($ctx.DatabaseSafety.DatabaseName); redacted=$($ctx.RedactedDbUrl)"
        return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = $details; Stderr = '' }
      }
      return [pscustomobject]@{
        Status = 'FAIL'
        ExitCode = 1
        Stdout = $ctx.RedactedDbUrl
        Stderr = ($ctx.DatabaseSafety.Errors -join [Environment]::NewLine)
      }
    }),
  (New-CallbackCheck -Id 'ENV-010' -Name 'Required Commit 10 artifacts exist' -Phase 'A' -RootCauseCategory 'migration-manifest' -CommandDisplay 'Check migration, wrapper, SQL test, and docs' -Callback {
      param($ctx)
      $required = @(
        'docs/deraledger-smart-storefront-prd.md',
        'docs/phase 2 full implementation plan.md',
        'docs/database-migration-and-staging-safety-runbook.md',
        'supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql',
        'supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql',
        'supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql',
        'supabase/migrations/20260711_01_solo_plus_activation_rpc.sql',
        'supabase/staging/012_solo_plus_activation_rpc.sql',
        'supabase/staging/preflight/012_solo_plus_activation_rpc_snapshot.sql',
        'supabase/staging/postflight/012_solo_plus_activation_rpc_verify.sql',
        'supabase/tests/phase2_solo_plus_activation_rpc.sql'
      )
      $missing = @($required | Where-Object {
          $fullPath = Join-Path $ctx.RepoRoot $_
          -not (Test-Path -LiteralPath $fullPath)
        })
      if ($missing.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ''; Stderr = ('Missing required files:' + [Environment]::NewLine + ($missing -join [Environment]::NewLine)) }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = ($required -join [Environment]::NewLine); Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-011' -Name 'Feature-flag defaults unchanged in committed source' -Phase 'A' -RootCauseCategory 'feature-flag-defaults' -CommandDisplay 'Inspect committed platform_settings defaults and uncommitted diff' -Callback {
      param($ctx)
      $settingsPath = Join-Path $ctx.RepoRoot 'supabase/staging/002_onboarding_verification_upgrade_flow.sql'
      $fileContent = Get-Content -Path $settingsPath -Raw
      $requiredDocs = @(
        'docs/phase 2 full implementation plan.md',
        'docs/phase-1-plan-migration-closeout-report.md'
      )
      $missingPatterns = [System.Collections.Generic.List[string]]::new()
      foreach ($doc in $requiredDocs) {
        $docContent = Get-Content -Path (Join-Path $ctx.RepoRoot $doc) -Raw
        foreach ($flag in @(
            'plan_migration_solo_lite_enabled = false',
            'solo_plus_enabled = false',
            'solo_plus_kyc_enabled = false'
          )) {
          if ($docContent -notmatch [regex]::Escape($flag)) {
            $missingPatterns.Add("$doc :: $flag")
          }
        }
      }
      $diffResult = Invoke-CapturedProcess -FilePath 'git' -Arguments @('diff', '--', 'supabase/staging/002_onboarding_verification_upgrade_flow.sql') -WorkingDirectory $ctx.RepoRoot -TimeoutSeconds 60
      if ($missingPatterns.Count -gt 0 -or -not [string]::IsNullOrWhiteSpace($diffResult.Stdout)) {
        $stderr = @()
        if ($missingPatterns.Count -gt 0) { $stderr += 'Committed false defaults missing:'; $stderr += $missingPatterns }
        if (-not [string]::IsNullOrWhiteSpace($diffResult.Stdout)) { $stderr += 'Unexpected uncommitted default-setting diff detected.' }
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = $diffResult.Stdout; Stderr = ($stderr -join [Environment]::NewLine) }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Solo Plus feature-flag defaults remain false in committed source.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-012' -Name 'No activation route or server action additions' -Phase 'A' -RootCauseCategory 'scope-boundary' -CommandDisplay 'Inspect current working tree for forbidden activation boundaries' -Callback {
      param($ctx)
      $statusLines = Get-GitStatusLines
      $forbidden = @($statusLines | Where-Object {
        $path = ($_ -replace '^[ MADRCU?!]{1,2}\s+', '') -replace '\\', '/'
        $path -match '(^|/)(api/)?solo-plus/activate(/|\.|$)' -or
        $path -match '(^|/)activate(/|\.|$)' -or
        $path -match '(^|/)activation(/|\.|$)' -or
        $path -match '(^|/)server-actions?(/|\.|$)'
      })
      if ($forbidden.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ($forbidden -join [Environment]::NewLine); Stderr = 'This scope must not add activation routes or activation server actions.' }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'No forbidden activation-route or server-action additions detected.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-013' -Name 'No plan_migrations writes added in Commit 10 diff' -Phase 'A' -RootCauseCategory 'scope-boundary' -CommandDisplay 'Search uncommitted diff for plan_migrations writes' -Callback {
      param($ctx)
      $diffResult = Invoke-CapturedProcess -FilePath 'git' -Arguments @('diff', '--unified=0', '--', 'package.json', 'scripts', 'src', 'supabase', 'tests', 'docs') -WorkingDirectory $ctx.RepoRoot -TimeoutSeconds 120
      $matchingLines = @(
        ($diffResult.Stdout -split "(`r`n|`n|`r)") |
          Where-Object { $_ -match '^[+].*plan_migrations' -or $_ -match '^[+].*\bINSERT\b.*plan_migrations' -or $_ -match '^[+].*\bUPDATE\b.*plan_migrations' }
      )
      if ($matchingLines.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ($matchingLines -join [Environment]::NewLine); Stderr = 'Commit 10 must not write to public.plan_migrations.' }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'No uncommitted plan_migrations writes detected.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-016' -Name 'Commit 11 route and test artifacts exist' -Phase 'A' -RootCauseCategory 'migration-manifest' -CommandDisplay 'Check Commit 11 route, service, helper, and test files' -Callback {
      param($ctx)
      $required = @(
        'src/lib/server/browser-origin.ts',
        'src/lib/solo-plus/server/browser-case-service.ts',
        'src/lib/solo-plus/server/admin-read-service.ts',
        'src/app/api/solo-plus/case/route.ts',
        'src/app/api/solo-plus/case/requirements/evidence/route.ts',
        'src/app/api/admin/solo-plus/cases/route.ts',
        'src/app/api/admin/solo-plus/cases/[caseId]/route.ts',
        'tests/solo-plus-browser-origin.test.ts',
        'tests/solo-plus-case-route.test.ts',
        'tests/solo-plus-case-evidence-route.test.ts',
        'tests/solo-plus-admin-read-service.test.ts',
        'tests/solo-plus-admin-cases-route.test.ts',
        'tests/solo-plus-admin-case-detail-route.test.ts'
      )
      $missing = @($required | Where-Object {
          $fullPath = Join-Path $ctx.RepoRoot $_
          -not (Test-Path -LiteralPath $fullPath)
        })
      if ($missing.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ''; Stderr = ('Missing Commit 11 artifacts:' + [Environment]::NewLine + ($missing -join [Environment]::NewLine)) }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = ($required -join [Environment]::NewLine); Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-017' -Name 'No Commit 11 migration added' -Phase 'A' -RootCauseCategory 'migration-manifest' -CommandDisplay 'Inspect current working tree for unexpected migration additions' -Callback {
      param($ctx)
      $statusLines = Get-GitStatusLines
      $unexpected = @(Get-UnexpectedMigrationStatusLines -StatusLines $statusLines -CommitNumber $CommitNumber)
      if ($unexpected.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ($unexpected -join [Environment]::NewLine); Stderr = 'Unexpected migration file changes detected for this commit scope.' }
      }
      $allowed = if ($CommitNumber -ge 13) {
        (@($script:ApprovedCommit12Migration) + $script:ApprovedCommit13Migrations) -join ', '
      } elseif ($CommitNumber -ge 12) {
        $script:ApprovedCommit12Migration
      } else {
        'none'
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = "No unexpected migration additions detected. allowed=$allowed"; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-019' -Name 'Commit 12 recovery SQL artifacts exist' -Phase 'A' -RootCauseCategory 'migration-manifest' -CommandDisplay 'Check Commit 12 recovery migration, staging wrappers, and SQL self-test' -Callback {
      param($ctx)
      $required = @(
        'supabase/migrations/20260718_01_solo_plus_payment_recovery.sql',
        'supabase/staging/013_solo_plus_payment_recovery.sql',
        'supabase/staging/preflight/013_solo_plus_payment_recovery_snapshot.sql',
        'supabase/staging/postflight/013_solo_plus_payment_recovery_verify.sql',
        'supabase/tests/phase2_solo_plus_payment_recovery_rpc.sql'
      )
      $missing = @($required | Where-Object {
          $fullPath = Join-Path $ctx.RepoRoot $_
          -not (Test-Path -LiteralPath $fullPath)
        })
      if ($missing.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ''; Stderr = ('Missing required files:' + [Environment]::NewLine + ($missing -join [Environment]::NewLine)) }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = ($required -join [Environment]::NewLine); Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-020' -Name 'Commit 13 authorization and disclosure SQL artifacts exist' -Phase 'A' -RootCauseCategory 'migration-manifest' -CommandDisplay 'Check Commit 13 authorization hardening and disclosure acknowledgement artifacts' -Callback {
      param($ctx)
      $required = @(
        'supabase/migrations/20260728_00_authorization_hardening.sql',
        'supabase/staging/014_authorization_hardening.sql',
        'supabase/staging/preflight/014_authorization_hardening_snapshot.sql',
        'supabase/staging/postflight/014_authorization_hardening_verify.sql',
        'supabase/tests/phase2_authorization_hardening.sql',
        'supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql',
        'supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql',
        'supabase/staging/preflight/015_verification_disclosure_acknowledgement_snapshot.sql',
        'supabase/staging/postflight/015_verification_disclosure_acknowledgement_verify.sql',
        'supabase/migrations/20260731_00_verification_disclosure_identity_hardening.sql',
        'supabase/staging/016_verification_disclosure_identity_hardening.sql',
        'supabase/staging/preflight/016_verification_disclosure_identity_hardening_snapshot.sql',
        'supabase/staging/postflight/016_verification_disclosure_identity_hardening_verify.sql',
        'supabase/tests/phase2_verification_disclosure_acknowledgement_rpc.sql'
      )
      $missing = @($required | Where-Object {
          $fullPath = Join-Path $ctx.RepoRoot $_
          -not (Test-Path -LiteralPath $fullPath)
        })
      if ($missing.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ''; Stderr = ('Missing required files:' + [Environment]::NewLine + ($missing -join [Environment]::NewLine)) }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = ($required -join [Environment]::NewLine); Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-018' -Name 'Local libpq environment isolation self-test' -Phase 'A' -RootCauseCategory 'database-safety' -CommandDisplay 'Verify local disposable validation restores and isolates libpq environment' -DependsOn @('ENV-009') -Callback {
      param($ctx)

      $savedSslMode = Get-Item -Path 'Env:PGSSLMODE' -ErrorAction SilentlyContinue
      $savedHost = Get-Item -Path 'Env:PGHOST' -ErrorAction SilentlyContinue
      $savedPort = Get-Item -Path 'Env:PGPORT' -ErrorAction SilentlyContinue
      $savedUser = Get-Item -Path 'Env:PGUSER' -ErrorAction SilentlyContinue
      $savedDatabase = Get-Item -Path 'Env:PGDATABASE' -ErrorAction SilentlyContinue
      $savedPassword = Get-Item -Path 'Env:PGPASSWORD' -ErrorAction SilentlyContinue
      $savedService = Get-Item -Path 'Env:PGSERVICE' -ErrorAction SilentlyContinue
      $savedServiceFile = Get-Item -Path 'Env:PGSERVICEFILE' -ErrorAction SilentlyContinue

      try {
        $childResult = Invoke-WithLocalDisposableDatabaseEnvironment -ConnectionString $ctx.TestDatabaseUrl -Operation {
          $childSnapshot = @{
            PGHOST        = $env:PGHOST
            PGPORT        = $env:PGPORT
            PGUSER        = $env:PGUSER
            PGDATABASE    = $env:PGDATABASE
            PGPASSWORD    = $env:PGPASSWORD
            PGSERVICE     = $env:PGSERVICE
            PGSERVICEFILE = $env:PGSERVICEFILE
          }

          try {
            $env:PGHOST = 'staging.example.invalid'
            $env:PGPORT = '55432'
            $env:PGUSER = 'staging-user'
            $env:PGDATABASE = 'staging-db'
            $env:PGPASSWORD = 'staging-secret'
            $env:PGSERVICE = 'staging-service'
            $env:PGSERVICEFILE = 'C:\staging\pg_service.conf'
            Invoke-CapturedProcess -FilePath 'powershell.exe' -Arguments @('-NoProfile', '-Command', '$env:PGSSLMODE') -WorkingDirectory $ctx.RepoRoot -TimeoutSeconds 60
          }
          finally {
            $env:PGHOST = $childSnapshot.PGHOST
            $env:PGPORT = $childSnapshot.PGPORT
            $env:PGUSER = $childSnapshot.PGUSER
            $env:PGDATABASE = $childSnapshot.PGDATABASE
            $env:PGPASSWORD = $childSnapshot.PGPASSWORD
            $env:PGSERVICE = $childSnapshot.PGSERVICE
            $env:PGSERVICEFILE = $childSnapshot.PGSERVICEFILE
          }
        }

        if ($childResult.ExitCode -ne 0) {
          return [pscustomobject]@{
            Status = 'FAIL'
            ExitCode = $childResult.ExitCode
            Stdout = $childResult.Stdout
            Stderr = $childResult.Stderr
          }
        }

        if ($childResult.Stdout.Trim() -ne 'disable') {
          return [pscustomobject]@{
            Status = 'FAIL'
            ExitCode = 1
            Stdout = $childResult.Stdout
            Stderr = "Local disposable validation did not force PGSSLMODE=disable for child processes."
          }
        }

        $restoredValues = @{
          PGSSLMODE = (Get-Item -Path 'Env:PGSSLMODE' -ErrorAction SilentlyContinue)
          PGHOST = (Get-Item -Path 'Env:PGHOST' -ErrorAction SilentlyContinue)
          PGPORT = (Get-Item -Path 'Env:PGPORT' -ErrorAction SilentlyContinue)
          PGUSER = (Get-Item -Path 'Env:PGUSER' -ErrorAction SilentlyContinue)
          PGDATABASE = (Get-Item -Path 'Env:PGDATABASE' -ErrorAction SilentlyContinue)
          PGPASSWORD = (Get-Item -Path 'Env:PGPASSWORD' -ErrorAction SilentlyContinue)
          PGSERVICE = (Get-Item -Path 'Env:PGSERVICE' -ErrorAction SilentlyContinue)
          PGSERVICEFILE = (Get-Item -Path 'Env:PGSERVICEFILE' -ErrorAction SilentlyContinue)
        }

        $restorationFailures = @()
        foreach ($entry in @(
          @{ Name = 'PGSSLMODE'; Original = $savedSslMode },
          @{ Name = 'PGHOST'; Original = $savedHost },
          @{ Name = 'PGPORT'; Original = $savedPort },
          @{ Name = 'PGUSER'; Original = $savedUser },
          @{ Name = 'PGDATABASE'; Original = $savedDatabase },
          @{ Name = 'PGPASSWORD'; Original = $savedPassword },
          @{ Name = 'PGSERVICE'; Original = $savedService },
          @{ Name = 'PGSERVICEFILE'; Original = $savedServiceFile }
        )) {
          $name = $entry.Name
          $original = $entry.Original
          $current = $restoredValues[$name]

          if ($null -eq $original) {
            if ($current) {
              $restorationFailures += "$name was not restored to an unset state."
            }
          } else {
            if (-not $current -or [string]$current.Value -ne [string]$original.Value) {
              $restorationFailures += "$name was not restored to its original value."
            }
          }
        }

        if ($restorationFailures.Count -gt 0) {
          return [pscustomobject]@{
            Status = 'FAIL'
            ExitCode = 1
            Stdout = ''
            Stderr = ($restorationFailures -join [Environment]::NewLine)
          }
        }

        return [pscustomobject]@{
          Status = 'PASS'
          ExitCode = 0
          Stdout = 'Local libpq environment isolation restores caller settings and forces PGSSLMODE=disable for local disposable child processes.'
          Stderr = ''
        }
      }
      finally {
        if ($null -ne $savedSslMode) { Set-Item -Path 'Env:PGSSLMODE' -Value $savedSslMode.Value } else { Remove-Item -Path 'Env:PGSSLMODE' -ErrorAction SilentlyContinue }
        if ($null -ne $savedHost) { Set-Item -Path 'Env:PGHOST' -Value $savedHost.Value } else { Remove-Item -Path 'Env:PGHOST' -ErrorAction SilentlyContinue }
        if ($null -ne $savedPort) { Set-Item -Path 'Env:PGPORT' -Value $savedPort.Value } else { Remove-Item -Path 'Env:PGPORT' -ErrorAction SilentlyContinue }
        if ($null -ne $savedUser) { Set-Item -Path 'Env:PGUSER' -Value $savedUser.Value } else { Remove-Item -Path 'Env:PGUSER' -ErrorAction SilentlyContinue }
        if ($null -ne $savedDatabase) { Set-Item -Path 'Env:PGDATABASE' -Value $savedDatabase.Value } else { Remove-Item -Path 'Env:PGDATABASE' -ErrorAction SilentlyContinue }
        if ($null -ne $savedPassword) { Set-Item -Path 'Env:PGPASSWORD' -Value $savedPassword.Value } else { Remove-Item -Path 'Env:PGPASSWORD' -ErrorAction SilentlyContinue }
        if ($null -ne $savedService) { Set-Item -Path 'Env:PGSERVICE' -Value $savedService.Value } else { Remove-Item -Path 'Env:PGSERVICE' -ErrorAction SilentlyContinue }
        if ($null -ne $savedServiceFile) { Set-Item -Path 'Env:PGSERVICEFILE' -Value $savedServiceFile.Value } else { Remove-Item -Path 'Env:PGSERVICEFILE' -ErrorAction SilentlyContinue }
      }
    }),
  (New-CallbackCheck -Id 'ENV-014' -Name 'No merge-conflict markers' -Phase 'A' -RootCauseCategory 'repository-state' -CommandDisplay 'rg merge conflict markers' -Callback {
      param($ctx)
      $rg = Get-Command rg -ErrorAction SilentlyContinue
      if (-not $rg) {
        return [pscustomobject]@{ Status = 'SKIPPED'; ExitCode = 0; Stdout = ''; Stderr = 'rg is not available.' }
      }
      $result = Invoke-CapturedProcess -FilePath $rg.Source -Arguments @('-n', '^(<<<<<<<|=======|>>>>>>>)', 'src', 'tests', 'scripts', 'supabase', 'docs') -WorkingDirectory $ctx.RepoRoot -TimeoutSeconds 120
      if ($result.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($result.Stdout)) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = $result.Stdout; Stderr = 'Merge-conflict markers detected.' }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'No merge-conflict markers detected.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-015' -Name 'Duplicate migration sequence identifiers' -Phase 'A' -RootCauseCategory 'migration-manifest' -CommandDisplay 'Check supabase/migrations for duplicate sequence identifiers' -Callback {
      param($ctx)
      $migrationDir = Join-Path $ctx.RepoRoot 'supabase/migrations'
      $groups = Get-ChildItem -Path $migrationDir -Filter '*.sql' | ForEach-Object {
        $name = $_.BaseName
        $match = [regex]::Match($name, '^(\d{8}(?:_\d+)?)')
        if ($match.Success) {
          [pscustomobject]@{ Sequence = $match.Groups[1].Value; Name = $_.Name }
        }
      } | Group-Object Sequence | Where-Object { $_.Count -gt 1 }

      if ($groups) {
        $details = $groups | ForEach-Object { "$($_.Name): $($_.Group.Name -join ', ')" }
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ($details -join [Environment]::NewLine); Stderr = 'Duplicate migration sequence identifiers detected.' }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Migration sequence identifiers are unique.'; Stderr = '' }
    }),
  (New-CommandCheck -Id 'APP-001' -Name 'Solo Plus TypeScript test chain' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npm run test:solo-plus") -TimeoutSeconds 2400),
  (New-CommandCheck -Id 'APP-002' -Name 'Focused activation service test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-activation-service.test.ts") -TimeoutSeconds 600),
  (New-CommandCheck -Id 'APP-003' -Name 'Focused review route regression' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-review-route.test.ts") -TimeoutSeconds 1200),
  (New-CommandCheck -Id 'APP-004' -Name 'Browser origin guard test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-browser-origin.test.ts") -TimeoutSeconds 600),
  (New-CommandCheck -Id 'APP-010' -Name 'Merchant review status contract test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-browser-case-contract.test.ts") -TimeoutSeconds 900),
  (New-CommandCheck -Id 'APP-011' -Name 'Plan availability flag alignment test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/plans.test.ts") -TimeoutSeconds 600),
  (New-CommandCheck -Id 'APP-015' -Name 'Solo Plus UI contract test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-ui-contract.test.tsx") -TimeoutSeconds 900),
  (New-CommandCheck -Id 'APP-005' -Name 'Solo Plus case route test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-case-route.test.ts") -TimeoutSeconds 1200),
  (New-CommandCheck -Id 'APP-006' -Name 'Solo Plus evidence route test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-case-evidence-route.test.ts") -TimeoutSeconds 1200),
  (New-CommandCheck -Id 'APP-012' -Name 'Admin read service test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-admin-read-service.test.ts") -TimeoutSeconds 900),
  (New-CommandCheck -Id 'APP-013' -Name 'Admin cases route test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-admin-cases-route.test.ts") -TimeoutSeconds 900),
  (New-CommandCheck -Id 'APP-014' -Name 'Admin case detail route test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-admin-case-detail-route.test.ts") -TimeoutSeconds 900),
  (New-CommandCheck -Id 'APP-016' -Name 'No Solo Plus raw file-upload UI' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; `$paths = @('src/components/solo-plus','src/app/onboarding/page.tsx','src/app/onboarding/[plan]/page.tsx','src/app/onboarding/solo_plus/status/page.tsx','src/app/onboarding/payment-callback/page.tsx','src/app/(dashboard)/settings/billing/page.tsx','src/app/(dashboard)/settings/upgrade/[plan]/page.tsx','src/app/(dashboard)/settings/upgrade/solo_plus/status/page.tsx','src/app/(dashboard)/settings/upgrade-success/page.tsx','src/app/(admin)/admin/solo-plus'); `$patterns = @('type\s*=\s*[""'' ]file[""'' ]','name\s*=\s*[""'' ]storageKey[""'' ]','name\s*=\s*[""'' ]providerReference[""'' ]','placeholder\s*=\s*[""'' ][^""'']*(storage key|provider reference)[^""'']*[""'' ]','label[^<]*(storage key|provider reference)'); `$matches = Get-ChildItem `$paths -Recurse -File | Select-String -Pattern `$patterns; if (`$matches) { `$matches | ForEach-Object { Write-Host `$_.Path ':' `$_.LineNumber ':' `$_.Line.Trim() }; exit 1 }") -TimeoutSeconds 120),
  (New-CommandCheck -Id 'APP-017' -Name 'No Solo Plus activation control UI' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; `$paths = @('src/components/solo-plus','src/app/onboarding/page.tsx','src/app/onboarding/[plan]/page.tsx','src/app/onboarding/solo_plus/status/page.tsx','src/app/onboarding/payment-callback/page.tsx','src/app/(dashboard)/settings/billing/page.tsx','src/app/(dashboard)/settings/upgrade/[plan]/page.tsx','src/app/(dashboard)/settings/upgrade/solo_plus/status/page.tsx','src/app/(dashboard)/settings/upgrade-success/page.tsx','src/app/(admin)/admin/solo-plus'); `$patterns = @('/api/solo-plus/activate','\bactivateSoloPlus\b','\bactivationAction\b','>\s*Activate Solo Plus\s*<','aria-label\s*=\s*[""'' ]Activate Solo Plus[""'' ]','title\s*=\s*[""'' ]Activate Solo Plus[""'' ]'); `$matches = Get-ChildItem `$paths -Recurse -File | Select-String -Pattern `$patterns; if (`$matches) { `$matches | ForEach-Object { Write-Host `$_.Path ':' `$_.LineNumber ':' `$_.Line.Trim() }; exit 1 }") -TimeoutSeconds 120),
  (New-CommandCheck -Id 'APP-007' -Name 'TypeScript compile' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsc --noEmit") -TimeoutSeconds 2400),
  (New-CommandCheck -Id 'APP-008' -Name 'Next.js build' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npm run build") -TimeoutSeconds 3600),
  (New-CommandCheck -Id 'APP-009' -Name 'git diff --check' -Phase 'B' -RootCauseCategory 'repository-state' -FilePath 'git' -Arguments @('diff', '--check') -TimeoutSeconds 120),
  (New-CallbackCheck -Id 'SQL-001' -Name 'Phase 2 Solo Plus case foundation SQL' -Phase 'E' -RootCauseCategory 'sql-suite-foundation' -CommandDisplay 'Bootstrap foundation-only and run phase2_solo_plus_case_foundation.sql' -DependsOn @('ENV-006','ENV-009') -Callback {
      param($ctx)
      Bootstrap-FoundationOnly -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/tests/phase2_solo_plus_case_foundation.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'phase2_solo_plus_case_foundation.sql passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-002' -Name 'Phase 2 transactional repository RPC SQL' -Phase 'E' -RootCauseCategory 'sql-suite-foundation' -CommandDisplay 'Bootstrap core fixture and run phase2_solo_plus_transactional_repository_rpcs.sql' -DependsOn @('ENV-006','ENV-009') -Callback {
      param($ctx)
      Bootstrap-CoreOnly -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/tests/phase2_solo_plus_transactional_repository_rpcs.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'phase2_solo_plus_transactional_repository_rpcs.sql passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-003' -Name 'Commit 7 substrate SQL regression' -Phase 'E' -RootCauseCategory 'sql-suite-commit7' -CommandDisplay 'Bootstrap through Commit 7 and run phase2_breet_payment_substrate_reconciliation.sql' -DependsOn @('ENV-006','ENV-009') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit7 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/tests/phase2_breet_payment_substrate_reconciliation.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'phase2_breet_payment_substrate_reconciliation.sql passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-004' -Name 'Commit 7 payment lifecycle SQL regression' -Phase 'E' -RootCauseCategory 'sql-suite-commit7' -CommandDisplay 'Bootstrap through Commit 7 and run phase2_solo_plus_payment_lifecycle.sql' -DependsOn @('ENV-006','ENV-009') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit7 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/tests/phase2_solo_plus_payment_lifecycle.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'phase2_solo_plus_payment_lifecycle.sql passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-005' -Name 'Commit 9 review RPC SQL regression' -Phase 'E' -RootCauseCategory 'sql-suite-commit9' -CommandDisplay 'Bootstrap through Commit 9 and run phase2_solo_plus_review_decision_rpc.sql' -DependsOn @('ENV-006','ENV-009') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit9 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/tests/phase2_solo_plus_review_decision_rpc.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'phase2_solo_plus_review_decision_rpc.sql passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-006' -Name 'Commit 10 preflight snapshot' -Phase 'E' -RootCauseCategory 'sql-suite-commit10' -CommandDisplay 'Bootstrap through Commit 9 and run Commit 10 preflight snapshot' -DependsOn @('ENV-006','ENV-009') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit9 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/preflight/012_solo_plus_activation_rpc_snapshot.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 10 preflight snapshot passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-007' -Name 'Commit 10 staging wrapper apply' -Phase 'E' -RootCauseCategory 'sql-suite-commit10' -CommandDisplay 'Bootstrap through Commit 9 and apply Commit 10 staging wrapper' -DependsOn @('SQL-006') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit9 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/012_solo_plus_activation_rpc.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 10 staging wrapper applied locally.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-008' -Name 'Commit 10 postflight verify' -Phase 'E' -RootCauseCategory 'sql-suite-commit10' -CommandDisplay 'Bootstrap through Commit 9, apply wrapper, and run Commit 10 postflight verify' -DependsOn @('SQL-007') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit9 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/012_solo_plus_activation_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/012_solo_plus_activation_rpc_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 10 postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-009' -Name 'Commit 10 wrapper rerun and postflight verify' -Phase 'F' -RootCauseCategory 'migration-rerun' -CommandDisplay 'Bootstrap through Commit 9, apply wrapper twice, and rerun postflight verify' -DependsOn @('SQL-008') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit9 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/012_solo_plus_activation_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/012_solo_plus_activation_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/012_solo_plus_activation_rpc_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 10 wrapper rerun and postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-010' -Name 'Commit 10 activation RPC SQL regression' -Phase 'F' -RootCauseCategory 'sql-suite-commit10' -CommandDisplay 'Bootstrap through Commit 10 and run phase2_solo_plus_activation_rpc.sql' -DependsOn @('ENV-006','ENV-009') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit10 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/tests/phase2_solo_plus_activation_rpc.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'phase2_solo_plus_activation_rpc.sql passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-013' -Name 'Commit 12 preflight snapshot' -Phase 'F' -RootCauseCategory 'sql-suite-commit12' -CommandDisplay 'Bootstrap through Commit 10 and run Commit 12 preflight snapshot' -DependsOn @('ENV-006','ENV-009','ENV-019') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit10 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/preflight/013_solo_plus_payment_recovery_snapshot.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 12 preflight snapshot passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-014' -Name 'Commit 12 staging wrapper apply' -Phase 'F' -RootCauseCategory 'sql-suite-commit12' -CommandDisplay 'Bootstrap through Commit 10 and apply Commit 12 staging wrapper' -DependsOn @('SQL-013') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit10 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/013_solo_plus_payment_recovery.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 12 staging wrapper applied locally.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-015' -Name 'Commit 12 postflight verify' -Phase 'F' -RootCauseCategory 'sql-suite-commit12' -CommandDisplay 'Bootstrap through Commit 10, apply wrapper, and run Commit 12 postflight verify' -DependsOn @('SQL-014') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit10 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/013_solo_plus_payment_recovery.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/013_solo_plus_payment_recovery_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 12 postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-016' -Name 'Commit 12 wrapper rerun and postflight verify' -Phase 'F' -RootCauseCategory 'migration-rerun' -CommandDisplay 'Bootstrap through Commit 10, apply wrapper twice, and rerun Commit 12 postflight verify' -DependsOn @('SQL-015') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit10 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/013_solo_plus_payment_recovery.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/013_solo_plus_payment_recovery.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/013_solo_plus_payment_recovery_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 12 wrapper rerun and postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-017' -Name 'Commit 12 payment recovery RPC SQL regression' -Phase 'F' -RootCauseCategory 'sql-suite-commit12' -CommandDisplay 'Bootstrap through Commit 12 and run phase2_solo_plus_payment_recovery_rpc.sql' -DependsOn @('SQL-016') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/tests/phase2_solo_plus_payment_recovery_rpc.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'phase2_solo_plus_payment_recovery_rpc.sql passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-018' -Name 'Commit 13 authorization hardening preflight snapshot' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 12 and run Commit 13 authorization hardening preflight snapshot' -DependsOn @('ENV-006','ENV-009','ENV-020','SQL-017') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/preflight/014_authorization_hardening_snapshot.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 authorization hardening preflight snapshot passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-019' -Name 'Commit 13 authorization hardening staging wrapper apply' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 12 and apply Commit 13 authorization hardening staging wrapper' -DependsOn @('SQL-018') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 authorization hardening staging wrapper applied locally.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-020' -Name 'Commit 13 authorization hardening postflight verify' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 12, apply authorization wrapper, and run Commit 13 authorization postflight verify' -DependsOn @('SQL-019') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/014_authorization_hardening_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 authorization hardening postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-021' -Name 'Commit 13 authorization hardening wrapper rerun and postflight verify' -Phase 'F' -RootCauseCategory 'migration-rerun' -CommandDisplay 'Bootstrap through Commit 12, apply authorization wrapper twice, and rerun Commit 13 authorization postflight verify' -DependsOn @('SQL-020') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/014_authorization_hardening_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 authorization hardening wrapper rerun and postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-022' -Name 'Commit 13 authorization hardening SQL regression' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 13 authorization hardening and run phase2_authorization_hardening.sql' -DependsOn @('SQL-021') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/migrations/20260728_00_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/tests/phase2_authorization_hardening.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'phase2_authorization_hardening.sql passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-023' -Name 'Commit 13 disclosure preflight snapshot' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 13 authorization hardening and run disclosure preflight snapshot' -DependsOn @('SQL-022') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/preflight/015_verification_disclosure_acknowledgement_snapshot.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 disclosure preflight snapshot passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-024' -Name 'Commit 13 disclosure staging wrapper apply' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 13 authorization hardening and apply disclosure staging wrapper' -DependsOn @('SQL-023') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 disclosure staging wrapper applied locally.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-025' -Name 'Commit 13 disclosure postflight verify' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 13 authorization hardening, apply disclosure wrapper, and run disclosure postflight verify' -DependsOn @('SQL-024') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/015_verification_disclosure_acknowledgement_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 disclosure postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-026' -Name 'Commit 13 disclosure wrapper rerun and postflight verify' -Phase 'F' -RootCauseCategory 'migration-rerun' -CommandDisplay 'Bootstrap through Commit 13 authorization hardening, apply disclosure wrapper twice, and rerun disclosure postflight verify' -DependsOn @('SQL-025') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/015_verification_disclosure_acknowledgement_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 disclosure wrapper rerun and postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-028' -Name 'Commit 13 disclosure identity preflight snapshot' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 13 disclosure acknowledgement and run identity hardening preflight snapshot' -DependsOn @('SQL-026') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/preflight/016_verification_disclosure_identity_hardening_snapshot.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 disclosure identity preflight snapshot passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-029' -Name 'Commit 13 disclosure identity staging wrapper apply' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 13 disclosure acknowledgement and apply identity hardening staging wrapper' -DependsOn @('SQL-028') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/016_verification_disclosure_identity_hardening.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 disclosure identity staging wrapper applied locally.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-030' -Name 'Commit 13 disclosure identity postflight verify' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 13 disclosure acknowledgement, apply identity wrapper, and run identity postflight verify' -DependsOn @('SQL-029') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/016_verification_disclosure_identity_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/016_verification_disclosure_identity_hardening_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 disclosure identity postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-031' -Name 'Commit 13 disclosure identity wrapper rerun and postflight verify' -Phase 'F' -RootCauseCategory 'migration-rerun' -CommandDisplay 'Bootstrap through Commit 13 disclosure acknowledgement, apply identity wrapper twice, and rerun identity postflight verify' -DependsOn @('SQL-030') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit12 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/014_authorization_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/016_verification_disclosure_identity_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/016_verification_disclosure_identity_hardening.sql' | Out-Null
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/staging/postflight/016_verification_disclosure_identity_hardening_verify.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'Commit 13 disclosure identity wrapper rerun and postflight verify passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-027' -Name 'Commit 13 disclosure acknowledgement RPC SQL regression' -Phase 'F' -RootCauseCategory 'sql-suite-commit13' -CommandDisplay 'Bootstrap through Commit 13 and run phase2_verification_disclosure_acknowledgement_rpc.sql' -DependsOn @('SQL-031') -Callback {
      param($ctx)
      Bootstrap-ThroughCommit13 -Context $ctx
      Invoke-PsqlFileStrict -Context $ctx -RelativePath 'supabase/tests/phase2_verification_disclosure_acknowledgement_rpc.sql' | Out-Null
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'phase2_verification_disclosure_acknowledgement_rpc.sql passed.'; Stderr = '' }
    }),
  (New-CallbackCheck -Id 'SQL-011' -Name 'Migration safety self-tests' -Phase 'F' -RootCauseCategory 'harness-safety' -CommandDisplay 'Run migration safety self-tests' -DependsOn @('ENV-006','ENV-009') -Callback {
      param($ctx)
      $result = Invoke-CapturedProcess -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File','.\\scripts\\test-breet-solo-plus-migrations.ps1','-RunSafetySelfTests','-RunHarnessSelfTests','-PsqlPath',$resolvedPsqlForHarness,'-PsqlTimeoutSeconds','120','-TestDatabaseUrl',$ctx.TestDatabaseUrl) -WorkingDirectory $ctx.RepoRoot -TimeoutSeconds 600
      if ($result.ExitCode -ne 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = $result.ExitCode; Stdout = $result.Stdout; Stderr = $result.Stderr }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = $result.Stdout; Stderr = $result.Stderr }
    }),
  (New-CommandCheck -Id 'SQL-012' -Name 'Full hostile/default-grant harness' -Phase 'F' -RootCauseCategory 'hostile-harness' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File','.\\scripts\\test-breet-solo-plus-migrations.ps1','-PsqlPath',$resolvedPsqlForHarness,'-PsqlTimeoutSeconds','120','-TestDatabaseUrl',$context.TestDatabaseUrl) -TimeoutSeconds 600 -DependsOn @('ENV-006','ENV-009')),
  (New-CommandCheck -Id 'FINAL-001' -Name 'Final git status' -Phase 'G' -RootCauseCategory 'repository-state' -FilePath 'git' -Arguments @('status', '--short') -TimeoutSeconds 120),
  (New-CommandCheck -Id 'FINAL-002' -Name 'Final git diff --stat' -Phase 'G' -RootCauseCategory 'repository-state' -FilePath 'git' -Arguments @('diff', '--stat') -TimeoutSeconds 120),
  (New-CommandCheck -Id 'FINAL-003' -Name 'Final git diff --name-only' -Phase 'G' -RootCauseCategory 'repository-state' -FilePath 'git' -Arguments @('diff', '--name-only') -TimeoutSeconds 120)
)

foreach ($check in $checks) {
  Write-Host ("RUNNING {0} {1}" -f $check.Id, $check.Name)
  $result = Invoke-ManifestCheck -Check $check -Context $context
  Save-CheckResult -Result $result
  $statusLabel = $result.Status.PadRight(7)
  Write-Host ("{0} {1} {2}" -f $statusLabel, $result.Id.PadRight(8), $result.Name)
  if ($result.Status -in @('FAIL', 'BLOCKED')) {
    Write-Host ("         {0}" -f $result.ErrorExcerpt)
    Write-Host ("         logs: {0}" -f $result.StdoutLog)
  }
}

$summary = [ordered]@{
  Total   = $script:CheckResults.Count
  Pass    = @($script:CheckResults | Where-Object Status -eq 'PASS').Count
  Fail    = @($script:CheckResults | Where-Object Status -eq 'FAIL').Count
  Blocked = @($script:CheckResults | Where-Object Status -eq 'BLOCKED').Count
  Skipped = @($script:CheckResults | Where-Object Status -eq 'SKIPPED').Count
}

$rootCauseGroups = $script:CheckResults |
  Where-Object { $_.Status -in @('FAIL', 'BLOCKED') } |
  Group-Object RootCauseCategory |
  Sort-Object Name

Write-Host ''
Write-Host 'Validation Summary'
Write-Host ('  total   : {0}' -f $summary.Total)
Write-Host ('  pass    : {0}' -f $summary.Pass)
Write-Host ('  fail    : {0}' -f $summary.Fail)
Write-Host ('  blocked : {0}' -f $summary.Blocked)
Write-Host ('  skipped : {0}' -f $summary.Skipped)
Write-Host ('  logs    : {0}' -f $script:LogRoot)

if ($rootCauseGroups) {
  Write-Host ''
  Write-Host 'Root Cause Groups'
  foreach ($group in $rootCauseGroups) {
    Write-Host ("  - {0}" -f $group.Name)
    foreach ($item in $group.Group) {
      Write-Host ("    * {0} {1}" -f $item.Id, $item.Name)
    }
  }
}

Write-Host ''
Write-Host 'Failed or Blocked Checks'
foreach ($item in $script:CheckResults | Where-Object { $_.Status -in @('FAIL', 'BLOCKED') }) {
  Write-Host ("[{0}] {1} {2}" -f $item.Status, $item.Id, $item.Name)
  Write-Host ("  command : {0}" -f $item.Command)
  Write-Host ("  excerpt : {0}" -f $item.ErrorExcerpt)
  Write-Host ("  stdout  : {0}" -f $item.StdoutLog)
  Write-Host ("  stderr  : {0}" -f $item.StderrLog)
}

$hasUnexpectedFailure = ($summary.Fail -gt 0) -or ($summary.Blocked -gt 0)
exit ([int]($hasUnexpectedFailure))
