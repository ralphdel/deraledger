[CmdletBinding()]
param(
  [string]$PgHostName = '127.0.0.1',
  [ValidateRange(1, 65535)][int]$PgPort = 55432,
  [string]$PgUser = 'postgres',
  [string]$DatabasePrefix = 'deraledger_phase2b_approve_atomicity_',
  [ValidateRange(1, 99)][int]$ExpectedMajor = 15,
  [string]$PgBinDirectory = '',
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

function Assert-LocalTarget {
  param([string]$TargetHost, [int]$TargetPort, [string]$TargetUser, [string]$TargetPrefix)
  if ($TargetHost -cnotin @('127.0.0.1', '::1')) {
    throw 'BLOCKED|APPROVE_ATOMICITY|nonlocal_host'
  }
  if ($TargetPort -lt 1 -or $TargetPort -gt 65535) {
    throw 'BLOCKED|APPROVE_ATOMICITY|invalid_port'
  }
  if ($TargetUser -cnotmatch '^[a-z][a-z0-9_]{0,62}$') {
    throw 'BLOCKED|APPROVE_ATOMICITY|invalid_user'
  }
  if ($TargetPrefix -cnotmatch '^[a-z][a-z0-9_]{8,48}_$' -or
      $TargetPrefix -match '(?i)(staging|production|supabase|prod)' -or
      $TargetPrefix.Length + 'baseline_disposable'.Length -gt 63) {
    throw 'BLOCKED|APPROVE_ATOMICITY|invalid_disposable_prefix'
  }
}

function Assert-LocalPostgresListener {
  param([string]$TargetHost, [int]$TargetPort)
  if ($null -eq (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) {
    throw 'BLOCKED|APPROVE_ATOMICITY|local_listener_unverifiable'
  }
  $allowedAddresses = if ($TargetHost -ceq '::1') {
    @('::1', '::')
  } else {
    @('127.0.0.1', '0.0.0.0')
  }
  $listeners = @(Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -cin $allowedAddresses })
  if ($listeners.Count -lt 1) {
    throw 'BLOCKED|APPROVE_ATOMICITY|local_postgres_unavailable'
  }
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($null -eq $process -or $process.ProcessName -cne 'postgres') {
      throw 'BLOCKED|APPROVE_ATOMICITY|local_listener_not_postgres'
    }
  }
}

function Assert-NoConnectionEnvironment {
  foreach ($variableName in @(
    'PGPASSWORD', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE',
    'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGUSER', 'PGDATABASE',
    'PGOPTIONS', 'DATABASE_URL', 'SUPABASE_DB_URL'
  )) {
    if (Test-Path -LiteralPath "Env:$variableName") {
      throw 'BLOCKED|APPROVE_ATOMICITY|connection_environment_present'
    }
  }
}

function Resolve-LocalProgram {
  param([string]$ProgramName, [string]$BinaryDirectory)
  if (-not [string]::IsNullOrWhiteSpace($BinaryDirectory)) {
    $candidate = Join-Path -Path $BinaryDirectory -ChildPath $ProgramName
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      throw 'BLOCKED|APPROVE_ATOMICITY|local_postgres_tools_unavailable'
    }
    return (Resolve-Path -LiteralPath $candidate).Path
  }
  $command = Get-Command $ProgramName -ErrorAction SilentlyContinue
  if ($null -eq $command -or -not $command.Source) {
    throw 'BLOCKED|APPROVE_ATOMICITY|local_postgres_tools_unavailable'
  }
  return $command.Source
}

function Parse-LocalIdentityControl {
  param([string[]]$OutputLines)
  $controlRows = @($OutputLines | ForEach-Object {
    ([string]$_).Trim().TrimStart([char]0xFEFF).Trim()
  } | Where-Object { $_ -match '^CONTROL\|PHASE2B_APPROVE_ATOMICITY_IDENTITY\|' })
  if ($controlRows.Count -ne 1) {
    throw 'BLOCKED|APPROVE_ATOMICITY|local_identity_invalid'
  }
  $match = [regex]::Match(
    $controlRows[0],
    '^CONTROL\|PHASE2B_APPROVE_ATOMICITY_IDENTITY\|([^|]+)\|([0-9]+)\|([0-9]+)\|(ready|drifted)$'
  )
  if (-not $match.Success) {
    throw 'BLOCKED|APPROVE_ATOMICITY|local_identity_invalid'
  }
  return $match
}

if ($SelfTest) {
  Assert-LocalTarget '127.0.0.1' 55432 'postgres' 'deraledger_phase2b_approve_atomicity_'
  foreach ($invalidHost in @('db.example.invalid', '10.0.0.1', '127.0.0.2', 'localhost')) {
    try {
      Assert-LocalTarget $invalidHost 55432 'postgres' 'deraledger_phase2b_approve_atomicity_'
      throw 'FAIL|APPROVE_ATOMICITY|self_test_nonlocal_accepted'
    } catch {
      if ($_.Exception.Message -cne 'BLOCKED|APPROVE_ATOMICITY|nonlocal_host') { throw }
    }
  }
  foreach ($invalidPrefix in @('production_', 'staging_', 'supabase_', 'x_', ('x' * 48 + '_'))) {
    try {
      Assert-LocalTarget '127.0.0.1' 55432 'postgres' $invalidPrefix
      throw 'FAIL|APPROVE_ATOMICITY|self_test_prefix_accepted'
    } catch {
      if ($_.Exception.Message -cne 'BLOCKED|APPROVE_ATOMICITY|invalid_disposable_prefix') { throw }
    }
  }
  $validControl = 'CONTROL|PHASE2B_APPROVE_ATOMICITY_IDENTITY|127.0.0.1|55432|15|ready'
  $null = Parse-LocalIdentityControl @('notice', ([char]0xFEFF + $validControl + "`r"))
  foreach ($invalidControl in @(
    @(), @($validControl, $validControl),
    @('CONTROL|PHASE2B_APPROVE_ATOMICITY_IDENTITY|127.0.0.1|55432|15'),
    @('CONTROL|PHASE2B_APPROVE_ATOMICITY_IDENTITY|127.0.0.1|55432|15|unknown')
  )) {
    try {
      $null = Parse-LocalIdentityControl $invalidControl
      throw 'FAIL|APPROVE_ATOMICITY|self_test_identity_accepted'
    } catch {
      if ($_.Exception.Message -cne 'BLOCKED|APPROVE_ATOMICITY|local_identity_invalid') { throw }
    }
  }
  Write-Output 'PASS|APPROVE_ATOMICITY|local_preflight_self_test'
  exit 0
}

try {
  Assert-LocalTarget $PgHostName $PgPort $PgUser $DatabasePrefix
  Assert-NoConnectionEnvironment
  $psql = Resolve-LocalProgram 'psql.exe' $PgBinDirectory
  $pgIsReady = Resolve-LocalProgram 'pg_isready.exe' $PgBinDirectory
  $null = Resolve-LocalProgram 'createdb.exe' $PgBinDirectory
  $null = Resolve-LocalProgram 'dropdb.exe' $PgBinDirectory
  Assert-LocalPostgresListener $PgHostName $PgPort

  $null = & $pgIsReady -h $PgHostName -p $PgPort -U $PgUser -d postgres -t 3 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw 'BLOCKED|APPROVE_ATOMICITY|local_postgres_unavailable'
  }

  # Forced -W prompts at the console. No password or connection URL is read
  # from a file, environment variable, or script argument.
  # These exact pre-existing roles are required. The bootstrap never creates
  # cluster-wide roles; absence, attributes, or membership drift blocks here.
  $identitySql = @'
WITH expected(role_name, bypass_rls) AS (
  VALUES ('service_role', true), ('anon', false), ('authenticated', false)
), matching_roles AS (
  SELECT r.oid
  FROM expected e
  JOIN pg_catalog.pg_roles r ON r.rolname = e.role_name
  WHERE r.rolbypassrls = e.bypass_rls
    AND NOT r.rolcanlogin AND NOT r.rolsuper
    AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolreplication AND r.rolinherit
    AND r.rolconnlimit = -1 AND r.rolvaliduntil IS NULL
    AND r.rolconfig IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      WHERE m.roleid = r.oid OR m.member = r.oid
    )
)
SELECT 'CONTROL|PHASE2B_APPROVE_ATOMICITY_IDENTITY|' || host(inet_server_addr())
  || '|' || inet_server_port()
  || '|' || (current_setting('server_version_num')::int / 10000)
  || '|' || CASE WHEN (SELECT count(*) FROM matching_roles) = 3
                THEN 'ready' ELSE 'drifted' END
'@
  $identityOutput = @(& $psql -X -W -q -A -t -v ON_ERROR_STOP=1 `
    -h $PgHostName -p $PgPort -U $PgUser -d postgres -c $identitySql)
  if ($LASTEXITCODE -ne 0) {
    throw 'BLOCKED|APPROVE_ATOMICITY|local_identity_unavailable'
  }
  $identityMatch = Parse-LocalIdentityControl $identityOutput
  $observedHost = $identityMatch.Groups[1].Value
  $observedPort = [int]$identityMatch.Groups[2].Value
  $observedMajor = [int]$identityMatch.Groups[3].Value
  if ($observedHost -cnotin @('127.0.0.1', '::1') -or
      $observedPort -ne $PgPort -or $observedMajor -ne $ExpectedMajor) {
    throw 'BLOCKED|APPROVE_ATOMICITY|local_identity_mismatch'
  }
  if ($identityMatch.Groups[4].Value -cne 'ready') {
    throw 'BLOCKED|APPROVE_ATOMICITY|local_roles_unavailable_or_drifted'
  }
  Write-Output 'PASS|APPROVE_ATOMICITY|local_postgres_ready'
  Write-Output ('PASS|APPROVE_ATOMICITY|disposable_prefix=' + $DatabasePrefix)
} catch {
  $safeMessage = [string]$_.Exception.Message
  if ($safeMessage -notmatch '^BLOCKED\|APPROVE_ATOMICITY\|[a-z_]+$') {
    $safeMessage = 'BLOCKED|APPROVE_ATOMICITY|local_preflight_failed'
  }
  Write-Output $safeMessage
  exit 1
}
