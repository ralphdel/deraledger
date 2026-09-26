# PRD Phase 2B M024-M030 Local Rehearsal and Postflight Package

**Date:** 2026-09-26  
**Status:** SOURCE/PLANNING ONLY — no connection, SQL execution, or migration apply is authorized.  
**Target:** the approved disposable local database only.

## Purpose and boundary

This package prepares the local-only rehearsal gate after the passed read-only preflight. It is not a staging or production runbook and does not authorize runtime adoption, routes, UI, M030/live readiness, approval execution, activation, collection unlock, or commercial behavior.

No PowerShell apply or postflight helper is created here: the existing target-preflight helper remains the reviewed identity boundary. This document supplies the future user-run local command template; separate user approval is required before its use.

## Preconditions and source order

The accepted target is `127.0.0.1:55432`, user `postgres`, database `deraledger_m024_m030_rehearsal`. Immediately before any future apply, repeat the approved preflight and stop unless it again returns `PASS|DECISION|READY_FOR_LOCAL_REHEARSAL` with an absent chain and absent protected objects.

The database must remain disposable and must not contain `production`, `prod`, `staging`, `stage`, `preview`, `live`, `main`, `primary`, `shared`, `default`, `template`, `postgres`, or `supabase`.

Apply exactly this order:

```text
M024 → M025 → M026 → M027 → M028 → M029 → M030
```

| Step | Migration | Postflight manifest |
| --- | --- | --- |
| M024 | `20260820_00_prd_phase_2_compliance_schema_substrate.sql` | `024_prd_phase_2_compliance_schema_substrate_verify.sql` |
| M025 | `20260824_00_reviewed_profile_bootstrap_rpc.sql` | `025_reviewed_profile_bootstrap_rpc_verify.sql` |
| M026 | `20260825_00_reviewed_profile_approval_rpc.sql` | `026_reviewed_profile_approval_rpc_verify.sql` |
| M027 | `20260825_01_cleanup_approval_rpc_diagnostics.sql` | `027_cleanup_approval_rpc_diagnostics_verify.sql` |
| M028 | `20260825_02_canonical_approval_snapshot_idempotency.sql` | `028_canonical_approval_snapshot_idempotency_verify.sql` |
| M029 | `20260826_00_canonical_workspace_linkage.sql` | `029_canonical_workspace_linkage_verify.sql` |
| M030 | `20260827_00_m028_m029_readiness_integration.sql` | `030_m028_m029_readiness_integration_verify.sql` |

## Reviewed expected SHA-256 manifest — required before apply

The following manifest is intentionally initialized with non-hash placeholders. Before approving a local apply, a reviewer must replace every placeholder with the separately reviewed, lowercase 64-character SHA-256 for that exact committed migration source. The apply template rejects blank, placeholder, malformed, missing, and mismatched values before it can invoke `psql`. Do not use this document to copy file contents or record secrets.

| Step | Migration | Reviewed expected SHA-256 |
| --- | --- | --- |
| M024 | `20260820_00_prd_phase_2_compliance_schema_substrate.sql` | `8a42669b40ae29d1170dd09831f0b79e795052614fd874432e6077d1072816cf` |
| M025 | `20260824_00_reviewed_profile_bootstrap_rpc.sql` | `e607cb2f1ef95feae26dffa153d8206e2d63efcccf039026df9cb48f2862d948` |
| M026 | `20260825_00_reviewed_profile_approval_rpc.sql` | `c2c27e0f457add4eebc90f2e839367e80c875825ede8e4124667eea8d910d76c` |
| M027 | `20260825_01_cleanup_approval_rpc_diagnostics.sql` | `ac7334c3c080dc4d6d7a68dd005ff1b3e2f16f082972fe8335764ea1a722376e` |
| M028 | `20260825_02_canonical_approval_snapshot_idempotency.sql` | `89ddba1421c1d796ee8c9e84f5d0c608d5c83ac538e4ee881cf2cc50f3d4ef28` |
| M029 | `20260826_00_canonical_workspace_linkage.sql` | `3ec3dfa172f5ebc1c34903853fb9746efb012731ded2ce3b344c7533951a34f9` |
| M030 | `20260827_00_m028_m029_readiness_integration.sql` | `8759bed04e9f019762b69fdf25c155f9deaaff691d844dfcbbe69663f604d49b` |

The evidence format is fixed: `PASS|HASH|M024|matched`, `BLOCKED|HASH|M024|missing_expected_hash`, or `BLOCKED|HASH|M024|mismatch`. A blocked hash is a hard stop; it is never an apply warning.

## Future local apply template — separate approval required

The user may use this template only after explicit approval. It uses discrete local `psql` arguments, secure local password input, `ON_ERROR_STOP=1`, and no connection string. Resolve `psql` from the explicit PostgreSQL 15 path, then PATH, then the PostgreSQL 17 path. If none resolves, stop with `BLOCKED|PSQL|not_found`.

```powershell
$psql = @('C:\Program Files\PostgreSQL\15\bin\psql.exe', (Get-Command psql -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source), 'C:\Program Files\PostgreSQL\17\bin\psql.exe') | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $psql) { throw 'BLOCKED|PSQL|not_found' }
$hostName = '127.0.0.1'; $port = '55432'; $userName = 'postgres'; $database = 'deraledger_m024_m030_rehearsal'
$migrations = @(
  [pscustomobject]@{ Step = 'M024'; Path = 'supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql'; ExpectedSha256 = '8a42669b40ae29d1170dd09831f0b79e795052614fd874432e6077d1072816cf' },
  [pscustomobject]@{ Step = 'M025'; Path = 'supabase/migrations/20260824_00_reviewed_profile_bootstrap_rpc.sql'; ExpectedSha256 = 'e607cb2f1ef95feae26dffa153d8206e2d63efcccf039026df9cb48f2862d948' },
  [pscustomobject]@{ Step = 'M026'; Path = 'supabase/migrations/20260825_00_reviewed_profile_approval_rpc.sql'; ExpectedSha256 = 'c2c27e0f457add4eebc90f2e839367e80c875825ede8e4124667eea8d910d76c' },
  [pscustomobject]@{ Step = 'M027'; Path = 'supabase/migrations/20260825_01_cleanup_approval_rpc_diagnostics.sql'; ExpectedSha256 = 'ac7334c3c080dc4d6d7a68dd005ff1b3e2f16f082972fe8335764ea1a722376e' },
  [pscustomobject]@{ Step = 'M028'; Path = 'supabase/migrations/20260825_02_canonical_approval_snapshot_idempotency.sql'; ExpectedSha256 = '89ddba1421c1d796ee8c9e84f5d0c608d5c83ac538e4ee881cf2cc50f3d4ef28' },
  [pscustomobject]@{ Step = 'M029'; Path = 'supabase/migrations/20260826_00_canonical_workspace_linkage.sql'; ExpectedSha256 = '3ec3dfa172f5ebc1c34903853fb9746efb012731ded2ce3b344c7533951a34f9' },
  [pscustomobject]@{ Step = 'M030'; Path = 'supabase/migrations/20260827_00_m028_m029_readiness_integration.sql'; ExpectedSha256 = '8759bed04e9f019762b69fdf25c155f9deaaff691d844dfcbbe69663f604d49b' }
)
foreach ($migration in $migrations) {
  if (-not (Test-Path -LiteralPath $migration.Path -PathType Leaf)) { throw ('BLOCKED|HASH|' + $migration.Step + '|migration_file_missing') }
  if ([string]::IsNullOrWhiteSpace($migration.ExpectedSha256) -or $migration.ExpectedSha256 -match 'REQUIRED|PLACEHOLDER|^<') { throw ('BLOCKED|HASH|' + $migration.Step + '|missing_expected_hash') }
  if ($migration.ExpectedSha256 -notmatch '^[A-Fa-f0-9]{64}$') { throw ('BLOCKED|HASH|' + $migration.Step + '|missing_expected_hash') }
  $actualSha256 = (Get-FileHash -LiteralPath $migration.Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -cne $migration.ExpectedSha256.ToLowerInvariant()) { throw ('BLOCKED|HASH|' + $migration.Step + '|mismatch') }
  Write-Output ('PASS|HASH|' + $migration.Step + '|matched')
}
if ((Read-Host 'Type LOCAL APPLY M024-M030').Trim() -cne 'LOCAL APPLY M024-M030') { throw 'BLOCKED|CONFIRMATION|required' }
$secure = Read-Host 'Local PostgreSQL password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$previousPassword = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  foreach ($migration in $migrations) {
    $null = & $psql -X -w -q -v ON_ERROR_STOP=1 -h $hostName -p $port -U $userName -d $database -f $migration.Path 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'BLOCKED|APPLY|psql_exit_nonzero' }
    Write-Output ('PASS|APPLY|' + $migration.Step)
  }
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  [Environment]::SetEnvironmentVariable('PGPASSWORD', $previousPassword, 'Process')
}
```

This is fail-fast. It must not continue after a partial apply and is not an automatic rollback mechanism.

## Postflight, stop, and rollback posture

After separately approved successful apply, the user must type `LOCAL POSTFLIGHT M024-M030` and run the seven manifests in ascending order. The following template uses the same discrete local arguments and suppresses raw catalog output; it emits compact evidence only.

```powershell
if ((Read-Host 'Type LOCAL POSTFLIGHT M024-M030').Trim() -cne 'LOCAL POSTFLIGHT M024-M030') { throw 'BLOCKED|CONFIRMATION|required' }
foreach ($manifest in @(
  'supabase/staging/postflight/024_prd_phase_2_compliance_schema_substrate_verify.sql',
  'supabase/staging/postflight/025_reviewed_profile_bootstrap_rpc_verify.sql',
  'supabase/staging/postflight/026_reviewed_profile_approval_rpc_verify.sql',
  'supabase/staging/postflight/027_cleanup_approval_rpc_diagnostics_verify.sql',
  'supabase/staging/postflight/028_canonical_approval_snapshot_idempotency_verify.sql',
  'supabase/staging/postflight/029_canonical_workspace_linkage_verify.sql',
  'supabase/staging/postflight/030_m028_m029_readiness_integration_verify.sql'
)) {
  $result = @(& $psql -X -w -q -A -t -v ON_ERROR_STOP=1 -h $hostName -p $port -U $userName -d $database -f $manifest 2>&1)
  if ($LASTEXITCODE -ne 0 -or $result -match '(?im)\|FAIL\||\|BLOCKED\||\bERROR:|\bFATAL:') { throw 'BLOCKED|POSTFLIGHT|verification_failed' }
  if ($result -match '(?im)\|WARN\|') { throw 'BLOCKED|POSTFLIGHT|warning_output_not_accepted' }
  Write-Output ('PASS|POSTFLIGHT|' + [IO.Path]::GetFileNameWithoutExtension($manifest))
}
```

The postflight template is run in the same local PowerShell session as the approved apply template so its secure `PGPASSWORD` boundary remains active. If a separate session is required, repeat the secure-prompt and environment-restoration block from the apply template; never place the password in a command or connection string.

The manifests verify ordered history; M024 tables; M025-M030 RPCs/signatures; function security and search paths; RLS and NO FORCE RLS; zero browser policies; revoked PUBLIC/anon/authenticated grants; exact service-role grants where the role exists; no prohibited DELETE grants; and M027 cleanup markers. A security mismatch must emit `FAIL` or `BLOCKED`; warning-only mismatch output is not accepted by this gate and the template blocks it.

Stop on wrong host/port/user/database, unsafe name, unresolved `psql`, hash mismatch, non-absent pre-apply history/object state, collision, any apply error, any postflight mismatch, or non-redactable output. Do not invent rollback or rerun a partial target. Discarding/recreating the disposable DB or designing rollback needs separate approval.

## Out of scope

No staging/production work, deployment, environment change, runtime adoption, route/UI, M030/live readiness, approval execution, activation, collection unlock, or payment/provider/checkout/subscription/invoice/storefront behavior. This package performed no DB connection, SQL execution, or migration apply.
