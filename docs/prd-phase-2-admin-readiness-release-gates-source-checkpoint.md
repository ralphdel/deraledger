# Admin readiness release gates source checkpoint

Date: 2026-08-28

## Scope

This source-only package adds explicit environment/CORS policy validation and
a narrow configured throttle-storage seam. It creates no route, does not set
or enable `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED`, and does not authorize
runtime adoption or a production release.

## Environment and CORS gate

Production accepts only the exact `https://admin.deraledger.com` origin.
`https://deraledger.com/admin` is never an admin fallback. Staging and preview
must declare distinct exact HTTPS admin origins and matching Supabase
environment labels. Local development has one narrow exception: exact HTTP
loopback origins on `localhost`, `127.0.0.1`, or `::1` are allowed only when
the declared environment and Supabase label are both `local`. Environment
mixing fails validation. Additional CORS origins are explicit exact origins
only; wildcard and null origins are denied. Origin is browser defense in depth
and is never reviewer authority.

Public browser configuration is checked for server-secret names and
`sb_secret_` values. This package does not read, return, log, or expose a
server credential.

## Throttle gate

The throttle seam takes only an environment-scoped namespace, operation, and a
64-hex-character derived subject hash. It cannot accept tokens, cookies,
headers, email, user IDs, request bodies, or metadata. Missing, invalid,
unavailable, malformed, or throwing storage returns the existing safe
fail-closed throttle result. No in-memory production limiter or external
provider is configured here.

The future route order remains validation, origin/CORS, CSRF, throttle, then
the zero-argument readiness service factory. The throttle neither establishes
authority nor changes the required path of cookie-bound `auth.getUser()`, the
reviewer resolver, and `app_metadata.is_super_admin === true`.
`user_metadata` is not authority. Future RBAC remains deferred.

## Non-goals and release boundary

This package does not wire these gates into the existing disabled routes, make
an M030 request, execute approval, activate a merchant, unlock collection, or
perform payment, provider, checkout, subscription, invoice, or storefront
behavior. It touches no database, staging, or production system.

The safe next step is independent source review, followed by a final route
release review only after reviewed deployment configuration and durable
throttle storage are actually supplied. Route enablement remains blocked.
