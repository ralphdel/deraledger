# PRD Phase 2 Activation Source Stack Checkpoint

The activation source stack is complete in source-only form, but it remains schema-blocked, mock-only, and disconnected from runtime behavior.

## Current State

- Production Migration 024 is applied and postflight passed.
- Seven compliance/limit substrate tables exist in production and remain empty.
- Migration 025 reviewed-profile bootstrap RPC source exists, but local behavior and rollback rehearsal is still only partial.
- Migration 025 is not applied to staging or production.
- The approval source layer exists and remains source-only/mock-only.
- The collection limit source stack exists and remains source-only/mock-only.
- The activation source stack now exists in source-only/mock-only form.
- No real compliance profile rows have been inserted.
- No real limit rows have been inserted.
- `setup_mode` remains `true`.
- `live_features_enabled` remains `false`.
- `verification_status` remains `unverified`.
- Collection remains locked.
- No payment or provider behavior has changed.
- No storefront work has started.

## Activation Source Stack Layers

- `docs/prd-phase-2-activation-transition-gate-design.md` defines the future activation gate and its prerequisites.
- `src/lib/compliance/activation-transition-command-core.ts` defines command contracts and validation for activation, re-lock, and emergency suspension.
- `src/lib/compliance/activation-transition-command.ts` exposes the server-only command facade.
- `docs/prd-phase-2-activation-persistence-path.md` defines the future persistence boundary and transaction model.
- `src/lib/compliance/activation-transition-persistence-core.ts` defines the validated persistence contracts and fail-closed snapshot rules.
- `src/lib/compliance/activation-transition-persistence.ts` exposes the server-only persistence facade.
- `src/lib/compliance/activation-transition-transaction-executor-core.ts` defines the atomic transaction executor over injected writers.
- `src/lib/compliance/activation-transition-transaction-executor.ts` exposes the server-only executor facade.
- `src/lib/compliance/activation-transition-transaction-client-core.ts` defines the injected transport adapter for activation execution.
- `src/lib/compliance/activation-transition-transaction-client.ts` exposes the server-only transaction client facade.

## What Each Layer Does

- The activation transition gate design describes the final activation prerequisites and keeps activation separate from bootstrap, approval, limits, payout readiness, and provider mapping readiness.
- The activation command contracts validate trusted server-side activation inputs and keep activation, re-lock, and emergency suspension commands explicit and fail-closed.
- The activation persistence path design defines how validated commands would later be persisted atomically.
- The activation persistence contracts define the write boundary and replay rules without enabling real DB writes.
- The activation transaction executor routes validated persistence payloads through an injected atomic transaction boundary.
- The activation transaction client adapter wraps the executor behind an injected transport boundary without introducing runtime adoption.

## Schema-Blocked Status

- `activation_status=active` is still explicitly blocked.
- Migration 024 does not currently permit that literal, so activation remains schema-blocked pending a separate additive schema decision, migration, and rehearsal.
- Re-lock and emergency suspension remain represented as non-operational targets only.

## Runtime Status

- No runtime adoption has started.
- No route, action, page, or webhook imports use the activation stack.
- No provider or checkout code is invoked by the activation stack.
- No payment tests have been run for activation.
- No collection unlock has occurred.

## SQL and DB Status

- No activation SQL or RPC package has been created yet.
- No activation database migration has been applied.
- No database execution was performed for the activation stack.
- No runtime behavior changed in production.

## Test Coverage

- The activation command contracts are covered by `tests/activation-transition-command.test.ts`.
- The activation persistence contracts are covered by `tests/activation-transition-persistence.test.ts`.
- The activation transaction executor is covered by `tests/activation-transition-transaction-executor.test.ts`.
- The activation transaction client adapter is covered by `tests/activation-transition-transaction-client.test.ts`.
- The tests keep provider, checkout, payment, and collection unlock paths absent.

## Remaining Blockers

- Complete Migration 025 local behavior and rollback rehearsal.
- Resolve the local harness role-seeding issue.
- Do not use staging or production as a rehearsal substitute.
- Finish bootstrap, approval, and limit SQL/RPC design and disposable rehearsal before any activation SQL is attempted.
- Resolve the `activation_status=active` schema mismatch through a separate additive schema design, migration, and rehearsal.
- Design and rehearse activation SQL/RPC separately.
- Plan runtime adoption only after the DB paths are proven.

## Safe Next Steps

- Keep the activation stack source-only and mock-only.
- Finish the remaining Migration 025 local rehearsal work in a disposable environment.
- Continue separate DB design work for activation schema compatibility before any runtime adoption.
- Preserve `setup_mode=true`, `live_features_enabled=false`, and locked collection until the full activation path is independently approved.

