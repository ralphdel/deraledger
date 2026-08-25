# Migration 028 local disposable rehearsal runbook

## Status

This is a future local-only rehearsal plan. Do not run it against staging or
production. Migration 028 source has not yet been locally rehearsed.

## Required order

Use a fresh disposable PostgreSQL database only. Apply local prerequisites,
then M024, M025, M026, M027, run M028 preflight, apply M028, rerun M028, and
run M028 postflight. Stop on any FAIL or SQL error. Generated temporary SQL
must be UTF-8 without BOM; credentials/evidence remain outside tracked files.

## Required rehearsal matrix

- Verify policy/request tables, exact RPC signatures, SECURITY INVOKER,
  hardened search paths, RLS enabled/not forced, exact service-role table
  grants, immutable no-update/no-delete posture, required constraints/indexes,
  and no PUBLIC/anon/authenticated execute.
- Verify the M024--M027 disposable baseline needs no `public.workspaces` table
  or `merchants.workspace_id` column for M028 preflight/apply/rerun/postflight.
  M028 must report its explicitly deferred workspace-linkage posture as PASS.
- Verify valid issue and snapshot inputs return only safe
  `canonical_request_workspace_linkage_unavailable` and
  `canonical_snapshot_workspace_linkage_unavailable` results. They must not
  issue a request or return a ready snapshot.
- Verify Lite accepts only `lite_pending`/`needs_attention`, Solo Plus accepts
  only `enhanced_pending`/`needs_attention`, and Business accepts only
  `business_pending`/`needs_attention`; every cross-plan pending state must
  fail closed before issue/snapshot readiness. Verify Lite, Business, and Solo
  Plus source/version/policy mismatches fail closed; Solo Plus
  actor/timestamp/policy must match its case facts.
- Verify no canonical request is inserted while workspace linkage is deferred.
  Request issuance, retry/replay authority, and M026 event/profile replay
  linkage are out of scope until a separately reviewed workspace-linkage
  package enables them.
- Verify hostile anon/authenticated execution is denied and service_role is the
  only callable role.
- Verify issue/snapshot calls do not alter profile, review, case, event,
  merchant, workspace, payment, provider, limit, subscription, invoice,
  capability, setup/live, activation, or collection state.
- No request-insert rollback scenario applies while issuance is deliberately
  blocked. Any future workspace-linkage package that enables issuance must add
  atomic insert/replay and late-write rollback rehearsal coverage before use.

## Boundary

The rehearsal may seed only disposable data. It must not execute approval
against real data, call M026 as part of request/snapshot verification, unlock
collection, activate a merchant, initialize checkout, or run payment/provider
tests. A successful local rehearsal is not approval for staging.
