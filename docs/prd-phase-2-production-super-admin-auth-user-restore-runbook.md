# PRD Phase 2: Production Super-Admin Auth User Restore Runbook

## Objective

Manually restore or create the missing production Supabase Auth user for `ralphdel14@yahoo.com` and set server-controlled super-admin authority, using a dashboard-first production workflow.

## Manual Repair Scope

- Manual/dashboard-first only.
- No script execution in this runbook.
- No Auth Admin API script yet.
- No DB SQL.
- No Vercel changes.
- No runtime wiring.
- No M030 request issuance.
- No approval execution.
- No activation.
- No collection unlock.
- No payment, provider, checkout, subscription, invoice, or storefront work.

## Preconditions

- Confirm the production Supabase project before starting.
- Confirm the exact target email is `ralphdel14@yahoo.com`.
- Confirm the target email is absent immediately before creation, or that the existing identity is the intended one and can be repaired safely.
- Confirm there is no duplicate or ambiguous Auth identity.
- Confirm this is the protected platform super-admin identity, not a merchant-facing sandbox or customer account.
- Confirm the person performing the work understands that Vercel `ADMIN_PORTAL_USER/PASS` values are not Supabase Auth reviewer authority.

## Manual Repair Steps

1. Open the production Supabase dashboard.
2. Locate the Auth user record for `ralphdel14@yahoo.com`.
3. If the user does not exist, create or restore exactly one production Auth user for that email.
4. Use a secure password setup or reset flow.
5. Do not store the password in the repo, terminal logs, screenshots, or evidence files.
6. Set server-controlled `app_metadata.is_super_admin = true`.
7. Do not rely on `user_metadata` as the long-term authority source.
8. Do not touch merchant, customer, profile, payment, provider, or other commercial data.

## Evidence Rules

- Record a timestamped local evidence folder name for the repair attempt.
- Capture a redacted Auth user ID suffix only.
- Capture the email as a hash or redacted form.
- Record that `app_metadata.is_super_admin = true` was observed.
- Do not save secrets, passwords, tokens, full metadata dumps, or the full Auth user ID in repo-tracked files.

## Verification Steps

- Verify the user can complete a normal production login.
- Verify server-side `auth.getUser()` resolves the session.
- Verify `app_metadata.is_super_admin = true` is readable server-side.
- Verify no readiness RPC, approval RPC, activation, collection unlock, payment, provider, checkout, subscription, invoice, or storefront workflow is triggered during verification.

## Stop Conditions

- The email already exists with the wrong identity.
- Duplicate Auth identities are present.
- `app_metadata` cannot be set safely.
- Login cannot be verified.
- `auth.getUser()` cannot resolve the session.
- There is any uncertainty about the production project or the intended target identity.

## Forbidden Actions

- No SQL.
- No service role key pasted into the repo.
- No script-based Auth mutation yet.
- No Vercel env change as authority.
- No admin API or runtime integration.
- No business workflow testing.
- No readiness or approval execution.
- No activation or collection unlock.

## Post-Run Documentation

- If the repair succeeds, prepare a separate checkpoint doc after the manual repair is verified.
- If the repair fails or is ambiguous, stop and report only redacted evidence.

## Recommended Next Step

- Perform the production dashboard repair only after the exact target identity is reconfirmed and the evidence rules are understood.
- Then produce a separate verified checkpoint doc for the successful repair.

