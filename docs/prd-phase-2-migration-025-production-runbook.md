# Migration 025 production runbook

## Purpose and safety boundary

This is a user-operated, production-only command pack for applying and verifying Migration 025: `20260824_00_reviewed_profile_bootstrap_rpc.sql`. It is documentation only. It does not authorize a runtime rollout, profile bootstrap, compliance approval, activation, collection unlock, payment test, provider test, checkout test, or storefront work.

Migration 025 has already passed both required lower-environment gates:

- The fresh disposable local rehearsal completed with `CONTROL|LOCAL_BOOTSTRAP_REHEARSAL=PASS`.
- Staging preflight, first apply, second apply/idempotency, and corrected postflight all passed.

Run these commands only against the intended production database after explicit production-apply approval. Do not use the staging connection string. Do not use this runbook as a staging rehearsal.

## Preconditions

- Local full rehearsal PASS is recorded in `docs/prd-phase-2-migration-025-full-local-rehearsal-pass.md`.
- Staging PASS is recorded in `docs/prd-phase-2-migration-025-staging-pass.md`.
- You have the production PostgreSQL connection string locally, without an embedded password, and can supply its password interactively.
- You have reviewed the migration, preflight, and postflight SQL in the current commit.
- A clean tracked Git state is recommended so the reviewed source revision is unambiguous.
- `psql` is installed at `C:\Program Files\PostgreSQL\15\bin\psql.exe`, or update `$Psql` below to the trusted local path.

## Production command sequence

Open PowerShell from the repository root. The password is held only in the current PowerShell process through `PGPASSWORD`; neither the password nor connection string is written to source files or evidence logs.

```powershell
$Psql = 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
if (-not (Test-Path -LiteralPath $Psql)) { throw "psql was not found at: $Psql" }

$ProductionDbUrl = (Read-Host 'Paste PRODUCTION database connection string').Trim()
if ([string]::IsNullOrWhiteSpace($ProductionDbUrl)) { throw 'A production database connection string is required.' }
if ($ProductionDbUrl -match '(?i)staging') { throw 'Refusing a staging-looking connection string for this production runbook.' }
if ($ProductionDbUrl -match '://[^/]+:[^@]+@') { throw 'Use a password-free database URL; enter the password only at the secure prompt.' }

$Confirmation = (Read-Host 'Type exactly: RUN MIGRATION 025 ON PRODUCTION ONLY').Trim()
if ($Confirmation -cne 'RUN MIGRATION 025 ON PRODUCTION ONLY') { throw 'Production confirmation phrase did not match.' }

$PasswordSecure = Read-Host 'Enter PRODUCTION database password' -AsSecureString
$PasswordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PasswordSecure)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordBstr)

  $EvidenceDir = ".\local-evidence\migration-025-production-$(Get-Date -Format yyyyMMdd-HHmmss)"
  New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

  # Run preflight. Stop on an actual SQL/client failure or a result row containing FAIL.
  & $Psql -X -v ON_ERROR_STOP=1 -d $ProductionDbUrl -f 'supabase/staging/preflight/025_reviewed_profile_bootstrap_rpc_snapshot.sql' 2>&1 |
    Tee-Object -FilePath "$EvidenceDir\01-preflight.txt"
  if ($LASTEXITCODE -ne 0) { throw 'Preflight psql execution failed. Stop; do not apply Migration 025.' }
  if (Select-String -LiteralPath "$EvidenceDir\01-preflight.txt" -Pattern '^.*\|FAIL(?:\||$)|^(?:ERROR|FATAL):' -Quiet) {
    throw 'Preflight reported a real FAIL, ERROR, or FATAL. Stop; do not apply Migration 025.'
  }

  # First apply.
  & $Psql -X -v ON_ERROR_STOP=1 -d $ProductionDbUrl -f 'supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql' 2>&1 |
    Tee-Object -FilePath "$EvidenceDir\02-apply-first.txt"
  if ($LASTEXITCODE -ne 0) { throw 'First apply failed. Stop and preserve the evidence logs.' }
  if (Select-String -LiteralPath "$EvidenceDir\02-apply-first.txt" -Pattern '^(?:ERROR|FATAL):|^.*\|FAIL(?:\||$)' -Quiet) {
    throw 'First apply reported a real FAIL, ERROR, or FATAL. Stop and preserve the evidence logs.'
  }

  # Second apply proves idempotency.
  & $Psql -X -v ON_ERROR_STOP=1 -d $ProductionDbUrl -f 'supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql' 2>&1 |
    Tee-Object -FilePath "$EvidenceDir\03-apply-second-idempotency.txt"
  if ($LASTEXITCODE -ne 0) { throw 'Second apply failed. Stop and preserve the evidence logs.' }
  if (Select-String -LiteralPath "$EvidenceDir\03-apply-second-idempotency.txt" -Pattern '^(?:ERROR|FATAL):|^.*\|FAIL(?:\||$)' -Quiet) {
    throw 'Second apply reported a real FAIL, ERROR, or FATAL. Stop and preserve the evidence logs.'
  }

  # Final state verification.
  & $Psql -X -v ON_ERROR_STOP=1 -d $ProductionDbUrl -f 'supabase/staging/postflight/025_reviewed_profile_bootstrap_rpc_verify.sql' 2>&1 |
    Tee-Object -FilePath "$EvidenceDir\04-postflight.txt"
  if ($LASTEXITCODE -ne 0) { throw 'Postflight psql execution failed. Stop and preserve the evidence logs.' }
  if (Select-String -LiteralPath "$EvidenceDir\04-postflight.txt" -Pattern '^.*\|FAIL(?:\||$)|^(?:ERROR|FATAL):' -Quiet) {
    throw 'Postflight reported a real FAIL, ERROR, or FATAL. Stop and preserve the evidence logs.'
  }

  Write-Host "Migration 025 production command sequence completed. Review: $EvidenceDir"
}
finally {
  if ($PasswordBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordBstr) }
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
```

The failure patterns intentionally match actual `FAIL` result rows and `ERROR:`/`FATAL:` output. They do not treat instructional prose such as “Stop on FAIL” as a failure.

## Required PASS evidence

Review the local evidence files before treating the production change as successful:

- Preflight ends with its summary PASS.
- The first apply completes with `COMMIT`.
- The second apply completes with `COMMIT`, proving idempotency.
- Postflight reports all of the following as PASS:
  - `rpc.signature`
  - `rpc.security`
  - `rpc.browser_grants`
  - `rpc.service_role_grant`
  - `data.empty_after_apply`
  - `summary`

## Failure handling

If any actual `FAIL`, `ERROR`, or `FATAL` is reported, stop immediately. Do not retry blindly, do not run any runtime tests, and do not proceed to payment, checkout, provider, subscription, invoice, collection, activation, or storefront testing. Preserve the evidence directory and paste the relevant logs for review.

Production is not a substitute for diagnosis or rehearsal. A failed preflight means do not run either apply. A failed apply or postflight means do not continue with later steps.

## Runtime and payment boundary

Migration 025 creates/updates only the service-role reviewed-profile bootstrap RPC. This runbook does not authorize collection capability, checkout initialization, provider calls, payment tests, subscription changes, invoice behavior, activation, or storefront behavior. No runtime call site may be added as part of this production migration exercise.

## Safe next steps after production PASS

1. Create and commit a production PASS checkpoint with the reviewed evidence.
2. Keep runtime call sites absent.
3. Continue the next PRD Phase 2 persistence path only after the production PASS is recorded and a separate task is approved.

Do not make a production retry, add runtime adoption, or test payment behavior without explicit subsequent approval.
