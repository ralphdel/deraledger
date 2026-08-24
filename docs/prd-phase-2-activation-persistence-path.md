# PRD Phase 2 Activation Persistence Path

Status: design only. This document does not authorize implementation, SQL, database access, runtime adoption, provider calls, checkout, payment testing, or any production-state change.

## 1. Purpose and Required Input

The future activation persistence path converts a previously validated activation, re-lock, or emergency-suspension command into one atomic service-role operation. It is the final transition boundary; it is not a substitute for commercial entitlement, compliance approval, risk review, limit approval, payout verification, provider mapping verification, or runtime capability resolution.

The only permitted input is a validated, server-generated command from `activation-transition-command-core.ts`. Browser values, session metadata, payment metadata, provider payloads, subscription projections, and route parameters cannot supply authority.

## 2. Execution and Transaction Boundary

Execution must be service-role/internal-operator only. The transport must reject anon, authenticated, browser, and unknown contexts before any query. One transaction must lock the profile, merchant/workspace operational state, and every applicable limit window; re-read canonical prerequisites; conditionally persist the target; append an immutable audit event; and either commit all writes or roll back all writes.

No partial success may be returned. Query errors, stale expected versions, missing rows, duplicates, ambiguous rows, conflicts, or failed writes produce only safe fail-closed result codes.

## 3. Canonical Prerequisite Re-read Rules

Inside the transaction, the future executor must re-read and validate:

- one active paid entitlement, with matching normalized merchant/workspace/subscription/workspace-subscription plan projections;
- exactly one verified profile matching that paid plan;
- current reviewed risk state and `restriction_state = active`;
- all required approved, active limit windows, locked against concurrent state change, with no exhausted/expired/suspended/revoked blocker;
- explicit verified payout readiness;
- exact selected provider and environment settlement-mapping readiness;
- explicitly enabled global collection flag;
- explicitly approved merchant collection entitlement;
- merchant/workspace agreement and explicit setup/live readiness approval; and
- command policy version, operator authorization, idempotency key, and every expected row version.

No field may be inferred from payment, subscription purchase, profile save, legacy verification status, payout account presence, or provider configuration alone.

## 4. Activation Target Rules

Only after every re-read passes may a later transaction update the reviewed profile activation/restriction/entitlement fields, merchant/workspace `setup_mode`, merchant/workspace `live_features_enabled`, and append a compliance event.

The product target is `activation_status = active`, `setup_mode = false`, `live_features_enabled = true`, and only the specifically reviewed collection entitlement(s) true. Starter remains ineligible; Solo Lite never receives receivable/deposit entitlements; Solo Plus and Business retain their independently approved plan boundaries.

### Schema mismatch block

Migration 024 currently does not allow `merchant_compliance_profiles.activation_status = active`. The activation command marks this explicitly. Persistence must reject activation as schema-incompatible until a separate design, additive migration, disposable rehearsal, and postflight resolve that allowlist. It must never substitute `approved`, skip the profile update, or weaken a check to work around the mismatch.

## 5. Audit and Idempotency

The path appends one redacted `merchant_compliance_events` event for each successful activation, re-lock, or suspension. Events include only safe reason codes, trusted actor snapshot, policy version, command idempotency key, expected/resulting versions, and safe before/after snapshots.

An idempotency replay returns an existing result only when command family, merchant/workspace, source references, target, reason, profile/operational versions, and event linkage exactly agree. A reused key with any difference fails closed. Events are append-only; corrections use compensating events.

## 6. Re-lock and Emergency Suspension

Re-lock applies when entitlement, compliance, risk, limits, payout, provider mapping, global flag, merchant entitlement, or operational state is lost, stale, ambiguous, or conflicting. In one transaction it disables the affected collection capability, sets non-operational setup/live state, records a restricted outcome, and appends an event.

Emergency suspension is an expedited, internally authorized non-operational transition. It atomically sets `restriction_state = suspended`, an allowed non-operational activation state, disables live features and the collection entitlement, and appends a safe event. Neither path deletes or alters evidence, reviews, limits, reservations, payment history, or provider records.

## 7. Allowed and Prohibited Future Writes

Allowed later, subject to separately approved schema/RPC design: reviewed compliance-profile activation/restriction/entitlement fields; merchant/workspace setup/live flags; and append-only compliance events.

Prohibited: compliance approval; bootstrap or approval-row creation; limit creation/approval; payout or provider verification; payment-provider calls; checkout initialization; payment-record creation; subscription changes; invoice changes; settlement/provider configuration changes; and payment tests.

## 8. Runtime Resolver Relationship

Activation supplies persisted, reviewed inputs only. `resolveMerchantCapabilities` remains authoritative and fail-closed: it must still observe entitlement, compliance, risk, restriction, setup/live agreement, flags, merchant entitlements, settlement readiness, and approved limits before permitting live collection. Existing runtime gates remain authoritative until a separately reviewed adoption plan is approved; shadow observation must not alter customer-visible behavior or side effects.

## 9. Safe Diagnostics

Diagnostics use allowlisted codes such as `activation_prerequisite_missing`, `activation_prerequisite_conflicting`, `activation_row_version_stale`, `activation_schema_incompatible`, `activation_replay_conflict`, and `activation_atomic_failure`. They must never expose raw identities, risk notes, evidence, bank data, provider references/payloads, customer data, credentials, headers, or tokens.

## 10. Tests Required Before Implementation

- service-role/internal-operator authorization and no browser authority;
- each canonical prerequisite re-read, stale/conflict/ambiguity/query-error failure, and plan/profile mismatch;
- lock/version concurrency coverage for profile, merchant/workspace, and limit windows;
- schema-incompatibility denial for `activation_status = active` before its separate migration;
- atomic activation, re-lock, and suspension rollback proof for every late failure;
- strict idempotent replay and reused-key mismatch rejection;
- append-only audit event and safe diagnostic assertions;
- explicit forbidden-write/provider/checkout/payment-record tests; and
- disposable local SQL rehearsal, hostile grants/RLS checks, rollback proof, independent source review, then staging preflight only after all local gates pass.

## 11. Rollout Gates

1. Complete Migration 025 local behavior/rollback rehearsal; staging and production are not rehearsal environments.
2. Complete reviewed bootstrap, approval, and limit persistence/RPC design plus disposable rehearsal.
3. Resolve the `activation_status = active` schema decision with a separately reviewed additive migration and rehearsal.
4. Design, implement, independently review, and locally rehearse the activation RPC/transport.
5. Perform staging preflight only after local PASS, then seek separate approval for each apply/runtime-adoption phase.

Until those gates are complete, production remains `setup_mode = true`, `live_features_enabled = false`, and collection locked.
