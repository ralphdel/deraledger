# Canonical approval reviewer resolver design

Date: 2026-08-27

## Status and purpose

This is a design-only prerequisite for a future implementation of
`CanonicalApprovalReadinessReviewerResolver`. It authorizes no database work,
no approval decision, no M030 request issuance, no API route, and no admin UI.
Runtime adoption remains blocked.

The resolver has one responsibility: derive the actor supplied to the
canonical-readiness layer from the authenticated server session. It must never
accept a role, authority, origin, reviewer ID, email, header, or browser claim
as input to that decision.

## Proposed server-only boundary

Place a future implementation at:

`src/lib/compliance/server/canonical-approval-readiness-reviewer-resolver.ts`

The module must start with `import "server-only"` and export only a factory
returning `CanonicalApprovalReadinessReviewerResolver`. It must not export a
Supabase client, auth-admin API, generic table reader, generic RPC method,
service-role key, or a reusable role-query surface.

The factory should receive a narrow injected session reader for tests:

```ts
type ServerSessionUserReader = {
  getAuthenticatedUser(): Promise<{
    id: string;
    appMetadata: { is_super_admin?: unknown } | null;
    userMetadata: { is_super_admin?: unknown } | null;
  } | null>;
};
```

Its only operation, `resolveServerSessionReviewer`, performs the session read
and returns either `{ actorKind: "super_admin", reviewerId }` or a safe
non-authorized/null outcome. It does not receive caller values.

## Authority source

For the current source contract, identity comes from the cookie-bound server
Supabase auth client via `auth.getUser()`, following the established
`requireSuperAdminSession` and Solo Plus server-access patterns. The immutable
authenticated `user.id` is the reviewer ID.

The presently supported platform authority is the existing server-read
`is_super_admin === true` convention. The implementation must inspect the
authenticated user's metadata only after `auth.getUser()` verifies the session;
it must never consume a metadata object sent by the browser. Current source
uses `app_metadata.is_super_admin` or `user_metadata.is_super_admin`; a future
RBAC hardening package should make an audited platform-owned app-metadata claim
or dedicated immutable staff-grant authority the sole source.

No service-role access is needed for the current super-admin decision. If a
future implementation needs a staff-grant lookup, it must use a separately
reviewed, private, read-only narrow dependency that returns only the one
authorization fact for the authenticated user. It must not use a broad admin
or commerce client.

## Production super-admin access prerequisite

Production super-admin login and session authority must be restored and
verified before any admin API or runtime integration is considered. The new
production database currently does not provide the user with a verified
super-admin login/session, so the future resolver cannot yet be used as a
production runtime boundary.

Old or administrative login details that may exist in Vercel environment
variables are not reviewer authority. They cannot substitute for a real,
authenticated production Supabase user returned by the cookie-bound
`auth.getUser()` call. The resolver must derive the reviewer only from that
verified production session and its server-read platform authorization facts.

Any production super-admin bootstrap or recovery must be separately designed,
reviewed, and executed through a narrow production-safe script with its own
preflight, postflight, evidence, and rollback/fail-closed posture. This design
authorizes none of that work. No resolver implementation may be wired into a
runtime entrypoint until production super-admin access has been verified.

## Authorization algorithm

1. Call the injected cookie-bound server-session reader.
2. Reject on reader error, missing session, missing/invalid user ID, or an
   anonymous user.
3. Evaluate only server-read platform metadata for `is_super_admin === true`.
4. Return `super_admin` with that session user ID only when the check passes.
5. Return a denied/non-authorized outcome for every other actor. Do not infer
   authority from merchant ownership, team membership, customer identity,
   email/domain, `admin_session` alone, request headers, origin fields, or a
   caller-provided reviewer ID.
6. Do not query profile/source data and do not construct readiness transport
   until the caller separately invokes the readiness layer with this resolver.

`compliance_reviewer_deferred` remains denied. It becomes eligible only after
a separate platform-scoped role design defines grant provenance, expiry,
revocation, audit, and conflict handling.

## Fail-closed outcomes

| Condition | Resolver outcome |
| --- | --- |
| Missing, invalid, or anonymous session | `null` or non-authorized actor |
| Session-reader/RBAC error | `null`; no raw error leakage |
| Merchant owner/team, customer, or ordinary platform user | non-authorized actor |
| Browser/client-origin or claimed authority | ignored; never an input |
| Missing/invalid user ID | non-authorized actor |
| Deferred compliance reviewer | `compliance_reviewer_deferred`, denied by readiness core |
| Verified platform super-admin | `super_admin` with server-derived user ID |

The readiness core already maps all non-`super_admin` outcomes and resolver
exceptions to `canonical_readiness_authority_denied` before RPC transport use.

## Explicit boundaries

The resolver must not execute an approval decision or issue/read an M030
request itself. It must not read or mutate profiles, merchants, workspaces,
canonical links, payments, providers, settlements, invoices, subscriptions,
checkout resources, limits, or storefront resources.

It must not activate a merchant, change setup/live flags, alter collection
entitlement, unlock collection, or call external providers. It produces only a
redacted reviewer classification and ID for the injected readiness dependency.

## Gaps before implementation

- Current `is_super_admin` metadata can be read from both app and user
  metadata. The authoritative, write-controlled claim source is not yet
  formally specified; browser-writable user metadata should not be the
  long-term authority.
- There is no platform-scoped compliance-reviewer grant model.
- `requireAdminPortalSession` is not sufficient by itself because it does not
  derive a reviewer identity or approval-specific platform authorization.
- The concrete cookie-bound session-reader adapter needs an independent source
  review to confirm it cannot be imported in browser code and does not expose
  session tokens or a generic client.

## Implementation and test plan

Implement only after this design is independently reviewed. Use an injected
fake session reader to prove:

- a server-derived super-admin is accepted;
- a claimed super-admin supplied alongside an ordinary session is ignored;
- merchant, team, customer, anonymous, missing-session, and deferred actors
  are denied;
- reader/RBAC failures reject without raw details;
- resolver execution occurs before readiness RPC transport;
- no routes, pages, actions, or webhooks import the resolver;
- the module exposes no generic client/table API and contains no forbidden
  writes, activation, collection, payment, provider, invoice, subscription,
  checkout, or storefront operations.

The resolver remains unbound to any runtime entrypoint after implementation.
Any admin API integration requires a later, separately approved design and
review gate.
