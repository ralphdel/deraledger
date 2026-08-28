# Admin readiness throttle and rate-limit boundary design

Date: 2026-08-28

## Status and scope

This is a design-only throttle and rate-limit storage and operations boundary
for future admin readiness routes. It creates no code, route, page, action,
webhook, admin UI, database access, or runtime adoption.

It does not issue an M030 request from a live handler, execute a final
approval, activate a merchant, unlock collection, or perform payment,
provider, checkout, subscription, invoice, or storefront behavior. It does
not alter reviewer authorization, implement future RBAC, or manage
super-admin or staff identities.

This document exists to define the future limiter's placement, keying,
storage, environment isolation, and failure posture before any route
implementation begins.

## Purpose and placement

The future throttle exists to prevent abuse, transport amplification, and
high-volume probing from reaching the readiness service or M030-backed
transport path.

Its purpose is limited to:

- reducing repeated invalid or abusive request volume
- preventing readiness transport amplification
- providing a reviewed operational boundary before service construction
- supporting safe denial and operational visibility

It is not reviewer authority, not CSRF, not authentication, and not a
replacement for strict request validation.

The future route ordering remains:

1. correlation ID generation
2. JSON parse and duplicate-key rejection
3. strict request validation
4. origin/CORS checks
5. CSRF checks
6. throttle or rate-limit check
7. create `createCanonicalApprovalReadinessServerService()`
8. call `issue` or `readSnapshot`
9. safe response mapping
10. redacted operational logging

This places the limiter after JSON validation, CORS, and CSRF, and before
service factory construction and before any readiness operation or M030-backed
transport use.

## Key strategy

Limiter keys must be privacy-safe and server-derived.

Recommended key shape:

- environment namespace
- operation bucket such as `issue` or `snapshot`
- reviewed derived subject bucket, using a redacted or salted server-side
  identifier

The key must avoid:

- raw tokens
- cookies
- headers
- full email addresses
- full user IDs
- full IP history
- full request bodies
- raw metadata

The limiter must not reuse correlation IDs, CSRF tokens, session cookies, or
browser identifiers as authority or as stable long-term primary keys.

Pre-authority bucketing is not part of this default design. If a future route
needs a coarse pre-authority bucket for abuse control before full reviewer
resolution, that requires a separate reviewed privacy and false-positive
analysis.

## Storage options

In-memory storage is not acceptable for production reliability because it does
not survive restarts, does not coordinate across instances, and makes rate
enforcement inconsistent under horizontal scaling.

Preferred options for later implementation review:

- Redis or equivalent low-latency provider-backed key-value store
- reviewed managed KV or cache service with environment isolation and TTL
  support

DB-backed storage is not authorized by this document. It may be considered
only in a separate review covering:

- schema design
- write amplification
- retention
- operational load
- migration safety
- contention and failure behavior

No database migration is created now.

## Fail behavior

The limiter must fail closed by default in production when it is unconfigured,
misconfigured, or unavailable, unless a separately reviewed bounded degraded
mode is explicitly approved.

Required future behavior:

- unconfigured production limiter denies by default
- dependency failure denies by default
- no silent disable
- no implicit fallback to in-memory production enforcement
- any bounded degraded mode must be separately reviewed and explicitly scoped

Staging and preview may use a separately reviewed non-production posture, but
they still must not silently fall through to unrestricted readiness route
execution if the design claims a limiter is present.

## Response and logging boundary

The future limiter may produce only safe public denial behavior:

- HTTP `429`
- safe code such as `rate_limited`
- optional reviewed retry hint only if separately approved and shown not to
  leak internal limiter state

The limiter must not expose:

- raw limiter keys
- storage provider details
- raw store errors
- dependency stack traces
- internal counters
- namespace details
- raw subject identifiers

Operational logging must remain redacted and aligned with the committed
logging boundary:

- correlation ID
- operation name
- safe result code
- timestamp
- approved redacted identifier only if needed

Repeated denied attempts may be logged safely, but they do not create durable
compliance audit events.

## Environment boundary

Limiter state must be environment-separated.

Required future rules:

- production uses a production limiter namespace only
- staging uses a staging namespace only
- preview uses a preview namespace only
- local development uses a local namespace only
- preview must not share production limiter storage or namespace
- staging must not share production limiter storage or namespace

Environment separation must be explicit in configuration and must not rely on
best-effort naming conventions alone.

If a provider-backed store is used, credentials, namespaces, and TTL policy
must be reviewed per environment as part of the deployment matrix.

## Abuse operations

Operational handling of repeated denials should remain narrow and safe.

Allowed future behavior:

- repeated denied attempts logged with safe result code and redacted
  identifiers
- coarse operational escalation guidance for human review when thresholds are
  crossed
- temporary operational throttling adjustments only through a separately
  reviewed admin-safe configuration path

Not allowed here:

- durable compliance audit events
- approval audit events
- staff-management audit events
- automatic reviewer authorization changes
- automatic super-admin management actions

## Authority boundary

The limiter does not authorize a caller and must not influence reviewer role
resolution beyond allowing or denying route progress.

Authority remains:

`auth.getUser()` -> session reader -> reviewer resolver ->
`app_metadata.is_super_admin === true`

`user_metadata` is not authority. Limiter state, counters, keys, and deny
history must never become authority signals or role evidence.

## Future RBAC and non-goals

Future RBAC remains deferred. This package does not design or authorize:

- code implementation
- route creation
- admin UI
- staff or super-admin management
- reviewer authorization changes
- future RBAC roles
- approval execution
- merchant activation
- collection unlock
- payment, provider, checkout, subscription, invoice, or storefront behavior

## Later implementation test plan

A later implementation review should prove:

- throttle executes before service factory construction
- allowed requests can proceed when the limiter explicitly allows them
- denied requests block service construction or service use
- dependency failure fails closed
- unsafe key material is rejected or impossible to construct
- no raw limiter keys, store errors, or internal counters appear in responses
  or logs
- environment namespaces and backing stores remain separated
- no runtime adoption beyond the approved route occurs
- no approval execution, activation, collection unlock, payment, provider,
  checkout, subscription, invoice, or storefront behavior is introduced

## Safe next step

Independently review this throttle and rate-limit boundary design before any
admin readiness route implementation begins. Route adoption remains blocked
until this storage and failure boundary, together with the deployment, CSRF,
response, logging, and route-ordering gates, is implemented and reviewed.
