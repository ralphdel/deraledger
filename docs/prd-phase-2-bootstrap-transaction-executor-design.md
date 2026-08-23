# PRD Phase 2 Bootstrap Transaction Executor Design

Status: source-only design. This document does not authorize an executor, a database write, runtime adoption, profile bootstrap, activation, payment test, or collection test.

## 1. Purpose

The future executor is the sole service-role transaction boundary for a reviewed profile-bootstrap command. It consumes the already-validated `ReviewedProfileBootstrapPayload` and either persists the complete non-operational bootstrap projection or returns a safe failure/existing result. It must never turn a review bootstrap into compliance approval or a collection unlock.

The existing `reviewed-profile-bootstrap-persistence-core.ts` remains an adapter contract. A later executor implements its `executeAtomically` dependency; it must not be replaced with independent client-side table calls.

## 2. Service-role requirement

Migration 024 makes the compliance substrate service-only: RLS is enabled, there are zero browser policies, `PUBLIC`, `anon`, and `authenticated` have no table privileges, and only `service_role` has the required table grants. The executor must therefore:

- run only in a trusted server environment with a service-role credential held outside browser/request input;
- authenticate and authorize the internal review actor before it reaches the executor;
- never expose the executor directly through a browser route, page, client action, RPC grant, or generic database proxy;
- use trusted merchant/workspace identity and review evidence resolved server-side, not submitted IDs, plan labels, or payment/provider metadata.

## 3. Transaction boundary

One database transaction must include all lookup, idempotency, preservation, and insert operations. It succeeds only after every required row is durably written:

1. lock/read the merchant's current compliance profile and keyed review/event state;
2. evaluate idempotency and preservation rules;
3. insert the profile when no existing result applies;
4. insert the required review projection or bind the existing Solo Plus case;
5. insert the immutable bootstrap event;
6. commit and return the identifiers.

Any query, uniqueness, foreign-key, RLS, constraint, profile, review, or event failure rolls the complete transaction back. The executor must not return `created` after any partial write. A failed transaction returns only a safe diagnostic code; reconciliation is not performed by silently retrying writes outside a new transaction.

## 4. Expected input

The executor accepts only a validated payload produced by the reviewed bootstrap service, plus trusted server execution context. Required payload fields are merchant and workspace IDs, bootstrap idempotency key, plan code, canonical non-operational compliance status, activation/restriction state, reviewed source ID, reviewer ID, review timestamp, and six explicit `false` merchant entitlement flags.

The executor must revalidate the payload at its trust boundary. It rejects absent IDs/key/evidence, unsupported plan/state combinations, `activation_status = approved`, `restriction_state = active`, and any true or missing merchant entitlement. It does not accept payment records, legacy `verification_status`, `setup_mode`, `live_features_enabled`, provider metadata, or browser values as approval evidence.

## 5. Idempotency and lookup rules

- Lock/read `merchant_compliance_reviews` by `(merchant_id, idempotency_key)` for Solo Lite and Business. A single matching row returns an existing result; multiple rows fail closed.
- Lock/read the corresponding bootstrap event idempotency key. A single matching event must agree with the review/profile linkage; disagreement or duplicates fail closed.
- Lock/read `merchant_compliance_profiles` by `merchant_id`. Zero is eligible to create. More than one fails closed. One verified, rejected, restricted, or suspended profile is returned preserved and is never downgraded/overwritten. One other existing profile is a conflict unless it matches the same complete bootstrap operation.
- Use stable, server-generated UUIDs for profile/review/event links before inserts. Do not rely on separate commits or an after-insert patch.

## 6. Row creation rules

For Solo Lite, the transaction creates a `lite_pending` profile, `solo_lite` review, and bootstrap event; the review UUID is the profile/event source ID. For Business, it creates a `business_pending` profile, `business_kyb` review, and event with the same linkage. For Solo Plus, the executor must link the trusted existing Solo Plus case as `solo_plus_case`; Migration 024 intentionally does not allow a fabricated `merchant_compliance_reviews` Solo Plus row.

The event is append-only. `from_state` is the empty bootstrap state and `to_state` contains only safe status/restriction/false-entitlement projection fields. Evidence snapshots and metadata use references, statuses, checksums, and reason codes only—never raw identity, bank, provider, or credential data.

## 7. Non-operational guarantee

The executor may write only the three approved compliance substrate tables and only the bootstrap-compatible rows described above. Every new profile keeps all merchant entitlements false. Default state is `activation_status = test_mode` and `restriction_state = null`. Explicit restriction/suspension outcomes remain non-operational; rejected outcomes remain non-operational as well.

It must never write approval, collection entitlement, live storefront entitlement, settlement activation, limits approval, a limit window/reservation/usage event, `setup_mode=false`, `live_features_enabled=true`, verification approval, merchant/workspace data, subscriptions, payment records, invoices, settlement accounts, provider mappings, provider configuration, or payment/webhook data.

## 8. Safe diagnostics

Returned/logged diagnostics are allowlisted machine codes only, for example `bootstrap_payload_invalid`, `bootstrap_existing_result`, `bootstrap_profile_preserved`, `bootstrap_profile_ambiguous`, `bootstrap_review_ambiguous`, and `bootstrap_atomic_write_failed`. Diagnostics must omit raw merchant/workspace IDs, BVN/NIN/CAC evidence, bank data, payment/provider references, request headers, tokens, cookies, raw database errors, notes, and evidence content. Internal correlation IDs may be logged separately under the existing protected observability policy.

## 9. Tests required before implementation

- transaction commits profile/review/event together for Lite and Business;
- Solo Plus binds a valid existing case and does not create an invalid review-table row;
- every entitlement is false; default activation is `test_mode`; default restriction is null;
- rejected/restricted/suspended outcomes stay non-operational;
- repeated key returns the exact existing operation;
- verified/rejected/restricted/suspended profiles are preserved;
- duplicate/ambiguous profile, review, or event rows fail closed;
- each late failure rolls back profile, review, and event rows; no partial success response;
- service-role-only executor rejects browser/anon/authenticated contexts;
- no merchant/workspace/payment/subscription/provider tables are written;
- safe diagnostics contain no sensitive data;
- no route/action/page imports the executor until separately approved.

## 10. Rollout gates

Before implementation: approve this design, the executor interface, trusted reviewer authorization, service-role secret handling, transaction mechanism, and test plan. Before any staging or production write: run the approved disposable rehearsal and read-only preflight/postflight process, add no backfill, and use a reviewed single-merchant test only after explicit authorization.

Before route adoption: review an audit trail, idempotency behavior, rollback behavior, diagnostics, and a separate activation transition design. Bootstrap creation alone never authorizes collection, checkout, provider calls, or storefront use.
