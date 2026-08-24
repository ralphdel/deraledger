# PRD Phase 2 Collection Limit Source Stack Checkpoint

## Current Production Safety State

- Migration 024 is applied in production and postflight passed.
- Seven PRD Phase 2 compliance/limit substrate tables exist in production and remain empty.
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

## Migration 025 Partial Local Rehearsal Status

- Migration 025 reviewed-profile bootstrap RPC source exists.
- Migration 025 local structure/security rehearsal is only a partial pass.
- Migration 025 behavior and rollback rehearsal is not complete because the local harness still has a role-seeding issue.
- Migration 025 is not applied to staging or production.

## Approval Source Layer Completed

- The approval transition design doc exists.
- The approval command contracts exist.
- The approval persistence contracts exist.
- The approval transaction executor exists.
- The approval transaction client adapter exists.

## Collection Limit Source Stack Completed

The collection limit source stack is now in place and remains source-only and mock-only:

- `docs/prd-phase-2-collection-limit-engine-transition-design.md`
- `docs/prd-phase-2-collection-limit-engine-persistence-path.md`
- `src/lib/compliance/collection-limit-engine-command-core.ts`
- `src/lib/compliance/collection-limit-engine-command.ts`
- `src/lib/compliance/collection-limit-engine-persistence-core.ts`
- `src/lib/compliance/collection-limit-engine-persistence.ts`
- `src/lib/compliance/collection-limit-engine-transaction-executor-core.ts`
- `src/lib/compliance/collection-limit-engine-transaction-executor.ts`
- `src/lib/compliance/collection-limit-engine-transaction-client-core.ts`
- `src/lib/compliance/collection-limit-engine-transaction-client.ts`

## Explicit Boundaries

- The source stack does not create SQL.
- The source stack does not execute DB writes.
- The source stack does not add runtime call sites.
- The source stack does not activate collection.
- The source stack does not set `setup_mode = false`.
- The source stack does not set `live_features_enabled = true`.
- The source stack does not set any collection entitlement true.
- The source stack does not call payment providers.
- The source stack does not initialize checkout.
- The source stack does not touch payment, provider, settlement, or invoice behavior.

## Remaining Blockers Before Real Limit Work

Before the collection limit engine can become real, all of the following still need to happen:

- Migration 025 behavior and rollback rehearsal must finish locally.
- The collection limit SQL/RPC package must be prepared.
- The collection limit SQL/RPC package must be rehearsed in a disposable local environment.
- The disposable rehearsal must pass independent behavior, rollback, and forbidden-write checks.
- An independent review must approve the SQL/RPC package before any apply attempt.
- A separate runtime adoption plan must exist before any route or action uses the limit layer.

## Required Blockers Before Collection Can Unlock

Collection cannot be unlocked until all of the following are true:

- the compliance profile bootstrap path is complete;
- the approval path is complete;
- active paid entitlement is confirmed;
- risk and limit approval are complete;
- payout readiness is complete;
- exact provider mapping readiness is complete;
- the activation transition is complete.

## Activation Separation

- The source stack is not activation.
- Limit approval is not activation.
- Reservation is not checkout or provider initialization.
- Commit is not provider or payment verification.
- Activation remains a later transition.

## Safe Next Step

The safest next step is to keep the collection limit work source-only until Migration 025 finishes local behavior and rollback rehearsal and the separate SQL/RPC package is designed, reviewed, and rehearsed.
