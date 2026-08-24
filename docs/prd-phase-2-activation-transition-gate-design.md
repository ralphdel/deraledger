# PRD Phase 2 Activation Transition Gate Design

Status: design only. This document does not authorize SQL, runtime adoption, collection activation, provider calls, or any production-state change.

## 1. Purpose

The activation transition is the final, separately reviewed operation that may later move a merchant from safe setup/test mode to live collection readiness. It is the point at which the independently reviewed compliance, commercial, risk, limit, payout, provider-mapping, entitlement, and rollout decisions are evaluated together.

Until a separately implemented and rehearsed activation path succeeds, production remains fail-closed with `setup_mode = true` and `live_features_enabled = false`.

## 2. Why Activation Is Separate

None of these is activation:

- a paid subscription proves commercial entitlement only;
- bootstrap creates a draft or pending compliance record only;
- compliance approval verifies the applicable Lite, Enhanced, or KYB evidence only;
- limit approval creates reviewed limit authority only;
- payout readiness verifies payout-account state only; and
- provider settlement readiness proves an exact configured provider/environment mapping only.

Separating these transitions prevents payment, profile data, evidence submission, a limit row, or a provider configuration from accidentally granting collection access.

## 3. Required Activation Prerequisites

A future service-role activation command must require all of the following, each loaded from its canonical trusted source. Missing, stale, conflicting, ambiguous, or query-error data denies activation.

| Prerequisite | Required state |
|---|---|
| Commercial entitlement | A single trusted `active_paid` entitlement for a recognized paid plan; its plan must agree across merchant, workspace, subscription, and workspace-subscription sources. |
| Compliance profile | Exactly one profile whose verified status matches the plan: `lite_verified`, `enhanced_verified`, or `business_verified`. |
| Risk | Explicit, current reviewed risk state of `low` or `medium`; no restriction-risk state. |
| Limits | Reviewed active limit windows for the applicable policy, with no exhausted, expired, suspended, or revoked blocking window. |
| Payout | Explicit verified payout-account readiness. |
| Settlement mapping | Exact provider and environment mapping readiness; a payout account alone is insufficient. |
| Global flag | The applicable global collection rollout flag is explicitly true. |
| Merchant entitlement | `can_collect_payments` is explicitly approved; any related capability entitlement remains false unless independently approved. |
| Restrictions | `restriction_state = active`; restricted, suspended, or missing state denies. |
| Operational readiness | Merchant and workspace agree, and an explicit reviewed activation decision authorizes the change from setup/test to live. |

Plan limits remain intact: Starter never activates collection; Solo Lite never gains receivable sale or deposit/balance capability; Solo Plus and Business require their respective verified profile plus all shared gates.

## 4. Target State

Only after every prerequisite passes in one atomic operation may the future activation path set:

- profile `activation_status = active` (this requires the profile schema/status contract to be extended or reconciled first, because Migration 024 currently allows `approved` but not `active`);
- merchant and workspace `setup_mode = false`;
- merchant and workspace `live_features_enabled = true`; and
- only the specifically approved merchant collection capability entitlement(s) to `true`.

The `activation_status = active` wording is the product target. Before implementation, the persistence decision record and any migration must resolve the current Migration 024 allowlist mismatch explicitly; no code may silently substitute or bypass it.

## 5. Future Transaction and Authorization Contract

The future activation executor must be service-role/internal-operator only, accept a validated server-generated idempotency key, trusted reviewer/operator identity, expected profile and limit-window versions, policy version, and safe source references.

It must lock the profile and applicable active windows, re-read every prerequisite inside the same transaction, conditionally update only approved activation fields, append an immutable compliance event, and return a safe result code. A replay may return the existing result only when the idempotency key, profile version, source references, target state, and resulting event are internally consistent. Any mismatch fails closed.

## 6. Audit, Re-lock, and Emergency Suspension

Every attempted activation, successful activation, re-lock, and emergency suspension requires an append-only, redacted audit event with actor type/id, safe reason code, policy version, expected/resulting versions, and safe before/after state snapshots.

Re-lock is mandatory when entitlement expires/cancels/conflicts, compliance is rejected or restricted, risk changes adversely, limits are exhausted/suspended/revoked, payout or exact provider mapping is lost, flags are disabled, or state becomes stale/ambiguous. Re-lock must disable the affected live capability before any later reconciliation.

Emergency suspension may set only an explicit non-operational restriction/suspension state and disable live features/capability entitlement atomically. It must never delete evidence, limits, reservations, payment history, or audit events.

## 7. Allowed and Prohibited Future Writes

An activation transaction may later update only the reviewed compliance profile activation/restriction/entitlement fields, the corresponding merchant/workspace operational flags, and append-only compliance events. Any schema expansion must be separately designed, reviewed, migrated, and rehearsed.

It must never approve compliance, create bootstrap rows or approval decisions, create/review limits, verify payout or provider mapping itself, call providers, initialize checkout, create payment records, alter subscription entitlement, mutate invoices, mutate provider settings, or run payment tests.

## 8. Runtime Resolver Relationship

`resolveMerchantCapabilities` remains the fail-closed runtime decision layer. The activation transition is not a replacement for it: activation supplies reviewed, authoritative inputs; the resolver still requires the commercial entitlement, matching compliance state, risk, restriction state, setup/live state, global flags, merchant entitlements, settlement readiness, and approved collection limit to permit a live capability.

Existing route gates remain authoritative until a separately reviewed runtime-adoption plan is approved. Shadow observation may compare the resolver output, but must not change a response, redirect, checkout, or provider call.

## 9. Tests Required Before Implementation

- all required inputs present yields only a prepared activation command, never a direct browser-triggered update;
- every missing/stale/conflicting/ambiguous/query-error prerequisite fails closed;
- plan/profile mismatch, expired entitlement, restricted/suspended state, disabled global flag, disabled merchant entitlement, absent payout mapping, and blocking limit state deny;
- idempotent replay is safe and mismatched replay fails;
- atomic rollback leaves no partial operational or entitlement change;
- re-lock and emergency suspension disable access atomically and append audit events;
- no provider, checkout, payment-record, invoice, subscription, or limit-creation call is represented;
- resolver remains fail-closed after activation inputs become stale or disagree; and
- disposable local SQL rehearsal, hostile-grant checks, rollback checks, and independent review pass before staging preflight.

## 10. Rollout Gates

Before any activation SQL, DB, or runtime adoption:

1. Complete Migration 025 local behavior/rollback rehearsal; do not use staging or production as rehearsal.
2. Complete reviewed bootstrap and approval persistence paths, each with disposable rehearsal and independent review.
3. Complete the limit-engine SQL/RPC package and disposable rehearsal.
4. Resolve the `activation_status = active` schema-contract mismatch through a separately reviewed additive change, if still required.
5. Design, implement, and independently review the activation SQL/RPC package and local rehearsal harness.
6. Run staging preflight only after all local rehearsals pass, then obtain explicit production approval.
7. Create a separate runtime adoption/shadow plan; no provider or collection behavior may change as part of an initial activation deployment.

## Safe Next Step

Keep activation design-only. Finish the blocked local Migration 025 behavior/rollback rehearsal, then continue with separate reviewed SQL/RPC design and disposable rehearsal for bootstrap, approval, limits, and activation before considering any runtime or collection change.
