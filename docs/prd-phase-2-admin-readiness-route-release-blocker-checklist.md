# Admin readiness route release blocker checklist

Date: 2026-08-28

## Scope

This is a docs-only release blocker checklist for the disabled-by-default
admin readiness issue and snapshot routes. It creates no code, route change,
environment change, database action, runtime adoption, approval execution,
activation, collection unlock, or commercial payment behavior.

## Current committed safe state

The following state is already committed and is the only approved posture on
2026-08-28:

- the issue and snapshot route files exist
- both routes are disabled by default
- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` is not approved for production
  enablement
- no production release is authorized
- no runtime adoption is authorized
- no live M030 readiness issuance is authorized from production
- final approval execution remains separate and unimplemented
- activation and collection unlock remain separate and unimplemented

## Required before enabling the route flag

Every item below must be implemented where required, independently reviewed,
and accepted before `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` can ever be
set to `true` in a live production environment:

- CSRF lifecycle package is implemented and reviewed
- CORS and origin policy implementation is completed and reviewed
- deployment-cookie and environment matrix is verified against the actual
  admin deployment shape
- throttle storage and configuration are implemented and reviewed
- logging and response redaction are verified in code and review
- route import boundary is re-verified
- response mapping is re-verified against the approved allowlist contract
- production environment separation and configuration are reviewed
- route release review is completed after the above gates pass together

These are release blockers, not optional hardening items.

## Explicit forbidden actions until all gates pass

Until every blocker above is complete and accepted:

- do not set `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=true` in production
- do not test live M030 readiness issuance in production
- do not execute final approval behavior
- do not activate any merchant
- do not unlock collection
- do not introduce payment, provider, checkout, subscription, invoice, or
  storefront behavior through these routes

## Recommended next implementation gate

The next safe gate sequence is:

1. Implement the CSRF lifecycle source package first.
2. Implement and review the concrete CORS and environment configuration path.
3. Implement and review throttle storage and configuration.
4. Re-run release-focused review covering logging/redaction, import boundary,
   response mapping, and production environment readiness.

This sequence keeps the highest-risk request-safety controls in front of any
future enablement discussion.

## Separate future work

The following remain outside this release checklist and must stay separate:

- final approval execution route
- activation route and activation gate
- collection unlock and collection-limit runtime behavior
- admin UI or admin portal product wiring
- future RBAC and staff-management surfaces

## Gate decision

Source-only route implementation is already complete, but route release is
still blocked.

The next implementation work may continue only on the remaining safety gates.
No route flag enablement, runtime adoption, or production release decision is
approved by this checklist.

## Safe next step

Implement the CSRF lifecycle source package first, then move through CORS and
environment configuration, throttle storage/configuration, and the final route
release review in that order.
