# Phase 2 Admin Readiness Staging Route Re-Enable Approval After Env Clearance

## Objective

Approve readiness for the next separate staging-only action: change
`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` from `false` to `true` in the
Vercel staging or preview target.

## Prerequisites

- HTTP CSRF issuance-flow repair committed.
- Independent source review approved.
- Exact-deployment env blocker cleared.
- Staging redeployed after env fix.
- Route flag currently `false`.
- No smoke retry yet.

## Approval Boundary

This approval is staging or preview only.

- Only `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=false` to `true` is in
  scope.
- Production is excluded.

## Post-Enable Smoke Plan

After enablement, staging smoke should verify:

- `POST /api/internal/admin/compliance/readiness/issue` returns a CSRF token
  for a valid staging super-admin flow.
- `POST /api/internal/admin/compliance/readiness/snapshot` without CSRF
  returns `400 csrf_denied`.
- `POST /api/internal/admin/compliance/readiness/snapshot` with issued CSRF
  returns a safe snapshot response.
- Bad origin is denied.
- Non-admin is denied.
- Throttle behavior is safe.
- No secrets or logs leak.

## Rollback

If staging re-enable needs to be reversed:

- Set `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=false`.
- Redeploy staging.
- No DB rollback.

## Forbidden Behavior Not Approved

- M030/live-readiness is not approved.
- Approval execution is not approved.
- Merchant activation is not approved.
- Collection unlock is not approved.
- Payment/provider/checkout/subscription/invoice/storefront behavior is not
  approved.
- Production route enablement is not approved.
- Admin UI release is not approved.

## Remaining Gates

1. staging route re-enable
2. staging smoke checks
3. production env review
4. production route-flag approval
5. production route-flag enablement
6. production smoke checks
7. admin UI integration/release
8. M030/live-readiness gate

## Current Safe State

- Production untouched.
- DB untouched.
- No route flag was enabled by this checkpoint.
- No smoke run was performed by this checkpoint.
- No approval execution occurred.
- No merchant activation, collection unlock, or payment/provider behavior is
  authorized here.
