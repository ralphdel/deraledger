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
- Verify a consistent merchant/workspace/profile/source/published-policy path
  issues one request and returns one canonical ready snapshot.
- Verify missing, duplicate, and conflicting workspace links fail closed.
- Verify Lite accepts only `lite_pending`/`needs_attention`, Solo Plus accepts
  only `enhanced_pending`/`needs_attention`, and Business accepts only
  `business_pending`/`needs_attention`; every cross-plan pending state must
  fail closed before issue/snapshot readiness. Verify Lite, Business, and Solo
  Plus source/version/policy mismatches fail closed; Solo Plus
  actor/timestamp/policy must match its case facts.
- Verify request retry returns the same immutable key only for an exact
  fingerprint; changed reviewer/source/version/target/policy/reason/profile
  version fails closed or produces a distinct valid request as designed.
- Verify exact M026 event/profile linkage yields only a replay candidate;
  partial or duplicate event evidence fails closed.
- Verify hostile anon/authenticated execution is denied and service_role is the
  only callable role.
- Verify issue/snapshot calls do not alter profile, review, case, event,
  merchant, workspace, payment, provider, limit, subscription, invoice,
  capability, setup/live, activation, or collection state.
- Inject late request insert failures and confirm transaction rollback. Use
  collect-all diagnostics before fixing any discovered SQL issue.

## Boundary

The rehearsal may seed only disposable data. It must not execute approval
against real data, call M026 as part of request/snapshot verification, unlock
collection, activate a merchant, initialize checkout, or run payment/provider
tests. A successful local rehearsal is not approval for staging.
