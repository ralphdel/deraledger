# Production super-admin Auth diagnostic runbook

## Scope and boundary

This runbook executes one read-only Supabase Auth Admin `GET` request for an
exact target email and verified immutable Auth user ID supplied at runtime. It
uses the documented user-by-ID endpoint, then fails closed unless the returned
user ID and email exactly match both supplied values. It does not sign in,
create or update an Auth user, modify metadata, query application runtime
endpoints, execute SQL, or change Vercel. It does not issue M030 readiness
requests, execute approval, activate a merchant, unlock collection, or perform
commercial work.

Run only after confirming the intended production administrator's exact email
and human identity through an approved out-of-band process. Vercel values are
credentials only; they are not reviewer authority.

## Preconditions

- You have the intended production super-admin email; do not add it to source
  control or paste it into a shared log.
- You have the intended account's verified immutable production Auth user ID;
  do not guess it and do not add it to source control.
- You have the production Supabase project URL using HTTPS and its
  `*.supabase.co` hostname.
- You have an approved production service-role/Auth-admin read credential and
  can enter it securely at the prompt.
- You understand that a failure or `MANUAL_REVIEW_REQUIRED` result means stop;
  this diagnostic performs no repair.

## Command

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\diagnose-production-super-admin-auth.ps1
```

Enter the exact confirmation phrase:

```text
READ ONLY PRODUCTION SUPER ADMIN AUTH DIAGNOSTIC
```

Preferred local credential flow:

```powershell
$env:DERALEDGER_PROD_SUPABASE_SERVICE_ROLE_KEY = Read-Host "Paste production service role key"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\diagnose-production-super-admin-auth.ps1 -ServiceRoleKeyEnvVarName "DERALEDGER_PROD_SUPABASE_SERVICE_ROLE_KEY"
```

Fallback flow:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\diagnose-production-super-admin-auth.ps1
```

The script prompts for the project URL, target email, verified Auth user ID,
and either reads the credential from the supplied local environment variable or
falls back to a secure prompt. It never prints or stores the credential value.
It prints only a safe credential fingerprint: length, SHA-256 first 12 hex
characters, and a coarse key-kind label. It writes only redacted evidence to:

```text
.local-evidence/production-super-admin-auth-diagnostic-YYYYMMDD-HHMMSS
```

## Expected evidence

The evidence contains an email hash, candidate count, redacted Auth user ID,
email-confirmation state, provider summary, app-metadata keys, safe
`is_super_admin` boolean, user-metadata keys, ambiguity status, repair
eligibility, and for request failures only a redacted HTTP status plus safe
Auth error code/message when available. It intentionally records
`MANUAL_REVIEW_REQUIRED` for the merchant/customer identity cross-check because
this runner has no approved read-only application-table path.

## Stop conditions

Stop and do not repair if the confirmation or URL is invalid, the request
fails, the Auth user is missing, the returned user ID/email differs from the
verified targets, metadata is unexpected, or the cross-check remains manual.
Share only the redacted evidence summary for review.

## Safe next step

After a clean diagnostic and manual identity cross-check, obtain separate
approval for a narrow production-only Auth repair design/runbook. Do not use
the result to wire the reviewer resolver or an admin API.
