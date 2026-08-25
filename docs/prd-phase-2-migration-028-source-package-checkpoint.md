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

## Next gate

Independent source review is required before a local disposable rehearsal
harness is created or run. Staging and production remain out of scope until
source review, local preflight/apply/rerun/postflight, behavior, hostile-role,
and rollback rehearsal all pass.
