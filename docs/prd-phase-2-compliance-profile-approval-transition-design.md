# PRD Phase 2 Compliance Profile Approval Transition Design

Status: source-only design. This document authorizes no SQL, migration, profile row, runtime call site, activation, payment test, collection test, or production behavior change.

## 1. Purpose and boundary

The future approval transition records a reviewed compliance outcome against one existing merchant compliance profile. It moves a pending or attention-required profile to the matching verified, rejected, restricted, or still-attention-required state and records the corresponding review and append-only event audit trail.

Approval is deliberately not activation. A verified compliance profile establishes only that the required evidence and reviewer decision were accepted for that plan. It does not establish a live commercial entitlement, approved limits, risk clearance, payout verification, provider settlement readiness, or live feature approval.

Consequently, this transition must not unlock payment collection, checkout, settlement, Instant Sale, Receivable Sale, Deposit & Balance, or a live storefront. Those outcomes remain a separate future activation transition after every resolver gate passes.

## 2. Canonical source and target states

The approval command may begin only from an existing profile in one of these source states:

| Source profile state | Applicable reviewed outcome |
|---|---|
| `lite_pending` | Solo Lite verification decision |
| `enhanced_pending` | Solo Plus enhanced-verification decision |
| `business_pending` | Business KYB decision |
| `needs_attention` | A resubmitted or corrected decision for the same plan path |

Allowed profile targets are:

| Plan/review path | Verified target | Non-verified targets |
|---|---|---|
| Solo Lite | `lite_verified` | `needs_attention`, `restricted`, `rejected` |
| Solo Plus | `enhanced_verified` | `needs_attention`, `restricted`, `rejected` |
| Business | `business_verified` | `needs_attention`, `restricted`, `rejected` |

`suspended` is not a `compliance_status` value. A suspension is represented by a non-operational `activation_status = suspended` plus `restriction_state = suspended`; the profile compliance status remains the reviewed outcome that explains the profile (normally `restricted`, or a preserved prior state when the restriction transition is separately recorded). A normal approval must never set `restriction_state = active`; an explicit active restriction state is a later activation concern.

Unsupported source/target combinations, plan mismatch, missing profile, duplicate profile, ambiguous review/case, stale row version, or missing evidence must fail closed with a safe result code.

## 3. Reviewer authorization and trusted inputs

Only a trusted, authenticated internal compliance reviewer or designated compliance operator may request approval. The future server boundary must establish reviewer authorization and resolve merchant, workspace, plan, profile, review/case, and evidence references server-side.

The command must require a server-generated approval idempotency key (also called a review decision key), expected profile row version, reviewer identity, reviewed timestamp, policy version, target decision, reason code where applicable, and trusted evidence-state references. Browser merchant/workspace IDs, plan labels, payment metadata, provider payloads, `setup_mode`, `live_features_enabled`, and legacy `verification_status` are not approval authority.

## 4. Evidence requirements by plan

The transition verifies evidence state and reviewer decision, not raw sensitive evidence in diagnostics or browser payloads.

| Path | Required trusted decision source | Minimum reviewed evidence state | Verified target |
|---|---|---|---|
| Solo Lite | Existing `merchant_compliance_reviews` row with `review_type = solo_lite` | Required Lite identity, selfie, payout, and final-review evidence is complete under the applicable policy version; review is explicitly approved | `lite_verified` |
| Solo Plus | Trusted existing Solo Plus case (`solo_plus_case`) | Enhanced-verification evidence and the existing case review are complete and explicitly approved under the applicable policy version | `enhanced_verified` |
| Business | Existing `merchant_compliance_reviews` row with `review_type = business_kyb` | KYB/business evidence and reviewer checks are complete and explicitly approved under the applicable policy version | `business_verified` |

Payment, a subscription, a payout account record, provider mapping, legacy verification value, or a profile setting may inform a reviewed evidence snapshot but can never approve a profile alone. Missing, stale, conflicting, or query-error evidence results in `needs_attention` only when a reviewer explicitly records that outcome; otherwise the command fails closed without changing state.

## 5. Transaction, idempotency, and preservation rules

The eventual service-role-only transaction must lock the profile and exact review/case plus approval-event idempotency key before deciding. A single matching, internally consistent prior decision returns the original identifiers/result as idempotent; it must not create a second review decision or event.

The transaction must preserve an already matching verified profile and preserve any rejected, restricted, or suspended profile unless a separately authorized re-review/restriction transition explicitly permits a change. It must never downgrade a verified profile to a pending state, overwrite a rejected/restricted/suspended outcome with a weaker approval request, or infer that a prior outcome is stale from payment or subscription state.

Duplicate or inconsistent profile, review, case, or event rows are ambiguity failures. The command must roll back rather than select an arbitrary row. Profile update, review/case decision update, and append-only event insertion must commit together or roll back together; no partial success may be returned.

## 6. Allowed future writes

After this design and a separately approved implementation/migration, approval may write only the following, within one transaction:

- `merchant_compliance_profiles`: the canonical `compliance_status`, non-operational review/audit fields such as `decision_source_type`, `decision_source_id`, `decision_source_version`, `last_reviewed_at`, `next_review_due_at`, `reviewed_by`, `policy_version`, `row_version`, and appropriate restriction fields for a reviewed restriction/suspension outcome.
- `merchant_compliance_reviews` for Solo Lite and Business: canonical review status, decision timestamp/actor, policy version, safe reason code, decision notes, and row version.
- The trusted Solo Plus case only through its already-authorized case decision boundary; approval must not fabricate a `merchant_compliance_reviews` row for Solo Plus.
- `merchant_compliance_events`: exactly one append-only, redacted transition event with safe before/after state, actor, source, policy version, idempotency key, and resulting row version.

For every ordinary approval outcome, `activation_status` remains non-operational (`test_mode`, `pre_approved`, `awaiting_review`, or `needs_attention` only if the later approved transition contract explicitly permits it). The initial implementation should preserve `test_mode` to avoid conflating approval with activation. All six merchant entitlement fields remain `false`; no limits or operational counters are created.

## 7. Prohibited writes and non-unlock guarantee

Approval must never:

- create limit windows, reservations, reservation-window rows, usage events, or approved collection limits;
- set any merchant entitlement true, including collection, Instant Sale, Receivable Sale, storefront, settlement activation, or Deposit & Balance;
- create or update payout verification, provider settlement mappings, provider configuration, payment routing, payment records, subscriptions, or invoices;
- update `merchants`, `workspaces`, `subscriptions`, `workspace_subscriptions`, payments, settlement accounts, verification records, or provider tables;
- set `setup_mode = false`, set `live_features_enabled = true`, or otherwise activate collection;
- treat approval as a checkout, payment-link, collection, settlement, or storefront authorization.

The runtime capability resolver must continue to deny live capabilities until the later activation transition presents an active paid commercial entitlement, matching verified compliance state, approved risk/limits, explicit `restriction_state = active`, explicit setup/live readiness, verified payout and exact provider mapping readiness, global flags, and merchant-level entitlements.

## 8. Rejection and restriction behavior

`rejected` records a final non-operational compliance outcome. Its corresponding Lite/Business review is `rejected`; Solo Plus remains linked to its trusted case outcome. Rejected profiles preserve prior evidence references and audit state but receive no entitlement, limit, or activation write.

`restricted` records an explicit reviewed restriction outcome with a machine-readable restriction reason, effective time, reviewer/source, and non-operational activation status. A suspension additionally sets `restriction_state = suspended` and `activation_status = suspended`. Neither restriction nor suspension is an opportunity to create collection-related records, and future re-review must use a separately approved re-lock/restriction transition with an immutable compensating event.

`needs_attention` is appropriate for incomplete, expired, inconsistent, or reviewer-requested corrective evidence. It is not an approval substitute and keeps the profile non-operational.

## 9. Audit and diagnostics

Every state-changing decision requires one append-only event. The event records an allowlisted transition name, safe prior and resulting profile state, trusted reviewer actor type/ID, source type/ID, policy version, expected/resulting row versions, decision idempotency key, and safe reason code. A review/case decision must carry the matching reviewer, decision time, policy version, and safe decision reason.

Diagnostics may return/log only stable codes such as `approval_payload_invalid`, `approval_reviewer_unauthorized`, `approval_profile_missing`, `approval_profile_preserved`, `approval_source_mismatch`, `approval_evidence_incomplete`, `approval_row_version_conflict`, `approval_ambiguous_state`, `approval_idempotent_replay`, and `approval_atomic_write_failed`.

They must never include raw IDs in browser-visible output, BVN/NIN/CAC, selfie or evidence content, bank/account data, provider/payment references or payloads, risk notes, internal decision notes, cookies, headers, tokens, credentials, or raw database errors.

## 10. Tests required before implementation

- each allowed source-to-target plan transition succeeds only with a trusted matching review/case and complete reviewed evidence;
- plan/source/status mismatches, missing evidence, stale profile versions, missing authorization, and query errors fail closed;
- payment, subscription, legacy verification, setup, live-feature, payout, or provider state alone cannot approve a profile;
- replays return the same result and do not duplicate decision events;
- duplicate/ambiguous profile, review, case, or event state fails closed;
- existing verified, rejected, restricted, and suspended profiles are preserved as specified;
- rejection, restriction, suspension, and needs-attention outcomes remain non-operational;
- profile/review-or-case/event writes are atomic, including late failure rollback tests;
- no limit windows, limits, reservations, usage events, entitlement=true fields, activation fields, merchant/workspace, payment, provider, subscription, settlement, or invoice writes occur;
- service-role/internal-reviewer requirements reject browser, anon, authenticated, and unauthorized contexts;
- diagnostics are reason-code-only and redacted;
- no route, action, checkout, provider, callback, webhook, or storefront call site imports the implementation before a separately approved adoption plan.

## 11. Rollout gates

Implementation remains blocked until Migration 025 has passed the required disposable local PostgreSQL rehearsal and any approved staging preflight process. This design does not remove the current Migration 025 staging/production apply block.

Before a future approval implementation may be considered, the team must approve the exact service-role transaction transport, reviewer authorization model, source evidence contracts, preflight/postflight package, static write-scope/grant tests, disposable rollback/idempotency rehearsal, and independent source review. Before any runtime adoption, the separate activation transition must be designed, reviewed, and proven fail-closed.

Current production behavior remains unchanged: no compliance rows are inserted, `setup_mode` stays `true`, `live_features_enabled` stays `false`, verification remains unapproved, and collection, checkout, payment tests, and storefront work remain blocked.
