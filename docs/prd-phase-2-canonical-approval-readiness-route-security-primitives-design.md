# Canonical approval readiness route security primitives design

Date: 2026-08-28

## Status and scope

This is a design-only specification for narrow reusable security primitives
needed before a future readiness admin API route may be built. It authorizes no
code, route, page, action, webhook, admin UI, database work, deployment
access, or runtime adoption.

It does not issue an M030 request from a live handler, execute an approval,
activate a merchant, unlock collection, or perform payment, provider,
checkout, subscription, invoice, or storefront behavior. The primitives do
not determine reviewer authority or provide a generic API framework.

## Proposed future primitive surfaces

Possible internal server-only modules, with no path or file authorized now:

1. Strict JSON body reader/parser.
2. Duplicate-key detector before command construction.
3. Issue and snapshot request-schema validators.
4. CSRF validator.
5. CORS/origin policy checker.
6. Admin-only throttle checker.
7. Safe readiness-result response mapper.
8. Redacted operational logger and correlation-ID helper.

Each future primitive exports only typed safe results for its task. None may
export a Supabase client, Auth Admin client, service-role credential, generic
database client, RPC caller, or role checker.

The intended route sequence is correlation ID, parsing/duplicate detection,
schema validation, origin defense, CSRF where required, throttle,
zero-argument readiness factory, safe response mapping, then redacted
operational logging. No request reaches the factory or M030 transport until
required gates pass.

## Strict JSON validation

POST requires `Content-Type: application/json`, a reviewed small body-size
limit, and valid complete JSON. Reject unsupported encodings unless an
explicit safe decoder is later designed.

Accept only a top-level plain object. Reject arrays, `null`, scalars, nested
objects, and arrays unless a future field explicitly needs them. Reject
prototype-like keys and ambiguous object shapes.

Issue accepts exactly `profileId`, `targetComplianceStatus`, `policyVersion`,
and optional `reasonCode`. Validate UUID shape as accepted by the readiness
core. Allow only `lite_verified`, `enhanced_verified`, `business_verified`,
`needs_attention`, `restricted`, and `rejected`. Require trimmed non-empty
`policyVersion` within a separately reviewed length. Normalize `reasonCode`
only when absent, `null`, or one of the readiness-safe approved values.

Snapshot accepts exactly `decisionRequestId`, again in the readiness-core UUID
shape. A later GET form uses one exact path segment and rejects query
parameters; it cannot merge body, path, or query values.

Reject all unknown fields, especially reviewer, reviewer ID/role, role,
authority, user ID, email, metadata, JWT, token, session, cookie, header,
origin, and browser idempotency key. The primitives do not derive plan,
source, workspace, reviewer, or idempotency facts. Reject malformed data
before service factory construction where possible and output typed commands
with no excess properties.

## Duplicate-key and alternate-encoding rejection

JavaScript `JSON.parse` silently retains the last duplicate key. Future code
must use a parser or pre-parse lexical scanner that rejects duplicate keys at
every object depth before command construction. There is no last-key-wins
behavior.

The detector must correctly handle JSON strings and escaping, so key-like text
inside a string cannot cause a false positive. It returns a stable opaque
validation denial rather than raw parser detail.

The contract also rejects alternate encodings: body/query duplication, repeat
query parameters, path/query override, form-plus-JSON fallback, and identifier
aliases. Every accepted value has exactly one contract location.

## CSRF primitive

Issue is mutation-like and requires CSRF validation before the factory or its
`issue` operation. Snapshot uses the same policy when browser-credentialed
unless a separately reviewed narrow read-only exception exists.

Prefer a Next.js-compatible synchronizer token or signed double-submit token
bound to the authenticated browser session and validated server-side. Define
issuance, binding, rotation, expiry, comparison, and logout/session-replacement
rules. Deny missing, expired, malformed, invalid, or session-mismatched
evidence with a stable opaque result.

`Origin`, `Referer`, and Fetch Metadata such as `Sec-Fetch-Site` are additive
browser protections, never authority and never a CSRF replacement. Do not log
or return token values, comparison inputs, raw headers, or detailed failures.

## CORS and origin policy

Same-origin deployment on `admin.deraledger.com` is the default; it needs no
permissive CORS grant. If cross-origin use is later needed, use only an exact
reviewed environment-specific allowlist.

Reject `null`, arbitrary reflected origins, unrelated production origins, and
unapproved previews. Never emit wildcard `Access-Control-Allow-Origin` with
credentials. Credentialed CORS uses only exact approved origins, minimal
methods and headers, and generic non-sensitive preflight results.

Origin is browser defense in depth, not reviewer authority. Non-browser calls
still pass the session, resolver, validation, CSRF where applicable, and
throttle gates.

## Rate-limit and throttle

An admin-only throttle runs before M030 readiness transport, preventing
malformed, anonymous, non-super-admin, and repeated denied requests from
becoming a transport-amplification path.

Keys use safe server-derived context, such as a rotated/salted derived reviewer
identifier after resolution plus a coarse operation bucket. Do not use raw
tokens, cookies, headers, full email, full IP history, or the full body. Any
pre-authority throttle must use a separately reviewed privacy-preserving bucket
and cannot become authority.

Define window, limit, retry hints, storage failure, and escalation. Dependency
failure must fail closed or use an explicitly reviewed bounded degraded mode;
it cannot silently disable controls. Repeated-denial logging follows the
redaction rules below.

## Safe response mapper

The mapper accepts only typed readiness results and typed primitive denials. It
returns the route contract's allowlisted envelope: result kind, allowlisted
code, server correlation ID, and separately approved minimal issue/snapshot
fields.

Map issue created to 201, safe replay to 200, snapshot ready to 200,
malformed validation/CSRF input to 400, safely established missing/invalid
session to 401, derived non-super-admin to 403, safe request-missing to 404
only when deliberately exposed, canonical conflict to 409, throttle denial to
429, and transport/configuration/unknown conditions to opaque 500 unavailable.

Unknown result codes, malformed shapes, and unexpected errors map to safe
`unavailable`. Never inspect or relay raw Auth, Supabase, RPC, database,
service-role, session, transport, or stack errors. Never expose internal
idempotency, reviewer, workspace, merchant, or source IDs, or secrets, tokens,
cookies, headers, and raw metadata. Snapshot expansion requires separate data
minimization review.

## Safe logger and correlation ID

Generate an unpredictable server correlation ID for every non-preflight
request. It is tracing only, never a session token, CSRF token, authority
claim, or idempotency key.

The logger receives only operation name, correlation ID, timestamp, safe result
kind/code, and approved redacted or opaque IDs. It receives no secrets, tokens,
cookies, headers, raw metadata, raw Auth/RPC/database errors, stack traces,
full user IDs, full email, or PII-heavy bodies.

Operational logs are distinct from future durable compliance audit events.
These primitives create no approval/audit event and no staff/admin-management
audit. Log-sink failure cannot turn a denial into success; its availability
posture needs review before adoption.

## Authority boundary

Primitives protect a request; they do not determine reviewer authority. The
sole authority path remains:

`cookie-bound auth.getUser()` -> session reader -> reviewer resolver ->
`app_metadata.is_super_admin === true` -> readiness service.

No primitive accepts caller-supplied reviewer, authority, role, user ID, email,
metadata, JWT, header, cookie, or origin as authority. `user_metadata` is not
authority. Future admin, support, and compliance RBAC remains deferred; no
generic role checker or staff-management mechanism is created.

## Later implementation test plan

- content type, body size, invalid JSON, top-level shape, and nested-value
  rejection;
- duplicate keys at top and nested depth, escaped strings, and no
  last-key-wins behavior;
- unknown-field, authority-field, body/query/path ambiguity, UUID, status,
  policy-version, and reason-code validation;
- CSRF denial before factory/service call;
- same-origin/exact-allowlist CORS, generic preflight, and wildcard
  credentialed-CORS rejection;
- throttle denial before transport, safe key construction, and reviewed
  dependency-failure behavior;
- stable result/status mapping with raw-error and internal-ID redaction;
- correlation-ID uniqueness and logging allowlist/redaction;
- no direct Supabase, service-role, Auth Admin, table, or RPC construction in
  a future route; and
- no route/page/action/webhook created by this package, no approval execution,
  activation, collection unlock, payment, provider, checkout, subscription,
  invoice, or storefront behavior.

## Safe next step

Independently review this primitive design. Implementation remains blocked
until the route contract and deployment-cookie, CSRF, CORS, environment,
rate-limit, and logging gates are separately approved.

