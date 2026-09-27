# PRD Phase 2B Staging Migration-Ledger Bootstrap Decision Gate

**Status:** SOURCE-ONLY DECISION GATE. This document neither connects to staging nor authorizes SQL, ledger creation, migration application, runtime adoption, an Admin UI release, or any commercial behavior.

## Purpose and current state

The approved user-run staging target proof and connection checks completed, but the following staging preflight evidence was returned:

```text
BLOCKED|MIGRATION_HISTORY_TABLE|missing
BLOCKED|DECISION|STAGING_PREFLIGHT_BLOCKED
```

`supabase_migrations.schema_migrations` is required to reconcile actual target history with the ordered source chain:

```text
M024 -> M025 -> M026 -> M027 -> M028 -> M029 -> M030
```

Its absence is not evidence that the M024-M030 chain is absent. It is an unknown managed-target history state. Therefore M024-M030 apply remains blocked. The M024-M030 apply package must not silently create the `supabase_migrations` schema, the `schema_migrations` table, or any history row.

## Required decision before any future ledger action

This is deliberately a decision gate, not an executable bootstrap design. The repository migrations consume migration-history evidence but do not define the canonical managed Supabase ledger table contract: its exact DDL, owner, permissions, integration with the approved migration runner, and lifecycle are not source-backed here. Existing repository safety guidance also warns against creating or modifying Supabase migration metadata without an approved contract.

Before a later ledger bootstrap gate can create anything, it must obtain and independently review a target-bound, Supabase-supported ledger contract that proves all of the following:

1. the expected schema and table identity are exactly `supabase_migrations.schema_migrations`;
2. the exact schema/table DDL, owner, privileges, and migration-runner integration are authoritative for this staging target;
3. creation by the approved connected role is supported and will not conflict with managed Supabase state; and
4. creating a missing ledger will not overwrite, conceal, or substitute for actual migration history.

Until that contract is available, the only safe conclusion is:

```text
BLOCKED|LEDGER_BOOTSTRAP|contract_unproven
BLOCKED|DECISION|STAGING_PREFLIGHT_BLOCKED
```

Typed target details, a successful user connection, repository source files, or a historical checkpoint are not substitutes for this ledger contract.

## Future ledger-bootstrap boundary (only after the contract and explicit approval)

If a later reviewed gate establishes the authoritative contract and the user separately approves a staging ledger action, its scope may be limited to the following:

- create `supabase_migrations` only when the authoritative contract confirms the schema is missing and creation is supported;
- create `supabase_migrations.schema_migrations` only when the authoritative contract confirms the table is missing and creation is supported;
- **never insert M024-M030 rows**;
- **never mark M024-M030, or any other migration, as applied**;
- never apply M024-M030 as part of ledger creation; and
- emit compact redacted `PASS|...`, `FAIL|...`, or `BLOCKED|...` evidence only.

No custom or guessed SQL is authorized by this document. If the schema exists but the table is absent, if ownership/privileges differ, or if the contract does not cover the exact state, stop rather than attempting a partial repair.

## Required read-only reconciliation before any possible ledger creation

After a fresh target-proof check and explicit user approval for a read-only staging command, the future gate must first prove:

1. expected and observed staging project-ref proof still match, the target is not production, and the route flag remains disabled;
2. whether the ledger schema and table are missing, present, or structurally incompatible;
3. whether any M024-M030 migration-owned table, function, policy, grant, index, constraint, or cleanup/readiness object already exists; and
4. whether any object/history/security state is partial, conflicting, or non-redactable.

The following outcomes are hard stops:

```text
BLOCKED|DRIFT|objects_without_migration_history
BLOCKED|DRIFT|partial_or_conflicting_m024_m030_state
BLOCKED|LEDGER_BOOTSTRAP|contract_unproven
BLOCKED|DECISION|STAGING_PREFLIGHT_BLOCKED
```

For this purpose, “application objects” means M024-M030 migration-owned objects, such as `merchant_compliance_profiles`, their supporting compliance tables, reviewed-profile/approval RPCs, canonical request/snapshot tables, workspace-linkage tables, and M030 readiness RPCs. Existing baseline prerequisites such as `public`, `public.merchants`, `public.invoices`, `public.payment_records`, required roles, and `gen_random_uuid()` are expected target foundations and are not, merely by existing, evidence that M024-M030 was applied.

If any migration-owned M024-M030 object exists while the ledger table is absent, it is drift: do not create a blank ledger, do not insert reconstructed history, and do not apply the chain.

## Evidence and PowerShell posture

Evidence must remain compact and redacted. It must not contain credentials, passwords, connection strings, full URLs, headers, tokens, service-role keys, raw catalog rows, or raw SQL output.

Future PowerShell phase functions must print their compact evidence outside the success stream and return an explicit status separately. Do not use an evidence-emitting function directly inside `if (-not (Invoke-Phase))`, which can swallow its evidence. Use an explicit status variable, for example:

```powershell
$ledgerPreflightOk = Invoke-LedgerPreflight
if ($ledgerPreflightOk -ne $true) { exit 1 }
```

This is a documentation pattern only; it does not create a runnable staging command.

## Required next gates

1. Independent review of this decision gate.
2. Obtain a repository-approved, target-bound Supabase ledger contract and explicit user authorization for a read-only ledger reconciliation.
3. Review compact reconciliation evidence.
4. If and only if the contract and evidence make it safe, separately design and review a ledger-bootstrap source package.
5. Obtain separate user approval before any ledger action.
6. Rerun the staging read-only M024-M030 preflight.
7. Consider M024-M030 staging apply only after a clean ledger-backed preflight and a separate explicit apply approval.

Production remains blocked. Nothing in this gate authorizes runtime adoption, route enablement, M030/live readiness, Admin UI release, approval execution, merchant activation, collection unlock, or payment, provider, checkout, subscription, invoice, or storefront behavior.
