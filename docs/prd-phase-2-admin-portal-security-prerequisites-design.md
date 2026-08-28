# Admin portal security prerequisites for canonical approval readiness

Date: 2026-08-28

## Status and scope

This is a design-only prerequisite gate for a future internal admin API that
may expose canonical approval readiness. It authorizes no code, route, page,
action, webhook, admin UI, database work, environment access, deployment, or
runtime adoption.

It does not issue an M030 request from a live handler, execute an approval,
activate a merchant, unlock collection, or perform payment, provider,
checkout, subscription, invoice, or storefront behavior. Super-admin and
staff-account management remain outside this package.

This document must be reviewed and its implementation gates must pass before
any readiness admin API route is created.

## Domain boundary

The intended admin portal is `https://admin.deraledger.com`; a future
compliance surface may be `https://admin.deraledger.com/compliance`.
`deraledger.com/admin` is not the target admin surface and must not be
hardcoded as a compatibility fallback.

Neither an `Origin` header, host name, subdomain, Referer, nor any other
browser/domain claim establishes reviewer authority. Authority remains the
server-derived session evaluated by the existing resolver. Origin and domain
checks are defense in depth for browser request safety only.

Before release, document the exact production, staging, and preview origins.
Do not infer an allowed origin from a request header, deployment URL, or an
arbitrary Vercel preview hostname.

## Cookie and session boundary

The trusted session path remains:

`cookie-bound Supabase auth.getUser()` -> minimal session reader -> reviewer
resolver -> `app_metadata.is_super_admin === true` -> readiness service.

The route must use the existing zero-argument
`createCanonicalApprovalReadinessServerService()` factory and cannot obtain
authority from request fields. `user_metadata` is never authority.

Before implementation, the deployment review must decide and prove all of the
following:

- whether Supabase Auth cookies need to be host-only for
  `admin.deraledger.com` or intentionally shared with a parent domain;
- the cookie domain, path, expiry/refresh behavior, `Secure`, `HttpOnly`, and
  `SameSite` settings expected in each environment;
- that production admin cookies cannot be accepted by staging or preview, and
  vice versa;
- the approved Supabase Auth redirect URLs and their relation to the admin
  domain; and
- how a changed `app_metadata.is_super_admin` claim becomes fresh before any
  privileged use. Require reauthentication or a verified token/session refresh
  when freshness is uncertain; never compensate by trusting stale client
  claims.

The `HttpOnly` property protects session-cookie access from browser script,
but it does not prevent CSRF. Cookie configuration therefore cannot replace
the CSRF controls below.

## CSRF boundary

Readiness issuance is mutation-like because its approved M030 path may create
an immutable approval decision request. It requires an explicit, separately
reviewed CSRF defense before any live route can call `issue`.

The recommended shape is a Next.js-compatible synchronizer-token or signed
double-submit-token design bound to the authenticated browser session and
validated on the server. The implementation must:

- require the CSRF token on every issue request;
- reject a missing, expired, malformed, or invalid token before service
  construction or any readiness transport call;
- use `Origin` and, where appropriate, `Referer` and Fetch Metadata
  (`Sec-Fetch-Site`) checks as additional checks for approved same-origin
  browser requests;
- treat those headers as defense in depth, not reviewer authority;
- use a request method and content type that make unsafe cross-site form
  submission impractical; and
- return a safe opaque denial rather than raw validation details.

Snapshot reads have no intended write, but the future route must still require
an authenticated derived super-admin, reject malformed input, avoid caching
sensitive response data in shared caches, and reject unapproved cross-origin
browser use. If snapshot access is exposed through a credentialed browser
route, apply the same CSRF/origin policy unless a separately reviewed safe
read-only exception is documented.

## CORS boundary

The preferred admin API deployment is same-origin with
`admin.deraledger.com`, requiring no browser CORS grant at all. By default the
route should emit no permissive `Access-Control-Allow-Origin` response.

If a separately reviewed deployment requires cross-origin browser access, the
policy must:

- allow only an exact allowlist of reviewed admin origins for the matching
  environment;
- reject `null`, arbitrary preview, unrelated production, and reflection-based
  origins;
- never use `*` with credentials;
- set `Access-Control-Allow-Credentials` only when credentials are truly
  needed and the exact origin is allowed;
- allow only the minimal methods and headers; and
- make `OPTIONS` preflight responses generic, with no reviewer, readiness,
  Auth, or internal-policy detail.

CORS is a browser control, not an authorization mechanism. Non-browser calls
must still pass the same cookie-bound session, resolver, input, and rate-limit
gates.

## Vercel and environment boundary

Before adoption, maintain an explicit environment matrix covering the admin
domain, Vercel deployment, Supabase project URL, anonymous key, approved
redirect URLs, cookie domain, and allowed origins for production, staging,
and preview.

The review must prove:

- a production admin deployment resolves only the production Supabase project;
- staging and preview deployments cannot accidentally use production Supabase
  configuration or production admin cookies;
- no service-role or `sb_secret_` credential is shipped in client bundles,
  browser-visible environment variables, route responses, logs, or error
  payloads;
- server-only runtime configuration is present only in the approved server
  boundary; and
- domain and environment variables are reviewed before any route is enabled.

Vercel environment values are configuration, never reviewer authority.

## Future API route security prerequisites

A future readiness route may import only
`createCanonicalApprovalReadinessServerService()` for readiness behavior. It
must not construct a Supabase client, use Auth Admin, read a service-role
credential, call a generic RPC/table/query API, or bypass the factory.

The route must accept only the currently defined command fields:

- issue: `profileId`, `targetComplianceStatus`, `policyVersion`, and optional
  `reasonCode`;
- snapshot: `decisionRequestId`.

It must reject unknown fields, duplicate/ambiguous field encodings, malformed
identifiers, malformed versions, unsupported status/plan combinations, and
untrusted authority-shaped fields before service use. It must never accept a
reviewer, role, authority, user ID, email, metadata, JWT, header, cookie,
origin, or browser claim as authority.

Responses must be a small allowlisted API schema based on existing safe
readiness result kinds and codes. Raw Auth, Supabase, RPC, database,
service-role, session, stack, and transport errors must be normalized to safe
opaque failures.

The future route may only reach approved M030 v2 readiness operations through
the service factory. It must not call M030 RPCs directly, write tables, invoke
the final approval RPC, or treat a readiness result as approval.

## Rate-limit and abuse prerequisites

Before adoption, implement and test an admin-only throttle for readiness
operations. It must run early enough that malformed, anonymous,
non-super-admin, cross-origin, and repeated denied requests do not reach M030
readiness transport.

Rate-limit keys should be derived from safe server-side context, such as a
rotated/salted reviewer identifier or coarse route bucket, rather than session
tokens, raw cookies, full email addresses, full IP histories, or full command
payloads. Limits, retry behavior, and operational escalation thresholds must
be separately documented. The limiter must fail closed or use a deliberately
reviewed bounded degraded mode; it may not silently disable throttling after a
dependency failure.

Repeated denied attempts may be operationally logged using the redaction rules
below. They must not create future staff-management or compliance-decision
audit records as a side effect.

## Logging and audit prerequisites

Operational logs must be allowlisted and minimal: a generated correlation ID,
timestamp, route/operation name, safe result kind/code, and redacted
identifier or opaque idempotency reference where already approved. They must
not contain secrets, keys, tokens, cookies, headers, raw metadata, raw Auth or
RPC/database errors, stack traces, or PII-heavy request/response bodies.

Operational logging is distinct from any future durable compliance audit-event
model. This prerequisite package neither creates audit events nor defines
admin-user or staff-management auditing.

## Deferred RBAC and super-admin protection

Only derived `app_metadata.is_super_admin === true` is permitted for current
readiness work. `admin`, `support manager`, `compliance manager`, `compliance
officer`, `support`, and `compliance reviewer` require a separate platform
staff identity, role-grant, policy, and audit design. This package creates no
role union, role lookup, staff table, or role-management mechanism.

It also does not create, remove, recover, alter, or otherwise manage
super-admins.

## Release gates before route implementation and release

No route implementation may start until the relevant design review approves
the intended deployment shape. No route may be released until all of these
gates are implemented, tested, and independently reviewed:

1. Deployment-cookie review proves domain, cookie, redirect, session-refresh,
   and production/staging/preview separation.
2. CSRF protection for issuance is implemented and proven to deny invalid
   requests before the readiness service call.
3. CORS is same-origin by default or has an exact reviewed credentialed-origin
   allowlist; wildcard credentials are impossible.
4. Environment configuration and client/server exposure are reviewed.
5. The route import boundary proves use of only the zero-argument service
   factory.
6. Request validation, safe responses, and error redaction are verified.
7. Admin-only throttling and safe denied-attempt logging are verified.
8. Tests prove no final approval execution, activation, collection unlock,
   payment, provider, checkout, subscription, invoice, or storefront behavior.

## Later implementation test plan

- admin-domain configuration is reviewed only as deployment configuration and
  cannot establish authority;
- `deraledger.com/admin` is not hardcoded;
- the `auth.getUser()` -> resolver -> `app_metadata` authority path is
  preserved and `user_metadata` cannot authorize;
- a missing or invalid CSRF token is denied before a readiness service call;
- cross-site, missing-origin, and unapproved-origin behavior follows the
  reviewed policy;
- wildcard credentialed CORS is impossible and unrelated origins are denied;
- service-role credentials are absent from client-visible code and responses;
- the route imports only the readiness factory, rejects unknown fields, and
  cannot accept caller authority;
- raw errors, headers, cookies, metadata, and PII-heavy payloads are redacted;
- rate-limit success, denial, and dependency-failure behavior is tested;
- no future RBAC role is enabled; and
- no approval execution, activation, collection unlock, payment, provider,
  checkout, subscription, invoice, or storefront behavior is introduced.

## Safe next step

Independently review this prerequisite design. A future route implementation
remains blocked until the deployment-cookie, CSRF, CORS, environment, abuse,
and logging gates have been separately approved.
