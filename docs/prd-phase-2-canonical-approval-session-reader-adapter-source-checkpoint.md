# Canonical approval session reader adapter — source checkpoint

Date: 2026-08-28

## Scope

Implemented a source-only, server-only adapter at
`src/lib/compliance/server/canonical-approval-readiness-session-reader.ts`.
It privately creates the existing cookie-bound Supabase server client and
uses `auth.getUser()` as its only session source.

The adapter returns only a validated user ID plus copied `app_metadata` and
`user_metadata` records. It exposes no email, session, token, cookie, header,
provider identity, Supabase client, Auth Admin surface, table reader, or RPC
surface. Caller claims are not accepted. The reviewer resolver remains solely
responsible for accepting `app_metadata.is_super_admin === true`; user metadata
is not authority.

## Boundaries

- Source-only; no database, staging, or production access occurred.
- No route, page, action, webhook, admin API, or runtime wiring was added.
- The adapter neither issues M030 requests nor executes approvals.
- No activation, collection unlock, payment, provider, checkout, subscription,
  invoice, or storefront behavior was added.
- Missing context/session, Auth errors, invalid IDs, and malformed metadata
  return `null` without exposing raw Auth details.

## Verification

`tests/canonical-approval-readiness-session-reader.test.ts` covers the
server-only boundary, `auth.getUser()` use, minimal return shape, fail-closed
cases, export surface, import boundary, and forbidden-business-action scans.

## Safe next step

Independently review this source-only adapter before any service wiring or
runtime adoption.
