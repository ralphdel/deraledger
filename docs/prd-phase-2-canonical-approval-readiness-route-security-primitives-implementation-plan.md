# Canonical approval readiness route security primitives implementation plan

Date: 2026-08-28

## Status and scope

This is a design-only implementation plan for a future, narrow, source-only
route-security primitives package. It authorizes no code, route, page, action,
webhook, admin UI, database work, environment access, deployment, or runtime
adoption.

It does not issue an M030 readiness request from a live handler, execute an
approval, activate a merchant, unlock collection, or perform payment,
provider, checkout, subscription, invoice, or storefront behavior. It does not
create or manage staff or super-admin identities. A future route remains a
separately designed and approved package.

The plan is constrained by the committed route-security primitive design, API
route contract, admin API adoption gate, and admin-portal security
prerequisites. It must not reinterpret any of those gates as implementation
authorization.

## Proposed future files

The following are proposed internal server-only files only. This document does
not create or authorize creation of them:

- `src/lib/compliance/server/admin-readiness-route-json.ts`
- `src/lib/compliance/server/admin-readiness-route-validation.ts`
- `src/lib/compliance/server/admin-readiness-route-csrf.ts`
- `src/lib/compliance/server/admin-readiness-route-cors.ts`
- `src/lib/compliance/server/admin-readiness-route-rate-limit.ts`
- `src/lib/compliance/server/admin-readiness-route-response.ts`
- `src/lib/compliance/server/admin-readiness-route-logging.ts`
- `tests/admin-readiness-route-security-primitives.test.ts`

Every future server module begins with `import "server-only"`. The package is
limited to typed route-security helpers; it is not a generic middleware,
generic API framework, Supabase wrapper, Auth Admin wrapper, table client, RPC
caller, or role checker. None of these modules may export a client, credential,
cookie/session, authenticated user, or business-data surface.

## Implementation order

Implement and independently review in this order. A later step cannot relax a
previous gate.

1. Build a bounded strict JSON body reader and lexical duplicate-key detector.
   They must complete before any JSON object is constructed.
2. Add separate issue and snapshot command validators over only the parsed,
   duplicate-free top-level object.
3. Add the safe response mapper, with a closed allowlist over typed primitive
   denials and existing canonical-readiness result kinds/codes.
4. Add the redacted operational logger and server-generated correlation-ID
   helper.
5. Add a CSRF interface and fail-closed default. Implement a token lifecycle
   only after its issuance, binding, rotation, expiry, and logout semantics are
   separately reviewed.
6. Add a same-origin-default CORS/origin contract with only exact reviewed
   allowlist support.
7. Add a rate-limit interface that denies by default when no reviewed limiter
   is configured. A durable limiter store or any bounded degraded mode needs a
   separate dependency and operations review.
8. Only after these primitives, their tests, deployment-cookie/CSRF/CORS
   design gates, and an independent source review pass may a distinct route
   package be proposed. That later route owns service-factory construction and
   still must not bypass any primitive.

The expected later route ordering is: generate correlation ID; parse and
detect duplicates; validate a strict command; apply origin defense; enforce
CSRF; enforce throttle; construct the zero-argument readiness service factory;
call one approved operation; map its typed result; emit an allowlisted
operational log. Invalid input or a failed primitive never reaches the factory
or M030 transport.

## Strict JSON and duplicate-key plan

`admin-readiness-route-json.ts` should own raw-body size enforcement,
`Content-Type: application/json` checking for POST, complete JSON parsing, and
duplicate-key detection. It must accept only a reviewed small byte limit and
return typed opaque denials; it must not return raw parser, body, header, or
token content.

The detector must run on raw JSON text before `JSON.parse`-style object
construction. A purpose-built bounded JSON lexical scanner is the preferred
approach because it can track object nesting and seen decoded member names per
object without retaining a parsed command. A vetted parser that provides the
same duplicate-member guarantee is acceptable only after dependency, input
limit, and error-redaction review.

The scanner must:

- decode JSON string escapes when comparing member names, so equivalent escaped
  names are not treated as different;
- track member names separately for every object depth;
- scan nested objects even though command validation rejects nested objects
  later;
- distinguish quoted string content from structural syntax, so key-like text
  in values cannot create a false duplicate;
- reject malformed escape sequences, unterminated strings, excessive depth,
  and duplicate decoded names with one opaque validation result; and
- reject before any last-key-wins JavaScript object can exist.

The later route contract accepts one location for every input. POST accepts its
validated JSON body only; it rejects query fields, repeated query parameters,
path/query/body override combinations, form fallback, aliases, and alternate
identifier encodings. A future GET snapshot form, if separately approved, has
one exact path identifier and no query parameters.

Required tests include top-level duplicate keys, nested duplicates, equivalent
escaped duplicate names, key-like content inside escaped string values,
duplicate authority-shaped fields, and proof that there is no last-key-wins
path.

## Strict command validation plan

`admin-readiness-route-validation.ts` should consume only the safe parsed
plain object and return a typed issue command, snapshot command, or opaque
validation denial. It does not derive reviewer authority or call the service
factory.

Validation rules are closed:

- POST requires `application/json` and the JSON reader's bounded body result.
- Only a top-level plain object is accepted. Arrays, `null`, scalars, nested
  objects, arrays in fields, prototype-like keys, and excess properties are
  denied.
- Issue keys are exactly `profileId`, `targetComplianceStatus`,
  `policyVersion`, and optional `reasonCode`.
- Snapshot keys are exactly `decisionRequestId`.
- `profileId` and `decisionRequestId` use the UUID form already accepted by
  the readiness core.
- `targetComplianceStatus` is limited to the core allowlist:
  `lite_verified`, `enhanced_verified`, `business_verified`,
  `needs_attention`, `restricted`, and `rejected`.
- `policyVersion` must be trimmed, non-empty, and within a separately reviewed
  bounded length; no policy value is inferred or rewritten.
- `reasonCode` is absent or `null`, or one of the core-safe reason codes:
  `evidence_incomplete`, `evidence_expired`, `evidence_mismatch`,
  `review_rejected`, `reviewer_requested_correction`, `policy_restriction`,
  `risk_restricted`, or `risk_suspended`.
- Unknown, reviewer, role, authority, identity, metadata, JWT/token/session,
  header/cookie/origin, workspace/merchant/source override, and browser
  `idempotencyKey` fields are denied. M030's canonical durable idempotency
  remains authoritative.

The output is one of the existing command types or a small primitive-denial
type. It must never expose excess object properties, raw request data, or
authority facts.

## CSRF plan

`admin-readiness-route-csrf.ts` should initially define a narrow validation
interface and a production fail-closed implementation: absent configuration,
missing evidence, invalid evidence, malformed evidence, expired evidence, or
validator failure all deny. It must not silently allow a route while a token
lifecycle remains undecided.

The token issuance and lifecycle are deliberately deferred for separate
design/review. That design must select a Next.js-safe synchronizer-token or
signed double-submit model; define session binding, rotation, expiry,
comparison, logout/session-replacement behavior, storage, and test fixtures.
Tokens and raw comparison inputs are never logged or returned.

For a future route, issue validation happens before factory construction and
before the `issue` operation. Snapshot follows the same policy whenever it is
browser-credentialed, unless a separate review grants a narrowly defined
read-only exception. `Origin`, `Referer`, and Fetch Metadata remain
defense-in-depth signals only; they never establish reviewer authority.

## CORS and origin plan

`admin-readiness-route-cors.ts` should encode same-origin deployment on
`admin.deraledger.com` as the default policy, not as an authority source. It
must have no `deraledger.com/admin` fallback or hardcoding. Cross-origin mode,
if ever required, is an explicit configuration with exact approved origins for
one environment.

The implementation must reject `null`, reflection-based origins, unrelated
origins, arbitrary preview hosts, and wildcard credentialed CORS. It returns
generic, non-sensitive preflight results with a minimum reviewed set of methods
and headers. An origin denial occurs before service factory construction. CORS
does not authorize a reviewer; the only authority path remains the session
reader and resolver.

## Rate-limit plan

`admin-readiness-route-rate-limit.ts` should expose a narrow injected checker
contract, rather than committing this package to a database, cache, or vendor
store. It runs after request validation and applicable CSRF/origin checks but
before service-factory construction or M030 transport.

The initial production default must deny when a reviewed limiter dependency is
absent or fails. A bounded degraded mode is possible only after a separate
security and operational review defines its bounds, alerting, and expiry; it
cannot silently disable the control.

Keys must be safe server-derived values, such as a rotated/salted reviewer
identifier after resolver evaluation plus a coarse operation bucket. Any
pre-authority bucket must be separately reviewed and privacy preserving. Never
key on raw tokens, cookies, headers, full email, full IP history, full request
body, or an unredacted identifier. The checker returns only allowlisted allow,
deny, retry, or unavailable facts; it does not decide reviewer authority.

## Response mapper plan

`admin-readiness-route-response.ts` should accept only typed primitive
denials and `CanonicalApprovalReadiness` issue/snapshot result shapes. It maps
the closed result vocabulary to the route contract's stable envelopes and HTTP
statuses:

- created issue: 201;
- safe idempotent replay: 200;
- ready snapshot: 200;
- malformed validation or CSRF denial: 400;
- safely established session absence/invalidity: 401 only where the route can
  establish it without inspecting raw Auth errors;
- derived non-super-admin: 403;
- deliberately exposed safe request-missing outcome: 404;
- canonical/idempotency conflict: 409;
- throttling: 429; and
- configuration, transport, malformed response, unknown result, or unexpected
  error: opaque 500 unavailable.

Unknown primitive or readiness codes and malformed internal shapes must map to
an opaque unavailable envelope. The mapper may expose only the approved
`decisionRequestId` for created/replayed issue outcomes and the separately
approved minimal snapshot projection for a ready snapshot. It must not reveal
internal idempotency keys, reviewer, merchant, workspace, source identifiers,
raw errors, metadata, secrets, tokens, cookies, headers, sessions, or stack
traces.

## Logging and correlation plan

`admin-readiness-route-logging.ts` should generate an unpredictable,
server-generated correlation ID per request. It is tracing only: never a
session, authority claim, CSRF token, or idempotency key.

The logger has an allowlisted operational event input: timestamp, operation,
correlation ID, safe result kind/code, and approved redacted identifier. It
must reject or ignore raw errors, stack traces, request/response bodies,
cookies, headers, tokens, secrets, metadata, full email, full user IDs, and
PII-heavy content. Log-sink failure must not turn a denial into success; its
availability behavior needs explicit review before route adoption.

These events are operational logs only. The primitives neither create durable
compliance events nor implement staff/admin-management auditing.

## Authority boundary and deferred RBAC

Security primitives protect inputs and outputs but never establish reviewer
authority. Later route code may obtain readiness behavior only through the
zero-argument factory:

`cookie-bound auth.getUser()` -> session reader -> reviewer resolver ->
`app_metadata.is_super_admin === true` -> readiness service.

No primitive accepts caller-supplied reviewer, role, authority, user ID,
email, metadata, JWT, header, cookie, origin, or browser claim as authority.
`user_metadata` is not authority. Future `admin`, `support manager`,
`compliance manager`, `compliance officer`, `support`, and `compliance
reviewer` roles remain deferred. No generic role checker, staff table,
staff-management API, or super-admin creation/removal/recovery behavior is in
scope.

## Future implementation test plan

The future static and unit suite must prove:

- each module is server-only, exports only its narrow typed primitive, and
  imports no route/page/action/webhook or client-side surface;
- content type, body-size, invalid JSON, top-level shape, nested-value, and
  prototype-like-key denials;
- duplicate-key rejection at top and nested depth, escaped key equality,
  escaped string-value safety, duplicate authority fields, and no
  last-key-wins behavior;
- exact issue/snapshot schemas, UUID/status/policy-version/reason-code checks,
  and rejection of unknown, authority, override, and idempotency fields;
- CSRF missing/invalid/error denial before factory or readiness operation;
- same-origin/default-deny CORS, exact allowlist behavior, and no wildcard
  credentialed CORS;
- rate-limit denial and dependency failure before factory or M030 transport,
  with only privacy-safe key material;
- stable response/status mapping, unknown-code opacity, and absence of raw
  errors and internal IDs;
- correlation uniqueness and logging allowlist/redaction;
- no direct Supabase, Auth Admin, service-role, table, or RPC client is
  constructed or exported; and
- no route/page/action/webhook, runtime adoption, approval execution,
  activation, collection unlock, payment, provider, checkout, subscription,
  invoice, or storefront behavior is introduced.

## Non-goals and release boundary

This plan does not authorize implementation of a route, an admin UI, live M030
issuance, approval execution, or any staff-management feature. It does not
adopt runtime behavior, alter auth/cookies/deployment configuration, or touch
local, staging, or production systems.

Before any future primitive source package starts, independently review this
plan. Before any future route starts, complete the approved deployment-cookie,
CSRF lifecycle, CORS/origin, rate-limit storage/operations, logging, response
minimization, and API-adoption gates. Before release, independently review the
resulting route package and its environment-specific configuration.
