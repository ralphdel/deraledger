# PRD Phase 2: Production Super-Admin Auth User Restore Design

## Objective

Design a safe, reviewable path to restore or create the missing production Supabase Auth user for `ralphdel14@yahoo.com` and assign server-controlled super-admin authority, without changing runtime behavior yet.

## Current State

- `ralphdel14@yahoo.com` is missing from production Supabase Auth after the new production database was created.
- No immutable production Auth user ID exists yet for this identity.
- Existing `Vercel` admin-portal credentials are not sufficient authority for the canonical approval readiness resolver.
- Production login/session authority for the intended super-admin is therefore not currently available.

## Desired State

- Exactly one production Supabase Auth user exists for `ralphdel14@yahoo.com`.
- The user can complete a normal production login.
- `auth.getUser()` resolves the production session successfully.
- Server-controlled `app_metadata.is_super_admin = true` is present.
- `user_metadata` is not treated as long-term authority.
- The user can later be resolved by the server-session reviewer resolver as a real authenticated production super-admin.

## Restore / Create Options

### Option A: Create or restore via Supabase Dashboard Auth

- Create the missing production Auth user directly in Supabase Dashboard Auth if the user is absent.
- Confirm the email is exactly `ralphdel14@yahoo.com`.
- Set or repair `app_metadata.is_super_admin = true` using a server-controlled mechanism that is separately reviewed.
- Use a password setup or reset flow without storing the password in the repo or logs.

### Option B: Restore via Supabase Auth Admin API

- Use the Auth Admin API only if the repair plan is separately reviewed and approved.
- Create the user with `email_confirm = true` only if the workflow is explicitly reviewed for production safety.
- Apply the same server-controlled `app_metadata.is_super_admin = true` post-create.

### Option C: Future platform staff model

- A dedicated platform staff-grant model may be designed later if needed.
- This is not required for immediate recovery.
- It must not delay the immediate goal of restoring one verified production super-admin session.

## Authority and Metadata Plan

- Primary server-readable authority should come from `app_metadata.is_super_admin = true`.
- `user_metadata` must not be relied on as the durable authority source.
- Browser-writable metadata must not be the long-term trust anchor.
- No merchant, customer, profile, payment, provider, subscription, invoice, checkout, or storefront data should be changed as part of recovery.

## Safety Checks

- Confirm the exact target email before any repair action.
- Confirm the Auth user is absent immediately before creation, or present and repairable if restoring metadata only.
- Confirm there is no duplicate account ambiguity.
- Confirm no merchant, customer, or other non-platform identity is being promoted by mistake.
- Confirm credentials are handled outside the repository.
- Confirm the intended human identity is reviewed and approved before any production action.
- Confirm the recovery action is narrowly scoped and separately reviewed before execution.

## Recovery Execution Gate

- Any actual production repair must use a separately reviewed production-only runbook or manual dashboard checklist.
- The execution step must require an exact confirmation phrase.
- Evidence must be redacted and limited to what is needed to verify the outcome.
- No runtime integration should be enabled until production super-admin access is restored and verified.

## Post-Recovery Verification

- Verify the user can log in successfully.
- Verify `auth.getUser()` returns the expected production user.
- Verify `app_metadata.is_super_admin` is readable server-side.
- Verify the restored identity is the intended production super-admin.
- Verify no readiness RPC, approval RPC, activation, collection unlock, payment, provider, checkout, subscription, invoice, or storefront workflow is triggered during verification.

## Sandbox / Test Account Policy

- The platform super-admin identity and any merchant-facing sandbox identity must remain separate.
- If a production sandbox account is ever needed, it must be a locked internal test-only identity.
- That future sandbox identity must not share super-admin authority.
- Live collection unlock and provider testing are not part of this recovery plan.
- Any sandbox/test account design belongs in a separate future package.

## Risks

- Promoting the wrong user.
- Relying on `user_metadata` instead of server-controlled authority.
- Confusing Vercel admin-portal credentials with a real Supabase Auth session.
- Creating a duplicate production Auth user.
- Exposing production credentials or passwords in logs or repo files.
- Accidentally crossing into approval, activation, or business-workflow behavior during recovery.

## Open Questions

- What is the exact intended production super-admin email and human identity?
- Does the production Auth user already exist in `auth.users` under a different state?
- Which server-controlled metadata path is currently trusted by the app for super-admin authority?
- Can the required metadata update be completed safely through a reviewed production workflow?
- Is a password reset preferable to a fresh user creation flow?

## Forbidden Actions

- Do not run Supabase Auth Admin without a separately reviewed production-safe plan.
- Do not mutate production DB state beyond the narrowly reviewed recovery step.
- Do not change Vercel environment variables as the source of reviewer authority.
- Do not wire runtime approval/readiness integration.
- Do not issue any M030 request.
- Do not execute approval.
- Do not activate merchants.
- Do not unlock collection.
- Do not touch payment, provider, checkout, subscription, invoice, or storefront systems.

## Recommended Next Step

- Review and approve this design.
- Then prepare a separately reviewed production-only diagnostic or repair runbook for the exact intended production super-admin identity.
- Only after that should any production Auth recovery be executed.

