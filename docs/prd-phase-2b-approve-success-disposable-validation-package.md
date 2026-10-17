# Phase 2B Solo Plus approve-success disposable-local validation

**Source package only. PostgreSQL has not been run for this package.** Run only
against PostgreSQL 15 on the operator's own Windows machine at literal
`127.0.0.1:55432`, as `postgres`. The untouched database
`deraledger_phase2b_approve_atomicity_baseline_disposable` must already exist
on that instance. Stop with `BLOCKED|APPROVE_SUCCESS|local_prerequisite` if the
local server, role, baseline, or exact port is unavailable. Never switch to a
remote server, Supabase, staging, production, Docker, or WSL. No environment
variable, URL, `.pgpass`, temporary password file, or command argument may
contain a password.

This package tests **only**
`20261015000000_phase2b_approve_success_atomic.sql`. The predecessor migration
is installed once on each fresh disposable baseline clone because the new
migration requires it. The closed predecessor first-apply/postflight/rerun,
16 hostile scenarios, and seven fail-closed races are **not invoked**.

## Gate A, C, D, E, F, G, I: one-process sequential run

From the repository root in PowerShell, first confirm this is the reviewed
branch and the local `psql.exe` is PostgreSQL 15. The script itself checks
database name, user, server address, port, and baseline presence before
creating anything; it refuses an existing success or race database. The
baseline is never modified. `\connect` remains on the same host/user and
reuses the password held by this one `psql` process.

```powershell
$psqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue
if (-not $psqlCommand -or -not (Test-NetConnection 127.0.0.1 -Port 55432 -InformationLevel Quiet)) { throw 'BLOCKED|APPROVE_SUCCESS|local_prerequisite' }
$psql = $psqlCommand.Source
& $psql --version
& $psql -X -W -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U postgres -d postgres -f .\tests\sql\phase2b-approve-success\local-master.sql
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_SUCCESS|sequential' }
```

Expected password prompts: **one** for this sequential process. If the local
client unexpectedly prompts again on `\connect`, stop and report the client
behavior; do not add credential caching or a password file. Do not rerun on
a partially initialized disposable database. A failed run leaves its exact
disposable database for inspection and separately controlled local teardown.

Required successful output includes:

```text
PASS|APPROVE_SUCCESS|predecessor_applied
PASS|APPROVE_SUCCESS|first_apply
PASS|APPROVE_SUCCESS|postflight
PASS|APPROVE_SUCCESS|rerun
PASS|APPROVE_SUCCESS|writer_contract_rollback
PASS|APPROVE_SUCCESS|protected_fields_and_version_bypass
PASS|APPROVE_SUCCESS|initial_link_validation_and_rollback
PASS|APPROVE_SUCCESS|approval_and_side_effect_rollback
PASS|APPROVE_SUCCESS|replay_one_event
PASS|APPROVE_SUCCESS|legacy_v1_rmi_reject_and_blocked_approve
PASS|APPROVE_SUCCESS|concurrency_fixture_ready
PASS|APPROVE_SUCCESS|sequential_gates_complete
```

The writer probes report sanitized `before=` and `after=` versions for no-op,
unrelated, relevant, six-row, mixed-upsert, confirmation, and recovery writes.
The approval probe fingerprints every other public table across the RPC. Each
behavior probe rolls back its synthetic rows. The final race fixture alone is
committed to a separate disposable race clone.

## Gate B: two exact flow-CHECK drift runs

Run these only after the sequential process succeeds. Each command has **one
`psql -W` password prompt** and creates its own fresh baseline clone. The
PowerShell checker requires a nonzero exit and exactly one PostgreSQL `ERROR`
whose complete category is
`Phase 2B approve success blocked: flow CHECK expression drift`. An unrelated
SQL error, setup failure, zero errors, or migration success is `FAIL`, never
PASS. Do not reuse drift clones.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\phase2b-approve-success-drift-check.ps1 -Scenario flow_origin
powershell -ExecutionPolicy Bypass -File .\scripts\phase2b-approve-success-drift-check.ps1 -Scenario flow_ownership
```

Expected markers:

```text
PASS|APPROVE_SUCCESS|drift_flow_origin_guard
PASS|APPROVE_SUCCESS|drift_flow_ownership_guard
```

The deliberately failed migration is transactional. Its drift database remains
for optional read-only examination until exact local teardown. A PASS marker
proves only the expected pre-DDL guard category, not general hostile-drift
coverage of the predecessor.

## Gate H: three focused two-session success-path races

Two PowerShell terminals use the **same local race database** created by the
sequential run. Each terminal starts one `psql` process with one password
prompt, so concurrency requires **two prompts total**. The scripts check the
exact local database and host before work. Do not run the predecessor seven-
scenario matrix.

Terminal A:

```powershell
$psql = (Get-Command psql.exe -ErrorAction Stop).Source
& $psql -X -W -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U postgres -d deraledger_phase2b_approve_success_race_disposable -f .\tests\sql\phase2b-approve-success\concurrency-session-a.sql
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_SUCCESS|race_a' }
```

Terminal B:

```powershell
$psql = (Get-Command psql.exe -ErrorAction Stop).Source
& $psql -X -W -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U postgres -d deraledger_phase2b_approve_success_race_disposable -f .\tests\sql\phase2b-approve-success\concurrency-session-b.sql
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_SUCCESS|race_b' }
```

Start A first. At each `READY|APPROVE_SUCCESS|a_*_case_locked`, press Enter
in B to emit the matching `B_CALL_START` marker. Check that B is still running
and waiting, then press Enter in A. A polls `pg_stat_activity` for B's actual
lock wait and emits `BLOCKED|APPROVE_SUCCESS|race_overlap_unproven` if no
overlap is observed. Wait for both PASS markers before moving
to the next prompt. The same-key race must yield one update and one replay;
the different-key race must yield one update and one version conflict. In the
child-writer race, A must fail closed while B changes the locked payment and
increments the parent version. B's final assertion requires exactly one
approval event for each of the first two cases and zero for the child case.

```text
PASS|APPROVE_SUCCESS|race_same_key
PASS|APPROVE_SUCCESS|race_different_key
PASS|APPROVE_SUCCESS|race_child_writer_fail_closed
PASS|APPROVE_SUCCESS|race_matrix|count=3
```

If timing cannot establish overlap, stop with `BLOCKED|APPROVE_SUCCESS|race_overlap_unproven`.
Do not count a sequential replay as concurrency proof. Retain the failed
race database for inspection; do not reuse it for another attempt.

## Exact local teardown, after evidence review

Close both race sessions before teardown. This one-process command has **one
additional password prompt**. It drops only the four success-package database
names only if each existing database has the package's exact ownership comment,
and verifies that the untouched atomicity baseline still exists. It
does not create, alter, or remove cluster-wide roles.

```powershell
$psql = (Get-Command psql.exe -ErrorAction Stop).Source
& $psql -X -W -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U postgres -d postgres -f .\tests\sql\phase2b-approve-success\local-teardown.sql
if ($LASTEXITCODE -ne 0) { throw 'FAIL|APPROVE_SUCCESS|teardown' }
```

Expected: `PASS|APPROVE_SUCCESS|local_teardown`. Database teardown is not
cluster-role cleanup; this package creates no roles. Keep full local output
private. Share only PASS/BLOCKED/FAIL markers and sanitized first error; never
share credentials, connection strings, raw fixture rows, or unredacted logs.

All gates must pass before any approve-only staging fixture procedure is
considered. This package authorizes no staging/production connection,
migration application, deployment, environment change, fixture, or approve
action.
