# PRD Phase 2 Collection Limit Engine Source Layer Checkpoint

## Current Production Safety State

- Migration 024 is applied in production and postflight passed.
- The four collection-limit substrate tables exist in production and remain empty.
- `setup_mode` remains `true`.
- `live_features_enabled` remains `false`.
- `verification_status` remains unverified.
- Collection remains locked.
- Payment and provider behavior are unchanged.
- No payment test is allowed.
- No collection checkout test is allowed.
- No runtime call sites have been added for the collection limit engine.
- No real compliance profile rows have been inserted.
- No real limit rows have been inserted.
- Storefront work has not started.

## Migration 025 Status And Rehearsal Block

- Migration 025 reviewed-profile bootstrap RPC source exists.
- Migration 025 local structure/security rehearsal is only a partial pass.
- Migration 025 behavior and rollback rehearsal is not complete because the local harness still has a role-seeding issue.
- Migration 025 is not applied to staging or production.

## Collection Limit Source Layer Completed

The collection limit engine source layer is now in place and remains source-only and mock-only:

- `docs/prd-phase-2-collection-limit-engine-transition-design.md`
- `docs/prd-phase-2-collection-limit-engine-persistence-path.md`
- `src/lib/compliance/collection-limit-engine-command-core.ts`
- `src/lib/compliance/collection-limit-engine-command.ts`
- `src/lib/compliance/collection-limit-engine-persistence-core.ts`
- `src/lib/compliance/collection-limit-engine-persistence.ts`

## Explicit Boundaries

- The source layer does not create SQL.
- The source layer does not execute DB writes.
- The source layer does not add runtime call sites.
- The source layer does not activate collection.
- The source layer does not set `setup_mode = false`.
- The source layer does not set `live_features_enabled = true`.
- The source layer does not set any collection entitlement true.
- The source layer does not call payment providers.
- The source layer does not initialize checkout.
- The source layer does not touch payment, provider, settlement, or invoice behavior.

## Remaining Blockers Before Real Limit Work

Before the collection limit engine can become real, all of the following still need to happen:

- the reviewed-profile bootstrap path must finish its local disposable rehearsal;
- the approval transition path must be implemented and reviewed;
- the collection limit engine transaction executor must be implemented and rehearsed;
- the collection limit engine transaction client or transport must be implemented and rehearsed;
- the collection limit engine SQL/RPC package must be prepared and rehearsed;
- the local disposable rehearsal must pass independently reviewed behavior, rollback, and forbidden-write checks;
- a separate runtime adoption plan must be approved before any route/action wiring.

## Required Blockers Before Collection Can Unlock

Collection cannot be unlocked until all of the following are true:

- Migration 025 behavior and rollback rehearsal passes;
- the compliance profile bootstrap and approval path are complete;
- the limit engine is implemented and rehearsed;
- the activation transition is designed and implemented;
- provider and payout readiness are in place;
- all future activation gates remain fail-closed until explicitly approved.

## Activation Separation

- Limit approval is not activation.
- Reservation is not provider initialization.
- Commit is not provider verification.
- Activation remains a later transition.

