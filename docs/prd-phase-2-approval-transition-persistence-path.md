# PRD Phase 2 Approval Transition Persistence Path

Status: source-only design. This document authorizes no implementation, SQL, migration, database connection, profile row, route adoption, activation, payment test, collection test, or production behavior change.

## 1. Purpose

The future approval persistence path is the sole atomic, service-role-only boundary for applying a validated `ComplianceProfileApprovalPayload`. Its purpose is to record a reviewer decision against an existing reviewed compliance profile while preserving a complete audit history. It changes compliance review state only; it is not a merchant activation path.

Migration 025 remains source-only and blocked from staging and production until its local disposable PostgreSQL rehearsal succeeds. This approval persistence path cannot be implemented, migrated, or adopted before that gate is cleared and separately reviewed.

## 2. Required input and trust boundary

The persistence path accepts only a `ComplianceProfileApprovalPayload` produced by `prepareComplianceProfileApprovalCommand` and a separate trusted internal execution context. It must revalidate both at the transaction boundary.

Required command fields are trusted merchant/workspace identity, server-generated approval decision key, expected profile row version, plan code, canonical source and target compliance state, trusted reviewer identity, reviewed timestamp, source type/ID, evidence version, policy version, and an allowlisted reason code when the outcome requires one.

It must reject browser-supplied authority, merchant/workspace/plan values, payment or provider metadata, legacy verification values, `setup_mode`, `live_features_enabled`, subscription state, payout state, and settlement/provider mappings as approval authority. Those sources may be reviewed externally as evidence references, but they cannot independently form or mutate an approval command.

## 3. Service-role-only execution

Migration 024 base tables are service-only: RLS is enabled, there are zero browser policies, and only `service_role` holds the relevant table privileges. The future executor must therefore:

- run only in a trusted server environment using a service-role client created after internal reviewer authorization;
- reject anon, authenticated-browser, generic server, and untrusted proxy contexts;
- use one `SECURITY INVOKER`, service-role-only transaction transport rather than independent PostgREST writes;
- revoke RPC execution from `PUBLIC`, `anon`, and `authenticated` when a future approval RPC is prepared;
- never expose the persistence boundary directly through a route, action, page, generic RPC proxy, checkout, callback, or webhook.

## 4. Atomic transaction boundary

One transaction must cover all reads, preservation checks, optimistic-concurrency checks, profile/review-or-case decision update, and append-only event insertion. The transaction returns success only after all required changes commit.

1. Lock/read exactly one `merchant_compliance_profiles` row by trusted `merchant_id`.
2. Lock/read the decision source: the Lite/Business review or trusted Solo Plus case.
3. Lock/read the approval event idempotency key for that merchant.
4. Evaluate replay, preservation, source/plan/status consistency, evidence version, policy version, and expected profile row version.
5. Update the permitted profile fields and the applicable Lite/Business review, or bind the trusted Solo Plus case decision through its existing boundary.
6. Insert exactly one immutable approval event.
7. Commit and return only opaque identifiers and safe result codes.

Any read, validation, authorization, concurrency, uniqueness, RLS, constraint, review/case, profile update, or event insert error rolls back the entire transaction. A timeout or error must never be translated into an approved or partially applied result.

## 5. Profile lookup and row-version rules

The transaction locks the unique profile for the trusted merchant. No profile is an `approval_profile_missing` failure; more than one profile is an `approval_ambiguous_state` failure. It must never pick an arbitrary profile.

`expectedProfileRowVersion` is mandatory and must match the locked row. A mismatch returns a safe row-version conflict without applying any write. A successful transition increments `row_version` exactly once and stores that value as the event's `resulting_row_version`.

The only ordinary profile status changes are the canonical pending/attention source states to their matching verified, attention, restricted, or rejected target state. Suspension remains `restriction_state = suspended` with non-operational `activation_status = suspended`; it is never persisted as `compliance_status = suspended`.

## 6. Lite, Business, and Solo Plus decision-source rules

For Solo Lite, lock the existing `merchant_compliance_reviews` row for the trusted profile/merchant with `review_type = solo_lite`. The review must match the command source ID, target plan, evidence version, policy version, and reviewer decision. Update only canonical review-decision metadata, such as review status, reviewer, reviewed time, safe reason, policy version, and row version.

For Business, follow the same rule using the existing `business_kyb` review. A mismatch, absent review, duplicate review, or stale review version fails closed.

For Solo Plus, do not create or update a `merchant_compliance_reviews` row. Migration 024 reserves that table for Solo Lite and Business review types. The transaction instead validates and binds the trusted existing `solo_plus_case` decision source through its separately authorized case boundary. An absent, ambiguous, mismatched, or unapproved case fails closed.

## 7. Event and audit rules

Every state-changing approval outcome appends exactly one `merchant_compliance_events` row in the same transaction. The event includes an allowlisted event type, safe prior and resulting state snapshots, trusted reviewer actor, decision source reference, policy version, approval decision key, expected row version, resulting row version, and safe reason code.

The event must not store raw identity evidence, BVN/NIN/CAC, selfie material, bank data, provider/payment payloads or references, raw risk notes, credentials, cookies, headers, tokens, or raw database errors. Corrections are future compensating events, never updates or deletes to the append-only event table.

## 8. Idempotency, replay, preservation, and ambiguity

The approval decision key is unique per merchant event scope. A single matching event, profile version, source linkage, and target state returns the original outcome as an idempotent replay without a second profile update, review/case update, or event.

Existing verified, rejected, restricted, or suspended profiles are preserved. A later re-review, re-lock, or restriction-release workflow requires a separately approved transition; this path must never overwrite those states with a weaker request or infer freshness from payment, subscription, or setup data.

Duplicate or inconsistent profile, review, Solo Plus case, or idempotency-event rows are fail-closed ambiguity conditions. A keyed event that does not agree with the profile/source/state linkage is also an ambiguity failure, not a replay success.

## 9. Allowed future writes

Within the one atomic transaction, a later approved implementation may write only:

- `public.merchant_compliance_profiles`: canonical `compliance_status`, non-operational restriction fields when applicable, decision-source/audit fields, reviewer/timestamp/policy fields, and `row_version`.
- `public.merchant_compliance_reviews` for Solo Lite and Business only: canonical review status, reviewer/timestamp/policy/safe-reason metadata, and `row_version`.
- The existing trusted Solo Plus case through its separately authorized decision interface; no fabricated compliance-review row.
- `public.merchant_compliance_events`: one append-only approval audit event.

Ordinary approval preserves `activation_status = test_mode` in the first implementation. Restricted/suspended decisions may keep a non-operational restriction activation state. All six merchant entitlement flags remain explicitly `false`.

## 10. Prohibited writes and non-unlock guarantee

The approval path must never create or update:

- collection limit windows, reservations, reservation-window links, usage events, approved limits, or limit counters;
- collection, Instant Sale, Receivable Sale, storefront, settlement-activation, or Deposit & Balance entitlements;
- settlement activation, payout verification, provider mappings/configuration, payment routing, provider state, payment records, subscriptions, invoices, or checkout state;
- `merchants`, `workspaces`, `workspace_subscriptions`, verification records, or any runtime gate projection outside the permitted profile/review/event fields.

It must not set `setup_mode = false`, set `live_features_enabled = true`, mark a commercial entitlement active, or otherwise unlock collection. Approval is not activation. A separate future activation transition remains responsible for requiring active commercial entitlement, verified compliance, risk clearance, approved limits, explicit active restriction state, payout verification, exact provider mapping readiness, setup/live readiness, global feature flags, and merchant entitlements.

## 11. Safe diagnostics

The future interface may return or log only allowlisted reason codes, for example: `approval_payload_invalid`, `approval_reviewer_unauthorized`, `approval_profile_missing`, `approval_profile_preserved`, `approval_source_mismatch`, `approval_evidence_incomplete`, `approval_row_version_conflict`, `approval_ambiguous_state`, `approval_idempotent_replay`, and `approval_atomic_write_failed`.

Diagnostics must be redacted. They must omit raw merchant/workspace IDs from browser-visible output, all identity/bank/evidence data, payment/provider data, risk and internal notes, request data, credentials, and raw SQL/database errors. Protected internal correlation IDs may be handled only under existing observability controls.

## 12. Tests required before implementation

- only a validated command plus trusted service-role/internal-reviewer context reaches the transaction boundary;
- Lite, Business, and Solo Plus paths each enforce exact profile/source/plan/status matching;
- source/target mismatch, missing profile, duplicate profile/review/case/event, missing evidence, stale evidence/policy/version, and query errors fail closed;
- expected profile row version is enforced and increments exactly once on success;
- Lite/Business review metadata and profile/event writes commit atomically; Solo Plus case binding and profile/event changes commit atomically;
- late profile, review/case, event, uniqueness, RLS, and constraint failures roll back all changes;
- exact replay returns the original result and never duplicates an event or review decision;
- verified, rejected, restricted, and suspended profiles are preserved;
- no limit, entitlement, activation, merchant, workspace, subscription, payment, provider, settlement, verification, invoice, or checkout write occurs;
- no approval result unlocks collection or changes setup/live flags;
- service-role-only grants reject `PUBLIC`, anon, authenticated, browser, and unauthorized contexts;
- diagnostics are allowlisted and redacted;
- no route, action, page, checkout, provider, callback, webhook, or storefront imports the persistence implementation before separate adoption approval.

## 13. Rollout gates

This document does not permit implementation. First, the local disposable PostgreSQL listener/Docker prerequisite must be available and Migration 025 must pass the guarded local-only rehearsal. Only then may a separately approved Migration 025 staging preflight be considered; staging and production remain prohibited as rehearsal substitutes.

Before an approval persistence package is implemented, require approval of the transaction/RPC contract, internal reviewer authorization, exact evidence and Solo Plus case interface, RLS/grant package, preflight/postflight, static scope tests, idempotency/replay tests, rollback proof, disposable rehearsal evidence, and independent source review.

No runtime adoption follows automatically. The activation transition remains a later, independent design and implementation effort. Until it passes all gates, current production behavior remains unchanged: compliance tables can remain empty, `setup_mode` remains `true`, `live_features_enabled` remains `false`, and collection, checkout, payments, and storefront work remain locked.
