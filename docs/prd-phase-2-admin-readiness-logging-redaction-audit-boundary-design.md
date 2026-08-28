# Admin readiness logging, redaction, and audit boundary design

Date: 2026-08-28

## Status and scope

This is a design-only logging, redaction, and operational-audit boundary for
future admin readiness routes. It creates no code, route, page, action,
webhook, admin UI, database access, or runtime adoption.

It does not issue an M030 request from a live handler, execute a final
approval, activate a merchant, unlock collection, or perform payment,
provider, checkout, subscription, invoice, or storefront behavior. It does
not alter reviewer authorization, implement future RBAC, or manage
super-admin or staff identities.

This document exists to make the future logging and redaction posture explicit
before any admin readiness route is implemented.

## Operational logging boundary

Future admin readiness routes may emit only narrow operational logs. The
allowlisted operational fields are:

- server-generated correlation ID
- operation name
- safe result kind
- safe result code
- timestamp
- approved redacted identifier only when separately needed

Operational logging is for supportability and failure triage only. It is not a
business record, reviewer authority input, session artifact, or audit proof of
an approval decision.

Redacted identifiers must remain minimal. If an identifier is needed, it
should use a reviewed redacted or opaque form such as:

- suffix-redacted request identifier
- suffix-redacted profile identifier
- opaque route bucket or correlation reference

Full identifiers should not be the default.

## Forbidden log data

Future logs must not contain:

- tokens
- cookies
- headers
- secrets
- service-role credentials
- `sb_secret_` keys
- raw Auth errors
- raw Supabase errors
- raw RPC or database errors
- stack traces
- raw metadata
- full email addresses
- full user IDs
- full request or response bodies
- PII-heavy command payloads
- internal idempotency keys
- reviewer IDs
- workspace IDs
- merchant IDs
- source IDs

The boundary is deny-by-default. If a field is not explicitly approved, it
must not be logged.

## Response redaction boundary

Future admin readiness responses must remain aligned to the committed safe
response contract and route security primitives. Responses must not expose:

- diagnostics arrays
- internal idempotency keys
- reviewer IDs
- workspace IDs
- merchant IDs
- source IDs
- raw Auth, Supabase, RPC, database, session, transport, or stack errors
- secrets
- tokens
- cookies
- headers
- session objects
- raw metadata

Responses may contain only allowlisted safe envelopes, safe result codes, the
server correlation ID, and the separately approved minimal public readiness
projection.

Unknown or malformed internal failures must map to an opaque unavailable
result, not a raw or diagnostic-rich error surface.

## Audit boundary

Operational logs are not durable compliance audit events.

This boundary explicitly excludes:

- durable approval-decision audit events
- durable readiness audit events
- staff-management audit events
- super-admin management audit events
- identity-recovery audit events

Any future durable audit model requires a separate design package covering:

- exact event vocabulary
- retention and storage
- data minimization
- access control
- operational vs compliance audit separation
- replay/tamper considerations

No future route should treat ordinary operational logs as a substitute for a
reviewed durable audit model.

## Failure behavior

Logging failures must never turn a denied request into a successful request and
must never broaden a route response.

Required future behavior:

- if log emission fails, preserve the already-determined safe route result;
- if a log input contains unsafe fields, drop or redact those fields before
  emission;
- if a logger dependency is unavailable, fail closed only for the logging path,
  not by leaking raw internals;
- unknown internal errors must map to opaque unavailable responses;
- a logging helper must not throw raw exceptions into the public route
  response.

This means logging is downstream of safe response determination, not a source
of public error detail.

## Correlation boundary

The correlation ID is tracing only. It is not:

- reviewer authority
- CSRF proof
- idempotency key
- session token
- authentication state
- permission grant

The correlation ID should be generated early by the route, carried through the
safe response mapper, and included in redacted operational logs so a future
operator can match a client-safe failure to a server-side operational trace
without exposing secrets or internal identifiers.

## Route ordering

The future route order must preserve the current committed design:

1. generate correlation ID
2. parse JSON and reject duplicate keys
3. validate request shape
4. apply origin/CORS policy
5. apply CSRF checks
6. apply rate-limit checks
7. construct the zero-argument readiness service factory
8. call readiness operation
9. map the safe public response
10. emit redacted operational log

Denied attempts may be logged only after the safe result is known and only
with the safe code, operation name, correlation ID, timestamp, and reviewed
redacted identifiers.

## Authority boundary

Logging and audit boundaries do not authorize a reviewer and do not modify the
existing authority path. Authority remains:

`auth.getUser()` -> session reader -> reviewer resolver ->
`app_metadata.is_super_admin === true`

`user_metadata` is not authority. Logged data must never be reused as an
authorization signal, role hint, CSRF substitute, or session recovery input.

## Future RBAC and non-goals

Future RBAC remains deferred. This package does not design or authorize:

- code implementation
- route creation
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

- unsafe fields are rejected or redacted before logging
- raw Auth, Supabase, RPC, and database errors are never logged directly
- full email addresses and full user IDs are not logged
- correlation IDs are server-generated and unique enough for operational use
- logging dependency failure does not turn denial into success and does not
  leak raw errors
- no durable audit event is created by the operational logging path
- no approval execution, activation, collection unlock, payment, provider,
  checkout, subscription, invoice, or storefront behavior is introduced

## Safe next step

Independently review this logging, redaction, and audit-boundary design before
any admin readiness route implementation begins. Route adoption remains
blocked until this boundary and the related deployment, CSRF, CORS, response,
and throttle gates are implemented and reviewed together.
