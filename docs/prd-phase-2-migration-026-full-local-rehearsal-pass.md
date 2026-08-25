# Migration 026 full local disposable rehearsal PASS

Date: 2026-08-25

## Scope and result

Migration `026`, [20260825_00_reviewed_profile_approval_rpc.sql](../supabase/migrations/20260825_00_reviewed_profile_approval_rpc.sql), completed a full PASS rehearsal on disposable local PostgreSQL only.

- Preflight: PASS
- First apply: PASS
- Second apply/idempotency: PASS
- Postflight: PASS
- Behavior scenarios: 29/29 PASS

## Confirmed behavior

- Lite approval transitions: PASS
- Business approval transition: PASS
- Solo Plus approved, manual-review, and rejected paths: PASS
- Exact idempotent replay and idempotency-conflict handling: PASS
- Event-insert and profile-update rollback failures: PASS
- No partial profile/event decision state after rollback: PASS
- `anon` and `authenticated` execution denial: PASS
- `service_role`-only boundary: PASS
- Forbidden-write assertions: PASS

## Root cause repaired

The Lite/Business review-source query used unqualified columns that collided with the function's `RETURNS TABLE` output identifiers. Review-source predicates now use explicit table aliases, eliminating that PL/pgSQL ambiguity.

## Safety boundary

This rehearsal used disposable local PostgreSQL only. Staging and production were not touched. It added no runtime adoption, collection unlock, payment/provider testing, or approval execution against real data.

## Next gate

Staging preflight, apply, and postflight may be considered only after the repaired source checkpoint is committed and independently reviewed.
