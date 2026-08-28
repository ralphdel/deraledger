# Admin readiness CSRF lifecycle design

Date: 2026-08-28

## Status and scope

This is a design-only CSRF lifecycle plan for future admin readiness issue and
snapshot routes. It creates no code, route, page, action, webhook, admin UI,
database access, or runtime adoption.

It does not issue an M030 request from a live handler, execute a final
approval, activate a merchant, unlock collection, or perform payment,
provider, checkout, subscription, invoice, or storefront behavior. It does
not establish reviewer authority, implement future RBAC, or manage
super-admin or staff identities.

This document exists to unblock later route implementation planning. No live
route may be created until this lifecycle, the admin security prerequisites,
and the route contract are all independently reviewed and approved.

## Recommended CSRF model

The recommended model for future `admin.deraledger.com` readiness routes is a
synchronizer token bound to the authenticated admin session, with same-origin
browser checks as additional defense in depth.

The synchronizer model is preferred over a signed double-submit token because:

- the future admin routes are intended to be server-rendered and
  cookie-authenticated through a server-only session boundary;
- the token can be stored server-side or in a server-verified signed envelope
  without relying on browser-readable authority material;
- it keeps the trust model simple: authentication comes from
  `auth.getUser()`, CSRF comes from a separate session-bound token, and the
  two are never conflated;
- it reduces the chance that a future implementation accidentally treats a
  cookie echo or browser claim as equivalent to server-verified session state.

A signed double-submit token may remain a fallback option only if later
Next.js deployment constraints make a synchronizer-token lifecycle
operationally impractical. If that fallback is ever considered, it requires a
separate reviewed threat analysis and cannot be treated as interchangeable by
default.

## Token issuance

The future system should issue a CSRF token only after an authenticated admin
session has already been established and server-side session resolution is
available.

The proposed issuance moment is:

- during future admin portal bootstrap after authenticated server rendering, or
- from a future narrow internal endpoint such as
  `POST /api/internal/admin/security/csrf`, proposed only and not implemented
  by this document

The issuance surface is proposed only. No route is created now. The issuance
operation must be separate from readiness `issue` and `snapshot` behavior and
must never issue M030 requests, execute approvals, or make business-state
changes.

The token issuer must not grant reviewer authority. A valid token only proves
that a browser request can present matching anti-CSRF evidence for an already
authenticated session. It cannot replace `auth.getUser()` or the reviewer
resolver.

## Token binding

The token must be bound to the authenticated admin session and invalid outside
that session context. Binding should incorporate a server-derived session
reference that changes when any of the following changes:

- the authenticated user
- the authenticated session
- logout
- forced reauthentication
- session replacement after metadata refresh or elevated-auth recovery

The token is not reviewer authority. The future route must still resolve the
authenticated user through `auth.getUser()`, pass that through the session
reader and reviewer resolver, and require
`app_metadata.is_super_admin === true`.

The binding model must not trust caller-supplied user IDs, emails, cookies,
headers, JWT claims, origins, or browser-provided role data. It must compare
only server-derived session context against the submitted token evidence.

## Token storage

The preferred storage and transport model is:

- a server-generated CSRF token stored in a server-validated session-bound
  record or signed envelope;
- a browser-readable transport copy delivered through a reviewed non-HttpOnly
  cookie or a server-rendered response value only if needed for submission;
- submission back to the route through a dedicated header such as
  `X-CSRF-Token`, not through authority fields or query parameters.

Storage rules:

- the authenticated Supabase session cookie remains `HttpOnly` and remains the
  only session authority source;
- the CSRF token must not be treated as secret reviewer authority, but it
  should still be protected from accidental exposure and broad reuse;
- `Secure` is required in production;
- `SameSite` should be reviewed together with the admin deployment model, but
  must not be the only CSRF control;
- the token must not be logged, echoed in errors, written to evidence, or
  persisted in local storage;
- query-string carriage is forbidden because it leaks into URLs, browser
  history, referrers, and logs.

If a signed envelope is used, the server-side verifier must treat that as
integrity protection for CSRF state, not as a replacement for session
validation or reviewer authorization.

## Validation flow

The future issue route must require a valid CSRF check before the readiness
service factory is created and before any readiness call is attempted. The
required future order remains:

1. correlation ID generation
2. JSON parse and duplicate-key rejection
3. strict command validation
4. origin/CORS policy checks
5. CSRF validation
6. rate limit
7. service factory construction
8. readiness call
9. safe response mapping
10. safe logging

Validation must fail closed for:

- missing token
- expired token
- malformed token
- invalid signature or server envelope
- session mismatch
- logout-invalidated token
- token presented for the wrong operation or wrong method, if operation
  binding is part of the final implementation

The snapshot route should follow the same CSRF policy unless a future
independent review explicitly approves a narrower read-only exception. Until
that exception exists in writing, assume snapshot requires the same CSRF gate.

CSRF denial must happen before throttle and before any M030-backed readiness
transport is reachable.

## Rotation and expiry

The CSRF lifecycle should include bounded expiry and explicit invalidation.

Recommended baseline:

- short rolling lifetime tied to the authenticated session, such as 15 to 60
  minutes from issuance or refresh;
- refresh on future admin bootstrap or explicit CSRF refresh endpoint, proposed
  only;
- immediate invalidation on logout;
- immediate invalidation on session replacement, forced reauthentication, or
  security-sensitive auth context changes;
- forced renewal after metadata changes when session freshness is uncertain,
  rather than trusting stale tokens alongside stale session claims.

The exact TTL should be chosen during implementation review together with
cookie/session refresh behavior. The important boundary is that expired or
session-stale tokens deny safely and require a controlled refresh path.

## Error and logging boundary

CSRF failures must return only a safe opaque denial result. They must not
expose:

- raw token values
- token hashes
- cookie values
- header values
- comparison inputs
- signing details
- session identifiers
- stack traces
- low-level verifier errors

Operational logs may record only:

- timestamp
- operation name
- correlation ID
- safe result kind or code such as `csrf_denied` or `csrf_unavailable`
- an approved redacted identifier if separately needed

No raw token, cookie, header, metadata, or secret may be logged or returned.

## CORS and origin boundary

`Origin`, `Referer`, and Fetch Metadata such as `Sec-Fetch-Site` remain
defense-in-depth checks only. They are not reviewer authority and they are not
a substitute for CSRF token validation.

The preferred deployment remains same-origin on `admin.deraledger.com`. If a
future reviewed deployment uses cross-origin browser requests, CORS policy must
still not replace CSRF. The route must require both the approved origin policy
and the approved CSRF proof for browser-credentialed requests.

Wildcard credentialed CORS remains forbidden.

## Rate-limit ordering

CSRF validation must run before rate limiting and before any readiness service
construction or transport use. This ordering prevents malformed or missing CSRF
requests from reaching M030-backed readiness behavior and keeps the throttle
from becoming a side channel for invalid browser-state probing.

If a later implementation needs coarse pre-CSRF abuse handling, that must be a
separate reviewed edge or network control and must not weaken the in-route
CSRF-before-service rule.

## Proposed future implementation files

The following files are proposed only and are not created by this document:

- `src/lib/compliance/server/admin-readiness-route-csrf.ts`
- `src/lib/compliance/server/admin-readiness-csrf-token.ts`
- `src/lib/compliance/server/admin-readiness-csrf-storage.ts`
- `src/lib/compliance/server/admin-readiness-csrf-issuer.ts`
- `tests/admin-readiness-csrf-lifecycle.test.ts`

These names are suggestions for later implementation review, not authorization
to create code now.

## Non-goals

This package does not design or authorize:

- route implementation
- admin UI implementation
- reviewer authorization
- future RBAC roles
- staff or super-admin management
- direct readiness issuance from a live handler
- final approval execution
- merchant activation
- collection unlock
- payment, provider, checkout, subscription, invoice, or storefront behavior

## Later implementation test plan

A later implementation should prove all of the following:

- missing token is denied before service factory construction
- malformed token is denied before service factory construction
- expired token is denied before service factory construction
- session-mismatched token is denied before service factory construction
- valid token is accepted only with a matching authenticated session
- logout or session replacement invalidates prior tokens
- snapshot follows the same policy unless a separately approved exception
  exists
- no raw token, cookie, header, comparison detail, or verifier error is
  returned or logged
- origin checks remain additive defense in depth and do not replace the token
- wildcard credentialed CORS remains impossible

## Safe next step

Independently review this CSRF lifecycle design before any route or token
implementation begins. Admin readiness route adoption remains blocked until
this lifecycle, the deployment-cookie review, the CORS policy, and the route
security primitives are all implemented and reviewed together.
