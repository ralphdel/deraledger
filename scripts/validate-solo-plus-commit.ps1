[CmdletBinding()]
param(
  [switch]$CollectAllFailures = $true,
  [int]$CommitNumber = 10,
  [string]$OutputDirectory,
  [string]$TestDatabaseUrl = $env:TEST_DATABASE_URL
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

New-Item -ItemType Directory -Path $script:LogRoot -Force | Out-Null

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
  try {
    [void]$process.Start()
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()

    $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
    if ($timedOut) {
      try {
        $process.Kill($true)
      } catch {
      }
      $process.WaitForExit()
    }

    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()

    return [pscustomobject]@{
      ExitCode   = if ($timedOut) { 124 } else { $process.ExitCode }
      TimedOut   = $timedOut
      Stdout     = $stdout
      Stderr     = $stderr
      DurationMs = [int][Math]::Round($stopwatch.Elapsed.TotalMilliseconds)
      Command    = (@($effectiveFilePath) + @($effectiveArguments)) -join ' '
    }
  }
  finally {
    $stopwatch.Stop()
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
    Remove-Item -Path "Env:PGPASSWORD" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGSERVICE" -ErrorAction SilentlyContinue
    Remove-Item -Path "Env:PGSERVICEFILE" -ErrorAction SilentlyContinue

    $uri = [Uri]$ConnectionString
    $explicitSslMode = Get-ConnectionStringQueryParameterValue -Uri $uri -Name "sslmode"
    if ($explicitSslMode -and $explicitSslMode.Trim().ToLowerInvariant() -ne "disable") {
      throw "TEST_DATABASE_URL must not request a contradictory SSL mode for local disposable validation."
    }

    Set-Item -Path "Env:PGSSLMODE" -Value "disable"

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
    [int]$TimeoutSeconds = 1800
  )

  return Invoke-CapturedProcess -FilePath $Context.PsqlPath -Arguments $Arguments -WorkingDirectory $script:RepoRoot -TimeoutSeconds $TimeoutSeconds
}

function Invoke-PsqlFileStrict {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Context,
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [int]$TimeoutSeconds = 1800
  )

  $fullPath = Join-Path $script:RepoRoot $RelativePath
  if (-not (Test-Path $fullPath)) {
    throw "Missing SQL file: $RelativePath"
  }

  $result = Invoke-PsqlCaptured -Context $Context -Arguments @('-X', '-v', 'ON_ERROR_STOP=1', '-d', $Context.TestDatabaseUrl, '-f', $fullPath) -TimeoutSeconds $TimeoutSeconds
  if ($result.ExitCode -ne 0) {
    throw "$RelativePath failed with exit code $($result.ExitCode)`n$($result.Stderr)`n$($result.Stdout)"
  }

  return $result
}

function Invoke-PsqlSqlStrict {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Context,
    [Parameter(Mandatory = $true)][string]$Sql,
    [int]$TimeoutSeconds = 1800
  )

  $tempFile = Join-Path $env:TEMP ("solo-plus-validate-" + [guid]::NewGuid().ToString('N') + '.sql')
  try {
    Set-Content -Path $tempFile -Value $Sql -Encoding UTF8
    $result = Invoke-PsqlCaptured -Context $Context -Arguments @('-X', '-v', 'ON_ERROR_STOP=1', '-d', $Context.TestDatabaseUrl, '-f', $tempFile) -TimeoutSeconds $TimeoutSeconds
    if ($result.ExitCode -ne 0) {
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
      $missing = @($required | Where-Object { -not (Test-Path (Join-Path $ctx.RepoRoot $_)) })
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
  (New-CallbackCheck -Id 'ENV-012' -Name 'No activation route, server action, or UI additions' -Phase 'A' -RootCauseCategory 'scope-boundary' -CommandDisplay 'Inspect current working tree for forbidden app-boundary additions' -Callback {
      param($ctx)
      $statusLines = Get-GitStatusLines
      $forbidden = @($statusLines | Where-Object {
        $_ -match '(^|/)activate(/|\.|$)' -or
        $_ -match '(^|/)actions(/|\.|$)' -or
        $_ -match '(^|/)page\.(ts|tsx|js|jsx)$' -or
        $_ -match '(^|/)layout\.(ts|tsx|js|jsx)$'
      })
      if ($forbidden.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ($forbidden -join [Environment]::NewLine); Stderr = 'Commit 11 must not add activation routes, server actions, or UI files.' }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'No forbidden activation-route, server-action, or UI additions detected.'; Stderr = '' }
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
        'src/app/api/solo-plus/case/route.ts',
        'src/app/api/solo-plus/case/requirements/evidence/route.ts',
        'tests/solo-plus-browser-origin.test.ts',
        'tests/solo-plus-case-route.test.ts',
        'tests/solo-plus-case-evidence-route.test.ts'
      )
      $missing = @($required | Where-Object { -not (Test-Path (Join-Path $ctx.RepoRoot $_)) })
      if ($missing.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ''; Stderr = ('Missing Commit 11 artifacts:' + [Environment]::NewLine + ($missing -join [Environment]::NewLine)) }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = ($required -join [Environment]::NewLine); Stderr = '' }
    }),
  (New-CallbackCheck -Id 'ENV-017' -Name 'No Commit 11 migration added' -Phase 'A' -RootCauseCategory 'migration-manifest' -CommandDisplay 'Inspect current working tree for unexpected migration additions' -Callback {
      param($ctx)
      $statusLines = Get-GitStatusLines
      $unexpected = @($statusLines | Where-Object {
        $_ -match '^\?\?\s+supabase/migrations/' -or
        $_ -match '^[ MARCUD?]{2}\s+supabase/migrations/'
      } | Where-Object {
        $_ -notmatch '20260711_01_solo_plus_activation_rpc\.sql'
      })
      if ($unexpected.Count -gt 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = 1; Stdout = ($unexpected -join [Environment]::NewLine); Stderr = 'Commit 11 must not add any migration file.' }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = 'No unexpected migration additions detected.'; Stderr = '' }
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
  (New-CommandCheck -Id 'APP-005' -Name 'Solo Plus case route test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-case-route.test.ts") -TimeoutSeconds 1200),
  (New-CommandCheck -Id 'APP-006' -Name 'Solo Plus evidence route test' -Phase 'B' -RootCauseCategory 'application-validation' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-Command',"Set-Location '$($script:RepoRoot)'; npx tsx tests/solo-plus-case-evidence-route.test.ts") -TimeoutSeconds 1200),
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
  (New-CallbackCheck -Id 'SQL-011' -Name 'Migration safety self-tests' -Phase 'F' -RootCauseCategory 'harness-safety' -CommandDisplay 'Run migration safety self-tests' -DependsOn @('ENV-006','ENV-009') -Callback {
      param($ctx)
      $result = Invoke-CapturedProcess -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File','.\\scripts\\test-breet-solo-plus-migrations.ps1','-RunSafetySelfTests','-PsqlPath',$resolvedPsqlForHarness) -WorkingDirectory $ctx.RepoRoot -TimeoutSeconds 1800
      if ($result.ExitCode -ne 0) {
        return [pscustomobject]@{ Status = 'FAIL'; ExitCode = $result.ExitCode; Stdout = $result.Stdout; Stderr = $result.Stderr }
      }
      return [pscustomobject]@{ Status = 'PASS'; ExitCode = 0; Stdout = $result.Stdout; Stderr = $result.Stderr }
    }),
  (New-CommandCheck -Id 'SQL-012' -Name 'Full hostile/default-grant harness' -Phase 'F' -RootCauseCategory 'hostile-harness' -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File','.\\scripts\\test-breet-solo-plus-migrations.ps1','-PsqlPath',$resolvedPsqlForHarness) -TimeoutSeconds 5400 -DependsOn @('ENV-006','ENV-009')),
  (New-CommandCheck -Id 'FINAL-001' -Name 'Final git status' -Phase 'G' -RootCauseCategory 'repository-state' -FilePath 'git' -Arguments @('status', '--short') -TimeoutSeconds 120),
  (New-CommandCheck -Id 'FINAL-002' -Name 'Final git diff --stat' -Phase 'G' -RootCauseCategory 'repository-state' -FilePath 'git' -Arguments @('diff', '--stat') -TimeoutSeconds 120),
  (New-CommandCheck -Id 'FINAL-003' -Name 'Final git diff --name-only' -Phase 'G' -RootCauseCategory 'repository-state' -FilePath 'git' -Arguments @('diff', '--name-only') -TimeoutSeconds 120)
)

foreach ($check in $checks) {
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
