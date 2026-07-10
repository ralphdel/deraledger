# Breet Schema Deployment Architecture

## Purpose

```txt
This document records the canonical deployment chain for the Breet payment substrate.
Historical root-level SQL files under supabase/ are archival implementation inputs, not deployment scripts.
```

## Confirmed drift

```txt
The staging environment fsjljliiyfchkwbjifzw was missing the historical Breet schema substrate.
Missing objects included payment_sessions, crypto_payment_sessions, settlement_records, treasury and settlement support tables, current Breet invoice-confirmation functions, and Breet/crypto platform settings.
The original single Commit 7 migration partially applied before failing on crypto_payment_sessions.
```

## Partial Commit 7 state preserved

```txt
payment_records.onboarding_session_id
payment_records.solo_plus_case_id
idx_payment_records_onboarding_session
idx_payment_records_solo_plus_case
idx_payment_records_solo_plus_pending_case
idx_payment_records_solo_plus_provider_reference
```

## Canonical migration chain

```txt
1. supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql
2. supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql
```

## Rules

```txt
Migration A reconciles missing or incomplete Breet substrate objects against the final canonical schema.
Migration A does not recreate payment_records and does not replay historical SQL sequentially.
Migration B is Solo Plus-specific and fails before DDL if Migration A prerequisites are absent.
Both migrations are designed to be transactional and rerunnable.
Local repository review and static validation are complete.
Disposable PostgreSQL migration-behaviour execution passed, including clean apply, rerun, guarded negative cases, and rollback validation for both migrations.
Controlled staging execution passed: Migration A and Migration B both applied successfully, printed COMMIT, exited with code 0, and passed post-apply verification on staging.
Migration A class-wide security verification passed on staging, and the Migration A security model remained intact after Migration B.
Commit 7 is staging-migration complete. Deployment, production rollout, and feature flags remain blocked pending separate release approval and sign-off.
Use `scripts/test-breet-solo-plus-migrations.ps1` only with an explicit disposable `TEST_DATABASE_URL`; it refuses the known staging project reference and does not default to any live environment.
```

## Object policy

```txt
CREATE:
Missing canonical Breet tables, functions, triggers, indexes, and disabled platform-setting keys.

ALTER:
Existing compatible tables that need additive columns, constraints, policies, or indexes.

REPLACE:
Current canonical functions whose historical definitions were superseded.

SKIP:
Existing canonical-compatible objects that already match the required end-state.

BLOCK:
Existing objects whose structure conflicts with the canonical schema. These must raise a preflight exception instead of being silently accepted.
```

## Operational note

```txt
Do not run the historical root-level Breet SQL files directly in staging or production.
Use the ordered migrations and SQL tests instead.
The disposable PostgreSQL harness and controlled staging execution have both passed for the canonical ordered migration chain.
Do not deploy, roll out to production, or enable feature flags until separate release approval is given.
```
