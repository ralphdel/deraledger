# Admin readiness local rehearsal harness design

Date: 2026-08-30

## Scope and current safe state

This is a docs-only design for a future user-run disposable local rehearsal
harness for the Supabase admin-readiness durable security migration/RPC
package. It creates no script, SQL change, database connection, database
execution, route change, environment change, provider setup, runtime adoption,
production release, or route enablement.

Current safe state:

- the source-only migration file
  `supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`
  is committed source only;
- the static SQL inspection test passed during source review;
- the migration has not been applied locally, in staging, or in production;
- no local, staging, or production database was touched by this task;
- admin-readiness routes remain disabled by default;
- local rehearsal is still pending and blocked until a separately reviewed,
  source-only harness package exists.

This design does not authorize M030 issuance, final approval execution,
merchant activation, collection unlock, payment, provider, checkout,
subscription, invoice, or storefront behavior.

## Rehearsal objective

The future user-run local rehearsal must prove, on a disposable local database
only, that:

- the migration applies cleanly;
- only the approved three tables and approved six RPCs are introduced;
- RLS, grants, revokes, and callable surface match the approved security
  manifest;
- `PUBLIC`, `anon`, and `authenticated` direct access remains blocked;
- `service_role`-only access works through the intended private RPC surface;
- RPC behavior matches the approved safe result contracts;
- cleanup removes only expired and eligible security rows;
- rollback removes only the approved security objects;
- no business table or business data mutation occurs;
- Free-tier table-size and bounded-retention checks are available before any
  later staging or production decision.

## Local-only target guard

The future harness must reject every target that is not explicitly local and
disposable before any destructive or credentialed operation.

Required guard rules:

- the operator must type an explicit confirmation phrase stating the target is
  local and disposable only;
- host must be exactly `localhost` or `127.0.0.1`;
- the harness must reject remote-looking hosts, DNS names, IPs outside
  loopback, `host.docker.internal`, and every Supabase cloud hostname unless a
  later reviewed design expands the local target list;
- the database name must be non-empty and must clearly include one of:
  `local`, `test`, `rehearsal`, `disposable`, or `admin_readiness`;
- obvious production-like or staging-like names must be rejected;
- the harness must reject empty names, default names, and names such as
  `postgres`, `production`, `prod`, `staging`, `preview`, or `main`;
- the harness must never accept a connection string or URL;
- the user must enter host, port, database, and user locally through separate
  PowerShell prompts;
- credentials must be entered locally only and never requested in chat.

The harness should also prove local identity after connection using
read-only SQL checks such as current database, current user, PostgreSQL major
version, and `host(inet_server_addr())`, while keeping output compact and
sanitized.

## PowerShell safety rules

The future source-only PowerShell harness must follow these rules:

- never use `$Host` as a variable name;
- use explicit names such as `$DbHost`, `$DbPort`, `$DbName`, and `$DbUser`;
- use `Read-Host` for local-only non-secret prompts;
- use a secure local password prompt where possible;
- never echo or persist the password;
- never write credentials, passwords, or full connection strings to disk;
- never print full connection details that include secrets;
- stop on first error within each phase;
- make dry preflight the default mode;
- require a separate typed confirmation before any apply or rollback phase;
- clearly separate preflight, hostile-state inspection, apply, postflight,
  behavior test, cleanup check, and rollback;
- use UTF-8 output without BOM for generated or recorded files;
- isolate inherited PostgreSQL environment variables and restore them after the
  run;
- write evidence only to untracked local or temporary directories, never into a
  commit by default.

## Rehearsal phases

The future harness should be organized into explicit user-visible phases:

1. Preflight inspection:
   confirm local identity, prompt values, migration source hash, target host,
   disposable database naming, and dry-run/apply mode.
2. Hostile-state inspection:
   inspect whether conflicting objects already exist and fail closed before any
   apply if the target is not clean or not disposable enough for the rehearsal.
3. Apply migration:
   apply only the approved migration on the disposable local database after
   typed confirmation.
4. Structural postflight:
   verify exact tables, indexes, comments, functions, signatures, and object
   counts.
5. Grants/RLS postflight:
   verify RLS enabled, zero browser policies, exact grants, revoked execute for
   `PUBLIC`/`anon`/`authenticated`, and `service_role`-only callable surface.
6. RPC behavior tests:
   execute the approved behavior matrix against disposable local fixtures only.
7. Cleanup and Free-tier check:
   verify bounded cleanup behavior, row counts, and table-size evidence.
8. Rollback rehearsal:
   run the exact reviewed rollback order on the same disposable local target
   only after a separate typed confirmation.
9. Final clean-state check:
   prove the exact security objects are removed and no unrelated business
   objects changed.

Each phase should emit compact `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED` status
and record evidence in a user-controlled local file.

## Behavioral RPC coverage

The future local rehearsal must include behavioral coverage for:

- CSRF create success;
- CSRF create collision returning a safe conflict result without overwrite;
- CSRF read or validate allow for an unexpired matching binding;
- expired token denial;
- session-binding mismatch denial;
- CSRF rotate predecessor invalidation and replacement allow;
- invalidate-binding bounded behavior and no cross-binding deletion;
- throttle allow below limit;
- throttle `rate_limited` at or above limit;
- cleanup of expired token, binding-index, and throttle rows;
- malformed digest, namespace, operation, method, expiry, limit, and batch
  bounds rejection;
- safe unavailable behavior on malformed or unexpected row/RPC output;
- no raw diagnostics, exception text, or credential leakage in behavioral
  output.

The behavior stage should prefer collect-all reporting across independent
scenarios so one failed scenario does not hide the rest of the matrix.

## Security postflight checks

The future harness must verify:

- only the three approved tables exist:
  `admin_readiness_csrf_tokens`,
  `admin_readiness_csrf_binding_index`, and
  `admin_readiness_throttle_windows`;
- only the approved private RPCs exist with exact signatures;
- RLS is enabled on all three tables;
- zero browser policies exist on all three tables;
- no direct table grants exist for `anon` or `authenticated`;
- no direct RPC execute grants exist for `anon` or `authenticated`;
- `service_role` has only the reviewed table and RPC grants;
- every RPC uses a hardened `search_path`;
- every RPC is `SECURITY INVOKER`;
- no raw CSRF token, JWT, cookie, header, or user-metadata columns exist;
- no business tables were changed, dropped, rewritten, or seeded by the
  migration package.

The postflight should also assert exact object names so unexpected overloads,
duplicate functions, or extra security tables fail closed.

## Free-tier checks

The future harness must include:

- an expected row-count estimate based on low-volume internal admin usage;
- table-size queries after the structural and behavior phases;
- cleanup proof showing expired rows can be removed in bounded batches;
- proof that no indefinite retention exists in the security tables;
- a reminder that database size approaching 400 MB is an upgrade-review
  trigger on Supabase Free tier.

These checks are evidence only for later review; they do not authorize staging
or production migration.

## Rollback rehearsal

The future rollback rehearsal must follow this exact order:

1. keep the route flag disabled;
2. revoke execute from the exact private RPC signatures;
3. drop the exact private RPCs only;
4. revoke `service_role` table privileges;
5. drop only the three new security tables;
6. verify the approved objects are removed;
7. verify no business tables were dropped or changed.

Rollback must be bounded to the disposable local target and must stop if the
identity guard cannot prove locality.

## Explicit forbidden actions

This design authorizes none of the following:

- script creation in this task;
- SQL execution in this task;
- database connection in this task;
- local apply before separate approval;
- any staging or production target;
- environment or provider setup;
- route enablement or setting
  `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=true`;
- live M030 readiness issuance;
- final approval execution;
- merchant activation or collection unlock;
- payment, provider, checkout, subscription, invoice, or storefront behavior.

## Recommended next sequence

1. Review and commit this design.
2. Implement a source-only PowerShell rehearsal harness package.
3. Independently review the harness package.
4. Let the user run local preflight only after explicit approval.
5. Review the compact preflight evidence.
6. Let the user run local apply only after separate approval.
7. Let the user run local postflight, behavior, cleanup, and rollback phases.
8. Review the compact local evidence.
9. Only then consider a separate staging migration gate.
