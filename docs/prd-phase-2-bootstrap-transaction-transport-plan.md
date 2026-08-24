# PRD Phase 2 Bootstrap Transaction Transport Plan

Status: source-only plan. No transport, migration, RPC, route, profile row, payment test, or production behavior is authorized by this document.

## Recommended transport

Use one future PostgreSQL `SECURITY INVOKER` PL/pgSQL RPC, invoked only by a server-created service-role Supabase client. The RPC is the concrete implementation behind `ReviewedProfileBootstrapServiceRoleTransactionTransport.runInTransaction`; it replaces the current injected mock transport rather than exposing individual table writes.

This is the safest mechanism because one PostgreSQL function call runs inside one database transaction: every lookup, idempotency decision, insert, and constraint check commits together, and any unhandled error rolls all changes back. It also avoids attempting to assemble a transaction from separate PostgREST calls, which cannot provide the required all-or-nothing guarantee.

The function must use `SECURITY INVOKER`, not a broad definer privilege escalation. Its execute permission must be revoked from `PUBLIC`, `anon`, and `authenticated` and granted only to `service_role`. The calling application must instantiate the service-role client only on the trusted server after authenticating and authorizing the internal reviewer.

## Permitted write scope

The RPC may read and write only:

- `public.merchant_compliance_profiles`
- `public.merchant_compliance_reviews` for Solo Lite and Business only
- `public.merchant_compliance_events`

Solo Plus binds a trusted existing Solo Plus case as `solo_plus_case`; it must not manufacture a `merchant_compliance_reviews` row because Migration 024 permits that table only for `solo_lite` and `business_kyb` reviews.

The RPC must never write merchants, workspaces, subscriptions, payment records, invoices, settlement accounts, provider mappings/configuration, limit windows/reservations/usage, verification records, or any other table.

## Transaction and idempotency rules

The single RPC first locks/reads the merchant profile and exact review/event idempotency keys. A matching, internally consistent operation returns the original identifiers as an existing result. Verified, rejected, restricted, and suspended profiles are preserved. Duplicate, inconsistent, or ambiguous profile/review/event rows fail closed.

For a new operation, the RPC creates deterministic linked profile/review/event IDs within the same transaction, inserts the profile, creates the canonical review or Solo Plus case binding, then writes the append-only event. Any failure—including validation, uniqueness, FK, RLS, or event insert failure—aborts the function call and rolls back every row. The caller must never translate an error or timeout into `created`.

## Non-operational contract

The RPC accepts only the validated reviewed-bootstrap payload and revalidates it. All six merchant entitlement fields must be explicit `false`; `activation_status` is `test_mode` unless an explicit non-operational restriction/suspension outcome is recorded; and `restriction_state` is null by default and never `active` by default.

It must reject approval, collection enablement, `setup_mode=false`, `live_features_enabled=true`, limit approval, payment/provider input, and browser-supplied merchant/workspace/plan/evidence values. Bootstrap neither activates a merchant nor unlocks collection, checkout, settlement, or storefront.

## Service-role and diagnostics controls

The future migration must preserve Migration 024 base-table RLS and grants, make the function service-role executable only, and include hostile grant checks. The TypeScript transport adapter continues to require both `databaseRole = service_role` and `internalReviewAuthorized = true`; ordinary app routes remain unimported.

RPC output and client diagnostics contain only stable codes and opaque generated identifiers as approved by the executor contract. They must exclude raw database errors, evidence bodies, BVN/NIN/CAC, bank data, provider/payment references, secrets, cookies, headers, and tokens.

## Disposable rehearsal plan

1. Read the database safety runbook and incident ledger before preparing any SQL.
2. Build a disposable database matching the confirmed 024 postflight fingerprint.
3. Apply the future function/grant migration once, then rerun it for idempotency.
4. Verify function execute grants: service role only; no `PUBLIC`, `anon`, or `authenticated` access.
5. Exercise Lite, Business, and Solo Plus case-binding success paths.
6. Force profile, review, event, uniqueness, and late constraint failures; prove zero partial rows remain after each.
7. Test replay, preserved profiles, and duplicate/ambiguous state fail-closed behavior.
8. Verify the forbidden-table write set remains empty and existing merchant/workspace/payment/provider rows are unchanged.

## Rollout gates and implementation tests

Implementation requires a separately approved migration package with preflight/postflight, static grant/RPC tests, disposable rehearsal evidence, and an independent source review. Staging/prod remain blocked until all of those pass and an explicit single-reviewed-bootstrap rollout is approved. No route/action adoption, activation transition, collection test, payment test, or storefront work follows automatically.

Required tests include service-role acceptance and anon/authenticated/browser denial; exact Lite/Business review shape; Solo Plus case binding; payload revalidation; profile/review/event rollback; idempotent replay; preserved profile behavior; duplicate/ambiguous rejection; safe diagnostics; zero forbidden table writes; zero runtime imports; and no import-time database call.
