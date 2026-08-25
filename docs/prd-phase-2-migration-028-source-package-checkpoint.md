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

The issue and snapshot RPCs validate profile/state compatibility, but remain
intentionally blocked on workspace derivation. They return only safe
workspace-linkage-unavailable results until a separately reviewed canonical
workspace-linkage package exists; they do not issue a request or return ready.

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
search path, browser denial, and service-role execute grant. Local preflight
proved that neither `merchants.workspace_id` nor `workspaces.id` is an
established M024--M027 rehearsal-baseline prerequisite. The repaired package
does not reference `public.workspaces`, create a workspace foreign key, or
backfill a merchant pointer. Its nullable request `workspace_id` is future
metadata only; issue and snapshot fail closed with a safe
workspace-linkage-unavailable result and cannot become ready.

Postflight now verifies new-table RLS/not-forced state, exact service-role
table privileges, browser denial, required request constraints/index, and the
no-update/no-delete service-role posture. It also verifies that the M028
function definitions contain neither local diagnostic instrumentation nor
forbidden writes.

## Next gate

Independent re-review is required before local installation/security rehearsal
is rerun. A future workspace-linkage package must be designed, reviewed, and
rehearsed before M028 can issue canonical requests or return ready snapshots.
Staging and production remain out of scope until those gates pass.
