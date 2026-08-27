# Migration 030 M028/M029 readiness integration source package checkpoint

Date: 2026-08-27

## Status

This source-only package prepares the next additive approval-context migration.
It has not been executed against a local, staging, or production database.
Runtime adoption remains forbidden and collection remains locked.

## Package

- Migration: `supabase/migrations/20260827_00_m028_m029_readiness_integration.sql`
- Preflight: `supabase/staging/preflight/030_m028_m029_readiness_integration_snapshot.sql`
- Postflight: `supabase/staging/postflight/030_m028_m029_readiness_integration_verify.sql`
- Static regression: `tests/m028-m029-readiness-integration-schema.test.ts`

## Scope

Migration 030 adds only these service-role-only v2 RPCs:

- `issue_canonical_approval_decision_request_v2(uuid,uuid,text,text,text)`
- `read_canonical_approval_snapshot_v2(uuid)`

M028 v1 issue/snapshot RPCs are not replaced. Their installed
workspace-linkage-unavailable behavior remains the compatibility-safe
fail-closed path.

V2 derives the merchant from the profile, re-reads exactly one M029 canonical
link, and re-proves `(workspace_id, merchant_id)` ownership through the M029
workspace composite proof. A missing, stale, ambiguous, broken, or conflicting
link returns only a safe non-ready result. A valid link is necessary but not
sufficient: profile/source/status, policy, row version, reviewer, target/reason,
and request idempotency checks still apply.

## Security and writes

Both v2 RPCs use `SECURITY INVOKER` and a hardened search path. Their execute
privilege is revoked from `PUBLIC`, `anon`, and `authenticated` and granted
only to `service_role`. The guard and preflight require the minimal
service-role reads needed by the invoker implementation, including the M029
link/workspace proof and M028 request insert.

The only permitted v2 write is a new immutable M028
`approval_decision_requests` row after every gate passes. The package does not
reconcile or mutate canonical links, merchants, workspaces, profiles, events,
limits, payments, providers, checkout, subscriptions, invoices, or storefront
data.

It does not approve compliance, call the M026 approval RPC, activate a
merchant, unlock collection, set setup/live flags, set collection entitlement,
or set `activation_status='active'`.

## Verification posture

Preflight rejects missing or unsafe M026/M028/M029 prerequisites, role grants,
RLS/policy drift, browser access, ownership constraints, and conflicting v2
overloads with compact FAIL rows rather than unsafe catalog failures. The M029
ownership manifest is structural: it verifies the named support index is a
non-partial unique `public.workspaces (id, merchant_id)` index using ordered
`pg_index.indkey` expansion, and verifies the canonical link merchant primary
key, unique workspace key, and composite ownership FK columns, target columns,
and `NO ACTION`/`RESTRICT` actions.

Postflight verifies exact v2 signatures, M028 v1 preservation, the same exact
M029 authority structure, security/grants, no diagnostics, safe result-code
vocabulary, forbidden-write absence, and zero new M028 request/M029 link rows
from installation.

The matching local-only harness also snapshots known optional subscription,
provider/settlement, checkout, and storefront relations using `to_regclass`
before behavior execution. Absent historical relations are recorded safely;
present relations must have unchanged row counts after the behavior matrix.

## Next gate

Independently review the source-only disposable local harness before executing
it. Staging and production remain out of scope until the separately approved
local rehearsal passes.
