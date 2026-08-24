# PRD Phase 2 Migration 025 Staging Runbook

## Scope and Safety Boundary

This is a user-run, staging-only command pack for `20260824_00_reviewed_profile_bootstrap_rpc.sql`. It prepares the ordered staging preflight, first apply, idempotency reapply, and postflight checks for the reviewed-profile bootstrap RPC.

Migration 025 completed a fresh disposable-local rehearsal, including structure, security, Lite, Business, Solo Plus, idempotency, grant-denial, and rollback checks. Its final local control line was `CONTROL|LOCAL_BOOTSTRAP_REHEARSAL=PASS`. That result permits manual staging preflight consideration only; it is not staging or production approval.

Do not run any command in this document against production. Do not use a production URL, do not paste a URL into a repository file, and do not add the evidence directory to Git. This runbook does not insert reviewed profile rows, insert limit rows, adopt runtime call sites, activate collection, change `setup_mode`, change `live_features_enabled`, or test payments/providers.

## Preconditions

- Read [Migration 025 full local rehearsal pass](prd-phase-2-migration-025-full-local-rehearsal-pass.md) and confirm the local result remains `FULL PASS`.
- You personally have a staging database connection string available locally. Keep it only in the current PowerShell session.
- Confirm the target is staging, never production. If the target cannot be identified as staging with confidence, stop.
- Confirm the working tree is clean or that unrelated local changes are understood. `git status --short` is recommended before running the commands.
- Use PostgreSQL 15 `psql` at `C:\Program Files\PostgreSQL\15\bin\psql.exe` (or consciously substitute a compatible local executable).
- Keep the preflight, migration, and postflight files at their reviewed source versions. Do not edit SQL while executing this procedure.

Migration 025 includes its own `BEGIN`/`COMMIT` envelope. Do **not** add `--single-transaction` to the apply commands.

## Session Setup

Open PowerShell at the repository root. The following setup does not write a secret to disk or print the connection string. `local-evidence` is local working evidence only: do not add or commit it.

```powershell
$PsqlPath = 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
if (-not (Test-Path -LiteralPath $PsqlPath)) { throw "psql not found: $PsqlPath" }

$StagingDbUrl = Read-Host "Paste STAGING database connection string"
if ([string]::IsNullOrWhiteSpace($StagingDbUrl)) { throw 'STAGING_DATABASE_URL_REQUIRED' }
if ($StagingDbUrl -match '(?i)(production|prod[._-]|supabase\.co.*prod)') {
  throw 'PRODUCTION_LIKE_CONNECTION_STRING_REJECTED'
}

$Confirmation = Read-Host "Type I CONFIRM STAGING ONLY"
if ($Confirmation -cne 'I CONFIRM STAGING ONLY') { throw 'STAGING_CONFIRMATION_REQUIRED' }

$EvidenceDir = ".\local-evidence\migration-025-staging-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

$PreflightSql = '.\supabase\staging\preflight\025_reviewed_profile_bootstrap_rpc_snapshot.sql'
$MigrationSql = '.\supabase\migrations\20260824_00_reviewed_profile_bootstrap_rpc.sql'
$PostflightSql = '.\supabase\staging\postflight\025_reviewed_profile_bootstrap_rpc_verify.sql'

foreach ($Path in @($PreflightSql, $MigrationSql, $PostflightSql)) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "REQUIRED_SOURCE_FILE_MISSING: $Path" }
}

$FailurePattern = '\bFAIL\b|ERROR|FATAL'
function Assert-Migration025StepPassed {
  param(
    [Parameter(Mandatory = $true)][string]$Step,
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][int]$PsqlExitCode
  )

  if ($PsqlExitCode -ne 0) { throw "MIGRATION_025_$Step`_PSQL_FAILED; inspect $LogPath" }
  if (Select-String -LiteralPath $LogPath -Pattern $FailurePattern -Quiet) {
    throw "MIGRATION_025_$Step`_LOG_FAILURE; inspect $LogPath"
  }
}

Write-Host "Evidence directory: $EvidenceDir"
Write-Host 'Target is user-confirmed staging only. Production is prohibited.'
```

## 1. Read-Only Staging Preflight

Run the provided preflight before any DDL. It verifies the Migration 024 compliance-table prerequisites, RLS/security prerequisites, and absence of conflicting bootstrap-RPC overloads.

```powershell
$PreflightLog = Join-Path $EvidenceDir '025-staging-preflight.txt'
& $PsqlPath -X -w -v ON_ERROR_STOP=1 -d $StagingDbUrl -f $PreflightSql 2>&1 |
  Tee-Object -FilePath $PreflightLog
$PreflightExitCode = $LASTEXITCODE
Assert-Migration025StepPassed -Step 'PREFLIGHT' -LogPath $PreflightLog -PsqlExitCode $PreflightExitCode
```

Require `summary | summary | PASS` and no `FAIL`, `ERROR`, or `FATAL` before continuing. If the preflight fails, stop; do not apply Migration 025.

## 2. First Apply

Apply exactly the reviewed migration file once. The migration itself performs transactional prerequisite checks, creates or replaces only the bootstrap RPC, applies the service-role-only function grants, sends the schema-cache notification, and commits.

```powershell
$FirstApplyLog = Join-Path $EvidenceDir '025-staging-first-apply.txt'
& $PsqlPath -X -w -v ON_ERROR_STOP=1 -d $StagingDbUrl -f $MigrationSql 2>&1 |
  Tee-Object -FilePath $FirstApplyLog
$FirstApplyExitCode = $LASTEXITCODE
Assert-Migration025StepPassed -Step 'FIRST_APPLY' -LogPath $FirstApplyLog -PsqlExitCode $FirstApplyExitCode

if (-not (Select-String -LiteralPath $FirstApplyLog -Pattern '^COMMIT$' -Quiet)) {
  throw "MIGRATION_025_FIRST_APPLY_COMMIT_MISSING; inspect $FirstApplyLog"
}
```

## 3. Second Apply - Idempotency Proof

Re-run the unchanged migration file. This must complete cleanly and emit `COMMIT`; it must not create any business rows.

```powershell
$SecondApplyLog = Join-Path $EvidenceDir '025-staging-second-apply-idempotency.txt'
& $PsqlPath -X -w -v ON_ERROR_STOP=1 -d $StagingDbUrl -f $MigrationSql 2>&1 |
  Tee-Object -FilePath $SecondApplyLog
$SecondApplyExitCode = $LASTEXITCODE
Assert-Migration025StepPassed -Step 'SECOND_APPLY' -LogPath $SecondApplyLog -PsqlExitCode $SecondApplyExitCode

if (-not (Select-String -LiteralPath $SecondApplyLog -Pattern '^COMMIT$' -Quiet)) {
  throw "MIGRATION_025_SECOND_APPLY_COMMIT_MISSING; inspect $SecondApplyLog"
}
```

## 4. Read-Only Staging Postflight

Run the provided postflight after both applies. It verifies the exact RPC signature, `SECURITY INVOKER` mode and hardened search path, no browser execution grants, the `service_role` execution grant, and that applying the migration created no bootstrap business rows.

```powershell
$PostflightLog = Join-Path $EvidenceDir '025-staging-postflight.txt'
& $PsqlPath -X -w -v ON_ERROR_STOP=1 -d $StagingDbUrl -f $PostflightSql 2>&1 |
  Tee-Object -FilePath $PostflightLog
$PostflightExitCode = $LASTEXITCODE
Assert-Migration025StepPassed -Step 'POSTFLIGHT' -LogPath $PostflightLog -PsqlExitCode $PostflightExitCode
```

Require all of the following as `PASS`:

- `rpc.signature`
- `rpc.security`
- `rpc.browser_grants`
- `rpc.service_role_grant`
- `data.empty_after_apply`
- `summary`

## Failure Handling

Stop immediately if any command exits nonzero, or any evidence log contains `FAIL`, `ERROR`, or `FATAL`.

- A failed preflight blocks both apply commands.
- A failed first apply blocks the second apply and postflight.
- A failed second apply or postflight blocks any further database operation.
- Do not retry by editing the migration in the SQL editor, applying partial statements, inserting profile rows, broadening grants, or changing RLS.
- Keep the local evidence files, but share only the compact failing line(s), final summary, and first relevant error for review. Do not share the connection string or credentials.
- Do not proceed to production. Staging failure does not authorize repair or any production test.

## Expected PASS Evidence

The evidence directory should show:

- preflight summary: `PASS`;
- first apply: `COMMIT` with no failure match;
- second apply/idempotency: `COMMIT` with no failure match;
- postflight `PASS` for `rpc.signature`, `rpc.security`, `rpc.browser_grants`, `rpc.service_role_grant`, and `data.empty_after_apply`;
- postflight summary: `PASS`.

These results prove the reviewed schema/RPC package is compatible with staging and was applied idempotently. They do not authorize profile bootstrap use, runtime adoption, activation, collection, provider/payment behavior, or production application.

## Explicit Production Boundary

Production is not a continuation of this command pack. Do not substitute a production URL, a production Supabase project, or a production SQL editor. Production preflight/apply/postflight instructions require a separate review and explicit approval after staging has passed and a staging PASS checkpoint has been recorded.

## Safe Next Steps After Staging PASS

1. Retain the local evidence files outside the commit.
2. Create a staging-PASS checkpoint with only the compact preflight, first/second apply, and postflight results.
3. Request separate approval to prepare production preflight/apply/postflight instructions.
4. Keep collection locked: do not insert bootstrap profiles, add runtime call sites, activate merchants, or test payments/providers.
