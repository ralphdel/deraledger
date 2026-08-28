# Admin readiness route implementation design

Date: 2026-08-28

## Status and scope

This is a design-only implementation plan for future internal admin readiness
issue and snapshot routes. It creates no route, page, action, webhook, admin
UI, database access, or runtime adoption.

It does not issue an M030 request from a live handler, execute a final
approval, activate a merchant, unlock collection, or perform payment,
provider, checkout, subscription, invoice, or storefront behavior. Future
RBAC expansion and super-admin or staff-account management remain outside this
package.

This design depends on the already committed readiness service factory,
session reader, reviewer resolver, route contract, and route-security
primitive designs. Any implementation remains blocked until the separate
deployment-cookie, CSRF, CORS, environment, and throttle gates are approved.

## Proposed future route files

The following files are proposed only and are not created by this document:

- `src/app/api/internal/admin/compliance/readiness/issue/route.ts`
- `src/app/api/internal/admin/compliance/readiness/snapshot/route.ts`

These routes are intended for a future internal admin surface that may later
sit behind `admin.deraledger.com`. They must not hardcode
`deraledger.com/admin`, and they must not treat host, origin, subdomain,
Referer, or any other browser claim as reviewer authority.

## Import boundary

Each future route must stay narrow and server-only. It should import only:

- `createCanonicalApprovalReadinessServerService()`
- the approved admin-readiness route security primitives for JSON parsing,
  validation, CSRF, CORS/origin checks, rate limiting, safe response mapping,
  and safe operational logging

The route must not construct a Supabase client directly, use Auth Admin, read
service-role credentials, call M030 RPCs directly, expose generic RPC/table
helpers, or bypass the zero-argument service factory.

## Issue route flow

The future issue route should follow this exact order:

1. Generate a server correlation ID.
2. Read and parse the request body through the strict JSON reader, including
   duplicate-key rejection.
3. Validate the parsed body as the exact issue command shape.
4. Apply origin/CORS checks according to the separately approved deployment
   policy.
5. Apply CSRF validation before any service construction or readiness call.
6. Apply the admin throttle before any readiness call.
7. Create the zero-argument readiness server service.
8. Call `service.issue(...)`.
9. Map the typed readiness result through the safe response mapper.
10. Emit only redacted operational logs using the correlation ID and safe
    result envelope.

No step may accept browser-supplied reviewer identity, authority, session
claims, idempotency key, workspace override, merchant override, or source
override. Rejection should happen as early as possible, before any readiness
service call.

## Snapshot route flow

The future snapshot route should follow the same safety order:

1. Generate a server correlation ID.
2. Read and parse the request body through the strict JSON reader, including
   duplicate-key rejection.
3. Validate the parsed body as the exact snapshot command shape.
4. Apply origin/CORS checks according to the separately approved deployment
   policy.
5. Apply CSRF validation unless a separate reviewed exception explicitly
   approves a narrower read-only posture.
6. Apply the admin throttle before any readiness call.
7. Create the zero-argument readiness server service.
8. Call `service.readSnapshot(...)`.
9. Map the typed readiness result through the safe response mapper.
10. Emit only redacted operational logs using the correlation ID and safe
    result envelope.

The snapshot route must not accept profile overrides, target status overrides,
workspace/merchant/source identifiers, reviewer data, or metadata-shaped
authority fields. It reads only the immutable decision request identified by
the validated public `decisionRequestId`.

## Authority boundary

The route layer must never accept or derive reviewer authority from caller
input. The only allowed authority flow remains:

`cookie-bound auth.getUser()` -> session reader -> reviewer resolver ->
`app_metadata.is_super_admin === true` -> readiness service

`user_metadata` is never authority. The route must not accept or trust:

- `reviewer`
- `reviewerId`
- `role`
- `authority`
- `userId`
- `email`
- `app_metadata`
- `user_metadata`
- JWTs, headers, cookies, origin claims, or browser-provided session facts

`admin`, `support manager`, `compliance manager`, `compliance officer`,
`support`, and `compliance reviewer` remain deferred and denied until a
separate RBAC package is designed and approved.

## Request boundary

The issue route may accept only:

- `profileId`
- `targetComplianceStatus`
- `policyVersion`
- optional `reasonCode`

The snapshot route may accept only:

- `decisionRequestId`

Both routes must reject:

- unknown fields
- authority-shaped fields
- browser idempotency fields
- reviewer or session override fields
- nested objects, arrays, `null`, and malformed scalar values
- duplicate keys and alternate ambiguous encodings

The route must not derive plan, workspace, merchant, source, or reviewer facts
from browser input. Those facts remain canonical checks behind the approved
readiness service and M030-safe result vocabulary.

## Response boundary

Responses must use only the committed allowlisted API envelopes from the
response mapper. They must not expose:

- raw Auth, Supabase, RPC, database, session, service-role, transport, or
  stack details
- diagnostics arrays
- secrets, tokens, cookies, or headers
- raw metadata
- internal idempotency keys
- reviewer IDs
- workspace IDs
- merchant IDs
- source IDs
- other internal-only identifiers not already approved in the public route
  contract

Valid response behavior is limited to safe `created`, `replay`, `ready`,
`rejected`, and `unavailable` envelopes with stable safe codes and only the
approved readiness projection.

## Security primitive order

The future routes must keep the primitive order intact:

1. Correlation ID generation
2. JSON parsing and duplicate-key rejection
3. Command validation
4. Origin/CORS checks
5. CSRF checks
6. Rate limiting
7. Service factory creation
8. Readiness service call
9. Safe response mapping
10. Safe operational logging

This order matters because malformed input, cross-origin misuse, missing CSRF,
and throttled requests should be denied before the service factory is created
and before any M030-backed readiness behavior is attempted.

## Deployment gates

No implementation or release should proceed until the following gates are
passed:

- `admin.deraledger.com` deployment shape reviewed
- cookie scope and session freshness reviewed
- CSRF strategy implemented and proven
- same-origin/CORS policy implemented and proven
- environment separation between production, staging, and preview reviewed
- route import boundary proven to use only the zero-argument readiness service
  factory and approved primitives
- response redaction and logging redaction proven
- admin throttle proven to run before the readiness service call

These are release blockers, not optional hardening items.

## Non-goals

This package does not design or authorize:

- route file creation
- admin UI wiring
- runtime adoption
- direct M030 RPC usage
- final approval execution
- merchant activation
- collection unlock
- super-admin or staff-role management
- payment, provider, checkout, subscription, invoice, or storefront behavior

## Later implementation test plan

A later implementation should prove all of the following:

- only the two proposed route files are created, and both remain server-only
- the route imports only the readiness factory and approved security
  primitives
- no direct Supabase/Auth Admin/service-role/RPC/table client usage exists in
  the route
- strict request validation rejects unknown fields, authority fields, browser
  idempotency fields, malformed payloads, and duplicate-key bodies
- CORS/origin checks run before the readiness service call
- CSRF checks run before the readiness service call
- throttling runs before the readiness service call
- the route cannot accept caller-supplied reviewer identity or authority
- response mapping stays allowlisted and redacted
- logging stays correlation-based and redacted
- no approval execution, activation, collection unlock, payment, provider,
  checkout, subscription, invoice, or storefront behavior appears

## Safe next step

Independently review this implementation design before any route file is
created. Runtime adoption remains blocked until the separate deployment,
cookie, CSRF, CORS, environment, logging, and throttling prerequisites are
implemented and reviewed.
