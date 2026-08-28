# Canonical approval readiness internal admin API adoption gate design

Date: 2026-08-28

## Status and scope

This is a design-only gate for a future internal admin API that may expose
canonical approval readiness to the future admin portal. It authorizes no
route, page, action, webhook, admin UI, database work, environment access, or
runtime adoption.

It does not execute a final approval decision, activate a merchant, unlock
collection, or perform payment, provider, checkout, subscription, invoice, or
storefront behavior. Super-admin creation, removal, recovery, and staff-role
management remain outside this package.

## Proposed route boundary

The future implementation should use a route-independent internal naming
scheme, preferably under a namespace such as:

- `src/app/api/internal/admin/compliance/readiness/issue/route.ts`
- `src/app/api/internal/admin/compliance/readiness/snapshot/route.ts`

These are options only, not files to create now. A route must execute on the
server and be available only after a separately approved admin-portal
deployment, cookie, and authorization review. It must not hardcode
`deraledger.com/admin`; future `admin.deraledger.com` compatibility is a
deployment concern, not origin-based authority.

Each route must import only
`createCanonicalApprovalReadinessServerService()` for readiness work. It must
not construct a Supabase client, use Auth Admin, read service-role credentials,
call a generic RPC/table API, or bypass the composition factory.

## Operations and M030 boundary

The future API exposes only two operations:

1. Issue a canonical readiness request through the existing `issue` operation.
2. Read a canonical readiness snapshot through the existing `readSnapshot`
   operation.

The route may reach only the approved M030 v2 transport behind the factory.
It must not directly call an RPC or write a table. It must never invoke the
final approval RPC or treat readiness as approval.

## Request and authority boundaries

The issue request body may contain only the current readiness command fields:
`profileId`, `targetComplianceStatus`, `policyVersion`, and optional
`reasonCode`. The snapshot body or path parameter may contain only
`decisionRequestId`. A later route should reject unknown fields and malformed
values before calling the service.

The route must not accept reviewer, role, authority, user ID, email, metadata,
JWT payload, header, cookie, origin, or browser claim as authority. It calls
the zero-argument factory without dependencies. Its authority flow remains:

`cookie-bound auth.getUser()` -> session reader -> reviewer resolver ->
`app_metadata.is_super_admin === true` -> readiness service.

`user_metadata` is never authority. Missing sessions, malformed server users,
non-super-admins, deferred compliance reviewers, and every other future
admin/support/compliance role fail closed until a separate RBAC package is
designed and adopted.

## Idempotency boundary

The current M030 issue contract has no browser-supplied idempotency-key field:
M030 derives the durable request/idempotency facts from trusted canonical
state. The future API must preserve that boundary and must neither accept nor
derive a reviewer identity from an idempotency key. It should return only the
safe created/replay outcome and safe opaque conflict result codes already
defined by the readiness layer.

If a later API-level correlation identifier is needed, it must be a separately
designed opaque request identifier. It cannot replace M030's canonical
idempotency authority, authorize a caller, or expose internal conflict detail.

## Safe response, logging, and abuse controls

Routes must map readiness results to a small allowlisted API response schema.
They may return the existing safe result kind, safe result code, and only
approved readiness IDs/snapshot facts. They must not return raw Auth,
Supabase, RPC, database, service-role, session, or stack-trace errors.

Operational logging must be allowlisted and correlation-oriented: a request
correlation ID, safe readiness outcome, and redacted/canonical idempotency
reference where available. Logs must not include credentials, tokens, cookies,
headers, raw metadata, raw errors, or PII-heavy request bodies.

Before adoption, add an admin-only rate-limit or operational throttling
policy. Malformed, anonymous, and browser-direct unauthorized requests must be
denied, with no readiness call. Rate-limit keys and logs must avoid exposing
session tokens or unnecessary identifiers.

## Deployment and browser security gate

Before a route is implemented, separately review:

- cookie scope and host-only versus shared-domain behavior for
  `admin.deraledger.com`;
- Secure, HttpOnly, and SameSite settings;
- Supabase Auth redirect URLs and the isolated Vercel environment/domain
  configuration;
- CSRF defenses for readiness issuance, including same-origin checks as
  defense in depth rather than authority;
- CORS policy that denies unrelated browser origins.

No domain/routing/cookie-policy code is authorized by this document.

## Deferred RBAC and super-admin protection

`admin`, `support manager`, `compliance manager`, `compliance officer`,
`support`, and `compliance reviewer` remain deferred. Any future support or
compliance access requires a separately reviewed platform staff identity,
role-grant, audit, and policy model. This gate must not add a role union,
staff lookup, or role management surface.

## Later implementation test plan

- the route imports only the zero-argument readiness factory;
- no direct Supabase, service-role, Auth Admin, table, or generic RPC surface
  is used;
- caller authority fields are rejected and cannot bypass the resolver;
- missing session, non-super-admin, and malformed input are denied;
- issue and snapshot operations map only safe readiness results;
- raw errors are redacted;
- no final approval execution, activation, collection unlock, direct table
  write, payment, provider, checkout, subscription, invoice, or storefront
  behavior occurs;
- no future RBAC role is enabled; and
- CSRF, CORS, rate-limit, and deployment-cookie tests pass before release.

## Safe next step

Independently review this design before any route implementation. Runtime
adoption remains blocked until the separate admin API, deployment-cookie,
CSRF, audit, and future-RBAC gates have passed.
