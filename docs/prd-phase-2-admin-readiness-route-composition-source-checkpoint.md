# Admin readiness route composition source checkpoint

Date: 2026-08-28

## Scope

This source-only package composes the existing route CORS, CSRF, and throttle
primitives with their approved environment-policy, synchronizer-token, and
configured-storage seams. It does not enable the routes, change environment
configuration, adopt runtime behavior, release to production, or issue M030
requests.

## Composition boundary

- Route CORS checks now validate the environment policy before checking an
  origin. The exact production origin remains `https://admin.deraledger.com`;
  `deraledger.com/admin`, null origins, and wildcard credentialed CORS are not
  accepted. Local HTTP loopback remains local-only.
- Route CSRF checks now use the session-bound synchronizer-token lifecycle
  through a narrow session-binding-reader seam. Missing binding, storage,
  malformed state, or errors fail closed.
- Route throttling now uses the environment-scoped configured-storage seam.
  Missing, malformed, unavailable, or throwing configuration/storage fails
  closed. No in-memory production configuration is supplied.

The zero-argument route composition intentionally supplies no durable CSRF or
throttle storage. A future reviewed configuration package must provide those
dependencies before an enabled request can progress; the disabled route flag
still prevents readiness-service factory construction first when unset or
false.

## Authority and non-goals

Origin, CSRF, and throttling are defense-in-depth controls and never reviewer
authority. Authority remains `auth.getUser() -> session reader -> reviewer
resolver -> app_metadata.is_super_admin === true`; `user_metadata` is not
authority. Future RBAC/staff roles are deferred.

No direct Supabase/Auth Admin/service-role/RPC/table client is added to routes.
There is no approval execution, activation, collection unlock, or
payment/provider/checkout/subscription/invoice/storefront behavior.

## Safe next step

Submit this source-only composition package for independent source review.
Do not set `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=true`, perform staging or
production enablement, or test live M030 issuance from this checkpoint.
