# PRD Phase 2B Staging Migration-Ledger Bootstrap Package

**Status:** SOURCE-ONLY. The scripts in this package were not run. They require a separate explicit user approval before connecting to staging.

## Narrow purpose

This package can create only a missing `supabase_migrations` schema and its empty `schema_migrations` ledger table on the reviewed staging target. It is not an M024-M030 apply path. It cannot insert ledger rows, mark any migration applied, create protected M024-M030 objects, alter application tables, or authorize runtime adoption or an Admin UI release.

The expected Supabase CLI-compatible table shape is `version text PRIMARY KEY`, `statements text[]`, and `name text`. Supabase documents that its CLI uses this ledger to compare applied remote migrations; this package keeps it empty and does not run `db push` or migration repair. [Supabase migration documentation](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/deployment/database-migrations.mdx)

## Scripts and guards

- `scripts/bootstrap-staging-migration-ledger.ps1` requires `-RunBootstrap` and the exact typed confirmation `STAGING BOOTSTRAP MIGRATION LEDGER`.
- `scripts/postflight-staging-migration-ledger.ps1` requires `-RunPostflight` and the exact typed confirmation `STAGING POSTFLIGHT MIGRATION LEDGER`.
- Both require the reviewed staging project ref, pooler host, port `5432`, database `postgres`, and reviewed pooler user. They reject the known production ref and production indicators, use `PGSSLMODE=require`, prompt for the password only locally, restore PostgreSQL process environment in `finally`, and print compact evidence only.

Before mutation, bootstrap verifies the target session, a missing ledger, and the absence of every M024-M030 protected table/RPC, including `public.canonical_approval_snapshots`. A protected object without history emits `BLOCKED|DRIFT|protected_objects_without_history`. It creates only the two ledger containers with `IF NOT EXISTS`; there is no `INSERT`, `UPDATE`, `DELETE`, migration file invocation, public-table change, grant, or seed data.

Postflight proves the exact three-column table shape, verifies `schema_migrations.version` is the single-column primary key (otherwise `BLOCKED|LEDGER_SHAPE|version_primary_key_missing`), checks the same protected-object inventory as bootstrap, and requires zero M024-M030 ledger rows before emitting `PASS|DECISION|STAGING_LEDGER_BOOTSTRAP_READY_FOR_PREFLIGHT`.

## Stop conditions and next gate

Stop on target mismatch, production indicator, missing psql, password/connection failure, an existing ledger requiring reconciliation, protected-object drift, incompatible ledger shape, M024-M030 rows, or any non-redactable diagnostic. Production, runtime adoption, Admin UI release, routes/UI, approval execution, merchant activation, collection unlock, and commercial behavior remain out of scope.

After a reviewed, user-approved bootstrap and postflight, rerun the separate staging read-only M024-M030 preflight. Only its clean result can be considered for a later, separately approved M024-M030 apply review.
