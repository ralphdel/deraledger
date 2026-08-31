# Phase 2 Admin Readiness Production Manual-Command Runbook

## Objective and Boundary

This runbook defines a later **user-run only** production preflight, apply,
postflight, signature-discovery, and behavior-validation sequence for exactly
one migration:

- `supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`

It is a reviewed source document, not authorization to run a command. Do not
run any section until the exact phase has separate approval. The user enters a
password locally; no password, token, connection string, JWT, cookie, header,
or `.env` content may be pasted into chat or an agent.

This runbook creates no script and performs no action when committed. It does
not authorize route enablement, runtime adoption, an admin UI release, M030,
approval execution, merchant activation, collection unlock, or any payment,
provider, checkout, subscription, invoice, or storefront behavior.

## Approved Production Constants

The following are reviewed, non-secret target identity constants. Operator
input can confirm them only; it must never define the target.

```text
APPROVED_PRODUCTION_PROJECT_REF=gznwibespgkwknnvbrlv
APPROVED_PRODUCTION_POOLER_HOST=aws-0-eu-north-1.pooler.supabase.com
APPROVED_PRODUCTION_PORT=5432
APPROVED_PRODUCTION_DATABASE=postgres
APPROVED_PRODUCTION_USER=postgres.gznwibespgkwknnvbrlv
APPROVED_PRODUCTION_SSL_MODE=require
```

The pooler may report SQL `current_user` as `postgres`. That value is session
metadata only. The project-reference proof is the exact, source-approved
pooler username `postgres.gznwibespgkwknnvbrlv`, whose suffix must parse to
`gznwibespgkwknnvbrlv`. The direct `db.<ref>.supabase.co` host is not an
accepted target for this runbook.

Any host, port, database, user, parsed project ref, SSL mode, migration hash,
or preflight-evidence mismatch is a stop condition. An alternate but
syntactically valid pooler endpoint is not acceptable.

## Shared Manual PowerShell Setup

Run this block from the repository root only in the separately approved phase.
It prompts for confirmation values and a password locally, rejects connection
strings by exact source comparison, clears inherited PostgreSQL target
overrides, requires TLS, and supplies compact output only. It intentionally
does not write evidence files or credentials.

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ApprovedProjectRef = 'gznwibespgkwknnvbrlv'
$ApprovedPoolerHost = 'aws-0-eu-north-1.pooler.supabase.com'
$ApprovedPort = '5432'
$ApprovedDatabase = 'postgres'
$ApprovedUser = 'postgres.gznwibespgkwknnvbrlv'
$ApprovedSslMode = 'require'
$MigrationPath = Join-Path (Get-Location) 'supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql'

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  throw 'BLOCKED|psql_not_available'
}
if (-not (Test-Path -LiteralPath $MigrationPath -PathType Leaf)) {
  throw 'BLOCKED|approved_migration_source_missing'
}

$DbHost = Read-Host 'Type the approved production pooler host'
$DbPort = Read-Host 'Type the approved production port'
$DbName = Read-Host 'Type the approved production database'
$DbUser = Read-Host 'Type the approved production pooler user'

if ($DbHost -cne $ApprovedPoolerHost -or
    $DbPort -cne $ApprovedPort -or
    $DbName -cne $ApprovedDatabase -or
    $DbUser -cne $ApprovedUser) {
  throw 'BLOCKED|source_anchored_production_target_mismatch'
}
if ($DbHost -match '://|/|\\|\?|@' -or
    $DbHost -match '^(localhost|127\.0\.0\.1)$' -or
    $DbHost -match '(?i)(staging|stage|preview|dev|test|prod|live)') {
  throw 'BLOCKED|invalid_or_ambiguous_production_pooler_host'
}
if ($DbUser -notmatch '^postgres\.([a-z0-9]{20})$' -or
    $Matches[1] -cne $ApprovedProjectRef) {
  throw 'BLOCKED|pooler_user_project_ref_mismatch'
}
if ($ApprovedSslMode -cne 'require') {
  throw 'BLOCKED|ssl_mode_not_require'
}

foreach ($Scope in @('Process', 'User', 'Machine')) {
  try {
    $RouteFlagValue = [Environment]::GetEnvironmentVariable(
      'DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED', $Scope)
  } catch {
    throw "BLOCKED|route_flag_scope_unreadable=$Scope"
  }
  if ($null -ne $RouteFlagValue -and
      $RouteFlagValue.Trim().Equals('true', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "BLOCKED|route_flag_enabled_in_scope=$Scope"
  }
}
Write-Output 'PASS|route_flag_disabled'

$PgEnvironmentNames = @(
  'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
  'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSSLMODE'
)
$PgEnvironmentSnapshot = @{}
foreach ($PgEnvironmentName in $PgEnvironmentNames) {
  $PgEnvironmentSnapshot[$PgEnvironmentName] = [Environment]::GetEnvironmentVariable(
    $PgEnvironmentName, 'Process')
}
if (-not [string]::IsNullOrEmpty($PgEnvironmentSnapshot['PGPASSWORD'])) {
  throw 'BLOCKED|inherited_pgpassword_present'
}
foreach ($PgEnvironmentName in $PgEnvironmentNames) {
  Remove-Item -LiteralPath "Env:$PgEnvironmentName" -ErrorAction SilentlyContinue
}

$PasswordBstr = [IntPtr]::Zero
try {
  $SecurePassword = Read-Host 'Enter the production database password locally' -AsSecureString
  $PasswordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordBstr)
  $env:PGSSLMODE = $ApprovedSslMode

  function Invoke-ProductionPsql {
    param([Parameter(Mandatory = $true)][string]$Sql)

    $OutputLines = @(& psql -X -w -q -A -t -v ON_ERROR_STOP=1 `
      -h $DbHost -p $DbPort -U $DbUser -d $DbName -c $Sql 2>$null)
    if ($LASTEXITCODE -ne 0) {
      throw 'FAIL|psql_command_failed'
    }
    $TrimmedLines = @($OutputLines | ForEach-Object { $_.Trim() } |
      Where-Object { -not [string]::IsNullOrEmpty($_) })
    $CompactLines = @($TrimmedLines |
      Where-Object { $_ -match '^(PASS|FAIL|BLOCKED|SKIPPED)\|' })
    if ($CompactLines.Count -eq 0) {
      throw 'FAIL|compact_psql_result_missing'
    }
    if (($TrimmedLines | Where-Object { $_ -notmatch '^(PASS|FAIL|BLOCKED|SKIPPED)\|' }).Count -ne 0) {
      throw 'FAIL|noncompact_psql_output'
    }
    $CompactLines | ForEach-Object { Write-Host $_ }
    if ($CompactLines | Where-Object { $_ -match '^(FAIL|BLOCKED)\|' }) {
      throw 'BLOCKED|phase_check_failed'
    }
    return $CompactLines
  }

  # Paste exactly one later phase command from the sections below here.
} finally {
  Remove-Item -LiteralPath 'Env:PGPASSWORD' -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath 'Env:PGSSLMODE' -ErrorAction SilentlyContinue
  if ($PasswordBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordBstr)
  }
  Remove-Variable -Name SecurePassword, PasswordBstr -ErrorAction SilentlyContinue
  foreach ($PgEnvironmentName in $PgEnvironmentNames) {
    if ($PgEnvironmentName -eq 'PGPASSWORD') { continue }
    $PreviousValue = $PgEnvironmentSnapshot[$PgEnvironmentName]
    if ($null -eq $PreviousValue) {
      Remove-Item -LiteralPath "Env:$PgEnvironmentName" -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($PgEnvironmentName, $PreviousValue, 'Process')
    }
  }
}
```

Do not replace `2>$null` with a command that writes raw psql diagnostics into
chat or evidence. A psql failure produces only `FAIL|psql_command_failed`.
Stop and seek separate diagnostic approval; do not run ad-hoc production SQL.

## Production Preflight Command

Production preflight requires separate approval and is read-only. Before
running it, remove the placeholder comment in the shared setup block and paste
the following assignment and invocation inside its `try` block. It starts a
read-only transaction and outputs only compact result lines.

```powershell
$MigrationHash = (Get-FileHash -LiteralPath $MigrationPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "PASS|migration_sha256=$MigrationHash"

$PreflightSql = @'
BEGIN READ ONLY;
WITH
  expected_tables(table_name) AS (
    VALUES
      ('admin_readiness_csrf_tokens'),
      ('admin_readiness_csrf_binding_index'),
      ('admin_readiness_throttle_windows')
  ),
  expected_functions(function_name, identity_arguments) AS (
    VALUES
      ('cleanup_admin_readiness_security_storage_v1', 'p_max_delete_count integer'),
      ('create_admin_readiness_csrf_token_v1', 'p_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone'),
      ('decide_admin_readiness_throttle_v1', 'p_security_namespace text, p_operation text, p_subject_hash text, p_window_started_at timestamp with time zone, p_window_expires_at timestamp with time zone, p_limit integer'),
      ('invalidate_admin_readiness_csrf_binding_v1', 'p_session_binding_digest text, p_max_delete_count integer'),
      ('read_admin_readiness_csrf_token_v1', 'p_token_digest text'),
      ('rotate_admin_readiness_csrf_token_v1', 'p_previous_token_digest text, p_new_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone')
  ),
  actual_security_tables AS (
    SELECT c.relname::text AS table_name
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname IN (SELECT table_name FROM expected_tables)
  ),
  all_admin_readiness_security_tables AS (
    SELECT c.relname::text AS table_name
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname ~ '^admin_readiness_(csrf|throttle)'
  ),
  actual_admin_functions AS (
    SELECT p.proname::text AS function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE '%admin_readiness%'
  ),
  business_schema_rows AS (
    SELECT 'relation|' || c.relkind::text || '|' || c.relname::text AS row_value
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN (SELECT table_name FROM expected_tables)
    UNION ALL
    SELECT 'column|' || c.relname::text || '|' || a.attnum::text || '|' ||
      a.attname::text || '|' || pg_catalog.format_type(a.atttypid, a.atttypmod) || '|' ||
      a.attnotnull::text || '|' || a.attidentity::text || '|' || a.attgenerated::text
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND c.relname NOT IN (SELECT table_name FROM expected_tables)
  ),
  business_schema_baseline AS (
    SELECT count(*)::text AS object_count,
      md5(coalesce(string_agg(row_value, E'\n' ORDER BY row_value), '')) AS schema_hash
    FROM business_schema_rows
  )
SELECT 'PASS|connected_database=' || current_database()
UNION ALL
SELECT 'PASS|database_name_verified'
WHERE current_database() = 'postgres'
UNION ALL
SELECT 'FAIL|connected_database_mismatch'
WHERE current_database() <> 'postgres'
UNION ALL
SELECT 'PASS|database_current_user_pooler_metadata=' || current_user
UNION ALL
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
  THEN 'PASS|service_role_exists' ELSE 'BLOCKED|service_role_missing' END
UNION ALL
SELECT CASE WHEN coalesce((SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = 'service_role'), false)
  THEN 'PASS|service_role_bypassrls_verified' ELSE 'BLOCKED|service_role_bypassrls_missing' END
UNION ALL
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
  AND pg_catalog.pg_has_role(current_user, 'service_role', 'MEMBER')
  THEN 'PASS|service_role_assumability_verified' ELSE 'BLOCKED|service_role_assumability_missing' END
UNION ALL
SELECT CASE WHEN pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
  THEN 'PASS|operator_public_schema_create_verified' ELSE 'BLOCKED|operator_public_schema_create_missing' END
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM all_admin_readiness_security_tables) = 0
  THEN 'PASS|approved_security_tables_absent' ELSE 'BLOCKED|approved_or_conflicting_security_tables_already_present' END
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM actual_admin_functions) = 0
  THEN 'PASS|admin_readiness_functions_absent' ELSE 'BLOCKED|admin_readiness_functions_already_present' END
UNION ALL
SELECT 'PASS|business_schema_baseline_count=' || object_count FROM business_schema_baseline
UNION ALL
SELECT 'PASS|business_schema_baseline_md5=' || schema_hash FROM business_schema_baseline
UNION ALL
SELECT 'PASS|security_table_size_baseline_bytes=' || coalesce(sum(pg_catalog.pg_total_relation_size(c.oid)), 0)::text
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (SELECT table_name FROM expected_tables);
COMMIT;
'@
$PreflightLines = Invoke-ProductionPsql -Sql $PreflightSql
Write-Output 'PASS|production_preflight_complete'
```

Record only the compact preflight lines locally. In particular, retain the
migration hash and the two `business_schema_baseline_*` values for the later
postflight comparison. Do not continue on `FAIL` or `BLOCKED`, including an
already-present approved object: it could be a prior/partial application and
requires a separate review.

The business-schema baseline records public relations and columns only. It is
drift evidence, not a complete schema-equivalence proof: it does not cover
defaults, constraints, indexes, or policies. The exact security-object, RLS,
grant, function-signature, and column-manifest checks remain separate required
postflight evidence.

## Production Apply Command

This section is blocked until a reviewer accepts the complete production
preflight evidence for the same target and migration hash. It does not run
postflight automatically.

Run the shared setup again in a new PowerShell session. Inside its `try` block,
first confirm the approved preflight evidence is available locally, then run:

```powershell
$Confirmation = Read-Host 'Type the exact production apply confirmation'
if ($Confirmation -cne 'PRODUCTION APPLY ADMIN READINESS SECURITY MIGRATION') {
  throw 'BLOCKED|production_apply_confirmation_mismatch'
}

$ReviewedPreflightHash = Read-Host 'Enter the reviewed preflight migration SHA-256'
if ($ReviewedPreflightHash -notmatch '^[0-9a-fA-F]{64}$') {
  throw 'BLOCKED|invalid_reviewed_preflight_migration_hash'
}
$ApplyTimeMigrationHash = (Get-FileHash -LiteralPath $MigrationPath -Algorithm SHA256).Hash
if (-not $ApplyTimeMigrationHash.Equals(
    $ReviewedPreflightHash, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'BLOCKED|migration_hash_changed_since_preflight'
}

Write-Output 'PASS|production_apply_target_reconfirmed'
Write-Output 'PASS|migration_hash_continuity_verified'
& psql -X -w -v ON_ERROR_STOP=1 `
  -h $DbHost -p $DbPort -U $DbUser -d $DbName `
  -f $MigrationPath 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'FAIL|production_migration_apply_failed'
}
Write-Output 'PASS|production_migration_applied'
Write-Output 'PASS|production_apply_complete'
```

The migration contains its own transaction envelope, so do not add
`--single-transaction`. This command may apply only the approved migration
file. It recomputes SHA-256 immediately before `psql -f` and blocks if the
result differs from the reviewed preflight hash. It must not set
`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED`, invoke any route, or run
postflight/behavior automatically.

## Production Postflight Command

Run this only after a successful approved apply. Start a new session with the
shared setup. When asked, enter the two safe baseline values captured during
preflight; they are schema fingerprint metadata, not credentials. Paste the
following inside the `try` block.

The SQL deliberately uses one `WITH` block followed immediately by the one
statement that consumes it. Do not split the CTE definitions from their final
`SELECT`; PostgreSQL CTEs exist only for the immediately following statement.

```powershell
$ExpectedBaselineCount = Read-Host 'Enter the compact preflight business-schema baseline count'
$ExpectedBaselineHash = Read-Host 'Enter the compact preflight business-schema baseline MD5'
if ($ExpectedBaselineCount -notmatch '^\d+$' -or $ExpectedBaselineHash -notmatch '^[0-9a-f]{32}$') {
  throw 'BLOCKED|invalid_preflight_baseline_evidence'
}

$PostflightSql = @'
WITH
  expected_tables(table_name) AS (
    VALUES
      ('admin_readiness_csrf_tokens'),
      ('admin_readiness_csrf_binding_index'),
      ('admin_readiness_throttle_windows')
  ),
  expected_functions(function_name, identity_arguments) AS (
    VALUES
      ('cleanup_admin_readiness_security_storage_v1', 'p_max_delete_count integer'),
      ('create_admin_readiness_csrf_token_v1', 'p_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone'),
      ('decide_admin_readiness_throttle_v1', 'p_security_namespace text, p_operation text, p_subject_hash text, p_window_started_at timestamp with time zone, p_window_expires_at timestamp with time zone, p_limit integer'),
      ('invalidate_admin_readiness_csrf_binding_v1', 'p_session_binding_digest text, p_max_delete_count integer'),
      ('read_admin_readiness_csrf_token_v1', 'p_token_digest text'),
      ('rotate_admin_readiness_csrf_token_v1', 'p_previous_token_digest text, p_new_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone')
  ),
  expected_columns(table_name, column_name) AS (
    VALUES
      ('admin_readiness_csrf_tokens', 'token_digest'),
      ('admin_readiness_csrf_tokens', 'session_binding_digest'),
      ('admin_readiness_csrf_tokens', 'operation'),
      ('admin_readiness_csrf_tokens', 'method'),
      ('admin_readiness_csrf_tokens', 'expires_at'),
      ('admin_readiness_csrf_tokens', 'created_at'),
      ('admin_readiness_csrf_tokens', 'replaced_by_token_digest'),
      ('admin_readiness_csrf_binding_index', 'token_digest'),
      ('admin_readiness_csrf_binding_index', 'session_binding_digest'),
      ('admin_readiness_csrf_binding_index', 'operation'),
      ('admin_readiness_csrf_binding_index', 'method'),
      ('admin_readiness_csrf_binding_index', 'expires_at'),
      ('admin_readiness_csrf_binding_index', 'created_at'),
      ('admin_readiness_throttle_windows', 'security_namespace'),
      ('admin_readiness_throttle_windows', 'operation'),
      ('admin_readiness_throttle_windows', 'subject_hash'),
      ('admin_readiness_throttle_windows', 'window_started_at'),
      ('admin_readiness_throttle_windows', 'window_expires_at'),
      ('admin_readiness_throttle_windows', 'request_count'),
      ('admin_readiness_throttle_windows', 'created_at'),
      ('admin_readiness_throttle_windows', 'updated_at')
  ),
  actual_tables AS (
    SELECT c.oid, c.relname::text AS table_name, c.relrowsecurity, c.relforcerowsecurity,
      c.relacl, c.relowner
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (SELECT table_name FROM expected_tables)
  ),
  all_admin_readiness_security_tables AS (
    SELECT c.relname::text AS table_name
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname ~ '^admin_readiness_(csrf|throttle)'
  ),
  approved_functions AS (
    SELECT p.oid, p.proname::text AS function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      p.prosecdef, p.proconfig, p.proacl, p.proowner
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (SELECT function_name FROM expected_functions)
  ),
  all_admin_functions AS (
    SELECT p.oid, p.proname::text AS function_name,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE '%admin_readiness%'
  ),
  unexpected_functions AS (
    SELECT f.* FROM all_admin_functions AS f
    WHERE NOT EXISTS (
      SELECT 1 FROM expected_functions AS e
      WHERE e.function_name = f.function_name
        AND e.identity_arguments = f.identity_arguments
    )
  ),
  browser_table_grants AS (
    SELECT count(*) AS grant_count
    FROM actual_tables AS t
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(t.relacl, pg_catalog.acldefault('r', t.relowner))) AS acl
    WHERE acl.grantee = 0
      OR acl.grantee IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated'))
  ),
  browser_function_grants AS (
    SELECT count(*) AS grant_count
    FROM approved_functions AS f
    CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) AS acl
    WHERE acl.privilege_type = 'EXECUTE'
      AND (acl.grantee = 0 OR acl.grantee IN (
        SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated')
      ))
  ),
  unsafe_columns AS (
    SELECT count(*) AS column_count
    FROM pg_catalog.pg_attribute AS a
    JOIN actual_tables AS t ON t.oid = a.attrelid
    WHERE a.attnum > 0 AND NOT a.attisdropped
      AND a.attname ~* '(raw|plain|jwt|cookie|header|password|secret|metadata)'
  ),
  actual_columns AS (
    SELECT t.table_name, a.attname::text AS column_name
    FROM actual_tables AS t
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.oid
    WHERE a.attnum > 0 AND NOT a.attisdropped
  ),
  business_schema_rows AS (
    SELECT 'relation|' || c.relkind::text || '|' || c.relname::text AS row_value
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN (SELECT table_name FROM expected_tables)
    UNION ALL
    SELECT 'column|' || c.relname::text || '|' || a.attnum::text || '|' ||
      a.attname::text || '|' || pg_catalog.format_type(a.atttypid, a.atttypmod) || '|' ||
      a.attnotnull::text || '|' || a.attidentity::text || '|' || a.attgenerated::text
    FROM pg_catalog.pg_attribute AS a
    JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attnum > 0 AND NOT a.attisdropped
      AND c.relname NOT IN (SELECT table_name FROM expected_tables)
  ),
  business_schema_baseline AS (
    SELECT count(*)::text AS object_count,
      md5(coalesce(string_agg(row_value, E'\n' ORDER BY row_value), '')) AS schema_hash
    FROM business_schema_rows
  )
SELECT CASE WHEN current_database() = 'postgres'
  THEN 'PASS|postflight_connected_database_verified'
  ELSE 'FAIL|postflight_connected_database_mismatch' END
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM actual_tables) = 3
  AND (SELECT count(*) FROM all_admin_readiness_security_tables) = 3
  AND NOT EXISTS (SELECT 1 FROM expected_tables AS e WHERE NOT EXISTS (
    SELECT 1 FROM actual_tables AS a WHERE a.table_name = e.table_name
  )) THEN 'PASS|approved_tables_exist' ELSE 'FAIL|approved_tables_missing_or_unexpected' END
UNION ALL
SELECT CASE WHEN coalesce((SELECT bool_and(relrowsecurity AND NOT relforcerowsecurity) FROM actual_tables), false)
  THEN 'PASS|rls_enabled_on_approved_tables' ELSE 'FAIL|rls_posture_invalid' END
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND tablename IN (SELECT table_name FROM expected_tables)) = 0
  THEN 'PASS|zero_browser_policies' ELSE 'FAIL|browser_policy_present' END
UNION ALL
SELECT CASE WHEN (SELECT grant_count FROM browser_table_grants) = 0
  THEN 'PASS|public_anon_authenticated_table_grants_revoked'
  ELSE 'FAIL|browser_table_grant_present' END
UNION ALL
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM actual_tables AS t
  WHERE NOT (
    pg_catalog.has_table_privilege('service_role', t.oid, 'SELECT') AND
    pg_catalog.has_table_privilege('service_role', t.oid, 'INSERT') AND
    pg_catalog.has_table_privilege('service_role', t.oid, 'UPDATE') AND
    pg_catalog.has_table_privilege('service_role', t.oid, 'DELETE')
  )
) THEN 'PASS|service_role_table_grants_verified' ELSE 'FAIL|service_role_table_grants_invalid' END
UNION ALL
SELECT CASE WHEN (SELECT column_count FROM unsafe_columns) = 0
  THEN 'PASS|no_unsafe_secret_columns' ELSE 'FAIL|unsafe_secret_column_present' END
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM actual_columns) = (SELECT count(*) FROM expected_columns)
  AND NOT EXISTS (SELECT 1 FROM expected_columns AS e WHERE NOT EXISTS (
    SELECT 1 FROM actual_columns AS a
    WHERE a.table_name = e.table_name AND a.column_name = e.column_name
  )) THEN 'PASS|approved_digest_only_column_manifest_verified'
  ELSE 'FAIL|unexpected_or_missing_security_column' END
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM approved_functions) = 6
  AND NOT EXISTS (SELECT 1 FROM expected_functions AS e WHERE NOT EXISTS (
    SELECT 1 FROM approved_functions AS f
    WHERE f.function_name = e.function_name AND f.identity_arguments = e.identity_arguments
  )) THEN 'PASS|approved_rpc_signatures_exist' ELSE 'FAIL|approved_rpc_signature_missing' END
UNION ALL
SELECT CASE WHEN (SELECT count(*) FROM unexpected_functions) = 0
  THEN 'PASS|no_unexpected_admin_readiness_functions'
  ELSE 'FAIL|unexpected_admin_readiness_function_or_overload' END
UNION ALL
SELECT CASE WHEN coalesce((SELECT bool_and(NOT prosecdef AND
  coalesce(array_to_string(proconfig, ','), '') LIKE '%search_path=pg_catalog, public%')
  FROM approved_functions), false)
  THEN 'PASS|rpc_security_invoker_and_search_path_verified'
  ELSE 'FAIL|rpc_security_invoker_or_search_path_invalid' END
UNION ALL
SELECT CASE WHEN (SELECT grant_count FROM browser_function_grants) = 0
  THEN 'PASS|public_anon_authenticated_rpc_execute_revoked'
  ELSE 'FAIL|browser_rpc_execute_grant_present' END
UNION ALL
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM approved_functions AS f
  WHERE NOT pg_catalog.has_function_privilege('service_role', f.oid, 'EXECUTE')
) THEN 'PASS|service_role_rpc_execute_verified' ELSE 'FAIL|service_role_rpc_execute_missing' END
UNION ALL
SELECT 'PASS|security_table_size_postflight_bytes=' || coalesce(sum(pg_catalog.pg_total_relation_size(oid)), 0)::text
FROM actual_tables
UNION ALL
SELECT 'PASS|business_schema_baseline_count=' || object_count FROM business_schema_baseline
UNION ALL
SELECT 'PASS|business_schema_baseline_md5=' || schema_hash FROM business_schema_baseline;
'@
$PostflightLines = Invoke-ProductionPsql -Sql $PostflightSql
$ActualBaselineCount = (($PostflightLines | Where-Object { $_ -like 'PASS|business_schema_baseline_count=*' }) -split '=', 2)[1]
$ActualBaselineHash = (($PostflightLines | Where-Object { $_ -like 'PASS|business_schema_baseline_md5=*' }) -split '=', 2)[1]
if ($ActualBaselineCount -cne $ExpectedBaselineCount -or $ActualBaselineHash -cne $ExpectedBaselineHash) {
  throw 'FAIL|business_schema_baseline_changed'
}
Write-Output 'PASS|business_schema_relation_column_drift_evidence_unchanged'
Write-Output 'PASS|production_postflight_complete'
```

Any output other than the exact compact pass set is a blocker. Do not repair
grants, policies, functions, overloads, tables, or business-schema drift by
hand. Do not proceed to behavior until postflight evidence is reviewed and
behavior has separate approval.

## RPC Signature Discovery Command

After postflight passes, use this read-only discovery command to record the
exact six approved signatures before behavior. Start a new shared setup
session and paste this inside its `try` block.

```powershell
$SignatureSql = @'
BEGIN READ ONLY;
WITH expected(function_name, identity_arguments) AS (
  VALUES
    ('cleanup_admin_readiness_security_storage_v1', 'p_max_delete_count integer'),
    ('create_admin_readiness_csrf_token_v1', 'p_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone'),
    ('decide_admin_readiness_throttle_v1', 'p_security_namespace text, p_operation text, p_subject_hash text, p_window_started_at timestamp with time zone, p_window_expires_at timestamp with time zone, p_limit integer'),
    ('invalidate_admin_readiness_csrf_binding_v1', 'p_session_binding_digest text, p_max_delete_count integer'),
    ('read_admin_readiness_csrf_token_v1', 'p_token_digest text'),
    ('rotate_admin_readiness_csrf_token_v1', 'p_previous_token_digest text, p_new_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone')
), actual AS (
  SELECT p.proname::text AS function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (SELECT function_name FROM expected)
)
SELECT 'PASS|rpc_signature=' || e.function_name || '(' || e.identity_arguments || ')'
FROM expected AS e
JOIN actual AS a ON a.function_name = e.function_name AND a.identity_arguments = e.identity_arguments
ORDER BY e.function_name, e.identity_arguments;
COMMIT;
'@
$SignatureLines = Invoke-ProductionPsql -Sql $SignatureSql
if (($SignatureLines | Where-Object { $_ -like 'PASS|rpc_signature=*' }).Count -ne 6) {
  throw 'FAIL|approved_rpc_signature_discovery_incomplete'
}
Write-Output 'PASS|production_rpc_signature_discovery_complete'
```

## Production Behavior Command

Behavior is a separate approved phase after postflight and signature discovery
are accepted. It uses only the production namespace
`admin_readiness_production_v1`, fixed test-only 64-hex digests, the six
private RPCs, and rolled-back transactions. It does not touch business tables
or invoke application routes.

Start a new shared setup session. Inside its `try` block, paste:

The throttle RPC returns `allow` only while `request_count < p_limit`. These
three separate statements share one transaction-stable 60-second window and
use limit `2`, so their deterministic expected sequence is first `allow`, then
second and third `rate_limited`. This is the same limit/window behavior already
observed in the approved staging evidence; separate statements are used so the
database cannot reorder the calls.

```powershell
$Confirmation = Read-Host 'Type the exact production behavior confirmation'
if ($Confirmation -cne 'PRODUCTION RUN ADMIN READINESS SECURITY BEHAVIOR CHECKS') {
  throw 'BLOCKED|production_behavior_confirmation_mismatch'
}

$BehaviorSql = @'
BEGIN;
SET LOCAL ROLE service_role;

SELECT 'PASS|csrf_create=' || result_code
FROM public.create_admin_readiness_csrf_token_v1(
  repeat('a', 64), repeat('e', 64), 'readiness_issue', 'POST', now() + interval '5 minutes'
);
SELECT 'PASS|csrf_collision=' || result_code
FROM public.create_admin_readiness_csrf_token_v1(
  repeat('a', 64), repeat('e', 64), 'readiness_issue', 'POST', now() + interval '5 minutes'
);
SELECT 'PASS|csrf_read=' || result_code
FROM public.read_admin_readiness_csrf_token_v1(repeat('a', 64));
SELECT 'PASS|csrf_rotate=' || result_code
FROM public.rotate_admin_readiness_csrf_token_v1(
  repeat('a', 64), repeat('b', 64), repeat('e', 64), 'readiness_issue', 'POST', now() + interval '5 minutes'
);
SELECT 'PASS|csrf_predecessor_after_rotate=' || result_code
FROM public.read_admin_readiness_csrf_token_v1(repeat('a', 64));
SELECT 'PASS|csrf_replacement_after_rotate=' || result_code
FROM public.read_admin_readiness_csrf_token_v1(repeat('b', 64));
SELECT 'PASS|csrf_expiring_create=' || result_code
FROM public.create_admin_readiness_csrf_token_v1(
  repeat('c', 64), repeat('d', 64), 'readiness_snapshot', 'POST', clock_timestamp() + interval '1 second'
);
SELECT pg_catalog.pg_sleep(2);
SELECT 'PASS|csrf_expired_read=' || result_code
FROM public.read_admin_readiness_csrf_token_v1(repeat('c', 64));
SELECT 'PASS|csrf_binding_invalidation=' || result_code
FROM public.invalidate_admin_readiness_csrf_binding_v1(repeat('e', 64), 4);
SELECT 'PASS|csrf_after_invalidation=' || result_code
FROM public.read_admin_readiness_csrf_token_v1(repeat('b', 64));
CREATE TEMP TABLE admin_readiness_behavior_timing (
  window_started_at timestamptz NOT NULL,
  window_expires_at timestamptz NOT NULL
) ON COMMIT DROP;
INSERT INTO pg_temp.admin_readiness_behavior_timing (
  window_started_at, window_expires_at
) VALUES (now(), now() + interval '60 seconds');
SELECT 'PASS|throttle_first=' || result_code
FROM pg_temp.admin_readiness_behavior_timing AS timing
CROSS JOIN LATERAL public.decide_admin_readiness_throttle_v1(
  'admin_readiness_production_v1', 'readiness_issue', repeat('f', 64),
  timing.window_started_at, timing.window_expires_at, 2
);
SELECT 'PASS|throttle_second=' || result_code
FROM pg_temp.admin_readiness_behavior_timing AS timing
CROSS JOIN LATERAL public.decide_admin_readiness_throttle_v1(
  'admin_readiness_production_v1', 'readiness_issue', repeat('f', 64),
  timing.window_started_at, timing.window_expires_at, 2
);
SELECT 'PASS|throttle_third=' || result_code
FROM pg_temp.admin_readiness_behavior_timing AS timing
CROSS JOIN LATERAL public.decide_admin_readiness_throttle_v1(
  'admin_readiness_production_v1', 'readiness_issue', repeat('f', 64),
  timing.window_started_at, timing.window_expires_at, 2
);
SELECT 'PASS|cleanup=' || result_code
FROM public.cleanup_admin_readiness_security_storage_v1(10);
SELECT CASE WHEN
  (SELECT count(*) FROM public.admin_readiness_csrf_tokens
   WHERE token_digest IN (repeat('a', 64), repeat('b', 64), repeat('c', 64))) = 1
  AND (SELECT count(*) FROM public.admin_readiness_throttle_windows
       WHERE security_namespace = 'admin_readiness_production_v1'
         AND subject_hash = repeat('f', 64)) = 1
  THEN 'PASS|behavior_test_rows_present_only_inside_rollback_transaction'
  ELSE 'FAIL|behavior_test_rows_unexpected' END;
ROLLBACK;
BEGIN;
SET LOCAL ROLE service_role;
SELECT CASE WHEN
  (SELECT count(*) FROM public.admin_readiness_csrf_tokens
   WHERE token_digest IN (repeat('a', 64), repeat('b', 64), repeat('c', 64))) = 0
  AND (SELECT count(*) FROM public.admin_readiness_throttle_windows
       WHERE security_namespace = 'admin_readiness_production_v1'
         AND subject_hash = repeat('f', 64)) = 0
  THEN 'PASS|behavior_test_rows_rolled_back'
  ELSE 'FAIL|behavior_test_rows_remain' END;
ROLLBACK;
SELECT 'PASS|behavior_transactions_rolled_back';
'@
$BehaviorLines = Invoke-ProductionPsql -Sql $BehaviorSql
$ExpectedBehaviorLines = @(
  'PASS|csrf_create=created',
  'PASS|csrf_collision=conflict',
  'PASS|csrf_read=found',
  'PASS|csrf_rotate=rotated',
  'PASS|csrf_predecessor_after_rotate=missing',
  'PASS|csrf_replacement_after_rotate=found',
  'PASS|csrf_expiring_create=created',
  'PASS|csrf_expired_read=expired',
  'PASS|csrf_binding_invalidation=invalidated',
  'PASS|csrf_after_invalidation=missing',
  'PASS|throttle_first=allow',
  'PASS|throttle_second=rate_limited',
  'PASS|throttle_third=rate_limited',
  'PASS|cleanup=cleaned',
  'PASS|behavior_test_rows_present_only_inside_rollback_transaction',
  'PASS|behavior_test_rows_rolled_back',
  'PASS|behavior_transactions_rolled_back'
)
foreach ($ExpectedBehaviorLine in $ExpectedBehaviorLines) {
  if ($BehaviorLines -notcontains $ExpectedBehaviorLine) {
    throw 'FAIL|production_behavior_result_mismatch'
  }
}
Write-Output 'PASS|production_behavior_result_codes_only'
Write-Output 'PASS|production_behavior_complete'
```

The psql wrapper retains only lines that begin `PASS|`, `FAIL|`, `BLOCKED|`, or
`SKIPPED|`; all recorded behavior outputs are therefore safe result codes, not
tokens, token digests, session bindings, cookies, headers, JWTs, passwords, or
provider diagnostics. Do not share any other console output.

## Stop Rules

Stop immediately if any command emits `FAIL|` or `BLOCKED|`, returns a nonzero
psql exit code, produces a different migration hash, shows a pre-existing or
unexpected object, cannot prove the source-anchored pooler identity, or finds
the route flag enabled. Do not retry with altered SQL, an alternate host/user,
or a direct database hostname. Review the compact evidence and obtain new
approval before the next phase.

## Evidence Redaction

Only compact `PASS|`, `FAIL|`, `BLOCKED|`, and `SKIPPED|` lines may be pasted
for review. Never paste passwords, connection strings, tokens, JWTs, cookies,
headers, raw digests, full `.env` values, raw SQL output, psql diagnostics, or
provider credentials. The migration SHA-256, approved non-secret identity
constants, object counts, table sizes, and schema baseline hashes are safe
evidence only when required by this reviewed runbook.

## Current Forbidden Actions

Even after all migration checks pass, these actions remain blocked without a
later separate approval:

- production route enablement;
- runtime adoption or admin UI release;
- M030/live readiness issuance;
- approval execution;
- merchant activation;
- collection unlock; and
- payment, provider, checkout, subscription, invoice, or storefront behavior.

## Production Success Criteria

The production migration sequence is successful only after preflight, apply,
postflight, RPC signature discovery, and behavior all pass; the business
schema baseline is unchanged except for the approved security objects; behavior
test rows are rolled back; and the route flag remains disabled. This does not
authorize runtime adoption or route enablement.

## Next Sequence

1. Review and commit this runbook.
2. Obtain separate approval for user-run production preflight only.
3. Review compact preflight evidence, including the migration hash and safe
   baseline values.
4. Approve production apply only if preflight passes.
5. Run and review postflight.
6. Run and review RPC signature discovery.
7. Obtain separate approval for behavior, then run it.
8. Record a compact production evidence checkpoint.
9. Consider any route/runtime gate only through a later, separate review.
