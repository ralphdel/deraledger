# Admin readiness Supabase security migration and RPC design

Date: 2026-08-30

## Scope and current safe state

This is a docs-only implementation design for a future Supabase/Postgres
durable CSRF and throttle migration/RPC package. It creates no SQL migration,
application code, dependency change, environment change, credential, provider
setup, database connection, local database execution, staging action,
production action, runtime adoption, production release, or route enablement.

Current safe state:

- the issue and snapshot routes exist but remain disabled by default;
- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` remains unset or other than
  `"true"`;
- no Supabase durable-security tables or private security RPCs are implemented
  or applied;
- no local, staging, or production migration has run;
- Redis/Upstash source work is deferred as a future-compatible scale path, not
  the active Phase 2 backend.

This design does not authorize M030 issuance, final approval execution,
merchant activation, collection unlock, payment, provider, checkout,
subscription, invoice, storefront, staff management, or future RBAC work.

## Free-tier constraints

Supabase/Postgres is selected only for expected low-volume internal
admin-readiness use. The Free tier must be treated as bounded storage:

- the database is limited to 500 MB per project and can enter read-only mode at
  that limit;
- rows, indexes, writes, and retention must stay minimal;
- no table may retain records indefinitely;
- cleanup proof is required before production migration approval;
- database size approaching 400 MB is an explicit design-review and upgrade
  trigger.

The team must also re-review this choice if admin-readiness write volume grows,
CSRF or throttle writes affect application latency, read-only risk becomes
plausible, or paid compute, backups, or point-in-time recovery becomes needed.

## Proposed migration package

The proposed future canonical migration filename is:

`supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`

The implementation task must first confirm that the sortable name is unused and
adjust only its timestamp if a newer canonical migration is added first. The
migration must be narrow, additive, transactional, and service-only. It must
create only the tables, indexes, RLS/grants, and RPCs in this design; it must
not alter business tables or business data. Unsafe prerequisite drift must fail
clearly, not be guessed or silently repaired. A rerun may verify or recreate
only an exact canonical object shape; an incompatible existing table, index,
constraint, function signature, grant, RLS state, or policy must fail clearly
before any DDL rather than be repaired speculatively.

The later SQL package must follow the database migration and staging-safety
runbook and rehearsal incident ledger: source review, hostile-state disposable
harness, collect-all diagnostics, security-manifest verification, rollback
checks, and user-controlled staging/production execution.

## Shared database-owned bounds

The callable RPCs and table constraints both enforce these bounds. They are not
browser, route, or adapter configuration inputs.

| Item | Required bound |
| --- | --- |
| Operation | `readiness_issue` or `readiness_snapshot` |
| Method | `POST` only, pending a separately reviewed contract change |
| Namespace | `admin_readiness_local_v1`, `admin_readiness_staging_v1`, `admin_readiness_preview_v1`, or `admin_readiness_production_v1` |
| Digest/hash | Exactly 64 lowercase hexadecimal characters |
| Active CSRF records per binding | Maximum 4 |
| CSRF lifetime | Greater than zero and no more than 30 minutes |
| Throttle window | 60 through 3,600 seconds |
| Throttle limit | 1 through 100 per window and operation |
| Stored throttle count | 1 through 1,000; the cap remains denied and never overflows |
| Cleanup/invalidation batch | 1 through 1,000 rows |

## Tables and SQL-level constraints

All tables are proposed in `public` to follow existing Supabase migration
conventions, but they are service-only and non-business. The migration must add
only the indexes specified here unless a separate performance review approves
another one.

### `public.admin_readiness_csrf_tokens`

Purpose: one digest-only record per active short-lived CSRF token.

Required table comment: Short-lived digest-only admin readiness CSRF records;
service-role-only; not audit or business history.

| Column | Type and SQL-level constraint |
| --- | --- |
| `token_digest` | `text primary key`; lower-case 64-hex check |
| `session_binding_digest` | `text not null`; lower-case 64-hex check |
| `operation` | `text not null`; operation allowlist check |
| `method` | `text not null`; `POST` check |
| `expires_at` | `timestamptz not null` |
| `created_at` | `timestamptz not null default now()` |
| `replaced_by_token_digest` | nullable `text`; 64-hex check when present |

Required SQL checks:

- `expires_at > created_at`;
- `expires_at <= created_at + interval '30 minutes'`;
- a replacement digest, when present, differs from `token_digest`.

Required indexes are the primary key and one btree index on `expires_at` for
bounded cleanup. There must be no raw CSRF token, JWT, cookie, header, email,
user ID, `user_metadata`, raw `app_metadata`, request-body, or authority
column.

### `public.admin_readiness_csrf_binding_index`

Purpose: a bounded lookup from session-binding digest to active token digests,
so rotation and invalidation never require an unbounded token-table scan.

Required table comment: Bounded admin readiness CSRF binding index;
service-role-only; no raw session material.

| Column | Type and SQL-level constraint |
| --- | --- |
| `token_digest` | `text primary key`; 64-hex check; FK to CSRF tokens `on delete cascade` |
| `session_binding_digest` | `text not null`; lower-case 64-hex check |
| `operation` | `text not null`; operation allowlist check |
| `method` | `text not null`; `POST` check |
| `expires_at` | `timestamptz not null` |
| `created_at` | `timestamptz not null default now()` |

Required checks are the same positive, maximum-30-minute lifetime rules. The
create and rotate RPCs, not a browser-provided parameter, enforce the maximum
four active records per binding. Required indexes are the primary key and one
btree index on `(session_binding_digest, expires_at, created_at)`.

No surrogate ID, raw session identifier, access token, cookie, JWT, user ID,
email, or metadata column is allowed.

### `public.admin_readiness_throttle_windows`

Purpose: fixed-window, environment-scoped abuse-control counters. This table is
not an audit history and never establishes reviewer authority.

Required table comment: Short-lived bounded admin readiness throttle windows;
service-role-only; not audit or business history.

| Column | Type and SQL-level constraint |
| --- | --- |
| `security_namespace` | `text not null`; namespace allowlist check |
| `operation` | `text not null`; operation allowlist check |
| `subject_hash` | `text not null`; lower-case 64-hex check |
| `window_started_at` | `timestamptz not null` |
| `window_expires_at` | `timestamptz not null` |
| `request_count` | `integer not null`; `between 1 and 1000` check |
| `created_at` | `timestamptz not null default now()` |
| `updated_at` | `timestamptz not null default now()` |

Required SQL constraints:

- unique key on `(security_namespace, operation, subject_hash,
  window_started_at)`;
- `window_expires_at > window_started_at`;
- `window_expires_at <= window_started_at + interval '1 hour'`.

The decision RPC additionally validates a 60-3,600-second duration and a
1-100 request limit. Required indexes are the unique key and one btree index
on `window_expires_at` for cleanup.

No raw IP or IP history, token, cookie, header, email, user ID, request body,
metadata, provider response, or authority column is allowed.

## RLS, grants, policies, and callable surface

RLS must be enabled on every table. There must be zero browser policies and no
direct `select`, `insert`, `update`, or `delete` access for `PUBLIC`, `anon`,
or `authenticated`. The migration must explicitly revoke Supabase-default
privileges from those roles.

The intended service-only manifest is:

- only `service_role` receives the narrow table privileges required by the
  service-invoker RPCs;
- application routes never use table privileges directly and never construct a
  database client;
- RLS remains enabled with an explicit documented non-forced posture, matching
  existing Phase 2 service-invoker conventions;
- direct browser/public access is denied even if a route is later enabled.

Each function is in `public`, `SECURITY INVOKER`, and hardened with
`SET search_path TO pg_catalog, public`; relation references are fully
qualified. The migration must revoke execute from `PUBLIC`, `anon`,
`authenticated`, and `service_role`, then grant its exact signature only to
`service_role`. It must reject unexpected same-name overloads.

No function output may include input echoing, `SQLERRM`, diagnostic stacks, raw
digests, row dumps, table names, or internal exception detail.

Origin, CSRF, throttle, binding state, and storage are defense in depth only.
They do not authorize a reviewer. Authority remains:

`auth.getUser() -> resolver -> app_metadata.is_super_admin === true`

`user_metadata` is never authority.

## Private RPC contracts

The RPCs are private because only `service_role` receives execute. Routes must
call approved server adapters only, never these RPCs.

### `create_admin_readiness_csrf_token_v1`

Proposed signature:

`(p_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamptz)`

Both digests must be 64-hex; operation and method must be allowlisted; expiry
must be after database `now()` and no more than 30 minutes ahead. It accepts no
caller-controlled binding-record cap.

Safe output is one `result_code text`: `created`, `conflict`, `invalid`, or
`csrf_unavailable`. It returns no digest, token, binding, timestamp, row, or
diagnostic.

Atomic behavior:

- remove only expired index entries for the supplied binding opportunistically;
- serialize the binding's relevant rows with row locks or an equivalent
  binding-scoped advisory lock;
- enforce at most four active binding records;
- insert token and index entry together;
- use `insert ... on conflict do nothing` or equivalent non-overwrite behavior;
- return `conflict` without mutation if the token digest exists.

Unexpected internal failure maps to `csrf_unavailable` without exception text.

### `read_admin_readiness_csrf_token_v1`

Proposed signature: `(p_token_digest text)`.

It accepts only a 64-hex digest. Its fixed internal output fields are
`result_code`, `operation`, `method`, `session_binding_digest`, and
`expires_at`. These values are consumed only by the server adapter and never
mapped to a browser response or operational log.

Allowed results are `found`, `missing`, `expired`, `invalid`, and
`csrf_unavailable`. The function performs one digest-keyed lookup and treats
expiry or replacement as denial even if cleanup is delayed. The adapter compares
operation, method, and binding against server-derived request context. The RPC
does not authorize a reviewer.

### `rotate_admin_readiness_csrf_token_v1`

Proposed signature:

`(p_previous_token_digest text, p_new_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamptz)`

Both token digests and the binding are fixed 64-hex values; old and new must
differ. Operation, method, and expiry follow the create bounds.

Safe output is one `result_code`: `rotated`, `missing`, `expired`,
`binding_mismatch`, `operation_mismatch`, `method_mismatch`, `conflict`,
`invalid`, or `csrf_unavailable`. It returns no token or binding material.

The RPC locks predecessor/index state, validates it, creates the unused
replacement, updates the predecessor marker, and updates the index in one
transaction. A replacement conflict or validation failure leaves predecessor
state unchanged. It enforces the four-record cap after removing only expired
records.

### `invalidate_admin_readiness_csrf_binding_v1`

Proposed signature:

`(p_session_binding_digest text, p_max_delete_count integer)`

The digest must be 64-hex and the bound is 1-1,000. A server adapter owns this
bound; a route never does. Safe output is `result_code` (`invalidated`,
`missing`, `invalid`, or `csrf_unavailable`) and internal-only
`deleted_count`.

The function locks and deletes at most the requested binding's rows in stable
order, deleting matching token and index entries atomically. It never scans or
deletes another binding. If more eligible rows exist than its requested bound,
it returns unavailable rather than claiming full invalidation.

Logout/session replacement calls this private RPC through a server-only adapter
after deriving the old binding. A failure cannot make old evidence valid: a new
session has a new binding and unverifiable request state fails closed.

### `decide_admin_readiness_throttle_v1`

Proposed signature:

`(p_security_namespace text, p_operation text, p_subject_hash text, p_window_started_at timestamptz, p_window_expires_at timestamptz, p_limit integer)`

It validates exact namespace, operation, a 64-hex subject, a 60-3,600 second
window, a 1-100 limit, and start/expiry close enough to database `now()` to
prevent arbitrary historic or future durable buckets.

Safe output is one `result_code`: `allow`, `rate_limited`, `invalid`, or
`throttle_unavailable`. It exposes no count, key, reset time, namespace,
subject, provider detail, or storage error.

The RPC atomically locks or upserts one unique fixed-window row and decides
allow/deny in the same transaction. Denied requests may increment only through
the 1,000-count cap; then they remain denied without overflow. Expired rows
never count toward allow. Malformed state or transaction failure maps to
unavailable.

### `cleanup_admin_readiness_security_storage_v1`

Proposed signature: `(p_max_delete_count integer)`.

This service-role-only maintenance RPC is never route callable. It accepts
1-1,000 and returns only `cleaned`, `nothing_to_clean`, `invalid`, or
`security_storage_unavailable` plus internal-only bounded aggregate counts.

It deletes deterministic batches of expired CSRF tokens, orphaned/expired
binding-index rows, and throttle rows older than the reviewed short retention
buffer. It must never delete an unexpired token, a current throttle window, a
business row, or audit history. Delayed cleanup changes neither CSRF validity
nor throttle decisions because action RPCs enforce expiry themselves.

## Common hardening, atomicity, cleanup, and retention

Every RPC must validate input before writing, use the hardened search path,
return only fixed enums/fields, and contain expected invalid and unexpected
failures without outputting exception text. Exact-signature grants remain
service-role-only.

The later server adapter maps transport failure, missing function, malformed
row, unknown code, unexpected field, grants defect, or database error to opaque
CSRF/throttle unavailable. It exposes no database, RPC, service-role, session,
token, digest, namespace, stack, or SQL detail.

Required transactional invariants:

- create never overwrites a token digest; collision is retry-safe;
- rotation validates predecessor and inserts replacement atomically;
- replacement conflict leaves predecessor unchanged;
- invalidation is binding-scoped and bounded;
- throttle increment/check uses one transaction and one unique window key;
- expired tokens or windows never produce allow;
- malformed output, serialization failure, and unexpected DB failure fail
  closed.

Retention rules:

- CSRF token/index rows are logically invalid by their maximum 30-minute TTL;
- throttle rows are inactive at `window_expires_at` and retained only for a
  reviewed cleanup buffer no longer than 24 hours;
- cleanup runs in bounded batches and no table stores indefinite history;
- no binding exceeds four active index records.

The next package must estimate row count from reviewed issue/snapshot rate, CSRF
TTL, four-token cap, throttle window, and cleanup buffer. Local/staging
rehearsal must measure table size. Postflight includes a table-size query, and
cleanup proof is mandatory before production approval.

## Migration, rehearsal, and production gates

The agent must not connect to a database. The user controls credentialed
PowerShell execution and must not provide credentials to an agent.

Required sequence:

1. Review canonical migrations, affected roles, grants/RLS conventions, harness
   patterns, and mandatory migration-safety documents.
2. Implement a source-only SQL package with disposable local harness, read-only
   staging preflight, reviewed staging wrapper, and read-only postflight.
3. Run collect-all hostile-state local diagnostics, then the normal fail-fast
   harness after all failures are fixed together.
4. Complete local behavior, security, rollback, application, typecheck, build,
   and diff-check validation.
5. Obtain explicit approval before user-run staging preflight.
6. Allow user-run staging migration only after preflight and security-manifest
   review pass.
7. Allow production only after staging proof and separate explicit approval.

Postflight must assert:

- all three tables and intended indexes exist;
- RLS enabled and zero public/browser policies;
- no `PUBLIC`, `anon`, or `authenticated` privileges;
- intended service-role-only table/RPC grants;
- exact function signatures, hardened search paths, and no overloads;
- zero business-data mutation;
- Free-tier table-size/row-count evidence;
- cleanup proof with expired fixtures that preserves active records.

## Rollback strategy

The implementation package must include a separately reviewed rollback artifact
or precise manual rollback guide; this design writes neither. The route flag
stays disabled throughout rollback.

Intended order:

1. keep the route flag disabled;
2. revoke execute from each exact RPC signature;
3. drop the six private RPCs by exact signature;
4. revoke service-role table privileges;
5. drop only the three security tables and their dependent indexes;
6. verify no grants, policies, overloads, or storage objects remain.

Rollback must never drop, truncate, rewrite, or otherwise mutate business
tables. Shared-environment rollback remains user-run and separately approved.

## Required tests for the future SQL package

The next package needs behavioral and structural tests, not only string scans:

- migration inspection for exact columns, constraints, indexes, RLS, zero
  policies, grants, search paths, and overload absence;
- disposable local behavior tests for all six RPCs;
- token create collision proving no overwrite;
- read/validate allow and deny, including expiry and replacement denial;
- rotation predecessor invalidation and replacement-conflict rollback;
- bounded invalidation that cannot cross bindings or overclaim completion;
- throttle allow and `rate_limited` behavior in one fixed window;
- malformed digest, namespace, operation, method, expiry, limit, window, and
  row-state rejection;
- cleanup respects its bound, removes expired data only, and preserves active
  records;
- hostile default-privilege, RLS, policy, grant, and function-overload tests;
- zero business-data mutation assertion;
- Free-tier row-count, minimal-index, table-size, and cleanup-proof smoke check;
- disabled-route factory block;
- enabled test-only route reaches only `service.issue` or
  `service.readSnapshot` after origin, CSRF, throttle, and every storage gate;
- no final approval, activation, collection unlock, payment, provider,
  checkout, subscription, invoice, or storefront behavior.

## Adapter handoff and deferred Redis path

After local validation and independent source review, a separate server-only
Supabase adapter package may call only these private RPCs. It must not call
tables directly. Route files must not construct a Supabase client or call an
RPC. Adapters remain responsible for redaction and fail-closed normalization.

The Redis/Upstash source path is deferred, not deleted. A later adapter swap
may select Redis/Upstash, ElastiCache Redis, DynamoDB with TTL, RDS/Postgres,
or another reviewed durable store if volume, pressure, latency, or an AWS
migration warrants it. Any Redis source/dependency cleanup needs separate
review.

Migration or adapter work does not authorize route enablement, live M030,
runtime adoption, or production release.

## Explicit forbidden actions

This task authorizes none of the following:

- SQL migration implementation or database access;
- local, staging, or production database action;
- environment, provider, dependency, credential, or route-flag change;
- route enablement or runtime adoption;
- live M030 readiness issuance;
- final approval execution;
- merchant activation or collection unlock;
- payment, provider, checkout, subscription, invoice, or storefront behavior.

## Recommended next sequence

1. Independently review and commit this design.
2. Implement the source-only migration/RPC package and local rehearsal assets.
3. Run complete disposable local rehearsal and independent source review.
4. Let the user perform any local apply/rehearsal only after explicit approval.
5. Require separate staging and production gates after reviewed local proof.
6. Implement and review server-only Supabase adapters that call private RPCs.
7. Perform disabled-route staging checks and final route-enable review.
8. Only then consider a separate controlled staging route-flag decision.
