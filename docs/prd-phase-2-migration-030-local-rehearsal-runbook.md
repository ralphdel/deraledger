# Migration 030 disposable local rehearsal runbook

Date: 2026-08-27

## Status and boundary

This is a local-disposable rehearsal plan and matching source-only harness for
Migration 030. It is not authorization to connect to any database and no
rehearsal was run while this harness was prepared. Do not use staging or
production as a rehearsal environment.

Before any future runner or credentialed local command is created or executed,
re-read the database migration safety runbook and SQL rehearsal lessons. The
runner must prove a fresh disposable local database, reject non-local targets,
redact credentials, preserve failure evidence, use no-BOM generated input, and
emit a final control line only after every required gate passes.

## Required sequence

1. Start from a fresh disposable baseline containing the proven M024--M029
   prerequisites, including the historical workspace contract needed by M029.
2. Verify M026 and M027 approval RPC security, M028 v1 fail-closed posture,
   and M029 canonical-link authority before M030 preflight. The M029 gate must
   prove the exact non-partial unique `workspaces (id, merchant_id)` supporting
   index and the canonical-link primary key, unique workspace key, and
   composite ownership-FK columns, target columns, and actions; matching names
   alone are not sufficient.
3. Run M030 preflight and stop on any FAIL or SQL execution error.
4. Apply M030 once, rerun it to prove idempotency, then run M030 postflight.
5. Seed only disposable fixtures after installation/security checks. Reconcile
   a valid M029 canonical link as a prerequisite fixture; M030 must never
   create that link.
6. Execute every scenario in collect-all mode, print a compact result table,
   fail at the end when any required scenario fails, and preserve sanitized
   local evidence outside tracked source.

## Required behavior scenarios

- no M029 link: issue and snapshot return a safe blocked result;
- valid M029 link plus valid Lite, Business, and Solo Plus profile/source/
  policy/version facts: issue creates one request and snapshot returns ready;
- exact issue retry: the original request ID and opaque database-generated key
  are returned as a replay;
- snapshot of the matching request/link: returns ready without trusting a UI
  workspace value;
- changed canonical workspace, broken ownership join, or contradictory link:
  returns a safe conflict/blocked result with no partial context;
- stale profile or source version and cross-plan/incompatible status: blocked
  without a new request;
- changed reviewer, source/version, target, policy, reason, or workspace under
  the same canonical request fingerprint: safe idempotency conflict;
- anon and authenticated cannot execute v2 or access M028/M029 authority;
- no partial request after a late insert failure; and
- no M026 decision/profile/event mutation, merchant/workspace mutation,
  activation, collection, limit, payment, provider, checkout, subscription,
  invoice, or storefront write.

The harness snapshots row counts before behavior scenarios for every known
forbidden business relation. Optional historical relations are first resolved
with `to_regclass`: an absent relation is recorded as `not_present`/`skipped`,
while every present relation must keep its exact row count. The category result
rows are `subscriptions_unchanged`, `providers_settlements_unchanged`,
`checkout_unchanged`, `storefront_unchanged`, and
`forbidden_business_writes_absent`. Invoice, payment-record, and collection
limit checks remain in the same dynamic count baseline.

## Pass criteria

The future harness must report M030 preflight PASS, first apply COMMIT, rerun
apply COMMIT, postflight PASS, zero collect-all failures, hostile-role denial
PASS, and all forbidden-write assertions PASS. Only then may a separately
approved staging preflight package be prepared.

## Explicit prohibitions

This migration does not authorize runtime routes/actions/pages/webhooks,
approval execution against real data, activation, setup/live flag changes,
collection unlock, or provider/payment testing.

## Harness invocation after separate approval

The harness accepts discrete local inputs instead of a connection string:
`LocalHost` defaults to `127.0.0.1`, `LocalPort` defaults to `55432`, and
`LocalUser` defaults to `postgres`; `LocalDatabase` is required and must match
`deraledger_m030_disposable_*`. After the local-only target and confirmation
checks pass, it prompts only for the local PostgreSQL password through
`Read-Host -AsSecureString`, sets `PGPASSWORD` only for the child psql process
environment, and restores it during cleanup without printing it.

Every psql file stage uses `Start-Process` with discrete `-h`, `-p`, `-U`,
`-d`, and `-f` arguments, so a Windows psql path cannot be split by shell
quoting. The harness captures stdout/stderr in local evidence files, uses
`ON_ERROR_STOP=1`, and emits the control line only after every gate and
behavior scenario passes.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/rehearse-m028-m029-readiness-integration-local.ps1 `
  -LocalDatabase 'deraledger_m030_disposable_example' `
  -Confirmation 'REHEARSE MIGRATION 030 LOCAL DISPOSABLE DB ONLY' `
  -Execute `
  -PsqlPath 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
```
