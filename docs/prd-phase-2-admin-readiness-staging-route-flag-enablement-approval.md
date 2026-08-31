# Phase 2 Admin Readiness Staging Route-Flag Enablement Approval

## Approval objective

Approve readiness to perform a separate staging-only route-flag enablement
action for Phase 2 admin readiness routes.

This checkpoint is docs only. It does not change environment values, enable
the route flag, deploy, run smoke checks, connect to a database, or authorize
production activity.

## Prerequisites satisfied

- Durable security storage validation completed across local, staging, and
  production.
- The route/runtime adoption gate design is committed.
- The source-only route/runtime adoption package is committed.
- Independent source review approved the source-only route/runtime adoption
  package for commit.
- The issuer seam blockers were repaired and independently reviewed.
- The staging environment review checkpoint is committed.
- The staging origin is configured through
  `NEXT_PUBLIC_APP_URL=https://deraledger-staging.vercel.app` and
  `APP_URL=https://deraledger-staging.vercel.app`.
- Staging Supabase URL, anon, and server-only service-role key names are
  present.
- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` is currently present and literal
  `false` in staging.
- No staging smoke checks have run yet.

## Current staging environment state

Record key names only:

- `NEXT_PUBLIC_APP_URL` is present and set to the staging origin.
- `APP_URL` is present and set to the staging origin.
- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` is present and literal `false`.
- The Supabase URL key is present.
- The Supabase anon key is present.
- The server-only Supabase service-role or admin key is present.

No Supabase values, service keys, passwords, tokens, connection strings,
cookies, JWTs, headers, or full environment-file contents are recorded here.

## Approval boundary

This approval is only for the next action:

- Change `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` from literal `false` to
  literal `true` in Vercel staging only.

This approval explicitly excludes:

- Production route-flag enablement.
- Admin UI release.
- M030 or live readiness issuance.
- Approval execution.
- Merchant activation.
- Collection unlock.
- Payment, provider, checkout, subscription, invoice, or storefront behavior.

## Post-enable smoke plan

After staging route-flag enablement, smoke checks must verify:

- The issue route no longer returns the disabled unavailable response for the
  valid staged admin path.
- The issue route still denies a bad origin.
- The issue route still denies a non-admin caller.
- The issue route still enforces throttle behavior.
- The issue route issues CSRF only after valid admin, session, and throttle
  flow.
- The snapshot route requires a valid CSRF token.
- Missing or invalid CSRF is denied.
- Unavailable storage maps to an opaque response.
- No secrets or sensitive logs leak.
- No payment, provider, merchant-activation, collection-unlock, approval-
  execution, or storefront behavior occurs.

## Rollback plan

Primary rollback:

- Set `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=false` in Vercel staging.

No DB rollback is part of this checkpoint. No production rollback is part of
this checkpoint. No business-data rollback is part of this checkpoint.

## Required evidence after enablement

Evidence must be compact and redacted:

- `PASS|...`
- `FAIL|...`
- `BLOCKED|...`
- `SKIPPED|...`

Evidence must not include:

- Secrets.
- Cookies.
- JWTs.
- Headers.
- Environment values other than route-flag true or false status.
- Service keys.
- Raw database diagnostics.

## Remaining gates

1. Staging route-flag enablement.
2. Staging smoke checks.
3. Production environment review.
4. Production route-flag enablement approval.
5. Production route-flag enablement.
6. Production smoke checks.
7. Admin UI integration/release gate.
8. M030/live-readiness gate.

## Current safe state

- Route flag is not enabled by this checkpoint.
- No environment value was changed by this checkpoint.
- No DB, staging DB, or production DB was touched by this checkpoint.
- No staging smoke was run by this checkpoint.
- No production action, admin UI release, runtime release, M030/live
  readiness, approval execution, merchant activation, collection unlock, or
  payment/provider/storefront behavior was performed by this checkpoint.
