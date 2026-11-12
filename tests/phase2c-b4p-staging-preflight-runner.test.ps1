Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$runnerPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\preflight-phase2c-b4p-staging.ps1'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($runnerPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'B4P_STAGING_PREFLIGHT_RUNNER_PARSE_FAILED' }
$source = Get-Content -Raw -LiteralPath $runnerPath
foreach ($needle in @("RUN PHASE2C B4P STAGING PREFLIGHT", "fsjljliiyfchkwbjifzw", "gznwibespgkwknnvbrlv", "aws-1-eu-central-2.pooler.supabase.com", "postgres.fsjljliiyfchkwbjifzw", "81369efc059e7fe7e0e96f5b36533738c9f7c31f", "12CDC46047AF9F39A02C9D4AF330256BCD8C48654101F49C5C9940D69BC036CF", "8DE0950018C308C7A8DF2D064D599E27A25408D47D0D072A9AF6ABDE939E370D", "6DE52A99C98C9DC5B20C64EABEC4A9BC9626D12638521F7D9B958827846A3EE2", "031_phase2c_draft_compliance_profile_provisioning_snapshot.sql")) {
  if ($source -notlike "*$needle*") { throw "B4P_STAGING_PREFLIGHT_RUNNER_REQUIRED_GATE_MISSING:$needle" }
}
foreach ($environmentName in @('PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGPASSFILE','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGSSLMODE','PGGSSENCMODE','PGCONNECT_TIMEOUT','PGTARGETSESSIONATTRS','PGREQUIREAUTH')) {
  if ($source -notlike "*'$environmentName'*") { throw "B4P_STAGING_PREFLIGHT_RUNNER_LIBPQ_ISOLATION_MISSING:$environmentName" }
}
foreach ($gate in @('fixed_staging_target_rejected','psql_15_required','m031_hash_mismatch','preflight_hash_mismatch','identity_probe_hash_mismatch','staging_identity_marker_invalid','repository_baseline_rejected','reviewed_runner_paths_not_tracked','reviewed_runner_commit_history_invalid','corrective_runner_commit_history_invalid','corrective_runner_commit_content_invalid','PROCESS_TERMINATION_UNCONFIRMED','OUTPUT_DRAIN_TIMEOUT')) {
  if ($source -notlike "*$gate*") { throw "B4P_STAGING_PREFLIGHT_RUNNER_FAILURE_GATE_MISSING:$gate" }
}
foreach ($forbidden in @("-f',`$M031Sql", "-f',`$IdentitySql,'-f',`$M031Sql", 'recover-draft-compliance-profile-staging', '031_phase2c_draft_compliance_profile_provisioning.sql'' )')) {
  if ($source -like "*$forbidden*") { throw "B4P_STAGING_PREFLIGHT_RUNNER_MUTATING_PATH_PRESENT:$forbidden" }
}
if (@([regex]::Matches($source, 'Invoke-StagingPsql\s+-Stage')).Count -ne 2) { throw 'B4P_STAGING_PREFLIGHT_RUNNER_SQL_SELECTION_COUNT_INVALID' }
if ($source -notmatch 'diff-tree --no-commit-id --name-status -r --no-renames' -or $source -match 'diff --name-only') { throw 'B4P_STAGING_PREFLIGHT_RUNNER_GIT_PLUMBING_INVALID' }
$preflightSql = Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'supabase\staging\preflight\031_phase2c_draft_compliance_profile_provisioning_snapshot.sql')
if ($preflightSql -notmatch '(?s)BEGIN TRANSACTION READ ONLY;.*ROLLBACK;' -or $preflightSql -match '(?im)^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b') { throw 'B4P_STAGING_PREFLIGHT_SQL_READONLY_CONTRACT_FAILED' }
foreach ($name in @('ConvertTo-StagingNativeArgument','ConvertTo-SanitizedDiagnostic','Stop-StagingProcessTree','Get-StagingTimeoutDisposition','Invoke-StagingNative','Invoke-StagingPsql','Assert-B4pStagingGitState','Get-B4pStagingGitState')) {
  $functionAst = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true) | Select-Object -First 1
  if ($null -eq $functionAst) { throw "B4P_STAGING_PREFLIGHT_RUNNER_FUNCTION_MISSING:$name" }
  Invoke-Expression $functionAst.Extent.Text
}
function Assert-Contains([string]$Value,[string]$Expected,[string]$Message) { if ($Value -notlike "*$Expected*") { throw $Message } }
function Assert-NotContains([string]$Value,[string]$Expected,[string]$Message) { if ($Value -like "*$Expected*") { throw $Message } }
function Assert-Throws([scriptblock]$Action,[string]$Expected,[string]$Message) {
  try { & $Action; throw 'B4P_STAGING_PREFLIGHT_EXPECTED_FAILURE_MISSING' } catch { Assert-Contains $_.Exception.Message $Expected $Message }
}

if ((ConvertTo-StagingNativeArgument 'space & "quoted" C:\tail\') -notmatch '^".*"$') { throw 'B4P_STAGING_PREFLIGHT_ARGUMENT_QUOTING_FAILED' }
$redacted = ConvertTo-SanitizedDiagnostic 'ERROR password=secret postgresql://u:secret@host/db token abc'
Assert-NotContains $redacted 'secret' 'B4P_STAGING_PREFLIGHT_REDACTION_FAILED'
Assert-NotContains $redacted 'abc' 'B4P_STAGING_PREFLIGHT_TOKEN_REDACTION_FAILED'

$ExpectedBranch = 'staging/phase-2-rebuild-safe-baseline'
$ExpectedStash = '81369efc059e7fe7e0e96f5b36533738c9f7c31f'
$ReviewedB4PBaseline = 'c55c4e392f6d3d676e8545f2a180968f41d009cb'
$ReviewedRunnerCommit = 'ef9ad01b98058ca713e7269fabe5d96c7bcd4aa3'
$ReviewedRunnerPaths = @('scripts/preflight-phase2c-b4p-staging.ps1','tests/phase2c-b4p-staging-preflight-runner.test.ps1')
$RepoRoot = Split-Path -Parent $PSScriptRoot
function New-GitState {
  param([hashtable]$Override = @{})
  $state = @{ Branch=$ExpectedBranch; BaselineIsAncestor=$true; HeadIsCommit=$true; HeadIsBaseline=$false; LocalHead='head'; RemoteHead='head'; Stash=$ExpectedStash; ParentCount=1; DirectParent=$ReviewedRunnerCommit; StagedPaths=@(); TrackedChanges=@(); UnexpectedUntracked=@(); TrackedPaths=@($ReviewedRunnerPaths); CommitChanges=@("M`t$($ReviewedRunnerPaths[0])", "M`t$($ReviewedRunnerPaths[1])"); ReviewedParentCount=1; ReviewedDirectParent=$ReviewedB4PBaseline; ReviewedCommitChanges=@("A`t$($ReviewedRunnerPaths[0])", "A`t$($ReviewedRunnerPaths[1])") }
  foreach ($key in $Override.Keys) { $state[$key] = $Override[$key] }
  return [pscustomobject]$state
}

# A reviewed commit is accepted; every unsafe Git state remains fail-closed.
Assert-B4pStagingGitState -State (New-GitState)
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ TrackedPaths=@(); UnexpectedUntracked=@('scripts/preflight-phase2c-b4p-staging.ps1','tests/phase2c-b4p-staging-preflight-runner.test.ps1') }) } 'repository_untracked_source_rejected' 'B4P_STAGING_PREFLIGHT_PRECOMMIT_UNTRACKED_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ RemoteHead='remote-other' }) } 'repository_baseline_rejected' 'B4P_STAGING_PREFLIGHT_UNPUSHED_COMMIT_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ TrackedChanges=@(' M package.json') }) } 'repository_tracked_changes_rejected' 'B4P_STAGING_PREFLIGHT_DIRTY_TRACKED_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ UnexpectedUntracked=@('notes.txt') }) } 'repository_untracked_source_rejected' 'B4P_STAGING_PREFLIGHT_UNEXPECTED_UNTRACKED_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ DirectParent='later-parent' }) } 'corrective_runner_commit_history_invalid' 'B4P_STAGING_PREFLIGHT_LATER_RUNNER_COMMIT_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ ParentCount=2 }) } 'corrective_runner_commit_history_invalid' 'B4P_STAGING_PREFLIGHT_MERGE_COMMIT_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ CommitChanges=@("R100`tlegacy.ps1`t$($ReviewedRunnerPaths[0])") }) } 'corrective_runner_commit_content_invalid' 'B4P_STAGING_PREFLIGHT_RENAME_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ CommitChanges=@("A`t$($ReviewedRunnerPaths[0])") }) } 'corrective_runner_commit_content_invalid' 'B4P_STAGING_PREFLIGHT_ADDITION_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ CommitChanges=@("M`tsrc/unreviewed.ts") }) } 'corrective_runner_commit_content_invalid' 'B4P_STAGING_PREFLIGHT_EXTRA_FILE_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ CommitChanges=@("M`t$($ReviewedRunnerPaths[0])") }) } 'corrective_runner_commit_content_invalid' 'B4P_STAGING_PREFLIGHT_RUNNER_ONLY_CORRECTIVE_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ CommitChanges=@("M`t$($ReviewedRunnerPaths[1])") }) } 'corrective_runner_commit_content_invalid' 'B4P_STAGING_PREFLIGHT_TEST_ONLY_CORRECTIVE_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ CommitChanges=@() }) } 'corrective_runner_commit_content_invalid' 'B4P_STAGING_PREFLIGHT_EMPTY_CORRECTIVE_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ CommitChanges=@("A`t$($ReviewedRunnerPaths[0])", "A`t$($ReviewedRunnerPaths[1])") }) } 'corrective_runner_commit_content_invalid' 'B4P_STAGING_PREFLIGHT_INCORRECT_STATUS_CORRECTIVE_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ CommitChanges=@("M`t$($ReviewedRunnerPaths[0])", "M`t$($ReviewedRunnerPaths[0])") }) } 'corrective_runner_commit_content_invalid' 'B4P_STAGING_PREFLIGHT_DUPLICATE_CORRECTIVE_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ ReviewedDirectParent='unreviewed-parent' }) } 'reviewed_runner_commit_history_invalid' 'B4P_STAGING_PREFLIGHT_REVIEWED_COMMIT_PARENT_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ Stash='other-stash' }) } 'repository_baseline_rejected' 'B4P_STAGING_PREFLIGHT_STASH_MISMATCH_NOT_REJECTED'
Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ TrackedPaths=@('scripts/preflight-phase2c-b4p-staging.ps1') }) } 'reviewed_runner_paths_not_tracked' 'B4P_STAGING_PREFLIGHT_RUNNER_TRACKING_NOT_REQUIRED'

# Exercise the exact Git plumbing against an isolated repository; no commit is
# created in the DeraLedger working tree.
$gitFixture = Join-Path ([IO.Path]::GetTempPath()) ('deraledger-b4p-git-fixture-' + [guid]::NewGuid().ToString('N'))
function Invoke-FixtureGit([string[]]$Arguments) {
  $output = @(& git -C $gitFixture @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "B4P_STAGING_PREFLIGHT_FIXTURE_GIT_FAILED:$($Arguments -join ' ')" }
  return $output
}
try {
  [void](New-Item -ItemType Directory -Path $gitFixture)
  [void](Invoke-FixtureGit @('init','-q'))
  [void](Invoke-FixtureGit @('config','user.email','fixture@example.invalid'))
  [void](Invoke-FixtureGit @('config','user.name','B4P Fixture'))
  [IO.Directory]::CreateDirectory((Join-Path $gitFixture 'legacy')) | Out-Null
  [IO.File]::WriteAllText((Join-Path $gitFixture 'legacy\baseline.txt'), 'baseline', [Text.UTF8Encoding]::new($false))
  [void](Invoke-FixtureGit @('add','.'))
  [void](Invoke-FixtureGit @('commit','-q','-m','baseline'))
  $fixtureBaseline = (@(Invoke-FixtureGit @('rev-parse','HEAD')) | Select-Object -First 1).Trim()
  [IO.Directory]::CreateDirectory((Join-Path $gitFixture 'scripts')) | Out-Null
  [IO.Directory]::CreateDirectory((Join-Path $gitFixture 'tests')) | Out-Null
  [IO.File]::WriteAllText((Join-Path $gitFixture 'scripts\preflight-phase2c-b4p-staging.ps1'), 'runner', [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $gitFixture 'tests\phase2c-b4p-staging-preflight-runner.test.ps1'), 'test', [Text.UTF8Encoding]::new($false))
  [void](Invoke-FixtureGit @('add','scripts/preflight-phase2c-b4p-staging.ps1','tests/phase2c-b4p-staging-preflight-runner.test.ps1'))
  [void](Invoke-FixtureGit @('commit','-q','-m','reviewed runner'))
  $fixtureHead = (@(Invoke-FixtureGit @('rev-parse','HEAD')) | Select-Object -First 1).Trim()
  $fixtureParentTokens = @((@(Invoke-FixtureGit @('rev-list','--parents','-n','1',$fixtureHead)) | Select-Object -First 1).Trim() -split '\s+')
  $fixtureChanges = @(Invoke-FixtureGit @('diff-tree','--no-commit-id','--name-status','-r','--no-renames',$fixtureHead))
  $savedFixtureBaseline = $ReviewedB4PBaseline
  $ReviewedB4PBaseline = $fixtureBaseline
  $ReviewedRunnerCommit = $fixtureHead
  Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ LocalHead=$fixtureHead; RemoteHead=$fixtureHead; DirectParent=$fixtureParentTokens[1]; CommitChanges=$fixtureChanges }) } 'corrective_runner_commit_history_invalid' 'B4P_STAGING_PREFLIGHT_MISSING_CORRECTIVE_COMMIT_NOT_REJECTED'
  [IO.File]::WriteAllText((Join-Path $gitFixture 'scripts\preflight-phase2c-b4p-staging.ps1'), 'corrected runner', [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $gitFixture 'tests\phase2c-b4p-staging-preflight-runner.test.ps1'), 'corrected test', [Text.UTF8Encoding]::new($false))
  [void](Invoke-FixtureGit @('add','scripts/preflight-phase2c-b4p-staging.ps1','tests/phase2c-b4p-staging-preflight-runner.test.ps1'))
  [void](Invoke-FixtureGit @('commit','-q','-m','correct runner'))
  $correctiveHead = (@(Invoke-FixtureGit @('rev-parse','HEAD')) | Select-Object -First 1).Trim()
  $correctiveParents = @((@(Invoke-FixtureGit @('rev-list','--parents','-n','1',$correctiveHead)) | Select-Object -First 1).Trim() -split '\s+')
  $correctiveChanges = @(Invoke-FixtureGit @('diff-tree','--no-commit-id','--name-status','-r','--no-renames',$correctiveHead))
  $reviewedParents = @((@(Invoke-FixtureGit @('rev-list','--parents','-n','1',$fixtureHead)) | Select-Object -First 1).Trim() -split '\s+')
  Assert-B4pStagingGitState -State (New-GitState @{ LocalHead=$correctiveHead; RemoteHead=$correctiveHead; DirectParent=$correctiveParents[1]; CommitChanges=$correctiveChanges; ReviewedDirectParent=$reviewedParents[1]; ReviewedCommitChanges=$fixtureChanges })
  [IO.File]::WriteAllText((Join-Path $gitFixture 'scripts\preflight-phase2c-b4p-staging.ps1'), 'unauthorized later change', [Text.UTF8Encoding]::new($false))
  [void](Invoke-FixtureGit @('add','scripts/preflight-phase2c-b4p-staging.ps1'))
  [void](Invoke-FixtureGit @('commit','-q','-m','unauthorized later change'))
  $laterHead = (@(Invoke-FixtureGit @('rev-parse','HEAD')) | Select-Object -First 1).Trim()
  $laterParents = @((@(Invoke-FixtureGit @('rev-list','--parents','-n','1',$laterHead)) | Select-Object -First 1).Trim() -split '\s+')
  $laterChanges = @(Invoke-FixtureGit @('diff-tree','--no-commit-id','--name-status','-r','--no-renames',$laterHead))
  Assert-Throws { Assert-B4pStagingGitState -State (New-GitState @{ LocalHead=$laterHead; RemoteHead=$laterHead; DirectParent=$laterParents[1]; CommitChanges=$laterChanges; ReviewedDirectParent=$reviewedParents[1]; ReviewedCommitChanges=$fixtureChanges }) } 'corrective_runner_commit_history_invalid' 'B4P_STAGING_PREFLIGHT_REAL_LATER_COMMIT_NOT_REJECTED'
  $ReviewedB4PBaseline = $savedFixtureBaseline
}

finally {
  $ReviewedB4PBaseline = 'c55c4e392f6d3d676e8545f2a180968f41d009cb'
  $ReviewedRunnerCommit = 'ef9ad01b98058ca713e7269fabe5d96c7bcd4aa3'
  if (Test-Path -LiteralPath $gitFixture) { Remove-Item -LiteralPath $gitFixture -Recurse -Force -ErrorAction SilentlyContinue }
}

# Reproduce the original StrictMode scalar failure, then exercise the actual
# corrected Git collector against this repository. Neither path opens psql.
$savedErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  $legacyCountProbe = @(& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "Set-StrictMode -Version Latest; `$parents = if (`$true) { @('only-parent') } else { @() }; `$null = `$parents.Count" 2>$null)
  $legacyCountProbeExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $savedErrorActionPreference
}
if ($legacyCountProbeExitCode -eq 0) { throw 'B4P_STAGING_PREFLIGHT_LEGACY_SCALAR_COUNT_FAILURE_NOT_REPRODUCED' }
$gitCollectorOutput = @(Get-B4pStagingGitState)
if ($gitCollectorOutput.Count -ne 1 -or $null -eq $gitCollectorOutput[0] -or $gitCollectorOutput[0].ParentCount -ne 1) { throw 'B4P_STAGING_PREFLIGHT_GIT_COLLECTOR_STRICTMODE_FAILED' }

if ((Get-StagingTimeoutDisposition -ProcessExited $true -ReadersCompleted $true) -cne 'PROCESS_TIMEOUT') { throw 'B4P_STAGING_PREFLIGHT_TIMEOUT_SUCCESSFUL_TERMINATION_INVALID' }
if ((Get-StagingTimeoutDisposition -ProcessExited $false -ReadersCompleted $false) -cne 'PROCESS_TERMINATION_UNCONFIRMED') { throw 'B4P_STAGING_PREFLIGHT_TIMEOUT_TERMINATION_FAILURE_INVALID' }
if ((Get-StagingTimeoutDisposition -ProcessExited $true -ReadersCompleted $false) -cne 'OUTPUT_DRAIN_TIMEOUT') { throw 'B4P_STAGING_PREFLIGHT_TIMEOUT_READER_FAILURE_INVALID' }
if ($source -match 'Task\]::WaitAll\([^\r\n]*\)\s*\r?\n' -and $source -notmatch 'Task\]::WaitAll\([^\r\n]*, 5000\)') { throw 'B4P_STAGING_PREFLIGHT_UNBOUNDED_WAITALL_PRESENT' }

$cmd = $env:ComSpec
if ([string]::IsNullOrWhiteSpace($cmd)) { throw 'B4P_STAGING_PREFLIGHT_CMD_MISSING' }
$ok = Invoke-StagingNative -FilePath $cmd -Arguments @('/d','/c','echo NOTICE 1>&2 & echo OK & exit /b 0') -Stage 'offline_ok' -TimeoutSeconds 10
Assert-Contains $ok.Stdout 'OK' 'B4P_STAGING_PREFLIGHT_STDOUT_FAILED'
Assert-Contains $ok.Stderr 'NOTICE' 'B4P_STAGING_PREFLIGHT_STDERR_FAILED'
foreach ($case in @(@('echo ERROR 1>&2 & exit /b 23','EXIT_CODE:23'), @('ping -n 4 127.0.0.1 >NUL & exit /b 0','STAGING_PREFLIGHT_NATIVE_FAILED'))) {
  try { [void](Invoke-StagingNative -FilePath $cmd -Arguments @('/d','/c',$case[0]) -Stage 'offline_failure' -TimeoutSeconds 1); throw 'B4P_STAGING_PREFLIGHT_EXPECTED_FAILURE_MISSING' } catch { Assert-Contains $_.Exception.Message $case[1] 'B4P_STAGING_PREFLIGHT_NATIVE_FAILURE_HANDLING_FAILED' }
}

if ($source -match 'ArgumentList|\.Environment\b|Invoke-Expression|cmd /c') { throw 'B4P_STAGING_PREFLIGHT_PS51_UNSAFE_API_PRESENT' }
Write-Output 'phase2c-b4p-staging-preflight-runner.test.ps1 passed'
