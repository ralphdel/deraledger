# PRD Phase 2 Collection Limit Engine Persistence Path

Status: design only. This document authorizes no code, SQL, RPC, database write, runtime adoption, provider call, checkout initialization, collection enablement, or payment test.

## 1. Purpose

This path describes how a future service-role executor will persist only already-validated collection-limit commands from `collection-limit-engine-command-core.ts`. Its role is to make approved policy limits, reservations, settlement outcomes, and immutable accounting auditable and atomic. It does not decide whether a merchant may collect, approve compliance, verify a payment, or activate a merchant.

The command contract remains the input boundary. Browser data, provider callbacks/payloads, customer data, and raw invoice/payment metadata cannot be passed to the persistence executor as authority.

## 2. Service-role transaction boundary

The future executor must run exclusively in a trusted internal service-role execution context. It must reject browser, `anon`, `authenticated`, unknown, and ordinary merchant contexts before beginning a transaction.

One transaction must contain every mutable window/reservation/link change and every required immutable usage event. A command succeeds only after commit. Any lookup ambiguity, stale version, check/unique violation, insert/update failure, or late event failure rolls back all writes from that command. No partial result may be reported as successful.

The future database package must preserve the Migration 024 service-only model: RLS enabled, zero browser policies, no PUBLIC/anon/authenticated privilege, and only the least service-role grants required by the four limit tables.

## 3. Persistence scope and schema mapping

Only these Migration 024 tables may be written later:

1. `public.merchant_collection_limit_windows`
2. `public.merchant_collection_limit_reservations`
3. `public.merchant_collection_limit_reservation_windows`
4. `public.merchant_collection_usage_events`

The persisted `window_type` vocabulary is deliberately narrower than the command-limit taxonomy: `cumulative`, `monthly`, `daily_velocity`, and `outstanding_receivable`. `single_transaction`, `velocity_frequency`, `plan_cap`, and `reviewer_risk_override` are reviewed policy constraints evaluated by the command/executor; they are not invented as new window rows without a separately approved schema decision.

Similarly, the current usage-event table allows `collection_committed`, `reservation_released`, `refund_adjustment`, `chargeback_adjustment`, and `manual_correction`. A reservation creation is represented by the reservation and reservation-window-link rows; an expiry is represented by an `expired` reservation plus a `reservation_released` event with safe reason `reservation_expired`. No unsupported event literal may be inserted into Migration 024 tables.

## 4. Limit-window lookup and update rules

Limit approval commands may create or update only reviewed policy-window rows. They must:

- require a validated `prepareLimitApprovalCommand` payload, exact merchant/profile identity, approved policy version, and expected row version;
- resolve exactly one canonical window identity `(merchant_id, window_type, window_key, policy_version)` or fail closed on duplicate/ambiguous state;
- preserve the agreed `Africa/Lagos` policy timezone and UTC half-open boundaries;
- create only `approved` policy state as represented in the future transition model; they must not make a window collection-active;
- lock rows before mutating `committed_amount`, `reserved_amount`, or `row_version`; and
- treat `exhausted`, `expired`, `suspended`, and `revoked` as terminal/re-locking states for new reservations until a separately reviewed policy transition authorizes otherwise.

Window availability is always calculated from locked authoritative columns: `limit_amount - committed_amount - reserved_amount`. Profile counters remain non-authoritative projections and are outside this persistence scope.

## 5. Reservation and link rules

A reservation command must run before any future provider initialization, but provider initialization is outside this executor and outside its transaction.

For a validated reservation command, the executor must atomically:

1. re-load and lock all applicable active window rows in deterministic `(merchant_id, window_type, window_key, id)` order;
2. re-check all policy/risk/plan constraints from trusted command context and reject any exhausted, expired, suspended, revoked, missing, or stale window;
3. ensure the requested positive `numeric(18,2)` NGN amount fits every locked window;
4. insert one `reserved` reservation using the merchant internal reference and idempotency key;
5. insert one positive reservation-window link for each locked window; and
6. increase each window's `reserved_amount` and row version.

The reservation's unique `(merchant_id, internal_reference)` and `(merchant_id, idempotency_key)` identities are part of the replay boundary. No reservation may be created for a client-provided merchant/workspace identity, amount authority, plan authority, or provider metadata.

## 6. Commit, release, expiry, and reversal rules

Commit is allowed only after a separate trusted verification path has established a successful customer payment and has produced a validated commit command. The executor neither verifies providers nor accepts provider metadata as merchant/source identity.

- **Commit:** lock the `reserved` reservation and linked windows; require matching expected versions; transition the reservation to `committed`; move each linked amount from `reserved_amount` to `committed_amount`; append one `collection_committed` debit usage event per window; and bind only already-verified supporting references.
- **Release:** lock the `reserved` reservation and links; transition it to `released`; decrement each linked `reserved_amount`; and append one `reservation_released` event per window with an allowlisted reason.
- **Expiry:** use the same atomic release accounting, persist `expired` reservation status, and use `reservation_expired` only as the safe reason code for the schema-supported `reservation_released` event.
- **Reversal:** lock the `committed` reservation and affected windows; transition to `reversed`; apply only the reviewed accounting adjustment; and append one immutable `refund_adjustment`, `chargeback_adjustment`, or `manual_correction` credit event per window. Nothing is deleted or overwritten.

No future transition may infer success from a provider redirect, browser state, or a payment record alone. It must be preceded by a trusted verified-payment result that has already cross-checked the reservation's merchant, internal reference, amount, currency, and source.

## 7. Idempotency, concurrency, and replay

Each command requires a server-generated idempotency key. Replay is successful only when its stored command family, merchant/workspace, profile, amount, currency, internal reference, source, policy version, reservation status, links, and resulting usage events are exactly internally consistent.

A reused key with any mismatch fails closed. Duplicate/ambiguous profiles, windows, reservations, links, or usage events fail closed. Mutable window and reservation writes require expected row versions and row locks; version mismatch fails closed rather than retrying blindly. Usage events are append-only and use their existing per-merchant/window idempotency uniqueness. Corrections are compensating events.

## 8. Explicit non-activation boundary

Limit persistence is separate from compliance approval and from activation. It must not:

- create or approve a compliance profile;
- set `setup_mode = false` or `live_features_enabled = true`;
- set any collection or settlement entitlement true;
- create payout or provider-mapping readiness;
- activate settlement, checkout, storefront, Instant Sale, receivables, or Deposit & Balance; or
- alter the existing authoritative gates.

The later collection-activation transition still needs verified compliance, active paid entitlement, risk decision, approved/active limits, payout readiness, exact settlement mapping, global flags, merchant entitlements, and explicit setup/live readiness. Limit persistence alone supplies none of these outcomes.

## 9. Prohibited writes and no-provider guarantee

The executor must never write `merchants`, `workspaces`, `subscriptions`, `workspace_subscriptions`, payment records, subscription payments, provider configuration/mappings, settlement accounts, invoices, invoice items, checkout objects, compliance profiles/reviews/events, or feature-flag storage. It must never call a payment provider, initialize checkout, send a payment request, process a webhook/callback, or change a route response.

Provider initialization, provider verification, payment activation, and invoice collection are separate future integrations. A caller may invoke a provider only after a committed reservation transaction, and the provider path must independently release the reservation if initialization fails.

## 10. Safe diagnostics

Diagnostics may contain only correlation ID, hashed identifiers, command family, plan class, policy-version class, lifecycle/status class, timing bucket, and allowlisted reason codes (for example `limit_window_missing`, `limit_exhausted`, `reservation_replay_conflict`, `row_version_stale`, `verified_payment_missing`). They must not contain raw IDs, customer data, evidence, bank data, provider references/payloads, payment credentials, headers, tokens, cookies, risk notes, or secrets.

## 11. Tests required before implementation

- pure persistence-contract tests for all five command families;
- transactional success and late-failure rollback tests for each write sequence;
- deterministic multi-window lock order and concurrent over-reservation tests;
- row-version stale, duplicate, ambiguous, and replay-conflict tests;
- exhausted/expired/suspended/revoked reservation-denial tests;
- exact commit/release/expiry/reversal accounting and immutable usage-event tests;
- schema-vocabulary tests proving no unsupported window/event values are written;
- service-role-only, RLS, zero-browser-policy, and hostile-grant tests;
- static prohibited-write and no-provider/no-checkout-call tests;
- disposable local PostgreSQL rehearsal for all transitions, replays, and rollbacks; and
- static tests proving no route/action/provider/webhook/callback imports the executor before explicit runtime adoption approval.

## 12. Rollout gates

1. Migration 025's local behavior/rollback rehearsal must complete; staging and production application remain blocked today.
2. The collection-limit persistence package requires a separate source review, database security review, and disposable-local rehearsal.
3. Staging preflight may occur only after local rehearsal passes; staging is not a rehearsal substitute.
4. Shadow-only observation, without customer-visible or provider side effects, must be independently approved before any route adoption.
5. Activation requires its own design, implementation, rehearsal, and approval after the limit path is proven.

Until then, no limit rows need exist, collection stays locked, and payment/provider behavior remains unchanged.
