# PRD Phase 2 Approval Transition Source Layer Checkpoint

## Current Production Safety State

- Migration 024 is applied in production and the postflight check passed.
- Seven PRD Phase 2 compliance/limit substrate tables exist in production and remain empty.
- `setup_mode` remains `true`.
- `live_features_enabled` remains `false`.
- `verification_status` remains `unverified`.
- Collection remains locked.
- No real compliance profile rows have been inserted.
- No approval activation has occurred.
- No payment test is allowed.
- No collection checkout test is allowed.
- Storefront work has not started.

## Migration 025 Status and Rehearsal Block

- Migration 025 reviewed-profile bootstrap RPC source exists.
- Migration 025 is still source-only and has not been applied to staging or production.
- Disposable local PostgreSQL rehearsal for Migration 025 remains blocked until a local PostgreSQL listener or Docker environment is available.
- The local-only rehearsal harness exists, but it is not a substitute for a disposable database.

## Approval Source Layer Completed

- The approval transition design doc exists.
- The approval command contracts exist.
- The approval persistence contracts exist.
- The approval transaction executor exists.
- The approval transaction client adapter exists.

## Explicit Source-Only and Mock-Only Status

- All approval transition layers are still source-only/mock-only.
- No real SQL has been executed for approval persistence.
- No runtime route, action, or page imports exist for approval adoption.
- No approval call site has been wired into production behavior.

## Explicit No SQL, DB, or Runtime Adoption

- No approval SQL package has been applied.
- No approval RPC has been rehearsed against a disposable database.
- No approval RPC has been adopted into runtime routes or actions.
- No approval persistence has been connected to a live database path.

## Collection Lock Remains In Place

- Approval work does not unlock collection.
- Approval work does not set `setup_mode = false`.
- Approval work does not set `live_features_enabled = true`.
- Approval work does not change payment or provider behavior.

## Remaining Blockers Before Approval Persistence Becomes Real

1. Migration 025 must pass the disposable local PostgreSQL rehearsal.
2. Staging preflight may only follow a successful local rehearsal.
3. A separate approval SQL/RPC package must exist before any real persistence path is considered.
4. The approval SQL/RPC package must itself receive disposable rehearsal before any apply attempt.
5. The approval path must receive independent review before runtime adoption.
6. A separate runtime adoption plan must exist before any route or action uses the approval layer.

## Activation Separation

- Approval is not activation.
- Activation remains a later transition.
- Approval must not unlock collection.
- Approval must not create limit windows, provider readiness, or merchant collection entitlements.

## Safe Next Step

The safest next step is to keep approval work source-only until Migration 025 can be rehearsed locally and the separate approval SQL/RPC package is designed and reviewed.

