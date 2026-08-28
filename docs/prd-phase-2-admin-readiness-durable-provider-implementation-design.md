# Admin readiness durable provider implementation design

Date: 2026-08-28

## Scope and decision status

This is a docs-only provider-selection and implementation design. It creates no
code, dependency, provider account, credential, environment change, database
migration, route enablement, staging or production action, runtime adoption,
M030 issuance, approval execution, activation, collection unlock, or payment,
provider, checkout, subscription, invoice, or storefront behavior.

The selected approach is a recommendation for the next separately reviewed
source task, not authorization to provision or configure it. The route flag
must remain unset or false:

`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED !== "true"`

## 1. Repository inspection findings

- `package.json` and `package-lock.json` contain no Redis, Upstash, Vercel KV,
  or general durable cache/rate-limit client. `express-rate-limit` appears only
  transitively and is not an application integration.
- No Vercel/Upstash/KV integration configuration is present. `vercel.json`
  exists, but it does not configure a durable admin-readiness store.
- The existing cookie-bound Supabase helper creates a server client. The
  canonical session reader privately calls `auth.getUser()` and returns only
  minimal user data. It does not expose a session or token surface.
- `admin-readiness-csrf-storage.ts` supplies an interface plus an explicitly
  test/development-only in-memory implementation. The zero-argument route
  composition deliberately supplies no CSRF store or session-binding reader.
- `admin-readiness-throttle-config.ts` supplies an interface and validates an
  environment-qualified namespace and a 64-hex derived subject hash. It has no
  durable backend. Current route constants are temporary operation buckets;
  they are not the final server-derived throttle subject design.
- The existing Supabase `verification_rate_limits` usage is a merchant/KYC
  business feature. Reusing it would couple platform-admin controls to
  unrelated data, require a migration/RLS/RPC and retention design, and is not
  approved for this package.
- Vercel's former KV product is not a new-project choice; Vercel documents
  external Marketplace Redis integrations instead. A provider dependency is
  therefore unavoidable for a durable provider-backed path.

## 2. Recommendation: dedicated Upstash Redis via `@upstash/redis`

Select a dedicated managed Upstash Redis database for each deployment class,
accessed from server-only Node modules through the `@upstash/redis` REST client.
Use one narrow internal Redis-command adapter for both CSRF and throttle
storage. Do not add `@upstash/ratelimit` in the first implementation.

This is the preferred option because it is connectionless/HTTP-compatible with
Vercel serverless execution, supports Redis TTL operations and server-side Lua
`EVAL`, and can be connected through the Vercel Marketplace. Its explicit
command client permits each provider failure to become `unavailable`; it avoids
an SDK timeout or local cache behavior that could accidentally allow a request.

The implementation must use a dedicated Redis resource and credentials per
environment, not merely a shared resource with a prefix. Namespacing remains a
second defense. Provider-side analytics must remain disabled unless separately
reviewed, because it could retain even derived identifiers.

### Required provider capabilities

- HTTPS REST access from server-only Vercel functions;
- atomic `SET ... NX PX` and atomic Lua `EVAL` operations;
- `GET`, `DEL`, bounded sorted-set operations, and TTL support;
- distinct credentials/resources for production, staging, preview, and local;
- credential rotation and revocation procedures; and
- predictable error signaling so the adapter can fail closed.

No default provider client, endpoint, credential, or in-memory fallback may be
constructed when configuration is absent, malformed, mismatched, or throws.

## 3. Provider alternatives and tradeoffs

| Option | Viability | Why it does not win now |
| --- | --- | --- |
| **Dedicated Upstash Redis with `@upstash/redis` (recommended)** | Fits Vercel/serverless HTTP execution; supports atomic TTL and Lua operations through one narrow client. | Adds one provider and one SDK. Requires a provider/security review and separate per-environment resources. |
| Redis Cloud or another managed Redis Marketplace integration with a reviewed serverless-compatible client | Can provide the same Redis primitives and environment separation. | Requires separate review of client connection lifecycle, timeout/failure semantics, TLS, credential injection, and Lua support. It has no existing project integration advantage. |
| Dedicated Supabase schema plus private RPC | Technically durable and already has a Supabase dependency. | Requires a new migration, RLS/grant/RPC, retention, service authorization, concurrency, and operational review. It must not reuse merchant/KYC tables, so it is a larger and riskier next step. |

Vercel KV itself is explicitly not an alternative: it has been sunset for new
use. An in-memory map is test/development-only and cannot provide serverless
durability, cross-instance consistency, or reliable production throttling.

## 4. Exact server-only configuration contract

The next implementation must read configuration only inside a server-only,
zero-argument security configuration factory. It must never infer a deployment
from host, Origin, Referer, `VERCEL_URL`, browser input, or a preview hostname.
It must validate explicit values before building a provider client.

| Variable | Required value and validation | Boundary |
| --- | --- | --- |
| `DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT` | Exact `production`, `staging`, `preview`, or `local`. | Existing environment-policy input; must match every other environment label. |
| `DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT` | Same exact label as deployment environment. | Reject cross-environment Supabase use. |
| `DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN` | `https://admin.deraledger.com` in production; reviewed exact non-production origin otherwise; local HTTP loopback only in `local`. | Origin defense-in-depth only, never authority. |
| `DERALEDGER_ADMIN_READINESS_SECURITY_NAMESPACE` | Exact `admin_readiness_<environment>_v1`, ASCII lowercase. | New shared namespace. It replaces direct production use of the current throttle-only namespace input. |
| `UPSTASH_REDIS_REST_URL` | HTTPS Upstash REST endpoint; required. | Server-only provider endpoint; reject public names and mismatched resource mapping. |
| `UPSTASH_REDIS_REST_TOKEN` | Non-empty provider write token; required. | Server-only secret; no read-only/public token, logs, or responses. |
| `DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY` | Base64url-decoded minimum 32 random bytes; required. | Dedicated server-only key for per-session CSRF bindings. |
| `DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY` | Base64url-decoded minimum 32 random bytes; required and distinct from the CSRF key. | Dedicated server-only key for privacy-preserving throttle subjects. |
| `DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT` and `DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT` | Reviewed bounded positive integers. | Per-operation limits; values remain unset until a separate configuration review. |
| `DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS` | Reviewed bounded integer window, for example 60--300 seconds. | One fixed-window duration; no browser override. |

Every variable above is forbidden under a `NEXT_PUBLIC_` name. The existing
public-environment validator must continue to reject secret-like public names,
`sb_secret_` values, and legacy service-role JWT values. No service-role key,
Supabase secret key, Auth Admin credential, or browser-exposed token belongs in
this package.

Provision Vercel environment values separately for production, staging,
preview, and local. The factory must reject a provider resource identity whose
approved environment label does not equal the explicit deployment environment.
Production may use only production Supabase plus production Redis; staging,
preview, and local must not use either production resource or silently fall
back to it. Provider credentials should be unique per environment so a
namespace validation bug alone cannot cross the boundary.

## 5. Exact server-derived CSRF session-binding design

The future adapter is a narrow server-only reader. For each request it:

1. Creates the existing cookie-bound Supabase server client.
2. Calls `auth.getUser()` and fails closed on a missing/error/malformed user.
3. Obtains the current session access token privately from that same
   cookie-bound client only after step 2 succeeds. `getSession()` is a binding
   input read, never an authentication or authority decision.
4. Requires a non-empty bounded access token and a valid server-read UUID.
5. Produces two opaque lower-case hexadecimal HMAC values:

   - `sessionBindingReference = HMAC-SHA-256(CSRF_BINDING_HMAC_KEY, "deraledger-admin-readiness-csrf-session:v1\\0" + accessToken)`
   - `throttleSubjectHash = HMAC-SHA-256(THROTTLE_SUBJECT_HMAC_KEY, "deraledger-admin-readiness-throttle-subject:v1\\0" + user.id)`

6. Returns only these fixed-format digests to the route-security composition.
   It returns no raw token, cookie, session, header, JWT payload, email,
   metadata, or user ID.

The raw access token is only a per-session opaque HMAC input after server
validation. It is not trusted as reviewer authority. The throttle subject is
derived from the server-read user ID solely to provide a stable, redacted
per-user bucket across valid session refreshes. Neither digest authorizes a
reviewer. The readiness service still independently applies:

`auth.getUser() -> session reader -> reviewer resolver -> app_metadata.is_super_admin === true`

`user_metadata`, origin, CSRF evidence, the binding, the throttle subject,
headers, cookies, and caller fields remain non-authoritative.

### Logout, refresh, replacement, and HMAC-key rotation

- On a dedicated future logout/session-clear path, obtain the pre-clear
  binding reference server-side and invoke binding invalidation before clearing
  the cookie. Failure to clean the record must never block logout; later
  `auth.getUser()` denial, binding mismatch, and TTL still prevent use.
- A session replacement changes the access-token HMAC input. Old CSRF evidence
  therefore fails the binding comparison and a new token must be issued.
- A normal access-token refresh that changes the token is treated as session
  replacement for CSRF: issue fresh CSRF evidence. Do not preserve an old
  token merely to improve convenience.
- Rotating `CSRF_BINDING_HMAC_KEY` invalidates existing CSRF tokens. This is a
  safe fail-closed rotation and requires a controlled reissue plan; dual-key
  acceptance is not allowed without another security review.

No query string, localStorage, sessionStorage, raw token, raw HMAC input,
digest, or header/cookie value may appear in a response or log.

## 6. Durable CSRF record design

Let `P = "dl:admin-readiness:v1:" + securityNamespace` and use only SHA-256
or HMAC hexadecimal digests in key suffixes.

| Item | Exact design |
| --- | --- |
| Token record key | `P + ":csrf:token:" + tokenDigest` |
| Binding index key | `P + ":csrf:binding:" + sessionBindingDigest` |
| Record value | Strict JSON: `{v:1,tokenDigest,sessionBindingDigest,operation,method,expiresAtEpochMs}`. No raw token/session/JWT/user ID/metadata. |
| TTL | Default 15 minutes, bounded to the existing lifecycle maximum of 60 minutes. Set provider TTL from `expiresAtEpochMs - now`; reject non-positive or out-of-range TTL. |
| Creation | Atomic Lua `EVAL`: validate bounded input in application code; `SET` the record with `NX` and millisecond TTL; add token digest to the binding index with expiry score; apply index TTL; return only created or conflict. A collision must cause a new random token, never overwrite an existing record. |
| Validation | Read by SHA-256 token digest; strict-decode the exact record schema; compare stored and calculated digests in constant time in application code; verify operation, method, binding, and expiry. Missing returns safe CSRF denial; malformed/provider failure returns unavailable. |
| Rotation | Atomic Lua replacement: validate predecessor belongs to the same binding/operation/method and has not expired; create replacement `NX`; update binding index; remove predecessor record/index member in the same script. Do not use separate write-then-delete calls. |
| Invalidation | Atomic bounded Lua invalidation reads the binding index, deletes listed token records, and deletes the index. Cap active records per binding (recommended maximum: four) so invalidation remains bounded. Expired index members are removed on every create/rotate. |

The next code task must make the CSRF storage interface express atomic create,
rotate, and invalidate outcomes rather than pretending that a `Promise<void>`
write is enough to prove collision-free creation or predecessor invalidation.
Any script response outside its exact allowlist, storage time-out, malformed
record, provider error, unavailable client, or thrown exception maps to the
existing opaque `csrf_unavailable` result. No provider detail is logged or
returned.

## 7. Durable throttle design

Use an atomic, per-operation, fixed-window counter via `@upstash/redis` Lua
`EVAL`; do not use an in-memory process cache or an SDK path that permits on a
network timeout. A fixed window is sufficient for this low-volume, internal
route when its limit and window are separately reviewed. A future need for
smoother burst behavior requires a separate sliding-window review.

| Item | Exact design |
| --- | --- |
| Key | `P + ":throttle:" + operation + ":" + throttleSubjectHash + ":" + windowStartEpochMs` |
| Subject | The 64-hex HMAC value from the server-derived security context; never browser input or the current static operation hash. |
| Window | `windowStartEpochMs = floor(now / windowMs) * windowMs`; limits and window are server-only validated configuration. |
| Atomic decision | One `EVAL` increments the counter, applies `PEXPIRE` exactly when the key is created, and returns only allow or deny. The counter is incremented for denied attempts as well. |
| Result mapping | Allow returns `{ kind: "allow" }`; an exceeded limit returns `{ kind: "deny", code: "rate_limited" }`; anything else is `{ kind: "unavailable", code: "throttle_unavailable" }`. No count, reset time, key, provider error, namespace, or subject is exposed. |
| Ordering | After strict JSON, command validation, origin, and CSRF validation; before the route flag check's service construction and before `createCanonicalApprovalReadinessServerService()`. |

The current opaque operation constants in the route files cannot remain the
production throttle subject. The next implementation must make route
composition obtain the server-derived security context once and use its
`throttleSubjectHash` internally. Route callers must not pass a subject hash,
binding, user ID, or any authority field.

Missing provider config, a namespace mismatch, invalid limits/window,
unavailable storage, malformed script response, script exception, or client
construction failure must fail closed. There is no production in-memory,
database, vendor-swap, or permissive timeout fallback. Throttle remains
defense-in-depth, not reviewer authorization.

## 8. Required next implementation boundaries and files

The next separately approved source task should be limited to:

- `src/lib/compliance/server/admin-readiness-durable-redis-client.ts` - private
  server-only provider command adapter with strict configuration and response
  normalization;
- `src/lib/compliance/server/admin-readiness-csrf-session-binding.ts` - narrow
  cookie-bound `auth.getUser()`-first security-context reader;
- `src/lib/compliance/server/admin-readiness-csrf-durable-storage.ts` - Redis
  implementation with atomic create, rotate, read, and invalidation semantics;
- `src/lib/compliance/server/admin-readiness-throttle-durable-storage.ts` -
  atomic fixed-window throttle implementation;
- `src/lib/compliance/server/admin-readiness-route-security-config.ts` -
  zero-argument server-only factory that validates the exact configuration and
  constructs only the three security adapters;
- narrow updates to `admin-readiness-csrf-storage.ts`,
  `admin-readiness-csrf-issuer.ts`, and
  `admin-readiness-route-security-composition.ts` to express the atomic and
  server-derived contracts; and
- focused provider-adapter, security-composition, and route integration tests,
  plus a source checkpoint document.

The issue and snapshot route files may change only as needed to remove their
static throttle-subject constants. They must keep the disabled-by-default flag,
must not construct a provider client directly, and must retain the factory
construction block while disabled.

The new dependency is exactly `@upstash/redis`, pinned according to the next
reviewed package-lock update. `@upstash/ratelimit`, provider analytics, a
generic Redis/query export, and an admin API or UI are outside that task.

## 9. Required tests

Tests must use a deterministic fake at the narrow Redis-command adapter boundary
to exercise the real durable adapter logic without provider credentials or
network access. They must not merely string-scan source.

- Configuration accepts only a complete matched environment/resource/namespace
  set, and rejects absent, public, malformed, cross-environment, or secret
  exposed values.
- A configured CSRF adapter allows a valid, matching operation/method/token
  and server-derived binding.
- Missing config, client construction failure, provider unavailability,
  malformed script/read output, and thrown provider methods fail closed.
- CSRF session mismatch, expiry, malformed storage record, session replacement,
  logout invalidation, and HMAC-key rotation deny old evidence.
- Atomic rotation invalidates its predecessor; creation never overwrites a
  collision; binding invalidation removes every bounded active record.
- The provider throttle allows below the reviewed limit, returns only
  `rate_limited` once exceeded, applies environment/operation/derived-subject
  separation, and fails closed on unavailable/throwing/malformed outcomes.
- No raw token, token digest, access token/JWT, cookie, header, user ID,
  namespace, provider credential, provider response, metadata, diagnostics, or
  error reaches route output or operational logs.
- An enabled test-only configuration rejects origin, CSRF, and throttle failure
  before readiness-service construction; a valid configured path reaches only
  `service.issue` or `service.readSnapshot` as applicable.
- A disabled route never constructs the service factory even when all durable
  security adapters are configured.
- Static tests continue to prove server-only imports, the exact approved route
  import allowlist, no direct Supabase/Auth Admin/service-role/RPC/table use,
  no final approval RPC, no activation, no collection unlock, no commercial
  behavior, and no future RBAC/staff-role implementation.

## 10. Explicit forbidden actions until later review

- Do not install `@upstash/redis` or any provider dependency yet.
- Do not create a provider account, Redis resource, credential, namespace, or
  Vercel integration yet.
- Do not set any environment values, including
  `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=true`.
- Do not run a configured route against local, staging, or production storage.
- Do not issue live M030 readiness requests, execute final approval, activate a
  merchant, unlock collection, or introduce payment/provider/checkout/
  subscription/invoice/storefront behavior.

## Recommended next implementation prompt

Implement only the server-only durable Redis configuration and adapters above,
using a reviewed `@upstash/redis` dependency and test command-client fake. Add
the server-derived `auth.getUser()`-first CSRF security context, atomic CSRF
create/rotate/invalidation, atomic fixed-window throttle, and zero-argument
configuration factory. Keep the route flag disabled and require independent
source review before any staging-only configuration/runbook work.

## Decision references

- [Vercel Redis guidance](https://vercel.com/docs/redis) documents Marketplace
  Redis integrations and the retirement of Vercel KV for new use.
- [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage)
  identifies Upstash Redis as a KV option.
- [Upstash Redis EVAL](https://upstash.com/docs/redis/sdks/ts/commands/scripts/eval)
  documents server-side Lua execution through the TypeScript client.
- [Upstash Redis SET](https://upstash.com/docs/redis/sdks/ts/commands/string/set)
  documents TTL and `NX` write options.
