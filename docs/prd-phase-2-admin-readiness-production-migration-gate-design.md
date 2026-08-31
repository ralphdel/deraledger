# Phase 2 Admin Readiness Production Migration Gate Design

Date: 2026-08-31

## Objective

Design the future production gate for safely applying and validating only:

- `supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`

This is a docs-only design. It does not create scripts, execute SQL, connect
to a database, run a production preflight, apply a migration, modify staging,
change environment or provider configuration, adopt runtime behavior, release
production code, or enable the admin-readiness routes.

## Prerequisite Evidence

The production gate may be designed only because the following evidence is
committed and must remain current when the gate is considered later:

- the source SQL/RPC package passed independent review;
- the local disposable rehearsal passed preflight, apply, postflight,
  behavior, and rollback end to end;
- local rollback removed the exact approved security objects;
- the local rehearsal evidence checkpoint was committed;
- the staging migration gate design was committed;
- the staging migration was applied;
- staging postflight and behavior checks passed;
- the staging evidence checkpoint was committed; and
- the staging harness was repaired and reviewed for pooler identity and
  Windows PowerShell-compatible SHA-256 handling.

Any missing, stale, contradicted, or superseded prerequisite blocks production
work and returns the package to source review.

## Production Target Boundary

Any future production harness or manual runbook must anchor these non-secret
values in reviewed source; operator input may confirm them but must never
define them:

- project ref: `gznwibespgkwknnvbrlv`;
- pooler host: `aws-0-eu-north-1.pooler.supabase.com`;
- port: `5432`;
- database: `postgres`;
- pooler user: `postgres.gznwibespgkwknnvbrlv`; and
- SSL mode: `require`.

The future guard must require exact equality for host, port, database, and
user. It must parse the project ref from the pooler username and require that
it equals `gznwibespgkwknnvbrlv`. In pooler mode SQL `current_user` may be
`postgres`; it is operator/session metadata only and must never be used as
project-ref proof. The direct Supabase database host is not assumed.

Any mismatch, malformed value, ambiguous identity, alternate pooler host,
alternate user/ref, local target, production/staging mix-up, missing SSL
requirement, or connection-string input must fail closed. Credentials,
passwords, tokens, connection strings, JWTs, and `.env` content must never be
entered into chat or agent context.

## Future Production Preflight Phase

Production preflight is a separate, user-run action and requires explicit
approval before it may run. It must be read-only and produce compact redacted
evidence only.

Before any apply is considered, preflight must verify:

- the exact source-approved production pooler host, user-derived project ref,
  port, database, and SSL `require` mode;
- connected database identity, while treating SQL `current_user` only as
  pooler metadata;
- the route flag is disabled across feasible process, user, and machine
  scopes;
- `service_role` exists, has `BYPASSRLS`, and the local operator capability
  required for the migration is demonstrably safe;
- the approved migration file exists and its SHA-256 is captured with
  `Get-FileHash -Algorithm SHA256` or an equivalent Windows PowerShell and
  PowerShell 7-compatible method, never `SHA256.HashData`;
- approved security tables and admin-readiness RPCs are absent, or their exact
  existing state is explicitly detected and classified before any action;
- no partial application, conflicting table, conflicting RPC, unexpected
  overload, or unknown callable surface exists;
- the business-schema baseline, production object counts, and security-table
  size baseline are captured; and
- preflight itself performs no business-data mutation.

Preflight must stop on any failure. Its evidence may contain compact
`PASS`, `FAIL`, `BLOCKED`, and `SKIPPED` summaries, object counts, approved
target identity summaries, and migration hashes, but no sensitive values.

## Future Production Apply Phase

Production apply requires a separate approval after a reviewer accepts the
production preflight evidence. It must require the exact typed confirmation:

```text
PRODUCTION APPLY ADMIN READINESS SECURITY MIGRATION
```

The apply may execute only:

- `supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`

It must stop on identity mismatch, stale/mismatched preflight evidence,
partial-state contradiction, or SQL failure. It does not authorize route
enablement, runtime adoption, admin UI release, live M030 readiness traffic,
approval execution, merchant activation, collection unlock, or payment,
provider, checkout, subscription, invoice, or storefront behavior.

## Future Production Postflight Phase

Immediately after a successful apply, a user-run production postflight must
verify only the approved security surface:

- exactly the three approved security tables exist;
- exact approved RPC signatures exist;
- no unexpected admin-readiness RPCs or overloads exist;
- RLS is enabled, with zero browser policies;
- direct table access is revoked from `PUBLIC`, `anon`, and `authenticated`;
- RPC execute is revoked from `PUBLIC`, `anon`, and `authenticated`;
- exact service-only table and RPC grants remain;
- each RPC is `SECURITY INVOKER` and has a hardened `search_path`;
- no raw token, JWT, cookie, header, password, secret, or user-metadata
  column exists;
- postflight table-size evidence is captured; and
- the business-schema baseline differs only by the three approved security
  tables and six approved RPCs.

The route flag must remain disabled. Any unexpected object, privilege, policy,
function signature, overload, column, or baseline drift blocks the behavior
phase and requires separate review.

## Future Production Behavior Phase

Production behavior checks require separate approval after postflight review.
They test only the security RPCs using namespace
`admin_readiness_production_v1`, test-only digests, and a rolled-back
transaction where possible. If a test cannot roll back, cleanup proof is
required before evidence is accepted.

The future checks must verify:

- CSRF create succeeds;
- a duplicate create returns collision;
- read or validate returns found for valid evidence;
- rotation invalidates the predecessor;
- expired evidence returns missing or deny;
- binding invalidation is bounded;
- throttle returns allow, then `rate_limited` under the tested limit/window;
- cleanup returns a safe result;
- malformed or out-of-bounds inputs deny safely; and
- no raw diagnostic data is exposed.

The behavior phase must not touch business tables and must prove all test rows
were rolled back or removed.

## Production Rollback Posture

Production rollback is never automatic. A successful production apply remains
in place unless a blocker appears. Any rollback requires a separate approval
and reviewed rollback command; it must never touch a business table.

If separately approved, rollback remains ordered as follows:

1. Keep the route flag disabled.
2. Revoke exact RPC grants.
3. Drop the exact approved RPCs.
4. Revoke security-table privileges.
5. Drop only the three approved security tables.
6. Verify removal of those security objects and callable surfaces.
7. Verify the business-schema baseline.

## Evidence and Redaction

Production evidence must be compact and safe to paste into chat. It may report
only `PASS`, `FAIL`, `BLOCKED`, and `SKIPPED` outcomes plus approved identity
summaries, object counts, migration hash, table-size values, and safe behavior
result codes.

It must not include passwords, tokens, connection strings, JWTs, cookies,
headers, raw secrets, full `.env` values, provider credentials, or raw SQL
diagnostics.

## Free-tier and Storage Checks

The current Supabase Phase 2 path remains bounded and low-volume. Future
production evidence must include:

- table-size baseline before apply and postflight table-size evidence;
- expected low-volume CSRF/throttle row-count bounds;
- cleanup RPC verification and cleanup proof;
- confirmation that no indefinite retention is introduced; and
- a 400 MB database-size upgrade-review trigger.

Unexpected storage growth, write pressure, performance impact, cleanup
failure, read-only risk, or need for stronger production backups/PITR blocks
any route-enable discussion and requires separate design review.

## Production Success Criteria

The production migration gate is `PASS` only when all of the following are
true:

- production preflight, apply, postflight, and behavior each pass;
- the route flag remains disabled;
- the business baseline changed only by approved security objects;
- no runtime adoption occurred;
- no merchant activation or collection unlock occurred; and
- no payment, provider, checkout, subscription, invoice, or storefront
  behavior occurred.

## Forbidden Next Actions Without Separate Approval

This design does not authorize:

- production preflight or production apply;
- route enablement, runtime adoption, or admin UI release;
- live M030 readiness traffic or approval execution;
- merchant activation or collection unlock; or
- payment, provider, checkout, subscription, invoice, or storefront behavior.

## Recommended Next Sequence

1. Review and commit this production gate design.
2. Implement a source-only production harness or manual-command runbook.
3. Independently review that source package.
4. Let the user run production preflight only after separate approval.
5. Review the compact preflight evidence.
6. Approve production apply only if preflight passes.
7. Run postflight, then behavior checks after their separate approval.
8. Record a production evidence checkpoint.
9. Consider route/runtime enablement only through a later, separate gate.
