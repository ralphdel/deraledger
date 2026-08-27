# Production super-admin access recovery design

Date: 2026-08-27

## Status and safety boundary

This is a design-only plan. It authorizes no SQL, database connection,
Supabase Auth Admin call, dashboard mutation, Vercel change, login attempt, or
runtime integration. Production super-admin access must be restored and
verified before the future canonical approval reviewer resolver can be used by
an admin API. Runtime adoption, approval execution, activation, collection
unlock, payment/provider testing, and storefront work remain prohibited.

## Current problem

After the new production database was created, production super-admin
login/session authority no longer works. Administrative login details may be
present in Vercel environment variables, but those values are not a verified
Supabase Auth session and cannot establish reviewer authority for the
canonical approval readiness resolver.

The resolver requires a real production user authenticated through the
cookie-bound server auth client. `auth.getUser()` must resolve that user and
the server must be able to derive the user's platform super-admin authority.

## Desired safe state

Exactly one intended production administrator is verified for the immediate
recovery scope:

- a real `auth.users` account can log in to production;
- its immutable production user ID is known from a read-only diagnostic;
- its server-readable platform authority is `super_admin`;
- a production session can be resolved by `auth.getUser()`;
- a future server-only reviewer resolver can derive `super_admin` from that
  authenticated session without browser-supplied claims.

This does not authorize a compliance decision, collection capability,
activation, or any commercial behavior.

## Authority source recommendation

The immediate, temporary authority can follow the existing application
`is_super_admin === true` convention. The intended long-term authority should
be a server-controlled `app_metadata.is_super_admin` claim or a separately
designed platform staff-grant authority.

Browser-writable `user_metadata` must not be the long-term authorization
source. A repair must not rely on an email, Vercel environment value,
admin-portal password, request header, or UI-provided role as proof of
super-admin status.

## Recovery options

### Option A — restore/create the intended Auth user

Use Supabase Auth Admin/API or the Supabase dashboard to create or restore the
identified production `auth.users` account, then set
`app_metadata.is_super_admin = true` through a server-controlled Auth Admin
operation. This is appropriate only after a read-only diagnostic proves the
target user does not already exist and the identity is unambiguous.

### Option B — repair an existing Auth user

If the diagnostic proves the intended account already exists, do not create a
second user. Repair only its server-controlled app-metadata claim through a
narrow Auth Admin/dashboard operation, then verify a new real production
session.

### Option C — future platform staff grant

A dedicated platform staff-grant table/model can later replace metadata-based
authorization. It is not required for immediate access recovery and must be a
separate additive design, migration, security review, local rehearsal, and
production gate.

## Safety checks before any mutation

1. Confirm the exact intended production administrator email and independent
   human identity through an approved out-of-band process.
2. Run a production read-only Auth diagnostic for exact user identity, user
   ID, provider/login state, and current app/user metadata.
3. Confirm whether an Auth user already exists and reject duplicate or
   ambiguous email/identity results.
4. Cross-check the target against merchant/customer identities so a customer
   or merchant account is not accidentally promoted.
5. Record current metadata before any change; do not copy secrets, password
   values, session tokens, or provider credentials into repository evidence.
6. Confirm the selected repair is Option A or Option B and targets exactly one
   immutable Auth user ID.

## Proposed read-only diagnostic checklist

- Create a timestamped local production diagnostic evidence directory outside
  tracked source.
- Query or inspect only the exact intended Auth identity; record redacted user
  ID, existence/count, verified identity facts, and app/user metadata keys.
- Check for duplicate/ambiguous candidates and current super-admin claim.
- Confirm the existing application authority convention by reviewing
  `requireSuperAdminSession` and the relevant server-only access pattern.
- Produce explicit PASS/FAIL results for target uniqueness, no accidental
  merchant/customer promotion, and repair eligibility.
- Stop on ambiguity, wrong identity, or any unexpected Auth state; do not
  create or promote an account.

## Proposed narrow repair checklist

This requires separate approval after the diagnostic passes.

1. Prepare a production-only, Auth Admin/dashboard repair with no database
   table mutation and no application runtime changes.
2. Target one pre-verified immutable `auth.users.id` only.
3. For Option A, create/restore only the intended Auth account. For Option B,
   update only its server-controlled app metadata.
4. Set only the reviewed super-admin claim; do not alter merchant, workspace,
   compliance, payment, provider, subscription, invoice, collection, or
   activation state.
5. Capture redacted repair evidence and stop if the resulting identity or
   metadata differs from the approved target.

## Proposed post-repair verification checklist

- Verify one intended production user can complete the normal Supabase Auth
  login flow without exposing credentials in logs.
- Verify a fresh cookie-bound server session resolves through `auth.getUser()`
  to the expected immutable user ID.
- Verify the server-read app-metadata authority yields `super_admin` through a
  narrow test/read-only check; do not invoke readiness RPCs or approval RPCs.
- Verify anonymous, merchant/team, customer, and ordinary authenticated users
  remain denied in the future resolver test seam.
- Save redacted login/session evidence separately from code, then record a
  documentation checkpoint. Runtime adoption remains NO.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Wrong user is promoted | Require exact immutable Auth ID, one candidate, and independent identity confirmation. |
| Browser-writable metadata becomes authority | Prefer app metadata now; separately design a durable staff grant later. |
| Admin-portal/Vercel password is mistaken for Auth authority | Require a real production `auth.getUser()` session after repair. |
| Duplicate Auth account | Diagnose first; Option B repairs existing account when present. |
| Production credentials leak | Use secure prompts/dashboard or local secret storage; save only redacted evidence. |
| Repair expands into business behavior | Restrict scope to one Auth identity and one reviewed authority claim. |

## Open questions

- What exact production super-admin email and human identity should be
  restored?
- Does that account already exist in production `auth.users`?
- Can the current Supabase dashboard/Auth Admin workflow update app metadata
  safely for the verified user?
- Which production path currently invokes `requireSuperAdminSession`, and does
  it read app metadata, user metadata, or both?

## Explicit forbidden actions

Do not create or apply SQL migrations. Do not mutate staging. Do not run a
production repair until separately approved. Do not wire the resolver to an
API, route, action, page, or webhook. Do not issue M030 requests, execute M026
approval, activate merchants, unlock collection, change setup/live flags,
create limits, call providers, initialize checkout, or mutate payment,
provider, settlement, invoice, subscription, or storefront data.

## Safe next step

Independently review this design. Then prepare a separate read-only,
production-only diagnostic runbook/script that uses redacted evidence and
cannot mutate Auth or application data. A repair package may be designed only
after the diagnostic identifies one unambiguous target.
