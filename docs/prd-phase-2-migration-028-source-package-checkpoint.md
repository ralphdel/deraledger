# Migration 028 canonical approval snapshot/idempotency source package

Date: 2026-08-25

## Status

Migration 028 source exists only. It has not been executed on a local, staging,
or production database, and it adds no runtime call site.

## Scope

`20260825_02_canonical_approval_snapshot_idempotency.sql` proposes two additive
tables: immutable published policy versions and server-owned approval decision
requests. It proposes only two service-role-only RPCs:

- `issue_canonical_approval_decision_request_v1(uuid,uuid,text,text,text)`
- `read_canonical_approval_snapshot_v1(uuid)`

The issue RPC derives profile/source/workspace facts, validates policy and
transition compatibility, and generates an opaque idempotency key. The snapshot
RPC re-reads the same facts and returns ready or exact replay-candidate facts
only when all current relationships are internally consistent.

## Security and safety

Both functions are `SECURITY INVOKER`, use `pg_catalog, public` search paths,
and revoke execute from PUBLIC/anon/authenticated before granting only
`service_role`. New tables have RLS enabled, no browser policies, and no browser
table grants. The source package has no diagnostic SQL-error exposure.

It does not update M026/M027, compliance profiles, reviews, cases, events,
merchants, workspaces, subscriptions, invoices, payments, providers, limits, or
storefront state. It cannot set setup/live flags, collection entitlement, or
`activation_status='active'`.

## Source repair before local rehearsal

The first independent review identified three source blockers. The package now
fails closed unless a pending/needs-attention profile status matches its plan:
Solo Lite accepts only `lite_pending`/`needs_attention`, Solo Plus only
`enhanced_pending`/`needs_attention`, and Business only
`business_pending`/`needs_attention`. Cross-plan pending states cannot issue a
canonical request or return a ready snapshot.

Preflight now validates M025's exact bootstrap signature, SECURITY INVOKER
search path, browser denial, and service-role execute grant. The initial M028
source incorrectly required `merchants.workspace_id`; the local preflight
proved that column is not present. The repaired package instead requires the
actual canonical relationship: a unique, FK-backed
`workspaces.merchant_id -> merchants.id` row. Issue and snapshot derive that
one workspace directly and fail closed when it is absent or ambiguous; M028
does not create or backfill a merchant workspace pointer.

Postflight now verifies new-table RLS/not-forced state, exact service-role
table privileges, browser denial, required request constraints/index, and the
no-update/no-delete service-role posture. It also verifies that the M028
function definitions contain neither local diagnostic instrumentation nor
forbidden writes.

## Next gate

Independent re-review is required before a local disposable rehearsal harness
is created or run. Staging and production remain out of scope until re-review,
local preflight/apply/rerun/postflight, behavior, hostile-role, and rollback
rehearsal all pass.
