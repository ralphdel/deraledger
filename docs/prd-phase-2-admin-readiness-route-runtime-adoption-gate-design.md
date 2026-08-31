# Phase 2 Admin Readiness Route and Runtime Adoption Gate Design

## Objective

Design the safe gate for adopting the completed Supabase durable security storage into admin readiness route and runtime behavior.

## Prerequisite Evidence

This gate may proceed only because the following evidence already exists and has been committed:

- the durable security storage completion checkpoint is committed
- local durable security validation passed
- staging durable security validation passed
- production durable security validation passed
- the production route flag remains disabled
- no route or runtime adoption has occurred yet
- no admin UI release has occurred yet

## Adoption Boundary

This gate is only for the following future adoption scope:

- CSRF durable issuer and storage runtime wiring
- throttle durable decision runtime wiring
- route security composition using the completed durable stores
- admin readiness `issue` and `snapshot` route readiness

This gate explicitly excludes:

- M030 or live readiness issuance
- approval execution
- merchant activation
- collection unlock
- payment, provider, checkout, subscription, invoice, or storefront behavior
- admin UI public release

## Source Design Requirements

Any future source implementation under this gate must satisfy all of the following:

- use the approved Supabase durable RPCs and not Redis or Upstash
- keep the Redis and Upstash path deferred and inactive unless separately approved
- preserve the disabled-by-default route flag behavior
- keep route code fail-closed when environment, configuration, or durable storage is unavailable
- preserve `service_role`-only database access
- never expose `service_role` to the browser or any client runtime
- use server-only modules for all durable security storage calls
- preserve CSRF synchronizer-token and session-binding behavior
- preserve route throttling behavior
- preserve CORS and origin checks
- preserve redacted logging
- preserve opaque client-visible error responses
- avoid raw token, JWT, cookie, header, or user metadata persistence

## Route Flag and Environment Gate

Any future adoption package must include a separate environment and route-flag review before enablement:

- review `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED`
- review allowed origin values and route-origin assumptions
- review deployment origin and domain assumptions
- preserve staging and production separation
- keep the route flag unset or false until explicit approval
- keep route flag enablement separate from source merge

## Runtime Smoke Criteria After Future Enablement

Any future controlled enablement must define and pass smoke checks for all of the following:

- disabled routes return a safe unavailable response before enablement
- the CSRF issue route works only with a valid admin session
- the snapshot route requires a valid CSRF token
- invalid or missing CSRF is denied
- throttling returns the expected safe response
- a bad origin is denied
- a non-admin actor is denied
- service unavailable conditions map to opaque responses
- no secrets or raw diagnostics leak to logs or responses
- route flag state remains auditable

## Evidence Requirements

All later adoption evidence must remain compact and redacted:

- `PASS`, `FAIL`, `BLOCKED`, and `SKIPPED` only
- no passwords
- no tokens
- no cookies
- no JWTs
- no headers
- no connection strings
- no service keys
- no raw database diagnostics

## Rollback and Disable Posture

The future route and runtime adoption package must preserve the following rollback posture:

- the primary rollback for route adoption is route flag disablement
- source rollback is secondary and only if separately needed
- the durable database storage remains applied
- no production database rollback is needed for a route enablement failure
- no business data rollback is involved

## Success Criteria

This adoption gate passes only if all of the following remain true:

- the source design and source review pass
- the route flag remains disabled until explicit approval
- staging source smoke checks pass before any production enablement decision
- production route enablement is separately approved
- no forbidden business behavior occurs
- logs and evidence remain redacted

## Remaining Gates After This Design

1. Implement the source-only route and runtime adoption package.
2. Complete independent source review of the adoption package.
3. Complete staging environment review.
4. Obtain staging route flag enablement approval.
5. Run staging smoke checks.
6. Complete production environment review.
7. Obtain production route flag enablement approval.
8. Run production smoke checks.
9. Complete the admin UI integration and release gate.
10. Complete the separate M030 and live-readiness gate.

## Forbidden Next Actions Without Separate Approval

- do not enable routes
- do not adopt runtime code without review
- do not release admin UI behavior
- do not issue M030 or live readiness traffic
- do not execute approval
- do not activate merchants
- do not unlock collection
- do not touch payment, provider, checkout, subscription, invoice, or storefront behavior
