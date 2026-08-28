# Admin readiness route enable/configuration runbook

Date: 2026-08-28

## Scope

This is a docs-only future runbook and design for the route-enable and
configuration package that must be completed before the admin readiness issue
and snapshot routes can be considered for controlled enablement. It creates no
code, route change, environment change, database action, runtime adoption,
production release, M030 issuance, approval execution, activation, collection
unlock, or commercial payment behavior.

## Current blocked state

The current committed state remains intentionally blocked:

- the issue and snapshot route files already exist
- both routes are disabled by default
- the routes still depend on default fail-closed CSRF and throttle primitives
- the newer CSRF lifecycle helpers exist but are not yet wired into the routes
- the newer environment and CORS policy helpers exist but are not yet wired
  into the routes
- the newer throttle configuration and storage seam exists but is not yet
  wired into the routes
- the final route-release review was not approved

No route enablement, runtime adoption, or production release is allowed from
this state.

## Required future composition package

The next implementation package must be a narrow route composition change that
does all of the following without broadening scope:

- wire validated environment and CORS policy into the route CORS primitive
- wire the session-bound CSRF lifecycle into the route CSRF primitive
- wire durable, environment-scoped throttle storage into the route rate-limit
  primitive
- preserve the disabled-by-default route flag
- preserve the rule that a disabled route returns before zero-argument service
  factory construction
- preserve the rule that only the approved readiness service methods may be
  called in the enabled path:
  - `service.issue(...)` for the issue route
  - `service.readSnapshot(...)` for the snapshot route

The composition package is a prerequisite for any future enablement review. It
is not itself authorization to enable the routes.

## Required durable storage decisions

Before any route-enable task can be considered complete, the following storage
decisions must be explicitly made and reviewed:

- the CSRF storage backend for session-bound synchronizer-token records
- the throttle storage backend for environment-scoped throttling state
- production, staging, preview, and local namespace separation for both
  storage categories
- the rule that no in-memory production CSRF storage is allowed
- the rule that no in-memory production throttle storage is allowed
- the operational failure posture for storage unavailability, which must remain
  fail-closed unless a separate bounded degraded-mode review is approved

No database migration, production vendor selection, or live storage rollout is
authorized by this runbook.

## Required security invariants

The future composition package must preserve all of the following:

- origin, domain, and deployment shape are defense-in-depth only, not
  authority
- CSRF evidence is anti-forgery only, not authority
- throttle outcome is abuse-control only, not authority
- authority remains:
  `auth.getUser() -> session reader -> reviewer resolver -> app_metadata.is_super_admin === true`
- `user_metadata` is not authority
- no caller-supplied reviewer, role, authority, user ID, email, metadata,
  JWT, token, cookie claim, header claim, origin claim, or browser idempotency
  field may become authority

## Required tests before any enablement

The future composition package must add and pass tests that prove:

- a disabled route never constructs the readiness service factory
- an enabled route with invalid CSRF denies before service construction or
  service call
- an enabled route with invalid origin or CORS policy denies before service
- an enabled route with unconfigured throttle denies before service
- an enabled route with valid configured gates reaches only the approved
  readiness method:
  - `issue` route reaches only `service.issue`
  - `snapshot` route reaches only `service.readSnapshot`
- no final approval execution behavior is introduced
- no activation behavior is introduced
- no collection unlock behavior is introduced

These tests must remain source-only and must not become live release or
production validation.

## Explicit forbidden actions

Until the composition package is implemented, independently reviewed, and then
followed by a separate release review:

- do not set `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=true`
- do not test live M030 readiness issuance
- do not execute final approval behavior
- do not activate merchants
- do not unlock collection
- do not add payment, provider, checkout, subscription, invoice, or storefront
  behavior
- do not add existing untracked evidence or artifact files to commits
- do not use `git add .`

Future commits for this area must use exact `git add` paths only.

## Recommended next implementation order

The next safe sequence is:

1. Implement the narrow route primitive composition package.
2. Run an independent source review of that composition change.
3. Prepare a staging-only environment and runbook review.
4. Run a final route-release review.
5. Only after all of the above, consider a separate controlled route-flag
   enablement decision.

No step in this sequence authorizes production release by default.

## Safe next step

Create the narrow source-only route composition package that wires the already
implemented CSRF lifecycle, environment/CORS policy, and durable throttle
configuration into the existing disabled-by-default routes, then send that
package for independent source review before any staging or enablement task.
