Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runnerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\rehearse-phase2c-b4p-local.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($runnerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
  throw 'B4P_NATIVE_PROCESS_TEST_RUNNER_PARSE_FAILED'
}

foreach ($name in @('ConvertTo-BoundedDiagnostic', 'ConvertTo-NativeArgument', 'Get-NativeFailureDiagnostic', 'Invoke-NativeChecked')) {
  $functionAst = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true) |
    Select-Object -First 1
  if ($null -eq $functionAst) {
    throw "B4P_NATIVE_PROCESS_TEST_FUNCTION_MISSING:$name"
  }
  Invoke-Expression $functionAst.Extent.Text
}

function Assert-Contains {
  param([string]$Value, [string]$Expected, [string]$Message)
  if ($Value -notlike "*$Expected*") { throw $Message }
}

function Assert-NotContains {
  param([string]$Value, [string]$Unexpected, [string]$Message)
  if ($Value -like "*$Unexpected*") { throw $Message }
}

$cmdPath = [Environment]::GetEnvironmentVariable('ComSpec')
if ([string]::IsNullOrWhiteSpace($cmdPath) -or -not (Test-Path -LiteralPath $cmdPath -PathType Leaf)) {
  throw 'B4P_NATIVE_PROCESS_TEST_CMD_MISSING'
}

# Stderr NOTICE with exit 0 must remain non-fatal and must not become result data.
$noticeResult = @(Invoke-NativeChecked -FilePath $cmdPath -Arguments @('/d', '/c', 'echo NOTICE: synthetic notice 1>&2 & exit /b 0'))
if ($noticeResult.Count -ne 0) {
  throw 'B4P_NATIVE_PROCESS_TEST_NOTICE_LEAKED_TO_STDOUT'
}

# The catalog diagnostic deliberately opts into stderr capture while preserving
# exit-code success semantics and keeping stdout distinct from NOTICE output.
$noticeCapture = Invoke-NativeChecked -IncludeStandardError -FilePath $cmdPath -Arguments @('/d', '/c', 'echo NOTICE: diagnostic notice 1>&2 & exit /b 0')
if (@($noticeCapture.StandardOutput).Count -ne 0) {
  throw 'B4P_NATIVE_PROCESS_TEST_CAPTURED_NOTICE_LEAKED_TO_STDOUT'
}
Assert-Contains -Value $noticeCapture.StandardError -Expected 'NOTICE: diagnostic notice' -Message 'B4P_NATIVE_PROCESS_TEST_CAPTURED_NOTICE_MISSING'

function Assert-NativeFailure {
  param([string]$Command, [int]$ExitCode, [string[]]$Expected, [string[]]$Unexpected)
  try {
    [void](Invoke-NativeChecked -FilePath $cmdPath -Arguments @('/d', '/c', $Command))
    throw 'B4P_NATIVE_PROCESS_TEST_EXPECTED_FAILURE_MISSING'
  }
  catch {
    $message = $_.Exception.Message
    Assert-Contains -Value $message -Expected "EXIT_CODE:$ExitCode" -Message 'B4P_NATIVE_PROCESS_TEST_EXIT_CODE_MISSING'
    foreach ($needle in $Expected) {
      Assert-Contains -Value $message -Expected $needle -Message "B4P_NATIVE_PROCESS_TEST_EXPECTED_DETAIL_MISSING:$needle"
    }
    foreach ($needle in $Unexpected) {
      Assert-NotContains -Value $message -Unexpected $needle -Message "B4P_NATIVE_PROCESS_TEST_UNEXPECTED_DETAIL_PRESENT:$needle"
    }
  }
}

Assert-NativeFailure -Command 'echo ERROR: 42P01: synthetic failure 1>&2 & echo LOCATION: synthetic.sql:11 1>&2 & exit /b 7' -ExitCode 7 -Expected @('ERROR: 42P01: synthetic failure', 'LOCATION: synthetic.sql:11') -Unexpected @()
Assert-NativeFailure -Command 'echo NOTICE: harmless preface 1>&2 & echo ERROR: 23505: synthetic duplicate 1>&2 & echo LOCATION: synthetic.sql:22 1>&2 & exit /b 8' -ExitCode 8 -Expected @('ERROR: 23505: synthetic duplicate', 'LOCATION: synthetic.sql:22') -Unexpected @('NOTICE: harmless preface')
Assert-NativeFailure -Command 'echo NOTICE: only visible native output 1>&2 & exit /b 9' -ExitCode 9 -Expected @('NOTICE: only visible native output') -Unexpected @()

$redacted = ConvertTo-BoundedDiagnostic -Detail 'ERROR: password=do-not-print postgresql://user:secret@host/db token abc123'
Assert-NotContains -Value $redacted -Unexpected 'do-not-print' -Message 'B4P_NATIVE_PROCESS_TEST_PASSWORD_REDACTION_FAILED'
Assert-NotContains -Value $redacted -Unexpected 'user:secret@host' -Message 'B4P_NATIVE_PROCESS_TEST_URI_REDACTION_FAILED'
Assert-NotContains -Value $redacted -Unexpected 'abc123' -Message 'B4P_NATIVE_PROCESS_TEST_TOKEN_REDACTION_FAILED'

Write-Output 'phase2c-b4p-native-process.test.ps1 passed'
