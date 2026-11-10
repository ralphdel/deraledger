[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^deraledger_phase2c_b4p_rehearsal_[a-z0-9_]+$')]
  [string]$LocalDatabase,

  [Parameter(Mandatory = $true)]
  [switch]$Execute,

  [Parameter(Mandatory = $true)]
  [ValidateSet('RUN_PHASE2C_B4P_LOCAL_REHEARSAL')]
  [string]$Confirmation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$approvedHost = '127.0.0.1'
$approvedPort = '55432'
$approvedUser = 'postgres'
$maintenanceDatabase = 'postgres'
$expectedBranch = 'staging/phase-2-rebuild-safe-baseline'
$expectedHead = '740ce99109b1254544d08da113b4e9c956337737'
$expectedStash = '81369efc059e7fe7e0e96f5b36533738c9f7c31f'
$repoRoot = Split-Path -Parent $PSScriptRoot
$psqlPath = Join-Path $env:ProgramFiles 'PostgreSQL\15\bin\psql.exe'
$createdbPath = Join-Path $env:ProgramFiles 'PostgreSQL\15\bin\createdb.exe'
$dropdbPath = Join-Path $env:ProgramFiles 'PostgreSQL\15\bin\dropdb.exe'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$bootstrapPath = Join-Path $repoRoot 'supabase\tests\phase2c_b4p_pre_m031_bootstrap.sql'
$verifyPath = Join-Path $repoRoot 'supabase\tests\phase2c_b4p_pre_m031_verify.sql'
$checkDiagnosticPath = Join-Path $repoRoot 'supabase\tests\phase2c_b4p_pre_m031_check_diagnostic.sql'
$m031Path = Join-Path $repoRoot 'supabase\migrations\20261023000000_phase2c_draft_compliance_profile_provisioning.sql'
$behaviorPath = Join-Path $repoRoot 'supabase\tests\phase2c_draft_compliance_profile_provisioning.sql'
$concurrencyRunner = Join-Path $repoRoot 'scripts\rehearse-phase2c-b4p-concurrency-local.ps1'

$sourcePins = [ordered]@{
  'supabase/staging/001_schema_only.sql' = '90EFD55F47664A8463AA453AAE90F7F32C06941A3A574AB4A6990D348107E4DB'
  'supabase/staging/002_onboarding_verification_upgrade_flow.sql' = '3B430EA1050D633EDE99A9CDF8AE62D63B45FE3126BB180C8038845650933431'
  'supabase/staging/004_phase1_plan_compatibility.sql' = 'E91C94C28E58E3F2B961AD8ECFCAE0B33CF2404B4F741A52C65E6D6DF81453E7'
  'supabase/staging/006_solo_plus_prerequisites.sql' = 'DF5C12E87C35E8B685E2C30C93AB5000C16DD4C613407794C3FA11BE1BE744BD'
  'supabase/staging/007_solo_plus_case_foundation.sql' = 'AC1DF3244FBEDC19BAD593515D30E150CCA7CE1A770FC99F825338CA9AAF295C'
  'supabase/migrations/20260728000000_authorization_hardening.sql' = '3EFB2B353A5EDCCC1854D5D6A03343296000B6C1D44307B200562C18DF298C7D'
  'supabase/migrations/20260818025000_paid_subscription_tables_prerequisite.sql' = 'A5BC25D7D72B5EB8C7FA3A015DAA9E39D3EC80FE4A4CC1D35DF93E375EEEEEA2'
  'supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql' = '8A42669B40AE29D1170DD09831F0B79E795052614FD874432E6077D1072816CF'
  'supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql' = 'E607CB2F1EF95FEAE26DFFA153D8206E2D63EFCCCF039026DF9CB48F2862D948'
  'supabase/migrations/20260825000000_reviewed_profile_approval_rpc.sql' = 'B8091BCD633E2F963211B27277DAC583EDD5D0064DA43A732C8E10C9BCA39BE0'
  'supabase/migrations/20260825010000_cleanup_approval_rpc_diagnostics.sql' = '89DF755AA7DBE06BD0F4C5C911367436157A0D9A5DDC9DF138DF323F40FB4F20'
  'supabase/migrations/20260825020000_canonical_approval_snapshot_idempotency.sql' = '1F5E63575B8FAAC42B56723019097B3FAFF56292DEED48D1D19F9D87F43E1830'
  'supabase/migrations/20260826_00_canonical_workspace_linkage.sql' = '3EC3DFA172F5EBC1C34903853FB9746EFB012731DED2CE3B344C7533951A34F9'
  'supabase/migrations/20260827_00_m028_m029_readiness_integration.sql' = '8759BED04E9F019762B69FDF25C155F9DEAAFF691D844DFCBBE69663F604D49B'
  'supabase/migrations/20261021000000_phase2c_nonadopted_review_substrate.sql' = '49FD3E667E464D18512C0EF48CC84D475525FB9E635793BD789C6B6326D1B528'
  'supabase/migrations/20261022000000_phase2c_nonadopted_review_triage_resubmission.sql' = '23F66A123C89CB2E2C6C2F7001FF83840538DEF9CCB0AAFDADC0BB755A12ADF2'
  'supabase/migrations/20261023000000_phase2c_draft_compliance_profile_provisioning.sql' = '12CDC46047AF9F39A02C9D4AF330256BCD8C48654101F49C5C9940D69BC036CF'
}

if (-not $Execute -or $Confirmation -ne 'RUN_PHASE2C_B4P_LOCAL_REHEARSAL') {
  throw 'B4P_LOCAL_REHEARSAL_CONFIRMATION_REQUIRED'
}
if ($LocalDatabase -in @('postgres','template0','template1')) {
  throw 'B4P_LOCAL_REHEARSAL_DATABASE_REJECTED'
}

foreach ($path in @($psqlPath,$createdbPath,$dropdbPath,$powershellPath,$bootstrapPath,$verifyPath,$checkDiagnosticPath,$m031Path,$behaviorPath,$concurrencyRunner)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "B4P_LOCAL_REHEARSAL_REQUIRED_FILE_MISSING:$path"
  }
}

function ConvertTo-BoundedDiagnostic {
  param(
    [AllowNull()][string]$Detail
  )

  if ([string]::IsNullOrWhiteSpace($Detail)) {
    return 'NO_NATIVE_DIAGNOSTIC_AVAILABLE'
  }

  $safe = $Detail -replace '[\r\n\t]+', ' ' -replace '\s+', ' '
  $safe = [regex]::Replace($safe, '(?i)\b(password|pwd)\s*=\s*(?:"[^"]*"|''[^'']*''|\S+)', '$1=<redacted>')
  $safe = [regex]::Replace($safe, '(?i)\bpostgres(?:ql)?://\S+', '<redacted-connection-string>')
  $safe = [regex]::Replace($safe, '(?i)\b(bearer|token|secret|api[_-]?key)\s+\S+', '$1 <redacted>')
  if ($safe.Length -gt 700) { $safe = $safe.Substring(0,700) }
  return $safe.Trim()
}

function ConvertTo-NativeArgument {
  param(
    [Parameter(Mandatory = $true)][string]$Value
  )

  if ($Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }

  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}

function Get-NativeFailureDiagnostic {
  param(
    [AllowNull()][string]$StandardError
  )

  $lines = @($StandardError -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $errorIndex = -1
  for ($index = 0; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index] -match '(?i)(?:^|:\s*)(?:ERROR|FATAL|PANIC):') {
      $errorIndex = $index
      break
    }
  }

  if ($errorIndex -ge 0) {
    $lastIndex = [Math]::Min($errorIndex + 4, $lines.Count - 1)
    return ConvertTo-BoundedDiagnostic -Detail (($lines[$errorIndex..$lastIndex]) -join ' ')
  }

  return ConvertTo-BoundedDiagnostic -Detail ($lines -join ' ')
}

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [switch]$IncludeStandardError
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument -Value $_ }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'B4P_LOCAL_REHEARSAL_COMMAND_START_FAILED'
  }

  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]@($stdoutTask, $stderrTask))
  $exitCode = $process.ExitCode
  $standardOutput = $stdoutTask.Result
  $standardError = $stderrTask.Result
  $process.Dispose()

  if ($exitCode -ne 0) {
    $safe = Get-NativeFailureDiagnostic -StandardError $standardError
    throw "B4P_LOCAL_REHEARSAL_COMMAND_FAILED:EXIT_CODE:$exitCode|DETAIL:$safe"
  }

  $outputLines = if ($standardOutput.Length -eq 0) { @() } else { @($standardOutput -split "\r?\n") }
  if ($IncludeStandardError) {
    return [pscustomobject]@{
      StandardOutput = $outputLines
      StandardError = $standardError
    }
  }
  return $outputLines
}

function Invoke-LocalPsql {
  param(
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string[]]$AdditionalArguments,
    [switch]$IncludeStandardError
  )
  $arguments = @(
    '-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
    '-h',$approvedHost,'-p',$approvedPort,'-U',$approvedUser,'-d',$Database
  ) + $AdditionalArguments
  if ($IncludeStandardError) {
    return Invoke-NativeChecked -FilePath $psqlPath -Arguments $arguments -IncludeStandardError
  }
  return Invoke-NativeChecked -FilePath $psqlPath -Arguments $arguments
}

function Invoke-PreM031CheckDiagnostic {
  param(
    [Parameter(Mandatory = $true)][string]$Database
  )

  # The SQL script is catalog-read-only and emits its bounded collect-all
  # report through PostgreSQL NOTICE messages. Capture stderr only here;
  # ordinary native calls retain their existing stdout-only contract.
  $result = Invoke-LocalPsql -Database $Database -IncludeStandardError -AdditionalArguments @(
    '-v','VERBOSITY=terse','-f',$checkDiagnosticPath
  )
  $markers = @($result.StandardError -split "\r?\n" | ForEach-Object {
    $line = ([string]$_).Trim()
    if ($line -match '(CHECK_RESULT\|.*|ACTUAL_DEFINITION\|.*|EXPECTED_PATTERN\|.*|NORMALIZED_ACTUAL\|.*|CHECK_DIAGNOSTIC\|.*)$') {
      $Matches[1]
    }
  } | Where-Object { $_ })

  $resultLines = @($markers | Where-Object { $_ -like 'CHECK_RESULT|*' })
  $actualLines = @($markers | Where-Object { $_ -like 'ACTUAL_DEFINITION|*' })
  $expectedLines = @($markers | Where-Object { $_ -like 'EXPECTED_PATTERN|*' })
  $normalizedLines = @($markers | Where-Object { $_ -like 'NORMALIZED_ACTUAL|*' })
  $summary = @($markers | Where-Object { $_ -like 'CHECK_DIAGNOSTIC|*' })
  if ($resultLines.Count -ne 29 -or $actualLines.Count -ne 29 -or $expectedLines.Count -ne 29 -or
    $normalizedLines.Count -ne 29 -or $summary -notcontains 'CHECK_DIAGNOSTIC|TOTAL=29' -or
    $summary.Count -ne 3) {
    throw 'B4P_LOCAL_REHEARSAL_CHECK_DIAGNOSTIC_INCOMPLETE'
  }
  foreach ($marker in $markers) {
    Write-Output $marker
  }
}

$pgEnvironmentNames = @(
  'PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGPASSFILE',
  'PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGCONNECT_TIMEOUT','PGSSLMODE'
)
$savedPgEnvironment = @{}
foreach ($name in $pgEnvironmentNames) {
  $entry = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue
  $savedPgEnvironment[$name] = if ($null -eq $entry) { $null } else { [string]$entry.Value }
  Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
}
$env:PGSSLMODE = 'disable'
$env:PGCONNECT_TIMEOUT = '10'

$databaseCreated = $false
$initialStatus = $null
$runPassed = $false
$PrimaryFailure = $null
$CleanupFailure = $null
$VerificationFailure = $null
$CheckDiagnosticFailure = $null
$CurrentStage = 'INITIALIZATION'
try {
  Push-Location $repoRoot
  try {
    $CurrentStage = 'GIT_BASELINE'
    if ((git branch --show-current).Trim() -ne $expectedBranch) { throw 'B4P_LOCAL_REHEARSAL_BRANCH_MISMATCH' }
    if ((git rev-parse HEAD).Trim() -ne $expectedHead) { throw 'B4P_LOCAL_REHEARSAL_HEAD_MISMATCH' }
    if ((git rev-parse "origin/$expectedBranch").Trim() -ne $expectedHead) { throw 'B4P_LOCAL_REHEARSAL_REMOTE_HEAD_MISMATCH' }
    if ((git rev-parse 'stash@{0}').Trim() -ne $expectedStash) { throw 'B4P_LOCAL_REHEARSAL_STASH_MISMATCH' }
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { throw 'B4P_LOCAL_REHEARSAL_STAGED_FILES_PRESENT' }
    $initialStatus = @((git status --porcelain=v1 --untracked-files=all)) -join "`n"

    $CurrentStage = 'SOURCE_PINS'
    foreach ($pin in $sourcePins.GetEnumerator()) {
      $absolutePath = Join-Path $repoRoot $pin.Key
      if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
        throw "B4P_LOCAL_REHEARSAL_PINNED_SOURCE_MISSING:$($pin.Key)"
      }
      $actual = (Get-FileHash -LiteralPath $absolutePath -Algorithm SHA256).Hash.ToUpperInvariant()
      if ($actual -ne $pin.Value) {
        throw "B4P_LOCAL_REHEARSAL_SOURCE_PIN_MISMATCH:$($pin.Key)"
      }
    }
    Write-Output 'PASS|SOURCE_PINS'

    $CurrentStage = 'MAINTENANCE_TARGET_IDENTITY'
    $identity = @(Invoke-LocalPsql -Database $maintenanceDatabase -AdditionalArguments @(
      '-c',"SELECT 'CONTROL|'||current_database()||'|'||session_user||'|'||current_user||'|'||current_setting('server_version_num')||'|'||host(inet_server_addr())||'|'||inet_server_port();"
    ) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
    if ($identity.Count -ne 1 -or $identity[0] -notmatch '^CONTROL\|postgres\|postgres\|postgres\|15[0-9]{4}\|127\.0\.0\.1\|55432$') {
      throw 'B4P_LOCAL_REHEARSAL_MAINTENANCE_TARGET_REJECTED'
    }
    Write-Output 'PASS|LOCAL_POSTGRES_IDENTITY'

    $CurrentStage = 'DATABASE_ABSENCE_PREFLIGHT'
    $escapedDatabase = $LocalDatabase.Replace("'","''")
    $existence = @(Invoke-LocalPsql -Database $maintenanceDatabase -AdditionalArguments @(
      '-c',"SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname='$escapedDatabase') THEN 'EXISTS' ELSE 'ABSENT' END;"
    ) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
    if ($existence.Count -ne 1 -or $existence[0] -ne 'ABSENT') {
      throw 'B4P_LOCAL_REHEARSAL_DATABASE_ALREADY_EXISTS'
    }

    $CurrentStage = 'DATABASE_CREATE'
    [void](Invoke-NativeChecked -FilePath $createdbPath -Arguments @(
      '-w','-h',$approvedHost,'-p',$approvedPort,'-U',$approvedUser,$LocalDatabase
    ))
    $databaseCreated = $true
    Write-Output 'PASS|DATABASE_CREATED'

    $CurrentStage = 'PRE_M031_BOOTSTRAP'
    $bootstrap = @(Invoke-LocalPsql -Database $LocalDatabase -AdditionalArguments @('-F','|','-f',$bootstrapPath))
    if (-not ($bootstrap -contains 'B4P_PRE_M031_BOOTSTRAP|PASS')) {
      throw 'B4P_LOCAL_REHEARSAL_BOOTSTRAP_FAILED'
    }
    $CurrentStage = 'PRE_M031_CATALOG_VERIFY'
    $postconditions = @(Invoke-LocalPsql -Database $LocalDatabase -AdditionalArguments @('-F','|','-f',$verifyPath))
    if (-not ($postconditions -contains 'PRE_M031_CATALOG_VERIFY|PASS')) {
      throw 'B4P_LOCAL_REHEARSAL_PRE_M031_VERIFY_FAILED'
    }
    Write-Output 'PASS|PRE_M031_SCHEMA'

    $CurrentStage = 'M031_APPLY'
    [void](Invoke-LocalPsql -Database $LocalDatabase -AdditionalArguments @('-f',$m031Path))
    Write-Output 'PASS|M031_APPLIED'

    $CurrentStage = 'M031_BEHAVIOR'
    $behavior = @(Invoke-LocalPsql -Database $LocalDatabase -AdditionalArguments @('-F','|','-f',$behaviorPath))
    if (-not ($behavior -contains 'M031_BEHAVIOR_REHEARSAL|PASS')) {
      throw 'B4P_LOCAL_REHEARSAL_BEHAVIOR_FAILED'
    }
    Write-Output 'M031_BEHAVIOR_REHEARSAL|PASS'

    $CurrentStage = 'M031_CONCURRENCY'
    $concurrency = @(Invoke-NativeChecked -FilePath $powershellPath -Arguments @(
      '-NoProfile','-ExecutionPolicy','Bypass','-File',$concurrencyRunner,
      '-LocalDatabase',$LocalDatabase,'-Execute','-Confirmation','RUN_PHASE2C_B4P_LOCAL_CONCURRENCY'
    ))
    if (-not ($concurrency -contains 'PHASE2C_B4P_CONCURRENCY_REHEARSAL=PASS')) {
      throw 'B4P_LOCAL_REHEARSAL_CONCURRENCY_FAILED'
    }
    Write-Output 'PHASE2C_B4P_CONCURRENCY_REHEARSAL=PASS'
    $runPassed = $true
  }
  finally {
    Pop-Location
  }
}
catch {
  $PrimaryDetail = ConvertTo-BoundedDiagnostic -Detail $_.Exception.Message
  $PrimaryFailure = "B4P_LOCAL_REHEARSAL_PRIMARY_FAILED:$CurrentStage|DETAIL:$PrimaryDetail"
  if ($CurrentStage -eq 'PRE_M031_CATALOG_VERIFY' -and $databaseCreated) {
    try {
      Invoke-PreM031CheckDiagnostic -Database $LocalDatabase
    }
    catch {
      $CheckDiagnosticFailure = 'B4P_LOCAL_REHEARSAL_CHECK_DIAGNOSTIC_FAILED'
    }
  }
}
finally {
  if ($databaseCreated) {
    try {
      $CurrentStage = 'DATABASE_CLEANUP'
      [void](Invoke-NativeChecked -FilePath $dropdbPath -Arguments @(
        '-w','--if-exists',"--maintenance-db=$maintenanceDatabase",
        '-h',$approvedHost,'-p',$approvedPort,'-U',$approvedUser,$LocalDatabase
      ))
      $absenceAfterDrop = @(Invoke-LocalPsql -Database $maintenanceDatabase -AdditionalArguments @(
        '-c',"SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname='$escapedDatabase') THEN 'EXISTS' ELSE 'ABSENT' END;"
      ) | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
      if ($absenceAfterDrop.Count -ne 1 -or $absenceAfterDrop[0] -ne 'ABSENT') {
        throw 'B4P_LOCAL_REHEARSAL_DATABASE_STILL_PRESENT'
      }
      Write-Output 'DATABASE_DROPPED|PASS'
    }
    catch {
      $CleanupFailure = 'B4P_LOCAL_REHEARSAL_DATABASE_DROP_OR_ABSENCE_VERIFY_FAILED'
    }
  }

  $finalLocationPushed = $false
  try {
    Push-Location $repoRoot
    $finalLocationPushed = $true
    if ((git branch --show-current).Trim() -ne $expectedBranch) { throw 'B4P_LOCAL_REHEARSAL_FINAL_BRANCH_MISMATCH' }
    if ((git rev-parse HEAD).Trim() -ne $expectedHead) { throw 'B4P_LOCAL_REHEARSAL_FINAL_HEAD_MISMATCH' }
    if ((git rev-parse "origin/$expectedBranch").Trim() -ne $expectedHead) { throw 'B4P_LOCAL_REHEARSAL_FINAL_REMOTE_HEAD_MISMATCH' }
    if ((git rev-parse 'stash@{0}').Trim() -ne $expectedStash) { throw 'B4P_LOCAL_REHEARSAL_STASH_CHANGED' }
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { throw 'B4P_LOCAL_REHEARSAL_FINAL_STAGED_FILES_PRESENT' }
    $finalStatus = @((git status --porcelain=v1 --untracked-files=all)) -join "`n"
    if ($null -eq $initialStatus -or $finalStatus -cne $initialStatus) {
      throw 'B4P_LOCAL_REHEARSAL_GIT_STATE_CHANGED'
    }
    Write-Output 'FINAL_GIT_STASH_VERIFY|PASS'
  }
  catch {
    $VerificationFailure = 'B4P_LOCAL_REHEARSAL_FINAL_GIT_STASH_VERIFY_FAILED'
  }
  finally {
    if ($finalLocationPushed) { Pop-Location }
  }

  try {
    foreach ($name in $pgEnvironmentNames) {
      Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
      if ($null -ne $savedPgEnvironment[$name]) {
        Set-Item -Path "Env:$name" -Value $savedPgEnvironment[$name]
      }
    }
  }
  catch {
    if ($null -eq $VerificationFailure) {
      $VerificationFailure = 'B4P_LOCAL_REHEARSAL_ENVIRONMENT_RESTORE_FAILED'
    }
    else {
      $VerificationFailure += ';B4P_LOCAL_REHEARSAL_ENVIRONMENT_RESTORE_FAILED'
    }
  }
}

if ($null -ne $PrimaryFailure) {
  Write-Output "PRIMARY_FAILURE|$PrimaryFailure"
}
if ($null -ne $CheckDiagnosticFailure) {
  Write-Output "CHECK_DIAGNOSTIC_FAILURE|$CheckDiagnosticFailure"
}
if ($null -ne $CleanupFailure) {
  Write-Output "CLEANUP_FAILURE|$CleanupFailure"
}
if ($null -ne $VerificationFailure) {
  Write-Output "FINAL_VERIFY_FAILURE|$VerificationFailure"
}

if ($null -ne $PrimaryFailure -or $null -ne $CleanupFailure -or $null -ne $VerificationFailure) {
  throw 'B4P_LOCAL_REHEARSAL_FAILED'
}

if (-not $runPassed) { throw 'B4P_LOCAL_REHEARSAL_FAILED' }
Write-Output 'PHASE2C_B4P_LOCAL_REHEARSAL=PASS'
