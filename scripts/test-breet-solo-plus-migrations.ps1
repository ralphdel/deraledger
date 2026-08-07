[CmdletBinding()]
param(
  [string]$TestDatabaseUrl = $env:TEST_DATABASE_URL,
  [string]$PsqlPath = "psql",
  [int]$PsqlTimeoutSeconds = 120,
  [switch]$RunSafetySelfTests,
  [switch]$RunHarnessSelfTests
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$knownBlockedProjectRefs = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
[void]$knownBlockedProjectRefs.Add("fsjljliiyfchkwbjifzw")
$disposableDatabasePattern = '^(test_.+|.+_test|tmp_.+|.+_tmp|disposable_.+|.+_disposable|scratch_.+|.+_scratch|ci_.+|.+_ci)$'
$standardForbiddenDatabaseNames = @("postgres", "template0", "template1", "app", "production", "staging", "deraledger")
$script:HarnessStepCounter = 0
$script:HarnessProgressMessages = [System.Collections.Generic.List[string]]::new()
$script:JobObjectInteropLoaded = $false

function Ensure-JobObjectInterop {
  if ($script:JobObjectInteropLoaded -or $env:OS -ne "Windows_NT") {
    return
  }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class DeraLedgerJobObject
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

function Add-BlockedProjectRefsFromCsv {
  param([string]$Csv)
  if ([string]::IsNullOrWhiteSpace($Csv)) { return }
  foreach ($value in ($Csv -split ",")) {
    $trimmed = $value.Trim()
    if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
      [void]$knownBlockedProjectRefs.Add($trimmed)
    }
  }
}

function Add-BlockedProjectRefFromFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  $value = (Get-Content -Path $Path -Raw).Trim()
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    [void]$knownBlockedProjectRefs.Add($value)
  }
}

function Add-BlockedProjectRefFromLinkedProject {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  $json = Get-Content -Path $Path -Raw | ConvertFrom-Json
  if (-not [string]::IsNullOrWhiteSpace($json.ref)) {
    [void]$knownBlockedProjectRefs.Add($json.ref.Trim())
  }
}

Add-BlockedProjectRefsFromCsv -Csv $env:BLOCKED_SUPABASE_PROJECT_REFS
Add-BlockedProjectRefsFromCsv -Csv $env:KNOWN_PRODUCTION_PROJECT_REFS
Add-BlockedProjectRefFromFile -Path (Join-Path $repoRoot "supabase/.temp/project-ref")
Add-BlockedProjectRefFromLinkedProject -Path (Join-Path $repoRoot "supabase/.temp/linked-project.json")

function Normalize-Sql {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  return ([regex]::Replace($Value.ToLowerInvariant(), "\s+", " ")).Trim()
}

function Redact-SensitiveText {
  param([AllowNull()][string]$Value)

  if ($null -eq $Value) {
    return ""
  }

  $redacted = [string]$Value
  $password = Get-Item -Path "Env:PGPASSWORD" -ErrorAction SilentlyContinue
  if ($password -and -not [string]::IsNullOrEmpty([string]$password.Value)) {
    $redacted = $redacted -replace [regex]::Escape([string]$password.Value), "<redacted-password>"
  }

  return [regex]::Replace(
    $redacted,
    "(postgres(?:ql)?://)([^/\s:@]+):([^@\s/]*)@",
    '$1$2:***@',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
}

function Convert-ArgumentListToCommandLine {
  param([string[]]$Arguments)

  return (($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') {
          '"' + ($_ -replace '"', '\"') + '"'
        } else {
          $_
        }
      }) -join " ")
}

function Stop-ProcessTree {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  if ($env:OS -eq "Windows_NT") {
    try {
      & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    } catch {
    }
    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
      return
    }
  }

  $children = @()
  try {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue)
  } catch {
    try {
      $children = @(Get-WmiObject Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    } catch {
      $children = @()
    }
  }

  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
    try {
      if ($child.PSObject.Methods.Name -contains "Terminate") {
        [void]$child.Terminate()
      }
    } catch {
    }
  }

  try {
    $self = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if ($self) {
      [void]$self.Terminate()
    }
  } catch {
    try {
      $self = Get-WmiObject Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
      if ($self) {
        [void]$self.Terminate()
      }
    } catch {
    }
  }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function Invoke-CapturedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [int]$TimeoutSeconds = 120
  )

  $resolvedFilePath = $FilePath
  if (-not ($FilePath -match '[\\/]') -and -not (Test-Path $FilePath)) {
    $resolvedCommand = Get-Command $FilePath -ErrorAction SilentlyContinue
    if ($resolvedCommand) {
      $resolvedFilePath = $resolvedCommand.Source
    }
  }

  $joinedArguments = Convert-ArgumentListToCommandLine -Arguments $Arguments
  $effectiveFilePath = $resolvedFilePath
  $effectiveArguments = $joinedArguments
  if ($resolvedFilePath -match '\.(cmd|bat)$') {
    $cmdTail = if ([string]::IsNullOrWhiteSpace($joinedArguments)) { "" } else { " " + $joinedArguments }
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
    if ($env:OS -eq "Windows_NT") {
      try {
        Ensure-JobObjectInterop
        $jobHandle = [DeraLedgerJobObject]::CreateKillOnCloseJob()
        if ($jobHandle -ne [IntPtr]::Zero) {
          $jobOwnsProcessTree = [DeraLedgerJobObject]::AssignProcessToJobObject($jobHandle, $process.Handle)
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
          [void][DeraLedgerJobObject]::CloseHandle($jobHandle)
          $jobHandle = [IntPtr]::Zero
        } else {
          Stop-ProcessTree -ProcessId $process.Id
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
      Command    = Redact-SensitiveText ((@($effectiveFilePath) + @($effectiveArguments)) -join " ")
    }
  }
  finally {
    $stopwatch.Stop()
    if ($jobHandle -ne [IntPtr]::Zero) {
      try {
        [void][DeraLedgerJobObject]::CloseHandle($jobHandle)
      } catch {
      }
    }
    if ($process) {
      $process.Dispose()
    }
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

function Assert-SafeDisposableDatabase {
  param(
    [string]$ConnectionString,
    [System.Collections.Generic.HashSet[string]]$BlockedRefs = $knownBlockedProjectRefs
  )

  if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
    throw "TEST_DATABASE_URL is required. The harness refuses to guess a database target."
  }

  foreach ($blocked in $BlockedRefs) {
    if ($ConnectionString -match [regex]::Escape($blocked)) {
      throw "Refusing to run against blocked Supabase project reference '$blocked'."
    }
  }

  $uri = [System.Uri]$ConnectionString
  $dbName = $uri.AbsolutePath.Trim("/")
  $dbHost = $uri.Host.ToLowerInvariant()
  $explicitSslMode = Get-ConnectionStringQueryParameterValue -Uri $uri -Name "sslmode"
  $parsedIp = $null
  $isLoopback = $dbHost -in @("localhost", "127.0.0.1", "::1")
  if (-not $isLoopback -and [System.Net.IPAddress]::TryParse($uri.Host, [ref]$parsedIp)) {
    $isLoopback = [System.Net.IPAddress]::IsLoopback($parsedIp)
  }

  if ([string]::IsNullOrWhiteSpace($dbName)) {
    throw "TEST_DATABASE_URL must include an explicit disposable database name."
  }

  if (-not $isLoopback) {
    throw "Refusing to run against non-local database host '$dbHost'. The harness only supports disposable local databases."
  }

  if ($dbName.ToLowerInvariant() -in $standardForbiddenDatabaseNames) {
    throw "Refusing to run against standard or protected database name '$dbName'. Point TEST_DATABASE_URL at an explicitly disposable application database."
  }

  if (-not [regex]::IsMatch($dbName, $disposableDatabasePattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
    throw "Refusing to run against non-disposable database name '$dbName' on host '$dbHost'. Use an explicitly disposable database name."
  }

  if ($explicitSslMode -and $explicitSslMode.Trim().ToLowerInvariant() -ne "disable") {
    throw "TEST_DATABASE_URL must not request a contradictory SSL mode for local disposable validation."
  }
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

  try {
    Remove-Item -Path "Env:PGHOST" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGPORT" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGUSER" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGDATABASE" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGSERVICE" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGSERVICEFILE" -ErrorAction SilentlyContinue
    Set-Item -Path "Env:PGSSLMODE" -Value "disable"
    Set-Item -Path "Env:PGCONNECT_TIMEOUT" -Value "10"

    return & $Operation
  }
  finally {
    Restore-LibpqEnvironment -Snapshot $snapshot
  }
}

function Assert-SafetyGateCase {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ConnectionString,
    [Parameter(Mandatory = $true)][bool]$ShouldPass,
    [System.Collections.Generic.HashSet[string]]$BlockedRefs = $knownBlockedProjectRefs
  )

  try {
    Assert-SafeDisposableDatabase -ConnectionString $ConnectionString -BlockedRefs $BlockedRefs
    if (-not $ShouldPass) {
      throw "Expected rejection but the safety gate accepted the target."
    }
    Write-Host "PASS: $Name"
  }
  catch {
    if ($ShouldPass) {
      throw "Safety gate case failed unexpectedly ($Name): $($_.Exception.Message)"
    }
    Write-Host "PASS: $Name -> rejected ($($_.Exception.Message))"
  }
}

function Run-SafetySelfTests {
  $blockedRefs = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($blocked in $knownBlockedProjectRefs) {
    [void]$blockedRefs.Add($blocked)
  }
  [void]$blockedRefs.Add("prodrefexample123")

  Assert-SafetyGateCase -Name "accept disposable localhost name" -ConnectionString "postgresql://user:password@localhost/test_commit7" -ShouldPass $true -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "reject disposable remote name" -ConnectionString "postgresql://user:password@db.example.com/ci_commit7" -ShouldPass $false -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "reject localhost non-disposable name" -ConnectionString "postgresql://user:password@localhost/app" -ShouldPass $false -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "reject standard postgres database" -ConnectionString "postgresql://user:password@127.0.0.1/postgres" -ShouldPass $false -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "reject staging project reference" -ConnectionString "postgresql://user:password@db.example.com/test_commit7?project_ref=fsjljliiyfchkwbjifzw" -ShouldPass $false -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "reject production project reference" -ConnectionString "postgresql://user:password@db.example.com/test_commit7?project_ref=prodrefexample123" -ShouldPass $false -BlockedRefs $blockedRefs
}

function Add-PassResult {
  param(
    [Parameter(Mandatory = $true)]$Results,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $Results.Add("PASS: $Message")
  Write-Host "PASS: $Message"
}

function Assert-HarnessSelfTest {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Condition) {
    throw "Harness self-test failed: $Message"
  }
}

function Get-ContainingPowerShellFunctionName {
  param($Node, [object[]]$Functions)
  $matches=@($Functions | Where-Object {
    $_.Extent.StartOffset -le $Node.Extent.StartOffset -and $_.Extent.EndOffset -ge $Node.Extent.EndOffset
  } | Sort-Object { $_.Extent.EndOffset - $_.Extent.StartOffset })
  if($matches.Count -eq 0){return ''}
  return $matches[0].Name
}

function Assert-ProductionRehearsalArchitectureAst {
  param([string]$HelperPath,[string]$GeneratorPath)
  $helperTokens=$null;$helperErrors=$null;$generatorTokens=$null;$generatorErrors=$null
  $helperAst=[Management.Automation.Language.Parser]::ParseFile($HelperPath,[ref]$helperTokens,[ref]$helperErrors)
  $generatorAst=[Management.Automation.Language.Parser]::ParseFile($GeneratorPath,[ref]$generatorTokens,[ref]$generatorErrors)
  Assert-HarnessSelfTest (@($helperErrors).Count -eq 0 -and @($generatorErrors).Count -eq 0) 'production rehearsal helper or generator has AST errors.'
  $helperFunctions=@($helperAst.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$true))
  $generatorFunctions=@($generatorAst.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$true))
  foreach($group in @($helperFunctions|Group-Object Name)){Assert-HarnessSelfTest ($group.Count -eq 1) "canonical helper function cardinality invalid: $($group.Name)"}
  $sharedNames=@($helperFunctions.Name|Where-Object {$_ -in $generatorFunctions.Name})
  Assert-HarnessSelfTest ($sharedNames.Count -eq 0) "generator shadows canonical helper functions: $($sharedNames -join ',')"
  foreach($obsolete in @('Assert-DRCondition','ConvertTo-DRTarget','ConvertTo-DRSqlLiteral','ConvertFrom-DRControlRow','Assert-DRRunnerText','Assert-DRMarkers','Assert-DRGitState')){
    Assert-HarnessSelfTest (@(($helperFunctions+$generatorFunctions)|Where-Object Name -eq $obsolete).Count -eq 0) "obsolete DR shadow remains: $obsolete"
  }

  $readHostCommands=@($helperAst.FindAll({param($node)$node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Read-Host'},$true))
  Assert-HarnessSelfTest ($readHostCommands.Count -eq 1 -and (Get-ContainingPowerShellFunctionName $readHostCommands[0] $helperFunctions) -eq 'New-ProductionRehearsalRuntimeContext') 'Read-Host exists outside the approved credential provider.'
  $resolverCommands=@($helperAst.FindAll({param($node)
    if($node -isnot [Management.Automation.Language.CommandAst]){return $false}
    $name=$node.GetCommandName();if($name -notin @('Test-Path','Get-Command')){return $false}
    return $node.Extent.Text -match '(?i)(PsqlPath|PgDumpPath|\.exe)'
  },$true))
  foreach($command in $resolverCommands){Assert-HarnessSelfTest ((Get-ContainingPowerShellFunctionName $command $helperFunctions) -eq 'New-ProductionRehearsalRuntimeContext') 'executable resolution exists outside the approved resolver.'}

  $helperStarts=@($helperAst.FindAll({param($node)$node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Extent.Text -match '\[System\.Diagnostics\.Process\]::Start'},$true))
  $generatorStarts=@($generatorAst.FindAll({param($node)$node -is [Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Extent.Text -match '\[System\.Diagnostics\.Process\]::Start'},$true))
  Assert-HarnessSelfTest ($helperStarts.Count -eq 1 -and (Get-ContainingPowerShellFunctionName $helperStarts[0] $helperFunctions) -eq 'Invoke-ProcessStart' -and $generatorStarts.Count -eq 0) 'direct Process.Start exists outside the approved process-start adapter.'

  $packageCalls=@($generatorAst.FindAll({param($node)$node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'New-ProductionRehearsalPackage'},$true))
  $productionPackageCalls=@($packageCalls|Where-Object {(Get-ContainingPowerShellFunctionName $_ $generatorFunctions) -eq ''})
  Assert-HarnessSelfTest ($productionPackageCalls.Count -eq 1) 'production package generation call cardinality is invalid.'
  $packageAssignments=@($generatorAst.FindAll({param($node)$node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Extent.Text -match 'PackageGenerationBoundary'},$true))
  Assert-HarnessSelfTest (@($packageAssignments|Where-Object {$_.Extent.StartOffset -le $productionPackageCalls[0].Extent.StartOffset -and $_.Extent.EndOffset -ge $productionPackageCalls[0].Extent.EndOffset}).Count -eq 1) 'package generation call exists outside its approved boundary.'

  foreach($astRecord in @(@{Ast=$helperAst;Functions=$helperFunctions;Name='helper'},@{Ast=$generatorAst;Functions=$generatorFunctions;Name='generator'})){
    $directSql=@($astRecord.Ast.FindAll({param($node)$node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -match '^(psql|pg_dump)(\.exe)?$'},$true))
    Assert-HarnessSelfTest ($directSql.Count -eq 0) "direct SQL executable invocation found in $($astRecord.Name)."
  }
  $invokeRehearsal=@($helperFunctions|Where-Object Name -eq 'Invoke-Rehearsal')
  Assert-HarnessSelfTest ($invokeRehearsal.Count -eq 1 -and $invokeRehearsal[0].Extent.Text -notmatch 'Invoke-NativeChecked' -and $invokeRehearsal[0].Extent.Text -match 'Invoke-RehearsalProcess') 'SQL execution bypasses the approved rehearsal process boundary.'
  $artifactFunction=@($helperFunctions|Where-Object Name -eq 'Assert-ArtifactIntegrity')
  $artifactReturns=@($artifactFunction[0].FindAll({param($node)$node -is [Management.Automation.Language.ReturnStatementAst]},$true))
  $bypassVariables=@($helperAst.FindAll({param($node)$node -is [Management.Automation.Language.VariableExpressionAst] -and $node.VariablePath.UserPath -eq 'SkipEmbeddedContract'},$true)) + @($generatorAst.FindAll({param($node)$node -is [Management.Automation.Language.VariableExpressionAst] -and $node.VariablePath.UserPath -eq 'SkipEmbeddedContract'},$true))
  $bypassMembers=@($helperAst.FindAll({param($node)$node -is [Management.Automation.Language.MemberExpressionAst] -and $node.Member.Value -eq 'SkipEmbeddedContract'},$true)) + @($generatorAst.FindAll({param($node)$node -is [Management.Automation.Language.MemberExpressionAst] -and $node.Member.Value -eq 'SkipEmbeddedContract'},$true))
  Assert-HarnessSelfTest ($artifactFunction.Count -eq 1 -and $artifactReturns.Count -eq 0 -and $bypassVariables.Count -eq 0 -and $bypassMembers.Count -eq 0) 'artifact integrity contains a bypass or early return.'

  $productionGeneratorFunctions=@(
    'Replace-SinglePlaceholder','Get-GitBlobBytes','Remove-TopLevelTransactionEnvelopeBytes',
    'Test-WrapperTemplateStaticContract','New-WrapperExpansion','Expand-WrapperTemplate','New-ProductionRehearsalPackage'
  )
  $guardRows=[Collections.Generic.List[object]]::new()
  foreach($astRecord in @(
    @{Ast=$helperAst;Functions=$helperFunctions;Path=$HelperPath;ProductionFunctions=@($helperFunctions.Name);IncludeTopLevel=$false},
    @{Ast=$generatorAst;Functions=$generatorFunctions;Path=$GeneratorPath;ProductionFunctions=$productionGeneratorFunctions;IncludeTopLevel=$true}
  )){
    $guardCommands=@($astRecord.Ast.FindAll({param($node)$node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Assert-Condition'},$true))
    foreach($command in $guardCommands){
      $owner=Get-ContainingPowerShellFunctionName $command $astRecord.Functions
      $isProduction=($astRecord.ProductionFunctions -contains $owner) -or ($astRecord.IncludeTopLevel -and [string]::IsNullOrWhiteSpace($owner))
      if(-not $isProduction){continue}
      Assert-HarnessSelfTest ($command.CommandElements.Count -ge 5) "production guard metadata is missing: $($astRecord.Path):$($command.Extent.StartLineNumber)"
      $guardId=$null;$classification=$null
      try{$guardId=$command.CommandElements[3].SafeGetValue();$classification=$command.CommandElements[4].SafeGetValue()}catch{Assert-HarnessSelfTest $false "production guard ID or classification is dynamic: $($astRecord.Path):$($command.Extent.StartLineNumber)"}
      Assert-HarnessSelfTest ($guardId -match '^(RV|GEN)\.[A-Z0-9_.]+$') "production guard ID is invalid: $guardId"
      Assert-HarnessSelfTest ($classification -match '^[A-Z0-9_]+$') "production guard classification is invalid: $guardId"
      $compound=@($command.CommandElements[1].FindAll({param($node)$node -is [Management.Automation.Language.BinaryExpressionAst] -and $node.Operator -in @([Management.Automation.Language.TokenKind]::And,[Management.Automation.Language.TokenKind]::Or)},$true))
      Assert-HarnessSelfTest ($compound.Count -eq 0) "compound production guard was not decomposed: $guardId"
      $guardRows.Add([pscustomobject]@{guard_id=$guardId;classification=$classification;source=[IO.Path]::GetFileName($astRecord.Path)})
    }

    $throws=@($astRecord.Ast.FindAll({param($node)$node -is [Management.Automation.Language.ThrowStatementAst]},$true))
    foreach($throw in $throws){
      $owner=Get-ContainingPowerShellFunctionName $throw $astRecord.Functions
      $isProduction=($astRecord.ProductionFunctions -contains $owner) -or ($astRecord.IncludeTopLevel -and [string]::IsNullOrWhiteSpace($owner))
      if(-not $isProduction){continue}
      $allowedPrimitive=$owner -eq 'Assert-Condition'
      $allowedOperationalRethrow=$owner -eq 'Invoke-RehearsalLifecycle' -and $throw.Extent.Text -eq 'throw $bodyFailure'
      $allowedTopLevelRethrow=[string]::IsNullOrWhiteSpace($owner) -and $throw.Extent.Text -eq 'throw'
      Assert-HarnessSelfTest ($allowedPrimitive -or $allowedOperationalRethrow -or $allowedTopLevelRethrow) "direct production validation throw remains: $($astRecord.Path):$($throw.Extent.StartLineNumber)"
    }
  }
  Assert-HarnessSelfTest (@($guardRows|Group-Object guard_id|Where-Object Count -ne 1).Count -eq 0) 'production guard IDs are duplicated.'
  $script:HarnessStaticGuardRows=@($guardRows)
}

function Assert-RehearsalGuardAstMutationRejected {
  param([string]$HelperPath,[string]$GeneratorPath,[string]$TemporaryRoot,[string]$MutationId,[scriptblock]$Mutator)
  $caseRoot=Join-Path $TemporaryRoot ("guard-ast-"+$MutationId.ToLowerInvariant())
  New-Item -ItemType Directory -Path $caseRoot -Force|Out-Null
  $helperCopy=Join-Path $caseRoot 'production-rehearsal-validation.ps1'
  $generatorCopy=Join-Path $caseRoot 'new-production-rehearsal-package.ps1'
  Copy-Item -LiteralPath $HelperPath -Destination $helperCopy
  Copy-Item -LiteralPath $GeneratorPath -Destination $generatorCopy
  try{
    & $Mutator $helperCopy $generatorCopy
    $rejected=$false
    try{Assert-ProductionRehearsalArchitectureAst -HelperPath $helperCopy -GeneratorPath $generatorCopy}catch{$rejected=$true}
    Assert-HarnessSelfTest $rejected "guard AST mutation was accepted: $MutationId"
  }finally{
    Remove-Item -LiteralPath $caseRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function New-InvoiceFkControlState {
  param(
    [string]$InvoiceIdType = "uuid",
    [bool]$InvoiceIdNullable = $true,
    [int]$CandidateCount = 1,
    [int]$NamedCount = 1,
    [int]$ExactReferenceCount = 1,
    [int]$ConflictingCount = 0,
    [bool]$AllCandidatesValidated = $true,
    [string]$DeleteAction = "SET NULL"
  )

  @{
    InvoiceIdType = $InvoiceIdType
    InvoiceIdNullable = $InvoiceIdNullable
    CandidateCount = $CandidateCount
    NamedCount = $NamedCount
    ExactReferenceCount = $ExactReferenceCount
    ConflictingCount = $ConflictingCount
    AllCandidatesValidated = $AllCandidatesValidated
    DeleteAction = $DeleteAction
  }
}

function Get-InvoiceFkControlClassification {
  param([hashtable]$State)

  $exactShape = (
    $State.InvoiceIdType -eq "uuid" -and
    $State.InvoiceIdNullable -eq $true -and
    $State.CandidateCount -eq 1 -and
    $State.NamedCount -eq 1 -and
    $State.ExactReferenceCount -eq 1 -and
    $State.ConflictingCount -eq 0 -and
    $State.AllCandidatesValidated -eq $true
  )
  $canonicalAlready = $exactShape -and $State.DeleteAction -eq "SET NULL"
  $normalizationRequired = $exactShape -and $State.DeleteAction -eq "NO ACTION"
  $legacyCompatible = $canonicalAlready -or $normalizationRequired

  [pscustomobject]@{
    LegacyCompatible = $legacyCompatible
    CanonicalAlready = $canonicalAlready
    NormalizationRequired = $normalizationRequired
    Accepted = $legacyCompatible
  }
}

function Assert-InvoiceFkControlClassification {
  param(
    [string]$Name,
    [hashtable]$State,
    [bool]$ExpectedLegacyCompatible,
    [bool]$ExpectedCanonicalAlready,
    [bool]$ExpectedNormalizationRequired,
    [bool]$ExpectedAccepted
  )

  $classification = Get-InvoiceFkControlClassification -State $State
  Assert-HarnessSelfTest -Condition ($classification.LegacyCompatible -eq $ExpectedLegacyCompatible) -Message "$Name legacy-compatible mismatch."
  Assert-HarnessSelfTest -Condition ($classification.CanonicalAlready -eq $ExpectedCanonicalAlready) -Message "$Name canonical-already mismatch."
  Assert-HarnessSelfTest -Condition ($classification.NormalizationRequired -eq $ExpectedNormalizationRequired) -Message "$Name normalization-required mismatch."
  Assert-HarnessSelfTest -Condition ($classification.Accepted -eq $ExpectedAccepted) -Message "$Name accepted mismatch."
  Assert-HarnessSelfTest -Condition (-not ($classification.CanonicalAlready -and $classification.NormalizationRequired)) -Message "$Name cannot be both canonical and normalization-required."
}

function Assert-InvoiceFkOfflineClassificationMatrix {
  $cases = @(
    @{ Name = "canonical-set-null"; State = New-InvoiceFkControlState -DeleteAction "SET NULL"; Legacy = $true; Canonical = $true; Normalize = $false; Accepted = $true },
    @{ Name = "legacy-no-action"; State = New-InvoiceFkControlState -DeleteAction "NO ACTION"; Legacy = $true; Canonical = $false; Normalize = $true; Accepted = $true },
    @{ Name = "wrong-name"; State = New-InvoiceFkControlState -NamedCount 0 -ConflictingCount 1; Legacy = $false; Canonical = $false; Normalize = $false; Accepted = $false },
    @{ Name = "wrong-reference"; State = New-InvoiceFkControlState -ExactReferenceCount 0 -ConflictingCount 1; Legacy = $false; Canonical = $false; Normalize = $false; Accepted = $false },
    @{ Name = "multiple-candidates"; State = New-InvoiceFkControlState -CandidateCount 2 -ConflictingCount 1; Legacy = $false; Canonical = $false; Normalize = $false; Accepted = $false },
    @{ Name = "unvalidated"; State = New-InvoiceFkControlState -AllCandidatesValidated $false -ConflictingCount 1; Legacy = $false; Canonical = $false; Normalize = $false; Accepted = $false },
    @{ Name = "cascade"; State = New-InvoiceFkControlState -DeleteAction "CASCADE"; Legacy = $false; Canonical = $false; Normalize = $false; Accepted = $false },
    @{ Name = "set-default"; State = New-InvoiceFkControlState -DeleteAction "SET DEFAULT"; Legacy = $false; Canonical = $false; Normalize = $false; Accepted = $false },
    @{ Name = "not-null"; State = New-InvoiceFkControlState -InvoiceIdNullable $false; Legacy = $false; Canonical = $false; Normalize = $false; Accepted = $false },
    @{ Name = "wrong-type"; State = New-InvoiceFkControlState -InvoiceIdType "text"; Legacy = $false; Canonical = $false; Normalize = $false; Accepted = $false }
  )

  foreach ($case in @($cases)) {
    Assert-InvoiceFkControlClassification `
      -Name $case.Name `
      -State $case.State `
      -ExpectedLegacyCompatible $case.Legacy `
      -ExpectedCanonicalAlready $case.Canonical `
      -ExpectedNormalizationRequired $case.Normalize `
      -ExpectedAccepted $case.Accepted
  }

  $noActionCanonical = New-InvoiceFkControlState -DeleteAction "NO ACTION"
  Assert-HarnessSelfTest -Condition (-not (Get-InvoiceFkControlClassification -State $noActionCanonical).CanonicalAlready) -Message "NO ACTION was marked canonical."
  $setNullNormalize = New-InvoiceFkControlState -DeleteAction "SET NULL"
  Assert-HarnessSelfTest -Condition (-not (Get-InvoiceFkControlClassification -State $setNullNormalize).NormalizationRequired) -Message "SET NULL was marked normalization-required."
  $wrongReference = New-InvoiceFkControlState -ExactReferenceCount 0 -ConflictingCount 1 -DeleteAction "NO ACTION"
  Assert-HarnessSelfTest -Condition (-not (Get-InvoiceFkControlClassification -State $wrongReference).LegacyCompatible) -Message "Wrong reference was marked legacy-compatible."
  $multipleCompatible = New-InvoiceFkControlState -CandidateCount 2 -ConflictingCount 1 -DeleteAction "NO ACTION"
  Assert-HarnessSelfTest -Condition (-not (Get-InvoiceFkControlClassification -State $multipleCompatible).LegacyCompatible) -Message "Multiple candidates were marked compatible."
  $notNullCanonical = New-InvoiceFkControlState -InvoiceIdNullable $false -DeleteAction "SET NULL"
  Assert-HarnessSelfTest -Condition (-not (Get-InvoiceFkControlClassification -State $notNullCanonical).CanonicalAlready) -Message "NOT NULL invoice_id was marked canonical."
  $unsupported = New-InvoiceFkControlState -DeleteAction "RESTRICT"
  Assert-HarnessSelfTest -Condition (-not (Get-InvoiceFkControlClassification -State $unsupported).LegacyCompatible) -Message "Unsupported delete action was accepted."
}

function Assert-InvoiceFkReferencePredicatesOutsideHaving {
  param(
    [Parameter(Mandatory = $true)][string]$SourceName,
    [Parameter(Mandatory = $true)][string]$SourceText,
    [Parameter(Mandatory = $true)][string]$CountVariableName
  )

  $countVariablePattern = [regex]::Escape($CountVariableName)
  $blockPattern = "(?is)SELECT\s+count\(\*\)::integer,[\s\S]*?INTO\s+[\s\S]*?\b$countVariablePattern\b[\s\S]*?FROM\s+pg_constraint\s+con[\s\S]*?WHERE[\s\S]*?con\.conname\s*=\s*'payment_events_invoice_id_fkey'[\s\S]*?GROUP\s+BY\s+con\.conname,\s+con\.confdeltype\s+HAVING[\s\S]*?;"
  $blockMatch = [regex]::Match($SourceText, $blockPattern)
  Assert-HarnessSelfTest -Condition $blockMatch.Success -Message "$SourceName payment_events.invoice_id FK assertion block was not found."

  $block = $blockMatch.Value
  $whereMatch = [regex]::Match($block, "(?is)\bWHERE\b(?<where>.*?)\bGROUP\s+BY\b")
  $havingMatch = [regex]::Match($block, "(?is)\bHAVING\b(?<having>.*?);")
  Assert-HarnessSelfTest -Condition $whereMatch.Success -Message "$SourceName invoice FK assertion WHERE clause was not found."
  Assert-HarnessSelfTest -Condition $havingMatch.Success -Message "$SourceName invoice FK assertion HAVING clause was not found."

  $where = $whereMatch.Groups["where"].Value
  $having = $havingMatch.Groups["having"].Value
  Assert-HarnessSelfTest -Condition ($where -match "ref_ns\.nspname::text\s*=\s*'public'") -Message "$SourceName invoice FK referenced schema predicate must be in WHERE."
  Assert-HarnessSelfTest -Condition ($where -match "ref_cls\.relname::text\s*=\s*'invoices'") -Message "$SourceName invoice FK referenced table predicate must be in WHERE."
  Assert-HarnessSelfTest -Condition ($having -notmatch "ref_ns\.nspname|ref_cls\.relname") -Message "$SourceName invoice FK assertion must not reference ref_ns/ref_cls row columns in HAVING."
  Assert-HarnessSelfTest -Condition ($having -match "array_agg\(src\.attname::text ORDER BY src_ord\.ordinality\)\s*=\s*ARRAY\['invoice_id'\]::text\[\]") -Message "$SourceName invoice FK local-column aggregate check must remain in HAVING."
  Assert-HarnessSelfTest -Condition ($having -match "array_agg\(ref\.attname::text ORDER BY ref_ord\.ordinality\)\s*=\s*ARRAY\['id'\]::text\[\]") -Message "$SourceName invoice FK referenced-column aggregate check must remain in HAVING."
}

function New-FakeBatchCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $path = Join-Path $Directory "$Name.cmd"
  Set-Content -Path $path -Value $Content -Encoding ASCII
  return $path
}

function Assert-LibpqEnvironmentRestored {
  param([hashtable]$Snapshot)

  foreach ($entry in $Snapshot.GetEnumerator()) {
    $current = Get-Item -Path "Env:$($entry.Key)" -ErrorAction SilentlyContinue
    if ($entry.Value.Present) {
      Assert-HarnessSelfTest -Condition ($current -and $current.Value -eq $entry.Value.Value) -Message "$($entry.Key) was not restored."
    } else {
      Assert-HarnessSelfTest -Condition ($null -eq $current) -Message "$($entry.Key) should have been removed again."
    }
  }
}

function Get-RollbackRunnerMigrationPaths {
  return @(
    @{ Number = "006"; Path = "supabase/staging/006_solo_plus_prerequisites.sql" },
    @{ Number = "007"; Path = "supabase/staging/007_solo_plus_case_foundation.sql" },
    @{ Number = "008"; Path = "supabase/staging/008_solo_plus_transactional_repository_rpcs.sql" },
    @{ Number = "009"; Path = "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" },
    @{ Number = "010"; Path = "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" },
    @{ Number = "011"; Path = "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" },
    @{ Number = "012"; Path = "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" },
    @{ Number = "013"; Path = "supabase/migrations/20260718_01_solo_plus_payment_recovery.sql" },
    @{ Number = "014"; Path = "supabase/migrations/20260728_00_authorization_hardening.sql" },
    @{ Number = "015"; Path = "supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql" },
    @{ Number = "016"; Path = "supabase/migrations/20260731_00_verification_disclosure_identity_hardening.sql" },
    @{ Number = "017"; Path = "supabase/migrations/20260803_00_payment_events_legacy_merchant_compatibility.sql" }
  )
}

function Get-PgTempFunctionDefinitions {
  param(
    [Parameter(Mandatory = $true)][string]$MigrationNumber,
    [Parameter(Mandatory = $true)][string]$RelativePath
  )

  $absolutePath = Join-Path $repoRoot $RelativePath
  $lines = Get-Content -LiteralPath $absolutePath
  $definitions = @()
  $insideBlockComment = $false
  $insideDollarQuote = $false

  for ($index = 0; $index -lt $lines.Count; $index++) {
    $line = $lines[$index]
    $scanLine = $line

    if ($insideBlockComment) {
      if ($scanLine -match '\*/') {
        $insideBlockComment = $false
        $scanLine = $scanLine.Substring($scanLine.IndexOf('*/') + 2)
      } else {
        continue
      }
    }

    while ($scanLine -match '/\*') {
      $beforeComment = $scanLine.Substring(0, $scanLine.IndexOf('/*'))
      $afterStart = $scanLine.Substring($scanLine.IndexOf('/*') + 2)
      if ($afterStart -match '\*/') {
        $scanLine = $beforeComment + $afterStart.Substring($afterStart.IndexOf('*/') + 2)
      } else {
        $scanLine = $beforeComment
        $insideBlockComment = $true
        break
      }
    }

    $lineWithoutInlineComment = ($scanLine -replace '--.*$', '')
    if ($lineWithoutInlineComment -match '\$\$') {
      $insideDollarQuote = -not $insideDollarQuote
      continue
    }

    if ($insideDollarQuote) {
      continue
    }

    if ($lineWithoutInlineComment -notmatch '^\s*CREATE( OR REPLACE)? FUNCTION pg_temp\.([A-Za-z0-9_]+)\s*\(') {
      continue
    }

    $createMode = if ($matches[1]) { "CREATE OR REPLACE" } else { "CREATE" }
    $functionName = $matches[2]
    $headerLines = @($lines[$index].Trim())
    $cursor = $index + 1
    while ($cursor -lt $lines.Count -and $lines[$cursor] -notmatch '^\s*LANGUAGE\s+') {
      $headerLines += $lines[$cursor].Trim()
      if ($lines[$cursor] -match '^\s*RETURNS\s+') {
        break
      }
      $cursor += 1
    }

    $header = ($headerLines -join ' ')
    $argsText = [regex]::Match($header, 'FUNCTION\s+pg_temp\.[A-Za-z0-9_]+\s*\((.*)\)\s+RETURNS', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase).Groups[1].Value
    $returnType = [regex]::Match($header, '\)\s+RETURNS\s+(.+)$', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase).Groups[1].Value.Trim()
    $argNames = @()
    $argTypes = @()
    $defaults = @()

    if (-not [string]::IsNullOrWhiteSpace($argsText)) {
      foreach ($rawArg in ($argsText -split ',')) {
        $arg = $rawArg.Trim()
        if ([string]::IsNullOrWhiteSpace($arg)) {
          continue
        }

        $parts = [regex]::Split($arg, '\s+DEFAULT\s+', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        $nameAndType = $parts[0].Trim()
        $firstSpace = $nameAndType.IndexOf(' ')
        Assert-HarnessSelfTest -Condition ($firstSpace -gt 0) -Message "Unable to parse pg_temp argument in $RelativePath line $($index + 1): $arg"

        $argNames += $nameAndType.Substring(0, $firstSpace).Trim()
        $argTypes += $nameAndType.Substring($firstSpace + 1).Trim().ToLowerInvariant()
        if ($parts.Count -gt 1) {
          $defaults += (($parts[1..($parts.Count - 1)] -join " DEFAULT ").Trim())
        }
      }
    }

    $definitions += [pscustomobject]@{
      Migration = $MigrationNumber
      Path = $RelativePath
      Line = $index + 1
      Name = $functionName
      Identity = ("{0}({1})" -f $functionName, ($argTypes -join ","))
      ArgumentNames = ($argNames -join ",")
      Defaults = ($defaults -join ",")
      ReturnType = $returnType.ToLowerInvariant()
      CreateMode = $createMode
    }
  }

  return $definitions
}

function Assert-RollbackRunnerPgTempHelpersAreIsolated {
  $definitions = @()
  foreach ($migration in Get-RollbackRunnerMigrationPaths) {
    $definitions += Get-PgTempFunctionDefinitions -MigrationNumber $migration.Number -RelativePath $migration.Path
  }

  $grouped = @($definitions | Group-Object -Property Identity | Where-Object { $_.Count -gt 1 })
  Assert-HarnessSelfTest -Condition ($grouped.Count -eq 0) -Message "ordered rollback migrations redefine pg_temp helper identities in one session: $(($grouped | ForEach-Object { $_.Name }) -join '; ')"

  $migrationSpecificDefinitions = $definitions | Where-Object { $_.Migration -in @("010", "011", "012") }
  foreach ($definition in $migrationSpecificDefinitions) {
    Assert-HarnessSelfTest -Condition ($definition.Name.EndsWith("_m$($definition.Migration)")) -Message "Migration $($definition.Migration) pg_temp helper $($definition.Name) is not migration-specific."
  }

  $m009FunctionHelper = @($definitions | Where-Object {
    $_.Migration -eq "009" -and $_.Name -eq "assert_public_function_exists"
  })
  $m010FunctionHelper = @($definitions | Where-Object {
    $_.Migration -eq "010" -and $_.Name -eq "assert_public_function_exists_m010"
  })
  Assert-HarnessSelfTest -Condition ($m009FunctionHelper.Count -eq 1) -Message "Migration 009 public-function assertion helper was not found."
  Assert-HarnessSelfTest -Condition ($m010FunctionHelper.Count -eq 1) -Message "Migration 010 public-function assertion helper was not isolated."
  Assert-HarnessSelfTest -Condition ($m009FunctionHelper.Identity -ne $m010FunctionHelper.Identity) -Message "Migration 009 and 010 public-function helpers still share one pg_temp identity."
}

function Run-HarnessSelfTests {
  $tempDir = Join-Path $env:TEMP ("deraledger-harness-selftest-" + [System.Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
  $oldPsqlPath = $PsqlPath
  $oldTimeout = $PsqlTimeoutSeconds
  $oldTestDatabaseUrl = $TestDatabaseUrl
  $libpqNames = @("PGSSLMODE", "PGHOST", "PGPORT", "PGUSER", "PGDATABASE", "PGPASSWORD", "PGCONNECT_TIMEOUT", "PGSERVICE", "PGSERVICEFILE")
  $outerSnapshot = Get-LibpqEnvironmentSnapshot -VariableNames $libpqNames

  try {
    Assert-InvoiceFkOfflineClassificationMatrix
    $phase2SqlTest = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql")
    Assert-InvoiceFkReferencePredicatesOutsideHaving -SourceName "phase2_breet_payment_substrate_reconciliation.sql" -SourceText $phase2SqlTest -CountVariableName "v_invoice_fk_count"

    $harnessSource = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "scripts/test-breet-solo-plus-migrations.ps1")
    $invoiceFkFunctionMatch = [regex]::Match($harnessSource, "(?m)^function Assert-PaymentEventsInvoiceForeignKey\b")
    $invoiceFkFunctionStart = if ($invoiceFkFunctionMatch.Success) { $invoiceFkFunctionMatch.Index } else { -1 }
    $invoiceFkFunctionEndMatch = if ($invoiceFkFunctionStart -ge 0) {
      [regex]::Match($harnessSource.Substring($invoiceFkFunctionStart), "(?m)^function Set-PaymentEventsInvoiceForeignKeyFixture\b")
    } else {
      [regex]::Match("", "a^")
    }
    $invoiceFkFunctionEnd = if ($invoiceFkFunctionEndMatch.Success) { $invoiceFkFunctionStart + $invoiceFkFunctionEndMatch.Index } else { -1 }
    Assert-HarnessSelfTest -Condition ($invoiceFkFunctionStart -ge 0 -and $invoiceFkFunctionEnd -gt $invoiceFkFunctionStart) -Message "Assert-PaymentEventsInvoiceForeignKey source block was not found."
    $invoiceFkFunctionSource = $harnessSource.Substring($invoiceFkFunctionStart, $invoiceFkFunctionEnd - $invoiceFkFunctionStart)
    Assert-InvoiceFkReferencePredicatesOutsideHaving -SourceName "Assert-PaymentEventsInvoiceForeignKey" -SourceText $invoiceFkFunctionSource -CountVariableName "v_fk_count"

    $migration009 = Get-Content -Raw -Path (Join-Path $repoRoot "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql")
    foreach ($needle in @(
      "get_payment_events_invoice_fk_compatible_delete_action",
      "assert_payment_events_invoice_fk_legacy_compatible",
      "normalize_payment_events_invoice_fk",
      "DROP CONSTRAINT payment_events_invoice_id_fkey",
      "ADD CONSTRAINT payment_events_invoice_id_fkey",
      "FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL",
      "v_delete_action_actual = 'NO ACTION'",
      "v_delete_action_actual NOT IN ('SET NULL', 'NO ACTION')",
      "con.contype::text = 'f'",
      "array_agg(src.attname::text ORDER BY src_ord.ordinality)",
      "array_agg(ref.attname::text ORDER BY ref_ord.ordinality)"
    )) {
      Assert-HarnessSelfTest -Condition ($migration009.Contains($needle)) -Message "Migration 009 invoice FK compatibility guard missing: $needle"
    }
    Assert-HarnessSelfTest -Condition ($migration009 -notmatch "payment_events_invoice_id_fkey[\s\S]{0,200}ON DELETE RESTRICT") -Message "Migration 009 should not whitelist RESTRICT for payment_events.invoice_id."
    Assert-RollbackRunnerPgTempHelpersAreIsolated

    $rehearsalGenerator = Join-Path $repoRoot "scripts/new-production-rehearsal-package.ps1"
    $rehearsalHelper = Join-Path $repoRoot "scripts/production-rehearsal-validation.ps1"
    Assert-HarnessSelfTest -Condition (Test-Path -LiteralPath $rehearsalGenerator) -Message "production rehearsal package generator is missing."
    Assert-HarnessSelfTest -Condition (Test-Path -LiteralPath $rehearsalHelper) -Message "production rehearsal canonical helper is missing."
    Assert-ProductionRehearsalArchitectureAst -HelperPath $rehearsalHelper -GeneratorPath $rehearsalGenerator
    foreach($mutation in @(
      @{Id='DUPLICATE-ID';Mutator={param($helper,$generator)$text=Get-Content -Raw $helper;$text=$text.Replace("'RV.PROCESS.NONZERO_EXIT'","'RV.PROCESS.TIMEOUT'");[IO.File]::WriteAllText($helper,$text,[Text.UTF8Encoding]::new($false))}},
      @{Id='DYNAMIC-ID';Mutator={param($helper,$generator)$text=Get-Content -Raw $helper;$text=$text.Replace("'RV.PROCESS.NONZERO_EXIT'",'$script:DynamicGuardId');[IO.File]::WriteAllText($helper,$text,[Text.UTF8Encoding]::new($false))}},
      @{Id='COMPOUND-CONDITION';Mutator={param($helper,$generator)$text=Get-Content -Raw $helper;$text=$text.Replace('($Result.ExitCode -eq 0) "PROCESS_NONZERO_EXIT:', '(($Result.ExitCode -eq 0) -and $true) "PROCESS_NONZERO_EXIT:');[IO.File]::WriteAllText($helper,$text,[Text.UTF8Encoding]::new($false))}},
      @{Id='DIRECT-THROW';Mutator={param($helper,$generator)$text=Get-Content -Raw $helper;$old='Assert-Condition ($Result.ExitCode -eq 0) "PROCESS_NONZERO_EXIT:${Operation}:$($Result.ExitCode)" ''RV.PROCESS.NONZERO_EXIT'' ''PROCESS_NONZERO_EXIT''';$text=$text.Replace($old,'if ($Result.ExitCode -ne 0) { throw "PROCESS_NONZERO_EXIT" }');[IO.File]::WriteAllText($helper,$text,[Text.UTF8Encoding]::new($false))}}
    )){
      Assert-RehearsalGuardAstMutationRejected -HelperPath $rehearsalHelper -GeneratorPath $rehearsalGenerator -TemporaryRoot $tempDir -MutationId $mutation.Id -Mutator $mutation.Mutator
    }
    Assert-ProductionRehearsalArchitectureAst -HelperPath $rehearsalHelper -GeneratorPath $rehearsalGenerator
    $helperTokens = $null
    $helperErrors = $null
    $helperAst = [System.Management.Automation.Language.Parser]::ParseFile($rehearsalHelper, [ref]$helperTokens, [ref]$helperErrors)
    $expectedRuntimeFunctions = @("Assert-Condition","Sha256","Join-NativeArguments","Get-WrapperBodyHash","Get-DescriptorWrapperBodyHash","Invoke-ProcessStart","Invoke-GitText","Get-EnvironmentSnapshot","Restore-Environment","Clear-PostgresRoutingEnvironment","ConvertTo-BooleanStrict","ConvertTo-IntegerStrict","Get-ControlRequiredKeys","Convert-ControlRow","Assert-ControlAccepted","New-ControlSql","Parse-Manifest","Get-ExecutableRunnerLines","Assert-RunnerContract","Assert-ArtifactIntegrity","Assert-GitState","Parse-TargetDatabaseUrl","Assert-PasswordFreeDatabaseUrl","ConvertTo-SqlLiteral","New-TemporaryPgPassFile","Invoke-NativeChecked","Assert-RunnerMarkers","Invoke-OfflineValidation","Invoke-Rehearsal","New-RehearsalRuntimeContext","New-ProductionRehearsalRuntimeContext","Get-ProductionArtifactDescriptor","Invoke-RehearsalProcess","Assert-RehearsalProcessResult","Invoke-RehearsalLifecycle","Assert-ControlProofEqual")
    $helperFunctions = @($helperAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object { $_.Name })
    foreach ($functionName in $expectedRuntimeFunctions) { Assert-HarnessSelfTest -Condition (@($helperFunctions | Where-Object { $_ -eq $functionName }).Count -eq 1) -Message "canonical runtime function cardinality invalid: $functionName" }
    $generatorSource = Get-Content -Raw -LiteralPath $rehearsalGenerator
    $helperSource = Get-Content -Raw -LiteralPath $rehearsalHelper
    foreach ($boundary in @("ArtifactProvider","GitStateProvider","CredentialProvider","ExecutableResolver","ProcessAdapter","FileSystemAdapter","PackageGenerationBoundary","SqlExecutionBoundary")) {
      Assert-HarnessSelfTest -Condition ($helperSource.Contains($boundary) -and $generatorSource.Contains($boundary)) -Message "injectable rehearsal boundary is missing from production or offline architecture: $boundary"
    }
    Assert-HarnessSelfTest -Condition ($helperSource -match "function Assert-GitState[\s\S]+GitStateProvider" -and $helperSource -match "function Invoke-OfflineValidation[\s\S]+Assert-ArtifactIntegrity \`$Context" -and $helperSource -match "function Invoke-Rehearsal[\s\S]+Assert-ControlProofEqual") -Message "production and offline paths do not share canonical acceptance functions."
    Assert-HarnessSelfTest -Condition ($generatorSource -match "Replace-SinglePlaceholder[\s\S]+__SHARED_VALIDATION_HELPERS__") -Message "generator lacks fail-closed helper placeholder replacement."
    Assert-HarnessSelfTest -Condition ($generatorSource -match "CANONICAL_HELPER_SHA256" -and $generatorSource -match "EMBEDDED_HELPER_SHA256" -and $generatorSource -match "ARTIFACT_HELPER_BODY_HASH_MISMATCH") -Message "generator lacks canonical helper integrity contract."
    $generatorOffline = Invoke-CapturedProcess -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $rehearsalGenerator, "-OfflineValidateOnly") -WorkingDirectory $repoRoot -TimeoutSeconds 60
    $offlineBoundaryLine=@(($generatorOffline.Stdout -split "`r`n|`n")|Where-Object {$_ -like 'OFFLINE_BOUNDARIES|*'})
    Assert-HarnessSelfTest -Condition ($offlineBoundaryLine.Count -eq 1) -Message "offline boundary evidence cardinality invalid."
    $offlineBoundaryProof=if($offlineBoundaryLine.Count -eq 1){$offlineBoundaryLine[0].Substring(19)|ConvertFrom-Json}else{$null}
    Assert-HarnessSelfTest -Condition ($generatorOffline.ExitCode -eq 0 -and $generatorOffline.Stdout -match "Generator OfflineValidateOnly: PASS" -and $null -ne $offlineBoundaryProof -and $offlineBoundaryProof.CredentialProvider -eq 0 -and $offlineBoundaryProof.PsqlResolver -eq 0 -and $offlineBoundaryProof.PgDumpResolver -eq 0 -and $offlineBoundaryProof.ProcessAdapter -eq 0 -and $offlineBoundaryProof.PackageGenerationBoundary -eq 0 -and $offlineBoundaryProof.SqlExecutionBoundary -eq 0) -Message "production rehearsal generator offline validation failed or crossed a forbidden boundary: $($generatorOffline.Stderr) $($generatorOffline.Stdout)"
    $generatorMutations = Invoke-CapturedProcess -FilePath "powershell.exe" -Arguments @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $rehearsalGenerator, "-RunOfflineMutationTests") -WorkingDirectory $repoRoot -TimeoutSeconds 120
    $declaredMatch = [regex]::Match($generatorMutations.Stdout, "Mutation cases declared: (\d+)")
    $executedMatch = [regex]::Match($generatorMutations.Stdout, "Mutation cases executed: (\d+)")
    Assert-HarnessSelfTest -Condition ($generatorMutations.ExitCode -eq 0 -and $declaredMatch.Success -and $executedMatch.Success -and $declaredMatch.Groups[1].Value -eq $executedMatch.Groups[1].Value -and [int]$declaredMatch.Groups[1].Value -gt 0 -and $generatorMutations.Stdout -match "Production rehearsal generator offline mutation tests passed") -Message "production rehearsal generator mutation tests failed: $($generatorMutations.Stderr) $($generatorMutations.Stdout)"
    $caseRows = @(($generatorMutations.Stdout -split "`r`n|`n") | Where-Object { $_ -like "CASE|*" } | ForEach-Object { $_.Substring(5) | ConvertFrom-Json })
    $architectureSummaryRows=@(($generatorMutations.Stdout -split "`r`n|`n")|Where-Object {$_ -like 'ARCHITECTURE_SUMMARY|*'}|ForEach-Object {$_.Substring(21)|ConvertFrom-Json})
    Assert-HarnessSelfTest -Condition ($architectureSummaryRows.Count -eq 1 -and $caseRows.Count -eq $architectureSummaryRows[0].declared -and $architectureSummaryRows[0].declared -eq $architectureSummaryRows[0].executed -and $caseRows.Count -gt 0) -Message "structured architecture evidence count mismatch."
    Assert-HarnessSelfTest -Condition (@($caseRows|Group-Object case_id|Where-Object Count -ne 1).Count -eq 0) -Message "structured architecture case cardinality invalid."
    foreach ($case in $caseRows) {
      Assert-HarnessSelfTest -Condition ($case.setup_executed -and -not [string]::IsNullOrWhiteSpace($case.production_function_invoked) -and $case.expected_outcome -eq $case.observed_outcome -and $case.expected_error_classification -eq $case.observed_error_classification -and $null -ne $case.boundary_invocation_counts -and -not [string]::IsNullOrWhiteSpace($case.cleanup_result)) -Message "structured architecture evidence is incomplete: $($case.case_id)"
    }
    foreach ($case in @($caseRows | Where-Object { $_.category -eq "offline-boundary" })) {
      Assert-HarnessSelfTest -Condition ($case.boundary_invocation_counts.CredentialProvider -eq 0 -and $case.boundary_invocation_counts.ExecutableResolver -eq 0 -and $case.boundary_invocation_counts.ProcessAdapter -eq 0 -and $case.boundary_invocation_counts.PackageGenerationBoundary -eq 0 -and $case.boundary_invocation_counts.SqlExecutionBoundary -eq 0) -Message "offline boundary invocation count is non-zero: $($case.case_id)"
    }
    foreach ($case in @($caseRows | Where-Object { $_.category -eq "process" })) {
      Assert-HarnessSelfTest -Condition ($case.boundary_invocation_counts.ProcessAdapter -eq 1 -and $case.boundary_invocation_counts.SqlExecutionBoundary -eq 1) -Message "process architecture case did not execute injected adapters: $($case.case_id)"
    }
    $parityRows=@(($generatorMutations.Stdout -split "`r`n|`n")|Where-Object {$_ -like 'PARITY|*'}|ForEach-Object {$_.Substring(7)|ConvertFrom-Json})
    Assert-HarnessSelfTest -Condition ($parityRows.Count -gt 0 -and @($parityRows|Group-Object function|Where-Object Count -ne 1).Count -eq 0 -and @($parityRows|Where-Object classification -eq 'unexplained').Count -eq 0) -Message "machine parity classification is incomplete, duplicated, or unexplained."
    foreach($parity in @($parityRows|Where-Object classification -in @('adapter-plumbing','guard-observation'))){Assert-HarnessSelfTest -Condition (@($parity.named_tests).Count -gt 0) -Message "behavioral parity row lacks named tests: $($parity.function)"}
    $pgpassRows=@(($generatorMutations.Stdout -split "`r`n|`n")|Where-Object {$_ -like 'PGPASS|*'}|ForEach-Object {$_.Substring(7)|ConvertFrom-Json})
    Assert-HarnessSelfTest -Condition ($pgpassRows.Count -gt 0 -and @($pgpassRows | Where-Object { -not $_.utf8_no_bom -or -not $_.exact_bytes -or -not $_.hostname_prefix -or $_.credential_in_evidence -or $_.cleanup -ne 'verified' }).Count -eq 0) -Message "pgpass byte or cleanup proof failed."
    $inventoryRows=@(($generatorMutations.Stdout -split "`r`n|`n")|Where-Object {$_ -like 'GUARD_INVENTORY|*'}|ForEach-Object {$_.Substring(16)|ConvertFrom-Json})
    $guardRows=@(($generatorMutations.Stdout -split "`r`n|`n")|Where-Object {$_ -like 'GUARD_CASE|*'}|ForEach-Object {$_.Substring(11)|ConvertFrom-Json})
    $guardSummaryRows=@(($generatorMutations.Stdout -split "`r`n|`n")|Where-Object {$_ -like 'GUARD_SUMMARY|*'}|ForEach-Object {$_.Substring(14)|ConvertFrom-Json})
    Assert-HarnessSelfTest -Condition ($inventoryRows.Count -gt 0 -and $guardRows.Count -eq $inventoryRows.Count -and $guardSummaryRows.Count -eq 1 -and $guardSummaryRows[0].unique_guards -eq $inventoryRows.Count -and $guardSummaryRows[0].observed_guards -eq $inventoryRows.Count -and $guardSummaryRows[0].missing -eq 0 -and $guardSummaryRows[0].unexpected -eq 0) -Message "exact guard-observation coverage is incomplete."
    Assert-HarnessSelfTest -Condition (@($inventoryRows|Group-Object guard_id|Where-Object Count -ne 1).Count -eq 0 -and @($guardRows|Group-Object observed_guard_id|Where-Object Count -ne 1).Count -eq 0) -Message "guard inventory or observation cardinality is invalid."
    $declaredGuardIds=@($inventoryRows|ForEach-Object guard_id|Sort-Object)
    $observedGuardIds=@($guardRows|ForEach-Object observed_guard_id|Sort-Object)
    Assert-HarnessSelfTest -Condition (@(Compare-Object $declaredGuardIds $observedGuardIds).Count -eq 0) -Message "declared and observed guard IDs differ."
    foreach($guard in $guardRows){
      $inventoryMatch=@($inventoryRows|Where-Object guard_id -eq $guard.observed_guard_id)
      Assert-HarnessSelfTest -Condition ($inventoryMatch.Count -eq 1 -and $guard.guard_id -eq $guard.observed_guard_id -and $guard.expected_classification -eq $guard.observed_classification -and $guard.observed_classification -eq $inventoryMatch[0].classification -and $guard.execution_count -eq 1 -and -not [string]::IsNullOrWhiteSpace($guard.production_function_invoked) -and $guard.cleanup -eq 'verified') -Message "guard execution evidence is incomplete: $($guard.guard_id)"
    }
    $wrapperInventory=@($inventoryRows|Where-Object source -notin @('production-rehearsal-validation.ps1','new-production-rehearsal-package.ps1'))
    Assert-HarnessSelfTest -Condition ($wrapperInventory.Count -eq 1 -and $wrapperInventory[0].guard_id -eq 'WRAPPER.MODE.COUNT') -Message "expanded wrapper guard inventory is missing or invalid."
    $staticGuardIds=@($script:HarnessStaticGuardRows|ForEach-Object guard_id|Sort-Object)
    $emittedStaticGuardIds=@($inventoryRows|Where-Object source -in @('production-rehearsal-validation.ps1','new-production-rehearsal-package.ps1')|ForEach-Object guard_id|Sort-Object)
    Assert-HarnessSelfTest -Condition (@(Compare-Object $staticGuardIds $emittedStaticGuardIds).Count -eq 0) -Message "independent AST guard inventory differs from emitted source inventory."

    $script:HarnessStepCounter = 0
    $script:HarnessProgressMessages.Clear()
    $script:TestDatabaseUrl = "postgresql://postgres@127.0.0.1/test_commit12_harness_selftest?sslmode=disable"
    Set-Item -Path "Env:PGPASSWORD" -Value "self-test-secret"

    $successPsql = New-FakeBatchCommand -Directory $tempDir -Name "fake-psql-success" -Content @"
@echo off
if "%PGPASSWORD%"=="" (
  echo missing-password 1>&2
  exit /b 9
)
echo has-password
echo %PGPASSWORD%
echo %PGPASSWORD% 1>&2
exit /b 0
"@
    $script:PsqlPath = $successPsql
    $result = Invoke-Psql -Arguments @("-X", "-w", "-d", $script:TestDatabaseUrl, "-c", "select 1") -Description "Self-test successful psql"
    Assert-HarnessSelfTest -Condition ($result.ExitCode -eq 0) -Message "successful fake psql should exit 0."
    Assert-HarnessSelfTest -Condition ($result.Stdout -match "has-password") -Message "fake psql child did not receive caller PGPASSWORD."
    Assert-HarnessSelfTest -Condition ($result.Stdout -notmatch "self-test-secret") -Message "PGPASSWORD leaked in stdout."
    Assert-HarnessSelfTest -Condition ($result.Stderr -notmatch "self-test-secret") -Message "PGPASSWORD leaked in stderr."
    Assert-HarnessSelfTest -Condition ($result.Command -notmatch "self-test-secret") -Message "PGPASSWORD leaked in command display."
    Assert-HarnessSelfTest -Condition ($script:HarnessProgressMessages[0] -match "^RUNNING SQL-012\.001 Self-test successful psql$") -Message "substep progress message was not recorded."

    $failurePsql = New-FakeBatchCommand -Directory $tempDir -Name "fake-psql-failure" -Content @"
@echo off
echo controlled failure 1>&2
exit /b 7
"@
    $script:PsqlPath = $failurePsql
    $threw = $false
    try {
      Invoke-Psql -Arguments @("-X", "-w", "-d", $script:TestDatabaseUrl, "-c", "select 1") -Description "Self-test failing psql" | Out-Null
    } catch {
      $threw = $_.Exception.Message -match "psql exited with code 7 during: Self-test failing psql"
    }
    Assert-HarnessSelfTest -Condition $threw -Message "failing fake psql did not produce a bounded failure."

    Remove-Item -Path "Env:PGPASSWORD" -ErrorAction SilentlyContinue
    $authPsql = New-FakeBatchCommand -Directory $tempDir -Name "fake-psql-auth" -Content @"
@echo off
if "%PGPASSWORD%"=="" (
  echo missing authentication 1>&2
  exit /b 2
)
exit /b 0
"@
    $script:PsqlPath = $authPsql
    $authTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $authFailed = $false
    try {
      Invoke-Psql -Arguments @("-X", "-w", "-d", $script:TestDatabaseUrl, "-c", "select 1") -Description "Self-test missing auth" | Out-Null
    } catch {
      $authFailed = $_.Exception.Message -match "psql exited with code 2 during: Self-test missing auth"
    } finally {
      $authTimer.Stop()
    }
    Assert-HarnessSelfTest -Condition $authFailed -Message "missing authentication should fail without prompting."
    Assert-HarnessSelfTest -Condition ($authTimer.Elapsed.TotalSeconds -lt 5) -Message "missing authentication did not fail quickly."

    Set-Item -Path "Env:PGPASSWORD" -Value "self-test-secret"
    $script:PsqlTimeoutSeconds = 1
    $hungPsql = New-FakeBatchCommand -Directory $tempDir -Name "fake-psql-hung" -Content @"
@echo off
ping -n 6 127.0.0.1 >nul
exit /b 0
"@
    $script:PsqlPath = $hungPsql
    $timedOut = $false
    try {
      Invoke-Psql -Arguments @("-X", "-w", "-d", $script:TestDatabaseUrl, "-c", "select 1") -Description "Self-test hung psql" | Out-Null
    } catch {
      $timedOut = $_.Exception.Message -match "psql timed out after 1 seconds during: Self-test hung psql"
    }
    Assert-HarnessSelfTest -Condition $timedOut -Message "hung fake psql was not terminated after the configured timeout."

    $marker = Join-Path $tempDir "descendant-marker.txt"
    $spawner = Join-Path $tempDir "spawn-descendant.ps1"
    Set-Content -Path $spawner -Encoding UTF8 -Value @"
`$markerPath = '$($marker -replace "'", "''")'
Start-Process powershell.exe -ArgumentList @('-NoProfile', '-Command', "Start-Sleep -Seconds 4; Set-Content -LiteralPath '`$markerPath' -Value child-ran")
Start-Sleep -Seconds 10
"@
    Invoke-CapturedProcess -FilePath "powershell.exe" -Arguments @("-NoProfile", "-File", $spawner) -WorkingDirectory $tempDir -TimeoutSeconds 1 | Out-Null
    Start-Sleep -Seconds 5
    Assert-HarnessSelfTest -Condition (-not (Test-Path $marker)) -Message "descendant process tree was not terminated before child side effect."

    $nested = Invoke-CapturedProcess -FilePath "powershell.exe" -Arguments @("-NoProfile", "-Command", "Start-Sleep -Seconds 5") -WorkingDirectory $tempDir -TimeoutSeconds 1
    Assert-HarnessSelfTest -Condition $nested.TimedOut -Message "hung nested PowerShell process did not time out."

    $script:PsqlPath = $successPsql
    $script:PsqlTimeoutSeconds = 5
    $beforeTemp = @(Get-ChildItem -Path $env:TEMP -Filter "migration-harness-*.sql" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    Invoke-PsqlSql -Sql "select 1;" -Description "Self-test temp SQL cleanup"
    $afterTemp = @(Get-ChildItem -Path $env:TEMP -Filter "migration-harness-*.sql" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
    $newTempFiles = @($afterTemp | Where-Object { $_ -notin $beforeTemp })
    Assert-HarnessSelfTest -Condition ($newTempFiles.Count -eq 0) -Message "temporary SQL files were not cleaned up."

    Assert-SafeDisposableDatabase -ConnectionString "postgresql://postgres@127.0.0.1/test_commit12_harness_selftest?sslmode=disable"
    $remoteRejected = $false
    try {
      Assert-SafeDisposableDatabase -ConnectionString "postgresql://postgres@db.example.com/test_commit12_harness_selftest?sslmode=disable"
    } catch {
      $remoteRejected = $_.Exception.Message -match "non-local database host"
    }
    Assert-HarnessSelfTest -Condition $remoteRejected -Message "remote disposable-looking URL should be rejected."

    Set-Item -Path "Env:PGHOST" -Value "staging.example.invalid"
    Set-Item -Path "Env:PGPORT" -Value "6543"
    Set-Item -Path "Env:PGUSER" -Value "staging_user"
    Set-Item -Path "Env:PGDATABASE" -Value "staging"
    Set-Item -Path "Env:PGPASSWORD" -Value "restore-secret"
    Set-Item -Path "Env:PGCONNECT_TIMEOUT" -Value "77"
    Set-Item -Path "Env:PGSERVICE" -Value "staging"
    Set-Item -Path "Env:PGSERVICEFILE" -Value "staging-service-file"
    $successSnapshot = Get-LibpqEnvironmentSnapshot -VariableNames $libpqNames
    Invoke-WithLocalDisposableDatabaseEnvironment {
      Assert-HarnessSelfTest -Condition (-not (Get-Item -Path "Env:PGHOST" -ErrorAction SilentlyContinue)) -Message "PGHOST should be isolated inside child environment."
      Assert-HarnessSelfTest -Condition ($env:PGPASSWORD -eq "restore-secret") -Message "PGPASSWORD should be preserved inside child environment."
      Assert-HarnessSelfTest -Condition ($env:PGCONNECT_TIMEOUT -eq "10") -Message "PGCONNECT_TIMEOUT should be bounded inside child environment."
    } | Out-Null
    Assert-LibpqEnvironmentRestored -Snapshot $successSnapshot

    $failureSnapshot = Get-LibpqEnvironmentSnapshot -VariableNames $libpqNames
    try {
      Invoke-WithLocalDisposableDatabaseEnvironment { throw "expected failure" } | Out-Null
    } catch {
    }
    Assert-LibpqEnvironmentRestored -Snapshot $failureSnapshot

    Write-Host "Harness self-tests passed"
  }
  finally {
    $script:PsqlPath = $oldPsqlPath
    $script:PsqlTimeoutSeconds = $oldTimeout
    $script:TestDatabaseUrl = $oldTestDatabaseUrl
    Restore-LibpqEnvironment -Snapshot $outerSnapshot
    Remove-Item -Path "Env:HARNESS_MARKER" -ErrorAction SilentlyContinue
    if (Test-Path $tempDir) {
      Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-Psql {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Description,
    [switch]$ExpectFailure
  )

  $script:HarnessStepCounter += 1
  $progressMessage = "RUNNING SQL-012.{0:D3} {1}" -f $script:HarnessStepCounter, $Description
  $script:HarnessProgressMessages.Add($progressMessage) | Out-Null
  Write-Host $progressMessage

  $result = Invoke-WithLocalDisposableDatabaseEnvironment {
    Invoke-CapturedProcess -FilePath $PsqlPath -Arguments $Arguments -WorkingDirectory $repoRoot -TimeoutSeconds $PsqlTimeoutSeconds
  }

  if ($result.TimedOut) {
    throw "psql timed out after $PsqlTimeoutSeconds seconds during: $Description. The psql child process tree was terminated.`n$($result.Stderr)`n$($result.Stdout)"
  }

  if ($ExpectFailure) {
    if ($result.ExitCode -eq 0) {
      throw "Expected failure but command succeeded: $Description"
    }
    return
  }

  if ($result.ExitCode -ne 0) {
    throw "psql exited with code $($result.ExitCode) during: $Description`n$($result.Stderr)`n$($result.Stdout)"
  }

  return $result
}

function Invoke-PsqlSql {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [Parameter(Mandatory = $true)][string]$Description,
    [switch]$ExpectFailure
  )

  $tempFile = Join-Path $env:TEMP ("migration-harness-" + [System.Guid]::NewGuid().ToString("N") + ".sql")
  try {
    Set-Content -Path $tempFile -Value $Sql -Encoding UTF8
    Invoke-Psql -Arguments @("-X", "-w", "-v", "ON_ERROR_STOP=1", "-d", $TestDatabaseUrl, "-f", $tempFile) -Description $Description -ExpectFailure:$ExpectFailure | Out-Null
  }
  finally {
    if (Test-Path $tempFile) {
      Remove-Item -LiteralPath $tempFile -Force
    }
  }
}

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Description,
    [switch]$ExpectFailure
  )

  $fullPath = Join-Path $repoRoot $RelativePath
  if (-not (Test-Path $fullPath)) {
    throw "Missing SQL file: $fullPath"
  }

  Invoke-Psql -Arguments @("-X", "-w", "-v", "ON_ERROR_STOP=1", "-d", $TestDatabaseUrl, "-f", $fullPath) -Description $Description -ExpectFailure:$ExpectFailure | Out-Null
}

function Invoke-PsqlFileAsRole {
  param(
    [Parameter(Mandatory = $true)][string]$RoleName,
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Description,
    [switch]$ExpectFailure
  )

  $fullPath = Join-Path $repoRoot $RelativePath
  if (-not (Test-Path $fullPath)) {
    throw "Missing SQL file: $fullPath"
  }

  $normalizedPath = ($fullPath -replace "\\", "/").Replace("'", "''")
  $sql = @"
SET ROLE $RoleName;
\ir '$normalizedPath'
RESET ROLE;
"@

  Invoke-PsqlSql -Sql $sql -Description $Description -ExpectFailure:$ExpectFailure
}

function Reset-DisposableDatabase {
  $sql = @"
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
AS `$`$ SELECT NULL::uuid `$`$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS `$`$ SELECT 'authenticated'::text `$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Reset disposable database"
}

function Initialize-CoreFixture {
  param(
    [switch]$IncludePaymentEventsPrerequisite,
    [switch]$IncludeCanonicalPaymentRecordsSecurityPrerequisite
  )

  $fixtureFiles = @(
    "supabase/staging/001_schema_only.sql",
    "supabase/staging/002_onboarding_verification_upgrade_flow.sql",
    "supabase/staging/003_rls_policies.sql",
    "supabase/staging/004_phase1_plan_compatibility.sql",
    "supabase/staging/006_solo_plus_prerequisites.sql",
    "supabase/staging/007_solo_plus_case_foundation.sql",
    "supabase/staging/008_solo_plus_transactional_repository_rpcs.sql"
  )

  foreach ($file in $fixtureFiles) {
    Invoke-PsqlFile -RelativePath $file -Description "Load fixture $file"
  }

  Initialize-HostileBrowserDefaultTableGrants

  if ($IncludeCanonicalPaymentRecordsSecurityPrerequisite) {
    Initialize-PaymentRecordsCanonicalSecurityPrerequisite
  }
  else {
    Initialize-PaymentRecordsStagingDriftFixture
  }

  if ($IncludePaymentEventsPrerequisite) {
    Initialize-PaymentEventsPrerequisite
  }
}

function Initialize-HostileBrowserDefaultTableGrants {
  $sql = @"
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
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed hostile Supabase-style default browser table/function grants"
}

function Initialize-PaymentRecordsCanonicalSecurityPrerequisite {
  $sql = @"
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_records FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_records FROM anon;
REVOKE ALL ON TABLE public.payment_records FROM authenticated;
GRANT SELECT ON TABLE public.payment_records TO authenticated;

CREATE POLICY merchant_read_payment_records
  ON public.payment_records
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants m
        WHERE m.id = public.payment_records.merchant_id
          AND m.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.payment_records.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )
    )
  );
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed canonical payment_records security prerequisite"
}

function Initialize-PaymentRecordsStagingDriftFixture {
  $sql = @"
ALTER TABLE public.payment_records DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_read_payment_records ON public.payment_records;

REVOKE ALL ON TABLE public.payment_records FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_records FROM anon;
REVOKE ALL ON TABLE public.payment_records FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payment_records TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payment_records TO authenticated;
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed staging-like payment_records security drift"
}

function Initialize-PaymentEventsPrerequisite {
  $sql = @"
CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID,
  invoice_id UUID,
  transaction_id UUID,
  event_type TEXT NOT NULL,
  processor TEXT NOT NULL,
  processor_ref TEXT,
  amount_kobo BIGINT,
  raw_payload JSONB,
  processed_at TIMESTAMPTZ NULL,
  idempotency_key TEXT,
  payment_method TEXT,
  payment_purpose TEXT,
  payment_reference TEXT,
  provider_reference TEXT,
  expected_amount NUMERIC(18,2),
  paid_amount NUMERIC(18,2),
  currency TEXT NOT NULL DEFAULT 'NGN',
  fee NUMERIC(18,2),
  plan_id TEXT,
  subscription_id UUID,
  business_id UUID,
  customer_email TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received',
  failure_reason TEXT,
  settlement_destination_source TEXT,
  reconciliation_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE,
  CONSTRAINT payment_events_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_events_created_at
  ON public.payment_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_reference
  ON public.payment_events(payment_reference, provider_reference, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_processor_ref
  ON public.payment_events(processor, processor_ref);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_idempotency
  ON public.payment_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.payment_events DISABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_payment_events_updated_at ON public.payment_events;
CREATE TRIGGER trg_payment_events_updated_at
BEFORE UPDATE ON public.payment_events
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO `$`$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_events'
  ) THEN
    RAISE EXCEPTION 'payment_events prerequisite should not create RLS policies';
  END IF;
END
`$`$;

INSERT INTO public.merchants (id, business_name, email, subscription_plan, merchant_tier)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'Harness Merchant',
  'harness-merchant@example.test',
  'starter',
  'starter'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.clients (id, merchant_id, full_name, email)
VALUES (
  '10000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000001',
  'Harness Client',
  'harness-client@example.test'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.invoices (id, merchant_id, client_id, invoice_number, status, grand_total)
VALUES (
  '10000000-0000-4000-8000-000000000021',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000011',
  'HARNESS-INV-001',
  'open',
  1000
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payment_events (
  id,
  merchant_id,
  invoice_id,
  event_type,
  processor,
  processor_ref,
  raw_payload,
  processed_at,
  idempotency_key,
  payment_purpose
)
VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    NULL,
    NULL,
    'historical.ownerless',
    'paystack',
    'legacy-ownerless-ref',
    '{"fixture":"historical_ownerless"}'::jsonb,
    NULL,
    'harness:payment-events:historical-ownerless',
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000021',
    'merchant.owned',
    'paystack',
    'merchant-owned-ref',
    '{"fixture":"merchant_owned"}'::jsonb,
    '2026-06-06T00:01:00Z',
    'harness:payment-events:merchant-owned',
    'invoice_payment'
  )
ON CONFLICT (id) DO NOTHING;
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed canonical payment_events prerequisite"
}

function Invoke-Commit12PrerequisiteChain {
  param([Parameter(Mandatory = $true)][string]$Scenario)

  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare Migration A substrate before $Scenario"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Prepare Migration B payment lifecycle substrate before $Scenario"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate before $Scenario"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Prepare Commit 10 substrate before $Scenario"
}

function Invoke-Commit13PrerequisiteChain {
  param([Parameter(Mandatory = $true)][string]$Scenario)

  Invoke-Commit12PrerequisiteChain -Scenario $Scenario
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260718_01_solo_plus_payment_recovery.sql" -Description "Prepare Commit 12 substrate before $Scenario"
}

function Invoke-Commit13AuthorizationChain {
  param([Parameter(Mandatory = $true)][string]$Scenario)

  Invoke-Commit13PrerequisiteChain -Scenario $Scenario
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260728_00_authorization_hardening.sql" -Description "Prepare Commit 13 authorization hardening before $Scenario"
}

function Initialize-SoloPlusReviewSecurityDriftFixture {
  $sql = @"
ALTER TABLE public.solo_plus_cases DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_requirements DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_events DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.solo_plus_cases FROM PUBLIC;
REVOKE ALL ON TABLE public.solo_plus_cases FROM anon;
REVOKE ALL ON TABLE public.solo_plus_cases FROM authenticated;
REVOKE ALL ON TABLE public.solo_plus_case_requirements FROM PUBLIC;
REVOKE ALL ON TABLE public.solo_plus_case_requirements FROM anon;
REVOKE ALL ON TABLE public.solo_plus_case_requirements FROM authenticated;
REVOKE ALL ON TABLE public.solo_plus_case_events FROM PUBLIC;
REVOKE ALL ON TABLE public.solo_plus_case_events FROM anon;
REVOKE ALL ON TABLE public.solo_plus_case_events FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_cases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_cases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_case_requirements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_case_requirements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_case_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_case_events TO authenticated;
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed staging-like Solo Plus review table security drift"
}

function Initialize-VerificationDisclosureBrowserWriteDriftFixture {
  $sql = @"
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_disclosures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read merchants" ON public.merchants;
DROP POLICY IF EXISTS "Allow public update merchants" ON public.merchants;
CREATE POLICY "Allow public read merchants"
  ON public.merchants FOR SELECT USING (true);
CREATE POLICY "Allow public update merchants"
  ON public.merchants FOR UPDATE USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.merchants FROM PUBLIC;
REVOKE ALL ON TABLE public.merchants FROM anon;
REVOKE ALL ON TABLE public.merchants FROM authenticated;
REVOKE ALL ON TABLE public.verification_disclosures FROM PUBLIC;
REVOKE ALL ON TABLE public.verification_disclosures FROM anon;
REVOKE ALL ON TABLE public.verification_disclosures FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.merchants TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.merchants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.verification_disclosures TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.verification_disclosures TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed staging-like verification disclosure browser write drift"
}

function Initialize-HostedSupabaseManagedDefaultAclFixture {
  $sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commit13_migration_owner') THEN
    CREATE ROLE commit13_migration_owner NOLOGIN;
  END IF;
END
`$`$;

REVOKE supabase_admin FROM commit13_migration_owner;

GRANT USAGE ON SCHEMA auth TO commit13_migration_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO commit13_migration_owner;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE commit13_migration_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE commit13_migration_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;

ALTER SCHEMA public OWNER TO commit13_migration_owner;
ALTER TABLE public.merchants OWNER TO commit13_migration_owner;
ALTER TABLE public.merchant_team OWNER TO commit13_migration_owner;
ALTER TABLE public.verification_disclosures OWNER TO commit13_migration_owner;
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed hosted Supabase managed-role default ACL fixture"
}

function Assert-SupabaseAdminDefaultAclFixturePreserved {
  $sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
    LEFT JOIN LATERAL aclexplode(d.defaclacl) acl ON true
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND owner_role.rolname = 'supabase_admin'
      AND COALESCE(grantee_role.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
      AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'expected managed supabase_admin default ACL fixture to remain visible as WARN';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
    JOIN pg_roles owner_role ON owner_role.oid = d.defaclrole
    LEFT JOIN LATERAL aclexplode(d.defaclacl) acl ON true
    LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND owner_role.rolname = 'commit13_migration_owner'
      AND COALESCE(grantee_role.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated')
      AND acl.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'commit13_migration_owner unsafe default ACLs should have been hardened';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Assert managed supabase_admin default ACL warning fixture"
}

function Assert-RelationAbsent {
  param(
    [Parameter(Mandatory = $true)][string]$QualifiedName
  )

  $sql = @"
DO `$`$
BEGIN
  IF to_regclass('$QualifiedName') IS NOT NULL THEN
    RAISE EXCEPTION 'expected % to remain absent after failed migration', '$QualifiedName';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Assert relation absent: $QualifiedName"
}

function Assert-ColumnAbsent {
  param(
    [Parameter(Mandatory = $true)][string]$TableName,
    [Parameter(Mandatory = $true)][string]$ColumnName
  )

  $sql = @"
DO `$`$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = '$TableName'
      AND column_name = '$ColumnName'
  ) THEN
    RAISE EXCEPTION 'expected public.% to remain absent after rollback', '$TableName.$ColumnName';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Assert column absent: public.$TableName.$ColumnName"
}

function Assert-FunctionAbsent {
  param(
    [Parameter(Mandatory = $true)][string]$FunctionName,
    [Parameter(Mandatory = $true)][string]$TypeArguments
  )

  $sql = @"
DO `$`$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = '$FunctionName'
      AND oidvectortypes(p.proargtypes) = '$TypeArguments'
  ) THEN
    RAISE EXCEPTION 'expected public.%(%) to remain absent after rollback', '$FunctionName', '$TypeArguments';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Assert function absent: public.$FunctionName($TypeArguments)"
}

function Assert-PaymentEventsLegacyRowsPreserved {
  param([Parameter(Mandatory = $true)][string]$Description)

  $sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_events
    WHERE id = '20000000-0000-4000-8000-000000000001'
      AND merchant_id IS NULL
      AND invoice_id IS NULL
      AND processor = 'paystack'
      AND processor_ref = 'legacy-ownerless-ref'
      AND processed_at IS NULL
      AND raw_payload = '{"fixture":"historical_ownerless"}'::jsonb
      AND payment_purpose IS NULL
  ) THEN
    RAISE EXCEPTION 'historical ownerless payment_events row was not preserved unchanged';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.payment_events
    WHERE id = '20000000-0000-4000-8000-000000000002'
      AND merchant_id = '10000000-0000-4000-8000-000000000001'
      AND invoice_id = '10000000-0000-4000-8000-000000000021'
      AND processor = 'paystack'
      AND processor_ref = 'merchant-owned-ref'
      AND processed_at = '2026-06-06T00:01:00Z'::timestamptz
      AND raw_payload = '{"fixture":"merchant_owned"}'::jsonb
      AND payment_purpose = 'invoice_payment'
  ) THEN
    RAISE EXCEPTION 'merchant-owned payment_events row was not preserved unchanged';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payment_events
    WHERE id = '20000000-0000-4000-8000-000000000001'
      AND merchant_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'historical ownerless payment_events row received synthetic ownership';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description $Description
}

function Assert-PaymentEventsInvoiceForeignKey {
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)]
    [ValidateSet("SET NULL", "NO ACTION", "CASCADE", "SET DEFAULT")]
    [string]$ExpectedDeleteAction
  )

  $sql = @"
DO `$`$
DECLARE
  v_fk_count INTEGER;
  v_delete_action TEXT;
BEGIN
  SELECT
    count(*)::integer,
    max(CASE con.confdeltype::text
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE 'UNKNOWN:' || con.confdeltype::text
    END)
  INTO
    v_fk_count,
    v_delete_action
  FROM pg_constraint con
  JOIN pg_class ref_cls ON ref_cls.oid = con.confrelid
  JOIN pg_namespace ref_ns ON ref_ns.oid = ref_cls.relnamespace
  CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_ord(attnum, ordinality)
  JOIN pg_attribute src
    ON src.attrelid = con.conrelid
   AND src.attnum = src_ord.attnum
  CROSS JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS ref_ord(attnum, ordinality)
  JOIN pg_attribute ref
    ON ref.attrelid = con.confrelid
   AND ref.attnum = ref_ord.attnum
   AND ref_ord.ordinality = src_ord.ordinality
  WHERE con.conrelid = 'public.payment_events'::regclass
    AND con.conname = 'payment_events_invoice_id_fkey'
    AND con.contype::text = 'f'
    AND con.convalidated
    AND ref_ns.nspname::text = 'public'
    AND ref_cls.relname::text = 'invoices'
  GROUP BY con.conname, con.confdeltype
  HAVING array_agg(src.attname::text ORDER BY src_ord.ordinality) = ARRAY['invoice_id']::text[]
     AND array_agg(ref.attname::text ORDER BY ref_ord.ordinality) = ARRAY['id']::text[];

  IF COALESCE(v_fk_count, 0) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one validated payment_events_invoice_id_fkey to public.invoices(id), got %',
      COALESCE(v_fk_count, 0);
  END IF;

  IF v_delete_action <> '$ExpectedDeleteAction' THEN
    RAISE EXCEPTION 'payment_events_invoice_id_fkey expected %, got %',
      '$ExpectedDeleteAction',
      v_delete_action;
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description $Description
}

function Set-PaymentEventsInvoiceForeignKeyFixture {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
      "legacy-no-action",
      "wrong-name",
      "wrong-referenced-table",
      "wrong-referenced-column",
      "multiple-candidates",
      "additional-conflicting",
      "unvalidated",
      "cascade",
      "set-default",
      "not-null",
      "wrong-type",
      "missing-target"
    )]
    [string]$Scenario
  )

  $dropExpected = "ALTER TABLE public.payment_events DROP CONSTRAINT IF EXISTS payment_events_invoice_id_fkey;"
  $sql = switch ($Scenario) {
    "legacy-no-action" {
      @"
$dropExpected
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE NO ACTION;
"@
    }
    "wrong-name" {
      @"
$dropExpected
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_invoice_id_wrong_name_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE NO ACTION;
"@
    }
    "wrong-referenced-table" {
      @"
$dropExpected
CREATE TABLE IF NOT EXISTS public.fixture_wrong_invoices (id uuid PRIMARY KEY);
INSERT INTO public.fixture_wrong_invoices (id)
VALUES ('10000000-0000-4000-8000-000000000021')
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.fixture_wrong_invoices(id) ON DELETE NO ACTION;
"@
    }
    "wrong-referenced-column" {
      @"
$dropExpected
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS alternate_id uuid UNIQUE;
UPDATE public.invoices
SET alternate_id = id
WHERE id = '10000000-0000-4000-8000-000000000021';
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(alternate_id) ON DELETE NO ACTION;
"@
    }
    "multiple-candidates" {
      @"
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_invoice_id_additional_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE NO ACTION;
"@
    }
    "additional-conflicting" {
      @"
CREATE TABLE IF NOT EXISTS public.fixture_wrong_invoices (id uuid PRIMARY KEY);
INSERT INTO public.fixture_wrong_invoices (id)
VALUES ('10000000-0000-4000-8000-000000000021')
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_invoice_id_conflicting_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.fixture_wrong_invoices(id) ON DELETE NO ACTION;
"@
    }
    "unvalidated" {
      @"
$dropExpected
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE NO ACTION NOT VALID;
"@
    }
    "cascade" {
      @"
$dropExpected
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;
"@
    }
    "set-default" {
      @"
$dropExpected
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET DEFAULT;
"@
    }
    "not-null" {
      @"
UPDATE public.payment_events
SET invoice_id = '10000000-0000-4000-8000-000000000021'
WHERE invoice_id IS NULL;
ALTER TABLE public.payment_events ALTER COLUMN invoice_id SET NOT NULL;
"@
    }
    "wrong-type" {
      @"
$dropExpected
ALTER TABLE public.payment_events
  ALTER COLUMN invoice_id TYPE text USING invoice_id::text;
"@
    }
    "missing-target" {
      @"
DELETE FROM public.payment_events;
$dropExpected
DROP TABLE public.invoices CASCADE;
"@
    }
  }

  Invoke-PsqlSql -Sql $sql -Description "Create payment_events invoice FK fixture: $Scenario"
}

function Assert-PaymentEventsProcessorDefault {
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)]
    [ValidateSet("none", "paystack", "monnify")]
    [string]$ExpectedDefaultState
  )

  $sql = @"
DO `$`$
DECLARE
  v_default_expr TEXT;
  v_normalized_default TEXT;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
  INTO v_default_expr
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'payment_events'
    AND a.attname = 'processor'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  v_normalized_default := trim(regexp_replace(lower(coalesce(v_default_expr, '')), '\s+', ' ', 'g'));

  IF '$ExpectedDefaultState' = 'none' THEN
    IF v_default_expr IS NOT NULL THEN
      RAISE EXCEPTION 'payment_events.processor expected no default, got %', v_default_expr;
    END IF;
  ELSIF '$ExpectedDefaultState' = 'paystack' THEN
    IF v_normalized_default <> '''paystack''::text' THEN
      RAISE EXCEPTION 'payment_events.processor expected legacy paystack default, got %', COALESCE(v_default_expr, 'NULL');
    END IF;
  ELSIF '$ExpectedDefaultState' = 'monnify' THEN
    IF v_normalized_default <> '''monnify''::text' THEN
      RAISE EXCEPTION 'payment_events.processor expected rejected monnify fixture default, got %', COALESCE(v_default_expr, 'NULL');
    END IF;
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description $Description
}

function Assert-PaymentEventsProcessedAtCanonical {
  param([Parameter(Mandatory = $true)][string]$Description)

  $sql = @"
DO `$`$
DECLARE
  v_default_expr TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_events'
      AND column_name = 'processed_at'
      AND udt_name = 'timestamptz'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'payment_events.processed_at should be nullable timestamptz';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
  INTO v_default_expr
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'payment_events'
    AND a.attname = 'processed_at'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_default_expr IS NOT NULL THEN
    RAISE EXCEPTION 'payment_events.processed_at expected no default, got %', v_default_expr;
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description $Description
}

function Assert-PaymentEventsProcessedAtDefault {
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)]
    [ValidateSet("now", "current_date")]
    [string]$ExpectedDefaultState
  )

  $sql = @"
DO `$`$
DECLARE
  v_default_expr TEXT;
  v_normalized_default TEXT;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
  INTO v_default_expr
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'payment_events'
    AND a.attname = 'processed_at'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  v_normalized_default := trim(regexp_replace(lower(coalesce(v_default_expr, '')), '\s+', ' ', 'g'));

  IF '$ExpectedDefaultState' = 'now' THEN
    IF v_normalized_default <> 'now()' THEN
      RAISE EXCEPTION 'payment_events.processed_at expected legacy now() default, got %', COALESCE(v_default_expr, 'NULL');
    END IF;
  ELSIF '$ExpectedDefaultState' = 'current_date' THEN
    IF v_normalized_default <> 'CURRENT_DATE' AND v_normalized_default <> 'current_date' THEN
      RAISE EXCEPTION 'payment_events.processed_at expected rejected current_date fixture default, got %', COALESCE(v_default_expr, 'NULL');
    END IF;
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description $Description
}

function Assert-PaymentEventsMerchantIdNullable {
  param([Parameter(Mandatory = $true)][string]$Description)

  $sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_events'
      AND column_name = 'merchant_id'
      AND udt_name = 'uuid'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'payment_events.merchant_id should be nullable uuid';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description $Description
}

function Assert-PaymentEventsMerchantIdNotNull {
  param([Parameter(Mandatory = $true)][string]$Description)

  $sql = @"
DO `$`$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_events'
      AND column_name = 'merchant_id'
      AND udt_name = 'uuid'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'payment_events.merchant_id should remain NOT NULL after rollback';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description $Description
}

function Assert-PaymentEventsForeignKeyRejectsInvalidMerchant {
  param([Parameter(Mandatory = $true)][string]$Description)

  $sql = @"
INSERT INTO public.payment_events (
  id,
  merchant_id,
  event_type,
  processor,
  processed_at,
  idempotency_key
)
VALUES (
  '20000000-0000-4000-8000-0000000000ff',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'invalid.merchant',
  'paystack',
  now(),
  'harness:payment-events:invalid-merchant'
);
"@

  Invoke-PsqlSql -Sql $sql -Description $Description -ExpectFailure
}

function Invoke-InjectedFailureMigration {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $fullPath = Join-Path $repoRoot $RelativePath
  $content = Get-Content -Path $fullPath -Raw
  $mutated = [regex]::Replace(
    $content,
    "COMMIT;\s*$",
    "SELECT 1/0;`r`nCOMMIT;`r`n",
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )

  if ($mutated -eq $content) {
    throw "Could not inject late failure into $RelativePath"
  }

  $tempFile = Join-Path $env:TEMP ("migration-harness-injected-" + [System.Guid]::NewGuid().ToString("N") + ".sql")
  try {
    Set-Content -Path $tempFile -Value $mutated -Encoding UTF8
    Invoke-Psql -Arguments @("-X", "-w", "-v", "ON_ERROR_STOP=1", "-d", $TestDatabaseUrl, "-f", $tempFile) -Description $Description -ExpectFailure | Out-Null
  }
  finally {
    if (Test-Path $tempFile) {
      Remove-Item -LiteralPath $tempFile -Force
    }
  }
}

function Run-Harness {
  $results = New-Object System.Collections.Generic.List[string]

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A on clean core fixture"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A SQL assertions"
  Assert-PaymentEventsProcessorDefault -Description "Assert clean Migration A creates canonical payment_events.processor without a default" -ExpectedDefaultState "none"
  Assert-PaymentEventsProcessedAtCanonical -Description "Assert clean Migration A creates canonical nullable payment_events.processed_at without a default"
  Add-PassResult -Results $results -Message "Migration A clean + rerun"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite -IncludePaymentEventsPrerequisite
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A with canonical preexisting payment_events under hostile default grants"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A SQL assertions with canonical preexisting payment_events under hostile default grants"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A with canonical preexisting payment_events"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A SQL assertions with canonical preexisting payment_events"
  Assert-PaymentEventsLegacyRowsPreserved -Description "Assert Migration A preserves historical and merchant-owned payment_events rows"
  Assert-PaymentEventsProcessorDefault -Description "Assert Migration A preserves canonical payment_events.processor without a default" -ExpectedDefaultState "none"
  Assert-PaymentEventsProcessedAtCanonical -Description "Assert Migration A preserves canonical nullable payment_events.processed_at without a default"
  Assert-PaymentEventsMerchantIdNullable -Description "Assert Migration A canonical payment_events.merchant_id nullability"
  Assert-PaymentEventsForeignKeyRejectsInvalidMerchant -Description "Assert Migration A rejects invalid non-null payment_events merchant ownership"
  Add-PassResult -Results $results -Message "Migration A accepts canonical preexisting payment_events and repairs hostile browser grants"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite -IncludePaymentEventsPrerequisite
  Invoke-PsqlSql -Description "Create production-like payment_events.processor legacy default fixture" -Sql @"
ALTER TABLE public.payment_events
  ALTER COLUMN processor SET DEFAULT 'paystack'::text;
"@
  Assert-PaymentEventsProcessorDefault -Description "Assert production-like fixture has legacy payment_events.processor default before Migration A" -ExpectedDefaultState "paystack"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A with production-like payment_events.processor legacy default"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A SQL assertions with production-like payment_events.processor legacy default"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A with production-like payment_events.processor legacy default"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A SQL assertions with production-like payment_events.processor legacy default"
  Assert-PaymentEventsLegacyRowsPreserved -Description "Assert Migration A preserves rows with production-like payment_events.processor legacy default"
  Assert-PaymentEventsProcessorDefault -Description "Assert Migration A preserves production-like payment_events.processor legacy default" -ExpectedDefaultState "paystack"
  Assert-PaymentEventsProcessedAtCanonical -Description "Assert Migration A keeps payment_events.processed_at canonical with processor legacy default"
  Assert-PaymentEventsMerchantIdNullable -Description "Assert Migration A keeps merchant_id nullable with production-like processor default"
  Assert-PaymentEventsForeignKeyRejectsInvalidMerchant -Description "Assert Migration A keeps FK enforcement with production-like processor default"
  Add-PassResult -Results $results -Message "Migration A accepts and preserves production-like payment_events.processor paystack default"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite -IncludePaymentEventsPrerequisite
  Invoke-PsqlSql -Description "Create production-like payment_events.processed_at legacy now default fixture" -Sql @"
ALTER TABLE public.payment_events
  ALTER COLUMN processed_at SET DEFAULT now();
"@
  Assert-PaymentEventsProcessedAtDefault -Description "Assert production-like fixture has legacy payment_events.processed_at now default before Migration A" -ExpectedDefaultState "now"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A with production-like payment_events.processed_at legacy now default"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A SQL assertions with production-like payment_events.processed_at legacy now default"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A with repaired payment_events.processed_at default"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A SQL assertions with repaired payment_events.processed_at default"
  Assert-PaymentEventsLegacyRowsPreserved -Description "Assert Migration A preserves rows with production-like payment_events.processed_at legacy default"
  Assert-PaymentEventsProcessedAtCanonical -Description "Assert Migration A drops production-like payment_events.processed_at legacy now default"
  Assert-PaymentEventsProcessorDefault -Description "Assert Migration A keeps payment_events.processor canonical with processed_at legacy default" -ExpectedDefaultState "none"
  Assert-PaymentEventsMerchantIdNullable -Description "Assert Migration A keeps merchant_id nullable with processed_at legacy default"
  Assert-PaymentEventsForeignKeyRejectsInvalidMerchant -Description "Assert Migration A keeps FK enforcement with processed_at legacy default"
  Add-PassResult -Results $results -Message "Migration A repairs production-like payment_events.processed_at now default and preserves rows"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite -IncludePaymentEventsPrerequisite
  Invoke-PsqlSql -Description "Create production-like payment_events FK delete-action drift" -Sql @"
ALTER TABLE public.payment_events DROP CONSTRAINT payment_events_merchant_id_fkey;
ALTER TABLE public.payment_events
  ADD CONSTRAINT payment_events_merchant_id_fkey
  FOREIGN KEY (merchant_id) REFERENCES public.merchants(id);
"@
  Invoke-PsqlFile -RelativePath "supabase/staging/preflight/017_payment_events_legacy_merchant_compatibility_snapshot.sql" -Description "Run payment_events legacy compatibility staging preflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/017_payment_events_legacy_merchant_compatibility.sql" -Description "Run payment_events legacy compatibility staging wrapper"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/017_payment_events_legacy_merchant_compatibility_verify.sql" -Description "Run payment_events legacy compatibility staging postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/017_payment_events_legacy_merchant_compatibility.sql" -Description "Rerun payment_events legacy compatibility staging wrapper"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/017_payment_events_legacy_merchant_compatibility_verify.sql" -Description "Run payment_events legacy compatibility staging postflight after rerun"
  Assert-PaymentEventsLegacyRowsPreserved -Description "Assert forward migration preserves historical and merchant-owned payment_events rows"
  Assert-PaymentEventsMerchantIdNullable -Description "Assert forward migration canonical payment_events.merchant_id nullability"
  Assert-PaymentEventsForeignKeyRejectsInvalidMerchant -Description "Assert forward migration rejects invalid non-null payment_events merchant ownership"
  Add-PassResult -Results $results -Message "Payment events legacy compatibility staging flow repairs FK drift and preserves rows"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite -IncludePaymentEventsPrerequisite
  Invoke-PsqlSql -Description "Create already-applied NOT NULL payment_events fixture" -Sql @"
DELETE FROM public.payment_events
WHERE id = '20000000-0000-4000-8000-000000000001';
ALTER TABLE public.payment_events ALTER COLUMN merchant_id SET NOT NULL;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260803_00_payment_events_legacy_merchant_compatibility.sql" -Description "Run forward payment_events compatibility migration on NOT NULL fixture"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260803_00_payment_events_legacy_merchant_compatibility.sql" -Description "Rerun forward payment_events compatibility migration on repaired fixture"
  Assert-PaymentEventsMerchantIdNullable -Description "Assert forward migration drops payment_events.merchant_id NOT NULL"
  Assert-PaymentEventsForeignKeyRejectsInvalidMerchant -Description "Assert forward migration keeps real merchant FK enforcement after NOT NULL repair"
  Add-PassResult -Results $results -Message "Forward payment_events compatibility migration repairs already-applied NOT NULL schemas"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A with canonical preexisting payment_records security"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A SQL assertions with canonical preexisting payment_records security"
  Add-PassResult -Results $results -Message "Migration A accepts canonical preexisting payment_records security"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare canonical substrate before Migration B"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Run Migration B on canonical substrate"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_payment_lifecycle.sql" -Description "Run Migration B SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Rerun Migration B"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_payment_lifecycle.sql" -Description "Rerun Migration B SQL assertions"
  Add-PassResult -Results $results -Message "Migration B clean + rerun"

  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Rerun Commit 9 review RPC migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_review_decision_rpc.sql" -Description "Rerun Commit 9 review RPC SQL assertions"
  Add-PassResult -Results $results -Message "Commit 9 review RPC clean + rerun"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate before Commit 10 preflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/preflight/012_solo_plus_activation_rpc_snapshot.sql" -Description "Run Commit 10 staging preflight snapshot"
  Add-PassResult -Results $results -Message "Commit 10 staging preflight snapshot"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate before Commit 10 wrapper apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/012_solo_plus_activation_rpc.sql" -Description "Run Commit 10 staging wrapper"
  Add-PassResult -Results $results -Message "Commit 10 staging wrapper apply"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate before Commit 10 postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/012_solo_plus_activation_rpc.sql" -Description "Run Commit 10 staging wrapper before postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/012_solo_plus_activation_rpc_verify.sql" -Description "Run Commit 10 staging postflight verify"
  Add-PassResult -Results $results -Message "Commit 10 staging postflight verify"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate before Commit 10 wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/012_solo_plus_activation_rpc.sql" -Description "Run Commit 10 staging wrapper first apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/012_solo_plus_activation_rpc.sql" -Description "Run Commit 10 staging wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/012_solo_plus_activation_rpc_verify.sql" -Description "Run Commit 10 staging postflight verify after rerun"
  Add-PassResult -Results $results -Message "Commit 10 staging wrapper rerun + postflight verify"

  Invoke-PsqlFile -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Run Commit 10 activation RPC migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 regression assertions after Commit 10 activation RPC migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_activation_rpc.sql" -Description "Run Commit 10 activation RPC SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Rerun Commit 10 activation RPC migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_activation_rpc.sql" -Description "Rerun Commit 10 activation RPC SQL assertions"
  Add-PassResult -Results $results -Message "Commit 10 activation RPC clean + rerun"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit12PrerequisiteChain -Scenario "Commit 12 preflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/preflight/013_solo_plus_payment_recovery_snapshot.sql" -Description "Run Commit 12 staging preflight snapshot"
  Add-PassResult -Results $results -Message "Commit 12 staging preflight snapshot"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit12PrerequisiteChain -Scenario "Commit 12 wrapper apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/013_solo_plus_payment_recovery.sql" -Description "Run Commit 12 staging wrapper"
  Add-PassResult -Results $results -Message "Commit 12 staging wrapper apply"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit12PrerequisiteChain -Scenario "Commit 12 postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/013_solo_plus_payment_recovery.sql" -Description "Run Commit 12 staging wrapper before postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/013_solo_plus_payment_recovery_verify.sql" -Description "Run Commit 12 staging postflight verify"
  Add-PassResult -Results $results -Message "Commit 12 staging postflight verify"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit12PrerequisiteChain -Scenario "Commit 12 wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/013_solo_plus_payment_recovery.sql" -Description "Run Commit 12 staging wrapper first apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/013_solo_plus_payment_recovery.sql" -Description "Run Commit 12 staging wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/013_solo_plus_payment_recovery_verify.sql" -Description "Run Commit 12 staging postflight verify after rerun"
  Add-PassResult -Results $results -Message "Commit 12 staging wrapper rerun + postflight verify"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit12PrerequisiteChain -Scenario "Commit 12 payment recovery RPC regression"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260718_01_solo_plus_payment_recovery.sql" -Description "Run Commit 12 payment recovery migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_activation_rpc.sql" -Description "Run Commit 10 regression assertions after Commit 12 payment recovery migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_payment_recovery_rpc.sql" -Description "Run Commit 12 payment recovery RPC SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260718_01_solo_plus_payment_recovery.sql" -Description "Rerun Commit 12 payment recovery migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_payment_recovery_rpc.sql" -Description "Rerun Commit 12 payment recovery RPC SQL assertions"
  Add-PassResult -Results $results -Message "Commit 12 payment recovery clean + rerun"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13PrerequisiteChain -Scenario "Commit 13 authorization preflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/preflight/014_authorization_hardening_snapshot.sql" -Description "Run Commit 13 authorization hardening staging preflight snapshot"
  Add-PassResult -Results $results -Message "Commit 13 authorization hardening staging preflight snapshot"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13PrerequisiteChain -Scenario "Commit 13 authorization wrapper apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/014_authorization_hardening.sql" -Description "Run Commit 13 authorization hardening staging wrapper"
  Add-PassResult -Results $results -Message "Commit 13 authorization hardening staging wrapper apply"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13PrerequisiteChain -Scenario "Commit 13 authorization postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/014_authorization_hardening.sql" -Description "Run Commit 13 authorization hardening staging wrapper before postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/014_authorization_hardening_verify.sql" -Description "Run Commit 13 authorization hardening staging postflight verify"
  Add-PassResult -Results $results -Message "Commit 13 authorization hardening staging postflight verify"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13PrerequisiteChain -Scenario "Commit 13 authorization wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/014_authorization_hardening.sql" -Description "Run Commit 13 authorization hardening staging wrapper first apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/014_authorization_hardening.sql" -Description "Run Commit 13 authorization hardening staging wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/014_authorization_hardening_verify.sql" -Description "Run Commit 13 authorization hardening staging postflight verify after rerun"
  Add-PassResult -Results $results -Message "Commit 13 authorization hardening staging wrapper rerun + postflight verify"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13PrerequisiteChain -Scenario "Commit 13 authorization SQL regression"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260728_00_authorization_hardening.sql" -Description "Run Commit 13 authorization hardening migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_authorization_hardening.sql" -Description "Run Commit 13 authorization hardening SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260728_00_authorization_hardening.sql" -Description "Rerun Commit 13 authorization hardening migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_authorization_hardening.sql" -Description "Rerun Commit 13 authorization hardening SQL assertions"
  Add-PassResult -Results $results -Message "Commit 13 authorization hardening clean + rerun"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13PrerequisiteChain -Scenario "Commit 13 hosted Supabase managed-role default ACL fixture"
  Initialize-HostedSupabaseManagedDefaultAclFixture
  Invoke-PsqlFileAsRole -RoleName "commit13_migration_owner" -RelativePath "supabase/staging/preflight/014_authorization_hardening_snapshot.sql" -Description "Run Commit 13 authorization preflight under hosted managed-role fixture"
  Invoke-PsqlFileAsRole -RoleName "commit13_migration_owner" -RelativePath "supabase/staging/014_authorization_hardening.sql" -Description "Run Commit 13 authorization wrapper under hosted managed-role fixture"
  Invoke-PsqlFileAsRole -RoleName "commit13_migration_owner" -RelativePath "supabase/staging/postflight/014_authorization_hardening_verify.sql" -Description "Run Commit 13 authorization postflight under hosted managed-role fixture"
  Invoke-PsqlFileAsRole -RoleName "commit13_migration_owner" -RelativePath "supabase/staging/014_authorization_hardening.sql" -Description "Rerun Commit 13 authorization wrapper under hosted managed-role fixture"
  Invoke-PsqlFileAsRole -RoleName "commit13_migration_owner" -RelativePath "supabase/staging/postflight/014_authorization_hardening_verify.sql" -Description "Rerun Commit 13 authorization postflight under hosted managed-role fixture"
  Assert-SupabaseAdminDefaultAclFixturePreserved
  Add-PassResult -Results $results -Message "Commit 13 skips unmodifiable supabase_admin defaults while hardening DeraLedger-owned defaults"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13PrerequisiteChain -Scenario "Commit 13 disclosure preflight staging-drift failure"
  Initialize-VerificationDisclosureBrowserWriteDriftFixture
  Invoke-PsqlFile -RelativePath "supabase/staging/preflight/015_verification_disclosure_acknowledgement_snapshot.sql" -Description "Expect Commit 13 disclosure preflight to fail before authorization hardening" -ExpectFailure
  Add-PassResult -Results $results -Message "Commit 13 disclosure preflight fails closed before authorization hardening"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13AuthorizationChain -Scenario "Commit 13 disclosure preflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/preflight/015_verification_disclosure_acknowledgement_snapshot.sql" -Description "Run Commit 13 disclosure staging preflight snapshot"
  Add-PassResult -Results $results -Message "Commit 13 disclosure staging preflight snapshot"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13AuthorizationChain -Scenario "Commit 13 disclosure wrapper apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure staging wrapper"
  Add-PassResult -Results $results -Message "Commit 13 disclosure staging wrapper apply"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13AuthorizationChain -Scenario "Commit 13 disclosure postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure staging wrapper before postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/015_verification_disclosure_acknowledgement_verify.sql" -Description "Run Commit 13 disclosure staging postflight verify"
  Add-PassResult -Results $results -Message "Commit 13 disclosure staging postflight verify"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13AuthorizationChain -Scenario "Commit 13 disclosure wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure staging wrapper first apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure staging wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/015_verification_disclosure_acknowledgement_verify.sql" -Description "Run Commit 13 disclosure staging postflight verify after rerun"
  Add-PassResult -Results $results -Message "Commit 13 disclosure staging wrapper rerun + postflight verify"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13AuthorizationChain -Scenario "Commit 13 disclosure RPC regression"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure acknowledgement migration"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260731_00_verification_disclosure_identity_hardening.sql" -Description "Run Commit 13 disclosure identity hardening migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure acknowledgement SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql" -Description "Rerun Commit 13 disclosure acknowledgement migration"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260731_00_verification_disclosure_identity_hardening.sql" -Description "Rerun Commit 13 disclosure identity hardening migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_verification_disclosure_acknowledgement_rpc.sql" -Description "Rerun Commit 13 disclosure acknowledgement SQL assertions"
  Add-PassResult -Results $results -Message "Commit 13 disclosure acknowledgement clean + rerun"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13AuthorizationChain -Scenario "Commit 13 disclosure identity preflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure staging wrapper before identity preflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/preflight/016_verification_disclosure_identity_hardening_snapshot.sql" -Description "Run Commit 13 disclosure identity preflight snapshot"
  Add-PassResult -Results $results -Message "Commit 13 disclosure identity preflight snapshot"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13AuthorizationChain -Scenario "Commit 13 disclosure identity wrapper apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure staging wrapper before identity apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/016_verification_disclosure_identity_hardening.sql" -Description "Run Commit 13 disclosure identity staging wrapper"
  Add-PassResult -Results $results -Message "Commit 13 disclosure identity staging wrapper apply"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13AuthorizationChain -Scenario "Commit 13 disclosure identity postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure staging wrapper before identity postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/016_verification_disclosure_identity_hardening.sql" -Description "Run Commit 13 disclosure identity staging wrapper before postflight"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/016_verification_disclosure_identity_hardening_verify.sql" -Description "Run Commit 13 disclosure identity postflight verify"
  Add-PassResult -Results $results -Message "Commit 13 disclosure identity postflight verify"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-Commit13AuthorizationChain -Scenario "Commit 13 disclosure identity wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/015_verification_disclosure_acknowledgement_rpc.sql" -Description "Run Commit 13 disclosure staging wrapper before identity rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/016_verification_disclosure_identity_hardening.sql" -Description "Run Commit 13 disclosure identity staging wrapper first apply"
  Invoke-PsqlFile -RelativePath "supabase/staging/016_verification_disclosure_identity_hardening.sql" -Description "Run Commit 13 disclosure identity staging wrapper rerun"
  Invoke-PsqlFile -RelativePath "supabase/staging/postflight/016_verification_disclosure_identity_hardening_verify.sql" -Description "Run Commit 13 disclosure identity postflight verify after rerun"
  Add-PassResult -Results $results -Message "Commit 13 disclosure identity staging wrapper rerun + postflight verify"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create missing Commit 9 prerequisite table state" -Sql @"
DROP TABLE public.solo_plus_case_requirements;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Expect Commit 9 review RPC migration to fail on missing prerequisite tables" -ExpectFailure
  Assert-FunctionAbsent -FunctionName "review_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, text, uuid, text, text"
  Add-PassResult -Results $results -Message "Commit 9 blocks missing prerequisite tables before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate for Commit 10 missing prerequisite table test"
  Invoke-PsqlSql -Description "Create missing Commit 10 prerequisite table state" -Sql @"
DROP TABLE public.workspace_subscriptions;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Expect Commit 10 activation RPC migration to fail on missing prerequisite tables" -ExpectFailure
  Assert-FunctionAbsent -FunctionName "activate_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, uuid, text"
  Add-PassResult -Results $results -Message "Commit 10 blocks missing prerequisite tables before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create incompatible Commit 9 prerequisite index state" -Sql @"
DROP INDEX public.idx_solo_plus_case_events_request_idempotency;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Expect Commit 9 review RPC migration to fail on incompatible prerequisite tables" -ExpectFailure
  Assert-FunctionAbsent -FunctionName "review_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, text, uuid, text, text"
  Add-PassResult -Results $results -Message "Commit 9 blocks incompatible prerequisite tables before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate for Commit 10 incompatible prerequisite column test"
  Invoke-PsqlSql -Description "Create incompatible Commit 10 prerequisite column state" -Sql @"
ALTER TABLE public.merchants DROP COLUMN live_features_enabled;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Expect Commit 10 activation RPC migration to fail on incompatible prerequisite columns" -ExpectFailure
  Assert-FunctionAbsent -FunctionName "activate_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, uuid, text"
  Add-PassResult -Results $results -Message "Commit 10 blocks incompatible prerequisite columns before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Initialize-SoloPlusReviewSecurityDriftFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC migration with staging-like Solo Plus security drift"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC SQL assertions after security drift repair"
  Add-PassResult -Results $results -Message "Commit 9 repairs staging-like Solo Plus table security drift"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Initialize-SoloPlusReviewSecurityDriftFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare canonical Commit 9 substrate for Commit 10 security drift repair"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Run Commit 10 activation RPC migration with staging-like Solo Plus table security drift"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_activation_rpc.sql" -Description "Run Commit 10 activation RPC SQL assertions after security drift repair"
  Add-PassResult -Results $results -Message "Commit 10 repairs canonical Solo Plus table security drift"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create unexpected Commit 9 RPC overload fixture" -Sql @'
CREATE FUNCTION public.review_solo_plus_case_v1(
  p_case_id uuid,
  p_expected_row_version integer,
  p_request_idempotency_key text,
  p_decision text,
  p_reviewer_admin_id uuid,
  p_reason text default null,
  p_policy_version text default null
)
RETURNS jsonb
LANGUAGE sql
AS $$ SELECT jsonb_build_object('kind', 'unexpected_overload'); $$;
'@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Expect Commit 9 review RPC migration to fail on unexpected overload" -ExpectFailure
  Assert-FunctionAbsent -FunctionName "review_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, text, uuid, text, text"
  Add-PassResult -Results $results -Message "Commit 9 blocks unexpected RPC overload before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate for Commit 10 overload test"
  Invoke-PsqlSql -Description "Create unexpected Commit 10 RPC overload fixture" -Sql @'
CREATE FUNCTION public.activate_solo_plus_case_v1(
  p_case_id uuid,
  p_expected_row_version integer,
  p_request_idempotency_key text,
  p_activator_admin_id uuid,
  p_policy_version text default null
)
RETURNS jsonb
LANGUAGE sql
AS $$ SELECT jsonb_build_object('kind', 'unexpected_overload'); $$;
'@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Expect Commit 10 activation RPC migration to fail on unexpected overload" -ExpectFailure
  Assert-FunctionAbsent -FunctionName "activate_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, uuid, text"
  Add-PassResult -Results $results -Message "Commit 10 blocks unexpected RPC overload before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare exact-signature Commit 9 RPC for privilege drift repair"
  Invoke-PsqlSql -Description "Create unsafe Commit 9 RPC execute grants" -Sql @"
GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) TO authenticated;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Rerun Commit 9 review RPC migration to repair unsafe execute grants"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC SQL assertions after privilege repair"
  Add-PassResult -Results $results -Message "Commit 9 repairs unsafe exact-signature RPC execute drift"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate for Commit 10 privilege drift repair"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Prepare exact-signature Commit 10 activation RPC for privilege drift repair"
  Invoke-PsqlSql -Description "Create unsafe Commit 10 activation RPC execute/search_path drift" -Sql @"
GRANT EXECUTE ON FUNCTION public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text) TO authenticated;
ALTER FUNCTION public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text) RESET ALL;
ALTER FUNCTION public.activate_solo_plus_case_v1(uuid, bigint, text, uuid, text)
  SET search_path = public;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Rerun Commit 10 activation RPC migration to repair unsafe execute/search_path drift"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_activation_rpc.sql" -Description "Run Commit 10 activation RPC SQL assertions after privilege repair"
  Add-PassResult -Results $results -Message "Commit 10 repairs unsafe exact-signature RPC execute drift"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create incompatible payment_records fixture" -Sql @"
ALTER TABLE public.payment_records DROP CONSTRAINT payment_records_internal_reference_key;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on incompatible payment_records" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A blocks incompatible payment_records before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludePaymentEventsPrerequisite
  Invoke-PsqlSql -Description "Create incompatible payment_events fixture" -Sql @"
ALTER TABLE public.payment_events DROP CONSTRAINT payment_events_merchant_id_fkey;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on incompatible payment_events" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A blocks incompatible payment_events before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludePaymentEventsPrerequisite
  Invoke-PsqlSql -Description "Create incompatible payment_events.processor default fixture" -Sql @"
ALTER TABLE public.payment_events
  ALTER COLUMN processor SET DEFAULT 'monnify'::text;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on incompatible payment_events.processor default" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Assert-PaymentEventsProcessorDefault -Description "Assert failed Migration A leaves rejected payment_events.processor default unchanged" -ExpectedDefaultState "monnify"
  Assert-PaymentEventsLegacyRowsPreserved -Description "Assert failed Migration A leaves payment_events rows unchanged after processor default rejection"
  Add-PassResult -Results $results -Message "Migration A blocks incompatible payment_events.processor defaults before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludePaymentEventsPrerequisite
  Invoke-PsqlSql -Description "Create incompatible payment_events.processed_at default fixture" -Sql @"
ALTER TABLE public.payment_events
  ALTER COLUMN processed_at SET DEFAULT CURRENT_DATE;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on incompatible payment_events.processed_at default" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Assert-PaymentEventsProcessedAtDefault -Description "Assert failed Migration A leaves rejected payment_events.processed_at default unchanged" -ExpectedDefaultState "current_date"
  Assert-PaymentEventsLegacyRowsPreserved -Description "Assert failed Migration A leaves payment_events rows unchanged after processed_at default rejection"
  Add-PassResult -Results $results -Message "Migration A blocks incompatible payment_events.processed_at defaults before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludePaymentEventsPrerequisite
  Set-PaymentEventsInvoiceForeignKeyFixture -Scenario "legacy-no-action"
  Assert-PaymentEventsInvoiceForeignKey -Description "Assert legacy payment_events invoice FK fixture starts as NO ACTION" -ExpectedDeleteAction "NO ACTION"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A to normalize legacy payment_events invoice FK"
  Assert-PaymentEventsInvoiceForeignKey -Description "Assert Migration A normalizes payment_events invoice FK to SET NULL" -ExpectedDeleteAction "SET NULL"
  Assert-PaymentEventsLegacyRowsPreserved -Description "Assert Migration A preserves payment_events rows while normalizing invoice FK"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A after invoice FK normalization"
  Assert-PaymentEventsInvoiceForeignKey -Description "Assert rerun keeps payment_events invoice FK canonical" -ExpectedDeleteAction "SET NULL"
  Assert-PaymentEventsLegacyRowsPreserved -Description "Assert rerun preserves payment_events rows after invoice FK normalization"
  Add-PassResult -Results $results -Message "Migration A normalizes exact legacy payment_events invoice FK NO ACTION to SET NULL idempotently"

  foreach ($invoiceFkScenario in @(
    "wrong-name",
    "wrong-referenced-table",
    "wrong-referenced-column",
    "multiple-candidates",
    "additional-conflicting",
    "unvalidated",
    "cascade",
    "set-default",
    "not-null",
    "wrong-type",
    "missing-target"
  )) {
    Reset-DisposableDatabase
    Initialize-CoreFixture -IncludePaymentEventsPrerequisite
    Set-PaymentEventsInvoiceForeignKeyFixture -Scenario $invoiceFkScenario
    Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on payment_events invoice FK fixture $invoiceFkScenario" -ExpectFailure
    Assert-RelationAbsent -QualifiedName "public.payment_sessions"
    Add-PassResult -Results $results -Message "Migration A rejects payment_events invoice FK fixture $invoiceFkScenario"
  }

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite
  Invoke-PsqlSql -Description "Create conflicting permissive policy fixture" -Sql @"
CREATE POLICY alt_payment_records_select
  ON public.payment_records
  FOR SELECT
  USING (auth.role() = 'authenticated');
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on overlapping permissive policy" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A blocks overlapping differently named policy"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create incompatible merchant_team fixture" -Sql @"
ALTER TABLE public.merchant_team
  DROP CONSTRAINT merchant_team_user_id_fkey;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on incompatible merchant_team" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A blocks incompatible merchant_team before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for partial-state Migration B test"
  Invoke-PsqlSql -Description "Create canonical partial Commit 7 state" -Sql @"
ALTER TABLE public.payment_records
  ADD COLUMN onboarding_session_id uuid REFERENCES public.onboarding_sessions(id) ON DELETE SET NULL,
  ADD COLUMN solo_plus_case_id uuid REFERENCES public.solo_plus_cases(id) ON DELETE SET NULL;
CREATE INDEX idx_payment_records_onboarding_session
  ON public.payment_records(onboarding_session_id, created_at DESC);
CREATE INDEX idx_payment_records_solo_plus_case
  ON public.payment_records(solo_plus_case_id, created_at DESC);
CREATE UNIQUE INDEX idx_payment_records_solo_plus_pending_case
  ON public.payment_records(solo_plus_case_id)
  WHERE solo_plus_case_id IS NOT NULL
    AND payment_status = 'pending';
CREATE UNIQUE INDEX idx_payment_records_solo_plus_provider_reference
  ON public.payment_records(provider_name, provider_reference)
  WHERE solo_plus_case_id IS NOT NULL
    AND provider_reference IS NOT NULL;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Run Migration B from canonical partial Commit 7 state"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_payment_lifecycle.sql" -Description "Run Migration B SQL assertions from partial state"
  Add-PassResult -Results $results -Message "Migration B resumes from canonical partial state"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for conflicting partial Migration B test"
  Invoke-PsqlSql -Description "Create conflicting partial Commit 7 column state" -Sql @"
ALTER TABLE public.payment_records ADD COLUMN onboarding_session_id text;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Expect Migration B to fail on conflicting partial column state" -ExpectFailure
  Assert-ColumnAbsent -TableName "crypto_payment_sessions" -ColumnName "payment_record_id"
  Add-PassResult -Results $results -Message "Migration B blocks conflicting partial column before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for conflicting partial FK Migration B test"
  Invoke-PsqlSql -Description "Create conflicting partial Commit 7 foreign-key state" -Sql @"
ALTER TABLE public.payment_records
  ADD COLUMN onboarding_session_id uuid REFERENCES public.solo_plus_cases(id) ON DELETE SET NULL;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Expect Migration B to fail on conflicting partial foreign-key state" -ExpectFailure
  Assert-ColumnAbsent -TableName "crypto_payment_sessions" -ColumnName "payment_record_id"
  Add-PassResult -Results $results -Message "Migration B blocks conflicting partial foreign key before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for conflicting partial predicate Migration B test"
  Invoke-PsqlSql -Description "Create conflicting partial Commit 7 index predicate state" -Sql @"
ALTER TABLE public.payment_records
  ADD COLUMN onboarding_session_id uuid REFERENCES public.onboarding_sessions(id) ON DELETE SET NULL,
  ADD COLUMN solo_plus_case_id uuid REFERENCES public.solo_plus_cases(id) ON DELETE SET NULL;
CREATE INDEX idx_payment_records_onboarding_session
  ON public.payment_records(onboarding_session_id, created_at DESC);
CREATE INDEX idx_payment_records_solo_plus_case
  ON public.payment_records(solo_plus_case_id, created_at DESC);
CREATE UNIQUE INDEX idx_payment_records_solo_plus_pending_case
  ON public.payment_records(solo_plus_case_id)
  WHERE payment_status = 'pending';
CREATE UNIQUE INDEX idx_payment_records_solo_plus_provider_reference
  ON public.payment_records(provider_name, provider_reference)
  WHERE provider_reference IS NOT NULL;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Expect Migration B to fail on conflicting partial predicate state" -ExpectFailure
  Assert-ColumnAbsent -TableName "crypto_payment_sessions" -ColumnName "payment_record_id"
  Add-PassResult -Results $results -Message "Migration B blocks conflicting partial index predicate before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-InjectedFailureMigration -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A with injected late failure"
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A rolls back on injected late failure"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite -IncludePaymentEventsPrerequisite
  Invoke-PsqlSql -Description "Create NOT NULL payment_events rollback fixture" -Sql @"
DELETE FROM public.payment_events
WHERE id = '20000000-0000-4000-8000-000000000001';
ALTER TABLE public.payment_events ALTER COLUMN merchant_id SET NOT NULL;
"@
  Invoke-InjectedFailureMigration -RelativePath "supabase/migrations/20260803_00_payment_events_legacy_merchant_compatibility.sql" -Description "Run payment_events legacy compatibility migration with injected late failure"
  Assert-PaymentEventsMerchantIdNotNull -Description "Assert payment_events legacy compatibility rollback preserves NOT NULL fixture"
  Add-PassResult -Results $results -Message "Payment events legacy compatibility migration rolls back on injected late failure"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for Migration B rollback test"
  Invoke-InjectedFailureMigration -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Run Migration B with injected late failure"
  Assert-ColumnAbsent -TableName "payment_records" -ColumnName "onboarding_session_id"
  Add-PassResult -Results $results -Message "Migration B rolls back on injected late failure"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for Commit 9 review RPC rollback test"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Prepare payment lifecycle substrate for Commit 9 review RPC rollback test"
  Invoke-InjectedFailureMigration -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC migration with injected late failure"
  Assert-FunctionAbsent -FunctionName "review_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, text, uuid, text, text"
  Add-PassResult -Results $results -Message "Commit 9 review RPC migration rolls back on injected late failure"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare Commit 9 substrate for Commit 10 activation RPC rollback test"
  Invoke-InjectedFailureMigration -RelativePath "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql" -Description "Run Commit 10 activation RPC migration with injected late failure"
  Assert-FunctionAbsent -FunctionName "activate_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, uuid, text"
  Add-PassResult -Results $results -Message "Commit 10 activation RPC migration rolls back on injected late failure"

  Write-Host ""
  Write-Host "Harness summary"
  foreach ($result in $results) {
    Write-Host $result
  }
}

if ($RunSafetySelfTests -or $RunHarnessSelfTests) {
  if ($RunSafetySelfTests) {
    Run-SafetySelfTests
  }
  if ($RunHarnessSelfTests) {
    Run-HarnessSelfTests
  }
}
else {
  Assert-SafeDisposableDatabase -ConnectionString $TestDatabaseUrl
  Run-Harness
}
