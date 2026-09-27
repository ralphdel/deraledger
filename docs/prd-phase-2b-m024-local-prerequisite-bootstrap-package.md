# PRD Phase 2B M024 Local Prerequisite Bootstrap Package

**Status:** SOURCE ONLY — unexecuted. This package neither approves nor performs a database connection, bootstrap, migration apply, staging, production, runtime adoption, or commercial behavior.

## Purpose

This package prepares only the minimum source-derived baseline needed to retry Migration 024 on the disposable local rehearsal target. It is not a Supabase baseline emulator and does not claim M025–M030 readiness.

The only permitted target is database host `127.0.0.1`, port `55432`, user `postgres`, and database `deraledger_m024_m030_rehearsal` (or an approved disposable rehearsal name accepted by the scripts). The scripts reject reserved environment tokens anywhere in the database name and use a `$DbHost` parameter to avoid PowerShell's read-only automatic `$Host` variable.

**Never run either local bootstrap script against staging or production.** They are intentionally limited to disposable loopback targets and are not a substitute for the separately gated managed-target process in [the staging execution gate](prd-phase-2b-m024-m030-staging-execution-gate.md).

## Source-derived inventory

| Prerequisite | M024 source basis | Package behavior |
| --- | --- | --- |
| `public` schema | M024 creates and references `public.*`; it does not create the schema | Verify effective local `USAGE`/`CREATE` authority; create only if absent with local ownership-safe authorization. PostgreSQL 15 may represent ownership through `pg_database_owner`, so strict owner-OID equality is not required. |
| `anon`, `authenticated`, `service_role` | M024 prerequisite loop plus later narrow grant/revoke statements | Create only missing no-login, least-privilege local roles. Existing roles are not changed. |
| `gen_random_uuid()` | M024 prerequisite block and UUID defaults | Verify function; use `CREATE EXTENSION IF NOT EXISTS pgcrypto` only if needed, then verify again. No stub function. |
| `public.merchants`, `public.invoices`, `public.payment_records` | M024 prerequisite loop and foreign-key targets | Create only when absent, each as an empty `id uuid NOT NULL PRIMARY KEY` rehearsal table. M024 proves this is its complete immediate table-shape contract. |

The empty one-column tables are local rehearsal support, not a production schema proposal. M024–M030-owned tables, RPCs, policies, grants, migration-history records, business rows, `auth.users`, `public.workspaces`, and `public.solo_plus_cases` are never created by this package. Later contracts remain separately reviewed prerequisites for a full M025–M030 rehearsal.

## Bootstrap script

[bootstrap-m024-prereqs-local.ps1](../scripts/bootstrap-m024-prereqs-local.ps1) is local-only and requires the exact typed confirmation `LOCAL BOOTSTRAP M024 PREREQS` before it resolves `psql`, prompts for the local password, writes temporary SQL, or starts a native process.

Before any schema change, it runs a separate read-only public-schema precheck. That precheck emits `PASS|SCHEMA|public|exists` and `PASS|SCHEMA|public|authority_ok` only when the schema exists and the local user has effective `USAGE` and `CREATE`. It emits `BLOCKED|SCHEMA|public|missing` or `BLOCKED|SCHEMA|public|insufficient_authority` and exits before mutation when either condition fails; these known failures are not collapsed into generic `psql_exit_nonzero`. The subsequent mutation transaction verifies target identity, an absent M024–M030 migration history, absent protected M024–M030 tables/RPCs, and a compatible shape for any pre-existing base table. The authority check does not compare `public.nspowner` only to `current_user`, because PostgreSQL 15 may use `pg_database_owner`. A conflict stops the transaction rather than altering the table. It uses discrete `psql` arguments and a secure password prompt; `PGPASSWORD` is process-scoped and restored, and temporary SQL is removed in `finally`.

The bootstrap is intentionally narrow: no seed data, broad grants, M024–M030 apply, migration-history writes, destructive operation, or staging/production path is included.

## Post-bootstrap verification

[postflight-m024-prereqs-local.ps1](../scripts/postflight-m024-prereqs-local.ps1) is read-only and requires the exact typed confirmation `LOCAL POSTBOOTSTRAP M024 PREREQS`. It uses `BEGIN READ ONLY` and `ROLLBACK`, and produces compact evidence only. Required successful evidence includes:

```text
PASS|SCHEMA|public|exists
PASS|SCHEMA|public|authority_ok
PASS|ROLE_BASELINE|required_roles_present
PASS|UUID_FUNCTION|gen_random_uuid_available
PASS|BASE_TABLES|m024_minimum_shape_present
PASS|MIGRATION_HISTORY|chain_absent
PASS|OBJECT_STATE|protected_objects_absent
PASS|RPC_STATE|protected_objects_absent
PASS|DECISION|READY_FOR_M024_LOCAL_APPLY_REVIEW
```

It emits a `BLOCKED` line and does not pass if any prerequisite is absent/incompatible, any migration history is present, or any M024–M030 protected table/RPC is already present. Neither script prints a password, connection string, URL, token, secret, raw environment value, or raw catalog output.

## Stop conditions

Stop without retrying M024 if the host, port, user, confirmation, or disposable-name guard fails; `psql` is unavailable; the `public` schema is missing and cannot be safely created locally; its effective `USAGE`/`CREATE` authority is insufficient; extension creation or UUID verification fails; an existing base table conflicts; a migration/history/protected-object collision exists; a destructive action or unsupported contract would be required; or compact evidence cannot be produced.

## Next gates

1. Independent review of this source-only package.
2. Commit after explicit approval.
3. Separate user approval for local bootstrap execution.
4. User runs the bootstrap script.
5. User runs post-bootstrap verification.
6. Rerun M024–M030 read-only preflight.
7. Obtain separate approval before retrying local M024–M030 apply.
8. Run local postflight after a successful apply.

Nothing here authorizes staging, production, runtime adoption, routes/UI, M030/live readiness, approval execution, merchant activation, collection unlock, or payment/provider/checkout/subscription/invoice/storefront behavior.
