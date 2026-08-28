# Admin readiness durable security adapters source checkpoint

Date: 2026-08-28

## Scope

This checkpoint records a source-only implementation of durable admin-readiness
security adapters. It does not create a Redis provider account, credentials,
environment values, database migration, staging or production configuration,
runtime adoption, route enablement, production release, M030 issuance, approval
execution, activation, collection unlock, or payment/provider/checkout/
subscription/invoice/storefront behavior.

Routes remain disabled unless the separately controlled server flag is exactly
`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED === "true"`. This task did not set
or change that flag.

## Implemented source boundaries

- `@upstash/redis` is the only new dependency. `@upstash/ratelimit` was not
  added.
- A server-only Redis command adapter validates complete explicit
  environment/resource/namespace inputs before constructing the SDK client. It
  creates no network traffic on construction and returns no raw provider data.
- A cookie-bound security-context reader calls `auth.getUser()` first. Only
  after that succeeds does it use the current access token as a private HMAC
  input for an opaque CSRF session binding. A separate HMAC key derives a
  stable redacted throttle subject from the server-read user ID.
- The session binding, throttle subject, Origin, CSRF evidence, and throttle
  are defense-in-depth inputs, not authority. Reviewer authority remains
  `auth.getUser() -> resolver -> app_metadata.is_super_admin === true`.
  `user_metadata` is not authority.
- The durable CSRF adapter stores only digest-based records, uses atomic Redis
  scripts for collision-safe creation, rotation, and bounded binding
  invalidation, and enforces the lifecycle expiry.
- The durable throttle adapter uses an atomic fixed-window Redis script keyed
  by environment namespace, operation, and a 64-hex server-derived subject.
  Provider/configuration/malformed-result failures return unavailable and do
  not fall back to in-memory production behavior.
- Route composition now derives the security context internally. Route callers
  cannot provide a CSRF binding, throttle subject, user ID, JWT, cookie,
  metadata, or reviewer authority. The temporary static route throttle hashes
  were removed.

## Preserved boundaries

- Issue and snapshot routes retain the disabled-by-default factory block.
- Route files still use only the zero-argument readiness service factory and
  approved route-security helpers; they construct no Supabase/Auth Admin,
  service-role, RPC, or table client directly.
- Safe response mapping and redacted operational logging are unchanged. No raw
  token, JWT, cookie, header, user ID, provider value, namespace, credential,
  metadata, diagnostics, or provider error is returned or logged.
- No future RBAC/staff role, final approval RPC, activation, collection unlock,
  or commercial behavior was added.

## Verification and next gate

Focused tests use a fake narrow Redis command client. They exercise configured
CSRF issuance/validation, collision handling, rotation, binding invalidation,
session mismatch and HMAC-key replacement denial, throttle allow/rate-limited/
unavailable outcomes, dependency boundaries, and the retained disabled-route
behavior.

The safe next step is independent source review. After that, a separate
staging-only provider/environment configuration and route-release review is
still required before any consideration of route flag enablement. Do not add
provider credentials or use `git add .`; stage only reviewed exact paths.
