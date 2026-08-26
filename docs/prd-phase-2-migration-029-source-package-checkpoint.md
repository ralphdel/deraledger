# Migration 029 canonical workspace-linkage source package

Date: 2026-08-26

## Status

Migration 029 source exists only. It has not been executed locally, on staging,
or in production. It adds no runtime call site and does not alter M026, M027,
or M028 RPC bodies.

## Scope

`20260826_00_canonical_workspace_linkage.sql` proposes one additive,
approval-owned table, `merchant_canonical_workspaces`, and one narrow
service-role-only reconcile RPC:

`reconcile_canonical_merchant_workspace_link_v1(uuid, uuid, text)`.

The table makes a merchant/workspace relationship authoritative only after a
proven workspace candidate is linked to the same merchant by a composite
foreign-key proof. It stores an immutable link version, reconciling actor, and
server-owned reconciliation idempotency key. It does not trust or update the
historical nullable `merchants.workspace_id` pointer.

## Safety and security

Before DDL, M029 requires exact historical workspace facts: UUID identity
columns, a count-one `workspaces.merchant_id` unique constraint, and exactly
one validated cascade FK to `merchants.id`. Missing or incompatible facts fail
before schema creation. It adds a supporting unique `(workspaces.id,
merchant_id)` index only after these catalog checks pass.

The new table has RLS enabled/not forced. `PUBLIC`, `anon`, and
`authenticated` receive no table or function access. The reconcile RPC is
`SECURITY INVOKER`, has a hardened `pg_catalog, public` search path, and is
executable only by `service_role`. Its safe result codes cover invalid payload,
missing merchant/reconciler/workspace, ambiguous state, exact replay,
idempotency mismatch, conflict, and an opaque write failure.

The reconciler inserts only a new canonical-link row. It never updates or
deletes merchants, workspaces, compliance profiles/events, M028 requests, or
operational data. Installation creates no canonical-link rows and performs no
automatic backfill.

The source verification was repaired before local rehearsal: preflight and the
migration guard now verify service-role-only execute for both M028 RPCs; the
supporting-index name is rejected if it exists with an incompatible definition;
and postflight uses `to_regclass`/`to_regprocedure` gates so a missing M029
object produces FAIL rows and summary FAIL rather than an inspection error.
Postflight also requires the exact reconcile `(uuid, uuid, text)` signature.
Both M029 verification outputs wrap the result-plus-summary `UNION ALL` in an
outer `output_rows` CTE before applying the summary-last sort expression. This
avoids PostgreSQL's invalid direct `UNION ... ORDER BY CASE` form while
preserving compact PASS/FAIL output.

The verification and migration guard resolve named roles with `to_regrole` and
use OID-gated privilege checks. `PUBLIC` is inspected only through expanded
function/table ACLs where grantee OID `0` denotes the pseudo-role. A missing
browser role is treated as no direct grant; a missing `service_role` remains a
clear fail-closed prerequisite failure.

The local rehearsal runner captures each `psql` stage with `Start-Process`,
using a resolved executable path and argument array plus separate stdout/stderr
files. It combines and records labelled evidence before applying exit-code and
verification-row checks. This local harness detail supports paths with spaces
and prevents harmless idempotent-install `NOTICE` lines from becoming
PowerShell `NativeCommandError` failures; it neither changes M029 SQL nor
weakens `ON_ERROR_STOP`, nonzero-exit, or `FAIL`-row handling.

## M028 boundary

M029 deliberately leaves M028 issue/snapshot RPCs unchanged. Postflight must
prove they still return safe workspace-linkage-unavailable results. A separate
reviewed integration migration is needed before M028 can derive a workspace or
return `ready`.

## Explicit non-goals

This source package does not approve compliance, activate a merchant, unlock
collection, set setup/live flags, set collection entitlement, or write limits,
payments, providers, checkout, subscriptions, invoices, settlements, or
storefront data. Runtime adoption remains forbidden.

## Next gate

Independently review this source package. If approved, prepare the disposable
local rehearsal harness and first establish the exact historical workspace
schema as a local prerequisite; do not use staging or production as rehearsal.
