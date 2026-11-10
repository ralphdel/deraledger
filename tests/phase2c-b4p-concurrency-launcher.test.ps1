Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
  throw 'B4P_CONCURRENCY_LAUNCHER_TEST_REQUIRES_WINDOWS_POWERSHELL_5'
}

$runnerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\rehearse-phase2c-b4p-concurrency-local.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($runnerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'B4P_CONCURRENCY_LAUNCHER_TEST_PARSE_FAILED' }

foreach ($name in @('ConvertTo-B4pWindowsCommandLineArgument', 'Start-B4pNativeProcess', 'Stop-B4pProcessTree', 'Start-B4pPsql', 'Complete-B4pPsql')) {
  $functionAst = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true) |
    Select-Object -First 1
  if ($null -eq $functionAst) { throw "B4P_CONCURRENCY_LAUNCHER_TEST_FUNCTION_MISSING:$name" }
  Invoke-Expression $functionAst.Extent.Text
}

function Assert-Contains {
  param([string]$Value, [string]$Expected, [string]$Message)
  if ($Value -notlike "*$Expected*") { throw $Message }
}

# Exercise the actual optional binding boundary without launching psql. The
# generic native launcher below separately exercises process execution.
$script:psqlPath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$script:repoRoot = $PSScriptRoot
$script:approvedHost = '127.0.0.1'
$script:approvedPort = '55432'
$script:approvedUser = 'postgres'
$script:LocalDatabase = 'deraledger_phase2c_b4p_rehearsal_binding_test'
function Start-B4pNativeProcess {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [string[]]$RemoveEnvironmentVariables,
    [hashtable]$SetEnvironmentVariables
  )
  [pscustomobject]@{ FilePath = $FilePath; Arguments = @($Arguments); WorkingDirectory = $WorkingDirectory }
}

$zeroAdditional = Start-B4pPsql -AdditionalArguments @()
if ($zeroAdditional.Arguments -contains $null -or $zeroAdditional.Arguments -contains '') {
  throw 'B4P_CONCURRENCY_LAUNCHER_TEST_ZERO_ARGUMENTS_INTRODUCED_EMPTY_VALUE'
}
if ($zeroAdditional.Arguments[-1] -ne $script:LocalDatabase) {
  throw 'B4P_CONCURRENCY_LAUNCHER_TEST_ZERO_ARGUMENTS_DATABASE_MISSING'
}
$zeroDefault = Start-B4pPsql
if (($zeroDefault.Arguments -join "`0") -cne ($zeroAdditional.Arguments -join "`0")) {
  throw 'B4P_CONCURRENCY_LAUNCHER_TEST_ZERO_ARGUMENT_DEFAULT_DRIFT'
}
$oneAdditional = Start-B4pPsql -AdditionalArguments @('-c')
if ($oneAdditional.Arguments[-1] -ne '-c') {
  throw 'B4P_CONCURRENCY_LAUNCHER_TEST_ONE_ARGUMENT_NOT_PRESERVED'
}
$multipleAdditional = Start-B4pPsql -AdditionalArguments @('-v', 'worker=A', '-f', 'C:\temp path\worker.sql')
$multipleTail = @($multipleAdditional.Arguments | Select-Object -Last 4)
if ($multipleTail.Count -ne 4 -or ($multipleTail -join "`0") -cne (@('-v', 'worker=A', '-f', 'C:\temp path\worker.sql') -join "`0")) {
  throw 'B4P_CONCURRENCY_LAUNCHER_TEST_MULTIPLE_ARGUMENTS_NOT_PRESERVED'
}

# Restore the actual helper for native-process behavior checks below.
$startNativeAst = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-B4pNativeProcess' }, $true) |
  Select-Object -First 1
Invoke-Expression $startNativeAst.Extent.Text

$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) {
  throw 'B4P_CONCURRENCY_LAUNCHER_TEST_POWERSHELL_NOT_FOUND'
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('deraledger-b4p-launcher-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $tempRoot)
$fixturePath = Join-Path $tempRoot 'fixture.ps1'
[System.IO.File]::WriteAllText($fixturePath, @'
param([string]$Mode, [string]$Payload)
[Console]::Out.WriteLine("OUT|$Mode|$Payload")
[Console]::Error.WriteLine("ERR|$Mode|$Payload")
if ($Mode -eq 'fail') { exit 23 }
if ($Mode -eq 'sleep') { Start-Sleep -Seconds 10 }
'@, [System.Text.UTF8Encoding]::new($false))

try {
  $payload = 'space value & "quoted" C:\tail\'
  $handle = Start-B4pNativeProcess -FilePath $powerShellPath -Arguments @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $fixturePath, 'ok', $payload
  ) -WorkingDirectory $tempRoot
  $result = Complete-B4pPsql -Handle $handle -TimeoutMilliseconds 10000
  Assert-Contains -Value $result.Stdout -Expected "OUT|ok|$payload" -Message 'B4P_CONCURRENCY_LAUNCHER_TEST_ARGUMENT_PRESERVATION_FAILED'
  Assert-Contains -Value $result.Stderr -Expected "ERR|ok|$payload" -Message 'B4P_CONCURRENCY_LAUNCHER_TEST_STDERR_CAPTURE_FAILED'

  try {
    $failure = Start-B4pNativeProcess -FilePath $powerShellPath -Arguments @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $fixturePath, 'fail', 'nonzero'
    ) -WorkingDirectory $tempRoot
    [void](Complete-B4pPsql -Handle $failure -TimeoutMilliseconds 10000)
    throw 'B4P_CONCURRENCY_LAUNCHER_TEST_NONZERO_NOT_REPORTED'
  }
  catch {
    Assert-Contains -Value $_.Exception.Message -Expected 'EXIT_CODE:23' -Message 'B4P_CONCURRENCY_LAUNCHER_TEST_EXIT_CODE_MISSING'
  }

  try {
    $timeout = Start-B4pNativeProcess -FilePath $powerShellPath -Arguments @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $fixturePath, 'sleep', 'timeout'
    ) -WorkingDirectory $tempRoot
    [void](Complete-B4pPsql -Handle $timeout -TimeoutMilliseconds 250)
    throw 'B4P_CONCURRENCY_LAUNCHER_TEST_TIMEOUT_NOT_REPORTED'
  }
  catch {
    Assert-Contains -Value $_.Exception.Message -Expected 'B4P_LOCAL_REHEARSAL_PROCESS_TIMEOUT' -Message 'B4P_CONCURRENCY_LAUNCHER_TEST_TIMEOUT_MARKER_MISSING'
  }
}
finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'phase2c-b4p-concurrency-launcher.test.ps1 passed'
