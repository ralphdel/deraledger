# Admin Readiness Staging Migration Harness Source Checkpoint

Date: 2026-08-30

## Source-only status

This checkpoint records source-only, user-run staging harness scripts for the
committed admin-readiness Supabase security migration. This task did not run a
script, connect to a database, execute SQL, apply a migration, change an
environment, or touch staging or production.

The source-only scripts are:

- `scripts/admin-readiness-security-staging-preflight.ps1`
- `scripts/admin-readiness-security-staging-apply.ps1`
- `scripts/admin-readiness-security-staging-postflight.ps1`
- `scripts/admin-readiness-security-staging-behavior.ps1`

They support only the exact migration
`supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`.
No staging rollback script is created: rollback remains a separate,
staging-specific approval and plan.

## Staging target and evidence boundary

Each script anchors the approved non-secret staging identity in reviewed source:
project ref `fsjljliiyfchkwbjifzw` and direct database host
`db.fsjljliiyfchkwbjifzw.supabase.co`. It prompts locally for separate host,
port, database, user, and a project-ref confirmation, but that confirmation is
not authority: the entered host must exactly equal the source-approved host and
the ref parsed from that host and separately confirmed by the operator must
exactly equal the source-approved ref. Any other syntactically valid opaque
Supabase ref fails closed. The scripts never accept a connection string,
reject local/loopback targets and production-looking indicators, and fail
closed on ambiguous identity. Passwords are prompted as secure local input
only, are not echoed or written to disk, and inherited PostgreSQL environment
settings are cleared around each later user-run `psql` invocation and restored
afterward.

Compact evidence is written only under
`local-evidence/admin-readiness-security/staging/`. Evidence contains
PASS/FAIL/BLOCKED/SKIPPED state, target fingerprints, migration hash, and
approved-object summaries; it excludes credentials, passwords, tokens,
connection strings, raw JWTs, cookies, headers, and diagnostics.

`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` remains disabled. The scripts fail
if it is `true` in process, user, or machine scope. They do not enable routes,
adopt runtime behavior, issue M030, execute approvals, activate merchants,
unlock collection, or introduce payment/provider/checkout/subscription/invoice
or storefront behavior.

## User-run sequence after separate approvals

1. Run staging preflight only after separate approval, optionally with its
   explicit read-only metadata check.
2. Review compact preflight evidence before any state-changing command.
3. Run staging apply only after separate approval and type
   `STAGING APPLY ADMIN READINESS SECURITY MIGRATION` exactly.
4. Run staging postflight and review the exact object, RLS, grant,
   `SECURITY INVOKER`, `search_path`, table-size, and baseline checks.
5. Run staging behavior checks only after separate approval and type
   `STAGING RUN ADMIN READINESS SECURITY BEHAVIOR CHECKS` exactly. The test uses
   `admin_readiness_staging_v1`, test-only digests, and a rolled-back
   transaction.
6. Record a compact staging evidence checkpoint.

Local rehearsal evidence is a prerequisite only; it does not authorize staging
execution. Staging and production remain untouched, and the route flag remains
disabled until later independent review and separate approval.
