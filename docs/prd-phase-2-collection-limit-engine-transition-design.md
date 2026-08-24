# PRD Phase 2 Collection Limit Engine Transition Design

Status: design only. This document authorizes no migration, RPC, runtime adoption, payment test, collection enablement, or database write.

## 1. Purpose and safety boundary

The collection limit engine is the operational accounting control that prevents a merchant from creating or collecting beyond explicitly reviewed limits. It is required before any collection activation because a verified profile, paid plan, or settlement mapping alone does not provide an enforceable amount or velocity boundary.

It is not a compliance approval engine, payment provider integration, checkout initializer, or activation mechanism. It will remain a separate later transition from compliance approval and from collection activation.

## 2. Existing Phase 2 substrate

Migration 024 already provides these empty, service-only tables:

- `public.merchant_collection_limit_windows`
- `public.merchant_collection_limit_reservations`
- `public.merchant_collection_limit_reservation_windows`
- `public.merchant_collection_usage_events`

The profile's `cumulative_collection_used` is a reconciliation/display projection only. Locked limit-window rows are the authorization authority; immutable usage events are the accounting authority. All money is NGN `numeric(18,2)`. Window instants are UTC, with policy boundaries evaluated in `Africa/Lagos` using half-open `[start, end)` intervals.

## 3. Required inputs and admission rule

Before a future limit command may create or change a limit state, its server-side trusted loader must establish all of the following:

- exactly one verified compliance profile for the merchant;
- one active paid commercial entitlement and normalized paid plan;
- trusted plan code and applicable product capability;
- reviewed risk tier and a reviewer/risk decision source;
- approved policy version and reviewer/actor identity;
- explicit payout verification and exact provider/environment settlement-mapping readiness references;
- explicit feature-flag and merchant-entitlement inputs; and
- trusted merchant/workspace identity and unambiguous source object identity.

Missing, stale, conflicting, ambiguous, or query-error data denies the operation. Payment evidence may support a later collection commit, but cannot supply compliance, risk, limit, payout, provider-mapping, entitlement, or activation approval.

## 4. Limit types and lifecycle

Each approved policy may create the applicable combination of:

- **Single transaction limit:** maximum gross NGN amount for one collection attempt.
- **Daily cumulative/velocity limit:** total gross collection amount in the current Lagos policy day; frequency/attempt count must be enforced from a reviewed policy rule alongside this amount control.
- **Monthly cumulative limit:** total gross collection amount in the current Lagos policy month.
- **Plan-level cap:** product ceiling that constrains, but never replaces, a reviewed merchant limit.
- **Reviewer/risk override cap:** a lower or otherwise more restrictive reviewed cap. The effective limit is the most restrictive applicable cap.
- **Cumulative and outstanding-receivable caps:** policy windows that constrain lifetime collection and, where approved later, receivable exposure.

The lifecycle for a limit window is:

`proposed -> approved -> active -> exhausted | expired | suspended | revoked`

Only an explicitly reviewed, versioned policy may move `proposed` to `approved`. `approved` becomes `active` only through a later activation transition that independently passes all collection gates. `exhausted`, `expired`, `suspended`, and `revoked` deny new reservations. A restriction, risk downgrade, policy expiry, or conflicting state must re-lock new reservations without rewriting historical usage.

## 5. Reservation lifecycle and atomic rules

Reservation lifecycle:

`pending -> committed | released | expired | reversed`

The existing database status vocabulary uses `reserved` for the persisted pending state; a future command contract may call it `pending` externally but must persist the canonical `reserved` value. A reservation is not a collection authorization by itself.

Before any future provider/payment initialization, an atomic reservation transition must:

1. validate the trusted merchant, profile, entitlement, compliance, risk, activation, flag, payout, and exact provider-mapping inputs;
2. reject any request that has not independently passed the future collection-activation gate;
3. lock every applicable active window in a deterministic order;
4. compute availability as `limit_amount - committed_amount - reserved_amount` for each window;
5. require the requested gross NGN amount to pass every applicable single-transaction, daily, monthly, cumulative, plan, reviewer/risk, and frequency rule;
6. create one idempotent reservation plus one link row per affected window; and
7. increase only `reserved_amount` and associated row versions in the same transaction.

No provider call or checkout initialization may occur until the reservation transaction commits. If provider initialization later fails, the reservation must be released through a separate idempotent transition. A caller must never treat a failed or partially persisted reservation as successful.

## 6. Commit, release, reversal, and usage-event rules

After a provider-independent verification path establishes a successful customer payment, a commit command must atomically:

- re-load and lock the reservation and affected windows;
- bind the verified internal and provider references without trusting browser/provider metadata as identity authority;
- transition only a currently valid `reserved` reservation to `committed`;
- decrease each affected window's `reserved_amount` and increase its `committed_amount` by the linked amount;
- append immutable `collection_committed` debit usage events for every affected window; and
- update the profile's cumulative-used value only as a non-authoritative reconciliation projection, if and when that write is separately approved.

Failed, abandoned, rejected, or expired attempts must release the reservation atomically: mark it `released` or `expired`, decrement affected `reserved_amount`s, and append `reservation_released` accounting events where policy requires. A refund or chargeback never deletes history: it transitions the reservation to `reversed` where applicable, adjusts locked window accounting through a reviewed command, and appends `refund_adjustment` or `chargeback_adjustment` credit events. Manual corrections require a trusted reviewer/reconciliation actor, safe reason code, policy version, and an immutable compensating event.

## 7. Idempotency and concurrency

Every reserve, commit, release, expiry, reversal, and manual-correction command requires a server-generated idempotency key and expected row versions where a mutable row is changed.

- Replays may return success only when the stored reservation, window links, references, source identity, resulting status, and usage-event linkage are internally consistent with the same command.
- A reused key with different merchant, source, amount, currency, provider reference, policy version, or transition intent fails closed.
- Multiple or ambiguous reservation, profile, window, event, review, or source rows fail closed.
- Locks plus optimistic row-version checks prevent concurrent over-reservation.
- Usage events are append-only. Corrections are compensating events, never edits/deletes.

## 8. Separation from approval and activation

Limit approval may create or update only reviewed policy/window state. It does not verify compliance, create a compliance profile, approve a compliance profile, activate settlement, or enable merchant entitlements.

Collection activation remains a later, explicit transition. It must require all independently verified conditions: active paid entitlement, verified compliance, reviewed risk state, active non-exhausted limits, payout verification, exact provider/environment settlement mapping, global flags, merchant entitlements, and explicit `setup_mode = false` plus `live_features_enabled = true`. The limit engine must never set either merchant field or any entitlement to make those conditions true.

## 9. Future write boundary

Allowed later writes are limited to the four limit-engine tables listed above, and only through reviewed, service-role-only transactional commands:

- create/update locked limit windows and their row versions;
- create/transition reservations and their row versions;
- create reservation-window links; and
- append immutable usage events.

The engine must never write `merchants`, `workspaces`, subscriptions, payment records, provider configuration/mappings, settlement accounts, invoices, checkout objects, profile approval fields, or compliance review decisions. It must not call providers, initialize checkout, create limit windows during approval, set `setup_mode = false`, set `live_features_enabled = true`, or set `can_collect_payments`/other collection entitlements true.

## 10. Safe diagnostics

Diagnostics may include correlation ID, hashed merchant/workspace/source identifiers, policy-version class, plan class, transition class, timing bucket, and allowlisted reason codes such as `missing_profile`, `inactive_entitlement`, `limit_window_missing`, `limit_exhausted`, `reservation_replay_conflict`, `row_version_stale`, and `provider_verification_missing`.

They must never include raw merchant/customer IDs, evidence, bank data, BVN/NIN/CAC, provider payloads/references, payment credentials, request headers, risk notes, cookies, or secrets.

## 11. Required tests before implementation

- unit contracts for all lifecycle states and fail-closed inputs;
- effective-cap calculation tests for each combination of plan/reviewer/risk limits;
- deterministic multi-window locking and concurrent over-reservation tests;
- reservation-before-provider ordering test with no provider call in the engine;
- idempotent reserve/commit/release/reversal/replay tests;
- mismatched amount, currency, merchant, source, reference, policy-version, and idempotency-key rejection tests;
- exhausted/expired/suspended/revoked window denial tests;
- usage-event append-only and compensating-adjustment tests;
- rollback tests for every profile/window/reservation/link/event late failure;
- prohibited-write static tests and service-role/RLS/grant tests;
- disposable local PostgreSQL rehearsal before staging consideration; and
- static tests proving no runtime route, checkout, provider, webhook, callback, or Record Invoice call site imports the engine before explicit adoption approval.

## 12. Rollout gates

1. Migration 025 behavior/rollback rehearsal must first complete locally; its staging/production apply remains blocked today.
2. The limit-engine command/RPC package requires separate source review, static tests, and disposable local database rehearsal.
3. Staging preflight is considered only after the local rehearsal passes; staging is never a substitute for rehearsal.
4. Independent security review must confirm service-role-only base-table access, zero browser policies, transaction rollback, and forbidden-write boundaries.
5. Shadow observation must show safe diagnostics and no customer-visible or provider side effects.
6. A separate activation design, implementation, rehearsal, and approval must pass before any collection entitlement, setup/live state, checkout, or provider behavior changes.

Until every gate passes, compliance profiles may remain empty, collection remains locked, and payment/provider behavior remains unchanged.
