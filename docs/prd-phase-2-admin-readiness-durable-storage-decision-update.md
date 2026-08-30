# Admin readiness durable storage decision update

Date: 2026-08-30

## Scope

This is a docs-only Phase 2 storage decision update for admin readiness
durable CSRF and throttle storage. It creates no code, dependency change,
environment change, provider setup, credential creation, database migration,
staging action, production action, runtime adoption, production release, route
flag enablement, M030 issuance, approval execution, activation, collection
unlock, or payment/provider/checkout/subscription/invoice/storefront behavior.

The route flag must remain unset or false:

`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED !== "true"`

## Decision summary

The Phase 2 storage decision is now:

- Supabase-backed durable CSRF and throttle storage is selected for Phase 2
- Upstash/Redis remains technically valid but is deferred
- the admin readiness routes remain disabled by default
- no provider, environment, staging, or production action is authorized by
  this decision update

This decision changes the near-term implementation path, not the current
runtime state.

## Why the decision changed

The decision changed for practical Phase 2 reasons:

- DeraLedger already uses Supabase as an existing platform dependency
- the admin readiness routes are currently low-volume internal routes
- funding and provider-count should be conserved
- adding Upstash now would add another account surface, more environment
  secrets, extra provider monitoring, additional billing surface, and more
  operational complexity
- Supabase-backed storage is sufficient for Phase 2 if it is implemented with
  service-only tables or RPCs and strict fail-closed behavior

This update does not claim that in-memory storage is acceptable. It changes
which durable backend is preferred for Phase 2.

## Durable storage requirement remains

Durable shared storage is still required before any real route enablement. In
memory alone is not enough for live multi-instance route safety.

Durable storage is still needed for:

- CSRF token records
- CSRF rotation
- CSRF invalidation
- expiry and TTL cleanup
- throttle windows and counters
- fail-closed route protection

Changing away from Upstash does not remove any of these requirements.

## Supabase-backed Phase 2 target

The new Phase 2 target is a Supabase/Postgres-backed durable security storage
layer that remains private to approved server adapters.

That target must:

- add service-only admin readiness security tables through a separately
  reviewed migration
- add private RPCs for atomic CSRF create, rotate, invalidate, and throttle
  decisions
- keep browser and public access denied
- keep service-role and server-only use only
- keep route files free of direct table or RPC calls
- keep all storage access behind approved server adapters
- keep routes disabled until source review and staging review pass

This is a target architecture statement only. It does not authorize the
migration or RPC work itself.

## Required future Supabase design

The next design package must define all of the following before any source
implementation:

- exact table names
- retention and cleanup strategy
- exact RPC signatures
- grants
- RLS posture
- transaction and atomicity behavior
- idempotency and collision handling
- throttle window logic
- safe error mapping
- local, staging, and production migration gates
- rollback strategy

It must also preserve the existing route boundary:

- no direct table or RPC calls from route files
- no caller authority from origin, CSRF, throttle, or browser input
- authority remains:
  `auth.getUser() -> resolver -> app_metadata.is_super_admin === true`
- `user_metadata` is not authority

## Future Redis, Upstash, and AWS plan

Redis/Upstash remains a valid later-scale path and is not being rejected on
technical grounds.

Future scale or migration paths may use:

- Redis/Upstash
- ElastiCache Redis
- DynamoDB with TTL
- RDS/Postgres
- another separately reviewed durable store

The code architecture should preserve adapter boundaries so storage can be
swapped later without widening route authority or route import scope.

Upstash can be reconsidered later if:

- admin request volume grows materially
- Supabase latency becomes a practical issue
- rate-limit write pressure grows
- Vercel/serverless Redis becomes strategically useful
- the AWS migration plan selects Redis, DynamoDB, or another equivalent
  durable store

## Existing Redis work handling

This task does not delete or rewrite the previously created Redis/Upstash
design or source work.

For now:

- existing Redis adapter and provider design work remains in the repository
- that Redis provider path is marked deferred for Phase 2
- any source cleanup, replacement, or dependency cleanup must be handled in a
  separate reviewed task
- any `package.json` or `package-lock.json` cleanup remains a source change and
  is not part of this docs-only decision update

The intent is to preserve a future-compatible adapter path while shifting the
near-term implementation choice.

## Explicit forbidden actions

This decision update does not allow any of the following:

- no Upstash provider creation
- no Redis credential setup
- no Vercel environment import
- no Supabase migration in this task
- no route flag enablement
- no live M030 readiness issuance
- no approval execution
- no activation
- no collection unlock
- no payment/provider/checkout/subscription/invoice/storefront behavior

## Recommended next sequence

The next safe sequence is:

1. Review and commit this decision update.
2. Create the Supabase-backed durable security storage design.
3. Independently review that design.
4. Implement the migration and RPC source package.
5. Perform local rehearsal.
6. Approach staging and production migration gates only after separate
   approval.
7. Implement the Supabase-backed server adapters.
8. Run an independent source review.
9. Run disabled-route staging checks.
10. Run the final route-enable review.
11. Only then consider staging route-flag enablement.

No step above authorizes production release.

## Safe next step

Create the next docs-only design for Supabase-backed durable CSRF and throttle
storage, including migration boundaries, RPC atomicity, grants, RLS posture,
cleanup strategy, and rollback planning, before any source change or live
configuration task.
