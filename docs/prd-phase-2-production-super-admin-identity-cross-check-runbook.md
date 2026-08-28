# Production super-admin identity cross-check runbook

## Scope and boundary

This runbook prepares one production-only, read-only PostgreSQL cross-check for
the restored platform super-admin identity. It verifies that the exact Auth
user ID and email do not also appear as a merchant owner, merchant team member,
customer, workspace owner, business owner, or obvious application user/profile
identity where those tables exist.

It performs no SQL mutation, no Supabase Auth mutation, no Vercel change, no
runtime endpoint call, no M030 readiness request, no approval execution, no
activation, no collection unlock, and no payment/provider/checkout/
subscription/invoice/storefront workflow.

## Runtime inputs

The script prompts for discrete production database inputs only:

- host
- port
- database
- user
- password through `Read-Host -AsSecureString`
- target email
- target Auth user ID

It does not accept or require a connection string.

## Command

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-production-super-admin-identity-cross-check.ps1
```

Enter the exact confirmation phrase:

```text
READ ONLY PRODUCTION SUPER ADMIN IDENTITY CROSS CHECK
```

## Safety checks

- The script rejects local hosts such as `localhost` and `127.0.0.1`.
- The script rejects invalid email or Auth user ID input.
- The script uses `psql` through `Start-Process` with discrete `-h`, `-p`,
  `-U`, `-d`, and `-f` arguments.
- The generated SQL is read-only and `SELECT`-only.
- Optional tables are guarded with `to_regclass(...)` before query generation.
- Missing optional tables are recorded as `NOT_PRESENT`; they do not crash the
  run.

## Cross-check coverage

The script always proves exact `auth.users` ID/email presence first. It then
checks these categories when the underlying tables exist and their identity
columns are available:

- `public.merchants`: `user_id` and `email`
- `public.merchant_team`: `user_id`
- `public.customers`: `user_id` and `email`
- `public.customer_profiles`: `user_id` and `email`
- `public.workspaces`: `owner_user_id`
- `public.businesses`: `owner_user_id` and `email`
- `public.profiles`: `user_id` and `email`
- `public.user_profiles`: `user_id` and `email`
- `public.clients`: `user_id` and `email`

If a present optional table lacks both expected identity columns, the run is
recorded as `MANUAL_REVIEW` unless a direct identity collision is found.

## Result rules

- `PASS`: exact Auth user exists and no merchant/customer/team/business/profile
  identity collision is found.
- `MANUAL_REVIEW`: no collision is found, but at least one present optional
  table has unknown identity structure.
- `FAIL`: the exact Auth user is missing/mismatched, an identity collision is
  found, the database request fails, confirmation mismatches, or unsafe input is
  supplied.

## Evidence rules

Redacted evidence is written to:

```text
.local-evidence/production-super-admin-identity-cross-check-YYYYMMDD-HHMMSS
```

The evidence records only:

- target email SHA-256 hash
- suffix-redacted Auth user ID
- exact Auth user status
- table/category match counts
- `PASS`, `MANUAL_REVIEW`, or `FAIL`

The evidence never records:

- database password
- connection string
- full email
- full Auth user ID
- merchant/customer personal details

## Stop conditions

Stop and do not repair if:

- the confirmation phrase is wrong
- the host is local
- the email or Auth user ID is invalid
- the database request fails
- the exact Auth user cannot be proved
- a merchant/customer/team/business/profile collision is found

If the result is `MANUAL_REVIEW`, stop and escalate with the redacted evidence
only.

## Safe next step

If the result is `PASS`, record a checkpoint and only then move to the next
separately reviewed production-safe admin-access step. If the result is
`MANUAL_REVIEW` or `FAIL`, stop and review the redacted evidence before any
repair or runtime integration work.
