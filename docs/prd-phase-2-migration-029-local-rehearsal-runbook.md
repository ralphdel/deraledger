# Migration 029 local rehearsal runbook

## Scope and boundary

This is a future local-disposable rehearsal plan only. Do not run it on
staging or production. Migration 029 must not be applied until its source and
the eventual harness have passed independent review.

The disposable baseline must include M024--M028 plus the exact historical
`public.merchants`/`public.workspaces` schema contract that M029 validates.
M024--M028 alone intentionally do not establish that workspace prerequisite.
The harness must construct the proven historical schema from canonical source,
not an app-layer approximation or guessed columns.

## Required sequence

1. Create a fresh explicitly named disposable PostgreSQL database.
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
postflight PASS, complete behavior/rollback PASS, hostile-grant PASS, and no
forbidden writes. Only then may a separately approved staging preflight be
considered. Runtime adoption and collection unlock remain out of scope.
