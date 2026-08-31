# Phase 2 Admin Readiness Route/Runtime Adoption — Source Checkpoint

## Objective

Record the source-only adoption of the validated Supabase durable CSRF and
throttle RPC substrate into the admin-readiness route-security composition.
This checkpoint does not authorize route enablement or any runtime release.

## Source changes

- `src/lib/compliance/server/admin-readiness-route-security-config.ts` now
  constructs a private, server-only Supabase service-role RPC client only when
  complete server configuration is present, and provides the same durable
  storage instance to a server-only CSRF issuer.
- `src/lib/compliance/server/admin-readiness-csrf-durable-storage.ts` now maps
  the reviewed CSRF RPCs: create, read, rotate, and binding invalidation.
- `src/lib/compliance/server/admin-readiness-throttle-durable-storage.ts` now
  maps fixed-window decisions to `decide_admin_readiness_throttle_v1`.
- The issue and snapshot routes check their disabled-by-default flag before
  request parsing, security context reads, durable storage calls, or readiness
  service construction.
- `createAdminReadinessRouteSecurityComposition()` now exposes the reachable
  server-only `issueCsrfToken` lifecycle seam. It requires approved origin,
  server-derived super-admin authority, session binding, and throttle approval
  before calling the durable issuer. The seam independently permits this work
  only when `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED === "true"`; all other
  values fail closed before origin, authority, context, throttle, issuer, or
  durable-storage work.

## Security posture

- The active durable runtime path is Supabase RPCs only.
- Redis/Upstash source remains deferred and inactive; it was not deleted.
- Service-role use is confined to server-only modules and is not exposed to a
  browser or client component.
- Missing configuration, client creation failure, RPC errors, and malformed RPC
  results map to existing opaque fail-closed outcomes.
- The adapters send only digests and approved operational fields. They do not
  persist or log raw CSRF tokens, JWTs, cookies, headers, user metadata, or
  provider diagnostics.
- No cleanup scheduler, cron, or automation was added. The cleanup RPC is not
  invoked by this runtime package.

## CSRF lifecycle reachability

The prior issuer-reachability blocker and follow-up route-flag seam blocker are
repaired. The zero-argument runtime
composition reaches `createAdminReadinessCsrfIssuer`, which reaches
`create_admin_readiness_csrf_token_v1` through the durable Supabase adapter.
The composition method does not expose a generic client and is unavailable on
missing configuration, failed authority/session checks, throttle failure, or
issuer failure.

Rotation and binding invalidation remain available only through the same
server-only issuer lifecycle seam. No HTTP delivery endpoint, scheduler, or
logout hook is added by this source-only package; any such delivery/lifecycle
integration requires a later reviewed gate. Routes remain disabled and do not
invoke the seam while the flag is absent or false.

## Validation

- `npx tsx tests/admin-readiness-route-runtime-adoption.test.ts` — PASS
- `npx tsx tests/admin-readiness-routes.test.ts` — PASS
- `npx tsx tests/admin-readiness-route-composition.test.ts` — PASS
- `npx tsx tests/admin-readiness-durable-security-adapters.test.ts` — PASS
- `npx tsc --noEmit` — PASS
- `git diff --check` — PASS (non-blocking LF/CRLF normalization warnings only)

## Scope and current state

- Source-only: no DB, local DB, staging, production, environment, provider, or
  release action occurred.
- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` was not set and remains disabled
  by default.
- No route was enabled; no runtime release, M030/live readiness, approval
  execution, merchant activation, collection unlock, or payment/provider/
  checkout/subscription/invoice/storefront behavior was added.

## Remaining gates

1. Independent source review.
2. Staging environment review.
3. Staging route-flag enablement approval.
4. Staging route smoke checks.
5. Production environment review.
6. Production route-flag enablement approval.
7. Production route smoke checks.
8. Admin UI integration/release gate.
9. M030/live-readiness gate.
