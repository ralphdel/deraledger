# Admin readiness Supabase security migration/RPC source checkpoint

Date: 2026-08-30

## Source-only package

This checkpoint records a source-only SQL migration package. It has not been
connected to a database, applied locally, applied to staging, or applied to
production. It does not change environment values, provider configuration,
route wiring, runtime adoption, or production release. The admin-readiness
routes remain disabled unless the separately controlled route flag is later
reviewed and enabled.

The migration creates only these service-only security objects:

- `public.admin_readiness_csrf_tokens`;
- `public.admin_readiness_csrf_binding_index`;
- `public.admin_readiness_throttle_windows`;
- `public.create_admin_readiness_csrf_token_v1`;
- `public.read_admin_readiness_csrf_token_v1`;
- `public.rotate_admin_readiness_csrf_token_v1`;
- `public.invalidate_admin_readiness_csrf_binding_v1`;
- `public.decide_admin_readiness_throttle_v1`;
- `public.cleanup_admin_readiness_security_storage_v1`.

## Security and Free-tier posture

The tables contain only bounded digest-based CSRF state and fixed-window
throttle state. They contain no raw CSRF token, JWT, cookie, header, email,
user ID, metadata, business history, or audit history. RLS is enabled without
browser policies; direct table and RPC access is revoked from `PUBLIC`, `anon`,
and `authenticated`, with exact table/RPC grants only for `service_role`.

The design is bounded for current low-volume internal admin usage: CSRF TTL is
at most 30 minutes, active binding records are capped at four, cleanup batches
are capped at 1,000, and throttle rows are eligible for deletion after at most
a 24-hour buffer. Cleanup proof and table-size evidence are required before a
production migration. Database size approaching 400 MB remains an upgrade and
design-review trigger on Supabase Free tier.

CSRF, throttle, storage, origin, and environment are defense in depth only.
They do not establish reviewer authority. Authority remains
`auth.getUser() -> resolver -> app_metadata.is_super_admin === true`;
`user_metadata` is never authority.

## Local rehearsal and rollout status

Local rehearsal is still pending and requires separate explicit approval. No
credentialed command or database connection was created or run by this source
package. Before any user-run local rehearsal, first run the mandatory local
identity, hostile-state, structural, behavior, security-manifest, rollback,
and cleanup proof checks from the database migration safety runbooks. A
postflight must include a table-size query and prove cleanup deletes only
expired security state.

Staging and production remain untouched. They require separate user-controlled
preflight, migration, postflight, and approval gates after local evidence.

## Rollback order

Keep the route flag disabled. Revoke execute from the six exact RPC signatures,
drop the six exact RPCs, revoke `service_role` table privileges, then drop only
the three `admin_readiness_*` security tables. Verify no grants, policies,
overloads, or residual security objects remain. Never drop or mutate a
business table.

## Boundaries and next step

This package does not issue M030 readiness requests, execute final approval,
activate merchants, unlock collections, or introduce payment, checkout,
subscription, invoice, provider, or storefront behavior. Redis/Upstash remains
deferred as a future scale path and is not removed by this package.

The next safe step is an independent source review. Only after approval may the
user choose to run a local disposable rehearsal; staging/prod work, route
enablement, and runtime adoption remain separately gated.
