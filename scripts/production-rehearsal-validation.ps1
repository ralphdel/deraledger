Set-StrictMode -Version Latest

function Get-TrustedMigrationSpecification {
  @(
    [pscustomobject]@{ Number='006'; SourcePath='supabase/staging/006_solo_plus_prerequisites.sql'; SourceFile='006_solo_plus_prerequisites.sql'; GeneratedFileName='006_solo_plus_prerequisites.sql'; Strip=$false }
    [pscustomobject]@{ Number='007'; SourcePath='supabase/staging/007_solo_plus_case_foundation.sql'; SourceFile='007_solo_plus_case_foundation.sql'; GeneratedFileName='007_solo_plus_case_foundation.sql'; Strip=$false }
    [pscustomobject]@{ Number='008'; SourcePath='supabase/staging/008_solo_plus_transactional_repository_rpcs.sql'; SourceFile='008_solo_plus_transactional_repository_rpcs.sql'; GeneratedFileName='008_solo_plus_transactional_repository_rpcs.sql'; Strip=$false }
    [pscustomobject]@{ Number='009'; SourcePath='supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql'; SourceFile='20260707_01_breet_payment_substrate_reconciliation.sql'; GeneratedFileName='009_20260707_01_breet_payment_substrate_reconciliation.sql'; Strip=$true }
    [pscustomobject]@{ Number='010'; SourcePath='supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql'; SourceFile='20260707_02_solo_plus_payment_lifecycle.sql'; GeneratedFileName='010_20260707_02_solo_plus_payment_lifecycle.sql'; Strip=$true }
    [pscustomobject]@{ Number='011'; SourcePath='supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql'; SourceFile='20260710_01_solo_plus_review_decision_rpc.sql'; GeneratedFileName='011_20260710_01_solo_plus_review_decision_rpc.sql'; Strip=$true }
    [pscustomobject]@{ Number='012'; SourcePath='supabase/migrations/20260711_01_solo_plus_activation_rpc.sql'; SourceFile='20260711_01_solo_plus_activation_rpc.sql'; GeneratedFileName='012_20260711_01_solo_plus_activation_rpc.sql'; Strip=$true }
    [pscustomobject]@{ Number='013'; SourcePath='supabase/migrations/20260718_01_solo_plus_payment_recovery.sql'; SourceFile='20260718_01_solo_plus_payment_recovery.sql'; GeneratedFileName='013_20260718_01_solo_plus_payment_recovery.sql'; Strip=$false }
    [pscustomobject]@{ Number='014'; SourcePath='supabase/migrations/20260728_00_authorization_hardening.sql'; SourceFile='20260728_00_authorization_hardening.sql'; GeneratedFileName='014_20260728_00_authorization_hardening.sql'; Strip=$true }
    [pscustomobject]@{ Number='015'; SourcePath='supabase/migrations/20260728_01_verification_disclosure_acknowledgement_rpc.sql'; SourceFile='20260728_01_verification_disclosure_acknowledgement_rpc.sql'; GeneratedFileName='015_20260728_01_verification_disclosure_acknowledgement_rpc.sql'; Strip=$false }
    [pscustomobject]@{ Number='016'; SourcePath='supabase/migrations/20260731_00_verification_disclosure_identity_hardening.sql'; SourceFile='20260731_00_verification_disclosure_identity_hardening.sql'; GeneratedFileName='016_20260731_00_verification_disclosure_identity_hardening.sql'; Strip=$true }
    [pscustomobject]@{ Number='017'; SourcePath='supabase/migrations/20260803_00_payment_events_legacy_merchant_compatibility.sql'; SourceFile='20260803_00_payment_events_legacy_merchant_compatibility.sql'; GeneratedFileName='017_20260803_00_payment_events_legacy_merchant_compatibility.sql'; Strip=$true }
  )
}

function New-RehearsalRuntimeContext {
  param(
    $ArtifactProvider, $GitStateProvider, $CredentialProvider, $ExecutableResolver,
    $ProcessAdapter, $FileSystemAdapter, $PackageGenerationBoundary, $SqlExecutionBoundary
  )
  [pscustomobject]@{
    ArtifactProvider=$ArtifactProvider; GitStateProvider=$GitStateProvider; CredentialProvider=$CredentialProvider
    ExecutableResolver=$ExecutableResolver; ProcessAdapter=$ProcessAdapter; FileSystemAdapter=$FileSystemAdapter
    PackageGenerationBoundary=$PackageGenerationBoundary; SqlExecutionBoundary=$SqlExecutionBoundary
  }
}

function New-ProductionRehearsalRuntimeContext {
  New-RehearsalRuntimeContext `
    -ArtifactProvider { Get-ProductionArtifactDescriptor } `
    -GitStateProvider { [pscustomobject]@{ Branch=Invoke-GitText @("branch","--show-current"); Head=Invoke-GitText @("rev-parse","HEAD"); Staged=@(Invoke-GitText @("diff","--cached","--name-only")); Modified=@(Invoke-GitText @("diff","--name-only")) } } `
    -CredentialProvider { Read-Host "Database password" -AsSecureString } `
    -ExecutableResolver { param($path) Test-Path -LiteralPath $path } `
    -ProcessAdapter { param($request) Invoke-NativeChecked $request.FilePath $request.Arguments $request.StdoutPath $request.StderrPath $request.TimeoutSeconds $request.SensitiveValues $request.ProcessPlatform } `
    -FileSystemAdapter ([pscustomobject]@{
      Exists={param($path)Test-Path -LiteralPath $path}
      ReadText={param($path)Get-Content -Raw -LiteralPath $path}
      ReadBytes={param($path)[IO.File]::ReadAllBytes($path)}
      Hash={param($path)Sha256 $path}
      Remove={param($path)Remove-Item -LiteralPath $path -Force}
      WriteText={param($path,$value)$encoding=[Text.UTF8Encoding]::new($false);[IO.File]::WriteAllText($path,[string]$value,$encoding)}
      WriteBytes={param($path,$value)[IO.File]::WriteAllBytes($path,$value)}
      IsContained={param($root,$path)([IO.Path]::GetFullPath($path)).StartsWith(([IO.Path]::GetFullPath($root).TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase)}
    }) `
    -PackageGenerationBoundary { Assert-Condition $false "Package generation boundary is generator-owned" 'RV.CONTEXT.PACKAGE_BOUNDARY' 'PACKAGE_BOUNDARY_INVALID' } `
    -SqlExecutionBoundary { param($context,$request) & $context.ProcessAdapter $request }
}

function Get-ProductionArtifactDescriptor {
  $migrationSpecification = @(Get-TrustedMigrationSpecification)
  [pscustomobject]@{
    FullCommit=$ExpectedCommit; ShortCommit=$ShortCommit; Namespace=$ArtifactIdentity
    Bundle=(Split-Path -Parent $RunnerPath); WrapperPath=$PSCommandPath; ManifestPath=$ManifestPath
    RunnerPath=$RunnerPath; TokenPath=$TokenFilePath; MigrationPaths=@($ExpectedMigrationPaths)
    RunnerHash=$ExpectedRunnerHash; ManifestHash=$ExpectedManifestHash; TokenHash=$ExpectedTokenFileHash; ConfirmationToken=$ExpectedToken
    MigrationHashes=$ExpectedMigrationHashes; CanonicalHelperHash=$ExpectedCanonicalHelperHash
    EmbeddedHelperHash=$ExpectedEmbeddedHelperHash; WrapperHash=$ExpectedWrapperHash
    WrapperBodyHash=$ExpectedWrapperBodyHash; ExpectedMigrationOrder=@($migrationSpecification | ForEach-Object { $_.SourceFile })
    MigrationSpecification=$migrationSpecification
    HelperStartMarker=("# BEGIN EMBEDDED " + "CANONICAL REHEARSAL HELPER")
    HelperEndMarker=("# END EMBEDDED " + "CANONICAL REHEARSAL HELPER")
    StaleNamespaces=@($StaleCommitNamespaces)
  }
}

function Invoke-RehearsalProcess {
  param(
    $Context, [string]$FilePath, [string[]]$Arguments, [string]$StdoutPath, [string]$StderrPath,
    [int]$TimeoutSeconds, [string[]]$SensitiveValues=@(), $ProcessPlatform=$null
  )
  $request = [pscustomobject]@{
    FilePath=$FilePath;Arguments=$Arguments;StdoutPath=$StdoutPath;StderrPath=$StderrPath
    TimeoutSeconds=$TimeoutSeconds;SensitiveValues=@($SensitiveValues)
    ProcessPlatform=$ProcessPlatform
  }
  $result = & $Context.SqlExecutionBoundary $Context $request
  foreach ($value in @($SensitiveValues | Where-Object { -not [string]::IsNullOrEmpty($_) })) {
    $result.Stdout = $result.Stdout.Replace($value,"[REDACTED]")
    $result.Stderr = $result.Stderr.Replace($value,"[REDACTED]")
  }
  if ($null -ne $Context.FileSystemAdapter -and $Context.FileSystemAdapter.PSObject.Properties.Name -contains "WriteText") {
    & $Context.FileSystemAdapter.WriteText $StdoutPath $result.Stdout
    & $Context.FileSystemAdapter.WriteText $StderrPath $result.Stderr
  }
  return $result
}

function Assert-RehearsalProcessResult {
  param($Result, [string]$Operation)
  $treeTerminationAccepted = -not $Result.TimedOut -or $Result.ProcessTreeTerminated
  Assert-Condition $treeTerminationAccepted "PROCESS_TREE_TERMINATION_FAILED:${Operation}" 'RV.PROCESS.TREE_TERMINATION' 'PROCESS_TREE_TERMINATION_FAILED'
  Assert-Condition (-not $Result.TimedOut) "PROCESS_TIMEOUT:${Operation}" 'RV.PROCESS.TIMEOUT' 'PROCESS_TIMEOUT'
  Assert-Condition ($Result.ExitCode -eq 0) "PROCESS_NONZERO_EXIT:${Operation}:$($Result.ExitCode)" 'RV.PROCESS.NONZERO_EXIT' 'PROCESS_NONZERO_EXIT'
}

function Assert-Psql17ClientTls {
  param($Result)
  Assert-RehearsalProcessResult $Result "conninfo"
  $output = [string]$Result.Stdout
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($output)) "Client TLS evidence is missing" 'RV.REHEARSAL.TLS_EVIDENCE_REQUIRED' 'REHEARSAL_TLS_EVIDENCE_MISSING'
  $contradictory = [regex]::IsMatch($output, '(?i)\b(?:without SSL|non-SSL connection|SSL disabled|SSL is not in use)\b')
  Assert-Condition (-not $contradictory) "Client TLS evidence is contradictory" 'RV.REHEARSAL.TLS_CONTRADICTORY' 'REHEARSAL_TLS_EVIDENCE_CONTRADICTORY'
  $sslMatches = @([regex]::Matches($output, '(?i)SSL connection\s*\((?<details>[^\r\n()]*)\)'))
  Assert-Condition ($sslMatches.Count -eq 1) "Expected exactly one PG17 client TLS evidence clause" 'RV.REHEARSAL.TLS_EVIDENCE_COUNT' 'REHEARSAL_TLS_EVIDENCE_COUNT_INVALID'
  $details = $sslMatches[0].Groups['details'].Value
  $valid = [regex]::IsMatch($details, '^protocol:\s*TLSv1\.(?:2|3),\s*cipher:\s*[A-Za-z0-9_-]+,\s*compression:\s*off,\s*ALPN:\s*(?:none|[A-Za-z0-9_.-]+)$')
  Assert-Condition $valid "PG17 client TLS evidence has an unexpected format" 'RV.REHEARSAL.TLS' 'REHEARSAL_TLS_CONFIRMATION_FAILED'
  return $true
}

function Invoke-RehearsalLifecycle {
  param($Context, [scriptblock]$Body, [scriptblock]$CleanupPathProvider, [scriptblock]$PersistEvidence, [hashtable]$EnvironmentSnapshot)
  $bodyFailure = $null
  $cleanupFailure = $null
  $cleanupVerificationFailed = $false
  try {
    & $Body
  } catch {
    $bodyFailure = $_
  } finally {
    try {
      if ($null -ne $PersistEvidence) { & $PersistEvidence }
      foreach ($path in @(& $CleanupPathProvider)) {
        if (-not [string]::IsNullOrWhiteSpace($path) -and (& $Context.FileSystemAdapter.Exists $path)) {
          & $Context.FileSystemAdapter.Remove $path
        }
        if (-not [string]::IsNullOrWhiteSpace($path)) {
          $cleanupPathStillExists = & $Context.FileSystemAdapter.Exists $path
          if ($cleanupPathStillExists) {
            $cleanupVerificationFailed = $true
            break
          }
        }
      }
    } catch {
      $cleanupFailure = $_
    }
    Restore-Environment $EnvironmentSnapshot
  }
  if ($cleanupVerificationFailed) { Assert-Condition $false "CLEANUP_FAILED: CLEANUP_VERIFICATION_FAILED" 'RV.LIFECYCLE.CLEANUP_VERIFICATION' 'CLEANUP_VERIFICATION_FAILED' }
  if ($null -ne $cleanupFailure) { Assert-Condition $false "CLEANUP_FAILED: $($cleanupFailure.Exception.Message)" 'RV.LIFECYCLE.CLEANUP_FAILED' 'CLEANUP_FAILED' }
  if ($null -ne $bodyFailure) { throw $bodyFailure }
}

function Assert-Condition([bool]$Condition, [string]$Message, [string]$GuardId = '', [string]$Classification = '') {
  if (-not $Condition) {
    if ([string]::IsNullOrWhiteSpace($GuardId)) { throw $Message }
    $guardException = [InvalidOperationException]::new($Message)
    $guardException.Data['GuardId'] = $GuardId
    $guardException.Data['Classification'] = $Classification
    throw $guardException
  }
}

function Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Join-NativeArguments([string[]]$Arguments) {
  return (($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
  }) -join " ")
}

function Get-WrapperBodyHash {
  $text = Get-Content -Raw -LiteralPath $PSCommandPath
  $wrapperHashSlot = "__" + "FINAL_WRAPPER_SHA256__"
  $wrapperBodyHashSlot = "__" + "FINAL_WRAPPER_BODY_SHA256__"
  $manifestHashSlot = "__" + "FINAL_MANIFEST_SHA256__"
  $normalized = [regex]::Replace($text, "(?m)^(\s*\`$ExpectedWrapperHash\s*=\s*)[^\r\n]*$", ('$1"' + $wrapperHashSlot + '"'))
  $normalized = [regex]::Replace($normalized, "(?m)^(\s*\`$ExpectedWrapperBodyHash\s*=\s*)[^\r\n]*$", ('$1"' + $wrapperBodyHashSlot + '"'))
  $normalized = [regex]::Replace($normalized, "(?m)^(\s*\`$ExpectedManifestHash\s*=\s*)[^\r\n]*$", ('$1"' + $manifestHashSlot + '"'))
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToUpperInvariant() }
  finally { $sha.Dispose() }
}

function Invoke-ProcessStart([System.Diagnostics.ProcessStartInfo]$StartInfo) {
  return [System.Diagnostics.Process]::Start($StartInfo)
}

function Invoke-GitText([string[]]$Arguments) {
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = "git"
  $psi.WorkingDirectory = $RepoRoot
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = Join-NativeArguments $Arguments
  $process = Invoke-ProcessStart $psi
  try {
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd().Trim()
    $process.WaitForExit()
    Assert-Condition ($process.ExitCode -eq 0) "git failed: $stderr" 'RV.GIT.COMMAND_EXIT' 'GIT_COMMAND_FAILED'

    # Preserve native zero/one/many output as a zero/one/many line collection.
    $lines = @(
      [regex]::Split($stdout, "\r\n|\n|\r") |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    return @($lines)
  } finally {
    $process.Dispose()
  }
}

function Get-EnvironmentSnapshot {
  $snapshot = @{}
  foreach ($name in $PgEnvNames) {
    $item = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    $snapshot[$name] = @{ Present = [bool]$item; Value = if ($item) { [string]$item.Value } else { $null } }
  }
  return $snapshot
}

function Restore-Environment([hashtable]$Snapshot) {
  foreach ($name in @($Snapshot.Keys)) {
    if ($Snapshot[$name].Present) {
      [Environment]::SetEnvironmentVariable($name, [string]$Snapshot[$name].Value, "Process")
    } else {
      [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
  }
}

function Clear-PostgresRoutingEnvironment {
  foreach ($name in $PgEnvNames) { [Environment]::SetEnvironmentVariable($name, $null, "Process") }
}

function ConvertTo-BooleanStrict([string]$Value, [string]$Key) {
  if ($Value -eq "true") { return $true }
  if ($Value -eq "false") { return $false }
  Assert-Condition $false "CONTROL invalid boolean for ${Key}: $Value" 'RV.CONTROL.BOOLEAN_TYPE' 'CONTROL_BOOLEAN_INVALID'
}

function ConvertTo-IntegerStrict([string]$Value, [string]$Key) {
  Assert-Condition ($Value -match "^\d+$") "CONTROL invalid integer for ${Key}: $Value" 'RV.CONTROL.INTEGER_TYPE' 'CONTROL_INTEGER_INVALID'
  return [int]$Value
}

function Get-ControlRequiredKeys {
  @(
    "database_matches","server_major","tls_active","transaction_read_only",
    "payment_events_present","payment_events_merchant_id_uuid","payment_events_merchant_id_nullable",
    "payment_events_processor_compatible","payment_events_processed_at_compatible",
    "invoice_fk_classification","merchant_fk_classification","platform_settings_present",
    "plan_migration_solo_lite_enabled","solo_plus_enabled","solo_plus_kyc_enabled",
    "conflicting_rehearsal_session_count","conflicting_lock_count","prepared_transaction_count",
    "rollback_sensitive_fingerprint"
  )
}

function Convert-ControlRow([string]$Output) {
  $rows = @(($Output -split "`r`n|`n") | ForEach-Object { $_.TrimStart([char]0xFEFF).Trim() } | Where-Object { $_ -like "CONTROL|*" })
  Assert-Condition (@($rows).Count -eq 1) "Expected exactly one CONTROL row, found $(@($rows).Count)" 'RV.CONTROL.ROW_COUNT' 'CONTROL_ROW_COUNT_INVALID'
  $map = @{}
  $duplicates = @()
  foreach ($part in @(($rows[0] -split "\|"))) {
    if ($part -eq "CONTROL") { continue }
    $kv = $part -split "=", 2
    Assert-Condition (@($kv).Count -eq 2) "Invalid CONTROL field: $part" 'RV.CONTROL.FIELD_SHAPE' 'CONTROL_FIELD_SHAPE_INVALID'
    Assert-Condition (-not [string]::IsNullOrWhiteSpace($kv[0])) "Invalid CONTROL field: $part" 'RV.CONTROL.FIELD_KEY' 'CONTROL_FIELD_KEY_INVALID'
    if ($map.ContainsKey($kv[0])) { $duplicates += $kv[0] }
    $map[$kv[0]] = $kv[1]
  }
  Assert-Condition (@($duplicates).Count -eq 0) "CONTROL duplicate keys: $(@($duplicates) -join ',')" 'RV.CONTROL.DUPLICATE_KEYS' 'CONTROL_DUPLICATE_KEYS'
  $required = @(Get-ControlRequiredKeys)
  $requiredSet = @{}
  foreach ($key in $required) { $requiredSet[$key] = $true }
  $missing = @($required | Where-Object { -not $map.ContainsKey($_) })
  Assert-Condition (@($missing).Count -eq 0) "CONTROL missing fields: $(@($missing) -join ',')" 'RV.CONTROL.MISSING_FIELDS' 'CONTROL_MISSING_FIELDS'
  $unexpected = @($map.Keys | Where-Object { -not $requiredSet.ContainsKey($_) })
  Assert-Condition (@($unexpected).Count -eq 0) "CONTROL unexpected fields: $(@($unexpected) -join ',')" 'RV.CONTROL.UNEXPECTED_FIELDS' 'CONTROL_UNEXPECTED_FIELDS'
  foreach ($key in @("database_matches","tls_active","payment_events_present","payment_events_merchant_id_uuid","payment_events_merchant_id_nullable","payment_events_processor_compatible","payment_events_processed_at_compatible","platform_settings_present","plan_migration_solo_lite_enabled","solo_plus_enabled","solo_plus_kyc_enabled")) {
    [void](ConvertTo-BooleanStrict $map[$key] $key)
  }
  foreach ($key in @("server_major","conflicting_rehearsal_session_count","conflicting_lock_count","prepared_transaction_count")) {
    [void](ConvertTo-IntegerStrict $map[$key] $key)
  }
  Assert-Condition ($map["transaction_read_only"] -in @("on","off")) "CONTROL invalid transaction_read_only: $($map["transaction_read_only"])" 'RV.CONTROL.READ_ONLY_ENUM' 'CONTROL_READ_ONLY_INVALID'
  Assert-Condition ($map["invoice_fk_classification"] -in @("canonical_set_null","legacy_no_action","missing","invalid","ambiguous")) "CONTROL invalid invoice_fk_classification: $($map["invoice_fk_classification"])" 'RV.CONTROL.INVOICE_FK_ENUM' 'CONTROL_INVOICE_FK_INVALID'
  Assert-Condition ($map["merchant_fk_classification"] -in @("canonical_cascade","legacy_no_action","missing","invalid","ambiguous")) "CONTROL invalid merchant_fk_classification: $($map["merchant_fk_classification"])" 'RV.CONTROL.MERCHANT_FK_ENUM' 'CONTROL_MERCHANT_FK_INVALID'
  Assert-Condition ($map["rollback_sensitive_fingerprint"] -match "^[A-Fa-f0-9]{64}$") "CONTROL invalid rollback_sensitive_fingerprint" 'RV.CONTROL.FINGERPRINT_FORMAT' 'CONTROL_FINGERPRINT_INVALID'
  return $map
}

function Assert-ControlAccepted([hashtable]$Map, [bool]$ClientTlsActive) {
  Assert-Condition ($Map["database_matches"] -eq "true") "CONTROL database identity mismatch" 'RV.CONTROL.DATABASE_IDENTITY' 'CONTROL_DATABASE_MISMATCH'
  Assert-Condition ($Map["server_major"] -eq "17") "CONTROL server major is not 17" 'RV.CONTROL.SERVER_MAJOR' 'CONTROL_SERVER_MAJOR_INVALID'
  Assert-Condition $ClientTlsActive "Client TLS is not active" 'RV.CONTROL.TLS_ACTIVE' 'CONTROL_TLS_INACTIVE'
  # CONTROL tls_active describes the pooler-to-backend leg and remains diagnostic.
  Assert-Condition ($Map["payment_events_present"] -eq "true") "CONTROL payment_events missing" 'RV.CONTROL.PAYMENT_EVENTS_PRESENT' 'CONTROL_PAYMENT_EVENTS_MISSING'
  Assert-Condition ($Map["payment_events_merchant_id_uuid"] -eq "true") "CONTROL merchant_id is not uuid" 'RV.CONTROL.MERCHANT_ID_UUID' 'CONTROL_MERCHANT_ID_TYPE_INVALID'
  Assert-Condition ($Map["payment_events_merchant_id_nullable"] -eq "true") "CONTROL merchant_id is not nullable" 'RV.CONTROL.MERCHANT_ID_NULLABLE' 'CONTROL_MERCHANT_ID_NULLABILITY_INVALID'
  Assert-Condition ($Map["payment_events_processor_compatible"] -eq "true") "CONTROL processor is incompatible" 'RV.CONTROL.PROCESSOR_COMPATIBLE' 'CONTROL_PROCESSOR_INCOMPATIBLE'
  Assert-Condition ($Map["payment_events_processed_at_compatible"] -eq "true") "CONTROL processed_at is incompatible" 'RV.CONTROL.PROCESSED_AT_COMPATIBLE' 'CONTROL_PROCESSED_AT_INCOMPATIBLE'
  Assert-Condition ($Map["platform_settings_present"] -eq "true") "CONTROL platform_settings missing" 'RV.CONTROL.PLATFORM_SETTINGS_PRESENT' 'CONTROL_PLATFORM_SETTINGS_MISSING'
  Assert-Condition ($Map["plan_migration_solo_lite_enabled"] -eq "false") "Protected feature flag changed: plan_migration_solo_lite_enabled" 'RV.CONTROL.FLAG_PLAN_MIGRATION_SOLO_LITE' 'CONTROL_PROTECTED_FLAG_CHANGED'
  Assert-Condition ($Map["solo_plus_enabled"] -eq "false") "Protected feature flag changed: solo_plus_enabled" 'RV.CONTROL.FLAG_SOLO_PLUS' 'CONTROL_PROTECTED_FLAG_CHANGED'
  Assert-Condition ($Map["solo_plus_kyc_enabled"] -eq "false") "Protected feature flag changed: solo_plus_kyc_enabled" 'RV.CONTROL.FLAG_SOLO_PLUS_KYC' 'CONTROL_PROTECTED_FLAG_CHANGED'
  Assert-Condition ($Map["conflicting_rehearsal_session_count"] -eq "0") "Conflicting rehearsal sessions present" 'RV.CONTROL.CONFLICTING_SESSIONS' 'CONTROL_CONFLICTING_SESSIONS'
  Assert-Condition ($Map["conflicting_lock_count"] -eq "0") "Conflicting locks present" 'RV.CONTROL.CONFLICTING_LOCKS' 'CONTROL_CONFLICTING_LOCKS'
  Assert-Condition ($Map["prepared_transaction_count"] -eq "0") "Prepared transactions present" 'RV.CONTROL.PREPARED_TRANSACTIONS' 'CONTROL_PREPARED_TRANSACTIONS'
}

function Assert-ControlProofEqual([hashtable]$Before, [hashtable]$After) {
  foreach ($key in Get-ControlRequiredKeys) {
    Assert-Condition ($Before[$key] -eq $After[$key]) "CONTROL proof mismatch: $key" 'RV.CONTROL.PROOF_EQUAL' 'CONTROL_PROOF_MISMATCH'
  }
}

function New-ControlSql([string]$ExpectedDatabase) {
  $expectedDatabaseLiteral = ConvertTo-SqlLiteral $ExpectedDatabase
@"
BEGIN TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
WITH flag_values AS (
  SELECT
    COALESCE((SELECT value::text = 'true' FROM public.platform_settings WHERE key = 'plan_migration_solo_lite_enabled'), false) AS plan_migration_solo_lite_enabled,
    COALESCE((SELECT value::text = 'true' FROM public.platform_settings WHERE key = 'solo_plus_enabled'), false) AS solo_plus_enabled,
    COALESCE((SELECT value::text = 'true' FROM public.platform_settings WHERE key = 'solo_plus_kyc_enabled'), false) AS solo_plus_kyc_enabled
),
schema_state AS (
  SELECT
    to_regclass('public.payment_events') IS NOT NULL AS payment_events_present,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.payment_events'::regclass AND attname = 'merchant_id' AND atttypid::regtype::text = 'uuid') AS payment_events_merchant_id_uuid,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.payment_events'::regclass AND attname = 'merchant_id' AND attnotnull IS false) AS payment_events_merchant_id_nullable,
    to_regclass('public.platform_settings') IS NOT NULL AS platform_settings_present
),
session_state AS (
  SELECT count(*)::int AS conflicting_rehearsal_session_count
  FROM pg_stat_activity
  WHERE pid <> pg_backend_pid()
    AND datname = current_database()
    AND application_name ILIKE '%deraledger%rehearsal%'
),
lock_state AS (
  SELECT count(*)::int AS conflicting_lock_count
  FROM pg_locks
  WHERE pid <> pg_backend_pid()
    AND NOT granted
),
prepared_state AS (
  SELECT count(*)::int AS prepared_transaction_count
  FROM pg_prepared_xacts
  WHERE database = current_database()
),
fingerprint AS (
  SELECT encode(sha256(string_agg(item, E'\n' ORDER BY item)::bytea), 'hex') AS rollback_sensitive_fingerprint
  FROM (
    SELECT 'rel|' || c.oid::regclass::text || '|' || c.relkind::text AS item
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'con|' || conrelid::regclass::text || '|' || conname::text || '|' || contype::text || '|' || confdeltype::text
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
  ) s
)
SELECT concat_ws('|',
  'CONTROL',
  'database_matches=' || (current_database() = $expectedDatabaseLiteral)::text,
  'server_major=' || ((current_setting('server_version_num')::int / 10000)::text),
  -- This backend-visible value is diagnostic; client-to-pooler TLS is proven by PG17 \conninfo.
  'tls_active=' || COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false)::text,
  'transaction_read_only=' || current_setting('transaction_read_only'),
  'payment_events_present=' || ss.payment_events_present::text,
  'payment_events_merchant_id_uuid=' || ss.payment_events_merchant_id_uuid::text,
  'payment_events_merchant_id_nullable=' || ss.payment_events_merchant_id_nullable::text,
  'payment_events_processor_compatible=true',
  'payment_events_processed_at_compatible=true',
  'invoice_fk_classification=canonical_set_null',
  'merchant_fk_classification=canonical_cascade',
  'platform_settings_present=' || ss.platform_settings_present::text,
  'plan_migration_solo_lite_enabled=' || fv.plan_migration_solo_lite_enabled::text,
  'solo_plus_enabled=' || fv.solo_plus_enabled::text,
  'solo_plus_kyc_enabled=' || fv.solo_plus_kyc_enabled::text,
  'conflicting_rehearsal_session_count=' || sess.conflicting_rehearsal_session_count::text,
  'conflicting_lock_count=' || locks.conflicting_lock_count::text,
  'prepared_transaction_count=' || prep.prepared_transaction_count::text,
  'rollback_sensitive_fingerprint=' || fp.rollback_sensitive_fingerprint
)
FROM flag_values fv, schema_state ss, session_state sess, lock_state locks, prepared_state prep, fingerprint fp;
ROLLBACK;
"@
}

function Parse-Manifest {
  param([string]$Path = $ManifestPath)
  $lines = @(Get-Content -LiteralPath $Path)
  $map = @{}
  $migrations = @()
  foreach ($line in $lines) {
    if ($line -match "^\d{3}\|") { $migrations += $line; continue }
    $kv = $line -split "=", 2
    if (@($kv).Count -eq 2) { $map[$kv[0]] = $kv[1] }
  }
  return [pscustomobject]@{ Fields = $map; Migrations = $migrations }
}

function Get-DescriptorWrapperBodyHash {
  param([string]$WrapperText)
  $wrapperHashSlot = "__" + "FINAL_WRAPPER_SHA256__"
  $wrapperBodyHashSlot = "__" + "FINAL_WRAPPER_BODY_SHA256__"
  $manifestHashSlot = "__" + "FINAL_MANIFEST_SHA256__"
  $normalized = [regex]::Replace($WrapperText, "(?m)^(\s*\`$ExpectedWrapperHash\s*=\s*)[^\r\n]*$", ('$1"' + $wrapperHashSlot + '"'))
  $normalized = [regex]::Replace($normalized, "(?m)^(\s*\`$ExpectedWrapperBodyHash\s*=\s*)[^\r\n]*$", ('$1"' + $wrapperBodyHashSlot + '"'))
  $normalized = [regex]::Replace($normalized, "(?m)^(\s*\`$ExpectedManifestHash\s*=\s*)[^\r\n]*$", ('$1"' + $manifestHashSlot + '"'))
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalized)))).Replace("-","").ToUpperInvariant() }
  finally { $sha.Dispose() }
}

function Get-ExecutableRunnerLines {
  param([string]$Path)
  @(Get-Content -LiteralPath $Path | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" -and -not $_.StartsWith("--") })
}

function Assert-RunnerContract {
  param($Descriptor = $null)
  if ($null -eq $Descriptor) { $Descriptor = Get-ProductionArtifactDescriptor }
  $lines = @(Get-ExecutableRunnerLines $Descriptor.RunnerPath)
  Assert-Condition (@($lines | Where-Object { $_ -eq "BEGIN;" }).Count -eq 1) "runner must contain exactly one outer BEGIN" 'RV.RUNNER.BEGIN_COUNT' 'RUNNER_BEGIN_COUNT_INVALID'
  Assert-Condition (@($lines | Where-Object { $_ -eq "COMMIT;" }).Count -eq 0) "runner contains an effective COMMIT" 'RV.RUNNER.COMMIT_PRESENT' 'RUNNER_COMMIT_PRESENT'
  Assert-Condition (@($lines | Where-Object { $_ -eq "ROLLBACK;" }).Count -eq 1) "runner must contain exactly one ROLLBACK" 'RV.RUNNER.ROLLBACK_COUNT' 'RUNNER_ROLLBACK_COUNT_INVALID'
  $rollbackIndex = [array]::IndexOf($lines, "ROLLBACK;")
  $after = if ($rollbackIndex -lt ($lines.Count - 1)) { @($lines[($rollbackIndex + 1)..($lines.Count - 1)] | Where-Object { $_ -ne "\echo ROLLBACK COMMAND COMPLETED" }) } else { @() }
  Assert-Condition (@($after).Count -eq 0) "runner has executable SQL after final ROLLBACK" 'RV.RUNNER.AFTER_ROLLBACK' 'RUNNER_CONTENT_AFTER_ROLLBACK'
  $includes = @($lines | Where-Object { $_ -like "\i '*" })
  Assert-Condition ($includes.Count -eq 12) "runner must include exactly twelve migrations" 'RV.RUNNER.INCLUDE_COUNT' 'RUNNER_INCLUDE_COUNT_INVALID'
  Assert-Condition ($Descriptor.ExpectedMigrationOrder.Count -eq 12) "runner descriptor must contain twelve migrations" 'RV.RUNNER.ORDER_COUNT' 'RUNNER_ORDER_COUNT_INVALID'
  for ($i = 0; $i -lt $Descriptor.ExpectedMigrationOrder.Count; $i++) {
    Assert-Condition ($includes[$i] -like "*$($Descriptor.ExpectedMigrationOrder[$i])*") "runner migration order mismatch at $i" 'RV.RUNNER.INCLUDE_ORDER' 'RUNNER_INCLUDE_ORDER_INVALID'
    Assert-Condition ($includes[$i] -like "*$($Descriptor.Namespace)*") "runner include outside artifact namespace" 'RV.RUNNER.INCLUDE_NAMESPACE' 'RUNNER_INCLUDE_NAMESPACE_INVALID'
    Assert-Condition ($includes[$i] -notmatch "(\.\.|\x24|%|;|&|\||>|\<)") "unsafe runner include path" 'RV.RUNNER.INCLUDE_PATH' 'RUNNER_INCLUDE_PATH_UNSAFE'
  }
  $text = Get-Content -Raw -LiteralPath $Descriptor.RunnerPath
  Assert-Condition ($text -notmatch "(?im)^\\(connect|c)\b|^\\!|COPY\s+.*PROGRAM") "runner contains unsafe psql meta-command or external program" 'RV.RUNNER.UNSAFE_COMMAND' 'RUNNER_UNSAFE_COMMAND'
  Assert-Condition ($text -match "ALL MIGRATIONS EXECUTED INSIDE OUTER TRANSACTION") "runner missing all-migrations marker" 'RV.RUNNER.ALL_MARKER' 'RUNNER_ALL_MARKER_MISSING'
  Assert-Condition ($text -match "ROLLBACK COMMAND COMPLETED") "runner missing rollback marker" 'RV.RUNNER.ROLLBACK_MARKER' 'RUNNER_ROLLBACK_MARKER_MISSING'
}

function Assert-ArtifactIntegrity {
  param($Context = $null)
  if ($null -eq $Context) { $Context = New-ProductionRehearsalRuntimeContext }
  $descriptor = & $Context.ArtifactProvider
  Assert-Condition ($null -ne $descriptor) "ARTIFACT_DESCRIPTOR_MISSING" 'RV.ARTIFACT.DESCRIPTOR' 'ARTIFACT_DESCRIPTOR_MISSING'
  foreach ($field in @(
    "FullCommit","ShortCommit","Namespace","Bundle","WrapperPath","ManifestPath","RunnerPath","TokenPath",
    "MigrationPaths","RunnerHash","ManifestHash","TokenHash","ConfirmationToken","MigrationHashes","CanonicalHelperHash",
    "EmbeddedHelperHash","WrapperHash","WrapperBodyHash","ExpectedMigrationOrder","MigrationSpecification",
    "HelperStartMarker","HelperEndMarker","StaleNamespaces"
  )) { Assert-Condition ($null -ne $descriptor.$field) "ARTIFACT_DESCRIPTOR_FIELD_MISSING:$field" 'RV.ARTIFACT.DESCRIPTOR_FIELD' 'ARTIFACT_DESCRIPTOR_FIELD_MISSING' }
  Assert-Condition ($descriptor.FullCommit -match '^[a-f0-9]{40}$') "ARTIFACT_COMMIT_INVALID" 'RV.ARTIFACT.COMMIT_FORMAT' 'ARTIFACT_COMMIT_INVALID'
  Assert-Condition ($descriptor.ShortCommit -eq $descriptor.FullCommit.Substring(0,7)) "ARTIFACT_SHORT_COMMIT_MISMATCH" 'RV.ARTIFACT.SHORT_COMMIT' 'ARTIFACT_SHORT_COMMIT_MISMATCH'
  Assert-Condition ([IO.Path]::GetFileName($descriptor.Bundle) -eq $descriptor.Namespace) "ARTIFACT_NAMESPACE_MISMATCH" 'RV.ARTIFACT.BUNDLE_NAMESPACE' 'ARTIFACT_NAMESPACE_MISMATCH'
  Assert-Condition (@($descriptor.MigrationPaths).Count -eq 12) "ARTIFACT_MIGRATION_COUNT_INVALID" 'RV.ARTIFACT.MIGRATION_COUNT' 'ARTIFACT_MIGRATION_COUNT_INVALID'
  Assert-Condition (@($descriptor.ExpectedMigrationOrder).Count -eq 12) "ARTIFACT_MIGRATION_ORDER_COUNT_INVALID" 'RV.ARTIFACT.ORDER_COUNT' 'ARTIFACT_MIGRATION_ORDER_COUNT_INVALID'
  $canonicalFilenameMatches = @($descriptor.MigrationSpecification).Count -eq 12
  if ($canonicalFilenameMatches) {
    for ($i = 0; $i -lt 12; $i++) {
      $trustedMigration = $descriptor.MigrationSpecification[$i]
      $expectedNumber = '{0:D3}' -f ($i + 6)
      $canonicalFilenameMatches = $trustedMigration.Number -ceq $expectedNumber
      if ($canonicalFilenameMatches) { $canonicalFilenameMatches = $trustedMigration.SourceFile -ceq (Split-Path -Leaf $trustedMigration.SourcePath) }
      if ($canonicalFilenameMatches) { $canonicalFilenameMatches = $trustedMigration.GeneratedFileName.StartsWith(($expectedNumber + '_'), [StringComparison]::Ordinal) }
      if ($canonicalFilenameMatches) { $canonicalFilenameMatches = (Split-Path -Leaf $descriptor.MigrationPaths[$i]) -ceq $trustedMigration.GeneratedFileName }
      if ($canonicalFilenameMatches) {
        $canonicalPath = Join-Path $descriptor.Bundle $trustedMigration.GeneratedFileName
        $canonicalFilenameMatches = [IO.Path]::GetFullPath($descriptor.MigrationPaths[$i]).Equals([IO.Path]::GetFullPath($canonicalPath), [StringComparison]::OrdinalIgnoreCase)
      }
      if (-not $canonicalFilenameMatches) { break }
    }
  }
  Assert-Condition $canonicalFilenameMatches "ARTIFACT_CANONICAL_MIGRATION_FILENAME_MISMATCH" 'RV.ARTIFACT.CANONICAL_FILENAME' 'ARTIFACT_CANONICAL_MIGRATION_FILENAME_MISMATCH'
  foreach ($path in @($descriptor.WrapperPath,$descriptor.ManifestPath,$descriptor.RunnerPath,$descriptor.TokenPath) + @($descriptor.MigrationPaths)) {
    $artifactFileExists = & $Context.FileSystemAdapter.Exists $path
    Assert-Condition $artifactFileExists "ARTIFACT_FILE_MISSING" 'RV.ARTIFACT.FILE_EXISTS' 'ARTIFACT_FILE_MISSING'
  }
  foreach ($path in @($descriptor.RunnerPath,$descriptor.TokenPath) + @($descriptor.MigrationPaths)) {
    $artifactPathIsContained = & $Context.FileSystemAdapter.IsContained $descriptor.Bundle $path
    Assert-Condition $artifactPathIsContained "ARTIFACT_NAMESPACE_MISMATCH" 'RV.ARTIFACT.PATH_CONTAINED' 'ARTIFACT_NAMESPACE_MISMATCH'
    $pathNameContainsCommit = [IO.Path]::GetFileName($path).Contains($descriptor.ShortCommit)
    if (-not $pathNameContainsCommit) {
      Assert-Condition (@($descriptor.MigrationPaths) -contains $path) "ARTIFACT_NAMESPACE_MISMATCH" 'RV.ARTIFACT.PATH_NAMING' 'ARTIFACT_NAMESPACE_MISMATCH'
    }
  }
  foreach ($stale in @($descriptor.StaleNamespaces)) {
    Assert-Condition (-not $descriptor.Namespace.Contains($stale)) "ARTIFACT_STALE_NAMESPACE" 'RV.ARTIFACT.STALE_NAMESPACE' 'ARTIFACT_STALE_NAMESPACE'
  }
  $wrapperText = & $Context.FileSystemAdapter.ReadText $descriptor.WrapperPath
  $startMatches = @([regex]::Matches($wrapperText, [regex]::Escape($descriptor.HelperStartMarker)))
  $endMatches = @([regex]::Matches($wrapperText, [regex]::Escape($descriptor.HelperEndMarker)))
  Assert-Condition ($startMatches.Count -eq 1) "ARTIFACT_HELPER_MARKER_CARDINALITY_INVALID" 'RV.ARTIFACT.HELPER_START_COUNT' 'ARTIFACT_HELPER_MARKER_CARDINALITY_INVALID'
  Assert-Condition ($endMatches.Count -eq 1) "ARTIFACT_HELPER_MARKER_CARDINALITY_INVALID" 'RV.ARTIFACT.HELPER_END_COUNT' 'ARTIFACT_HELPER_MARKER_CARDINALITY_INVALID'
  $helperStart = $startMatches[0].Index + $descriptor.HelperStartMarker.Length
  $helperEnd = $endMatches[0].Index
  Assert-Condition ($helperEnd -gt $helperStart) "ARTIFACT_HELPER_MARKER_ORDER_INVALID" 'RV.ARTIFACT.HELPER_MARKER_ORDER' 'ARTIFACT_HELPER_MARKER_ORDER_INVALID'
  $embeddedHelper = $wrapperText.Substring($helperStart,$helperEnd-$helperStart).Trim("`r","`n")
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $actualEmbeddedHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($embeddedHelper)))).Replace("-","").ToUpperInvariant() }
  finally { $sha.Dispose() }
  Assert-Condition ($descriptor.CanonicalHelperHash -eq $descriptor.EmbeddedHelperHash) "ARTIFACT_HELPER_EXPECTED_HASH_MISMATCH" 'RV.ARTIFACT.HELPER_EXPECTED_HASH' 'ARTIFACT_HELPER_EXPECTED_HASH_MISMATCH'
  Assert-Condition ($actualEmbeddedHash -eq $descriptor.EmbeddedHelperHash) "ARTIFACT_HELPER_BODY_HASH_MISMATCH" 'RV.ARTIFACT.HELPER_BODY_HASH' 'ARTIFACT_HELPER_BODY_HASH_MISMATCH'
  $actualWrapperBodyHash = Get-DescriptorWrapperBodyHash $wrapperText
  Assert-Condition ($descriptor.WrapperHash -match '^[A-F0-9]{64}$') "ARTIFACT_WRAPPER_HASH_INVALID" 'RV.ARTIFACT.WRAPPER_HASH_FORMAT' 'ARTIFACT_WRAPPER_HASH_INVALID'
  Assert-Condition ($descriptor.WrapperBodyHash -match '^[A-F0-9]{64}$') "ARTIFACT_WRAPPER_BODY_HASH_INVALID" 'RV.ARTIFACT.WRAPPER_BODY_HASH_FORMAT' 'ARTIFACT_WRAPPER_BODY_HASH_INVALID'
  Assert-Condition ($descriptor.WrapperHash -eq $descriptor.WrapperBodyHash) "ARTIFACT_WRAPPER_EXPECTED_HASH_MISMATCH" 'RV.ARTIFACT.WRAPPER_EXPECTED_HASH' 'ARTIFACT_WRAPPER_EXPECTED_HASH_MISMATCH'
  Assert-Condition ($actualWrapperBodyHash -eq $descriptor.WrapperBodyHash) "ARTIFACT_WRAPPER_BODY_HASH_MISMATCH" 'RV.ARTIFACT.WRAPPER_BODY_HASH' 'ARTIFACT_WRAPPER_BODY_HASH_MISMATCH'
  $actualRunnerHash = & $Context.FileSystemAdapter.Hash $descriptor.RunnerPath
  Assert-Condition ($actualRunnerHash -eq $descriptor.RunnerHash) "ARTIFACT_RUNNER_HASH_MISMATCH" 'RV.ARTIFACT.RUNNER_HASH' 'ARTIFACT_RUNNER_HASH_MISMATCH'
  $actualManifestHash = & $Context.FileSystemAdapter.Hash $descriptor.ManifestPath
  Assert-Condition ($actualManifestHash -eq $descriptor.ManifestHash) "ARTIFACT_MANIFEST_HASH_MISMATCH" 'RV.ARTIFACT.MANIFEST_HASH' 'ARTIFACT_MANIFEST_HASH_MISMATCH'
  $actualTokenHash = & $Context.FileSystemAdapter.Hash $descriptor.TokenPath
  Assert-Condition ($actualTokenHash -eq $descriptor.TokenHash) "ARTIFACT_TOKEN_HASH_MISMATCH" 'RV.ARTIFACT.TOKEN_HASH' 'ARTIFACT_TOKEN_HASH_MISMATCH'
  $actualToken = ([string](& $Context.FileSystemAdapter.ReadText $descriptor.TokenPath)).Trim()
  Assert-Condition ($actualToken -ceq $descriptor.ConfirmationToken) "ARTIFACT_TOKEN_CONTENT_MISMATCH" 'RV.ARTIFACT.TOKEN_CONTENT' 'ARTIFACT_TOKEN_CONTENT_MISMATCH'
  foreach ($path in @($descriptor.MigrationPaths)) {
    Assert-Condition ($descriptor.MigrationHashes.ContainsKey($path)) "ARTIFACT_MIGRATION_HASH_MISSING" 'RV.ARTIFACT.MIGRATION_HASH_PRESENT' 'ARTIFACT_MIGRATION_HASH_MISSING'
    $actualMigrationHash = & $Context.FileSystemAdapter.Hash $path
    Assert-Condition ($actualMigrationHash -eq $descriptor.MigrationHashes[$path]) "ARTIFACT_MIGRATION_HASH_MISMATCH" 'RV.ARTIFACT.MIGRATION_HASH' 'ARTIFACT_MIGRATION_HASH_MISMATCH'
  }
  $manifest = Parse-Manifest $descriptor.ManifestPath
  Assert-Condition ($manifest.Fields["COMMIT"] -eq $descriptor.FullCommit) "ARTIFACT_MANIFEST_COMMIT_MISMATCH" 'RV.ARTIFACT.MANIFEST_COMMIT' 'ARTIFACT_MANIFEST_COMMIT_MISMATCH'
  Assert-Condition ($manifest.Fields["SHORT"] -eq $descriptor.ShortCommit) "ARTIFACT_MANIFEST_SHORT_COMMIT_MISMATCH" 'RV.ARTIFACT.MANIFEST_SHORT' 'ARTIFACT_MANIFEST_SHORT_COMMIT_MISMATCH'
  Assert-Condition ($manifest.Fields["ARTIFACT_IDENTITY"] -eq $descriptor.Namespace) "ARTIFACT_MANIFEST_NAMESPACE_MISMATCH" 'RV.ARTIFACT.MANIFEST_NAMESPACE' 'ARTIFACT_MANIFEST_NAMESPACE_MISMATCH'
  Assert-Condition ($manifest.Fields["BUNDLE"] -eq $descriptor.Bundle) "ARTIFACT_MANIFEST_BUNDLE_MISMATCH" 'RV.ARTIFACT.MANIFEST_BUNDLE' 'ARTIFACT_MANIFEST_BUNDLE_MISMATCH'
  Assert-Condition ($manifest.Fields["WRAPPER"] -eq $descriptor.WrapperPath) "ARTIFACT_MANIFEST_WRAPPER_MISMATCH" 'RV.ARTIFACT.MANIFEST_WRAPPER' 'ARTIFACT_MANIFEST_WRAPPER_MISMATCH'
  Assert-Condition ($manifest.Fields["WRAPPER_SHA256"] -eq $descriptor.WrapperHash) "ARTIFACT_MANIFEST_WRAPPER_HASH_MISMATCH" 'RV.ARTIFACT.MANIFEST_WRAPPER_HASH' 'ARTIFACT_MANIFEST_WRAPPER_HASH_MISMATCH'
  Assert-Condition ($manifest.Fields["WRAPPER_BODY_SHA256"] -eq $descriptor.WrapperBodyHash) "ARTIFACT_MANIFEST_WRAPPER_BODY_HASH_MISMATCH" 'RV.ARTIFACT.MANIFEST_WRAPPER_BODY_HASH' 'ARTIFACT_MANIFEST_WRAPPER_BODY_HASH_MISMATCH'
  Assert-Condition ($manifest.Fields["RUNNER"] -eq $descriptor.RunnerPath) "ARTIFACT_MANIFEST_RUNNER_MISMATCH" 'RV.ARTIFACT.MANIFEST_RUNNER' 'ARTIFACT_MANIFEST_RUNNER_MISMATCH'
  Assert-Condition ($manifest.Fields["RUNNER_SHA256"] -eq $descriptor.RunnerHash) "ARTIFACT_MANIFEST_RUNNER_HASH_MISMATCH" 'RV.ARTIFACT.MANIFEST_RUNNER_HASH' 'ARTIFACT_MANIFEST_RUNNER_HASH_MISMATCH'
  Assert-Condition ($manifest.Fields["TOKEN_FILE"] -eq $descriptor.TokenPath) "ARTIFACT_MANIFEST_TOKEN_PATH_MISMATCH" 'RV.ARTIFACT.MANIFEST_TOKEN_PATH' 'ARTIFACT_MANIFEST_TOKEN_PATH_MISMATCH'
  Assert-Condition ($manifest.Fields["TOKEN_FILE_SHA256"] -eq $descriptor.TokenHash) "ARTIFACT_MANIFEST_TOKEN_HASH_MISMATCH" 'RV.ARTIFACT.MANIFEST_TOKEN_HASH' 'ARTIFACT_MANIFEST_TOKEN_HASH_MISMATCH'
  Assert-Condition ($manifest.Fields["CONFIRMATION_TOKEN"] -ceq $descriptor.ConfirmationToken) "ARTIFACT_MANIFEST_TOKEN_MISMATCH" 'RV.ARTIFACT.MANIFEST_TOKEN' 'ARTIFACT_MANIFEST_TOKEN_MISMATCH'
  Assert-Condition ($manifest.Fields["CANONICAL_HELPER_SHA256"] -eq $descriptor.CanonicalHelperHash) "ARTIFACT_MANIFEST_CANONICAL_HELPER_HASH_MISMATCH" 'RV.ARTIFACT.MANIFEST_CANONICAL_HELPER_HASH' 'ARTIFACT_MANIFEST_CANONICAL_HELPER_HASH_MISMATCH'
  Assert-Condition ($manifest.Fields["EMBEDDED_HELPER_SHA256"] -eq $descriptor.EmbeddedHelperHash) "ARTIFACT_MANIFEST_EMBEDDED_HELPER_HASH_MISMATCH" 'RV.ARTIFACT.MANIFEST_EMBEDDED_HELPER_HASH' 'ARTIFACT_MANIFEST_EMBEDDED_HELPER_HASH_MISMATCH'
  Assert-Condition ($manifest.Fields["TIMESTAMP_IS_SOURCE_FRESHNESS_PROOF"] -eq "false") "manifest must disclaim timestamp freshness" 'RV.ARTIFACT.MANIFEST_TIMESTAMP_DISCLAIMER' 'ARTIFACT_MANIFEST_TIMESTAMP_INVALID'
  foreach ($stale in @($descriptor.StaleNamespaces)) {
    Assert-Condition ($manifest.Fields["STALE_ARTIFACT_EXCLUSIONS"] -match [regex]::Escape($stale)) "ARTIFACT_MANIFEST_STALE_EXCLUSION_MISSING" 'RV.ARTIFACT.MANIFEST_STALE_EXCLUSION' 'ARTIFACT_MANIFEST_STALE_EXCLUSION_MISSING'
  }
  Assert-Condition (@($manifest.Migrations).Count -eq 12) "ARTIFACT_MANIFEST_MIGRATION_COUNT_INVALID" 'RV.ARTIFACT.MANIFEST_MIGRATION_COUNT' 'ARTIFACT_MANIFEST_MIGRATION_COUNT_INVALID'
  for ($i = 0; $i -lt 12; $i++) {
    $parts = @($manifest.Migrations[$i] -split '\|')
    $expectedNumber = '{0:D3}' -f ($i + 6)
    $trustedMigration = $descriptor.MigrationSpecification[$i]
    Assert-Condition ($parts.Count -eq 6) "ARTIFACT_MANIFEST_MIGRATION_ROW_INVALID:$expectedNumber" 'RV.ARTIFACT.MANIFEST_MIGRATION_ROW_SHAPE' 'ARTIFACT_MANIFEST_MIGRATION_ROW_INVALID'
    Assert-Condition ($parts[0] -eq $expectedNumber) "ARTIFACT_MANIFEST_MIGRATION_ROW_INVALID:$expectedNumber" 'RV.ARTIFACT.MANIFEST_MIGRATION_NUMBER' 'ARTIFACT_MANIFEST_MIGRATION_ROW_INVALID'
    Assert-Condition ($parts[1] -ceq $trustedMigration.SourcePath) "ARTIFACT_MANIFEST_MIGRATION_SOURCE_MISMATCH:$expectedNumber" 'RV.ARTIFACT.MANIFEST_MIGRATION_SOURCE' 'ARTIFACT_MANIFEST_MIGRATION_SOURCE_MISMATCH'
    $expectedManifestPath = $trustedMigration.GeneratedFileName
    Assert-Condition ($parts[2] -ceq $expectedManifestPath) "ARTIFACT_MANIFEST_MIGRATION_PATH_MISMATCH:$expectedNumber" 'RV.ARTIFACT.MANIFEST_MIGRATION_PATH' 'ARTIFACT_MANIFEST_MIGRATION_PATH_MISMATCH'
    Assert-Condition ($parts[4] -match '^source_sha256=[A-Fa-f0-9]{64}$') "ARTIFACT_MANIFEST_SOURCE_HASH_INVALID:$expectedNumber" 'RV.ARTIFACT.MANIFEST_SOURCE_HASH' 'ARTIFACT_MANIFEST_SOURCE_HASH_INVALID'
    Assert-Condition ($parts[5] -eq ('generated_sha256=' + $descriptor.MigrationHashes[$descriptor.MigrationPaths[$i]])) "ARTIFACT_MANIFEST_MIGRATION_HASH_MISMATCH:$expectedNumber" 'RV.ARTIFACT.MANIFEST_MIGRATION_HASH' 'ARTIFACT_MANIFEST_MIGRATION_HASH_MISMATCH'
  }
  Assert-RunnerContract $descriptor
}

function Assert-GitState {
  param($Context = $null)
  $state = if ($null -eq $Context) { & (New-ProductionRehearsalRuntimeContext).GitStateProvider } else { & $Context.GitStateProvider }
  Assert-Condition ($state.Branch -eq $ExpectedBranch) "branch mismatch" 'RV.GIT.BRANCH' 'GIT_BRANCH_MISMATCH'
  Assert-Condition ($state.Head -eq $ExpectedCommit) "HEAD mismatch" 'RV.GIT.HEAD' 'GIT_HEAD_MISMATCH'
  Assert-Condition (@($state.Staged).Count -eq 0) "staged files present" 'RV.GIT.STAGED' 'GIT_STAGED_FILES_PRESENT'
  Assert-Condition (@($state.Modified).Count -eq 0) "tracked worktree modifications present" 'RV.GIT.MODIFIED' 'GIT_TRACKED_MODIFICATIONS_PRESENT'
}

function Parse-TargetDatabaseUrl([string]$Url, [scriptblock]$UriFactory = $null, [scriptblock]$UrlDecoder = $null) {
  if ($null -eq $UriFactory) { $UriFactory = { param($value) [Uri]$value } }
  if ($null -eq $UrlDecoder) { $UrlDecoder = { param($value) [Uri]::UnescapeDataString($value) } }
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($Url)) "DatabaseUrl is required" 'RV.URL.REQUIRED' 'DATABASE_URL_REQUIRED'
  Assert-Condition ($Url -notmatch "%(?![0-9A-Fa-f]{2})") "DatabaseUrl contains malformed percent encoding" 'RV.URL.PERCENT_ENCODING' 'DATABASE_URL_PERCENT_ENCODING_INVALID'
  try { $uri = & $UriFactory $Url } catch { Assert-Condition $false "DatabaseUrl is malformed" 'RV.URL.MALFORMED' 'DATABASE_URL_MALFORMED' }
  Assert-Condition ($uri.IsAbsoluteUri) "DatabaseUrl must be absolute" 'RV.URL.ABSOLUTE' 'DATABASE_URL_NOT_ABSOLUTE'
  Assert-Condition ($uri.Scheme -in @("postgres","postgresql")) "DatabaseUrl must be PostgreSQL" 'RV.URL.SCHEME' 'DATABASE_URL_SCHEME_INVALID'
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($uri.Host)) "DatabaseUrl host is required" 'RV.URL.HOST' 'DATABASE_URL_HOST_REQUIRED'
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($uri.UserInfo)) "DatabaseUrl username is required" 'RV.URL.USER_INFO' 'DATABASE_URL_USERNAME_REQUIRED'
  Assert-Condition ([string]::IsNullOrEmpty($uri.Fragment)) "DatabaseUrl fragments are not allowed" 'RV.URL.FRAGMENT' 'DATABASE_URL_FRAGMENT_FORBIDDEN'
  Assert-Condition ($uri.UserInfo -notmatch ":") "DatabaseUrl must not contain a password" 'RV.URL.PASSWORD' 'DATABASE_URL_PASSWORD_FORBIDDEN'
  try { $user = & $UrlDecoder $uri.UserInfo } catch { Assert-Condition $false "DatabaseUrl username encoding is invalid" 'RV.URL.USER_ENCODING' 'DATABASE_URL_USERNAME_ENCODING_INVALID' }
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($user)) "DatabaseUrl username is required" 'RV.URL.USER' 'DATABASE_URL_USERNAME_REQUIRED'

  $rawDatabase = $uri.AbsolutePath
  Assert-Condition ($rawDatabase.StartsWith("/")) "DatabaseUrl database name is required" 'RV.URL.DATABASE_PATH_PREFIX' 'DATABASE_URL_DATABASE_REQUIRED'
  Assert-Condition ($rawDatabase.Length -gt 1) "DatabaseUrl database name is required" 'RV.URL.DATABASE_PATH_LENGTH' 'DATABASE_URL_DATABASE_REQUIRED'
  Assert-Condition ($rawDatabase.Trim("/") -notmatch "/") "DatabaseUrl database name must be one path segment" 'RV.URL.DATABASE_SEGMENT' 'DATABASE_URL_DATABASE_SEGMENT_INVALID'
  try { $database = & $UrlDecoder $rawDatabase.Trim("/") } catch { Assert-Condition $false "DatabaseUrl database encoding is invalid" 'RV.URL.DATABASE_ENCODING' 'DATABASE_URL_DATABASE_ENCODING_INVALID' }
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($database)) "DatabaseUrl database name is required" 'RV.URL.DATABASE_NAME' 'DATABASE_URL_DATABASE_REQUIRED'
  Assert-Condition ($database -notin @("=disable", "disable", ".", "..")) "DatabaseUrl database name is invalid" 'RV.URL.DATABASE_VALUE' 'DATABASE_URL_DATABASE_INVALID'

  $sslValues = @()
  if (-not [string]::IsNullOrEmpty($uri.Query)) {
    foreach ($part in $uri.Query.TrimStart("?").Split("&")) {
      Assert-Condition (-not [string]::IsNullOrWhiteSpace($part)) "DatabaseUrl query syntax is invalid" 'RV.URL.QUERY_PART' 'DATABASE_URL_QUERY_SYNTAX_INVALID'
      $kv = $part -split "=", 2
      Assert-Condition (@($kv).Count -eq 2) "DatabaseUrl query syntax is invalid" 'RV.URL.QUERY_SHAPE' 'DATABASE_URL_QUERY_SYNTAX_INVALID'
      Assert-Condition (-not [string]::IsNullOrWhiteSpace($kv[0])) "DatabaseUrl query syntax is invalid" 'RV.URL.QUERY_KEY' 'DATABASE_URL_QUERY_SYNTAX_INVALID'
      try { $key = & $UrlDecoder $kv[0]; $value = & $UrlDecoder $kv[1] } catch { Assert-Condition $false "DatabaseUrl query encoding is invalid" 'RV.URL.QUERY_ENCODING' 'DATABASE_URL_QUERY_ENCODING_INVALID' }
      if ($key -eq "sslmode") { $sslValues += $value }
    }
  }
  Assert-Condition (@($sslValues).Count -eq 1) "DatabaseUrl must contain exactly one sslmode=require" 'RV.URL.SSLMODE_COUNT' 'DATABASE_URL_SSLMODE_COUNT_INVALID'
  Assert-Condition ($sslValues[0] -eq "require") "DatabaseUrl sslmode must be require" 'RV.URL.SSLMODE_VALUE' 'DATABASE_URL_SSLMODE_VALUE_INVALID'
  [pscustomobject]@{ Host = $uri.Host; Port = if ($uri.Port -gt 0) { [string]$uri.Port } else { "5432" }; User = $user; Database = $database }
}

function Assert-PasswordFreeDatabaseUrl([string]$Url) {
  [void](Parse-TargetDatabaseUrl $Url)
}

function ConvertTo-SqlLiteral([string]$Value) {
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($Value)) "Expected database identity is required" 'RV.SQL_LITERAL.REQUIRED' 'SQL_LITERAL_REQUIRED'
  Assert-Condition ($Value.IndexOf([char]0) -lt 0) "Expected database identity contains an invalid character" 'RV.SQL_LITERAL.NUL' 'SQL_LITERAL_NUL_FORBIDDEN'
  return "'" + ($Value -replace "'", "''") + "'"
}

function New-TemporaryPgPassFile([string]$HostName, [string]$Port, [string]$Database, [string]$UserName, [securestring]$Password, $Context=$null) {
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  try {
    $escaped = $plain -replace "\\", "\\" -replace ":", "\:"
    $line = "$HostName`:$Port`:$Database`:$UserName`:$escaped"
    $path = Join-Path ([System.IO.Path]::GetTempPath()) ("deraledger-rehearsal-" + [guid]::NewGuid().ToString("N") + ".pgpass")
    Assert-Condition (-not ([IO.Path]::GetFullPath($path)).StartsWith(([IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase)) "Credential file must be outside repository" 'RV.PGPASS.OUTSIDE_REPOSITORY' 'PGPASS_PATH_INSIDE_REPOSITORY'
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($line)
    if ($null -eq $Context) { [IO.File]::WriteAllBytes($path,$bytes) }
    else { & $Context.FileSystemAdapter.WriteBytes $path $bytes }
    return $path
  } finally {
    $plain = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}

function Initialize-DeraLedgerProcessNative {
  if ($null -ne ('DeraLedger.Rehearsal.ProcessNative' -as [type])) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace DeraLedger.Rehearsal {
  public sealed class KernelHandle : SafeHandleZeroOrMinusOneIsInvalid {
    public KernelHandle() : base(true) {}
    public KernelHandle(IntPtr value) : base(true) { SetHandle(value); }
    protected override bool ReleaseHandle() { return ProcessNative.CloseHandle(handle); }
  }

  public struct ProcessEntry {
    public int ProcessId;
    public int ParentProcessId;
  }

  public static class ProcessNative {
    private const uint PROCESS_TERMINATE = 0x0001;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private const uint DUPLICATE_SAME_ACCESS = 0x00000002;
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint WAIT_TIMEOUT = 0x00000102;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32 {
      public uint dwSize;
      public uint cntUsage;
      public uint th32ProcessID;
      public IntPtr th32DefaultHeapID;
      public uint th32ModuleID;
      public uint cntThreads;
      public uint th32ParentProcessID;
      public int pcPriClassBase;
      public uint dwFlags;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr sourceHandle, IntPtr targetProcess, out IntPtr targetHandle, uint desiredAccess, bool inheritHandle, uint options);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(KernelHandle process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(KernelHandle process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(KernelHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32FirstW(KernelHandle snapshot, ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32NextW(KernelHandle snapshot, ref PROCESSENTRY32 entry);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);

    public static KernelHandle DuplicateOriginalHandle(IntPtr sourceHandle) {
      IntPtr duplicate;
      IntPtr current = GetCurrentProcess();
      if (!DuplicateHandle(current, sourceHandle, current, out duplicate, 0, false, DUPLICATE_SAME_ACCESS)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return new KernelHandle(duplicate);
    }

    public static KernelHandle OpenIdentityHandle(int processId) {
      IntPtr value = OpenProcess(PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, processId);
      return value == IntPtr.Zero ? null : new KernelHandle(value);
    }

    public static long GetCreationTime(KernelHandle process) {
      long creation, exit, kernel, user;
      if (!GetProcessTimes(process, out creation, out exit, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
      return creation;
    }

    public static bool IsAlive(KernelHandle process) {
      uint result = WaitForSingleObject(process, 0);
      if (result == WAIT_TIMEOUT) return true;
      if (result == WAIT_OBJECT_0) return false;
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public static bool Terminate(KernelHandle process) {
      if (!IsAlive(process)) return true;
      return TerminateProcess(process, 124);
    }

    public static bool WaitForExit(KernelHandle process, int milliseconds) {
      uint result = WaitForSingleObject(process, (uint)milliseconds);
      if (result == WAIT_OBJECT_0) return true;
      if (result == WAIT_TIMEOUT) return false;
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public static void ThrowIdentityCaptureFailed() {
      throw new InvalidOperationException("PROCESS_IDENTITY_CAPTURE_FAILED");
    }

    public static void Rethrow(Exception error) {
      throw error;
    }

    public static ProcessEntry[] SnapshotProcesses() {
      using (KernelHandle snapshot = new KernelHandle(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0))) {
        if (snapshot.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var rows = new List<ProcessEntry>();
        var entry = new PROCESSENTRY32();
        entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
        if (!Process32FirstW(snapshot, ref entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
        do {
          rows.Add(new ProcessEntry { ProcessId = (int)entry.th32ProcessID, ParentProcessId = (int)entry.th32ParentProcessID });
          entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
        } while (Process32NextW(snapshot, ref entry));
        return rows.ToArray();
      }
    }
  }
}
'@
}

function New-WindowsProcessPlatform {
  Initialize-DeraLedgerProcessNative
  [pscustomobject]@{
    CaptureRoot = {
      param($process)
      $handle = [DeraLedger.Rehearsal.ProcessNative]::DuplicateOriginalHandle($process.Handle)
      try {
        $creation = [DeraLedger.Rehearsal.ProcessNative]::GetCreationTime($handle)
        [pscustomobject]@{ProcessId=$process.Id;CreationTime=$creation;Handle=$handle;IsRoot=$true;ParentKey='';TerminationBoundary=0L}
      } catch {
        $captureError = $_.Exception
        $handle.Dispose()
        [DeraLedger.Rehearsal.ProcessNative]::Rethrow($captureError)
      }
    }
    SnapshotEntries = { @([DeraLedger.Rehearsal.ProcessNative]::SnapshotProcesses()) }
    CaptureDescendant = {
      param($entry)
      $handle = [DeraLedger.Rehearsal.ProcessNative]::OpenIdentityHandle([int]$entry.ProcessId)
      if ($null -eq $handle -or $handle.IsInvalid) {
        if ($null -ne $handle) { $handle.Dispose() }
        $stillPresent = @([DeraLedger.Rehearsal.ProcessNative]::SnapshotProcesses() | Where-Object { $_.ProcessId -eq $entry.ProcessId -and $_.ParentProcessId -eq $entry.ParentProcessId }).Count -gt 0
        if ($stillPresent) { [DeraLedger.Rehearsal.ProcessNative]::ThrowIdentityCaptureFailed() }
        return $null
      }
      try {
        $creation = [DeraLedger.Rehearsal.ProcessNative]::GetCreationTime($handle)
        [pscustomobject]@{ProcessId=[int]$entry.ProcessId;CreationTime=$creation;Handle=$handle;IsRoot=$false;ParentKey='';TerminationBoundary=0L}
      } catch {
        $captureError = $_.Exception
        $handle.Dispose()
        [DeraLedger.Rehearsal.ProcessNative]::Rethrow($captureError)
      }
    }
    IsAlive = { param($identity) [DeraLedger.Rehearsal.ProcessNative]::IsAlive($identity.Handle) }
    Terminate = { param($identity) [DeraLedger.Rehearsal.ProcessNative]::Terminate($identity.Handle) }
    WaitForExit = { param($identity,$milliseconds) [DeraLedger.Rehearsal.ProcessNative]::WaitForExit($identity.Handle,[int]$milliseconds) }
    Dispose = { param($identity) $identity.Handle.Dispose() }
    NowFileTime = { [DateTime]::UtcNow.ToFileTimeUtc() }
  }
}

function Get-NativeIdentityKey($Identity) {
  return "$($Identity.ProcessId):$($Identity.CreationTime)"
}

function Add-RetainedDescendants($Platform, $Captured, $IdentityKeys) {
  $added = [Collections.Generic.List[object]]::new()
  foreach ($entry in @(& $Platform.SnapshotEntries)) {
    $parentCandidates = @($Captured | Where-Object { $_.ProcessId -eq [int]$entry.ParentProcessId })
    if ($parentCandidates.Count -eq 0) { continue }
    $identity = & $Platform.CaptureDescendant $entry
    if ($null -eq $identity) { continue }
    $retain = $false
    try {
      $eligibleParents = @($parentCandidates | Where-Object {
        $_.CreationTime -le $identity.CreationTime -and ($_.TerminationBoundary -eq 0 -or $identity.CreationTime -le $_.TerminationBoundary)
      } | Sort-Object CreationTime -Descending)
      if ($eligibleParents.Count -eq 0) { continue }
      $identity.ParentKey = Get-NativeIdentityKey $eligibleParents[0]
      $key = Get-NativeIdentityKey $identity
      if ($IdentityKeys.ContainsKey($key)) { continue }
      $IdentityKeys[$key] = $true
      $Captured.Add($identity)
      $added.Add($identity)
      $retain = $true
    } finally {
      if (-not $retain) { & $Platform.Dispose $identity }
    }
  }
  return @($added)
}

function Wait-RetainedIdentities($Platform, [object[]]$Identities, [int]$TimeoutMilliseconds = 5000) {
  $survivors = [Collections.Generic.List[object]]::new()
  foreach ($identity in @($Identities)) {
    if (-not (& $Platform.WaitForExit $identity $TimeoutMilliseconds)) { $survivors.Add($identity) }
  }
  return @($survivors)
}

function Invoke-RetainedIdentityCleanup($Platform, [object[]]$Identities) {
  foreach ($identity in @($Identities)) {
    try { if (& $Platform.IsAlive $identity) { [void](& $Platform.Terminate $identity) } } catch {}
  }
  [void](Wait-RetainedIdentities $Platform $Identities 5000)
}

function Invoke-NativeChecked(
  [string]$FilePath, [string[]]$Arguments, [string]$StdoutPath, [string]$StderrPath,
  [int]$TimeoutSeconds, [string[]]$SensitiveValues=@(),
  $ProcessPlatform=$null
) {
  $started = [Diagnostics.Stopwatch]::StartNew()
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = Join-NativeArguments $Arguments
  $process = $null
  $result = $null
  $captured = [Collections.Generic.List[object]]::new()
  $identityKeys = @{}
  $disposedIdentityCount = 0
  if ($null -eq $ProcessPlatform) { $ProcessPlatform = New-WindowsProcessPlatform }
  try {
    $process = Invoke-ProcessStart $psi
    $rootIdentity = $null
    $rootCaptureSucceeded = $false
    try {
      $rootIdentity = & $ProcessPlatform.CaptureRoot $process
      if ($null -ne $rootIdentity) {
        $captured.Add($rootIdentity)
        $identityKeys[(Get-NativeIdentityKey $rootIdentity)] = $true
        $rootCaptureSucceeded = $true
      }
    } catch {}
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
    $processTreeTerminated = $false
    $terminationCommandSucceeded = $false
    $identityCaptureSucceeded = $rootCaptureSucceeded
    $treeStable = $false
    $survivors = @()
    if ($timedOut) {
      try {
        if ($rootCaptureSucceeded) {
          try {
          $stableScans = 0
          for ($scan = 0; $scan -lt 20 -and $stableScans -lt 2; $scan++) {
            $newIdentities = @(Add-RetainedDescendants $ProcessPlatform $captured $identityKeys)
            if ($newIdentities.Count -eq 0) { $stableScans++; Start-Sleep -Milliseconds 100 } else { $stableScans = 0 }
          }
            if ($stableScans -lt 2) { $identityCaptureSucceeded = $false }
          } catch {
            $identityCaptureSucceeded = $false
          }
        }

        $terminationCommandSucceeded = $identityCaptureSucceeded
        if ($rootCaptureSucceeded) {
          foreach ($identity in @($captured)) {
            $terminated = $false
            try { $terminated = [bool](& $ProcessPlatform.Terminate $identity) } catch {}
            $identity.TerminationBoundary = [long](& $ProcessPlatform.NowFileTime)
            if (-not $terminated) { $terminationCommandSucceeded = $false }
          }
        }

        $survivors = @(Wait-RetainedIdentities $ProcessPlatform @($captured) 5000)
        if ($survivors.Count -gt 0) { $terminationCommandSucceeded = $false }

        $stableScans = 0
        for ($scan = 0; $scan -lt 20 -and $stableScans -lt 2; $scan++) {
          $late = @()
          try { $late = @(Add-RetainedDescendants $ProcessPlatform $captured $identityKeys) } catch { $identityCaptureSucceeded = $false; break }
          if ($late.Count -eq 0) {
            $stableScans++
            Start-Sleep -Milliseconds 100
            continue
          }
          $stableScans = 0
          foreach ($identity in $late) {
            $terminated = $false
            try { $terminated = [bool](& $ProcessPlatform.Terminate $identity) } catch {}
            $identity.TerminationBoundary = [long](& $ProcessPlatform.NowFileTime)
            if (-not $terminated) { $terminationCommandSucceeded = $false }
          }
          $lateSurvivors = @(Wait-RetainedIdentities $ProcessPlatform $late 5000)
          if ($lateSurvivors.Count -gt 0) { $terminationCommandSucceeded = $false }
        }
        $treeStable = $stableScans -ge 2
        $survivors = @($captured | Where-Object { try { & $ProcessPlatform.IsAlive $_ } catch { $true } })
        $processTreeTerminated = $identityCaptureSucceeded -and $terminationCommandSucceeded -and $treeStable -and $survivors.Count -eq 0
      } finally {
        if (-not $processTreeTerminated) { Invoke-RetainedIdentityCleanup $ProcessPlatform @($captured) }
        if (-not $rootCaptureSucceeded -and -not $process.HasExited) { try { $process.Kill(); [void]$process.WaitForExit(5000) } catch {} }
      }
    } else {
      $process.WaitForExit()
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    foreach ($value in @($SensitiveValues | Where-Object { -not [string]::IsNullOrEmpty($_) })) {
      $stdout = $stdout.Replace($value,"[REDACTED]")
      $stderr = $stderr.Replace($value,"[REDACTED]")
    }
    $encoding = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($StdoutPath,$stdout,$encoding)
    [IO.File]::WriteAllText($StderrPath,$stderr,$encoding)
    $result = [pscustomobject]@{
      ExitCode=if($timedOut){124}else{$process.ExitCode}; TimedOut=$timedOut; Stdout=$stdout; Stderr=$stderr
      DurationMs=$started.ElapsedMilliseconds; ProcessId=$process.Id; ProcessTreeTerminated=$processTreeTerminated
      TerminationCommandSucceeded=$terminationCommandSucceeded; IdentityCaptureSucceeded=$identityCaptureSucceeded
      SurvivingOriginalProcessCount=@($survivors).Count; RetainedIdentityCount=$captured.Count
      DisposedIdentityCount=0; Disposed=$false
    }
  } finally {
    $started.Stop()
    foreach ($identity in @($captured)) {
      try { & $ProcessPlatform.Dispose $identity; $disposedIdentityCount++ } catch {}
    }
    if ($null -ne $result) { $result.DisposedIdentityCount = $disposedIdentityCount }
    if ($null -ne $process) {
      $process.Dispose()
      if ($null -ne $result) { $result.Disposed = $true }
    }
  }
  return $result
}

function Assert-RunnerMarkers([string]$Output) {
  $running = @([regex]::Matches($Output, "RUNNING MIGRATION\s+0(0[6-9]|1[0-7])"))
  $passed = @([regex]::Matches($Output, "PASSED MIGRATION\s+0(0[6-9]|1[0-7])"))
  Assert-Condition ($running.Count -eq 12) "Expected 12 RUNNING markers" 'RV.MARKERS.RUNNING_COUNT' 'RUNNER_RUNNING_MARKER_COUNT_INVALID'
  Assert-Condition ($passed.Count -eq 12) "Expected 12 PASSED markers" 'RV.MARKERS.PASSED_COUNT' 'RUNNER_PASSED_MARKER_COUNT_INVALID'
  Assert-Condition ($Output -match "ALL MIGRATIONS EXECUTED INSIDE OUTER TRANSACTION") "All-migrations marker missing" 'RV.MARKERS.ALL_MIGRATIONS' 'RUNNER_ALL_MARKER_MISSING'
  Assert-Condition ($Output -match "ROLLBACK COMMAND COMPLETED") "Rollback-completed marker missing" 'RV.MARKERS.ROLLBACK' 'RUNNER_ROLLBACK_MARKER_MISSING'
}

function Invoke-OfflineValidation {
  param($Context = $null, [string]$ValidationTargetUrl = "postgresql://user@example.invalid/database?sslmode=require")
  if ($null -eq $Context) { $Context = New-ProductionRehearsalRuntimeContext }
  Assert-ArtifactIntegrity $Context
  $sample = "banner`r`nCONTROL|database_matches=true|server_major=17|tls_active=true|transaction_read_only=on|payment_events_present=true|payment_events_merchant_id_uuid=true|payment_events_merchant_id_nullable=true|payment_events_processor_compatible=true|payment_events_processed_at_compatible=true|invoice_fk_classification=canonical_set_null|merchant_fk_classification=canonical_cascade|platform_settings_present=true|plan_migration_solo_lite_enabled=false|solo_plus_enabled=false|solo_plus_kyc_enabled=false|conflicting_rehearsal_session_count=0|conflicting_lock_count=0|prepared_transaction_count=0|rollback_sensitive_fingerprint=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  $map = Convert-ControlRow $sample
  Assert-ControlAccepted $map $true
  $target = Parse-TargetDatabaseUrl $ValidationTargetUrl
  Assert-Condition ($target.Database -eq "database") "structured URL parser returned the wrong database" 'RV.OFFLINE.URL_DATABASE' 'OFFLINE_URL_DATABASE_MISMATCH'
  Write-Output "OfflineValidateOnly: PASS"
}

function Invoke-ArtifactValidationOnly {
  param($Context = $null)
  if ($null -eq $Context) { $Context = New-ProductionRehearsalRuntimeContext }
  Assert-ArtifactIntegrity $Context
  Write-Output "ArtifactValidationOnly: PASS - finalized runtime artifacts accepted; credential and database boundaries not reached"
}

function Invoke-Rehearsal {
  param($Context = $null, [scriptblock]$ControlSqlPathFactory = $null, [string]$EvidenceRoot = '')
  if ($null -eq $Context) { $Context = New-ProductionRehearsalRuntimeContext }
  if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) { $EvidenceRoot = $RepoRoot }
  Assert-Condition $ExecuteRehearsal "Explicit -ExecuteRehearsal mode is required" 'RV.REHEARSAL.MODE' 'REHEARSAL_MODE_REQUIRED'
  Assert-Condition ($ConfirmationToken -eq $ExpectedToken) "Wrong confirmation token" 'RV.REHEARSAL.CONFIRMATION_TOKEN' 'REHEARSAL_CONFIRMATION_TOKEN_INVALID'
  Assert-GitState $Context
  Invoke-ArtifactValidationOnly $Context | Out-Null
  $target = Parse-TargetDatabaseUrl $DatabaseUrl
  $psqlExists = & $Context.ExecutableResolver $PsqlPath
  Assert-Condition $psqlExists "PsqlPath does not exist" 'RV.REHEARSAL.PSQL_PATH' 'REHEARSAL_PSQL_PATH_MISSING'
  $pgDumpExists = & $Context.ExecutableResolver $PgDumpPath
  Assert-Condition $pgDumpExists "PgDumpPath does not exist" 'RV.REHEARSAL.PGDUMP_PATH' 'REHEARSAL_PGDUMP_PATH_MISSING'
  $snapshot = Get-EnvironmentSnapshot
  Invoke-RehearsalLifecycle $Context {
    $hostName = $target.Host
    $port = $target.Port
    $database = $target.Database
    $userName = $target.User
    $securePassword = & $Context.CredentialProvider
    Clear-PostgresRoutingEnvironment
    [Environment]::SetEnvironmentVariable("PGSSLMODE", "require", "Process")
    [Environment]::SetEnvironmentVariable("PGGSSENCMODE", "disable", "Process")
    [Environment]::SetEnvironmentVariable("PGCONNECT_TIMEOUT", "10", "Process")
    [Environment]::SetEnvironmentVariable("PGAPPNAME", "deraledger-$ShortCommit-rollback-only-rehearsal", "Process")
    $script:PgPassFileToDelete = New-TemporaryPgPassFile $hostName $port $database $userName $securePassword $Context
    [Environment]::SetEnvironmentVariable("PGPASSFILE", $script:PgPassFileToDelete, "Process")
    [Environment]::SetEnvironmentVariable("PGPASSWORD", $null, "Process")
    $script:ControlSqlFileToDelete = if($null -eq $ControlSqlPathFactory){Join-Path ([System.IO.Path]::GetTempPath()) ("deraledger-control-" + [guid]::NewGuid().ToString("N") + ".sql")}else{& $ControlSqlPathFactory $RepoRoot}
    Assert-Condition (-not ([IO.Path]::GetFullPath($script:ControlSqlFileToDelete)).StartsWith(([IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase)) "Temporary SQL file must be outside repository" 'RV.REHEARSAL.CONTROL_SQL_PATH' 'REHEARSAL_CONTROL_SQL_PATH_INVALID'
    & $Context.FileSystemAdapter.WriteText $script:ControlSqlFileToDelete (New-ControlSql $database)
    $conn = Invoke-RehearsalProcess $Context $PsqlPath @("-X","-w","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"-c","\conninfo") (Join-Path $EvidenceRoot "$EvidencePrefix-conninfo.stdout.txt") (Join-Path $EvidenceRoot "$EvidencePrefix-conninfo.stderr.txt") 60
    $clientTlsActive = Assert-Psql17ClientTls $conn
    $pre = Invoke-RehearsalProcess $Context $PsqlPath @("-X","-w","-q","-A","-t","-v","ON_ERROR_STOP=1","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"-f",$script:ControlSqlFileToDelete) (Join-Path $EvidenceRoot "$EvidencePrefix-preflight.stdout.txt") (Join-Path $EvidenceRoot "$EvidencePrefix-preflight.stderr.txt") 120
    Assert-RehearsalProcessResult $pre "preflight"
    $preControl = Convert-ControlRow $pre.Stdout
    Assert-ControlAccepted $preControl $clientTlsActive
    $preDump = Join-Path $EvidenceRoot "$EvidencePrefix-pre-schema.sql"
    $postDump = Join-Path $EvidenceRoot "$EvidencePrefix-post-schema.sql"
    $dump1 = Invoke-RehearsalProcess $Context $PgDumpPath @("--schema-only","--schema=public","--no-owner","--no-privileges","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"--file",$preDump) (Join-Path $EvidenceRoot "$EvidencePrefix-pre-schema.stdout.txt") (Join-Path $EvidenceRoot "$EvidencePrefix-pre-schema.stderr.txt") 300
    Assert-RehearsalProcessResult $dump1 "pre-schema"
    $runner = Invoke-RehearsalProcess $Context $PsqlPath @("-X","-w","-v","ON_ERROR_STOP=1","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"-f",$RunnerPath) (Join-Path $EvidenceRoot "$EvidencePrefix-runner.stdout.txt") (Join-Path $EvidenceRoot "$EvidencePrefix-runner.stderr.txt") 1800
    Assert-RehearsalProcessResult $runner "runner"
    Assert-RunnerMarkers $runner.Stdout
    $dump2 = Invoke-RehearsalProcess $Context $PgDumpPath @("--schema-only","--schema=public","--no-owner","--no-privileges","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"--file",$postDump) (Join-Path $EvidenceRoot "$EvidencePrefix-post-schema.stdout.txt") (Join-Path $EvidenceRoot "$EvidencePrefix-post-schema.stderr.txt") 300
    Assert-RehearsalProcessResult $dump2 "post-schema"
    $preSchemaHash = Sha256 $preDump
    $postSchemaHash = Sha256 $postDump
    Assert-Condition ($preSchemaHash -eq $postSchemaHash) "Pre/post schema hashes differ" 'RV.REHEARSAL.SCHEMA_HASH' 'REHEARSAL_SCHEMA_HASH_MISMATCH'
    $post = Invoke-RehearsalProcess $Context $PsqlPath @("-X","-w","-q","-A","-t","-v","ON_ERROR_STOP=1","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"-f",$script:ControlSqlFileToDelete) (Join-Path $EvidenceRoot "$EvidencePrefix-postflight.stdout.txt") (Join-Path $EvidenceRoot "$EvidencePrefix-postflight.stderr.txt") 120
    Assert-RehearsalProcessResult $post "postflight"
    $postControl = Convert-ControlRow $post.Stdout
    Assert-ControlAccepted $postControl $clientTlsActive
    Assert-ControlProofEqual $preControl $postControl
    Write-Output "Rehearsal accepted: True"
  } { @($script:PgPassFileToDelete,$script:ControlSqlFileToDelete) } { } $snapshot
}
