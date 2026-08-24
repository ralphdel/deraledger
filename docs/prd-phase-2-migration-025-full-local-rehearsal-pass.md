# PRD Phase 2 Migration 025 Full Local Rehearsal Pass

## Fresh Disposable Local PASS

- Local PostgreSQL 15.18 was confirmed on `127.0.0.1:55432`.
- Disposable database used: `deraledger_m025_disposable_20260824`.
- Migration 024 fresh disposable baseline: PASS.
- Migration 025 preflight: PASS.
- Migration 025 first apply: PASS.
- Migration 025 second apply and idempotency: PASS.
- Migration 025 postflight: PASS.
- Lite, Business, and Solo Plus behavior rehearsal: PASS.
- Grant denial checks: PASS.
- Rollback safety: PASS.
- Final control line: `CONTROL|LOCAL_BOOTSTRAP_REHEARSAL=PASS`.

## Harness Repair Outcome

- The previous blocker was the local harness trying to insert `service_merchant` as `service_role` before the disposable seed setup was complete.
- The repair seeds the owner/admin disposable prerequisites first, then switches to `service_role` for the RPC-only behavior checks.
- `service_role` now invokes only `bootstrap_reviewed_profile_v1`.
- Hostile `anon` and `authenticated` denial checks remain in place after seeding.

## Safety Boundary

- Local disposable DB only.
- Staging touched: NO.
- Production touched: NO.
- No real compliance rows were inserted.
- No real limit rows were inserted.
- No runtime call sites were added.
- No activation was executed.
- No collection unlock occurred.
- No payment or provider testing occurred.
- No storefront work started.

## Updated Status

- Migration 025 local rehearsal status is now FULL PASS.
- Migration 025 staging preflight may be considered next, but only as a separate approved step.

## Safe Next Steps

- Commit this checkpoint.
- Prepare staging preflight, apply, and postflight instructions separately.
- Do not apply Migration 025 to production without explicit approval after staging PASS.
