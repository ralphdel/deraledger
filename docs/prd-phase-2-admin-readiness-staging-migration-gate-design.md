# Phase 2 Admin Readiness Staging Migration Gate Design

Date: 2026-08-30

## Objective

Design the safe staging gate for applying and validating the approved Phase 2
Supabase admin readiness security migration:

- `supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`

This document is docs-only. It does not authorize scripts, SQL changes,
database connections, staging apply, production action, environment changes,
provider changes, runtime adoption, release, route enablement, M030 issuance,
approval execution, merchant activation, collection unlock, or payment,
provider, checkout, subscription, invoice, or storefront behavior.

## Required prerequisite evidence

The staging gate may proceed to future source work only because the following
prerequisite evidence already exists and has been committed:

- the source-only Supabase SQL/RPC package passed independent source review;
- the source-only local rehearsal harness passed independent source review;
- the local disposable rehearsal passed dry preflight, read-only preflight,
  apply, postflight, behavior, and rollback end to end;
- local rollback rehearsal passed and removed the exact approved security
  objects;
- the local rehearsal evidence checkpoint was committed.

If any of that evidence becomes stale, missing, contradicted, or superseded by
later source changes, staging must stop and return to source review first.

## Staging target boundary

The future staging gate must require all of the following:

- staging only;
- production explicitly forbidden;
- credentials entered locally by the operator only;
- no credentials in chat or agent context;
- no full connection strings in chat or agent context;
- no `.env` copy-paste into chat or agent context;
- no remote target unless it is explicitly confirmed as the Supabase staging
  database;
- exact staging Supabase project, ref, and host identity verified locally
  before apply;
- staging evidence recorded without secrets, passwords, tokens, or connection
  strings.

The staging guard must fail closed on ambiguous project identity, mixed
staging/production indicators, unknown hosts, or missing target evidence.

## Staging preflight phase

The future staging preflight must complete and be reviewed before any staging
apply is approved.

Required preflight checks:

- verify the target is staging and not production;
- verify connected database identity;
- verify project, ref, and host evidence matches the expected staging target;
- verify production-looking indicators are absent;
- verify required roles exist, especially `service_role`;
- verify the current operator can safely apply the migration;
- verify the approved migration is not already partially applied;
- verify no conflicting tables, RPCs, overloads, or callable surfaces exist;
- verify the route flag remains disabled;
- capture a baseline business-schema manifest before apply;
- capture a table-size baseline before apply;
- capture the approved migration file hash before apply;
- verify the preflight itself does not mutate business data.

Preflight evidence must be compact and safe to review in chat. A staging apply
must remain blocked until preflight evidence is reviewed and approved.

## Staging apply phase

The future staging apply phase must require separate approval after preflight
evidence review.

The apply step must:

- apply only
  `supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`;
- require the exact typed confirmation
  `STAGING APPLY ADMIN READINESS SECURITY MIGRATION`;
- stop immediately on any identity mismatch, preflight drift, or partial-state
  contradiction.

The apply step must continue to forbid:

- production targets;
- route enablement;
- runtime adoption;
- M030 issuance;
- approval execution;
- merchant activation;
- collection unlock;
- payment, provider, checkout, subscription, invoice, or storefront behavior.

## Staging postflight phase

The future staging postflight must verify the applied state without expanding
scope beyond the approved security objects.

Required postflight checks:

- exactly three approved tables exist;
- exactly the approved RPCs exist;
- no unexpected overloads or similarly named callable surfaces exist;
- RLS is enabled on all three tables;
- zero browser policies exist;
- direct table access for `anon` and `authenticated` is revoked;
- RPC execute for `anon` and `authenticated` is revoked;
- table and RPC grants remain `service_role` only;
- every approved RPC remains `SECURITY INVOKER`;
- every approved RPC keeps a hardened `search_path`;
- no raw token, JWT, cookie, header, or user-metadata columns exist;
- table-size evidence is captured after apply;
- the business-schema baseline is unchanged except for the approved security
  objects.

Any unexpected object, overload, grant, policy, column, or schema drift must
fail closed and block the next phase.

## Staging behavior phase

The future staging behavior phase must be separately approved after postflight
review.

The behavior phase must test only safe security-RPC behavior:

- CSRF create success;
- collision conflict;
- read or validate allow;
- expired token deny;
- session mismatch deny;
- rotate predecessor invalidation;
- binding invalidation bounded behavior;
- throttle allow;
- throttle `rate_limited`;
- cleanup expired records;
- malformed and out-of-bounds rejection;
- no raw diagnostics leakage.

The behavior phase must use:

- staging-safe namespace `admin_readiness_staging_v1`;
- test-only digests;
- cleanup or rolled-back transaction boundaries where possible;
- no business-table writes, reads beyond verification needs, or mutations.

Behavior evidence must remain compact and safe to paste into chat.

## Staging rollback posture

Local rollback was rehearsal only. Staging rollback is not automatic.

The staging posture must be:

- if staging apply passes and no blocker appears, leave the migration applied;
- if rollback is needed, require separate approval and a staging-specific
  rollback plan;
- keep the route flag disabled throughout.

If a separately approved staging rollback becomes necessary, the order remains:

1. keep the route flag disabled;
2. revoke exact RPC grants;
3. drop exact RPCs;
4. revoke table privileges;
5. drop only the three security tables;
6. verify removal;
7. verify the business-schema baseline.

## Evidence and redaction

Staging evidence must:

- use compact `PASS`, `FAIL`, `BLOCKED`, or `SKIPPED` lines;
- avoid passwords, tokens, and connection strings;
- avoid secrets;
- avoid raw JWT, cookie, and header values;
- be safe to paste into chat for review.

Evidence may include target identity summaries, object counts, file hash,
compact schema checks, and compact behavioral results as long as no sensitive
material is exposed.

## Free-tier and storage checks

The staging gate must include storage evidence because the current Phase 2
Supabase path is designed for bounded Free-tier-compatible use.

Required checks:

- table-size baseline before apply;
- table-size evidence after postflight;
- cleanup proof;
- expected row-count bounds;
- 400 MB database-size upgrade-review trigger reminder;
- confirmation that no indefinite retention is introduced.

If staging evidence suggests unsafe growth, excessive write pressure, or weak
cleanup posture, the gate must stop before any route-enable discussion.

## Staging success criteria

The staging gate should be considered `PASS` only if all of the following are
true:

- preflight passes;
- apply passes;
- postflight passes;
- behavior passes;
- the business-schema baseline is unchanged except for the approved security
  objects;
- the route flag remains disabled;
- no business mutation occurs;
- production is untouched;
- runtime adoption does not occur.

## Forbidden next actions without separate approval

The staging gate design authorizes none of the following:

- production apply;
- route enablement;
- runtime adoption;
- admin UI release;
- live M030 readiness traffic;
- approval execution;
- merchant activation;
- collection unlock;
- payment, provider, checkout, subscription, invoice, or storefront behavior.

## Recommended next sequence

1. Review and commit this staging gate design.
2. Implement source-only staging scripts or adapt the harness with
   staging-specific guards.
3. Independently review the staging source package.
4. Let the user run staging preflight only.
5. Review the staging preflight evidence.
6. Approve staging apply only if preflight evidence passes.
7. Run staging postflight.
8. Run staging behavior checks.
9. Record a staging evidence checkpoint.
