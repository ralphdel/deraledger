# Migration 027 cleanup local rehearsal pass

Date: 2026-08-25

Environment: disposable local PostgreSQL only.

Migration file: `supabase/migrations/20260825_01_cleanup_approval_rpc_diagnostics.sql`

Migration 027 local disposable rehearsal is a full pass.

Evidence summary:

- Preflight: PASS
- First apply: PASS / COMMIT
- Second apply / idempotency: PASS / COMMIT
- Postflight: PASS
- `rpc.diagnostics_removed`: PASS
- Behavior rehearsal: 29/29 PASS
- Final control: `CONTROL|LOCAL_APPROVAL_REHEARSAL=PASS`

Confirmed postflight:

- Exact 13-argument approval RPC is present.
- `SECURITY INVOKER` with hardened search path is preserved.
- Diagnostic instrumentation is removed.
- No `PUBLIC` / `anon` / `authenticated` EXECUTE remains.
- `service_role` has EXECUTE on the exact signature.
- No browser/public compliance-table grants exist.
- Zero browser policies exist.
- The migration created no compliance business rows.

Behavior coverage:

- Lite approval transitions: PASS
- Business approval transition: PASS
- Solo Plus approved / manual_review / rejected: PASS
- Replay / idempotency: PASS
- Idempotency conflict: PASS
- Rollback event insert / profile update failure: PASS
- No partial profile / event rollback: PASS
- `anon` / `authenticated` denied: PASS
- Forbidden writes absent: PASS

Explicit boundaries:

- Staging was not touched by this local run.
- Production was not touched by this local run.
- No runtime adoption.
- No collection unlock.
- No provider / payment testing.
- No activation executed.

Next gate:

- Migration 027 staging preflight / apply / rerun / postflight may be considered only after this local checkpoint is committed.
