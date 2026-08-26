# Migration 029 local rehearsal runbook

## Scope and boundary

This is a local-disposable rehearsal plan only. Do not run it on staging or
production. The source-only harness is
`scripts/rehearse-canonical-workspace-linkage-local.ps1`; it remains dry-run
unless its explicit `-Execute` switch is supplied.

The disposable baseline must include M024--M028 plus the exact historical
`public.merchants`/`public.workspaces` schema contract that M029 validates.
M024--M028 alone intentionally do not establish that workspace prerequisite.
The harness must construct the proven historical schema from canonical source,
not an app-layer approximation or guessed columns.

## Required sequence

1. Create a fresh explicitly named disposable PostgreSQL database named
   `deraledger_m029_disposable_<suffix>`.
2. Apply the local prerequisites and M024--M028 baseline.
3. Establish the exact workspace PK, `merchant_id` FK/cascade, and
   `UNIQUE (merchant_id)` contract required by M029.
4. Run the M029 preflight and stop on any `FAIL` or SQL error.
5. Apply M029 once, rerun it for idempotency, then run postflight.
6. Seed only disposable merchant/workspace/auth rows after installation and
   before hostile-role checks.
7. Run the behavior/rollback matrix. Aggregate scenario results before a final
   fail so all independent failures are visible in one run.

Generated SQL and PowerShell output must be UTF-8 without BOM. Use the
repository's disposable-database, evidence-sanitization, and hostile-role
requirements; do not print credentials or connection strings.
Each executed stage is captured under an untracked local
`local-evidence/migration-029-local-<timestamp>` directory. A failed `psql`
stage stops the harness immediately and identifies the stage label; the final
control line is emitted only after all baseline, M029, and behavior stages
pass.

## Safe local command

Set `PGPASSWORD` only in the current PowerShell process if the local server
requires it; do not place credentials in the repository or connection string.
The command rejects Supabase, staging, production, non-local hosts, and a
database name that does not match the disposable M029 pattern.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\rehearse-canonical-workspace-linkage-local.ps1 `
  -LocalConnectionString 'postgresql://localhost/deraledger_m029_disposable_20260826' `
  -Confirmation 'REHEARSE MIGRATION 029 LOCAL DISPOSABLE DB ONLY' `
  -Execute `
  -PsqlPath 'C:\Program Files\PostgreSQL\15\bin\psql.exe'
```

The owner/admin-only generated baseline creates the local historical contract:
`workspaces.id uuid` primary key, nullable `workspaces.merchant_id uuid`
foreign-keyed to `merchants.id` with cascade deletion, and `UNIQUE
(merchant_id)`. It does not create, repair, or backfill anything outside the
named disposable database.

Before a clean run, include hostile source fixtures for a missing canonical
table, missing/wrong reconcile overload, unsafe M028 issue/snapshot grant, and
a conflicting pre-existing
`merchant_canonical_workspace_supporting_owner_key` index. Preflight/postflight
must report compact FAIL plus summary FAIL without crashing.

## Required behavior matrix

- One merchant with exactly one valid workspace creates exactly one canonical
  link.
- Repeating the exact actor/merchant/workspace/idempotency input returns safe
  replay without another row.
- Reusing an idempotency key with changed actor or merchant fails closed.
- Missing merchant, missing reconciler, zero workspace, duplicate/corrupt
  workspace candidate, cross-merchant workspace, and conflicting pre-existing
  canonical link all fail closed.
- The legacy `merchants.workspace_id` pointer is ignored; no path updates it.
- Duplicate candidate insertion proves the historical unique merchant linkage
  prevents an ambiguous workspace candidate; the reconcile RPC then remains
  fail-closed for unavailable/conflicting state.
- Concurrent/repeated insertion proves the primary/unique constraints prevent
  duplicate merchant or workspace canonical links.
- A late insert failure leaves no partial canonical-link row.
- `anon` and `authenticated` cannot execute the reconcile RPC or access the
  table; `service_role` is the only allowed caller.
- M026/M027 remain unchanged and M028 issue/snapshot remain fail-closed with
  workspace-linkage-unavailable; no approval profile/event mutation occurs.
- No setup/live, activation, collection entitlement, payment, provider,
  checkout, limit, subscription, invoice, settlement, or storefront state is
  changed.

## Pass criteria and next gate

The local evidence must show preflight PASS, first apply PASS, rerun PASS,
postflight PASS, complete behavior/rollback PASS, hostile-grant PASS, no
forbidden writes, and
`CONTROL|LOCAL_CANONICAL_WORKSPACE_LINKAGE_REHEARSAL=PASS`. Only then may a
separately approved staging preflight be considered. Runtime adoption and
collection unlock remain out of scope.

The preflight and postflight output queries intentionally use an outer result
CTE before sorting the summary last. Do not flatten that CTE into a direct
`UNION ALL ... ORDER BY CASE` query: PostgreSQL rejects expression ordering at
that union level.
