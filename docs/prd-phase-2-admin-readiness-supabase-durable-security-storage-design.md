# Admin readiness Supabase durable security storage design

Date: 2026-08-30

## Scope

This is a docs-only design for Supabase/Postgres-backed durable CSRF and
throttle storage for the admin readiness routes. It creates no code,
dependency change, environment change, provider setup, credential creation,
database migration, staging action, production action, runtime adoption,
production release, route-flag enablement, M030 issuance, approval execution,
activation, collection unlock, or payment/provider/checkout/subscription/
invoice/storefront behavior.

The route flag must remain unset or false:

`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED !== "true"`

## Decision basis

The Phase 2 storage direction is now:

- Supabase/Postgres-backed durable storage is selected for Phase 2
- Redis/Upstash remains a deferred future scale path
- durable shared storage is still required before any real route enablement
- in-memory storage is not acceptable for real enablement

This design does not remove or delete the existing Redis-path source work. It
defines the next preferred Phase 2 storage path only.

## Proposed tables

The future migration should create service-only admin readiness security tables
under a dedicated non-business security scope. Suggested table names are:

- `admin_readiness_csrf_tokens`
- `admin_readiness_csrf_binding_index`
- `admin_readiness_throttle_windows`

These tables must not be reused for merchant/business/commercial data and must
not share semantics with existing KYC or storefront tables.

### `admin_readiness_csrf_tokens`

Purpose:

- stores one short-lived durable CSRF record per active token digest

Key columns:

- `token_digest text primary key`

Value columns:

- `session_binding_digest text not null`
- `operation text not null`
- `method text not null`
- `expires_at timestamptz not null`
- `created_at timestamptz not null default now()`
- `replaced_by_token_digest text null`

Indexes:

- primary key on `token_digest`
- index on `session_binding_digest`
- index on `expires_at`

TTL/expiry fields:

- `expires_at`

Retention strategy:

- rows are treated as invalid once `expires_at <= now()`
- expired rows are safe to clean later by scheduled reviewed cleanup or bounded
  RPC-side cleanup assistance

RLS posture:

- enable RLS
- create zero anon/authenticated access policies
- no public read or write path

Expected grants:

- no table grants to `anon`
- no table grants to `authenticated`
- minimal table access only to `service_role`

### `admin_readiness_csrf_binding_index`

Purpose:

- keeps a bounded per-binding index so invalidation and rotation do not require
  unbounded scans

Key columns:

- surrogate `id bigint generated always as identity primary key`

Value columns:

- `session_binding_digest text not null`
- `token_digest text not null`
- `operation text not null`
- `method text not null`
- `expires_at timestamptz not null`
- `created_at timestamptz not null default now()`

Indexes:

- unique index on `token_digest`
- index on `session_binding_digest`
- compound index on `(session_binding_digest, expires_at)`

TTL/expiry fields:

- `expires_at`

Retention strategy:

- expired rows are logically ignored
- cleanup removes expired rows and any rows whose token record no longer exists
- RPCs should cap active records per binding to prevent unbounded growth

RLS posture:

- enable RLS
- zero anon/authenticated policies

Expected grants:

- service-role only access

### `admin_readiness_throttle_windows`

Purpose:

- stores fixed-window per-subject throttle counters for `issue` and `snapshot`

Key columns:

- surrogate `id bigint generated always as identity primary key`

Value columns:

- `security_namespace text not null`
- `operation text not null`
- `subject_hash text not null`
- `window_started_at timestamptz not null`
- `window_expires_at timestamptz not null`
- `request_count integer not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:

- unique index on `(security_namespace, operation, subject_hash, window_started_at)`
- index on `window_expires_at`

TTL/expiry fields:

- `window_expires_at`

Retention strategy:

- rows expire after the reviewed throttle window
- delayed cleanup is safe because expired rows must never permit access

RLS posture:

- enable RLS
- zero anon/authenticated policies

Expected grants:

- service-role only access

## Security posture

The future Supabase-backed storage layer must preserve these boundaries:

- browser and public access denied
- anon and authenticated direct access denied
- service-role and server-only use only
- no direct table or RPC access from route files
- all storage access goes through approved server adapters
- no raw CSRF token, raw JWT, cookie, header, or raw user metadata stored
- only digests, operation, method, expiry, created timestamps, and bounded
  related metadata are stored
- origin, CSRF, throttle, storage, and binding state are defense-in-depth only,
  not authority
- authority remains:
  `auth.getUser() -> resolver -> app_metadata.is_super_admin === true`
- `user_metadata` is not authority

The tables and RPCs must be isolated from business workflows such as payment,
checkout, subscription, invoice, storefront, activation, and collection
unlock behavior.

## Required RPCs

The future migration/package should add private RPCs for atomic storage
behavior. Route files must never call these RPCs directly.

### `admin_readiness_csrf_create`

Purpose:

- atomically creates a new CSRF token record and its bounded binding-index
  record without overwriting an existing digest

Input parameters:

- `p_token_digest text`
- `p_session_binding_digest text`
- `p_operation text`
- `p_method text`
- `p_expires_at timestamptz`
- optional bounded `p_max_binding_records integer`

Output shape:

- `result_code text`
- `created boolean`

Allowed result codes:

- `created`
- `conflict`
- `csrf_unavailable`

Atomicity/transaction behavior:

- token insert and binding-index insert occur in one transaction
- existing token digest collision must not overwrite
- expired index rows for the same binding may be opportunistically cleaned
  inside the transaction before the bounded insert cap is enforced

Error/fail-closed mapping:

- malformed output or raised exception becomes safe unavailable at adapter
  boundary

Grants:

- execute only for `service_role`

Search path hardening:

- set an explicit trusted `search_path`
- fully qualify table names inside the function

### `admin_readiness_csrf_read`

Purpose:

- returns the stored durable CSRF record projection for one digest so the
  server adapter can compare method, operation, binding, and expiry

Input parameters:

- `p_token_digest text`

Output shape:

- nullable record with:
  `token_digest`, `session_binding_digest`, `operation`, `method`,
  `expires_at`, `created_at`, `replaced_by_token_digest`

Allowed result codes:

- adapter interprets missing row as denial, not an RPC error code

Atomicity/transaction behavior:

- simple single-row lookup

Error/fail-closed mapping:

- malformed row or RPC failure maps to `csrf_unavailable`

Grants:

- execute only for `service_role`

Search path hardening:

- explicit `search_path`

### `admin_readiness_csrf_rotate`

Purpose:

- atomically validates a predecessor record, creates the replacement, updates
  the bounded index, and marks or removes the predecessor

Input parameters:

- `p_previous_token_digest text`
- `p_new_token_digest text`
- `p_session_binding_digest text`
- `p_operation text`
- `p_method text`
- `p_expires_at timestamptz`
- optional bounded `p_max_binding_records integer`

Output shape:

- `result_code text`

Allowed result codes:

- `rotated`
- `missing`
- `expired`
- `binding_mismatch`
- `method_mismatch`
- `operation_mismatch`
- `conflict`
- `csrf_unavailable`

Atomicity/transaction behavior:

- predecessor validation and replacement creation occur in one transaction
- predecessor must not be replaced if it is missing, expired, or mismatched
- replacement collision returns conflict without mutating predecessor state

Error/fail-closed mapping:

- unknown or malformed output becomes `csrf_unavailable`

Grants:

- execute only for `service_role`

Search path hardening:

- explicit `search_path`

### `admin_readiness_csrf_invalidate_binding`

Purpose:

- invalidates a bounded set of active token/index rows for one session-binding
  digest

Input parameters:

- `p_session_binding_digest text`
- optional bounded `p_max_delete_count integer`

Output shape:

- `result_code text`
- `deleted_count integer`

Allowed result codes:

- `invalidated`
- `missing`
- `csrf_unavailable`

Atomicity/transaction behavior:

- the read of eligible rows and the delete of both index and token rows occur
  in one transaction
- deletion must remain bounded

Error/fail-closed mapping:

- malformed or failing output becomes `csrf_unavailable`

Grants:

- execute only for `service_role`

Search path hardening:

- explicit `search_path`

### `admin_readiness_throttle_decide`

Purpose:

- atomically creates or increments a fixed-window throttle counter and returns
  allow or deny

Input parameters:

- `p_security_namespace text`
- `p_operation text`
- `p_subject_hash text`
- `p_window_started_at timestamptz`
- `p_window_expires_at timestamptz`
- `p_limit integer`

Output shape:

- `result_code text`

Allowed result codes:

- `allow`
- `rate_limited`
- `throttle_unavailable`

Atomicity/transaction behavior:

- lookup, insert-or-update, and limit decision occur in one transaction
- expired rows do not count
- denied requests should still increment within the same active window

Error/fail-closed mapping:

- malformed output or RPC failure becomes `throttle_unavailable`

Grants:

- execute only for `service_role`

Search path hardening:

- explicit `search_path`

## Atomicity and collision handling

The Supabase-backed design must preserve strict fail-closed atomic behavior:

- CSRF token create must never overwrite an existing digest
- token collision must return a conflict or retry-safe result
- token rotation must validate the predecessor and create the replacement
  atomically
- binding invalidation must stay bounded and must not depend on unbounded table
  scans
- throttle decision must perform increment and allow/deny decision in one
  transaction
- expired token or throttle rows must never authorize or permit access

Unknown RPC output, malformed rows, transaction failure, missing grants, or
unexpected database errors must all map to safe unavailable results inside the
server adapter layer.

## Retention and cleanup

Cleanup should be designed to remain safe even if delayed:

- CSRF tokens should expire quickly and become invalid based on `expires_at`
  even before cleanup runs
- throttle windows should become irrelevant after `window_expires_at`
- expired rows may be deleted by a reviewed cleanup job, migration companion
  procedure, or bounded opportunistic cleanup inside private RPCs
- the binding index must remain bounded so invalidation and rotation do not
  accumulate unbounded rows
- delayed cleanup must not create a permission bypass

No external provider is required for this cleanup strategy.

## Supabase Free-tier feasibility

The Phase 2 Supabase-backed storage plan is acceptable on the current
Supabase Free tier only because the admin readiness routes are expected to
remain low-volume internal routes and the stored security state is intended to
be short-lived, bounded, and aggressively cleaned.

Current Free-tier constraints to account for:

- 500 MB database size per project
- Free projects can enter read-only mode if database size exceeds 500 MB
- Free or Nano compute is acceptable only for low-volume internal usage

That means the next migration and RPC package must preserve all of the
following hard storage constraints:

- short CSRF TTLs
- bounded active CSRF records per binding
- bounded binding invalidation
- bounded throttle windows
- no indefinite retention
- a cleanup RPC/function or a separately reviewed scheduled cleanup plan
- minimal indexes only
- no raw tokens, JWTs, cookies, or user metadata stored
- no business history or audit-history retention in these security tables

If any of those conditions cannot be met, the Free-tier feasibility assumption
should be treated as invalid and the storage plan must be re-reviewed before
enablement.

### Upgrade and scale triggers

The team should revisit the Supabase-backed Phase 2 choice and consider a paid
Supabase tier or a different durable backend if any of the following occurs:

- database size approaches 400 MB
- admin readiness write volume grows materially
- CSRF or throttle writes begin affecting main application performance
- read-only risk becomes plausible
- production reliability requires paid compute, backups, or point-in-time
  recovery

### Monitoring and rehearsal checks

Before any later production migration decision, the next package and its
rehearsal steps should include:

- an estimate of expected row counts for CSRF and throttle tables
- table-size measurement after local and staging tests
- a postflight table-size query after migration rehearsal
- proof that cleanup works before any production migration approval

## Migration and rehearsal gates

The future implementation must use conservative migration and rehearsal gates:

1. Local migration rehearsal first.
2. Local behavior and security tests.
3. Staging migration only after explicit approval.
4. Production migration only after staging proof and explicit approval.

Postflight checks must verify:

- tables exist
- RLS is enabled
- no anon or authenticated table grants exist
- service-role grants only are present
- RPC execute grants exist only for `service_role`
- zero public policies exist
- no business data mutation was introduced

Rollback planning must include:

- dropping the new RPCs and tables only through a separately reviewed rollback
  procedure
- safe rollback ordering so grants and callable surfaces are removed before
  dependent source adoption is considered
- retention of route disabled-by-default behavior during any rollback window

## Adapter implementation plan

The later Supabase-backed source package should:

- add server-only Supabase storage adapters
- replace or deprecate the active Redis path for the production-readiness path
  without deleting the deferred Redis future path unless separately approved
- keep route files free of direct Supabase table or RPC calls
- keep route flag enablement out of scope
- keep disabled routes disabled by default

All storage access must continue to sit behind server-only route-security
composition and approved adapters.

## Required tests

The later source package should include:

- migration structural tests
- RPC behavior tests
- CSRF create, validate, rotate, and invalidate behavior tests
- token collision tests
- expired token denial tests
- session-binding mismatch denial tests
- throttle allow and `rate_limited` tests
- malformed or unavailable RPC fail-closed tests
- disabled-route factory-block tests
- enabled test-only route tests that reach only `service.issue` or
  `service.readSnapshot` after every gate passes
- no approval execution tests
- no activation tests
- no collection unlock tests
- no payment/provider/storefront behavior tests

These tests must remain behavioral and must not rely only on string scanning.

## Future scale plan

Supabase/Postgres is the selected Phase 2 durable backend, but later scale
paths remain open.

Redis/Upstash/AWS-backed storage can still be reconsidered later through
adapter swap if:

- admin request volume grows
- database write pressure grows
- latency becomes a practical issue
- an AWS migration requires a different shared-state service

Possible later options include:

- Redis/Upstash
- ElastiCache Redis
- DynamoDB with TTL
- RDS/Postgres

The route and adapter architecture should preserve storage swap flexibility.

## Explicit forbidden actions

This design does not authorize any of the following:

- no migration in this task
- no route enablement
- no staging or production action
- no Upstash setup
- no environment import
- no live M030 readiness issuance
- no approval execution
- no activation
- no collection unlock

## Recommended next sequence

The next safe sequence is:

1. Review and commit this design.
2. Implement the source-only migration and RPC package.
3. Perform local rehearsal.
4. Run an independent source review.
5. Let the user execute staging and production gates only after explicit
   approval.
6. Implement the Supabase-backed server adapters.
7. Run disabled-route staging checks.
8. Run the final route-enable review.
9. Only then consider staging route-flag enablement.

No step above authorizes production release.

## Safe next step

Create the source-only migration and RPC design package for these service-only
tables and private functions, with local rehearsal and rollback boundaries
defined before any SQL source change is implemented.
