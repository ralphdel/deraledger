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

The approval RPC locks the profile decision row, which it updates. Its event idempotency lookup and Lite/Business review or Solo Plus case evidence lookups are deliberately read-only `SELECT` operations: the RPC never mutates those append-only or submission/evidence sources, and the known Solo Plus service-role contract grants `SELECT` only. Lite and Business use one exact count-one predicate over source ID, merchant ID, profile ID, `p_source_type`-to-review-type mapping, plan, pending-or-attention status, and source row version. Zero rows return the safe review-source lookup result; multiple rows return the safe ambiguous-state result. Expected source and profile versions remain mandatory fail-closed checks. A concurrent replay may fail closed on the profile version; sequential exact replay remains the supported replay result.

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
7. Runs hostile anon/authenticated denial checks after seeding and service-role behavior. PUBLIC is verified through the exact RPC ACL catalog entry (`aclexplode` grantee `0`), never by attempting `SET ROLE PUBLIC`.
8. Rolls back the behavior transaction and prints `CONTROL|LOCAL_APPROVAL_REHEARSAL=PASS` only if every check passed.

Behavior coverage includes Solo Lite pending-to-verified, needs-attention, rejected, and restricted decisions; Business pending-to-verified; and Solo Plus approved-to-enhanced-verified, rejected-to-rejected, and manual-review-to-needs-attention decisions. It also checks exact sequential idempotent replay, missing profile/reviewer, stale version, plan/source mismatch, unsupported transition, reused-key conflict, structural duplicate prevention, profile/event rollback failures, hostile grants, and forbidden writes.

The behavior file is collect-all for approval scenarios. It records `scenario_name`, `expected_result`, `actual_result`, `PASS`/`FAIL`, and a safe failure code in a transaction-local temporary table, prints every row, then exits nonzero once if any required scenario failed. It does not print raw PostgreSQL errors, fixture contents, or credentials.

The approval RPC returns safe stage-specific failure codes for unexpected internal failures: replay lookup, profile lookup, reviewer/source lookup, profile update, event insert, or an unknown atomic-write stage. These retain the one transaction boundary: an event-insert failure rolls back the preceding profile update. The local probes separately report fixture shape plus profile-update, event-insert, replay-lookup, exact Lite/Business review-source, and case-source privilege/fixture readiness before full scenario assertions. The profile-update rollback fixture uses a disposable owner-created trigger after the profile lock succeeds, rather than revoking UPDATE before `SELECT ... FOR UPDATE`.

Before the first Lite approval call, the harness also prints one compact `DIAGNOSTIC|lite_review_source_before_rpc` row. It contains only fixed disposable-fixture UUIDs, the exact RPC input fields, candidate review fields, and the exact RPC predicate count evaluated as `service_role`. This is diagnostic output only; it contains no connection data, credentials, provider data, or production/business records.

For the next local run, the harness additionally lists every function overload named `review_compliance_profile_decision_v1`, asserts that exactly the expected 13-argument identity is callable, and inspects `pg_get_functiondef` for the installed source-type mapping (while rejecting the old plan-derived review-type expression). A local transaction setting plus session temporary table records the actual Lite/Business RPC parameter values, mapped review type, source count, and profile status/version immediately after the RPC evaluates the source predicate. The channel is inert unless both the local setting and temp table exist; it does not expose raw database errors or affect normal RPC responses.

If the source-lookup result is returned before that temp-table row is visible, the same local setting enables safe `LOCAL_APPROVAL_BRANCH|...` notices. They identify entry, source-type mapping, source count, diagnostic-gate/insert progress, explicit zero or multiple counts, and the exception mapper's unknown branch. For a review-source exception only, the local-GUC gate additionally prints PostgreSQL's stacked SQLSTATE, message, detail, hint, and context as local `psql` notices. This exists solely to diagnose a disposable rehearsal; the RPC still returns only its safe production result code and never puts exception details in the result payload. The notices are printed even when the scenario later fails and must not be copied into runtime responses or production logs.

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
