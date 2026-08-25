# Migration 026 disposable local rehearsal runbook

## Purpose and boundary

This runbook rehearses only the source-prepared Migration 026 reviewed-profile approval RPC in a disposable local PostgreSQL database. It is forbidden to run it against staging, production, or any Supabase project. It does not add runtime call sites, approve real merchant data, activate collection, change setup/live flags, call a provider, initialize checkout, or run payment tests.

Migration 026 has passed independent source review but has not yet been run in any database. Migration 024 and Migration 025 are applied inside the disposable database solely as prerequisites. The harness rolls back all behavior seed data before reporting its control-line PASS result.

## Preconditions

- Use a local listener only: `localhost`, `127.0.0.1`, or `host.docker.internal`.
- Create or select a disposable database whose name includes `local`, `rehearsal`, or `disposable`; for example `deraledger_m026_disposable_local`.
- Use a password-less PostgreSQL connection URL. Supply the password through the local `PGPASSWORD` environment variable rather than the URL or a repository file.
- Use PostgreSQL with a local owner/admin account that may create the temporary prerequisite objects and roles.
- Have `psql` available. The known Windows path is `C:\Program Files\PostgreSQL\15\bin\psql.exe`.
- Start from a clean tracked worktree when practical. Do not save credentials or command output in tracked source files.

The script is dry-run by default. It validates the target but exits before `psql` unless `-Execute` is supplied with the exact confirmation phrase.

The generated behavior seed uses explicit column lists for profiles, reviews, and Solo Plus cases. Its static regression test checks that every tuple has the same value count as its INSERT column list; this prevents a local seed-shape error from being mistaken for an approval-RPC failure.

## Exact local command

From the repository root, set `PGPASSWORD` only in the current shell, then run:

```powershell
$env:PGPASSWORD = Read-Host 'Local disposable PostgreSQL password'
powershell -ExecutionPolicy Bypass -File .\scripts\rehearse-reviewed-profile-approval-rpc-local.ps1 `
  -LocalConnectionString 'postgresql://LOCAL_USER@127.0.0.1:55432/deraledger_m026_disposable_local' `
  -Confirmation 'REHEARSE MIGRATION 026 LOCAL DISPOSABLE DB ONLY' `
  -Execute `
  -PsqlPath 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
Remove-Item Env:PGPASSWORD
```

Replace only `LOCAL_USER`, host/port, and the disposable database name. Do not put a password in the URL. The script prints only the target host, not the connection string.

## Rehearsal sequence and expected checks

The harness writes generated SQL with `.NET UTF8Encoding` without a BOM, then performs this order:

1. Applies local prerequisite objects, then Migration 024 and Migration 025.
2. Runs Migration 026 preflight; stop on any error or `FAIL`.
3. Applies Migration 026 once.
4. Applies Migration 026 again to prove installation idempotency.
5. Runs Migration 026 postflight before any behavior seed rows exist.
6. Seeds local-only fixtures as the owner/admin, then invokes the approval RPC as `service_role` only.
7. Runs hostile anon/authenticated denial checks after seeding and service-role behavior.
8. Rolls back the behavior transaction and prints `CONTROL|LOCAL_APPROVAL_REHEARSAL=PASS` only if every check passed.

Behavior coverage includes Solo Lite pending-to-verified, needs-attention, rejected, and restricted decisions; Business pending-to-verified; and Solo Plus approved-to-enhanced-verified, rejected-to-rejected, and manual-review-to-needs-attention decisions. It also checks exact sequential idempotent replay, missing profile/reviewer, stale version, plan/source mismatch, unsupported transition, reused-key conflict, structural duplicate prevention, profile/event rollback failures, hostile grants, and forbidden writes.

Concurrent identical or stale replay may fail closed on the expected profile row-version rather than returning the sequential replay result. That is an expected safe outcome and must be recorded as such during review; it is not permission to accept a mismatched replay.

## Failure handling

Stop at the first error. Do not retry blindly, do not use staging or production as a substitute rehearsal, and do not proceed to runtime adoption. Preserve the local terminal output for review, redact credentials, and report whether failure occurred in prerequisites, preflight, first/second apply, postflight, or behavior checks.

If the control line is absent, Migration 026 is not fully locally rehearsed. The next step is to patch source only after review of the compact local failure evidence. A staging preflight/apply plan is a separate approved task after local PASS.

## Required success evidence

- Migration 024 and Migration 025 prerequisite application completed locally.
- Migration 026 preflight completed without `FAIL`.
- Both Migration 026 applies completed.
- Migration 026 postflight completed before business fixtures were seeded.
- All approved behavior, fail-closed, rollback, hostile-role, and forbidden-write assertions completed.
- Final line: `CONTROL|LOCAL_APPROVAL_REHEARSAL=PASS`.

Even after local PASS, Migration 026 remains unapplied to staging and production until separately approved. Collection remains locked throughout.
