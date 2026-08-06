Set-StrictMode -Version Latest

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
    -ProcessAdapter { param($request) Invoke-NativeChecked $request.FilePath $request.Arguments $request.StdoutPath $request.StderrPath $request.TimeoutSeconds $request.SensitiveValues } `
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
    -PackageGenerationBoundary { throw "Package generation boundary is generator-owned" } `
    -SqlExecutionBoundary { param($context,$request) & $context.ProcessAdapter $request }
}

function Get-ProductionArtifactDescriptor {
  $orderedMigrationPaths = @($ExpectedMigrationHashes.Keys | Sort-Object {
    $leaf = (Split-Path -Leaf $_) -replace '^\d{3}_', ''
    [array]::IndexOf($ExpectedMigrationOrder, $leaf)
  })
  [pscustomobject]@{
    FullCommit=$ExpectedCommit; ShortCommit=$ShortCommit; Namespace=$ArtifactIdentity
    Bundle=(Split-Path -Parent $RunnerPath); WrapperPath=$PSCommandPath; ManifestPath=$ManifestPath
    RunnerPath=$RunnerPath; TokenPath=$TokenFilePath; MigrationPaths=$orderedMigrationPaths
    RunnerHash=$ExpectedRunnerHash; ManifestHash=$ExpectedManifestHash; TokenHash=$ExpectedTokenFileHash
    MigrationHashes=$ExpectedMigrationHashes; CanonicalHelperHash=$ExpectedCanonicalHelperHash
    EmbeddedHelperHash=$ExpectedEmbeddedHelperHash; WrapperHash=$ExpectedWrapperHash
    WrapperBodyHash=$ExpectedWrapperBodyHash; ExpectedMigrationOrder=@($ExpectedMigrationOrder)
    HelperStartMarker=("# BEGIN EMBEDDED " + "CANONICAL REHEARSAL HELPER")
    HelperEndMarker=("# END EMBEDDED " + "CANONICAL REHEARSAL HELPER")
    StaleNamespaces=@($StaleCommitNamespaces)
  }
}

function Invoke-RehearsalProcess {
  param($Context, [string]$FilePath, [string[]]$Arguments, [string]$StdoutPath, [string]$StderrPath, [int]$TimeoutSeconds, [string[]]$SensitiveValues=@())
  $request = [pscustomobject]@{FilePath=$FilePath;Arguments=$Arguments;StdoutPath=$StdoutPath;StderrPath=$StderrPath;TimeoutSeconds=$TimeoutSeconds;SensitiveValues=@($SensitiveValues)}
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
  Assert-Condition (-not $Result.TimedOut) "PROCESS_TIMEOUT:${Operation}"
  Assert-Condition ($Result.ExitCode -eq 0) "PROCESS_NONZERO_EXIT:${Operation}:$($Result.ExitCode)"
}

function Invoke-RehearsalLifecycle {
  param($Context, [scriptblock]$Body, [scriptblock]$CleanupPathProvider, [scriptblock]$PersistEvidence, [hashtable]$EnvironmentSnapshot)
  $bodyFailure = $null
  $cleanupFailure = $null
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
        Assert-Condition ([string]::IsNullOrWhiteSpace($path) -or -not (& $Context.FileSystemAdapter.Exists $path)) "CLEANUP_VERIFICATION_FAILED"
      }
    } catch {
      $cleanupFailure = $_
    }
    Restore-Environment $EnvironmentSnapshot
  }
  if ($null -ne $cleanupFailure) { throw "CLEANUP_FAILED: $($cleanupFailure.Exception.Message)" }
  if ($null -ne $bodyFailure) { throw $bodyFailure }
}

function Assert-Condition([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
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
  $normalized = $text -replace [regex]::Escape($ExpectedWrapperHash), "__WRAPPER_SHA256__"
  $normalized = $normalized -replace [regex]::Escape($ExpectedWrapperBodyHash), "__WRAPPER_BODY_SHA256__"
  $normalized = $normalized -replace [regex]::Escape($ExpectedManifestHash), ("__" + "MANIFEST_SHA256__")
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
    $stdout = $process.StandardOutput.ReadToEnd().Trim()
    $stderr = $process.StandardError.ReadToEnd().Trim()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "git failed: $stderr" }
    return $stdout
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
  throw "CONTROL invalid boolean for ${Key}: $Value"
}

function ConvertTo-IntegerStrict([string]$Value, [string]$Key) {
  if ($Value -notmatch "^\d+$") { throw "CONTROL invalid integer for ${Key}: $Value" }
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
  if (@($rows).Count -ne 1) { throw "Expected exactly one CONTROL row, found $(@($rows).Count)" }
  $map = @{}
  $duplicates = @()
  foreach ($part in @(($rows[0] -split "\|"))) {
    if ($part -eq "CONTROL") { continue }
    $kv = $part -split "=", 2
    if (@($kv).Count -ne 2 -or [string]::IsNullOrWhiteSpace($kv[0])) { throw "Invalid CONTROL field: $part" }
    if ($map.ContainsKey($kv[0])) { $duplicates += $kv[0] }
    $map[$kv[0]] = $kv[1]
  }
  if (@($duplicates).Count -ne 0) { throw "CONTROL duplicate keys: $(@($duplicates) -join ',')" }
  $required = @(Get-ControlRequiredKeys)
  $requiredSet = @{}
  foreach ($key in $required) { $requiredSet[$key] = $true }
  $missing = @($required | Where-Object { -not $map.ContainsKey($_) })
  if (@($missing).Count -ne 0) { throw "CONTROL missing fields: $(@($missing) -join ',')" }
  $unexpected = @($map.Keys | Where-Object { -not $requiredSet.ContainsKey($_) })
  if (@($unexpected).Count -ne 0) { throw "CONTROL unexpected fields: $(@($unexpected) -join ',')" }
  foreach ($key in @("database_matches","tls_active","payment_events_present","payment_events_merchant_id_uuid","payment_events_merchant_id_nullable","payment_events_processor_compatible","payment_events_processed_at_compatible","platform_settings_present","plan_migration_solo_lite_enabled","solo_plus_enabled","solo_plus_kyc_enabled")) {
    [void](ConvertTo-BooleanStrict $map[$key] $key)
  }
  foreach ($key in @("server_major","conflicting_rehearsal_session_count","conflicting_lock_count","prepared_transaction_count")) {
    [void](ConvertTo-IntegerStrict $map[$key] $key)
  }
  if ($map["transaction_read_only"] -notin @("on","off")) { throw "CONTROL invalid transaction_read_only: $($map["transaction_read_only"])" }
  if ($map["invoice_fk_classification"] -notin @("canonical_set_null","legacy_no_action","missing","invalid","ambiguous")) { throw "CONTROL invalid invoice_fk_classification: $($map["invoice_fk_classification"])" }
  if ($map["merchant_fk_classification"] -notin @("canonical_cascade","legacy_no_action","missing","invalid","ambiguous")) { throw "CONTROL invalid merchant_fk_classification: $($map["merchant_fk_classification"])" }
  if ($map["rollback_sensitive_fingerprint"] -notmatch "^[A-Fa-f0-9]{64}$") { throw "CONTROL invalid rollback_sensitive_fingerprint" }
  return $map
}

function Assert-ControlAccepted([hashtable]$Map) {
  Assert-Condition ($Map["database_matches"] -eq "true") "CONTROL database identity mismatch"
  Assert-Condition ($Map["server_major"] -eq "17") "CONTROL server major is not 17"
  Assert-Condition ($Map["tls_active"] -eq "true") "CONTROL TLS is not active"
  Assert-Condition ($Map["payment_events_present"] -eq "true") "CONTROL payment_events missing"
  Assert-Condition ($Map["payment_events_merchant_id_uuid"] -eq "true") "CONTROL merchant_id is not uuid"
  Assert-Condition ($Map["payment_events_merchant_id_nullable"] -eq "true") "CONTROL merchant_id is not nullable"
  Assert-Condition ($Map["payment_events_processor_compatible"] -eq "true") "CONTROL processor is incompatible"
  Assert-Condition ($Map["payment_events_processed_at_compatible"] -eq "true") "CONTROL processed_at is incompatible"
  Assert-Condition ($Map["platform_settings_present"] -eq "true") "CONTROL platform_settings missing"
  foreach ($flag in @("plan_migration_solo_lite_enabled","solo_plus_enabled","solo_plus_kyc_enabled")) {
    Assert-Condition ($Map[$flag] -eq "false") "Protected feature flag changed: $flag"
  }
  Assert-Condition ($Map["conflicting_rehearsal_session_count"] -eq "0") "Conflicting rehearsal sessions present"
  Assert-Condition ($Map["conflicting_lock_count"] -eq "0") "Conflicting locks present"
  Assert-Condition ($Map["prepared_transaction_count"] -eq "0") "Prepared transactions present"
}

function Assert-ControlProofEqual([hashtable]$Before, [hashtable]$After) {
  foreach ($key in Get-ControlRequiredKeys) {
    Assert-Condition ($Before[$key] -eq $After[$key]) "CONTROL proof mismatch: $key"
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
  $normalized = [regex]::Replace($WrapperText, "(?m)^(\`$ExpectedWrapperHash = ')[^']+(')", '$1__WRAPPER_SHA256__$2')
  $normalized = [regex]::Replace($normalized, "(?m)^(\`$ExpectedWrapperBodyHash = ')[^']+(')", '$1__WRAPPER_BODY_SHA256__$2')
  $normalized = [regex]::Replace($normalized, "(?m)^(\`$ExpectedManifestHash = ')[^']+(')", ('$1' + '__' + 'MANIFEST_SHA256__' + '$2'))
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
  Assert-Condition (@($lines | Where-Object { $_ -eq "BEGIN;" }).Count -eq 1) "runner must contain exactly one outer BEGIN"
  Assert-Condition (@($lines | Where-Object { $_ -eq "COMMIT;" }).Count -eq 0) "runner contains an effective COMMIT"
  Assert-Condition (@($lines | Where-Object { $_ -eq "ROLLBACK;" }).Count -eq 1) "runner must contain exactly one ROLLBACK"
  $rollbackIndex = [array]::IndexOf($lines, "ROLLBACK;")
  Assert-Condition ($rollbackIndex -ge 0) "runner missing ROLLBACK"
  $after = if ($rollbackIndex -lt ($lines.Count - 1)) { @($lines[($rollbackIndex + 1)..($lines.Count - 1)] | Where-Object { $_ -ne "\echo ROLLBACK COMMAND COMPLETED" }) } else { @() }
  Assert-Condition (@($after).Count -eq 0) "runner has executable SQL after final ROLLBACK"
  $includes = @($lines | Where-Object { $_ -like "\i '*" })
  Assert-Condition ($includes.Count -eq 12) "runner must include exactly twelve migrations"
  Assert-Condition ($Descriptor.ExpectedMigrationOrder.Count -eq 12) "runner descriptor must contain twelve migrations"
  for ($i = 0; $i -lt $Descriptor.ExpectedMigrationOrder.Count; $i++) {
    Assert-Condition ($includes[$i] -like "*$($Descriptor.ExpectedMigrationOrder[$i])*") "runner migration order mismatch at $i"
    Assert-Condition ($includes[$i] -like "*$($Descriptor.Namespace)*") "runner include outside artifact namespace"
    Assert-Condition ($includes[$i] -notmatch "(\.\.|\x24|%|;|&|\||>|\<)") "unsafe runner include path"
  }
  $text = Get-Content -Raw -LiteralPath $Descriptor.RunnerPath
  Assert-Condition ($text -notmatch "(?im)^\\(connect|c)\b|^\\!|COPY\s+.*PROGRAM") "runner contains unsafe psql meta-command or external program"
  Assert-Condition ($text -match "ALL MIGRATIONS EXECUTED INSIDE OUTER TRANSACTION") "runner missing all-migrations marker"
  Assert-Condition ($text -match "ROLLBACK COMMAND COMPLETED") "runner missing rollback marker"
}

function Assert-ArtifactIntegrity {
  param($Context = $null)
  if ($null -eq $Context) { $Context = New-ProductionRehearsalRuntimeContext }
  $descriptor = & $Context.ArtifactProvider
  Assert-Condition ($null -ne $descriptor) "ARTIFACT_DESCRIPTOR_MISSING"
  foreach ($field in @(
    "FullCommit","ShortCommit","Namespace","Bundle","WrapperPath","ManifestPath","RunnerPath","TokenPath",
    "MigrationPaths","RunnerHash","ManifestHash","TokenHash","MigrationHashes","CanonicalHelperHash",
    "EmbeddedHelperHash","WrapperHash","WrapperBodyHash","ExpectedMigrationOrder",
    "HelperStartMarker","HelperEndMarker","StaleNamespaces"
  )) { Assert-Condition ($null -ne $descriptor.$field) "ARTIFACT_DESCRIPTOR_FIELD_MISSING:$field" }
  Assert-Condition ($descriptor.FullCommit -match '^[a-f0-9]{40}$') "ARTIFACT_COMMIT_INVALID"
  Assert-Condition ($descriptor.ShortCommit -eq $descriptor.FullCommit.Substring(0,7)) "ARTIFACT_SHORT_COMMIT_MISMATCH"
  Assert-Condition ([IO.Path]::GetFileName($descriptor.Bundle) -eq $descriptor.Namespace) "ARTIFACT_NAMESPACE_MISMATCH"
  Assert-Condition (@($descriptor.MigrationPaths).Count -eq 12) "ARTIFACT_MIGRATION_COUNT_INVALID"
  Assert-Condition (@($descriptor.ExpectedMigrationOrder).Count -eq 12) "ARTIFACT_MIGRATION_ORDER_COUNT_INVALID"
  foreach ($path in @($descriptor.WrapperPath,$descriptor.ManifestPath,$descriptor.RunnerPath,$descriptor.TokenPath) + @($descriptor.MigrationPaths)) {
    Assert-Condition (& $Context.FileSystemAdapter.Exists $path) "ARTIFACT_FILE_MISSING"
  }
  foreach ($path in @($descriptor.RunnerPath,$descriptor.TokenPath) + @($descriptor.MigrationPaths)) {
    Assert-Condition (& $Context.FileSystemAdapter.IsContained $descriptor.Bundle $path) "ARTIFACT_NAMESPACE_MISMATCH"
    Assert-Condition ([IO.Path]::GetFileName($path).Contains($descriptor.ShortCommit) -or @($descriptor.MigrationPaths) -contains $path) "ARTIFACT_NAMESPACE_MISMATCH"
  }
  foreach ($stale in @($descriptor.StaleNamespaces)) {
    Assert-Condition (-not $descriptor.Namespace.Contains($stale)) "ARTIFACT_STALE_NAMESPACE"
  }
  $wrapperText = & $Context.FileSystemAdapter.ReadText $descriptor.WrapperPath
  $startMatches = @([regex]::Matches($wrapperText, [regex]::Escape($descriptor.HelperStartMarker)))
  $endMatches = @([regex]::Matches($wrapperText, [regex]::Escape($descriptor.HelperEndMarker)))
  Assert-Condition ($startMatches.Count -eq 1 -and $endMatches.Count -eq 1) "ARTIFACT_HELPER_MARKER_CARDINALITY_INVALID"
  $helperStart = $startMatches[0].Index + $descriptor.HelperStartMarker.Length
  $helperEnd = $endMatches[0].Index
  Assert-Condition ($helperEnd -gt $helperStart) "ARTIFACT_HELPER_MARKER_ORDER_INVALID"
  $embeddedHelper = $wrapperText.Substring($helperStart,$helperEnd-$helperStart).Trim("`r","`n")
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $actualEmbeddedHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($embeddedHelper)))).Replace("-","").ToUpperInvariant() }
  finally { $sha.Dispose() }
  Assert-Condition ($descriptor.CanonicalHelperHash -eq $descriptor.EmbeddedHelperHash) "ARTIFACT_HELPER_EXPECTED_HASH_MISMATCH"
  Assert-Condition ($actualEmbeddedHash -eq $descriptor.EmbeddedHelperHash) "ARTIFACT_HELPER_BODY_HASH_MISMATCH"
  $actualWrapperBodyHash = Get-DescriptorWrapperBodyHash $wrapperText
  Assert-Condition ($descriptor.WrapperHash -match '^[A-F0-9]{64}$') "ARTIFACT_WRAPPER_HASH_INVALID"
  Assert-Condition ($descriptor.WrapperBodyHash -match '^[A-F0-9]{64}$') "ARTIFACT_WRAPPER_BODY_HASH_INVALID"
  Assert-Condition ($descriptor.WrapperHash -eq $descriptor.WrapperBodyHash) "ARTIFACT_WRAPPER_EXPECTED_HASH_MISMATCH"
  Assert-Condition ($actualWrapperBodyHash -eq $descriptor.WrapperBodyHash) "ARTIFACT_WRAPPER_BODY_HASH_MISMATCH"
  Assert-Condition ((& $Context.FileSystemAdapter.Hash $descriptor.RunnerPath) -eq $descriptor.RunnerHash) "ARTIFACT_RUNNER_HASH_MISMATCH"
  Assert-Condition ((& $Context.FileSystemAdapter.Hash $descriptor.ManifestPath) -eq $descriptor.ManifestHash) "ARTIFACT_MANIFEST_HASH_MISMATCH"
  Assert-Condition ((& $Context.FileSystemAdapter.Hash $descriptor.TokenPath) -eq $descriptor.TokenHash) "ARTIFACT_TOKEN_HASH_MISMATCH"
  foreach ($path in @($descriptor.MigrationPaths)) {
    Assert-Condition ($descriptor.MigrationHashes.ContainsKey($path)) "ARTIFACT_MIGRATION_HASH_MISSING"
    Assert-Condition ((& $Context.FileSystemAdapter.Hash $path) -eq $descriptor.MigrationHashes[$path]) "ARTIFACT_MIGRATION_HASH_MISMATCH"
  }
  $manifest = Parse-Manifest $descriptor.ManifestPath
  Assert-Condition ($manifest.Fields["COMMIT"] -eq $descriptor.FullCommit) "ARTIFACT_MANIFEST_COMMIT_MISMATCH"
  Assert-Condition ($manifest.Fields["SHORT"] -eq $descriptor.ShortCommit) "ARTIFACT_MANIFEST_SHORT_COMMIT_MISMATCH"
  Assert-Condition ($manifest.Fields["ARTIFACT_IDENTITY"] -eq $descriptor.Namespace) "ARTIFACT_MANIFEST_NAMESPACE_MISMATCH"
  Assert-Condition ($manifest.Fields["BUNDLE"] -eq $descriptor.Bundle) "ARTIFACT_MANIFEST_BUNDLE_MISMATCH"
  Assert-Condition ($manifest.Fields["WRAPPER"] -eq $descriptor.WrapperPath) "ARTIFACT_MANIFEST_WRAPPER_MISMATCH"
  Assert-Condition ($manifest.Fields["WRAPPER_SHA256"] -eq $descriptor.WrapperHash) "ARTIFACT_MANIFEST_WRAPPER_HASH_MISMATCH"
  Assert-Condition ($manifest.Fields["WRAPPER_BODY_SHA256"] -eq $descriptor.WrapperBodyHash) "ARTIFACT_MANIFEST_WRAPPER_BODY_HASH_MISMATCH"
  Assert-Condition ($manifest.Fields["RUNNER"] -eq $descriptor.RunnerPath) "ARTIFACT_MANIFEST_RUNNER_MISMATCH"
  Assert-Condition ($manifest.Fields["RUNNER_SHA256"] -eq $descriptor.RunnerHash) "ARTIFACT_MANIFEST_RUNNER_HASH_MISMATCH"
  Assert-Condition ($manifest.Fields["TOKEN_FILE"] -eq $descriptor.TokenPath) "ARTIFACT_MANIFEST_TOKEN_PATH_MISMATCH"
  Assert-Condition ($manifest.Fields["TOKEN_FILE_SHA256"] -eq $descriptor.TokenHash) "ARTIFACT_MANIFEST_TOKEN_HASH_MISMATCH"
  Assert-Condition ($manifest.Fields["CANONICAL_HELPER_SHA256"] -eq $descriptor.CanonicalHelperHash) "ARTIFACT_MANIFEST_CANONICAL_HELPER_HASH_MISMATCH"
  Assert-Condition ($manifest.Fields["EMBEDDED_HELPER_SHA256"] -eq $descriptor.EmbeddedHelperHash) "ARTIFACT_MANIFEST_EMBEDDED_HELPER_HASH_MISMATCH"
  Assert-Condition ($manifest.Fields["TIMESTAMP_IS_SOURCE_FRESHNESS_PROOF"] -eq "false") "manifest must disclaim timestamp freshness"
  foreach ($stale in @($descriptor.StaleNamespaces)) {
    Assert-Condition ($manifest.Fields["STALE_ARTIFACT_EXCLUSIONS"] -match [regex]::Escape($stale)) "ARTIFACT_MANIFEST_STALE_EXCLUSION_MISSING"
  }
  Assert-Condition (@($manifest.Migrations).Count -eq 12) "ARTIFACT_MANIFEST_MIGRATION_COUNT_INVALID"
  for ($i = 0; $i -lt 12; $i++) {
    $parts = @($manifest.Migrations[$i] -split '\|')
    $expectedNumber = '{0:D3}' -f ($i + 6)
    Assert-Condition ($parts.Count -eq 6 -and $parts[0] -eq $expectedNumber) "ARTIFACT_MANIFEST_MIGRATION_ROW_INVALID:$expectedNumber"
    Assert-Condition ((Split-Path -Leaf $parts[1]) -eq $descriptor.ExpectedMigrationOrder[$i]) "ARTIFACT_MANIFEST_MIGRATION_SOURCE_MISMATCH:$expectedNumber"
    Assert-Condition ($parts[2] -eq $descriptor.MigrationPaths[$i]) "ARTIFACT_MANIFEST_MIGRATION_PATH_MISMATCH:$expectedNumber"
    Assert-Condition ($parts[4] -match '^source_sha256=[A-Fa-f0-9]{64}$') "ARTIFACT_MANIFEST_SOURCE_HASH_INVALID:$expectedNumber"
    Assert-Condition ($parts[5] -eq ('generated_sha256=' + $descriptor.MigrationHashes[$descriptor.MigrationPaths[$i]])) "ARTIFACT_MANIFEST_MIGRATION_HASH_MISMATCH:$expectedNumber"
  }
  Assert-RunnerContract $descriptor
}

function Assert-GitState {
  param($Context = $null)
  $state = if ($null -eq $Context) { & (New-ProductionRehearsalRuntimeContext).GitStateProvider } else { & $Context.GitStateProvider }
  Assert-Condition ($state.Branch -eq $ExpectedBranch) "branch mismatch"
  Assert-Condition ($state.Head -eq $ExpectedCommit) "HEAD mismatch"
  Assert-Condition (@($state.Staged).Count -eq 0) "staged files present"
  Assert-Condition (@($state.Modified).Count -eq 0) "tracked worktree modifications present"
}

function Parse-TargetDatabaseUrl([string]$Url) {
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($Url)) "DatabaseUrl is required"
  Assert-Condition ($Url -notmatch "%(?![0-9A-Fa-f]{2})") "DatabaseUrl contains malformed percent encoding"
  try { $uri = [Uri]$Url } catch { throw "DatabaseUrl is malformed" }
  Assert-Condition ($uri.IsAbsoluteUri) "DatabaseUrl must be absolute"
  Assert-Condition ($uri.Scheme -in @("postgres","postgresql")) "DatabaseUrl must be PostgreSQL"
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($uri.Host)) "DatabaseUrl host is required"
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($uri.UserInfo)) "DatabaseUrl username is required"
  Assert-Condition ([string]::IsNullOrEmpty($uri.Fragment)) "DatabaseUrl fragments are not allowed"
  Assert-Condition ($uri.UserInfo -notmatch ":") "DatabaseUrl must not contain a password"
  try { $user = [Uri]::UnescapeDataString($uri.UserInfo) } catch { throw "DatabaseUrl username encoding is invalid" }
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($user)) "DatabaseUrl username is required"

  $rawDatabase = $uri.AbsolutePath
  Assert-Condition ($rawDatabase.StartsWith("/") -and $rawDatabase.Length -gt 1) "DatabaseUrl database name is required"
  Assert-Condition ($rawDatabase.Trim("/") -notmatch "/") "DatabaseUrl database name must be one path segment"
  try { $database = [Uri]::UnescapeDataString($rawDatabase.Trim("/")) } catch { throw "DatabaseUrl database encoding is invalid" }
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($database)) "DatabaseUrl database name is required"
  Assert-Condition ($database -notin @("=disable", "disable", ".", "..")) "DatabaseUrl database name is invalid"

  $sslValues = @()
  if (-not [string]::IsNullOrEmpty($uri.Query)) {
    foreach ($part in $uri.Query.TrimStart("?").Split("&")) {
      Assert-Condition (-not [string]::IsNullOrWhiteSpace($part)) "DatabaseUrl query syntax is invalid"
      $kv = $part -split "=", 2
      Assert-Condition (@($kv).Count -eq 2 -and -not [string]::IsNullOrWhiteSpace($kv[0])) "DatabaseUrl query syntax is invalid"
      try { $key = [Uri]::UnescapeDataString($kv[0]); $value = [Uri]::UnescapeDataString($kv[1]) } catch { throw "DatabaseUrl query encoding is invalid" }
      if ($key -eq "sslmode") { $sslValues += $value }
    }
  }
  Assert-Condition (@($sslValues).Count -eq 1) "DatabaseUrl must contain exactly one sslmode=require"
  Assert-Condition ($sslValues[0] -eq "require") "DatabaseUrl sslmode must be require"
  [pscustomobject]@{ Host = $uri.Host; Port = if ($uri.Port -gt 0) { [string]$uri.Port } else { "5432" }; User = $user; Database = $database }
}

function Assert-PasswordFreeDatabaseUrl([string]$Url) {
  [void](Parse-TargetDatabaseUrl $Url)
}

function ConvertTo-SqlLiteral([string]$Value) {
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($Value)) "Expected database identity is required"
  Assert-Condition ($Value.IndexOf([char]0) -lt 0) "Expected database identity contains an invalid character"
  return "'" + ($Value -replace "'", "''") + "'"
}

function New-TemporaryPgPassFile([string]$HostName, [string]$Port, [string]$Database, [string]$UserName, [securestring]$Password, $Context=$null) {
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  try {
    $escaped = $plain -replace "\\", "\\" -replace ":", "\:"
    $line = "$HostName`:$Port`:$Database`:$UserName`:$escaped"
    $path = Join-Path ([System.IO.Path]::GetTempPath()) ("deraledger-rehearsal-" + [guid]::NewGuid().ToString("N") + ".pgpass")
    Assert-Condition (-not ([IO.Path]::GetFullPath($path)).StartsWith(([IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase)) "Credential file must be outside repository"
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($line)
    if ($null -eq $Context) { [IO.File]::WriteAllBytes($path,$bytes) }
    else { & $Context.FileSystemAdapter.WriteBytes $path $bytes }
    return $path
  } finally {
    $plain = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
}

function Invoke-NativeChecked([string]$FilePath, [string[]]$Arguments, [string]$StdoutPath, [string]$StderrPath, [int]$TimeoutSeconds, [string[]]$SensitiveValues=@()) {
  $started = [Diagnostics.Stopwatch]::StartNew()
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = Join-NativeArguments $Arguments
  $process = $null
  $result = $null
  try {
    $process = Invoke-ProcessStart $psi
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $timedOut = -not $process.WaitForExit($TimeoutSeconds * 1000)
    if ($timedOut) {
      try { & taskkill.exe /PID $process.Id /T /F 2>&1 | Out-Null } catch { try { $process.Kill() } catch {} }
      [void]$process.WaitForExit(5000)
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
      DurationMs=$started.ElapsedMilliseconds; ProcessId=$process.Id; ProcessTreeTerminated=$timedOut; Disposed=$false
    }
  } finally {
    $started.Stop()
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
  Assert-Condition ($running.Count -eq 12) "Expected 12 RUNNING markers"
  Assert-Condition ($passed.Count -eq 12) "Expected 12 PASSED markers"
  Assert-Condition ($Output -match "ALL MIGRATIONS EXECUTED INSIDE OUTER TRANSACTION") "All-migrations marker missing"
  Assert-Condition ($Output -match "ROLLBACK COMMAND COMPLETED") "Rollback-completed marker missing"
}

function Invoke-OfflineMutationCase([string]$Case) {
  $valid = "postgresql://user@example.invalid/database?sslmode=require"
  switch ($Case) {
    "valid-url" { [void](Parse-TargetDatabaseUrl $valid); return }
    "missing-host" { [void](Parse-TargetDatabaseUrl "postgresql://user@/database?sslmode=require"); return }
    "whitespace-host" { [void](Parse-TargetDatabaseUrl "postgresql://user@%20/database?sslmode=require"); return }
    "missing-user" { [void](Parse-TargetDatabaseUrl "postgresql://example.invalid/database?sslmode=require"); return }
    "empty-user" { [void](Parse-TargetDatabaseUrl "postgresql://@example.invalid/database?sslmode=require"); return }
    "embedded-password" { [void](Parse-TargetDatabaseUrl "postgresql://user:secret@example.invalid/database?sslmode=require"); return }
    "missing-database" { [void](Parse-TargetDatabaseUrl "postgresql://user@example.invalid?sslmode=require"); return }
    "slash-database" { [void](Parse-TargetDatabaseUrl "postgresql://user@example.invalid///?sslmode=require"); return }
    "disable-equals" { [void](Parse-TargetDatabaseUrl "postgresql://user@example.invalid/%3Ddisable?sslmode=require"); return }
    "disable-name" { [void](Parse-TargetDatabaseUrl "postgresql://user@example.invalid/disable?sslmode=require"); return }
    "query-as-database" { [void](Parse-TargetDatabaseUrl "postgresql://user@example.invalid?database?sslmode=require"); return }
    "bad-percent" { [void](Parse-TargetDatabaseUrl "postgresql://user%ZZ@example.invalid/database?sslmode=require"); return }
    "duplicate-ssl" { [void](Parse-TargetDatabaseUrl "postgresql://user@example.invalid/database?sslmode=require&sslmode=require"); return }
    "missing-ssl" { [void](Parse-TargetDatabaseUrl "postgresql://user@example.invalid/database"); return }
    "bad-ssl" { [void](Parse-TargetDatabaseUrl "postgresql://user@example.invalid/database?sslmode=disable"); return }
    "fragment" { [void](Parse-TargetDatabaseUrl "postgresql://user@example.invalid/database?sslmode=require#fragment"); return }
    "encoded-values" {
      $parsed = Parse-TargetDatabaseUrl "postgresql://user%2Ename@example.invalid/db%2Dname?sslmode=require"
      Assert-Condition ($parsed.User -eq "user.name" -and $parsed.Database -eq "db-name") "encoded URL values were not decoded safely"
      return
    }
    "identity-match" {
      $sql = New-ControlSql "database-name"
      Assert-Condition ($sql.Contains("current_database() = 'database-name'")) "identity SQL did not compare the expected database"
      return
    }
    "identity-mismatch" {
      $sql = New-ControlSql "database-name"
      $map = Convert-ControlRow ($sampleControlForOffline -replace "database_matches=true", "database_matches=false")
      Assert-ControlAccepted $map
      return
    }
    "empty-expected" { [void](New-ControlSql " "); return }
    "hostile-identity" {
      $literal = ConvertTo-SqlLiteral "db'name"
      Assert-Condition ($literal -eq "'db''name'") "SQL literal escaping failed"
      return
    }
    default { throw "Unknown offline mutation case: $Case" }
  }
}

function Invoke-OfflineValidation {
  param($Context = $null)
  if ($null -eq $Context) { $Context = New-ProductionRehearsalRuntimeContext }
  Assert-ArtifactIntegrity $Context
  $sample = "banner`r`nCONTROL|database_matches=true|server_major=17|tls_active=true|transaction_read_only=on|payment_events_present=true|payment_events_merchant_id_uuid=true|payment_events_merchant_id_nullable=true|payment_events_processor_compatible=true|payment_events_processed_at_compatible=true|invoice_fk_classification=canonical_set_null|merchant_fk_classification=canonical_cascade|platform_settings_present=true|plan_migration_solo_lite_enabled=false|solo_plus_enabled=false|solo_plus_kyc_enabled=false|conflicting_rehearsal_session_count=0|conflicting_lock_count=0|prepared_transaction_count=0|rollback_sensitive_fingerprint=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  $map = Convert-ControlRow $sample
  Assert-ControlAccepted $map
  $script:sampleControlForOffline = $sample
  if (-not [string]::IsNullOrWhiteSpace($script:OfflineMutationCase)) { Invoke-OfflineMutationCase $script:OfflineMutationCase }
  $target = Parse-TargetDatabaseUrl "postgresql://user@example.invalid/database?sslmode=require"
  Assert-Condition ($target.Database -eq "database") "structured URL parser returned the wrong database"
  Write-Output "OfflineValidateOnly: PASS"
}

function Invoke-Rehearsal {
  param($Context = $null)
  if ($null -eq $Context) { $Context = New-ProductionRehearsalRuntimeContext }
  Assert-Condition $ExecuteRehearsal "Explicit -ExecuteRehearsal mode is required"
  Assert-Condition ($ConfirmationToken -eq $ExpectedToken) "Wrong confirmation token"
  Assert-GitState $Context
  Assert-ArtifactIntegrity $Context
  $target = Parse-TargetDatabaseUrl $DatabaseUrl
  Assert-Condition (& $Context.ExecutableResolver $PsqlPath) "PsqlPath does not exist"
  Assert-Condition (& $Context.ExecutableResolver $PgDumpPath) "PgDumpPath does not exist"
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
    $script:ControlSqlFileToDelete = Join-Path ([System.IO.Path]::GetTempPath()) ("deraledger-control-" + [guid]::NewGuid().ToString("N") + ".sql")
    Assert-Condition (-not ([IO.Path]::GetFullPath($script:ControlSqlFileToDelete)).StartsWith(([IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'),[StringComparison]::OrdinalIgnoreCase)) "Temporary SQL file must be outside repository"
    & $Context.FileSystemAdapter.WriteText $script:ControlSqlFileToDelete (New-ControlSql $database)
    $conn = Invoke-RehearsalProcess $Context $PsqlPath @("-X","-w","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"-c","\conninfo") (Join-Path $RepoRoot "$EvidencePrefix-conninfo.stdout.txt") (Join-Path $RepoRoot "$EvidencePrefix-conninfo.stderr.txt") 60
    Assert-RehearsalProcessResult $conn "conninfo"
    Assert-Condition ($conn.Stdout -match "SSL connection") "TLS confirmation failed"
    $pre = Invoke-RehearsalProcess $Context $PsqlPath @("-X","-w","-q","-A","-t","-v","ON_ERROR_STOP=1","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"-f",$script:ControlSqlFileToDelete) (Join-Path $RepoRoot "$EvidencePrefix-preflight.stdout.txt") (Join-Path $RepoRoot "$EvidencePrefix-preflight.stderr.txt") 120
    Assert-RehearsalProcessResult $pre "preflight"
    $preControl = Convert-ControlRow $pre.Stdout
    Assert-ControlAccepted $preControl
    $preDump = Join-Path $RepoRoot "$EvidencePrefix-pre-schema.sql"
    $postDump = Join-Path $RepoRoot "$EvidencePrefix-post-schema.sql"
    $dump1 = Invoke-RehearsalProcess $Context $PgDumpPath @("--schema-only","--schema=public","--no-owner","--no-privileges","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"--file",$preDump) (Join-Path $RepoRoot "$EvidencePrefix-pre-schema.stdout.txt") (Join-Path $RepoRoot "$EvidencePrefix-pre-schema.stderr.txt") 300
    Assert-RehearsalProcessResult $dump1 "pre-schema"
    $runner = Invoke-RehearsalProcess $Context $PsqlPath @("-X","-w","-v","ON_ERROR_STOP=1","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"-f",$RunnerPath) (Join-Path $RepoRoot "$EvidencePrefix-runner.stdout.txt") (Join-Path $RepoRoot "$EvidencePrefix-runner.stderr.txt") 1800
    Assert-RehearsalProcessResult $runner "runner"
    Assert-RunnerMarkers $runner.Stdout
    $dump2 = Invoke-RehearsalProcess $Context $PgDumpPath @("--schema-only","--schema=public","--no-owner","--no-privileges","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"--file",$postDump) (Join-Path $RepoRoot "$EvidencePrefix-post-schema.stdout.txt") (Join-Path $RepoRoot "$EvidencePrefix-post-schema.stderr.txt") 300
    Assert-RehearsalProcessResult $dump2 "post-schema"
    Assert-Condition ((Sha256 $preDump) -eq (Sha256 $postDump)) "Pre/post schema hashes differ"
    $post = Invoke-RehearsalProcess $Context $PsqlPath @("-X","-w","-q","-A","-t","-v","ON_ERROR_STOP=1","-h",$hostName,"-p",$port,"-U",$userName,"-d",$database,"-f",$script:ControlSqlFileToDelete) (Join-Path $RepoRoot "$EvidencePrefix-postflight.stdout.txt") (Join-Path $RepoRoot "$EvidencePrefix-postflight.stderr.txt") 120
    Assert-RehearsalProcessResult $post "postflight"
    $postControl = Convert-ControlRow $post.Stdout
    Assert-ControlAccepted $postControl
    Assert-ControlProofEqual $preControl $postControl
    Write-Output "Rehearsal accepted: True"
  } { @($script:PgPassFileToDelete,$script:ControlSqlFileToDelete) } { } $snapshot
}
