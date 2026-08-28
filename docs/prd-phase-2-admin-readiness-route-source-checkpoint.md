# Admin readiness route source checkpoint

Date: 2026-08-28

## Scope

The internal readiness issue and snapshot route files now exist as a
source-only package. They are disabled by default and do not authorize a
production release or runtime adoption.

## Route boundary

The only route files are:

- `src/app/api/internal/admin/compliance/readiness/issue/route.ts`
- `src/app/api/internal/admin/compliance/readiness/snapshot/route.ts`

They compose only the zero-argument canonical approval readiness service
factory and approved admin-readiness security primitives. They do not
construct a Supabase or Auth Admin client, read a service credential, access a
generic RPC or table surface, or accept caller-supplied reviewer authority.

## Disabled-by-default gate

Both routes require the server-only `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED`
gate to equal `true`. The flag is not enabled by this source package. A disabled
gate returns an opaque unavailable response before service construction.

The CSRF and throttle primitives also remain fail-closed until their separate
production dependencies are explicitly configured and reviewed. Enabling the
route flag alone is therefore not a release mechanism.

## Security order

Both routes preserve this order:

1. Server correlation ID
2. Strict JSON parsing and duplicate-key rejection
3. Exact command validation
4. Origin/CORS check
5. CSRF validation
6. Throttle check
7. Disabled-by-default route gate
8. Zero-argument service factory and the requested readiness operation
9. Allowlisted response mapping
10. Redacted operational logging

The authority path remains cookie-bound `auth.getUser()` through the session
reader and reviewer resolver; only `app_metadata.is_super_admin === true` can
be accepted. `user_metadata` is not authority. Future RBAC roles remain
deferred.

## Non-goals and release boundary

This package creates no admin UI, final approval execution, staff or
super-admin management, activation, collection unlock, or commercial payment
behavior. It does not release the routes, adopt runtime behavior, or touch any
database, local environment, staging, or production.

The safe next step is independent source review. Any release remains blocked
on the separately designed deployment-cookie/environment, CSRF, CORS,
throttle, and logging/redaction gates.
