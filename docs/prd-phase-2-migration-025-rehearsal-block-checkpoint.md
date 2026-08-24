# PRD Phase 2 Migration 025 Rehearsal Block Checkpoint

## Current Production Safety State

- Migration 024 is applied in production and the postflight check passed.
- Seven PRD Phase 2 compliance/limit substrate tables exist in production and remain empty.
- `setup_mode` remains `true`.
- `live_features_enabled` remains `false`.
- `verification_status` remains `unverified`.
- Collection remains locked.
- No real compliance profile rows have been inserted.
- No activation has occurred.
- No payment test is allowed.
- No collection checkout test is allowed.
- Storefront work has not started.

## Migration 025 Source Package Status

- The reviewed-profile bootstrap RPC source package exists.
- The RPC source package is still source-only and has not been applied to staging or production.
- The reviewed profile bootstrap transaction harness and local-only rehearsal harness exist.

## Rehearsal Block Reason

- Disposable local PostgreSQL/Docker validation was attempted previously and blocked because no disposable local PostgreSQL listener was available.
- Until a disposable local PostgreSQL environment is available, Migration 025 cannot be rehearsed safely.

## Local-Only Harness Status

- A local-only bootstrap RPC rehearsal harness now exists.
- The harness is intentionally guarded to reject staging, production, Supabase project targets, and Supabase credentials.
- The harness is not a substitute for a disposable local PostgreSQL database.

## Explicit Apply Block

- Migration 025 must not be applied to staging.
- Migration 025 must not be applied to production.
- No runtime route adoption should occur before the disposable rehearsal has succeeded.

## Next Unblock Condition

- A disposable local PostgreSQL listener or Docker-based PostgreSQL environment must be available before the rehearsal can continue.

## Safe Sequence After Unblock

1. Create or start a disposable local PostgreSQL database.
2. Run the local-only rehearsal harness with the exact confirmation phrase `REHEARSE LOCAL DISPOSABLE DB ONLY`.
3. Review the compact rehearsal result.
4. Patch source if the rehearsal reveals a defect.
5. Only after the local rehearsal is clean should staging preflight be considered.

## Forbidden Shortcuts

- Do not use staging as a rehearsal target.
- Do not use production as a rehearsal target.
- Do not put Supabase service-role keys into the local harness.
- Do not adopt any runtime route before the rehearsal is complete.

