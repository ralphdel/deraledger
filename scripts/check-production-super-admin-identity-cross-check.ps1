param(
  [string]$Host = "",
  [int]$Port = 5432,
  [string]$Database = "",
  [string]$User = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Read-RequiredTrimmed([string]$Prompt, [string]$ExistingValue = "") {
  $value = $ExistingValue
  if ([string]::IsNullOrWhiteSpace($value)) {
    $value = Read-Host $Prompt
  }
  $trimmed = $value.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    throw "Required runtime input was not supplied."
  }
  return $trimmed
}

function Convert-SecureStringToPlainText([Security.SecureString]$Value) {
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Get-Sha256Hex([string]$Value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value.Trim().ToLowerInvariant())
    return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
  }
  finally {
    $sha.Dispose()
  }
}

function Get-AuthUserIdRedaction([string]$Value) {
  if ($Value.Length -lt 8) {
    return "...invalid"
  }
  return "..." + $Value.Substring($Value.Length - 8)
}

function ConvertTo-SqlLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Assert-ProductionInputTarget {
  param(
    [string]$HostValue,
    [int]$PortValue,
    [string]$DatabaseValue,
    [string]$UserValue,
    [string]$EmailValue,
    [string]$AuthUserIdValue
  )

  if ($HostValue.Trim().ToLowerInvariant() -in @("localhost", "127.0.0.1")) {
    throw "Unsafe database host. This cross-check is production-targeted and rejects local hosts."
  }
  if ($PortValue -lt 1 -or $PortValue -gt 65535) {
    throw "Database port is invalid."
  }
  if ([string]::IsNullOrWhiteSpace($DatabaseValue)) {
    throw "Database name is required."
  }
  if ([string]::IsNullOrWhiteSpace($UserValue)) {
    throw "Database user is required."
  }
  if ($EmailValue -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
    throw "Target email is invalid."
  }
  if ($AuthUserIdValue -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
    throw "Target Auth user ID is invalid."
  }
}

function Invoke-ReadOnlyPsqlFile {
  param(
    [string]$PsqlPath,
    [string]$HostValue,
    [int]$PortValue,
    [string]$DatabaseValue,
    [string]$UserValue,
    [string]$FilePath,
    [string]$StdoutPath,
    [string]$StderrPath
  )

  return Start-Process -FilePath $PsqlPath -ArgumentList @(
    "-X", "-w", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-h", $HostValue,
    "-p", [string]$PortValue,
    "-U", $UserValue,
    "-d", $DatabaseValue,
    "-f", $FilePath
  ) -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath -Wait -PassThru -NoNewWindow
}

$confirmation = Read-RequiredTrimmed "Type exactly: READ ONLY PRODUCTION SUPER ADMIN IDENTITY CROSS CHECK"
if ($confirmation -cne "READ ONLY PRODUCTION SUPER ADMIN IDENTITY CROSS CHECK") {
  throw "Confirmation mismatch."
}

$targetHost = Read-RequiredTrimmed "Production PostgreSQL host" $Host
$targetPortText = Read-RequiredTrimmed "Production PostgreSQL port" ([string]$Port)
if ($targetPortText -notmatch '^\d+$') {
  throw "Database port must be numeric."
}
$targetPort = [int]$targetPortText
$targetDatabase = Read-RequiredTrimmed "Production PostgreSQL database name" $Database
$targetUser = Read-RequiredTrimmed "Production PostgreSQL user" $User
$targetEmail = Read-RequiredTrimmed "Target production super-admin email"
$targetAuthUserId = Read-RequiredTrimmed "Target production Auth user ID"

Assert-ProductionInputTarget -HostValue $targetHost -PortValue $targetPort -DatabaseValue $targetDatabase -UserValue $targetUser -EmailValue $targetEmail -AuthUserIdValue $targetAuthUserId

$passwordSecure = Read-Host "Production PostgreSQL password for $targetUser@$targetHost" -AsSecureString
if ($passwordSecure.Length -eq 0) {
  throw "Database password was not supplied."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$evidenceDirectory = Join-Path $projectRoot ".local-evidence/production-super-admin-identity-cross-check-$timestamp"
$tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ("deraledger-super-admin-identity-cross-check-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $tempDirectory -Force | Out-Null
$sqlPath = Join-Path $tempDirectory "identity-cross-check.sql"
$stdoutPath = Join-Path $tempDirectory "psql.stdout.txt"
$stderrPath = Join-Path $tempDirectory "psql.stderr.txt"
$evidencePath = Join-Path $evidenceDirectory "identity-cross-check-redacted.json"

$psqlCommand = Get-Command "psql" -ErrorAction Stop
$psqlPath = (Resolve-Path -LiteralPath $psqlCommand.Source).Path
$originalPgpPassword = $env:PGPASSWORD
$originalPgOptions = $env:PGOPTIONS

$targetEmailSql = ConvertTo-SqlLiteral $targetEmail
$targetEmailShaSql = ConvertTo-SqlLiteral (Get-Sha256Hex $targetEmail)
$targetAuthUserIdSql = ConvertTo-SqlLiteral $targetAuthUserId
$targetAuthUserIdRedactedSql = ConvertTo-SqlLiteral (Get-AuthUserIdRedaction $targetAuthUserId)

$readOnlySql = @"
\pset format unaligned
\pset tuples_only on
\pset pager off

WITH input_values AS (
  SELECT
    $targetAuthUserIdSql::uuid AS target_auth_user_id,
    $targetEmailSql::text AS target_email,
    $targetEmailShaSql::text AS target_email_sha256,
    $targetAuthUserIdRedactedSql::text AS target_auth_user_id_redacted
),
auth_user_columns AS (
  SELECT
    to_regclass('auth.users') IS NOT NULL AS auth_users_present,
    EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'auth'
        AND c.table_name = 'users'
        AND c.column_name = 'email'
    ) AS has_email_column,
    EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'auth'
        AND c.table_name = 'users'
        AND c.column_name = 'email_confirmed_at'
    ) AS has_email_confirmed_at_column
),
auth_user_facts AS (
  SELECT
    CASE
      WHEN NOT columns.auth_users_present THEN 'FAIL'
      WHEN NOT columns.has_email_column THEN 'FAIL'
      WHEN (
        SELECT count(*)
        FROM auth.users u, input_values i
        WHERE u.id = i.target_auth_user_id
          AND lower(coalesce(u.email, '')) = lower(i.target_email)
      ) = 1 THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE
      WHEN columns.auth_users_present AND columns.has_email_column THEN (
        SELECT count(*)
        FROM auth.users u, input_values i
        WHERE u.id = i.target_auth_user_id
          AND lower(coalesce(u.email, '')) = lower(i.target_email)
      )
      ELSE 0
    END AS exact_match_count,
    CASE
      WHEN columns.auth_users_present AND columns.has_email_column AND columns.has_email_confirmed_at_column THEN (
        SELECT COALESCE(bool_or(u.email_confirmed_at IS NOT NULL), false)
        FROM auth.users u, input_values i
        WHERE u.id = i.target_auth_user_id
          AND lower(coalesce(u.email, '')) = lower(i.target_email)
      )
      ELSE false
    END AS email_confirmed
  FROM auth_user_columns columns
)
SELECT
  'AUTH_USER|' ||
  status || '|' ||
  exact_match_count::text || '|' ||
  CASE WHEN email_confirmed THEN 'true' ELSE 'false' END
FROM auth_user_facts;

WITH input_values AS (
  SELECT
    $targetAuthUserIdSql::uuid AS target_auth_user_id,
    $targetEmailSql::text AS target_email
),
optional_targets(category, schema_name, table_name, user_id_column, email_column) AS (
  VALUES
    ('merchant_owner', 'public', 'merchants', 'user_id', 'email'),
    ('merchant_team', 'public', 'merchant_team', 'user_id', NULL),
    ('customer', 'public', 'customers', 'user_id', 'email'),
    ('customer_profile', 'public', 'customer_profiles', 'user_id', 'email'),
    ('workspace_owner', 'public', 'workspaces', 'owner_user_id', NULL),
    ('business_owner', 'public', 'businesses', 'owner_user_id', 'email'),
    ('app_profile', 'public', 'profiles', 'user_id', 'email'),
    ('app_profile', 'public', 'user_profiles', 'user_id', 'email'),
    ('app_user', 'public', 'clients', 'user_id', 'email')
),
target_facts AS (
  SELECT
    target.category,
    target.schema_name,
    target.table_name,
    target.user_id_column,
    target.email_column,
    to_regclass(format('%I.%I', target.schema_name, target.table_name)) AS relation_oid,
    EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = target.schema_name
        AND c.table_name = target.table_name
        AND c.column_name = target.user_id_column
    ) AS has_user_id_column,
    CASE
      WHEN target.email_column IS NULL THEN false
      ELSE EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = target.schema_name
          AND c.table_name = target.table_name
          AND c.column_name = target.email_column
      )
    END AS has_email_column
  FROM optional_targets target
),
generated_checks AS (
  SELECT
    CASE
      WHEN facts.relation_oid IS NULL THEN format(
        \$sql\$SELECT 'IDENTITY_CHECK|%1\$s|%2\$s.%3\$s|NOT_PRESENT|0|0|not_present';\$sql\$,
        facts.category,
        facts.schema_name,
        facts.table_name
      )
      WHEN NOT facts.has_user_id_column AND NOT facts.has_email_column THEN format(
        \$sql\$SELECT 'IDENTITY_CHECK|%1\$s|%2\$s.%3\$s|MANUAL_REVIEW|0|0|structure_unknown';\$sql\$,
        facts.category,
        facts.schema_name,
        facts.table_name
      )
      ELSE format(
        \$sql\$
SELECT
  'IDENTITY_CHECK|%1\$s|%2\$s.%3\$s|' ||
  CASE
    WHEN ((%4\$s) + (%5\$s)) > 0 THEN 'FAIL'
    ELSE 'PASS'
  END || '|' ||
  (%4\$s)::text || '|' ||
  (%5\$s)::text || '|' ||
  CASE
    WHEN %6\$L::boolean AND %7\$L::boolean THEN 'user_id_or_email'
    WHEN %6\$L::boolean THEN 'user_id_only'
    WHEN %7\$L::boolean THEN 'email_only'
    ELSE 'structure_unknown'
  END;
\$sql\$,
        facts.category,
        facts.schema_name,
        facts.table_name,
        CASE
          WHEN facts.has_user_id_column THEN format(
            '(SELECT count(*) FROM %I.%I q, input_values i WHERE q.%I::text = i.target_auth_user_id::text)',
            facts.schema_name,
            facts.table_name,
            facts.user_id_column
          )
          ELSE '0'
        END,
        CASE
          WHEN facts.has_email_column THEN format(
            '(SELECT count(*) FROM %I.%I q, input_values i WHERE lower(coalesce(q.%I::text, '''')) = lower(i.target_email))',
            facts.schema_name,
            facts.table_name,
            facts.email_column
          )
          ELSE '0'
        END,
        CASE WHEN facts.has_user_id_column THEN 'true' ELSE 'false' END,
        CASE WHEN facts.has_email_column THEN 'true' ELSE 'false' END
      )
    END AS sql_text
  FROM target_facts facts
)
SELECT sql_text
FROM generated_checks
ORDER BY sql_text
\gexec
"@

try {
  $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
  try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
  }
  $env:PGOPTIONS = "-c client_min_messages=warning"

  Write-Utf8NoBom $sqlPath $readOnlySql
  $process = Invoke-ReadOnlyPsqlFile -PsqlPath $psqlPath -HostValue $targetHost -PortValue $targetPort -DatabaseValue $targetDatabase -UserValue $targetUser -FilePath $sqlPath -StdoutPath $stdoutPath -StderrPath $stderrPath
  $stdout = if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw } else { "" }
  $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }

  if ($process.ExitCode -ne 0) {
    $failurePayload = [ordered]@{
      control = "PRODUCTION_SUPER_ADMIN_IDENTITY_CROSS_CHECK=FAIL"
      target_email_sha256 = Get-Sha256Hex $targetEmail
      auth_user_id_redacted = Get-AuthUserIdRedaction $targetAuthUserId
      failure_code = "readonly_db_cross_check_failed"
      psql_exit_code = $process.ExitCode
      stderr_redacted = if ([string]::IsNullOrWhiteSpace($stderr)) { $null } else { "psql_error_redacted" }
    }
    Write-Utf8NoBom $evidencePath ($failurePayload | ConvertTo-Json -Depth 6)
    Get-Content -LiteralPath $evidencePath
    throw "Read-only production identity cross-check failed before result parsing."
  }

  $lines = @(
    $stdout -split "\r?\n" |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )
  $authLines = @($lines | Where-Object { $_.StartsWith("AUTH_USER|", [StringComparison]::Ordinal) })
  $identityLines = @($lines | Where-Object { $_.StartsWith("IDENTITY_CHECK|", [StringComparison]::Ordinal) })

  if ($authLines.Count -ne 1) {
    $failurePayload = [ordered]@{
      control = "PRODUCTION_SUPER_ADMIN_IDENTITY_CROSS_CHECK=FAIL"
      target_email_sha256 = Get-Sha256Hex $targetEmail
      auth_user_id_redacted = Get-AuthUserIdRedaction $targetAuthUserId
      failure_code = "auth_user_row_missing_or_ambiguous"
      auth_user_row_count = $authLines.Count
      parsed_identity_row_count = $identityLines.Count
    }
    Write-Utf8NoBom $evidencePath ($failurePayload | ConvertTo-Json -Depth 6)
    Get-Content -LiteralPath $evidencePath
    throw "Read-only production identity cross-check did not return exactly one AUTH_USER row."
  }

  $authParts = @($authLines[0].Split("|"))
  if ($authParts.Count -lt 4) {
    throw "AUTH_USER row is malformed."
  }

  $identityChecks = @(
    foreach ($line in $identityLines) {
      $parts = @($line.Split("|"))
      if ($parts.Count -lt 7) {
        continue
      }
      [ordered]@{
        category = $parts[1]
        table = $parts[2]
        status = $parts[3]
        user_id_match_count = [int]$parts[4]
        email_match_count = [int]$parts[5]
        basis = $parts[6]
      }
    }
  )

  if ($identityChecks.Count -eq 0) {
    throw "No IDENTITY_CHECK rows were returned."
  }

  $authStatus = $authParts[1]
  $authExactMatchCount = [int]$authParts[2]
  $authEmailConfirmed = $authParts[3] -eq "true"
  $hasExplicitIdentityMatch = @($identityChecks | Where-Object { $_.status -eq "FAIL" }).Count -gt 0
  $hasManualReview = @($identityChecks | Where-Object { $_.status -eq "MANUAL_REVIEW" }).Count -gt 0

  $finalOutcome = if ($authStatus -ne "PASS" -or $authExactMatchCount -ne 1 -or $hasExplicitIdentityMatch) {
    "FAIL"
  } elseif ($hasManualReview) {
    "MANUAL_REVIEW"
  } else {
    "PASS"
  }

  $resultPayload = [ordered]@{
    control = "PRODUCTION_SUPER_ADMIN_IDENTITY_CROSS_CHECK=$finalOutcome"
    target_email_sha256 = Get-Sha256Hex $targetEmail
    auth_user_id_redacted = Get-AuthUserIdRedaction $targetAuthUserId
    auth_user = [ordered]@{
      status = $authStatus
      exact_match_count = $authExactMatchCount
      email_confirmed = $authEmailConfirmed
    }
    outcome = $finalOutcome
    reason = if ($finalOutcome -eq "PASS") {
      "no identity collision found"
    } elseif ($finalOutcome -eq "MANUAL_REVIEW") {
      "optional table structure unknown but no collision found"
    } else {
      "identity collision detected or auth user exact match failed"
    }
    checks = $identityChecks
  }

  Write-Utf8NoBom $evidencePath ($resultPayload | ConvertTo-Json -Depth 6)
  Get-Content -LiteralPath $evidencePath

  if ($finalOutcome -eq "FAIL") {
    throw "Read-only production identity cross-check found a failing identity collision or auth-user mismatch."
  }
}
finally {
  if ($null -eq $originalPgpPassword) {
    Remove-Item -Path Env:PGPASSWORD -ErrorAction SilentlyContinue
  } else {
    $env:PGPASSWORD = $originalPgpPassword
  }
  if ($null -eq $originalPgOptions) {
    Remove-Item -Path Env:PGOPTIONS -ErrorAction SilentlyContinue
  } else {
    $env:PGOPTIONS = $originalPgOptions
  }
  if (Test-Path -LiteralPath $tempDirectory) {
    Remove-Item -LiteralPath $tempDirectory -Recurse -Force
  }
}
