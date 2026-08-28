# Admin readiness durable security storage design

Date: 2026-08-28

## Scope

This is a docs-only implementation design for the durable security storage and
session-binding configuration that must precede any admin readiness route
enablement. It creates no code, dependency, environment change, database
migration, route enablement, staging or production action, runtime adoption,
M030 issuance, approval execution, activation, collection unlock, or payment,
provider, checkout, subscription, invoice, or storefront behavior.

## Current blocked state

The approved issue and snapshot routes exist and remain disabled unless
`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED === "true"`. The source-only route
composition now calls the validated CORS policy, CSRF lifecycle, and throttle
seams, but its zero-argument production path deliberately supplies no durable
CSRF storage, no server-derived session-binding reader, and no durable throttle
storage. It therefore fails closed before readiness-service construction even
if a future caller sets the route flag.

Before any separate enablement/release task, the following remain blocked:

- durable CSRF token-record storage selection and implementation;
- a server-derived CSRF session-binding adapter;
- durable, environment-scoped throttle storage and configuration;
- an end-to-end route test using real configured adapters; and
- a staging-only configuration/runbook review after source approval.

## Repository inspection findings

- `package.json` contains Supabase packages and `server-only`, but no Redis,
  Upstash, Vercel KV, or general durable rate-limit/cache client dependency.
- `src/lib/supabase/server.ts` creates a cookie-bound Supabase server client.
  The existing canonical session reader uses that client and calls
  `auth.getUser()`; it intentionally returns only minimal user data and no
  session token or cookie surface.
- The current CSRF storage module provides an interface and a clearly labelled
  in-memory implementation for test/development only. It is not a production
  configuration.
- The throttle configuration module provides only a narrow storage interface
  and validates a 64-hex derived subject hash plus an environment-prefixed
  namespace. It intentionally has no durable backend.
- The repository has a business-specific Supabase
  `verification_rate_limits` pattern. It is not a suitable reuse candidate:
  it is merchant/KYC-domain storage, carries different authority and retention
  assumptions, and an admin readiness use would require a separately reviewed
  schema, migration, RLS/RPC, retention, and operational model.

## Recommended durable storage approach

Use one reviewed, server-only, managed Redis/KV-compatible provider for the
CSRF and throttle records, with distinct environment-qualified namespaces and
least-privilege credentials. This is the recommended path because no such
provider/client already exists in this repository and it avoids reusing
merchant/business tables for platform-admin security controls.

The future provider selection must be documented and independently reviewed
before its dependency or credentials are added. It must support atomic TTL
writes and atomic throttle decisions. If the selected provider cannot provide
those guarantees, it is not suitable for this package.

### CSRF records

Persist only the existing record projection:

- SHA-256 token digest;
- SHA-256 session-binding digest;
- operation and method;
- expiry epoch.

The raw CSRF token, raw session/auth token, cookie, JWT, header, email, user
ID, metadata, and authority claim must never be persisted in the record, key,
log, or response. TTL must be set by the provider to the same bounded expiry
used by the lifecycle helper. Token rotation must create the replacement before
removing the old record; logout/session replacement invalidation must delete
records by the binding digest.

### Throttle records

Use an atomic fixed-window or reviewed sliding-window provider primitive keyed
only by the already approved tuple:

- environment namespace;
- operation (`issue` or `snapshot`); and
- 64-hex server-derived subject hash.

No raw token, cookie, header, full email, full user ID, IP history, full body,
or metadata may be a storage key or value. The adapter returns only allow,
rate-limited, or unavailable; it must not return counters, namespace, subject,
provider diagnostics, or retry data unless a separate response review permits
one bounded safe retry hint.

### Environment separation

Use physically or logically separate provider credentials/namespaces for
production, staging, preview, and local. Production may use only the
production namespace and credentials. Staging/preview/local must not share or
silently fall back to production storage. In-memory CSRF or throttle storage is
allowed only in explicit test/development seams and is forbidden for production.

Missing configuration, unsupported namespace, provider unavailability,
malformed records/results, or thrown provider errors must remain fail closed.
There is no implicit in-memory, database, or permissive fallback.

## Server-derived CSRF session-binding design

The session-binding adapter must be a narrow server-only module. It must first
obtain the authenticated user through the cookie-bound Supabase server client
and `auth.getUser()`. That call remains the authentication source; the adapter
does not grant reviewer authority and does not replace the reviewer resolver.

The current minimal session reader intentionally exposes no session identifier,
so the future adapter must not substitute user ID alone as a session binding.
Instead, after the server has validated the current user with `auth.getUser()`,
derive an opaque binding reference from a per-session server-visible auth
credential fingerprint using a server-only HMAC/keyed hash. The raw credential
or JWT must be used only as server-side derivation input and never trusted as
authority, returned, logged, stored, or exposed to the browser. The adapter
returns only the bounded opaque binding reference required by the existing
CSRF lifecycle.

This design means logout, cookie replacement, or session refresh/replacement
changes the binding and invalidates old CSRF evidence. The logout flow must
clear the binding's CSRF records when it has the old derived reference; where
that is unavailable, the old record's short TTL plus the new binding mismatch
still denies reuse. Session replacement must require CSRF token refresh rather
than preserving an old token. Metadata changes may require fresh authentication
for reviewer authority, but metadata is never a CSRF binding input or
authority source.

Cookies, headers, origin, CSRF tokens, JWT payload fields, and raw metadata are
not authority. The authority sequence remains:

`auth.getUser() -> session reader -> reviewer resolver -> app_metadata.is_super_admin === true`

`user_metadata` remains non-authoritative.

## Configuration boundaries

- Provider endpoints and credentials are server-only environment values. They
  must not use `NEXT_PUBLIC_` names, be sent to clients, be logged, or appear
  in API responses.
- No service-role key, `sb_secret_` key, browser-exposed JWT, or Auth Admin
  capability is required for this storage package.
- The existing environment policy remains the source of deployment/origin
  validation: production must use `https://admin.deraledger.com` and a
  production Supabase label; `deraledger.com/admin` is never a fallback.
- The configuration factory must reject production-to-staging/preview/local
  storage mismatches and staging/preview/local-to-production mismatches before
  constructing route security adapters.
- Origin/domain, CSRF, and throttle are defense-in-depth only; none may
  authorize a reviewer or override the zero-argument readiness service factory.

## Required next implementation files

The future code task should propose, and separately approve, these files:

- `src/lib/compliance/server/admin-readiness-csrf-session-binding.ts`  -  narrow
  cookie-bound, server-derived binding adapter;
- `src/lib/compliance/server/admin-readiness-csrf-durable-storage.ts`  -  durable
  CSRF storage implementation of the existing interface;
- `src/lib/compliance/server/admin-readiness-throttle-durable-storage.ts`  - 
  atomic environment-scoped throttle implementation;
- `src/lib/compliance/server/admin-readiness-route-security-config.ts`  - 
  zero-argument server-only configuration factory that validates environment
  policy and constructs the three adapters;
- `src/lib/compliance/server/admin-readiness-route-security-composition.ts`  - 
  narrow update to consume only that configuration factory; and
- focused adapter/configuration and route integration tests.

The provider SDK/client should be added only after its security and operational
review. No database migration is part of the recommended provider-backed path.

## Required tests for the next code task

- configured durable adapters allow a matching valid origin, CSRF token, and
  throttle result;
- missing, malformed, unavailable, or throwing CSRF/throttle storage denies
  before readiness service construction;
- CSRF session mismatch, expiry, rotation, logout invalidation, and session
  replacement invalidate old evidence;
- throttle rate-limited maps safely and blocks service construction;
- environment/namespace mix-ups and public-secret configuration are rejected;
- disabled routes never construct the factory, even when configured adapters
  are available;
- an enabled test-only configuration reaches only `service.issue` for issue or
  `service.readSnapshot` for snapshot after every gate passes;
- responses/logging do not reveal token, binding digest, provider key,
  credential, headers, cookies, JWT, metadata, diagnostics, or raw errors; and
- no approval execution, activation, collection unlock, or commercial behavior
  is introduced.

## Explicit forbidden actions until later review

- Do not set `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=true`.
- Do not test live M030 readiness issuance.
- Do not execute final approval, activate merchants, or unlock collection.
- Do not add payment, provider, checkout, subscription, invoice, or storefront
  behavior.
- Do not add a provider dependency, provider credentials, database migration,
  route release, staging configuration, or production configuration under this
  design-only task.

## Recommended next implementation prompt summary

Implement a narrow, server-only durable-security configuration package using a
separately reviewed managed Redis/KV provider. Add a server-derived
session-binding adapter after `auth.getUser()` validation, durable CSRF and
atomic throttle adapters with strict environment namespaces, and a zero-argument
configuration factory consumed by route composition. Keep the route flag
disabled, test all fail-closed and configured paths, and submit source review
before any staging-only configuration review.
