# Admin readiness local rehearsal harness source checkpoint

Date: 2026-08-30

## Source-only status

This checkpoint records source-only PowerShell harnesses for the committed admin-readiness Supabase security migration. No script was run by this task, no SQL was executed, and no database connection was made.

The new user-run scripts are:

- `scripts/admin-readiness-security-local-preflight.ps1`
- `scripts/admin-readiness-security-local-apply.ps1`
- `scripts/admin-readiness-security-local-postflight.ps1`
- `scripts/admin-readiness-security-local-behavior.ps1`
- `scripts/admin-readiness-security-local-rollback.ps1`

Each script independently prompts for separate local connection fields, rejects connection strings and non-loopback hosts, requires a disposable database name, rejects staging/production-looking names, and writes compact credential-free evidence only under `local-evidence/admin-readiness-security/`. The staging/production checks are rejection guards only, not target requirements. The local Supabase/Postgres default database name `postgres` is permitted only for `localhost` or `127.0.0.1`, port `55432`, and user `postgres`, after the typed local-disposable confirmation and passing server-identity checks. The scripts never use PowerShell's `$Host` variable, never echo or persist passwords, use UTF-8 evidence, and require only `psql` when the user later runs them. Docker Desktop, WSL, and the Supabase CLI are not prerequisites.

## Run boundaries

The route flag remains disabled. `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` must remain absent or false; the scripts block if process, user, and machine scopes contain `true`. No route enablement, runtime adoption, live M030 issuance, final approval execution, activation, collection unlock, or payment/provider/checkout/subscription/invoice/storefront behavior is included.

No database was touched: local, staging, and production remain untouched. No environment, provider, or credential setup occurred.

## User-run sequence after separate approval

1. Run preflight only.
2. Review the compact local evidence.
3. Run apply only after a separate explicit approval and type its exact confirmation.
4. Run postflight.
5. Run behavior tests; they use `admin_readiness_local_v1` and roll back their own test transaction.
6. Run rollback only if explicitly instructed, after typing its separate exact confirmation.

The next safe step is an independent source review of this harness. Local rehearsal itself remains pending separate approval.
