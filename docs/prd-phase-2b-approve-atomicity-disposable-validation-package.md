# Phase 2B approve atomicity: disposable PostgreSQL validation package

**Status: source-only and unexecuted.** The primary path is Windows PostgreSQL
on the operator's own machine. Docker and WSL are not required. These files
must never be pointed at Supabase, staging, production, a shared database, or
real customer/payment/provider/document/settlement data. The fail-closed
migration remains unapplied; approve fixture planning and execution remain
blocked. This package authorizes no database operation, push, deployment,
environment change, review action, or cleanup.

The package validates the exact
`supabase/migrations/20261014000000_phase2b_approve_atomicity_fail_closed.sql`
after loading the repository's canonical schema-only local chain. It omits
`005_phase1_fake_seed.sql`. Bootstrap, SQL compilation, first apply, rerun,
hostile drift, and concurrency behavior have **not** been proven yet. Collect
all local failures before changing catalog expectations. Do not use staging
as a fallback if local PostgreSQL is unavailable.
The local bootstrap includes the canonical 009 and 010 migration files with
`\ir`: their staging wrappers use working-directory-relative `\i`, which does
not resolve correctly when this runbook invokes psql from the repository root.
The source test checks the complete ordered baseline and resolves nested psql
includes before any local database run.

## Windows local identity gate

Use an installed Windows PostgreSQL 15 server and its `psql.exe`, `createdb.exe`,
`dropdb.exe`, and `pg_isready.exe`. Suggested defaults are host `127.0.0.1`,
port `55432` (or `5432` if verified locally), user `postgres`, and database
prefix `deraledger_phase2b_approve_atomicity_`. Host, port, user, expected
major, binary directory, and prefix are parameters. The host must be the
literal loopback address `127.0.0.1` or `::1`; the preflight requires a local
Windows `postgres.exe` listener on that port before making any PostgreSQL connection.
A listener bound to `127.0.0.1`, `::1`, `0.0.0.0`, or `::` is eligible only when
`Test-NetConnection` succeeds to the requested loopback host and port. A
remote host, SSH tunnel, or port proxy is blocked. Every generated database name ends
in `_disposable`. PostgreSQL roles are **cluster-wide**: this package never
creates or repairs `service_role`, `anon`, or `authenticated`. The preflight
requires those three roles to pre-exist with the exact reviewed NOLOGIN,
privilege, membership, and `BYPASSRLS` properties; a missing or drifted role
returns `BLOCKED|APPROVE_ATOMICITY|local_roles_unavailable_or_drifted` before
database creation. Do not add these roles to a normal app/development cluster
to make this package pass. Use a separately reviewed disposable local cluster
if the exact roles are unavailable. Database teardown does not remove or own
cluster-wide roles. No password
or connection URL belongs in source, arguments, environment variables, or
files. Every credentialed command uses `-W` to prompt at the terminal.

Run the preflight **only after separate approval for local database access**.
It uses `pg_isready` and one read-only identity query; it never runs a
migration. `-SelfTest` is offline and does not connect.

```powershell
$pgHostName = '127.0.0.1'
$pgPort = 55432
$pgUser = 'postgres'
$dbPrefix = 'deraledger_phase2b_approve_atomicity_'
$pgBin = 'C:\Program Files\PostgreSQL\15\bin'
$preflight = '.\scripts\phase2b-approve-atomicity-local-preflight.ps1'
powershell -ExecutionPolicy Bypass -File $preflight `
  -PgHostName $pgHostName -PgPort $pgPort -PgUser $pgUser `
  -DatabasePrefix $dbPrefix -ExpectedMajor 15 -PgBinDirectory $pgBin
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPROVE_ATOMICITY|local_preflight' }
```

Require `PASS|APPROVE_ATOMICITY|local_postgres_ready`. Missing tools, an
unavailable local server, role drift, or an overlong database prefix returns
a specific `BLOCKED` marker and nonzero exit. Stop there. Never switch to
staging or production.
An absent local listener or failed loopback TCP check emits
`BLOCKED|APPROVE_ATOMICITY|local_postgres_unavailable`. A listener that passes
those checks but fails `pg_isready` emits
`BLOCKED|APPROVE_ATOMICITY|local_postgres_not_ready`; investigate that local
condition before retrying, and never switch to staging.

## Initialization, first apply, rerun, and rollback-only behavior

All commands below run manually from the repo root against the **verified
local target**. `-X` skips startup files, `-W` forces password prompts, and
`ON_ERROR_STOP=1` makes SQL errors nonzero. Stop at the first failed exit
code or missing expected marker.

```powershell
$psql = Join-Path $pgBin 'psql.exe'
$createdb = Join-Path $pgBin 'createdb.exe'
$dropdb = Join-Path $pgBin 'dropdb.exe'
$connection = @('-h', $pgHostName, '-p', [string]$pgPort, '-U', $pgUser, '-W')
$psqlOptions = @('-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1') + $connection
$sqlRoot = (Resolve-Path '.\tests\sql\phase2b-approve-atomicity').Path
$migration = (Resolve-Path '.\supabase\migrations\20261014000000_phase2b_approve_atomicity_fail_closed.sql').Path
$baselineDb = "${dbPrefix}baseline_disposable"
$cleanDb = "${dbPrefix}clean_disposable"
$hostileDb = "${dbPrefix}hostile_disposable"
$raceDb = "${dbPrefix}race_disposable"

& $createdb @connection $baselineDb
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPROVE_ATOMICITY|baseline_create' }
& $psql @psqlOptions -d $baselineDb -f (Join-Path $sqlRoot 'local-bootstrap.sql')
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPROVE_ATOMICITY|baseline_bootstrap' }
& $createdb @connection -T $baselineDb $cleanDb
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPROVE_ATOMICITY|clean_clone' }
& $psql @psqlOptions -d $cleanDb -f $migration
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|first_apply' }
& $psql @psqlOptions -d $cleanDb -f (Join-Path $sqlRoot 'verify-install.sql')
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|first_postflight' }
Write-Output 'PASS|APPROVE_ATOMICITY|first_apply'

& $psql @psqlOptions -d $cleanDb -f $migration
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|rerun' }
& $psql @psqlOptions -d $cleanDb -f (Join-Path $sqlRoot 'verify-install.sql')
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|rerun_postflight' }
Write-Output 'PASS|APPROVE_ATOMICITY|rerun'

& $psql @psqlOptions -d $cleanDb -f (Join-Path $sqlRoot 'verify-behavior.sql')
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|behavior' }
```

If bootstrap stops with `BLOCKED|APPROVE_ATOMICITY|baseline_bootstrap`, treat
the disposable baseline database as partially initialized. Do not rerun
bootstrap or clone that database. A separately authorized local database-only
teardown and fresh disposable baseline are required before retrying; this
source package does not authorize either operation.

The SQL files emit `PASS|APPROVE_ATOMICITY|local_baseline_loaded`,
`PASS|APPROVE_ATOMICITY|installed_functions_and_grants` twice, and
`PASS|APPROVE_ATOMICITY|fail_closed_behavior_and_rollback`. The behavior
transaction creates only synthetic rows, calls both approve RPCs, checks
wrong-run and stale-version failures, exercises RMI/reject inside discarded
savepoints, compares case/payment/requirements/merchant plus every public
table fingerprint, and rolls back all behavior rows. Tables outside `public`,
external services, and future writer paths remain outside this local proof.

## Hostile-drift and pre-DDL rollback matrix

Run each name on a fresh clone of the untouched pre-cutover baseline. Hostile
setup must succeed. The candidate migration must fail **and its captured psql
ERROR line must match the exact expected guard category for that scenario**.
An unrelated nonzero SQL or connection error is `FAIL|APPROVE_ATOMICITY|hostile_wrong_error`,
never PASS. The output is held in memory, not written to a credential file.
`verify-hostile-rollback.sql` checks the v1 body stayed as mutated
and the new RPC did not appear after failed migration.

```text
v1_body v1_defaults overload policy_roles policy_using policy_with_check
check_expression check_requirement_code check_requirement_state
fk_target fk_columns fk_actions index_key index_predicate
index_collation index_opclass
```

Repeat this block with each exact scenario name:

```powershell
$scenario = 'v1_body'
$expectedGuardCategory = @{
  v1_body = 'reviewed v1 function drift'
  v1_defaults = 'reviewed v1 function drift'
  overload = 'unexpected RPC overload'
  policy_roles = 'policy role or expression drift'
  policy_using = 'policy role or expression drift'
  policy_with_check = 'RLS policy drift'
  check_expression = 'check constraint expression drift'
  check_requirement_code = 'check constraint expression drift'
  check_requirement_state = 'check constraint expression drift'
  fk_target = 'key or foreign-key semantic drift'
  fk_columns = 'key or foreign-key semantic drift'
  fk_actions = 'key or foreign-key semantic drift'
  index_key = 'review intent index semantic drift'
  index_predicate = 'review intent index semantic drift'
  index_collation = 'review intent index semantic drift'
  index_opclass = 'review intent index semantic drift'
}
if (-not $expectedGuardCategory.ContainsKey($scenario)) {
  throw 'BLOCKED|APPROVE_ATOMICITY|unknown_hostile_scenario'
}
& $createdb @connection -T $baselineDb $hostileDb
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPROVE_ATOMICITY|hostile_clone' }
& $psql @psqlOptions -v "scenario=$scenario" -d $hostileDb -f (Join-Path $sqlRoot 'hostile-drift.sql')
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPROVE_ATOMICITY|hostile_setup' }
$migrationOutput = @(& $psql @psqlOptions -d $hostileDb -f $migration 2>&1 |
  ForEach-Object { [string]$_ })
$applyExit = $LASTEXITCODE
if ($applyExit -eq 0) { throw 'FAIL|APPROVE_ATOMICITY|hostile_guard' }
$errorRows = [regex]::Matches(($migrationOutput -join "`n"),
  '(?m)ERROR:[ \t]*([^\r\n]+)\r?$')
$expectedError = 'Phase 2B approve atomicity blocked: ' + $expectedGuardCategory[$scenario]
if ($errorRows.Count -ne 1 -or
    $errorRows[0].Groups[1].Value.Trim() -cne $expectedError) {
  throw 'FAIL|APPROVE_ATOMICITY|hostile_wrong_error'
}
& $psql @psqlOptions -d $hostileDb -f (Join-Path $sqlRoot 'verify-hostile-rollback.sql')
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|hostile_rollback' }
Write-Output "PASS|APPROVE_ATOMICITY|hostile_$scenario"
& $dropdb @connection $hostileDb
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPROVE_ATOMICITY|hostile_teardown' }
```

The `policy_with_check` scenario uses valid DDL by replacing a SELECT policy
with an ALL policy carrying `WITH CHECK`. It necessarily changes the command
too; its expected runtime category is `RLS policy drift`. Runtime rejection does not independently prove the `polwithcheck`
comparison; the static hostile-drift test covers that clause.

## Two-session race matrix

Use a **fresh clean clone per scenario** and two PowerShell terminals against
the same local database. Terminal A creates a held lock or commits drift;
Terminal B calls the new fail-closed approve RPC. A lock scenario prints
`PASS|APPROVE_ATOMICITY|session_a_lock_held` and waits for Enter. Run B while
A is paused, then release A. For drift, wait for
`PASS|APPROVE_ATOMICITY|session_a_drift_committed` before B.

```text
payment_lock requirement_lock case_lock payment_drift requirement_drift
case_version marker_drift
```

Initialize once in either terminal:

```powershell
$scenario = 'payment_lock'
& $createdb @connection -T $baselineDb $raceDb
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPROVE_ATOMICITY|race_clone' }
& $psql @psqlOptions -d $raceDb -f $migration
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|race_apply' }
& $psql @psqlOptions -d $raceDb -f (Join-Path $sqlRoot 'race-fixture.sql')
if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPROVE_ATOMICITY|race_fixture_setup' }
```

Set the same `$scenario`, `$psql`, `$psqlOptions`, `$sqlRoot`, and `$raceDb`
values in both terminals. Terminal A:

```powershell
& $psql @psqlOptions -v "scenario=$scenario" -d $raceDb -f (Join-Path $sqlRoot 'race-session-a.sql')
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|race_session_a' }
```

Terminal B after A's barrier marker:

```powershell
& $psql @psqlOptions -v "scenario=$scenario" -d $raceDb -f (Join-Path $sqlRoot 'race-session-b.sql')
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|race_session_b' }
```

Require `PASS|APPROVE_ATOMICITY|two_session_fail_closed` and zero review
events. Case lock expects a bounded `lock_timeout`; payment and requirement
locks expect `state_conflict`. Child-row drift expects conflict despite
unchanged case version; deliberate case-version drift expects
`version_conflict`. This proves only the **current rejecting RPC**, not a
future successful approval or hardened writer protocol. After recording a
scenario, remove only the local clone with `& $dropdb @connection $raceDb`
and check its exit code before the next one.

## Evidence and local teardown

Report only scenario ID, setup exit, candidate exit, expected/actual safe
category, postflight exit, and a `PASS`, `BLOCKED`, or `FAIL` marker. A setup
error is never hostile-drift proof. Do not print credentials, connection
strings, fixture rows, or full server logs. The operator may later remove
only the four exact named local disposable databases with `dropdb.exe -W`;
verify each drop exits zero and a password-prompted read-only `pg_database`
check reports none of those names. This is **database-only teardown**; the
pre-existing cluster-wide roles are not owned or removed by this package.
The exact local command, after separately
approved teardown, is:

```powershell
foreach ($databaseName in @($raceDb, $hostileDb, $cleanDb, $baselineDb)) {
  & $dropdb @connection --if-exists $databaseName
  if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|local_teardown' }
}
$quotedNames = (@($raceDb, $hostileDb, $cleanDb, $baselineDb) |
  ForEach-Object { "'$_'" }) -join ','
$teardownSql = "SELECT CASE WHEN count(*) = 0 THEN 'PASS|APPROVE_ATOMICITY|local_teardown' ELSE 'FAIL|APPROVE_ATOMICITY|local_teardown' END FROM pg_database WHERE datname IN ($quotedNames)"
& $psql @psqlOptions -d postgres -c $teardownSql
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_ATOMICITY|local_teardown_check' }
```

The prefix validator limits these generated names to lowercase letters,
digits, and underscores and ensures the longest name stays within PostgreSQL's
63-byte identifier limit. No local teardown has been performed by
this source package. Local PASS does not authorize staging preflight,
migration application, approve fixture planning, or approve execution.

For source-only whitespace review, `git diff --check` covers tracked changes
but not new untracked files. Inventory and check this package explicitly:

```powershell
git ls-files --others --exclude-standard -- docs/prd-phase-2b-approve-atomicity-disposable-validation-package.md scripts/phase2b-approve-atomicity-local-preflight.ps1 tests/phase2b-approve-atomicity-disposable-package.test.ts tests/sql/phase2b-approve-atomicity/
$packageFiles = @(
  'docs/prd-phase-2b-approve-atomicity-disposable-validation-package.md',
  'scripts/phase2b-approve-atomicity-local-preflight.ps1',
  'tests/phase2b-approve-atomicity-disposable-package.test.ts'
) + @(Get-ChildItem -LiteralPath 'tests/sql/phase2b-approve-atomicity' -Filter '*.sql' -File |
  ForEach-Object { $_.FullName })
foreach ($packageFile in $packageFiles) {
  if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
    throw 'FAIL|APPROVE_ATOMICITY|package_file_missing'
  }
  if (@(Get-Content -LiteralPath $packageFile | Where-Object { $_ -match '[ \t]+$' }).Count -gt 0) {
    throw 'FAIL|APPROVE_ATOMICITY|package_trailing_whitespace'
  }
}
Write-Output 'PASS|APPROVE_ATOMICITY|package_whitespace'
```
