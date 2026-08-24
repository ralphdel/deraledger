# PRD Phase 2 Migration 025 Partial Local Rehearsal Checkpoint

## Current Local Rehearsal State

- Local PostgreSQL 15.18 was confirmed on `127.0.0.1:55432`.
- Disposable database used: `deraledger_m025_disposable_20260824`.
- Migration 024 disposable baseline applied successfully.
- Migration 025 preflight passed.
- Migration 025 first apply passed.
- Migration 025 second apply and idempotency passed.
- Migration 025 postflight passed.
- Function signature, security, and grants checks passed.
- Password file was cleaned.
- No staging was touched.
- No production was touched.

## Behavior Rehearsal Status

- The behavior rehearsal did not complete.
- Failure occurred before RPC behavior tests during local harness seed setup.
- The failure was `permission denied for table merchants` while inserting `service_merchant`.
- This is recorded as a local harness role-seeding issue, not proof of an RPC defect.
- Migration 025 must not be marked as fully rehearsed yet.

## Blocking State

- Staging and production apply remain blocked until the behavior, idempotency, rollback, and forbidden-write rehearsal passes.
- No profile rows were inserted outside the disposable database.
- No runtime call sites were created.
- No payment tests were run.
- No collection unlock occurred.
- No storefront work started.

## Safe Next Step

- Fix the local rehearsal harness role-seeding flow.
- Re-run the disposable local behavior rehearsal.
- Only after the full behavior rehearsal passes should staging preflight be reconsidered.

