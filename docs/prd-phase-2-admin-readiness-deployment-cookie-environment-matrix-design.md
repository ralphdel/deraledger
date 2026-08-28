# Admin readiness deployment, cookie, and environment matrix design

Date: 2026-08-28

## Status and scope

This is a design-only deployment and security matrix for future
`admin.deraledger.com` readiness routes. It creates no code, route, page,
action, webhook, admin UI, database access, or runtime adoption.

It does not issue an M030 request from a live handler, execute a final
approval, activate a merchant, unlock collection, or perform payment,
provider, checkout, subscription, invoice, or storefront behavior. It does
not alter reviewer authorization, implement future RBAC, or manage
super-admin or staff identities.

This document exists to make environment separation, cookie behavior, redirect
policy, and release gates explicit before any route implementation begins.

## Domain matrix

The intended admin surface is domain-specific and environment-specific:

| Environment | Intended admin domain | Allowed status |
| --- | --- | --- |
| Production | `https://admin.deraledger.com` | intended target |
| Staging | exact reviewed staging admin host, proposed later | proposed only |
| Preview | exact reviewed preview admin host, proposed later | proposed only |
| Main app | `https://deraledger.com` | not an admin surface |
| Excluded path | `https://deraledger.com/admin` | explicitly forbidden |

Rules:

- `admin.deraledger.com` is the intended production admin domain.
- staging and preview must use exact reviewed admin-host equivalents rather
  than inheriting production behavior by convention.
- `deraledger.com/admin` is explicitly excluded as the admin readiness target.
- host, origin, subdomain, Referer, and deployment URL are not reviewer
  authority; they are deployment and browser-safety inputs only.
- no implementation may infer approved domains from arbitrary preview hosts or
  request headers.

## Supabase environment matrix

Every deployment environment must be bound to exactly one matching Supabase
environment.

| Deployment environment | Allowed Supabase target | Forbidden target |
| --- | --- | --- |
| Production admin | production Supabase only | staging, preview, local |
| Staging admin | staging Supabase only | production, preview, local |
| Preview admin | preview or separately reviewed non-production Supabase only | production by default |
| Local development | local/dev Supabase only | staging, production |

Rules:

- production admin must use production Supabase only.
- staging and preview must not accidentally point at production Supabase.
- preview should default to a non-production Supabase environment unless a
  separate review approves a narrower integration path.
- browser-visible configuration may expose only the reviewed public Supabase
  URL and anonymous key for the matching environment.
- service-role keys and `sb_secret_` secrets are server-only and must never
  appear in a client bundle, browser response, public env var, route payload,
  or log.
- `auth.getUser()` remains the only future session authority source for route
  authorization.

Anon and server-secret boundary:

- anonymous key may be client-visible only where already approved for normal
  Supabase browser auth flows.
- service-role and `sb_secret_` credentials remain server-only operational
  secrets and are never route authority.
- no future readiness route may read service-role credentials directly.

## Cookie and session matrix

The future admin route deployment must choose an explicit cookie model before
release.

Recommended default:

- host-only auth cookies for `admin.deraledger.com`
- no parent-domain sharing with `deraledger.com` unless a separate review
  proves the need and risk is acceptable

| Setting | Production expectation | Review notes |
| --- | --- | --- |
| Cookie scope | host-only for `admin.deraledger.com` preferred | parent-domain sharing needs separate approval |
| `Secure` | required | no exceptions in production |
| `HttpOnly` | required for session cookie | CSRF token may need separate transport copy |
| `SameSite` | reviewed explicit setting | must support admin auth while not replacing CSRF |
| Path | minimal admin scope preferred | do not over-broaden by default |
| Expiry/refresh | aligned to Supabase session lifecycle | must be reviewed per environment |

Cookie/session rules:

- production admin cookies must not be accepted by staging or preview.
- staging and preview cookies must not be accepted by production.
- cross-subdomain sharing is not the default and requires explicit review.
- session freshness after `app_metadata.is_super_admin` changes must be
  handled through reauthentication or verified session/token refresh, never by
  trusting stale browser claims.
- `auth.getUser()` remains the authoritative server-side session read path.
- `user_metadata` is not authority.

## Redirect URL matrix

Auth redirect URLs must be explicit per environment and must never be inferred
from host headers or arbitrary preview URLs.

| Environment | Allowed redirect family | Forbidden behavior |
| --- | --- | --- |
| Production | exact reviewed `admin.deraledger.com` auth redirects | redirecting to staging, preview, localhost, or inferred host |
| Staging | exact reviewed staging admin redirects | redirecting to production or inferred preview host |
| Preview | exact reviewed preview redirects only if separately approved | automatic wildcard host inference |
| Local | explicit local dev redirects only | production or staging redirect reuse |

Rules:

- production auth redirects must resolve only to approved
  `admin.deraledger.com` URLs.
- staging and preview redirect URLs must remain separated from production.
- arbitrary preview-host inference is forbidden.
- redirect URL review must include login, logout, reauthentication, and any
  future CSRF bootstrap or refresh flow.

## CSRF and CORS matrix

The environment matrix must preserve the already committed browser-safety
rules.

CSRF:

- issue route requires CSRF before service factory construction and before any
  readiness call.
- snapshot follows the same policy unless a future reviewed read-only
  exception is approved in writing.
- CSRF token proof is session-bound but is not reviewer authority.

CORS/origin:

- same-origin admin deployment is preferred.
- if cross-origin browser access is ever needed, allow only an exact reviewed
  environment-specific allowlist.
- wildcard credentialed CORS is forbidden.
- origin, Referer, and Fetch Metadata are defense in depth only, not
  authority.

Matrix rule by environment:

- production should default to same-origin `admin.deraledger.com`.
- staging should default to same-origin on its reviewed staging admin host.
- preview should default to same-origin on its reviewed preview host or remain
  disabled until exact origin policy is approved.

## Vercel and environment boundary

Vercel and deployment configuration are environment controls, not authority.

Required env-var categories for later implementation review:

- public browser configuration:
  - reviewed Supabase URL
  - reviewed anonymous key
  - reviewed admin origin identifier if separately needed for client config
- server-only configuration:
  - reviewed secret material needed for server operation only
  - logging or rate-limit configuration
  - future CSRF server signing or storage configuration if implemented

Forbidden client exposure:

- service-role keys
- `sb_secret_` keys
- server-only admin operational secrets
- secret signing material for CSRF or logging

Validation before deployment must prove:

- production Vercel environment points only to production Supabase
- staging points only to staging Supabase
- preview cannot silently inherit production secrets or production admin
  cookies
- client bundles expose no server-only secrets
- server-only environment variables stay inside the approved server boundary

## Route release gates

No future readiness route should be implemented or released until all of the
following are verified:

1. The deployment environment matrix is documented and reviewed.
2. Cookie scope, `Secure`, `HttpOnly`, `SameSite`, path, and refresh behavior
   are verified per environment.
3. Auth redirect URLs are explicit and verified per environment.
4. Production, staging, preview, and local Supabase separation is proven.
5. CSRF lifecycle is implemented and verified.
6. CORS/origin policy is implemented and verified.
7. Admin throttle is configured and proven to run before readiness service
   calls.
8. Safe response and logging redaction are verified.
9. The route import boundary is proven to use only the zero-argument
   readiness service factory and approved security primitives.

These are release blockers, not optional hardening items.

## Future RBAC and non-goals

Future RBAC remains deferred. This package does not design or authorize:

- any code implementation
- any route creation
- admin UI
- reviewer authorization changes
- future RBAC roles
- staff or super-admin management
- approval execution
- merchant activation
- collection unlock
- payment, provider, checkout, subscription, invoice, or storefront behavior

## Later implementation test plan

A later implementation review should prove:

- `admin.deraledger.com` is used only as reviewed deployment configuration and
  not as authority
- `deraledger.com/admin` is absent as a route target or fallback
- production admin resolves only production Supabase
- staging and preview cannot point to production Supabase accidentally
- service-role and `sb_secret_` secrets are absent from client bundles and
  route responses
- cookie scope and cross-subdomain behavior match the approved matrix
- stale `app_metadata` authority requires reauthentication or verified refresh
- redirect URLs are explicit and environment-specific
- CSRF remains required for issue and snapshot unless a reviewed exception
  exists for snapshot
- wildcard credentialed CORS is impossible
- the route import boundary, logging redaction, and throttle ordering all
  match the approved designs

## Safe next step

Independently review this deployment-cookie-environment matrix before any
admin readiness route implementation begins. Route adoption remains blocked
until this matrix and the related CSRF, CORS, redirect, environment, and
logging gates are implemented and reviewed together.
