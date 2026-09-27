[CmdletBinding()]
param(
  [string]$Host = '127.0.0.1',
  [string]$Port = '55432',
  [string]$User = 'postgres',
  [string]$Database = 'deraledger_m024_m030_rehearsal',
  [string]$PsqlPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PgEnvironmentNames = @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSSLMODE')
$ProtectedTables = @(
  'merchant_compliance_profiles', 'merchant_compliance_reviews', 'merchant_compliance_events',
  'merchant_collection_limit_windows', 'merchant_collection_limit_reservations',
  'merchant_collection_limit_reservation_windows', 'merchant_collection_usage_events',
  'approval_policy_versions', 'approval_decision_requests', 'merchant_canonical_workspaces'
)
$ProtectedFunctions = @(
  'bootstrap_reviewed_profile_v1', 'review_compliance_profile_decision_v1',
  'issue_canonical_approval_decision_request_v1', 'read_canonical_approval_snapshot_v1',
  'reconcile_canonical_merchant_workspace_link_v1'
)
$MigrationVersions = @(
  '20260820_00_prd_phase_2_compliance_schema_substrate',
  '20260824_00_reviewed_profile_bootstrap_rpc',
  '20260825_00_reviewed_profile_approval_rpc',
  '20260825_01_cleanup_approval_rpc_diagnostics',
  '20260825_02_canonical_approval_snapshot_idempotency',
  '20260826_00_canonical_workspace_linkage',
  '20260827_00_m028_m029_readiness_integration'
)

function Write-Evidence {
  param([ValidateSet('PASS', 'FAIL', 'BLOCKED')] [string]$State, [string]$Check, [string]$Category)
  Write-Output ('{0}|{1}|{2}' -f $State, $Check, $Category)
}

function Assert-LocalTarget {
  if ($Host -cne '127.0.0.1') { throw 'LOCAL_HOST_MUST_BE_127_0_0_1' }
  if ($Port -ne '55432') { throw 'LOCAL_PORT_MUST_BE_55432' }
  if ($User -ine 'postgres') { throw 'LOCAL_USER_MUST_BE_POSTGRES' }
  $reserved = '(?i)(production|prod|staging|stage|preview|live|main|primary|shared|default|template|postgres|supabase)'
  if ($Database -match $reserved) { throw 'LOCAL_DATABASE_RESERVED_ENVIRONMENT_TOKEN' }
  if ($Database -notmatch '(?i)^deraledger_[a-z0-9_]*rehearsal[a-z0-9_]*$') { throw 'LOCAL_DISPOSABLE_DATABASE_NAME_REQUIRED' }
  Write-Evidence PASS LOCAL_TARGET loopback
  Write-Evidence PASS LOCAL_PORT 55432
  Write-Evidence PASS LOCAL_USER postgres
  Write-Evidence PASS LOCAL_DATABASE disposable
  if ((Read-Host 'Type LOCAL BOOTSTRAP M024 PREREQS to continue').Trim() -cne 'LOCAL BOOTSTRAP M024 PREREQS') { throw 'LOCAL_CONFIRMATION_REQUIRED' }
}

function Resolve-PsqlExecutable {
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($PsqlPath)) { $candidates += $PsqlPath }
  $command = Get-Command -Name 'psql' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $command -and -not [string]::IsNullOrWhiteSpace($command.Source)) { $candidates += $command.Source }
  $candidates += @('C:\Program Files\PostgreSQL\15\bin\psql.exe', 'C:\Program Files\PostgreSQL\17\bin\psql.exe')
  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw 'PSQL_NOT_FOUND'
}

function Get-BootstrapSql {
  $migrationValues = ($MigrationVersions | ForEach-Object { "('{0}')" -f $_ }) -join ",`n    "
  $tableValues = ($ProtectedTables | ForEach-Object { "('{0}')" -f $_ }) -join ",`n    "
  $functionValues = ($ProtectedFunctions | ForEach-Object { "('{0}')" -f $_ }) -join ",`n    "
  return @"
BEGIN;
DO \$preflight\$
BEGIN
  IF current_database() <> :'expected_database' OR current_user <> :'expected_user' OR session_user <> :'expected_user' THEN
    RAISE EXCEPTION 'local target identity mismatch';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AND EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN (
    $migrationValues
    )
  ) THEN RAISE EXCEPTION 'M024-M030 migration history exists'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
    $tableValues
  ) AS expected(name) WHERE to_regclass('public.' || expected.name) IS NOT NULL) THEN
    RAISE EXCEPTION 'M024-M030 protected table exists';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
    $functionValues
  ) AS expected(name) JOIN pg_proc p ON p.proname = expected.name JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') THEN
    RAISE EXCEPTION 'M024-M030 protected function exists';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('merchants'), ('invoices'), ('payment_records')) AS required(name)
    WHERE to_regclass('public.' || required.name) IS NOT NULL AND (
      (SELECT c.relkind FROM pg_class c WHERE c.oid = to_regclass('public.' || required.name)) <> 'r'
      OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.' || required.name)
        AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull
        AND format_type(a.atttypid, a.atttypmod) = 'uuid')
      OR NOT EXISTS (SELECT 1 FROM pg_index i JOIN LATERAL unnest(i.indkey) WITH ORDINALITY key_state(attnum, ordinality) ON key_state.ordinality = 1
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key_state.attnum
        WHERE i.indrelid = to_regclass('public.' || required.name) AND i.indisunique AND i.indisvalid AND i.indisready
          AND i.indnkeyatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL AND a.attname = 'id')
    )
  ) THEN RAISE EXCEPTION 'existing prerequisite table conflicts with M024 minimum shape'; END IF;
END;
\$preflight\$;

DO \$public_schema\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') THEN
    EXECUTE 'CREATE SCHEMA public AUTHORIZATION ' || quote_ident(current_user);
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'USAGE')
    OR NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'public schema authority is insufficient for local bootstrap';
  END IF;
END;
\$public_schema\$;

DO \$managed_roles\$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF to_regrole(v_role) IS NULL THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', v_role);
    END IF;
  END LOOP;
END;
\$managed_roles\$;

SELECT CASE WHEN to_regprocedure('gen_random_uuid()') IS NULL THEN 'true' ELSE 'false' END AS needs_pgcrypto \gset
\if :needs_pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;
\endif
DO \$uuid_function\$
BEGIN
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN RAISE EXCEPTION 'gen_random_uuid remains unavailable'; END IF;
END;
\$uuid_function\$;

CREATE TABLE IF NOT EXISTS public.merchants (id uuid NOT NULL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.invoices (id uuid NOT NULL PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.payment_records (id uuid NOT NULL PRIMARY KEY);
COMMIT;
SELECT 'PASS|SCHEMA|public|exists';
SELECT 'PASS|SCHEMA|public|authority_ok';
SELECT 'PASS|ROLE_BASELINE|required_roles_present';
SELECT 'PASS|UUID_FUNCTION|gen_random_uuid_available';
SELECT 'PASS|BASE_TABLES|m024_minimum_shape_present';
SELECT 'PASS|BOOTSTRAP_SCOPE|m024_to_m030_not_applied';
"@
}

function Get-PublicSchemaPrecheckSql {
  return @'
BEGIN READ ONLY;
SELECT 'PASS|SCHEMA|public|exists' WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public');
SELECT 'BLOCKED|SCHEMA|public|missing' WHERE NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public');
SELECT 'PASS|SCHEMA|public|authority_ok' WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public')
  AND has_schema_privilege(current_user, 'public', 'USAGE')
  AND has_schema_privilege(current_user, 'public', 'CREATE');
SELECT 'BLOCKED|SCHEMA|public|insufficient_authority' WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public')
  AND (NOT has_schema_privilege(current_user, 'public', 'USAGE')
    OR NOT has_schema_privilege(current_user, 'public', 'CREATE'));
ROLLBACK;
'@
}

$savedEnvironment = @{}
$sqlPath = $null
$schemaPrecheckPath = $null
$bstr = [IntPtr]::Zero
try {
  Assert-LocalTarget
  $psql = Resolve-PsqlExecutable
  Write-Evidence PASS PSQL resolved
  $securePassword = Read-Host 'Database password (secure prompt; never echoed or written)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  foreach ($name in $PgEnvironmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  [Environment]::SetEnvironmentVariable('PGPASSWORD', $plainPassword, 'Process')

  $schemaPrecheckPath = Join-Path ([IO.Path]::GetTempPath()) ('deraledger-m024-schema-precheck-{0}.sql' -f [guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllText($schemaPrecheckPath, (Get-PublicSchemaPrecheckSql), [Text.UTF8Encoding]::new($false))
  $precheckArguments = @('-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', $Host, '-p', $Port, '-U', $User, '-d', $Database, '-f', $schemaPrecheckPath)
  $precheckOutput = @(& $psql @precheckArguments 2>&1)
  if ($LASTEXITCODE -ne 0) { Write-Evidence BLOCKED BOOTSTRAP schema_precheck_failed; Write-Evidence BLOCKED DECISION BLOCKED_BOOTSTRAP; exit 1 }
  $schemaEvidence = @($precheckOutput | Where-Object { [string]$_ -match '^(PASS|BLOCKED)\|SCHEMA\|public\|' })
  foreach ($line in $schemaEvidence) { Write-Output $line }
  if ($schemaEvidence -match '^BLOCKED\|SCHEMA\|public\|missing$') { Write-Evidence BLOCKED DECISION BLOCKED_SCHEMA; exit 1 }
  if ($schemaEvidence -match '^BLOCKED\|SCHEMA\|public\|insufficient_authority$') { Write-Evidence BLOCKED DECISION BLOCKED_SCHEMA; exit 1 }
  if (($schemaEvidence -notcontains 'PASS|SCHEMA|public|exists') -or ($schemaEvidence -notcontains 'PASS|SCHEMA|public|authority_ok')) {
    Write-Evidence BLOCKED BOOTSTRAP schema_precheck_incomplete; Write-Evidence BLOCKED DECISION BLOCKED_SCHEMA; exit 1
  }
  Remove-Item -LiteralPath $schemaPrecheckPath -Force -ErrorAction SilentlyContinue
  $schemaPrecheckPath = $null

  $sqlPath = Join-Path ([IO.Path]::GetTempPath()) ('deraledger-m024-bootstrap-{0}.sql' -f [guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllText($sqlPath, (Get-BootstrapSql), [Text.UTF8Encoding]::new($false))
  $arguments = @('-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', ("expected_database={0}" -f $Database), '-v', ("expected_user={0}" -f $User), '-h', $Host, '-p', $Port, '-U', $User, '-d', $Database, '-f', $sqlPath)
  $output = @(& $psql @arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { Write-Evidence BLOCKED BOOTSTRAP psql_exit_nonzero; exit 1 }
  foreach ($line in $output) { if ([string]$line -match '^(PASS|FAIL|BLOCKED)\|') { Write-Output $line } }
  Write-Evidence PASS DECISION READY_FOR_M024_LOCAL_APPLY_REVIEW
} catch {
  $message = $_.Exception.Message
  if ($message -eq 'PSQL_NOT_FOUND') { Write-Evidence BLOCKED PSQL not_found }
  elseif ($message -eq 'LOCAL_DATABASE_RESERVED_ENVIRONMENT_TOKEN') { Write-Evidence BLOCKED LOCAL_DATABASE reserved_environment_token }
  elseif ($message -eq 'LOCAL_DISPOSABLE_DATABASE_NAME_REQUIRED') { Write-Evidence BLOCKED LOCAL_DATABASE disposable_name_required }
  elseif ($message -eq 'LOCAL_CONFIRMATION_REQUIRED') { Write-Evidence BLOCKED CONFIRMATION required }
  else { Write-Evidence BLOCKED BOOTSTRAP local_guard_or_invocation_failed }
  Write-Evidence BLOCKED DECISION BLOCKED_BOOTSTRAP
  exit 1
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  foreach ($name in $PgEnvironmentNames) { if ($savedEnvironment.ContainsKey($name)) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') } }
  if ($null -ne $schemaPrecheckPath -and (Test-Path -LiteralPath $schemaPrecheckPath)) { Remove-Item -LiteralPath $schemaPrecheckPath -Force -ErrorAction SilentlyContinue }
  if ($null -ne $sqlPath -and (Test-Path -LiteralPath $sqlPath)) { Remove-Item -LiteralPath $sqlPath -Force -ErrorAction SilentlyContinue }
}
