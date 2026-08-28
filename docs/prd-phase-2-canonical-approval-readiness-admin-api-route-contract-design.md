# Canonical approval readiness admin API route contract design

Date: 2026-08-28

## Status and scope

This is a design-only contract for future internal admin API endpoints that
could expose canonical approval readiness issuance and snapshot reading. It
creates no route, page, action, webhook, admin UI, database access, or runtime
adoption.

It does not execute an approval, activate a merchant, unlock collection, or
perform payment, provider, checkout, subscription, invoice, or storefront
behavior. Readiness is not approval. The only future permitted write is the
existing M030 immutable decision-request issuance behind the approved
readiness service, after every gate passes.

This contract is blocked until the admin API adoption gate and admin-portal
security prerequisites are implemented, tested, and independently approved.

## Proposed endpoints

The following routes are options only and are not created by this document:

- `POST /api/internal/admin/compliance/readiness/issue`
- preferred snapshot form: `POST /api/internal/admin/compliance/readiness/snapshot`
- possible later read-only form: `GET /api/internal/admin/compliance/readiness/snapshot/{decisionRequestId}`

The POST snapshot form is preferred initially because it avoids putting a
decision-request identifier into URLs, browser history, route logs, and
intermediary caches. A GET form requires a separate cache and URL-logging
review before implementation.

These routes may later be served beneath `admin.deraledger.com`. They must not
hardcode `deraledger.com/admin`. Host, origin, Referer, and subdomain are not
reviewer authority; they are only defense-in-depth browser controls.

## Issue request contract

The issue endpoint accepts a JSON object with exactly these keys:

```json
{
  "profileId": "uuid",
  "targetComplianceStatus": "lite_verified | enhanced_verified | business_verified | needs_attention | restricted | rejected",
  "policyVersion": "non-empty policy version",
  "reasonCode": "optional approved reason code or null"
}
```

`reasonCode` is optional. When it is absent it is normalized to `null`; when
present it must be `null` or one of the existing readiness-safe values:

- `evidence_incomplete`
- `evidence_expired`
- `evidence_mismatch`
- `review_rejected`
- `reviewer_requested_correction`
- `policy_restriction`
- `risk_restricted`
- `risk_suspended`

The route must reject every other field, including `reviewer`, `reviewerId`,
`reviewerRole`, `role`, `authority`, `userId`, `email`, `app_metadata`,
`user_metadata`, `jwt`, `token`, `session`, `headers`, `cookies`, `origin`,
and `idempotencyKey`. It must not accept a browser-supplied idempotency key:
M030 derives durable idempotency from trusted canonical state and the derived
reviewer identity.

## Snapshot request contract

The preferred POST snapshot endpoint accepts a JSON object with exactly one
key:

```json
{ "decisionRequestId": "uuid" }
```

If a later reviewed GET form is selected, the same identifier is accepted only
as one exact path segment; it accepts no query parameters or alternate
identifier encodings.

The endpoint rejects reviewer/authority/user fields, `profileId`, source or
status overrides, workspace or merchant overrides, metadata, idempotency
fields, and every unknown field. A snapshot is always for the immutable
request selected by `decisionRequestId`, revalidated by M030; it is never a
caller-shaped profile lookup.

## Strict request validation

Before a service factory is created or a readiness operation is called, the
future route must enforce all of these rules:

- Require `Content-Type: application/json` for POST and a small reviewed body
  size limit.
- Require a plain JSON object. Reject arrays, `null`, scalars, nested objects,
  and non-JSON bodies.
- Reject unknown keys and fields with duplicate or ambiguous encodings. The
  implementation must use a parser/validation layer capable of detecting
  duplicate JSON keys, rather than accepting JavaScript `JSON.parse` last-key
  wins behavior silently.
- Validate `profileId` and `decisionRequestId` as the UUID shape accepted by
  the existing readiness core.
- Allow only the existing target statuses: `lite_verified`,
  `enhanced_verified`, `business_verified`, `needs_attention`, `restricted`,
  and `rejected`.
- Require a trimmed, non-empty `policyVersion`; place a separately reviewed
  length limit on it without rewriting or inferring a policy value.
- Normalize optional `reasonCode` only as described above; unknown values are
  invalid, never converted to an authority or fallback reason.
- Reject malformed values before the rate-limit/service transport boundary.

The route does not take plan, source type, source version, workspace, or
reviewer values from the browser. Existing M030 and readiness-core canonical
checks derive and verify those facts.

## Authority and session contract

For readiness behavior, a future route imports only
`createCanonicalApprovalReadinessServerService()` and invokes its `issue` or
`readSnapshot` operation. It must not construct a Supabase client, use Auth
Admin, read service-role credentials, call M030 directly, or access a generic
RPC/table/query surface.

The only authority flow is:

`cookie-bound auth.getUser()` -> session reader -> reviewer resolver ->
`app_metadata.is_super_admin === true` -> readiness service.

The request cannot supply or override reviewer identity, role, authority,
user ID, email, metadata, JWT, header, cookie, origin, or browser claim.
`user_metadata` is never authority. `admin`, `support manager`, `compliance
manager`, `compliance officer`, `support`, and `compliance reviewer` remain
denied and deferred.

## CSRF and CORS contract

Issue requests require the separately approved CSRF mechanism. The route
must reject missing, expired, malformed, or invalid CSRF evidence before the
service call. Same-origin `Origin`/`Referer` and Fetch Metadata checks are
defense in depth, not authority.

Snapshot requests require a derived authenticated super-admin and the reviewed
same-origin/CORS posture. They must reject cross-origin or malformed use
according to the deployed policy and must not be shared-cacheable. If the
endpoint is browser-credentialed, apply the same CSRF protection unless a
separate review approves a narrowly defined read-only exception.

Same-origin deployment under `admin.deraledger.com` is preferred. No wildcard
credentialed CORS is permitted. Any cross-origin deployment must have an
exact, environment-specific reviewed allowlist and generic preflight results.

## Safe response contract

Responses use a stable allowlisted envelope:

```json
{
  "result": "created | replay | ready | rejected | unavailable",
  "code": "allowlisted safe readiness or API code",
  "correlationId": "opaque server-generated value"
}
```

For issue creation or replay, the response may additionally contain only
`decisionRequestId`. It must not return `decisionIdempotencyKey`, the derived
reviewer ID, Auth/session data, or raw M030 row data.

For a ready snapshot, the response may additionally contain this explicit,
non-PII-heavy readiness projection:

```json
{
  "snapshot": {
    "decisionRequestId": "uuid",
    "profileId": "uuid",
    "planCode": "solo_lite | solo_plus | business",
    "currentComplianceStatus": "canonical current status",
    "sourceType": "solo_lite_review | solo_plus_case | business_kyb_review",
    "sourceVersion": 1,
    "expectedProfileRowVersion": 1,
    "policyVersion": "string",
    "reasonCode": "approved reason code or null",
    "targetComplianceStatus": "approved target status"
  }
}
```

Do not expose workspace ID, merchant ID, source ID, reviewer ID, internal
idempotency key, raw metadata, or timestamps unless a separate API-data
minimization review establishes a concrete need. No response may expose raw
Auth, Supabase, RPC, database, service-role, session, transport, or stack
details; it must not contain secrets, tokens, cookies, headers, or PII-heavy
payloads.

The API code vocabulary is an allowlist over the existing readiness-safe
codes. It may surface `canonical_request_v2_created` and
`canonical_request_v2_idempotent_replay` only through the `created`/`replay`
envelope. Rejected outcomes may use only the existing
`CanonicalApprovalReadinessReasonCode` vocabulary or a separately documented
opaque API validation/throttling code. Unknown, malformed, or future codes
map to `unavailable` with an opaque internal failure code.

## HTTP status mapping

| Condition | Status | Safe public outcome |
| --- | ---: | --- |
| Canonical issue created | 201 | `created` + `canonical_request_v2_created` |
| Canonical issue replay | 200 | `replay` + `canonical_request_v2_idempotent_replay` |
| Canonical snapshot ready | 200 | `ready` + `canonical_snapshot_v2_ready` |
| Malformed body, unknown fields, invalid command, invalid CSRF token | 400 | `rejected` + opaque validation/CSRF code |
| Missing or invalid authenticated session, when safely established by the reviewed route auth boundary | 401 | `rejected` + `authentication_required` |
| Derived session is not super-admin | 403 | `rejected` + `canonical_readiness_authority_denied` |
| Safe request-not-found mapping, where M030's request-missing outcome is deliberately exposed | 404 | `rejected` + `canonical_snapshot_v2_request_missing` |
| M030 durable idempotency conflict or canonical linkage conflict | 409 | `rejected` + existing safe conflict code |
| Admin throttle exceeded | 429 | `rejected` + `rate_limited` |
| Transport/configuration/unrecognized result/internal unavailable | 500 | `unavailable` + opaque safe code |

The current readiness service intentionally collapses some authority failures
into `canonical_readiness_authority_denied`. A route must not inspect raw Auth
errors to force a 401/403 distinction. Before implementation, either add a
separately reviewed narrow safe authentication-state contract or map the
collapsed case consistently to 403. It must never leak whether an arbitrary
account or session exists.

## M030 boundary and idempotency

The route may call only the factory's `issue` and `readSnapshot` operations.
It must not directly call M030 RPCs, write tables, invoke the final approval
RPC, or implement a second idempotency system. M030's canonical durable
idempotency remains authoritative. A route correlation ID is operational only;
it does not authorize a request and cannot alter replay semantics.

Readiness issuance may create only the approved immutable decision request
through the existing M030 service seam after all authority, validation, CSRF,
rate-limit, profile/source/policy/workspace, and idempotency gates pass.

## Logging and rate-limit contract

Generate a safe correlation ID before validation and log only allowlisted
facts: operation name, correlation ID, safe result/code, and redacted or
opaque identifiers. Do not log tokens, cookies, headers, raw metadata, raw
errors, internal idempotency key, or request/response bodies.

Apply the reviewed admin-only throttle before M030 readiness transport. Its
keys must avoid secrets, raw tokens, and full PII. Repeated denied attempts
may produce redacted operational logs but do not create approval, compliance,
or staff-management audit events.

## Deferred RBAC and super-admin protection

This contract enables no future admin, support, or compliance role. It creates
no staff identity, role management, super-admin management, or user
creation/removal/recovery endpoint.

## Release and test gates before implementation

Before creating either route, all admin-portal security prerequisite gates
must be approved. A later implementation must prove:

- the route imports only the zero-argument readiness factory;
- strict request-schema, duplicate-key, body-size, and unknown-field tests;
- no caller-authority field can bypass the server session and resolver;
- CSRF denial happens before the readiness service call;
- same-origin/CORS and rate-limit behavior follows the approved deployment
  policy;
- status/result mapping and raw-error redaction are stable;
- no runtime adoption beyond the approved route occurs without separate
  authorization; and
- no final approval execution, activation, collection unlock, payment,
  provider, checkout, subscription, invoice, or storefront behavior exists.

## Safe next step

Independently review this route-contract design. Route implementation remains
blocked until deployment-cookie, CSRF, CORS, environment, rate-limit, logging,
and response-minimization prerequisites are all separately passed.
