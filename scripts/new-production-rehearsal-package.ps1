[CmdletBinding()]
param(
  [switch]$OfflineValidateOnly,
  [switch]$RunOfflineMutationTests,
  [switch]$GeneratePackage,
  [string]$Commit = "",
  [string]$RepoRoot = "",
  [string]$OutputRoot = $env:TEMP
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$SharedValidationPath = Join-Path $PSScriptRoot "production-rehearsal-validation.ps1"
. $SharedValidationPath

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
}

$MigrationPlan = @(
  @{ Number = "006"; Path = "supabase/staging/006_solo_plus_prerequisites.sql"; Strip = $false },
  @{ Number = "007"; Path = "supabase/staging/007_solo_plus_case_foundation.sql"; Strip = $false },
  @{ Number = "008"; Path = "supabase/staging/008_solo_plus_transactional_repository_rpcs.sql"; Strip = $false },
  @{ Number = "009"; Path = "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql"; Strip = $true },
  @{ Number = "010"; Path = "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql"; Strip = $true },
  @{ Number = "011"; Path = "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql"; Strip = $true },
  @{ Number = "012"; Path = "supabase/migrations/20260711_01_solo_plus_activation_rpc.sql"; Strip = $true },
  @{ Number = "013"; Path = "supabase/migrations/20260718_01_solo_plus_payment_recovery.sql"; Strip = $false },
  @{ Number = "014"; Path = "supabase/migrations/20260728_00_authorization_hardening.sql"; Strip = $true },
  @{ Number = "015"; Path = "supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql"; Strip = $false },
  @{ Number = "016"; Path = "supabase/migrations/20260731_00_verification_disclosure_identity_hardening.sql"; Strip = $true },
  @{ Number = "017"; Path = "supabase/migrations/20260803_00_payment_events_legacy_merchant_compatibility.sql"; Strip = $true }
)

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Replace-SinglePlaceholder {
  param([string]$Text, [string]$Placeholder, [string]$Replacement)
  $count = @([regex]::Matches($Text, [regex]::Escape($Placeholder))).Count
  Assert-True ($count -eq 1) "Expected exactly one placeholder $Placeholder; found $count"
  $index = $Text.IndexOf($Placeholder, [StringComparison]::Ordinal)
  return $Text.Substring(0, $index) + $Replacement + $Text.Substring($index + $Placeholder.Length)
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Get-BytesSha256Hex {
  param([byte[]]$Bytes)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "").ToUpperInvariant() }
  finally { $sha.Dispose() }
}

function Get-GitBlobBytes {
  param([string]$Commit, [string]$Path)
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = "git"
  $psi.WorkingDirectory = $RepoRoot
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = "cat-file blob $Commit`:$Path"
  $process = Invoke-ProcessStart $psi
  $memory = [System.IO.MemoryStream]::new()
  try {
    $process.StandardOutput.BaseStream.CopyTo($memory)
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "git cat-file failed for ${Path}: $stderr" }
    return $memory.ToArray()
  } finally {
    $memory.Dispose()
    $process.Dispose()
  }
}

function Split-ByteLines {
  param([byte[]]$Bytes)
  $lines = [System.Collections.Generic.List[byte[]]]::new()
  $start = 0
  for ($i = 0; $i -lt $Bytes.Length; $i++) {
    if ($Bytes[$i] -eq 10) {
      $length = $i - $start + 1
      $line = [byte[]]::new($length)
      [Array]::Copy($Bytes, $start, $line, 0, $length)
      $lines.Add($line)
      $start = $i + 1
    }
  }
  if ($start -lt $Bytes.Length) {
    $length = $Bytes.Length - $start
    $line = [byte[]]::new($length)
    [Array]::Copy($Bytes, $start, $line, 0, $length)
    $lines.Add($line)
  }
  return ,$lines.ToArray()
}

function Join-ByteLines {
  param($Lines)
  $memory = [System.IO.MemoryStream]::new()
  foreach ($line in $Lines) { $memory.Write($line, 0, $line.Length) }
  return $memory.ToArray()
}

function Get-ByteLineText {
  param([byte[]]$Line)
  return ([System.Text.Encoding]::UTF8.GetString($Line)).Trim()
}

function Remove-TopLevelTransactionEnvelopeBytes {
  param([byte[]]$Bytes, [string]$Path)
  $lines = @(Split-ByteLines $Bytes)
  $beginIndex = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $trimmed = Get-ByteLineText $lines[$i]
    if ($trimmed -match "^(?i)BEGIN\s*;\s*$") { $beginIndex = $i; break }
    if ($trimmed -ne "" -and -not $trimmed.StartsWith("--")) { throw "Unexpected content before BEGIN in $Path" }
  }
  $commitIndex = -1
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    $trimmed = Get-ByteLineText $lines[$i]
    if ($trimmed -match "^(?i)COMMIT\s*;\s*$") { $commitIndex = $i; break }
    if ($trimmed -ne "" -and -not $trimmed.StartsWith("--")) { throw "Unexpected content after COMMIT in $Path" }
  }
  if ($beginIndex -lt 0 -or $commitIndex -lt 0) { throw "Unable to strip transaction envelope in $Path" }
  $kept = [System.Collections.Generic.List[byte[]]]::new()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($i -ne $beginIndex -and $i -ne $commitIndex) { $kept.Add($lines[$i]) }
  }
  return Join-ByteLines $kept
}

function Write-Utf8NoBom {
  param([string]$Path, [string]$Value)
  $encoding = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Get-WrapperBodyHashForFile {
  param([string]$Path)
  $text = Get-Content -Raw -LiteralPath $Path
  $text = [regex]::Replace($text, "(?m)^(\`$ExpectedWrapperHash = ')[^']+(')", '$1__WRAPPER_SHA256__$2')
  $text = [regex]::Replace($text, "(?m)^(\`$ExpectedWrapperBodyHash = ')[^']+(')", '$1__WRAPPER_BODY_SHA256__$2')
  $text = [regex]::Replace($text, "(?m)^(\`$ExpectedManifestHash = ')[^']+(')", '$1__MANIFEST_SHA256__$2')
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToUpperInvariant() }
  finally { $sha.Dispose() }
}

function Get-WrapperTemplate {
@'
[CmdletBinding()]
param(
  [switch]$OfflineValidateOnly,
  [string]$OfflineMutationCase = "",
  [switch]$ExecuteRehearsal,
  [string]$ConfirmationToken = "",
  [string]$DatabaseUrl = "",
  [string]$PsqlPath = "",
  [string]$PgDumpPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# BEGIN EMBEDDED CANONICAL REHEARSAL HELPER
__SHARED_VALIDATION_HELPERS__
# END EMBEDDED CANONICAL REHEARSAL HELPER

$RepoRoot = "__REPO_ROOT__"
$ExpectedBranch = "__BRANCH__"
$ExpectedCommit = "__COMMIT__"
$ShortCommit = "__SHORT_COMMIT__"
$ArtifactIdentity = "__ARTIFACT_IDENTITY__"
$ExpectedToken = "__CONFIRMATION_TOKEN__"
$ManifestPath = "__MANIFEST_PATH__"
$RunnerPath = "__RUNNER_PATH__"
$TokenFilePath = "__TOKEN_FILE_PATH__"
$ExpectedManifestHash = "__MANIFEST_SHA256__"
$ExpectedRunnerHash = "__RUNNER_SHA256__"
$ExpectedTokenFileHash = "__TOKEN_FILE_SHA256__"
$ExpectedWrapperHash = "__WRAPPER_SHA256__"
$ExpectedWrapperBodyHash = "__WRAPPER_BODY_SHA256__"
$ExpectedCanonicalHelperHash = "__CANONICAL_HELPER_SHA256__"
$ExpectedEmbeddedHelperHash = "__EMBEDDED_HELPER_SHA256__"
$ExpectedMigrationOrder = @("__MIGRATION_ORDER__")
$ExpectedMigrationHashes = @{
__MIGRATION_HASH_TABLE__
}
$StaleCommitNamespaces = @("2d0cfee4","beecef35","752c41b","88845a2","cbec7fd")
$PgEnvNames = @("PGSSLMODE","PGGSSENCMODE","PGPASSFILE","PGPASSWORD","PGHOST","PGPORT","PGUSER","PGDATABASE","PGCONNECT_TIMEOUT","PGAPPNAME","PGSERVICE","PGSERVICEFILE")
$EvidencePrefix = "commit16-$ShortCommit"
$script:PgPassFileToDelete = $null
$script:ControlSqlFileToDelete = $null

$selectedModes = @($OfflineValidateOnly, $ExecuteRehearsal) | Where-Object { $_ }
if (@($selectedModes).Count -ne 1) { throw "Choose exactly one mode: -OfflineValidateOnly or -ExecuteRehearsal" }
if ($OfflineValidateOnly) { Invoke-OfflineValidation; return }
Invoke-Rehearsal
'@
}

function Test-WrapperTemplateStaticContract {
  $template = Get-WrapperTemplate
  $helper = Get-Content -Raw -LiteralPath $SharedValidationPath
  $helperTokens=$null;$helperErrors=$null
  $helperAst=[Management.Automation.Language.Parser]::ParseInput($helper,[ref]$helperTokens,[ref]$helperErrors)
  Assert-True (@($helperErrors).Count -eq 0) "canonical helper has AST errors"
  $runtimeFunctions=@($helperAst.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$true)|ForEach-Object {$_.Name})
  Assert-True (@($runtimeFunctions|Group-Object|Where-Object Count -ne 1).Count -eq 0) "canonical helper contains duplicate functions"
  foreach ($functionName in $runtimeFunctions) {
    $functionPattern = "(?m)^function\s+" + [regex]::Escape($functionName) + "(?=\s|\{|\()"
    $helperCount = @([regex]::Matches($helper, $functionPattern)).Count
    Assert-True ($helperCount -eq 1) "canonical helper must define $functionName exactly once"
    Assert-True ($template -notmatch $functionPattern) "wrapper template duplicates runtime function $functionName"
  }
  $contractText = Replace-SinglePlaceholder $template "__SHARED_VALIDATION_HELPERS__" $helper
  foreach ($needle in @(
    "OfflineValidateOnly",
    "ExecuteRehearsal",
    "ExpectedWrapperBodyHash",
    "Get-WrapperBodyHash",
    "Assert-GitState",
    "diff`",`"--cached`",`"--name-only",
    "diff`",`"--name-only",
    "Assert-RunnerContract",
    "Convert-ControlRow",
    "Assert-ControlAccepted",
    "New-ControlSql",
    "Read-Host `"Database password`" -AsSecureString",
    "New-TemporaryPgPassFile",
    "PGPASSFILE",
    "PGPASSWORD`", `$null",
    "PGSSLMODE`", `"require",
    "PGGSSENCMODE`", `"disable",
    "Invoke-NativeChecked",
    "ReadToEndAsync",
    "taskkill.exe /PID",
    "finally",
    "Restore-Environment",
    "ROLLBACK COMMAND COMPLETED",
    "ALL MIGRATIONS EXECUTED INSIDE OUTER TRANSACTION",
    "rollback_sensitive_fingerprint",
    "schema-only",
    "Get-ControlRequiredKeys"
  )) {
    Assert-True ($contractText.Contains($needle)) "embedded wrapper contract missing required text: $needle"
  }
  Assert-True ($template -notmatch "2d0cfee4-production-rehearsal|beecef35-production-rehearsal|752c41b-production-rehearsal") "wrapper template contains stale artifact namespace"
  Assert-True ($contractText -notmatch 'SkipEmbeddedContract') "wrapper contract contains an artifact-integrity bypass"
}

function New-TestArtifactSet {
  param([string]$Root)
  $canonicalHelperText = (Get-Content -Raw -LiteralPath $SharedValidationPath).Trim("`r", "`n")
  $canonicalHelperHash = Get-BytesSha256Hex ([Text.Encoding]::UTF8.GetBytes($canonicalHelperText))
  $bundle = Join-Path $Root "deraledger-production-rehearsal-abcdef1-test"
  New-Item -ItemType Directory -Path $bundle -Force | Out-Null
  $migrationRows = @()
  $hashTableLines = @()
  foreach ($migration in $MigrationPlan) {
    $name = "{0}_{1}" -f $migration.Number, (Split-Path -Leaf $migration.Path)
    if ($migration.Number -in @("006","007","008")) { $name = Split-Path -Leaf $migration.Path }
    $path = Join-Path $bundle $name
    Set-Content -LiteralPath $path -Value "-- $($migration.Number)`nSELECT '$($migration.Number)';" -Encoding ASCII
    $hash = Get-Sha256Hex $path
    $migrationRows += "$($migration.Number)|$($migration.Path)|$path|stripped=$($migration.Strip)|source_sha256=$hash|generated_sha256=$hash"
    $hashTableLines += "  '$path' = '$hash'"
  }
  $runner = Join-Path $bundle "abcdef1-production-rollback-only-rehearsal.sql"
  $runnerLines = [System.Collections.Generic.List[string]]::new()
  $runnerLines.Add("\set ON_ERROR_STOP on")
  $runnerLines.Add("BEGIN;")
  $runnerLines.Add("SET LOCAL lock_timeout = '10s';")
  foreach ($migration in $MigrationPlan) {
    $file = ($migrationRows | Where-Object { $_ -like "$($migration.Number)|*" }) -split "\|" | Select-Object -Index 2
    $include = ($file -replace "\\","/")
    $runnerLines.Add("\echo RUNNING MIGRATION $($migration.Number) $($migration.Path)")
    $runnerLines.Add("\i '$include'")
    $runnerLines.Add("\echo PASSED MIGRATION $($migration.Number) $($migration.Path)")
  }
  $runnerLines.Add("\echo ALL MIGRATIONS EXECUTED INSIDE OUTER TRANSACTION")
  $runnerLines.Add("ROLLBACK;")
  $runnerLines.Add("\echo ROLLBACK COMMAND COMPLETED")
  Set-Content -LiteralPath $runner -Value $runnerLines -Encoding ASCII
  $tokenFile = Join-Path $bundle "abcdef1-production-rehearsal-confirmation-token.txt"
  Set-Content -LiteralPath $tokenFile -Value "CONFIRM-abcdef1-test" -Encoding ASCII
  $manifest = Join-Path $Root "abcdef1-production-rehearsal-bundle-manifest.txt"
  $wrapper = Join-Path $Root "abcdef1-production-rollback-only-rehearsal.ps1"
  $manifestLines = @(
    "COMMIT=abcdef1234567890abcdef1234567890abcdef12",
    "SHORT=abcdef1",
    "ARTIFACT_IDENTITY=deraledger-production-rehearsal-abcdef1-test",
    "GENERATED_AT_UTC=2026-08-05T00:00:00Z",
    "TIMESTAMP_IS_SOURCE_FRESHNESS_PROOF=false",
    "BUNDLE=$bundle",
    "RUNNER=$runner",
    "RUNNER_SHA256=$(Get-Sha256Hex $runner)",
    "WRAPPER=$wrapper",
    "WRAPPER_SHA256=__WRAPPER_SHA256_PENDING__",
    "WRAPPER_INTEGRITY_MECHANISM=normalized_wrapper_body_sha256",
    "WRAPPER_BODY_SHA256=__WRAPPER_BODY_SHA256_PENDING__",
    "TOKEN_FILE=$tokenFile",
    "TOKEN_FILE_SHA256=$(Get-Sha256Hex $tokenFile)",
    "CANONICAL_HELPER_SOURCE_PATH=$SharedValidationPath",
    "CANONICAL_HELPER_SHA256=$canonicalHelperHash",
    "EMBEDDED_HELPER_SHA256=$canonicalHelperHash",
    "EMBEDDED_HELPER_START_MARKER=# BEGIN EMBEDDED CANONICAL REHEARSAL HELPER",
    "EMBEDDED_HELPER_END_MARKER=# END EMBEDDED CANONICAL REHEARSAL HELPER",
    "HELPER_ENCODING=UTF-8-no-BOM",
    "HELPER_NEWLINE_POLICY=preserve-canonical-normalize-boundary-newlines",
    "STALE_ARTIFACT_EXCLUSIONS=2d0cfee4,beecef35,752c41b",
    "MIGRATIONS="
  ) + $migrationRows
  Set-Content -LiteralPath $manifest -Value $manifestLines -Encoding ASCII
  [pscustomobject]@{ Bundle = $bundle; Runner = $runner; Manifest = $manifest; Wrapper = $wrapper; TokenFile = $tokenFile; HashLines = ($hashTableLines -join "`n") }
}

function Expand-WrapperTemplate {
  param($Artifacts, [string]$WrapperPath)
  $manifestHash = Get-Sha256Hex $Artifacts.Manifest
  $runnerHash = Get-Sha256Hex $Artifacts.Runner
  $tokenHash = Get-Sha256Hex $Artifacts.TokenFile
  $order = (($MigrationPlan | ForEach-Object { Split-Path -Leaf $_.Path }) -join '","')
  $text = Get-WrapperTemplate
  $sharedHelperText = Get-Content -Raw -LiteralPath $SharedValidationPath
  $text = Replace-SinglePlaceholder $text "__SHARED_VALIDATION_HELPERS__" $sharedHelperText
  $helperHash = Get-BytesSha256Hex ([Text.Encoding]::UTF8.GetBytes($sharedHelperText.Trim("`r", "`n")))
  $text = $text.Replace("__CANONICAL_HELPER_SHA256__", $helperHash)
  $text = $text.Replace("__EMBEDDED_HELPER_SHA256__", $helperHash)
  $text = $text.Replace("__REPO_ROOT__", $RepoRoot)
  $text = $text.Replace("__BRANCH__", "fix/payment-events-legacy-merchant-compatibility")
  $text = $text.Replace("__COMMIT__", "abcdef1234567890abcdef1234567890abcdef12")
  $text = $text.Replace("__SHORT_COMMIT__", "abcdef1")
  $text = $text.Replace("__ARTIFACT_IDENTITY__", "deraledger-production-rehearsal-abcdef1-test")
  $text = $text.Replace("__CONFIRMATION_TOKEN__", "CONFIRM-abcdef1-test")
  $text = $text.Replace("__MANIFEST_PATH__", $Artifacts.Manifest)
  $text = $text.Replace("__RUNNER_PATH__", $Artifacts.Runner)
  $text = $text.Replace("__TOKEN_FILE_PATH__", $Artifacts.TokenFile)
  $text = $text.Replace("__MANIFEST_SHA256__", $manifestHash)
  $text = $text.Replace("__RUNNER_SHA256__", $runnerHash)
  $text = $text.Replace("__TOKEN_FILE_SHA256__", $tokenHash)
  $text = $text.Replace("__MIGRATION_ORDER__", $order)
  $text = $text.Replace("__MIGRATION_HASH_TABLE__", $Artifacts.HashLines)
  Write-Utf8NoBom $WrapperPath $text
  $bodyHash = Get-WrapperBodyHashForFile $WrapperPath
  $manifestText = Get-Content -Raw -LiteralPath $Artifacts.Manifest
  $manifestText = $manifestText.Replace("__WRAPPER_SHA256_PENDING__",$bodyHash).Replace("__WRAPPER_BODY_SHA256_PENDING__",$bodyHash)
  Set-Content -LiteralPath $Artifacts.Manifest -Value $manifestText -Encoding ASCII
  $finalManifestHash = Get-Sha256Hex $Artifacts.Manifest
  $current = Get-Content -Raw -LiteralPath $WrapperPath
  $current = [regex]::Replace($current, "(?m)^\`$ExpectedManifestHash = '[^']+'", "`$ExpectedManifestHash = '$finalManifestHash'")
  $current = [regex]::Replace($current, "(?m)^\`$ExpectedWrapperHash = '[^']+'", "`$ExpectedWrapperHash = '$bodyHash'")
  $current = [regex]::Replace($current, "(?m)^\`$ExpectedWrapperBodyHash = '[^']+'", "`$ExpectedWrapperBodyHash = '$bodyHash'")
  Write-Utf8NoBom $WrapperPath $current
  Assert-True ((Get-WrapperBodyHashForFile $WrapperPath) -eq $bodyHash) "wrapper body hash did not stabilize"
}

function New-TestArtifactDescriptor {
  param($Artifacts, [string]$WrapperPath)
  $canonicalHelper = (Get-Content -Raw -LiteralPath $SharedValidationPath).Trim("`r","`n")
  $helperHash = Get-BytesSha256Hex ([Text.Encoding]::UTF8.GetBytes($canonicalHelper))
  $manifest = Parse-Manifest $Artifacts.Manifest
  $migrationPaths = @($manifest.Migrations | ForEach-Object { ($_ -split '\|')[2] })
  $migrationHashes = @{}
  foreach ($path in $migrationPaths) { $migrationHashes[$path] = Get-Sha256Hex $path }
  [pscustomobject]@{
    FullCommit='abcdef1234567890abcdef1234567890abcdef12'; ShortCommit='abcdef1'
    Namespace='deraledger-production-rehearsal-abcdef1-test'; Bundle=$Artifacts.Bundle
    WrapperPath=$WrapperPath; ManifestPath=$Artifacts.Manifest; RunnerPath=$Artifacts.Runner; TokenPath=$Artifacts.TokenFile
    MigrationPaths=$migrationPaths; RunnerHash=Get-Sha256Hex $Artifacts.Runner; ManifestHash=Get-Sha256Hex $Artifacts.Manifest
    TokenHash=Get-Sha256Hex $Artifacts.TokenFile; MigrationHashes=$migrationHashes
    CanonicalHelperHash=$helperHash; EmbeddedHelperHash=$helperHash
    WrapperHash=$manifest.Fields['WRAPPER_SHA256']; WrapperBodyHash=$manifest.Fields['WRAPPER_BODY_SHA256']
    ExpectedMigrationOrder=@($MigrationPlan | ForEach-Object { Split-Path -Leaf $_.Path })
    HelperStartMarker='# BEGIN EMBEDDED CANONICAL REHEARSAL HELPER'; HelperEndMarker='# END EMBEDDED CANONICAL REHEARSAL HELPER'
    StaleNamespaces=@('2d0cfee4','beecef35','752c41b')
  }
}

function New-ArchitectureBoundaryCounts {
  [pscustomobject]@{
    ArtifactProvider=0; GitStateProvider=0; CredentialProvider=0; ExecutableResolver=0; PsqlResolver=0; PgDumpResolver=0
    ProcessAdapter=0; FileSystemAdapter=0; PackageGenerationBoundary=0; SqlExecutionBoundary=0
  }
}

function Copy-ArchitectureBoundaryCounts($Counts) {
  [pscustomobject]@{
    ArtifactProvider=$Counts.ArtifactProvider; GitStateProvider=$Counts.GitStateProvider
    CredentialProvider=$Counts.CredentialProvider; ExecutableResolver=$Counts.ExecutableResolver
    PsqlResolver=$Counts.PsqlResolver; PgDumpResolver=$Counts.PgDumpResolver
    ProcessAdapter=$Counts.ProcessAdapter; FileSystemAdapter=$Counts.FileSystemAdapter
    PackageGenerationBoundary=$Counts.PackageGenerationBoundary; SqlExecutionBoundary=$Counts.SqlExecutionBoundary
  }
}

function New-ArchitectureTestContext {
  param($Descriptor, $Counts, $GitState, $ProcessResult, [switch]$FailRemove, [switch]$AllowCredential, [switch]$UseRealProcess)
  $artifactProvider = { [void]($Counts.ArtifactProvider++); return $Descriptor }.GetNewClosure()
  $gitProvider = { [void]($Counts.GitStateProvider++); return $GitState }.GetNewClosure()
  $credentialProvider = { [void]($Counts.CredentialProvider++);if(-not $AllowCredential){throw 'FORBIDDEN_CREDENTIAL_PROVIDER'};ConvertTo-SecureString 'offline-fake-secret' -AsPlainText -Force }.GetNewClosure()
  $executableResolver = {
    param($path)
    [void]($Counts.ExecutableResolver++)
    if ($path -match '(?i)psql') { [void]($Counts.PsqlResolver++) }
    if ($path -match '(?i)pg_dump') { [void]($Counts.PgDumpResolver++) }
    throw "FORBIDDEN_EXECUTABLE_RESOLUTION:$path"
  }.GetNewClosure()
  if ($UseRealProcess) {
    $processAdapter = {
      param($request)
      [void]($Counts.ProcessAdapter++)
      Invoke-NativeChecked $request.FilePath $request.Arguments $request.StdoutPath $request.StderrPath $request.TimeoutSeconds $request.SensitiveValues
    }.GetNewClosure()
  } else {
    $processAdapter = { param($request) [void]($Counts.ProcessAdapter++);if($request.FilePath -match '(?i)(^|\\)(psql|pg_dump)\.exe$'){throw 'FORBIDDEN_REAL_DATABASE_PROCESS'};return $ProcessResult.PSObject.Copy() }.GetNewClosure()
  }
  $packageBoundary = { [void]($Counts.PackageGenerationBoundary++); throw 'FORBIDDEN_PACKAGE_GENERATION' }.GetNewClosure()
  $sqlBoundary = { param($context,$request) [void]($Counts.SqlExecutionBoundary++); & $context.ProcessAdapter $request }.GetNewClosure()
  $fileSystem = [pscustomobject]@{
    Exists={param($path)[void]($Counts.FileSystemAdapter++);Test-Path -LiteralPath $path}.GetNewClosure()
    ReadText={param($path)[void]($Counts.FileSystemAdapter++);Get-Content -Raw -LiteralPath $path}.GetNewClosure()
    ReadBytes={param($path)[void]($Counts.FileSystemAdapter++);[IO.File]::ReadAllBytes($path)}.GetNewClosure()
    Hash={param($path)[void]($Counts.FileSystemAdapter++);(Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToUpperInvariant()}.GetNewClosure()
    Remove={param($path)[void]($Counts.FileSystemAdapter++);if($FailRemove){throw 'INJECTED_REMOVE_FAILURE'};Remove-Item -LiteralPath $path -Force}.GetNewClosure()
    WriteText={param($path,$value)[void]($Counts.FileSystemAdapter++);$encoding=[Text.UTF8Encoding]::new($false);[IO.File]::WriteAllText($path,[string]$value,$encoding)}.GetNewClosure()
    WriteBytes={param($path,$value)[void]($Counts.FileSystemAdapter++);[IO.File]::WriteAllBytes($path,$value)}.GetNewClosure()
    IsContained={param($root,$path)[void]($Counts.FileSystemAdapter++);([IO.Path]::GetFullPath($path)).StartsWith(([IO.Path]::GetFullPath($root).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)}.GetNewClosure()
  }
  New-RehearsalRuntimeContext -ArtifactProvider $artifactProvider -GitStateProvider $gitProvider `
    -CredentialProvider $credentialProvider -ExecutableResolver $executableResolver -ProcessAdapter $processAdapter `
    -FileSystemAdapter $fileSystem -PackageGenerationBoundary $packageBoundary -SqlExecutionBoundary $sqlBoundary
}

function New-OfflineValidationFixture {
  param([string]$Root)
  $artifacts=New-TestArtifactSet $Root
  Expand-WrapperTemplate -Artifacts $artifacts -WrapperPath $artifacts.Wrapper
  $descriptor=New-TestArtifactDescriptor $artifacts $artifacts.Wrapper
  $counts=New-ArchitectureBoundaryCounts
  $gitState=[pscustomobject]@{Branch='fix/payment-events-legacy-merchant-compatibility';Head=$descriptor.FullCommit;Staged=@();Modified=@()}
  $processResult=[pscustomobject]@{ExitCode=0;TimedOut=$false;Stdout='offline';Stderr='';DurationMs=0;ProcessTreeTerminated=$false;Disposed=$true}
  $context=New-ArchitectureTestContext $descriptor $counts $gitState $processResult
  [pscustomobject]@{Artifacts=$artifacts;Wrapper=$artifacts.Wrapper;Descriptor=$descriptor;Counts=$counts;Context=$context}
}

function Invoke-GeneratorOfflineValidation {
  $root=Join-Path ([IO.Path]::GetTempPath()) ('deraledger-offline-validation-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  try {
    $fixture=New-OfflineValidationFixture $root
    $script:OfflineMutationCase=''
    Invoke-OfflineValidation $fixture.Context | Out-Null
    $proof=[ordered]@{
      CredentialProvider=$fixture.Counts.CredentialProvider; PsqlResolver=$fixture.Counts.PsqlResolver
      PgDumpResolver=$fixture.Counts.PgDumpResolver; ProcessAdapter=$fixture.Counts.ProcessAdapter
      PackageGenerationBoundary=$fixture.Counts.PackageGenerationBoundary; SqlExecutionBoundary=$fixture.Counts.SqlExecutionBoundary
    }
    foreach($value in $proof.Values){Assert-True ($value -eq 0) 'OFFLINE_FORBIDDEN_BOUNDARY_INVOKED'}
    Write-Output ('OFFLINE_BOUNDARIES|'+($proof|ConvertTo-Json -Compress))
    Write-Output 'Generator OfflineValidateOnly: PASS'
  } finally {
    if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue}
  }
}

function Add-ArchitectureCaseEvidence {
  param(
    [Collections.Generic.List[object]]$Evidence, [string]$CaseId, [string]$Category,
    [string]$ProductionFunction, [string]$ExpectedOutcome, [string]$ExpectedError,
    $Counts, [scriptblock]$Body, [string]$CleanupResult='not-required'
  )
  Assert-True (@($Evidence | Where-Object { $_.case_id -eq $CaseId }).Count -eq 0) "duplicate architecture case: $CaseId"
  $observedOutcome='pass'; $observedError=''
  try { & $Body } catch { $observedOutcome='fail'; $observedError=$_.Exception.Message }
  Assert-True ($observedOutcome -eq $ExpectedOutcome) "architecture case outcome mismatch: $CaseId expected=$ExpectedOutcome observed=$observedOutcome error=$observedError"
  Assert-True ($observedError -eq $ExpectedError) "architecture case classification mismatch: $CaseId expected=$ExpectedError observed=$observedError"
  Assert-True (-not [string]::IsNullOrWhiteSpace($ProductionFunction)) "architecture production-function evidence missing: $CaseId"
  $item=[pscustomobject]@{
    case_id=$CaseId; category=$Category; setup_executed=$true; production_function_invoked=$ProductionFunction
    expected_outcome=$ExpectedOutcome; observed_outcome=$observedOutcome
    expected_error_classification=$ExpectedError; observed_error_classification=$observedError
    boundary_invocation_counts=(Copy-ArchitectureBoundaryCounts $Counts); cleanup_result=$CleanupResult
  }
  $Evidence.Add($item)
  Write-Host ('CASE|'+($item|ConvertTo-Json -Compress -Depth 5))
}

function Run-AuthenticArchitectureProofCases {
  param($Artifacts, [string]$WrapperPath, [string]$TemporaryRoot)
  Assert-True (-not ([IO.Path]::GetFullPath($TemporaryRoot)).StartsWith(([IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')+'\'),[StringComparison]::OrdinalIgnoreCase)) 'architecture temporary files must remain outside the repository'
  $script:PgEnvNames=@("PGSSLMODE","PGGSSENCMODE","PGPASSFILE","PGPASSWORD","PGHOST","PGPORT","PGUSER","PGDATABASE","PGCONNECT_TIMEOUT","PGAPPNAME","PGSERVICE","PGSERVICEFILE")
  $evidence = [Collections.Generic.List[object]]::new()
  $descriptor=New-TestArtifactDescriptor $Artifacts $WrapperPath
  $validGit=[pscustomobject]@{Branch='fix/payment-events-legacy-merchant-compatibility';Head=$descriptor.FullCommit;Staged=@();Modified=@()}
  $successProcess=[pscustomobject]@{ExitCode=0;TimedOut=$false;Stdout='ok';Stderr='';DurationMs=1;ProcessTreeTerminated=$false}

  $counts=New-ArchitectureBoundaryCounts; $context=New-ArchitectureTestContext $descriptor $counts $validGit $successProcess
  Add-ArchitectureCaseEvidence $evidence 'ARCH-ARTIFACT-VALID' 'artifact' 'Assert-ArtifactIntegrity' 'pass' '' $counts {Assert-ArtifactIntegrity $context}
  $runnerBytes=[IO.File]::ReadAllBytes($Artifacts.Runner)
  try { Add-Content -LiteralPath $Artifacts.Runner -Value '-- runner hash mutation'; $counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $descriptor $counts $validGit $successProcess; Add-ArchitectureCaseEvidence $evidence 'ARCH-ARTIFACT-RUNNER-HASH-MISMATCH' 'artifact' 'Assert-ArtifactIntegrity' 'fail' 'ARTIFACT_RUNNER_HASH_MISMATCH' $counts {Assert-ArtifactIntegrity $context} }
  finally {[IO.File]::WriteAllBytes($Artifacts.Runner,$runnerBytes)}
  $wrapperBytes=[IO.File]::ReadAllBytes($WrapperPath)
  try { $mutated=(Get-Content -Raw -LiteralPath $WrapperPath).Replace('"DatabaseUrl is required"','"DatabaseUrl is required!"');Write-Utf8NoBom $WrapperPath $mutated;$counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $descriptor $counts $validGit $successProcess;Add-ArchitectureCaseEvidence $evidence 'ARCH-ARTIFACT-HELPER-HASH-MISMATCH' 'artifact' 'Assert-ArtifactIntegrity' 'fail' 'ARTIFACT_HELPER_BODY_HASH_MISMATCH' $counts {Assert-ArtifactIntegrity $context} }
  finally {[IO.File]::WriteAllBytes($WrapperPath,$wrapperBytes)}
  $escaped=$descriptor.PSObject.Copy();$escaped.RunnerPath=$SharedValidationPath;$counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $escaped $counts $validGit $successProcess
  Add-ArchitectureCaseEvidence $evidence 'ARCH-ARTIFACT-NAMESPACE-MISMATCH' 'artifact' 'Assert-ArtifactIntegrity' 'fail' 'ARTIFACT_NAMESPACE_MISMATCH' $counts {Assert-ArtifactIntegrity $context}

  $script:ExpectedBranch=$validGit.Branch;$script:ExpectedCommit=$validGit.Head
  foreach($gitCase in @(
    @{Id='ARCH-GIT-VALID';State=$validGit;Outcome='pass';Error=''},
    @{Id='ARCH-GIT-WRONG-BRANCH';State=[pscustomobject]@{Branch='wrong';Head=$validGit.Head;Staged=@();Modified=@()};Outcome='fail';Error='branch mismatch'},
    @{Id='ARCH-GIT-STAGED';State=[pscustomobject]@{Branch=$validGit.Branch;Head=$validGit.Head;Staged=@('x');Modified=@()};Outcome='fail';Error='staged files present'},
    @{Id='ARCH-GIT-DIRTY';State=[pscustomobject]@{Branch=$validGit.Branch;Head=$validGit.Head;Staged=@();Modified=@('x')};Outcome='fail';Error='tracked worktree modifications present'}
  )){$counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $descriptor $counts $gitCase.State $successProcess;Add-ArchitectureCaseEvidence $evidence $gitCase.Id 'git' 'Assert-GitState' $gitCase.Outcome $gitCase.Error $counts {Assert-GitState $context}}

  $sample="CONTROL|database_matches=true|server_major=17|tls_active=true|transaction_read_only=on|payment_events_present=true|payment_events_merchant_id_uuid=true|payment_events_merchant_id_nullable=true|payment_events_processor_compatible=true|payment_events_processed_at_compatible=true|invoice_fk_classification=canonical_set_null|merchant_fk_classification=canonical_cascade|platform_settings_present=true|plan_migration_solo_lite_enabled=false|solo_plus_enabled=false|solo_plus_kyc_enabled=false|conflicting_rehearsal_session_count=0|conflicting_lock_count=0|prepared_transaction_count=0|rollback_sensitive_fingerprint=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  $counts=New-ArchitectureBoundaryCounts;Add-ArchitectureCaseEvidence $evidence 'ARCH-CONTROL-VALID' 'control' 'Convert-ControlRow/Assert-ControlAccepted' 'pass' '' $counts {$map=Convert-ControlRow $sample;Assert-ControlAccepted $map}
  $counts=New-ArchitectureBoundaryCounts;Add-ArchitectureCaseEvidence $evidence 'ARCH-CONTROL-DATABASE-MISMATCH' 'control' 'Convert-ControlRow/Assert-ControlAccepted' 'fail' 'CONTROL database identity mismatch' $counts {$map=Convert-ControlRow ($sample.Replace('database_matches=true','database_matches=false'));Assert-ControlAccepted $map}
  $counts=New-ArchitectureBoundaryCounts;Add-ArchitectureCaseEvidence $evidence 'ARCH-CONTROL-PROTECTED-FLAG-TRUE' 'control' 'Convert-ControlRow/Assert-ControlAccepted' 'fail' 'Protected feature flag changed: solo_plus_enabled' $counts {$map=Convert-ControlRow ($sample.Replace('solo_plus_enabled=false','solo_plus_enabled=true'));Assert-ControlAccepted $map}
  $counts=New-ArchitectureBoundaryCounts;Add-ArchitectureCaseEvidence $evidence 'ARCH-CONTROL-FINGERPRINT-MISMATCH' 'control' 'Assert-ControlProofEqual' 'fail' 'CONTROL proof mismatch: rollback_sensitive_fingerprint' $counts {$before=Convert-ControlRow $sample;$after=Convert-ControlRow ($sample.Replace('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'));Assert-ControlProofEqual $before $after}

  $script:OfflineMutationCase=''
  foreach($offline in @(
    @{Id='ARCH-OFFLINE-NO-CREDENTIAL-PROMPT';Boundary='CredentialProvider'},@{Id='ARCH-OFFLINE-NO-PSQL-RESOLUTION';Boundary='PsqlResolver'},
    @{Id='ARCH-OFFLINE-NO-PGDUMP-RESOLUTION';Boundary='PgDumpResolver'},@{Id='ARCH-OFFLINE-NO-REAL-PROCESS-START';Boundary='ProcessAdapter'},
    @{Id='ARCH-OFFLINE-NO-PACKAGE-GENERATION';Boundary='PackageGenerationBoundary'},@{Id='ARCH-OFFLINE-NO-SQL-EXECUTION';Boundary='SqlExecutionBoundary'}
  )){$counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $descriptor $counts $validGit $successProcess;$boundary=$offline.Boundary;Add-ArchitectureCaseEvidence $evidence $offline.Id 'offline-boundary' 'Invoke-OfflineValidation' 'pass' '' $counts {Invoke-OfflineValidation $context|Out-Null;Assert-Condition ($counts.$boundary -eq 0) "FORBIDDEN_BOUNDARY_INVOKED:$boundary"}}

  $powerShellExe=(Get-Process -Id $PID).Path
  $largeScript=Join-Path $TemporaryRoot 'native-large.ps1'
  Write-Utf8NoBom $largeScript "`$chunk='x'*4096;1..32|ForEach-Object{[Console]::Out.Write(`$chunk);[Console]::Error.Write(`$chunk)}"
  $counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $descriptor $counts $validGit $successProcess -UseRealProcess
  Add-ArchitectureCaseEvidence $evidence 'ARCH-PROCESS-LARGE-OUTPUT' 'process' 'Invoke-RehearsalProcess/Invoke-NativeChecked' 'pass' '' $counts {
    $r=Invoke-RehearsalProcess $context $powerShellExe @('-NoProfile','-File',$largeScript) (Join-Path $TemporaryRoot 'large.out') (Join-Path $TemporaryRoot 'large.err') 15
    Assert-RehearsalProcessResult $r 'large-output';Assert-Condition ($r.Stdout.Length -ge 131072 -and $r.Stderr.Length -ge 131072) 'LARGE_OUTPUT_TRUNCATED';Assert-Condition $r.Disposed 'PROCESS_NOT_DISPOSED'
  }

  $sleeperScript=Join-Path $TemporaryRoot 'native-sleeper.ps1';Write-Utf8NoBom $sleeperScript 'Start-Sleep -Seconds 30'
  $timeoutScript=Join-Path $TemporaryRoot 'native-timeout.ps1'
  Write-Utf8NoBom $timeoutScript "param([string]`$PowerShellPath,[string]`$SleeperPath,[string]`$PidPath);`$child=Start-Process -FilePath `$PowerShellPath -ArgumentList @('-NoProfile','-File',`$SleeperPath) -WindowStyle Hidden -PassThru;[IO.File]::WriteAllText(`$PidPath,[string]`$child.Id);Start-Sleep -Seconds 30"
  $descendantPidPath=Join-Path $TemporaryRoot 'native-descendant.pid'
  $counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $descriptor $counts $validGit $successProcess -UseRealProcess
  Add-ArchitectureCaseEvidence $evidence 'ARCH-PROCESS-TIMEOUT' 'process' 'Invoke-RehearsalProcess/Invoke-NativeChecked' 'fail' 'PROCESS_TIMEOUT:timeout' $counts {
    $r=Invoke-RehearsalProcess $context $powerShellExe @('-NoProfile','-File',$timeoutScript,$powerShellExe,$sleeperScript,$descendantPidPath) (Join-Path $TemporaryRoot 'timeout.out') (Join-Path $TemporaryRoot 'timeout.err') 2
    Assert-Condition $r.ProcessTreeTerminated 'PROCESS_TREE_NOT_TERMINATED';Assert-Condition $r.Disposed 'PROCESS_NOT_DISPOSED'
    Assert-Condition (Test-Path -LiteralPath $descendantPidPath) 'DESCENDANT_PID_NOT_CAPTURED'
    $descendantPid=[int](Get-Content -Raw -LiteralPath $descendantPidPath)
    for($poll=0;$poll -lt 50;$poll++){
      $parentAlive=$null -ne (Get-Process -Id $r.ProcessId -ErrorAction SilentlyContinue)
      $descendantAlive=$null -ne (Get-Process -Id $descendantPid -ErrorAction SilentlyContinue)
      if(-not $parentAlive -and -not $descendantAlive){break}
      Start-Sleep -Milliseconds 100
    }
    $parentAlive=$null -ne (Get-Process -Id $r.ProcessId -ErrorAction SilentlyContinue)
    $descendantAlive=$null -ne (Get-Process -Id $descendantPid -ErrorAction SilentlyContinue)
    if($parentAlive){Stop-Process -Id $r.ProcessId -Force -ErrorAction SilentlyContinue}
    if($descendantAlive){Stop-Process -Id $descendantPid -Force -ErrorAction SilentlyContinue}
    Assert-Condition (-not $parentAlive) 'TIMED_OUT_PARENT_SURVIVED'
    Assert-Condition (-not $descendantAlive) 'TIMED_OUT_DESCENDANT_SURVIVED'
    Assert-RehearsalProcessResult $r 'timeout'
  }

  $nonzeroScript=Join-Path $TemporaryRoot 'native-nonzero.ps1';Write-Utf8NoBom $nonzeroScript "[Console]::Error.Write('deterministic failure');exit 9"
  $counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $descriptor $counts $validGit $successProcess -UseRealProcess
  Add-ArchitectureCaseEvidence $evidence 'ARCH-PROCESS-NONZERO-EXIT' 'process' 'Invoke-RehearsalProcess/Invoke-NativeChecked' 'fail' 'PROCESS_NONZERO_EXIT:nonzero:9' $counts {
    $r=Invoke-RehearsalProcess $context $powerShellExe @('-NoProfile','-File',$nonzeroScript) (Join-Path $TemporaryRoot 'nonzero.out') (Join-Path $TemporaryRoot 'nonzero.err') 15
    Assert-Condition $r.Disposed 'PROCESS_NOT_DISPOSED';Assert-RehearsalProcessResult $r 'nonzero'
  }

  $redactScript=Join-Path $TemporaryRoot 'native-redact.ps1';Write-Utf8NoBom $redactScript "param([string]`$Value);[Console]::Out.Write('value='+`$Value);[Console]::Error.Write(`$Value)"
  $testSecret='offline-process-secret'
  $counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $descriptor $counts $validGit $successProcess -UseRealProcess
  Add-ArchitectureCaseEvidence $evidence 'ARCH-PROCESS-REDACTION' 'process' 'Invoke-RehearsalProcess/Invoke-NativeChecked' 'pass' '' $counts {
    $out=Join-Path $TemporaryRoot 'redact.out';$err=Join-Path $TemporaryRoot 'redact.err';$r=Invoke-RehearsalProcess $context $powerShellExe @('-NoProfile','-File',$redactScript,$testSecret) $out $err 15 @($testSecret)
    Assert-Condition ($r.Stdout -notmatch [regex]::Escape($testSecret) -and $r.Stderr -notmatch [regex]::Escape($testSecret) -and (Get-Content -Raw -LiteralPath $out) -notmatch [regex]::Escape($testSecret) -and (Get-Content -Raw -LiteralPath $err) -notmatch [regex]::Escape($testSecret)) 'PROCESS_REDACTION_FAILED'
    Assert-Condition ($r.Stdout -match '\[REDACTED\]' -and $r.Stderr -match '\[REDACTED\]' -and $r.Disposed) 'PROCESS_REDACTION_OR_DISPOSAL_PROOF_MISSING'
  }

  $originalPgHost=[Environment]::GetEnvironmentVariable('PGHOST','Process')
  foreach($life in @(
    @{Id='ARCH-CLEANUP-SUCCESS';Mode='success';Outcome='pass';Error=''},@{Id='ARCH-CLEANUP-FAILURE';Mode='cleanup-failure';Outcome='fail';Error='CLEANUP_FAILED: INJECTED_REMOVE_FAILURE'},
    @{Id='ARCH-CLEANUP-TIMEOUT';Mode='timeout';Outcome='fail';Error='PROCESS_TIMEOUT:cleanup'},@{Id='ARCH-EVIDENCE-BEFORE-CLEANUP';Mode='evidence';Outcome='pass';Error=''},
    @{Id='ARCH-ENVIRONMENT-RESTORE-SUCCESS';Mode='env-success';Outcome='pass';Error=''},@{Id='ARCH-ENVIRONMENT-RESTORE-FAILURE';Mode='env-failure';Outcome='fail';Error='INJECTED_BODY_FAILURE'}
  )){
    $cleanupPath=Join-Path $TemporaryRoot ($life.Id+'.tmp');Write-Utf8NoBom $cleanupPath 'temporary';$evidencePath=Join-Path $TemporaryRoot ($life.Id+'.evidence')
    $counts=New-ArchitectureBoundaryCounts;$context=New-ArchitectureTestContext $descriptor $counts $validGit $successProcess -FailRemove:($life.Mode -eq 'cleanup-failure');$snapshot=Get-EnvironmentSnapshot
    $lifecycleBody={if($life.Mode -like 'env-*'){[Environment]::SetEnvironmentVariable('PGHOST','mutated.invalid','Process')};if($life.Mode -eq 'timeout'){throw 'PROCESS_TIMEOUT:cleanup'};if($life.Mode -eq 'env-failure'){throw 'INJECTED_BODY_FAILURE'}}.GetNewClosure()
    $cleanupProvider={@($cleanupPath)}.GetNewClosure();$persist={if($life.Mode -eq 'evidence'){if(-not (Test-Path -LiteralPath $cleanupPath)){throw 'EVIDENCE_NOT_BEFORE_CLEANUP'}; & $context.FileSystemAdapter.WriteText $evidencePath 'sanitized evidence'}}.GetNewClosure()
    $caseBody={try{Invoke-RehearsalLifecycle $context $lifecycleBody $cleanupProvider $persist $snapshot}finally{if($life.Mode -like 'env-*'){Assert-Condition ([Environment]::GetEnvironmentVariable('PGHOST','Process') -eq $originalPgHost) 'ENVIRONMENT_RESTORE_FAILED'}}}
    $cleanupResult=if($life.Mode -eq 'cleanup-failure'){'failed-closed'}else{'verified'}
    Add-ArchitectureCaseEvidence $evidence $life.Id 'lifecycle' 'Invoke-RehearsalLifecycle' $life.Outcome $life.Error $counts $caseBody $cleanupResult
    if($life.Mode -eq 'evidence'){Assert-True (Test-Path -LiteralPath $evidencePath) 'evidence was not persisted'}
    if($life.Mode -eq 'cleanup-failure'){Assert-True (Test-Path -LiteralPath $cleanupPath) 'cleanup failure did not preserve the failed target for inspection'}else{Assert-True (-not (Test-Path -LiteralPath $cleanupPath)) "cleanup did not remove temporary path: $($life.Id)"}
    if(Test-Path -LiteralPath $cleanupPath){Remove-Item -LiteralPath $cleanupPath -Force}
  }
  [Environment]::SetEnvironmentVariable('PGHOST',$originalPgHost,'Process')

  $declaredIds=@(
    'ARCH-ARTIFACT-VALID','ARCH-ARTIFACT-RUNNER-HASH-MISMATCH','ARCH-ARTIFACT-HELPER-HASH-MISMATCH','ARCH-ARTIFACT-NAMESPACE-MISMATCH',
    'ARCH-GIT-VALID','ARCH-GIT-WRONG-BRANCH','ARCH-GIT-STAGED','ARCH-GIT-DIRTY','ARCH-CONTROL-VALID','ARCH-CONTROL-DATABASE-MISMATCH','ARCH-CONTROL-PROTECTED-FLAG-TRUE','ARCH-CONTROL-FINGERPRINT-MISMATCH',
    'ARCH-OFFLINE-NO-CREDENTIAL-PROMPT','ARCH-OFFLINE-NO-PSQL-RESOLUTION','ARCH-OFFLINE-NO-PGDUMP-RESOLUTION','ARCH-OFFLINE-NO-REAL-PROCESS-START','ARCH-OFFLINE-NO-PACKAGE-GENERATION','ARCH-OFFLINE-NO-SQL-EXECUTION',
    'ARCH-PROCESS-LARGE-OUTPUT','ARCH-PROCESS-TIMEOUT','ARCH-PROCESS-NONZERO-EXIT','ARCH-PROCESS-REDACTION','ARCH-CLEANUP-SUCCESS','ARCH-CLEANUP-FAILURE','ARCH-CLEANUP-TIMEOUT','ARCH-EVIDENCE-BEFORE-CLEANUP','ARCH-ENVIRONMENT-RESTORE-SUCCESS','ARCH-ENVIRONMENT-RESTORE-FAILURE'
  )
  Assert-True ($evidence.Count -eq $declaredIds.Count) 'architecture declared/executed count mismatch'
  foreach($id in $declaredIds){Assert-True (@($evidence|Where-Object case_id -eq $id).Count -eq 1) "architecture case cardinality invalid: $id"}
  $script:LastArchitectureEvidence=@($evidence)
  return $evidence.Count
}

function Test-PgPassRawBytes {
  $secret='offline-pgpass-secret'
  $secure=ConvertTo-SecureString $secret -AsPlainText -Force
  $context=New-ProductionRehearsalRuntimeContext
  $path=$null
  try {
    $path=New-TemporaryPgPassFile 'db.example.invalid' '5432' 'ledger' 'service-user' $secure $context
    $bytes=[IO.File]::ReadAllBytes($path)
    $expected=[Text.UTF8Encoding]::new($false).GetBytes('db.example.invalid:5432:ledger:service-user:'+ $secret)
    Assert-True ($bytes.Length -eq $expected.Length) 'PGPASS_BYTE_LENGTH_MISMATCH'
    Assert-True (-not ($bytes.Length -ge 3 -and $bytes[0]-eq 0xEF -and $bytes[1]-eq 0xBB -and $bytes[2]-eq 0xBF)) 'PGPASS_UTF8_BOM_PRESENT'
    Assert-True ([Linq.Enumerable]::SequenceEqual([byte[]]$bytes,[byte[]]$expected)) 'PGPASS_RAW_BYTES_MISMATCH'
    Assert-True ([Text.Encoding]::UTF8.GetString($bytes).StartsWith('db.example.invalid:5432:')) 'PGPASS_HOST_PREFIX_MISMATCH'
  } finally {
    if($null -ne $path -and (Test-Path -LiteralPath $path)){Remove-Item -LiteralPath $path -Force}
    Assert-True ($null -eq $path -or -not (Test-Path -LiteralPath $path)) 'PGPASS_CLEANUP_FAILED'
    $secret=$null
  }
  Write-Host ('PGPASS|'+([ordered]@{utf8_no_bom=$true;exact_bytes=$true;hostname_prefix=$true;credential_in_evidence=$false;cleanup='verified'}|ConvertTo-Json -Compress))
  return 'PGPASS-RAW-BYTES'
}

function Get-FunctionSourceMap {
  param([string]$Path)
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile($Path,[ref]$tokens,[ref]$errors)
  Assert-True (@($errors).Count -eq 0) "function parity source has AST errors: $Path"
  $map=@{}
  foreach($function in @($ast.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst]},$true))){
    Assert-True (-not $map.ContainsKey($function.Name)) "duplicate function in parity source: $($function.Name)"
    $map[$function.Name]=($function.Extent.Text -replace "`r`n","`n").Trim()
  }
  return $map
}

function Invoke-FunctionParityClassification {
  param([string[]]$ExecutedProofIds)
  $baseline='C:\tmp\deraledger-pre-extraction-baseline-1EB42686\abcdef1-production-rollback-only-rehearsal.ps1'
  $baselineHash='1EB426861A4B549C17667B160EA535006485491C676C9680DF4FC90481C463AF'
  Assert-True (Test-Path -LiteralPath $baseline) 'VERIFIED_PARITY_BASELINE_MISSING'
  Assert-True ((Get-Sha256Hex $baseline) -eq $baselineHash) 'VERIFIED_PARITY_BASELINE_HASH_MISMATCH'
  $baselineFunctions=Get-FunctionSourceMap $baseline
  $currentFunctions=Get-FunctionSourceMap $SharedValidationPath
  $expected=@('Assert-Condition','Sha256','Join-NativeArguments','Get-WrapperBodyHash','Invoke-GitText','Get-EnvironmentSnapshot','Restore-Environment','Clear-PostgresRoutingEnvironment','ConvertTo-BooleanStrict','ConvertTo-IntegerStrict','Get-ControlRequiredKeys','Convert-ControlRow','Assert-ControlAccepted','New-ControlSql','Parse-Manifest','Get-ExecutableRunnerLines','Assert-RunnerContract','Assert-ArtifactIntegrity','Assert-GitState','Parse-TargetDatabaseUrl','Assert-PasswordFreeDatabaseUrl','ConvertTo-SqlLiteral','New-TemporaryPgPassFile','Invoke-NativeChecked','Assert-RunnerMarkers','Invoke-OfflineMutationCase','Invoke-OfflineValidation','Invoke-Rehearsal')
  $adapterTests=@{
    'Assert-GitState'=@('ARCH-GIT-VALID','ARCH-GIT-WRONG-BRANCH','ARCH-GIT-STAGED','ARCH-GIT-DIRTY')
    'Assert-RunnerContract'=@('ARCH-ARTIFACT-VALID','ARCH-ARTIFACT-RUNNER-HASH-MISMATCH','RUNNER-EFFECTIVE-COMMIT-REJECTED')
    'Invoke-GitText'=@('PARITY-INVOKE-GIT-TEXT')
    'Invoke-NativeChecked'=@('ARCH-PROCESS-LARGE-OUTPUT','ARCH-PROCESS-TIMEOUT','ARCH-PROCESS-NONZERO-EXIT','ARCH-PROCESS-REDACTION')
    'Invoke-OfflineValidation'=@('ARCH-OFFLINE-NO-CREDENTIAL-PROMPT','ARCH-OFFLINE-NO-PSQL-RESOLUTION','ARCH-OFFLINE-NO-PGDUMP-RESOLUTION','ARCH-OFFLINE-NO-REAL-PROCESS-START','ARCH-OFFLINE-NO-PACKAGE-GENERATION','ARCH-OFFLINE-NO-SQL-EXECUTION')
    'Invoke-Rehearsal'=@('STATIC-INVOKE-REHEARSAL-BOUNDARIES')
    'Parse-Manifest'=@('ARCH-ARTIFACT-VALID')
  }
  $corrections=@{
    'Assert-ArtifactIntegrity'='single descriptor-driven helper and artifact integrity contract'
    'Parse-TargetDatabaseUrl'='structured URL security correction'
    'Get-WrapperBodyHash'='manifest-hash normalization for deterministic wrapper-body integrity'
    'New-TemporaryPgPassFile'='UTF-8 without BOM credential-file correction'
  }
  $rows=[Collections.Generic.List[object]]::new()
  foreach($name in $expected){
    Assert-True ($baselineFunctions.ContainsKey($name) -and $currentFunctions.ContainsKey($name)) "PARITY_FUNCTION_MISSING:$name"
    $classification='unexplained';$rationale='source differs without an approved explanation';$tests=@()
    if($baselineFunctions[$name] -ceq $currentFunctions[$name]){$classification='exact';$rationale='AST function source is byte-for-byte equivalent after newline normalization'}
    elseif($adapterTests.ContainsKey($name)){$classification='adapter-plumbing';$rationale='production dependency is routed through an injectable boundary';$tests=@($adapterTests[$name])}
    elseif($corrections.ContainsKey($name)){$classification='intentional-correction';$rationale=$corrections[$name]}
    foreach($test in $tests){Assert-True ($ExecutedProofIds -contains $test) "PARITY_NAMED_TEST_NOT_EXECUTED:${name}:${test}"}
    $row=[pscustomobject]@{function=$name;classification=$classification;rationale=$rationale;named_tests=$tests}
    $rows.Add($row);Write-Host ('PARITY|'+($row|ConvertTo-Json -Compress -Depth 4))
  }
  Assert-True ($rows.Count -eq 28) 'PARITY_FUNCTION_COUNT_MISMATCH'
  Assert-True (@($rows|Where-Object classification -eq 'unexplained').Count -eq 0) 'PARITY_UNEXPLAINED_DIFFERENCE'
  $summary=[ordered]@{}
  foreach($group in @($rows|Group-Object classification)){$summary[$group.Name]=$group.Count}
  Write-Host ('PARITY_SUMMARY|'+($summary|ConvertTo-Json -Compress))
}

function Run-OfflineMutationTests {
  Test-WrapperTemplateStaticContract
  $controlSample = "CONTROL|database_matches=true|server_major=17|tls_active=true|transaction_read_only=on|payment_events_present=true|payment_events_merchant_id_uuid=true|payment_events_merchant_id_nullable=true|payment_events_processor_compatible=true|payment_events_processed_at_compatible=true|invoice_fk_classification=canonical_set_null|merchant_fk_classification=canonical_cascade|platform_settings_present=true|plan_migration_solo_lite_enabled=false|solo_plus_enabled=false|solo_plus_kyc_enabled=false|conflicting_rehearsal_session_count=0|conflicting_lock_count=0|prepared_transaction_count=0|rollback_sensitive_fingerprint=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  $embeddingCases = @(
    @{ Id="EMBED-PLACEHOLDER-ONE"; Helper="Replace-SinglePlaceholder"; Pass=$true; Body={ Assert-Condition ((Replace-SinglePlaceholder 'a__P__b' '__P__' 'x') -eq 'axb') 'single placeholder failed' } },
    @{ Id="EMBED-PLACEHOLDER-MISSING"; Helper="Replace-SinglePlaceholder"; Pass=$false; Body={ Replace-SinglePlaceholder 'ab' '__P__' 'x' } },
    @{ Id="EMBED-PLACEHOLDER-MULTIPLE"; Helper="Replace-SinglePlaceholder"; Pass=$false; Body={ Replace-SinglePlaceholder '__P____P__' '__P__' 'x' } }
  )
  $embeddingExecuted=@{}
  foreach($case in $embeddingCases) {
    Assert-True (-not $embeddingExecuted.ContainsKey($case.Id)) "duplicate embedding case: $($case.Id)"
    $failed=$false; try { & $case.Body } catch { $failed=$true }
    Assert-True (($case.Pass -and -not $failed) -or (-not $case.Pass -and $failed)) "embedding case outcome mismatch: $($case.Id)"
    $embeddingExecuted[$case.Id]=$case.Helper
  }
  Assert-True ($embeddingExecuted.Count -eq $embeddingCases.Count) "embedding proof case execution mismatch"
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("deraledger-rehearsal-generator-test-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    $fixture = New-OfflineValidationFixture $tmp
    $artifacts = $fixture.Artifacts
    $wrapper = $fixture.Wrapper
    $wrapperText = Get-Content -Raw -LiteralPath $wrapper
    $helperStartMarker = "# BEGIN EMBEDDED CANONICAL REHEARSAL HELPER"
    $helperEndMarker = "# END EMBEDDED CANONICAL REHEARSAL HELPER"
    $helperStart = $wrapperText.IndexOf($helperStartMarker) + $helperStartMarker.Length
    $helperEnd = $wrapperText.IndexOf($helperEndMarker, $helperStart)
    Assert-True ($helperStart -ge $helperStartMarker.Length -and $helperEnd -gt $helperStart) "expanded wrapper helper boundary missing"
    $embeddedHelper = $wrapperText.Substring($helperStart, $helperEnd - $helperStart).Trim("`r", "`n")
    $canonicalHelper = (Get-Content -Raw -LiteralPath $SharedValidationPath).Trim("`r", "`n")
    $canonicalHash = Get-BytesSha256Hex ([Text.Encoding]::UTF8.GetBytes($canonicalHelper))
    $embeddedHash = Get-BytesSha256Hex ([Text.Encoding]::UTF8.GetBytes($embeddedHelper))
    if ($canonicalHash -ne $embeddedHash) {
      $limit = [Math]::Min($canonicalHelper.Length, $embeddedHelper.Length)
      $difference = -1
      for ($i = 0; $i -lt $limit; $i++) { if ($canonicalHelper[$i] -ne $embeddedHelper[$i]) { $difference = $i; break } }
      throw "canonical and embedded helper hashes differ: canonical=$canonicalHash embedded=$embeddedHash first_difference=$difference canonical_length=$($canonicalHelper.Length) embedded_length=$($embeddedHelper.Length)"
    }
    $architectureCaseCount = Run-AuthenticArchitectureProofCases -Artifacts $artifacts -WrapperPath $wrapper -TemporaryRoot $tmp
    $executedProofIds=@($script:LastArchitectureEvidence | ForEach-Object {$_.case_id})
    $gitHead=Invoke-GitText @('rev-parse','HEAD')
    Assert-True ($gitHead -match '^[a-f0-9]{40}$') 'PARITY_GIT_PROVIDER_FAILED'
    $executedProofIds += 'PARITY-INVOKE-GIT-TEXT'
    $helperTokens=$null;$helperErrors=$null
    $helperAst=[Management.Automation.Language.Parser]::ParseFile($SharedValidationPath,[ref]$helperTokens,[ref]$helperErrors)
    $invokeRehearsalAst=@($helperAst.FindAll({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-Rehearsal'},$true))
    Assert-True ($invokeRehearsalAst.Count -eq 1 -and $invokeRehearsalAst[0].Extent.Text -match 'CredentialProvider' -and $invokeRehearsalAst[0].Extent.Text -match 'ExecutableResolver' -and $invokeRehearsalAst[0].Extent.Text -match 'Invoke-RehearsalLifecycle') 'INVOKE_REHEARSAL_BOUNDARY_STATIC_PROOF_FAILED'
    $executedProofIds += 'STATIC-INVOKE-REHEARSAL-BOUNDARIES'
    $executedProofIds += Test-PgPassRawBytes
    foreach ($needle in @("OfflineValidateOnly","Convert-ControlRow","Assert-RunnerContract","New-TemporaryPgPassFile","ReadToEndAsync","taskkill.exe","Restore-Environment")) {
      Assert-True ($wrapperText.Contains($needle)) "expanded wrapper missing $needle"
    }

    $cases = @(
      @{ Id = "valid-url"; Expected = $true },
      @{ Id = "missing-host"; Expected = $false },
      @{ Id = "whitespace-host"; Expected = $false },
      @{ Id = "missing-user"; Expected = $false },
      @{ Id = "empty-user"; Expected = $false },
      @{ Id = "embedded-password"; Expected = $false },
      @{ Id = "missing-database"; Expected = $false },
      @{ Id = "slash-database"; Expected = $false },
      @{ Id = "disable-equals"; Expected = $false },
      @{ Id = "disable-name"; Expected = $false },
      @{ Id = "query-as-database"; Expected = $false },
      @{ Id = "bad-percent"; Expected = $false },
      @{ Id = "duplicate-ssl"; Expected = $false },
      @{ Id = "missing-ssl"; Expected = $false },
      @{ Id = "bad-ssl"; Expected = $false },
      @{ Id = "fragment"; Expected = $false },
      @{ Id = "encoded-values"; Expected = $true },
      @{ Id = "identity-match"; Expected = $true },
      @{ Id = "identity-mismatch"; Expected = $false },
      @{ Id = "empty-expected"; Expected = $false },
      @{ Id = "hostile-identity"; Expected = $true }
    )
    $executed = @{}
    $script:sampleControlForOffline = $controlSample
    foreach ($case in $cases) {
      Assert-True (-not $executed.ContainsKey($case.Id)) "duplicate mutation case: $($case.Id)"
      $executed[$case.Id] = $true
      $failed=$false
      try { Invoke-OfflineMutationCase $case.Id } catch { $failed=$true }
      Assert-True (($case.Expected -and -not $failed) -or (-not $case.Expected -and $failed)) "offline mutation outcome mismatch: $($case.Id)"
    }
    Assert-True ($executed.Count -eq $cases.Count) "not every declared mutation case executed"

    $badRunner = Join-Path $tmp "bad-runner.sql"
    Copy-Item -LiteralPath $artifacts.Runner -Destination $badRunner
    Add-Content -LiteralPath $badRunner -Value "COMMIT;"
    $badRunnerDescriptor=$fixture.Descriptor.PSObject.Copy();$badRunnerDescriptor.RunnerPath=$badRunner
    $failed=$false;try{Assert-RunnerContract $badRunnerDescriptor}catch{$failed=$true}
    Assert-True $failed 'inserted effective COMMIT mutation should fail canonical runner validation'
    $executed["inserted-effective-commit"] = $true
    $executedProofIds += 'RUNNER-EFFECTIVE-COMMIT-REJECTED'

    Invoke-FunctionParityClassification -ExecutedProofIds $executedProofIds

    $declaredCount=$cases.Count + 1 + $embeddingCases.Count + $architectureCaseCount
    $executedCount=$executed.Count + $embeddingExecuted.Count + $architectureCaseCount
    Write-Output ("Mutation cases declared: " + $declaredCount)
    Write-Output ("Mutation cases executed: " + $executedCount)
    Assert-True ($executedCount -eq $declaredCount) "declared and executed mutation counts differ"
    Write-Output "Production rehearsal generator offline mutation tests passed"
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function New-ProductionRehearsalPackage {
  if ([string]::IsNullOrWhiteSpace($Commit)) {
    throw "-Commit is required for -GeneratePackage."
  }
  $fullCommit = (& git -C $RepoRoot rev-parse $Commit).Trim()
  if ($LASTEXITCODE -ne 0 -or $fullCommit -notmatch "^[a-f0-9]{40}$") {
    throw "Unable to resolve commit: $Commit"
  }
  $short = $fullCommit.Substring(0, 7)
  $canonicalHelperText = (Get-Content -Raw -LiteralPath $SharedValidationPath).Trim("`r", "`n")
  $canonicalHelperHash = Get-BytesSha256Hex ([Text.Encoding]::UTF8.GetBytes($canonicalHelperText))
  $identity = "deraledger-production-rehearsal-$short-" + [guid]::NewGuid().ToString("N").Substring(0, 12)
  $bundle = Join-Path $OutputRoot $identity
  if (Test-Path -LiteralPath $bundle) {
    throw "Bundle directory already exists: $bundle"
  }
  New-Item -ItemType Directory -Path $bundle -Force | Out-Null

  $migrationRows = @()
  $hashTableLines = @()
  $runnerLines = [System.Collections.Generic.List[string]]::new()
  $runnerLines.Add("\set ON_ERROR_STOP on")
  $runnerLines.Add("BEGIN;")
  $runnerLines.Add("SET LOCAL lock_timeout = '10s';")
  $runnerLines.Add("SET LOCAL statement_timeout = '15min';")
  $runnerLines.Add("SET LOCAL idle_in_transaction_session_timeout = '20min';")

  foreach ($migration in $MigrationPlan) {
    $sourceBytes = Get-GitBlobBytes -Commit $fullCommit -Path $migration.Path
    $generatedBytes = $sourceBytes
    if ($migration.Strip) {
      $generatedBytes = Remove-TopLevelTransactionEnvelopeBytes -Bytes $sourceBytes -Path $migration.Path
    }

    $leaf = Split-Path -Leaf $migration.Path
    $targetName = if ($migration.Number -in @("006", "007", "008")) { $leaf } else { "$($migration.Number)_$leaf" }
    $targetPath = Join-Path $bundle $targetName
    [System.IO.File]::WriteAllBytes($targetPath, $generatedBytes)
    $sourceHash = Get-BytesSha256Hex $sourceBytes
    $generatedHash = Get-Sha256Hex $targetPath
    $migrationRows += "$($migration.Number)|$($migration.Path)|$targetPath|stripped=$($migration.Strip)|source_sha256=$sourceHash|generated_sha256=$generatedHash"
    $hashTableLines += "  '$targetPath' = '$generatedHash'"
    $runnerLines.Add("\echo RUNNING MIGRATION $($migration.Number) $($migration.Path)")
    $runnerLines.Add("\i '$($targetPath -replace '\\','/')'")
    $runnerLines.Add("\echo PASSED MIGRATION $($migration.Number) $($migration.Path)")
  }

  $runnerLines.Add("\echo ALL MIGRATIONS EXECUTED INSIDE OUTER TRANSACTION")
  $runnerLines.Add("ROLLBACK;")
  $runnerLines.Add("\echo ROLLBACK COMMAND COMPLETED")
  $runner = Join-Path $bundle "$short-production-rollback-only-rehearsal.sql"
  Set-Content -LiteralPath $runner -Value $runnerLines -Encoding ASCII
  $tokenFile = Join-Path $bundle "$short-production-rehearsal-confirmation-token.txt"
  $token = "CONFIRM-$short-" + ([guid]::NewGuid().ToString("N").Substring(0, 24).ToUpperInvariant())
  Set-Content -LiteralPath $tokenFile -Value $token -Encoding ASCII
  $manifest = Join-Path $RepoRoot "$short-production-rehearsal-bundle-manifest.txt"
  $wrapper = Join-Path $RepoRoot "$short-production-rollback-only-rehearsal.ps1"

  $manifestLines = @(
    "COMMIT=$fullCommit",
    "SHORT=$short",
    "ARTIFACT_IDENTITY=$identity",
    "GENERATED_AT_UTC=$([DateTime]::UtcNow.ToString('o'))",
    "TIMESTAMP_IS_SOURCE_FRESHNESS_PROOF=false",
    "BUNDLE=$bundle",
    "RUNNER=$runner",
    "RUNNER_SHA256=$(Get-Sha256Hex $runner)",
    "WRAPPER=$wrapper",
    "WRAPPER_SHA256=__WRAPPER_SHA256_PENDING__",
    "WRAPPER_INTEGRITY_MECHANISM=wrapper_body_sha256_with_self-hash_placeholders_normalized",
    "WRAPPER_BODY_SHA256=__WRAPPER_BODY_SHA256_PENDING__",
    "TOKEN_FILE=$tokenFile",
    "TOKEN_FILE_SHA256=$(Get-Sha256Hex $tokenFile)",
    "CANONICAL_HELPER_SOURCE_PATH=$SharedValidationPath",
    "CANONICAL_HELPER_SHA256=$canonicalHelperHash",
    "EMBEDDED_HELPER_SHA256=$canonicalHelperHash",
    "EMBEDDED_HELPER_START_MARKER=# BEGIN EMBEDDED CANONICAL REHEARSAL HELPER",
    "EMBEDDED_HELPER_END_MARKER=# END EMBEDDED CANONICAL REHEARSAL HELPER",
    "HELPER_ENCODING=UTF-8-no-BOM",
    "HELPER_NEWLINE_POLICY=preserve-canonical-normalize-boundary-newlines",
    "CONFIRMATION_TOKEN=$token",
    "STALE_ARTIFACT_EXCLUSIONS=2d0cfee4,beecef35,752c41b,88845a2,cbec7fd",
    "MIGRATIONS="
  ) + $migrationRows
  Set-Content -LiteralPath $manifest -Value $manifestLines -Encoding ASCII

  $artifacts = [pscustomobject]@{ Bundle = $bundle; Runner = $runner; Manifest = $manifest; TokenFile = $tokenFile; HashLines = ($hashTableLines -join "`n") }
  Expand-WrapperTemplate -Artifacts $artifacts -WrapperPath $wrapper
  Write-Output "BUNDLE=$bundle"
  Write-Output "RUNNER=$runner"
  Write-Output "MANIFEST=$manifest"
  Write-Output "WRAPPER=$wrapper"
  Write-Output "TOKEN_FILE=$tokenFile"
}

$selected = @($OfflineValidateOnly, $RunOfflineMutationTests, $GeneratePackage) | Where-Object { $_ }
if (@($selected).Count -ne 1) {
  throw "Choose exactly one mode: -OfflineValidateOnly, -RunOfflineMutationTests, or -GeneratePackage."
}

if ($OfflineValidateOnly) {
  Test-WrapperTemplateStaticContract
  Invoke-GeneratorOfflineValidation
  return
}

if ($RunOfflineMutationTests) {
  Run-OfflineMutationTests
  return
}

$generationContext = New-ProductionRehearsalRuntimeContext
$generationContext.PackageGenerationBoundary = { New-ProductionRehearsalPackage }
& $generationContext.PackageGenerationBoundary
