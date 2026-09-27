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
  if ((Read-Host 'Type LOCAL POSTBOOTSTRAP M024 PREREQS to continue').Trim() -cne 'LOCAL POSTBOOTSTRAP M024 PREREQS') { throw 'LOCAL_CONFIRMATION_REQUIRED' }
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

function Get-PostflightSql {
  return @'
BEGIN READ ONLY;
DO $identity$
BEGIN
  IF current_database() <> :'expected_database' OR current_user <> :'expected_user' OR session_user <> :'expected_user' THEN
    RAISE EXCEPTION 'local target identity mismatch';
  END IF;
END;
$identity$;
SELECT 'PASS|SCHEMA|public|exists' WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public');
SELECT 'BLOCKED|SCHEMA|public|missing' WHERE NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public');
SELECT 'PASS|SCHEMA|public|authority_ok' WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public')
  AND has_schema_privilege(current_user, 'public', 'USAGE')
  AND has_schema_privilege(current_user, 'public', 'CREATE');
SELECT 'BLOCKED|SCHEMA|public|insufficient_authority' WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public')
  AND (NOT has_schema_privilege(current_user, 'public', 'USAGE')
    OR NOT has_schema_privilege(current_user, 'public', 'CREATE'));
SELECT 'PASS|ROLE_BASELINE|required_roles_present' WHERE NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS required(name) WHERE to_regrole(required.name) IS NULL
);
SELECT 'BLOCKED|ROLE_BASELINE|required_role_missing' WHERE EXISTS (
  SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) AS required(name) WHERE to_regrole(required.name) IS NULL
);
SELECT 'PASS|UUID_FUNCTION|gen_random_uuid_available' WHERE to_regprocedure('gen_random_uuid()') IS NOT NULL;
SELECT 'BLOCKED|UUID_FUNCTION|gen_random_uuid_missing' WHERE to_regprocedure('gen_random_uuid()') IS NULL;
WITH required(name) AS (VALUES ('merchants'), ('invoices'), ('payment_records'))
SELECT 'PASS|BASE_TABLES|m024_minimum_shape_present' WHERE NOT EXISTS (
  SELECT 1 FROM required WHERE to_regclass('public.' || name) IS NULL
    OR (SELECT c.relkind FROM pg_class c WHERE c.oid = to_regclass('public.' || name)) <> 'r'
    OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.' || name)
      AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull
      AND format_type(a.atttypid, a.atttypmod) = 'uuid')
    OR NOT EXISTS (SELECT 1 FROM pg_index i JOIN LATERAL unnest(i.indkey) WITH ORDINALITY key_state(attnum, ordinality) ON key_state.ordinality = 1
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key_state.attnum
      WHERE i.indrelid = to_regclass('public.' || name) AND i.indisunique AND i.indisvalid AND i.indisready
        AND i.indnkeyatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL AND a.attname = 'id')
);
WITH required(name) AS (VALUES ('merchants'), ('invoices'), ('payment_records'))
SELECT 'BLOCKED|BASE_TABLES|m024_minimum_shape_missing_or_conflicting' WHERE EXISTS (
  SELECT 1 FROM required WHERE to_regclass('public.' || name) IS NULL
    OR (SELECT c.relkind FROM pg_class c WHERE c.oid = to_regclass('public.' || name)) <> 'r'
    OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.' || name)
      AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull
      AND format_type(a.atttypid, a.atttypmod) = 'uuid')
);
SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'PASS|MIGRATION_HISTORY|chain_absent'
  WHEN NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN (
    '20260820_00_prd_phase_2_compliance_schema_substrate','20260824_00_reviewed_profile_bootstrap_rpc','20260825_00_reviewed_profile_approval_rpc','20260825_01_cleanup_approval_rpc_diagnostics','20260825_02_canonical_approval_snapshot_idempotency','20260826_00_canonical_workspace_linkage','20260827_00_m028_m029_readiness_integration'
  )) THEN 'PASS|MIGRATION_HISTORY|chain_absent' ELSE 'BLOCKED|MIGRATION_HISTORY|m024_to_m030_present' END;
WITH protected(name) AS (VALUES
  ('merchant_compliance_profiles'), ('merchant_compliance_reviews'), ('merchant_compliance_events'),
  ('merchant_collection_limit_windows'), ('merchant_collection_limit_reservations'), ('merchant_collection_limit_reservation_windows'),
  ('merchant_collection_usage_events'), ('approval_policy_versions'), ('approval_decision_requests'), ('merchant_canonical_workspaces')
)
SELECT CASE WHEN count(to_regclass('public.' || name)) = 0 THEN 'PASS|OBJECT_STATE|protected_objects_absent'
  ELSE 'BLOCKED|OBJECT_STATE|protected_object_present' END FROM protected;
WITH protected(name) AS (VALUES
  ('bootstrap_reviewed_profile_v1'), ('review_compliance_profile_decision_v1'),
  ('issue_canonical_approval_decision_request_v1'), ('read_canonical_approval_snapshot_v1'),
  ('reconcile_canonical_merchant_workspace_link_v1')
)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM protected JOIN pg_proc p ON p.proname = protected.name JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
) THEN 'PASS|RPC_STATE|protected_objects_absent' ELSE 'BLOCKED|RPC_STATE|protected_object_present' END;
ROLLBACK;
'@
}

$savedEnvironment = @{}
$sqlPath = $null
$bstr = [IntPtr]::Zero
try {
  Assert-LocalTarget
  $psql = Resolve-PsqlExecutable
  Write-Evidence PASS PSQL resolved
  $sqlPath = Join-Path ([IO.Path]::GetTempPath()) ('deraledger-m024-postbootstrap-{0}.sql' -f [guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllText($sqlPath, (Get-PostflightSql), [Text.UTF8Encoding]::new($false))
  $securePassword = Read-Host 'Database password (secure prompt; never echoed or written)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  foreach ($name in $PgEnvironmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  [Environment]::SetEnvironmentVariable('PGPASSWORD', $plainPassword, 'Process')
  $arguments = @('-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', ("expected_database={0}" -f $Database), '-v', ("expected_user={0}" -f $User), '-h', $Host, '-p', $Port, '-U', $User, '-d', $Database, '-f', $sqlPath)
  $output = @(& $psql @arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { Write-Evidence BLOCKED POSTBOOTSTRAP psql_exit_nonzero; exit 1 }
  $evidence = @($output | Where-Object { [string]$_ -match '^(PASS|FAIL|BLOCKED)\|' })
  foreach ($line in $evidence) { Write-Output $line }
  if ($evidence | Where-Object { $_ -match '^(FAIL|BLOCKED)\|' }) { Write-Evidence BLOCKED DECISION BLOCKED_POSTBOOTSTRAP; exit 1 }
  Write-Evidence PASS DECISION READY_FOR_M024_LOCAL_APPLY_REVIEW
} catch {
  $message = $_.Exception.Message
  if ($message -eq 'PSQL_NOT_FOUND') { Write-Evidence BLOCKED PSQL not_found }
  elseif ($message -eq 'LOCAL_DATABASE_RESERVED_ENVIRONMENT_TOKEN') { Write-Evidence BLOCKED LOCAL_DATABASE reserved_environment_token }
  elseif ($message -eq 'LOCAL_DISPOSABLE_DATABASE_NAME_REQUIRED') { Write-Evidence BLOCKED LOCAL_DATABASE disposable_name_required }
  elseif ($message -eq 'LOCAL_CONFIRMATION_REQUIRED') { Write-Evidence BLOCKED CONFIRMATION required }
  else { Write-Evidence BLOCKED POSTBOOTSTRAP local_guard_or_invocation_failed }
  Write-Evidence BLOCKED DECISION BLOCKED_POSTBOOTSTRAP
  exit 1
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  foreach ($name in $PgEnvironmentNames) { if ($savedEnvironment.ContainsKey($name)) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') } }
  if ($null -ne $sqlPath -and (Test-Path -LiteralPath $sqlPath)) { Remove-Item -LiteralPath $sqlPath -Force -ErrorAction SilentlyContinue }
}
