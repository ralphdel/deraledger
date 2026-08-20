# PRD Phase 2 Persistence and Transition Contract

Status: source-only design; not approved for migration or runtime wiring

PRD phase: Phase 2 — Compliance and Limit Engine

Production safety checkpoint: the current Solo Lite merchant remains in paid setup with `setup_mode = true`, `live_features_enabled = false`, `verification_status = unverified`, and customer collection locked. This document does not change that state and does not authorize another payment or collection test.

## 1. Purpose and source order

This contract defines the proposed persistence and state transitions behind the existing pure `resolveMerchantCapabilities` contract. It follows:

1. `docs/deraledger-smart-storefront-prd.md`
2. `docs/phase-alignment-and-roadmap-rebaseline.md`
3. `docs/prd-phase-2-runtime-gate-audit.md`
4. `docs/prd-phase-2-compliance-source-ownership.md`
5. `src/lib/compliance/merchant-capabilities.ts`
6. `src/lib/compliance/runtime-capability-context.ts`

The model keeps five concerns separate:

- commercial entitlement;
- compliance and risk decisions;
- collection limits and usage;
- operational activation locks;
- payout/provider settlement readiness.

No one concern may stand in for another. In particular, payment is not compliance approval and a verified payout account is not a verified provider settlement mapping.

## 2. Design invariants

- One current compliance profile exists per merchant. No profile means no live capability.
- `merchant_id` is resolved through the trusted authenticated owner/team workspace path. No browser identifier, payment metadata, or provider metadata owns identity.
- Commercial entitlement continues to come from the subscription domain. The compliance profile holds only a normalized plan snapshot that must agree with the trusted active entitlement before activation.
- Missing, ambiguous, stale, conflicting, or query-error state remains missing and denies live access.
- Record Invoice remains offline bookkeeping and is not a compliance activation event.
- Starter never receives a positive collection limit or live entitlement.
- Solo Lite never receives Receivable Sale or Deposit & Balance.
- Solo Plus payment alone never changes the active Solo Lite entitlement or live capability.
- Business is not unlimited by plan name; it needs an explicit approved volume/limit.
- Stored monetary policy amounts use NGN major units with fixed decimal precision. Provider kobo values are converted and checked only at payment boundaries.
- The platform uses UTC timestamps. Any daily/monthly policy window must store its policy time zone explicitly; the initial Nigerian policy should use `Africa/Lagos` rather than server-local time.
- Super-admin, sandbox, demo, or environment bypasses are never stored as merchant capability state.

## 3. Proposed tables

### 3.1 `merchant_compliance_profiles` — required current projection

This is the single current-state row consumed by the trusted capability loader. It is not an evidence store, payment ledger, or provider-readiness cache.

| Field | Logical type / values | Null/default contract | Purpose |
|---|---|---|---|
| `id` | UUID | Required, generated | Stable profile identity. |
| `merchant_id` | UUID, unique FK to `merchants.id` | Required; no duplicate profile | One current profile per merchant. Workspace is resolved through the trusted merchant/workspace relationship and is not duplicated here. |
| `plan_code` | Text: `starter`, `solo_lite`, `solo_plus`, `business` | Required when a profile is intentionally created; no inferred legacy alias | Normalized snapshot for decision consistency. It does not supersede subscription entitlement. |
| `business_type` | Text using PRD values | Nullable; no guessed default | Reviewed classification: `unregistered_individual`, `sole_proprietor`, `registered_business_name`, `limited_liability_company`, `incorporated_trustee`, or `other_entity`. |
| `compliance_status` | Text using section 5 | Safe initial value `draft` for explicitly created rows | Current reviewed compliance state. Absence of a row remains missing, not `draft` by inference. |
| `activation_status` | Text using section 6 | Safe initial value `test_mode` for explicitly created rows | Compliance activation decision, separate from `setup_mode` and live flags. |
| `risk_rating` | Text using section 7 | Nullable; no permissive default | Current reviewed risk result. Missing denies live access. |
| `restriction_state` | Text: `active`, `restricted`, `suspended` | Nullable; no default to `active` | Explicit account restriction state. Any restrictive value overrides all allows. |
| `restriction_reason_code` | Text | Nullable | Machine-readable reason without sensitive evidence. |
| `restriction_notes` | Text | Nullable, service/admin-only | Minimal reviewed explanation; sensitive provider payloads remain in their evidence stores. |
| `restriction_effective_at` | Timestamp with time zone | Nullable | Start of the current restriction. |
| `restriction_review_due_at` | Timestamp with time zone | Nullable | Required follow-up where policy calls for it. |
| `collection_limit_basis` | Text: `none`, `cumulative`, `monthly`, `approved_volume` | Nullable until explicitly approved | Selects the public limit profile passed to the resolver. Starter uses `none`; a missing paid-plan basis denies collection. |
| `approved_monthly_volume_ngn` | Fixed decimal NGN | Nullable, non-negative | Reviewed expected/approved volume, especially for Solo Plus and Business. It is not automatically the enforced limit unless the basis says so. |
| `cumulative_collection_cap_ngn` | Fixed decimal NGN | Nullable, non-negative | Reviewed cumulative cap, principally Solo Lite. Recommended PRD figures remain proposals until approved. |
| `cumulative_collection_used_ngn` | Fixed decimal NGN | Nullable until ledger reconciliation; non-negative | Transactionally maintained projection of committed customer collection usage. It is not the sole audit source. |
| `hidden_daily_velocity_limit_ngn` | Fixed decimal NGN | Nullable, positive when approved | Internal risk control; never exposed as a public plan promise. |
| `single_transaction_limit_ngn` | Fixed decimal NGN | Nullable, positive when approved | Maximum permitted gross customer collection per attempt. |
| `outstanding_receivable_cap_ngn` | Fixed decimal NGN | Nullable, non-negative | PRD receivable exposure control. Required before receivable capabilities; unused for Solo Lite. |
| `collection_limit_approved` | Boolean | Safe default `false` | Prevents a numeric value from being mistaken for approval. |
| `limits_approved_at` | Timestamp with time zone | Nullable | Approval timestamp. |
| `limits_approved_by` | UUID/reference to trusted admin actor | Nullable | Approval provenance. |
| `can_collect_payments` | Boolean | Safe default `false` | Merchant-specific collection entitlement; still subject to every resolver and provider gate. |
| `can_use_instant_sale` | Boolean | Safe default `false` | Merchant-level entitlement, combined with global rollout flag. |
| `can_use_receivable_sale` | Boolean | Safe default `false` | Must remain false for Starter/Solo Lite. |
| `can_use_storefront` | Boolean | Safe default `false` | Live storefront entitlement, not preview entitlement. |
| `can_activate_settlement` | Boolean | Safe default `false` | Permission to attempt settlement activation; does not prove payout or mapping readiness. |
| `can_use_deposit_balance` | Boolean | Safe default `false` | Explicit receivable/deposit entitlement; must be consistent with `can_use_receivable_sale`. |
| `policy_version` | Text | Required for reviewed/approved decisions | Identifies the policy used to reach the current state. |
| `decision_source_type` | Text | Nullable while `draft`; required for reviewed transitions | Examples: Lite review, Solo Plus case, Business KYB review, restriction review, reconciliation. |
| `decision_source_id` | UUID/text reference | Nullable while `draft`; required where a source row exists | Links the projection to canonical evidence/case/review state. |
| `last_reviewed_at` | Timestamp with time zone | Nullable | Most recent compliance review. |
| `next_review_due_at` | Timestamp with time zone | Nullable | Scheduled re-review. |
| `reviewed_by` | UUID/reference to trusted admin actor | Nullable for system-created `draft`; required for manual approval | Decision actor. |
| `row_version` | Positive integer | Required, incremented on every transition | Optimistic concurrency guard for atomic transitions. |
| `created_at`, `updated_at` | Timestamp with time zone | Required | Lifecycle timestamps. |

The profile deliberately does **not** duplicate:

- subscription/payment rows;
- `setup_mode` or `live_features_enabled` from merchant/workspace;
- verification-provider evidence or raw responses;
- payout account status;
- provider/environment settlement mappings;
- per-attempt collection reservations.

Those sources must be loaded and cross-checked at decision time.

### 3.2 `merchant_compliance_events` — required append-only history

The generic `audit_logs` table can continue serving broad product audit needs, but it is not sufficient as the only compliance transition ledger. A structured, append-only history is required with:

- event ID, merchant/profile ID, and event type;
- before and after compliance, activation, risk, restriction, limit, and entitlement snapshots;
- reason code and minimal reviewed notes;
- actor type/ID;
- source type/ID and evidence references;
- policy version;
- request idempotency key;
- expected/resulting row version;
- timestamp and safe metadata.

Events cannot be updated or deleted by ordinary application roles. Corrections are new compensating events.

### 3.3 `merchant_collection_limit_windows` — required atomic counters

One row per merchant and policy window provides transactionally locked totals:

- merchant/profile ID;
- basis and policy version;
- window key, start, end, and policy time zone;
- committed gross collection amount in NGN;
- currently reserved amount in NGN;
- version and timestamps;
- unique merchant/basis/window identity.

For a cumulative Solo Lite cap, the window key represents the approved cumulative policy epoch. For monthly/approved-volume limits, it represents the policy month. Daily velocity uses a separate daily window under the same mechanism.

### 3.4 `merchant_collection_limit_reservations` — required concurrency control

Every online customer collection attempt must reserve capacity before provider initialization. The row records:

- merchant/profile and limit-window IDs;
- trusted invoice/order/receivable and internal payment reference;
- idempotency key;
- gross amount in NGN;
- status: `reserved`, `committed`, `released`, `expired`, or `reversed`;
- reservation and expiry timestamps;
- committed/released timestamp and reason;
- provider reference only as supporting evidence after one exists;
- timestamps and version.

A unique merchant/internal-reference or idempotency constraint must prevent duplicate reservations and commits.

### 3.5 `merchant_collection_usage_events` — required immutable accounting trail

This ledger records `collection_committed`, `refund_adjustment`, `chargeback_adjustment`, `reservation_released`, and tightly controlled `manual_correction` events. It stores non-negative amount plus direction, source payment/reference, idempotency key, actor/source, policy window, and timestamp. A refund/reversal creates a compensating event; it never rewrites a committed event.

The profile/window counters are projections of this ledger and must be reconcilable from it. Platform subscription payments, failed/pending attempts, Record Invoice amounts, and manual offline payment records are excluded.

## 4. Supporting tables that are not duplicated

The future adapter should reuse the existing authoritative stores:

- `subscriptions`, `workspace_subscriptions`, `subscription_payments`, and `payment_records` for commercial/payment state;
- `verification_logs` and merchant verification evidence fields for Lite/Business evidence;
- `solo_plus_cases`, `solo_plus_case_requirements`, and `solo_plus_case_events` for Enhanced verification;
- business registry snapshots, affiliations, director invitations, and director verifications for Business KYB;
- `merchant_settlement_accounts` for payout verification;
- `merchant_provider_settlement_accounts` for exact provider/environment settlement readiness;
- `platform_settings` for global feature rollout/kill switches.

## 5. Compliance status values and transitions

Allowed values remain exactly:

`draft`, `lite_pending`, `lite_verified`, `enhanced_pending`, `enhanced_verified`, `business_pending`, `business_verified`, `needs_attention`, `restricted`, `rejected`.

Rules:

- `draft` may move only to the pending state appropriate to a trusted target verification stream, or to a restrictive/rejected state.
- A pending state may move to its matching verified state only through the reviewed projection rules in sections 12–14. It may also move to `needs_attention`, `restricted`, or `rejected`.
- `lite_pending` cannot become `enhanced_verified` or `business_verified`; `enhanced_pending` cannot become `lite_verified` or `business_verified`; `business_pending` cannot become an individual verification state.
- An existing approved Solo Lite profile stays `lite_verified` while a Solo Plus upgrade case is pending. The pending target lives in the Solo Plus case, so payment/application does not remove the merchant's current approved Lite state.
- Likewise, an upgrade application must not replace a currently approved profile with a less authoritative pending target merely because an application exists.
- `needs_attention`, `restricted`, and `rejected` require a reason and event. Returning to a pending review requires an explicit reopen/remediation transition; none can jump directly to verified.
- Repeating an identical decision with the same idempotency key is a no-op returning the existing state.

## 6. Activation status values and transitions

Allowed values remain exactly:

`test_mode`, `pre_approved`, `awaiting_review`, `approved`, `needs_attention`, `restricted`, `suspended`.

Rules:

- New profiles begin fail-closed in `test_mode`.
- Payment may make a verification stream eligible to begin, but cannot set `pre_approved`, `awaiting_review`, or `approved` by itself.
- A reviewed compliance process may set `pre_approved` or `awaiting_review` after evidence is complete.
- Only the atomic activation command in section 15 may set `approved`.
- `approved` may move to `needs_attention`, `restricted`, or `suspended` through an explicit re-lock command.
- Returning from `needs_attention`, `restricted`, or `suspended` requires a fresh current-state review and normally passes through `awaiting_review`; it cannot be restored by payment, profile save, evidence upload, or provider callback.

## 7. Risk rating values

Allowed values remain exactly:

`low`, `medium`, `high`, `restricted`.

`low` and `medium` may pass the resolver when all other inputs pass. `high`, `restricted`, and missing all deny live capabilities. A risk update is a reviewed decision with policy version and evidence provenance. A provider success, transaction volume, or plan label cannot directly write a favorable rating.

## 8. Restriction and suspension model

Restriction is an independent precedence state:

- `active`: no explicit account restriction; all other gates still apply;
- `restricted`: live collection and live storefront are denied while remediation/review may continue;
- `suspended`: live capabilities are denied and ordinary account access may also be limited by existing RBAC/account-lock policy.

`restriction_state` has no permissive default. Any current suspension/restriction signal or source conflict wins over an allow. Consistency rules require:

- `restriction_state = restricted` to pair with a non-approved activation state such as `restricted` or `needs_attention`;
- `restriction_state = suspended` to pair with `activation_status = suspended`;
- `activation_status = approved` to require `restriction_state = active`;
- `risk_rating = restricted`, `compliance_status = restricted/rejected`, settlement revocation requiring emergency lock, or an explicit admin restriction to trigger re-lock evaluation.

Cap exhaustion and a disabled product rollout flag are ordinary capability denials and need not rewrite merchant/workspace live switches. Suspension, compliance rejection/restriction, or revoked settlement safety is a state transition and must atomically re-lock operational live state.

## 9. Approved limits and units

- All stored policy amounts are fixed-decimal NGN major units, never floating-point and never mixed with kobo.
- A positive numeric amount is not approved unless `collection_limit_approved = true`, approval provenance exists, and the basis is compatible with the normalized plan.
- Starter uses basis `none` and zero live capacity.
- Solo Lite uses a reviewed cumulative cap; the PRD's ₦8,000,000 is a proposal, not a schema default or migration seed.
- Solo Plus uses a reviewed monthly band; the PRD's ₦10,000,000 is a proposal, not a schema default or migration seed.
- Business uses an explicit KYB/risk/provider-approved volume. Missing approved volume is not unlimited.
- The hidden daily velocity and single-transaction limits must also be present and positive before customer collection.
- Receivable capabilities additionally require a positive approved outstanding receivable cap.

## 10. Cumulative usage and reservation model

The required transaction sequence is:

1. Resolve the trusted merchant/workspace, active commercial entitlement, current compliance profile, flags, and settlement readiness.
2. Lock the current profile and relevant cumulative/monthly/daily window rows.
3. Re-evaluate plan, compliance, activation, risk, restriction, setup/live, flags, payout/mapping readiness, single-transaction limit, committed usage, and reserved usage.
4. If every check passes, create or return the idempotent reservation and increment reserved totals in the same transaction.
5. Initialize the provider only after reservation succeeds.
6. On verified successful customer payment, atomically commit the reservation, move reserved to committed totals, append one usage event, and update projections once.
7. On failure, cancellation, or expiry, release once. On refund/chargeback, append a compensating usage event according to reviewed policy.

Two concurrent attempts must not both consume the same remaining capacity. Replay must return the existing reservation/commit and must not duplicate counters or ledger events. If the transactional reservation service is unavailable, checkout fails closed before provider initialization.

## 11. Feature flag ownership

Effective access is the conjunction of:

1. plan inclusion;
2. a service-role-controlled global/environment rollout flag in `platform_settings`;
3. the merchant-specific false-by-default entitlement on the compliance profile;
4. the complete resolver/limit/settlement decision.

The initial global keys should follow the PRD names (`storefront_enabled`, `storefront_instant_sale_enabled`, `storefront_receivable_sale_enabled`, `merchant_confirmation_before_deposit_enabled`, and `customer_registration_required_for_receivables`) and default to false in production. Payment-route/provider configuration is not a product entitlement flag.

Before runtime wiring, the pure contract must be reviewed so `can_collect_payments` and other merchant-level deny decisions cannot be discarded by `toResolveMerchantCapabilitiesInput`. An inactive/expired commercial entitlement must likewise reach the resolver as denied/unknown rather than as a paid plan label.

## 12. Solo Lite verification projection

Only a trusted compliance review service may project `lite_verified`. It must verify, at minimum:

- active Solo Lite commercial entitlement and matching trusted merchant/workspace;
- current required Lite identity/profile/activity evidence;
- BVN and selfie/liveness results, with manual resolution where policy requires it;
- required address/ID checks for the applicable verification level;
- a verified active merchant payout account with matching ownership;
- reviewed risk rating of `low` or `medium`;
- explicit `restriction_state = active`;
- approved cumulative, daily velocity, and single-transaction limits;
- final compliance review with actor, source evidence, and policy version.

The projection writes the profile decision and event, not provider evidence. `merchants.verification_status = verified` alone is insufficient. After projection, a separate activation transition is still required before live capability.

## 13. Solo Plus Enhanced projection

The Solo Plus case stream remains the source of Enhanced evidence and approval. For an upgrade from approved Solo Lite, the active profile and plan remain Solo Lite while the case is pending. Payment changes the case to `verification_pending` only.

Projection to `enhanced_verified` requires:

- the correct paid Solo Plus case bound to the trusted merchant/workspace;
- all required Solo Plus requirements satisfied with current, valid provenance;
- case status explicitly approved through the admin review state machine;
- no unresolved refund/rejection/reopen state;
- reviewed `low` or `medium` risk;
- explicit active restriction state;
- approved monthly, daily, single-transaction, and receivable exposure limits;
- reviewed feature entitlements;
- an idempotent source case/version and policy version.

The later activation transaction may atomically change the active plan projection to Solo Plus and the compliance profile to `enhanced_verified`. Existing Solo Plus activation behavior must be adapted only in a separately approved runtime/migration change; this document does not modify it.

## 14. Business KYB projection

Only a trusted Business KYB review service may project `business_verified`. It must validate the applicable business type, registration and document evidence, operating/registered address, owner/director/beneficial-owner authority and identity, business payout account, activity/category, screening results, risk review, approved volume/limits, and final admin decision.

Registry snapshots, affiliations, director records, merchant step fields, and verification logs are evidence. A legacy merchant verification flag, a paid Business subscription, or a registered name alone is insufficient. The projection must record the KYB source/review ID, actor, policy version, evidence provenance, and next review date.

## 15. Explicit activation transition

Activation is a service-role-only, idempotent, atomic command. It requires an expected profile row version and request idempotency key. Immediately before commit it must re-read and lock all mutable decision rows and verify:

- trusted merchant/workspace linkage and active entitlement for the target plan;
- exact plan-specific verified compliance status;
- activation state eligible for approval;
- `risk_rating` low/medium and restriction active;
- current approved limits with remaining capacity;
- explicit merchant feature entitlements and required global flags;
- active verified payout account;
- exact provider/environment settlement mapping readiness;
- no subscription/account hard lock or conflicting pending transition;
- merchant and workspace operational states are still internally consistent.

The command validates the proposed post-transition capability state, then commits together:

- `activation_status = approved` and the profile version/audit provenance;
- any approved plan projection change, such as final Solo Plus activation;
- merchant and workspace `setup_mode = false`;
- merchant and workspace `live_features_enabled = true` only for the approved collection scope;
- one compliance event and any required plan/activation audit event.

Any failed write rolls back all of them. Replay returns the existing result without duplicating events. No generic synchronization helper, form action, evidence action, or payment callback may invoke this transition implicitly.

## 16. Explicit re-lock and restriction transitions

Re-lock is at least as atomic and privileged as activation. It is triggered by explicit suspension/restriction/rejection, reviewed high/restricted risk, required evidence revocation, settlement safety revocation, or another approved emergency policy condition.

The transaction must:

- set the relevant compliance/activation/restriction state and reason;
- set merchant and workspace `live_features_enabled = false`;
- set `setup_mode = true` where remediation/re-approval is required;
- invalidate or release unsubmitted reservations according to policy;
- prevent new reservations immediately;
- append one idempotent compliance event;
- preserve payment, invoice, settlement, and usage history.

Reactivation requires a fresh review of every gate. Merely restoring a provider mapping, receiving a subscription payment, or editing the profile does not restore live capability.

## 17. Payment mutation boundary

Payment may update only payment and commercial lifecycle state appropriate to the specific flow:

- provider-verified `payment_records` and `subscription_payments`;
- `subscriptions` and `workspace_subscriptions` where the approved commercial flow requires them;
- compatible merchant/workspace plan projections and paid-setup state for flows such as Solo Lite;
- a Solo Plus case from awaiting payment to `verification_pending`, without changing the active Solo Lite plan;
- an idempotent request to create a safe `draft`/matching pending compliance profile when no stronger current profile exists.

That last operation must be a compliance-domain transition, must never overwrite verified/restricted/suspended/rejected state, and is not approval.

Payment must never write:

- any verified compliance status;
- `activation_status = approved` or `restriction_state = active`;
- a favorable risk rating;
- approved limits, counters, or feature entitlements;
- payout verification or provider settlement readiness;
- Lite, Enhanced, or Business/KYB approval;
- `setup_mode = false` or `live_features_enabled = true`;
- Receivable Sale, Deposit & Balance, storefront-live, or collection capability.

## 18. Non-transition mutation boundary

- Business/Profile save may update profile/contact/address/activity facts only. It must not update compliance decisions, risk, limits, feature entitlements, activation, setup/live state, settlement readiness, or approval timestamps.
- Evidence upload/submission may create evidence and pending processing state. It must not project verified compliance, approve risk/limits, or activate capabilities. Provider success remains evidence until reviewed projection rules pass.
- Record Invoice may write the invoice, line items, and offline/manual bookkeeping records only. It must never synchronize setup/live state, create a limit reservation, initialize checkout, or alter compliance state.
- Payout-account save may update settlement-account evidence and mapping workflow only. It must not by itself approve compliance or activate collection.

## 19. RLS and grant expectations

- Enable RLS on every new table.
- Revoke table access from `PUBLIC` and `anon`.
- Do not grant browser roles direct mutation access to compliance profiles, events, limit windows, reservations, or usage events.
- Prefer no direct `authenticated` read on the base profile because it includes hidden risk controls and internal notes. Expose a safe server/API projection containing only merchant-facing status, public limit, blocking reasons, and next steps.
- Owner/team membership does not confer compliance-write authority. Admin operations must pass the existing trusted super-admin authorization and use service-side commands.
- `service_role` receives only the privileges required by reviewed server services. Transition/reservation functions are service-role-only; revoke execute from `PUBLIC`, `anon`, and `authenticated`.
- Any security-definer function must use a fixed safe `search_path`, validate all identifiers/source states, enforce row version and idempotency, and avoid trusting session/provider metadata.
- Append-only event and usage tables prohibit ordinary update/delete paths. Retention or legal erasure requires a separately approved audited process.

## 20. Migration safety expectations

No migration is authorized by this document. Before one is prepared, the mandatory database migration/staging safety runbooks must be re-read. A future package must:

- be a new additive migration; never edit applied migrations 018–023;
- include SQL Editor-compatible read-only preflight and postflight checks;
- stop on incompatible existing objects, types, constraints, policies, grants, or function overloads;
- use safe missing-type inspection and avoid unsafe casts to types whose existence has not been established;
- use idempotent table/column/index/policy/grant/function creation with partial-apply recovery;
- perform no production business-row insert, update, delete, truncate, approval backfill, feature activation, payment mutation, or provider mutation during apply;
- not seed proposed PRD limit values or set flags true;
- not create an `active`, verified, low-risk, approved, or live profile for existing merchants by default;
- preserve all current subscription, invoice, verification, settlement, role, and payment behavior;
- keep browser grants absent and service-role functions narrowly scoped;
- reload PostgREST schema only as an explicit final compatibility step after successful apply;
- leave production collection locked until persistence postflight, adapter review, shadow checks, and separately approved runtime integration pass.

## 21. Tests required before any migration

At minimum, source and migration tests must prove:

1. the schema contract covers every proposed field, type, constraint, index, RLS policy, and grant;
2. clean-schema apply, second apply, and safe recovery after representative partial application;
3. apply contains no business-row DML and does not change setup/live, verification, plan, subscription, payment, provider, or role data;
4. missing profile/risk/restriction/limits/flags/settlement inputs deny live capability;
5. legacy plan aliases normalize without granting an inactive entitlement;
6. all legal compliance, activation, risk, and restriction transitions succeed, and all illegal cross-tier/direct-to-approved transitions fail;
7. repeated transition idempotency keys do not duplicate events;
8. Lite projection cannot occur from payment or legacy `verification_status` alone;
9. Solo Plus payment leaves the active plan/capabilities unchanged and cannot project `enhanced_verified`;
10. Business payment or business name alone cannot project `business_verified`;
11. activation validates every current gate and rolls back profile, merchant, workspace, plan, and event writes on any failure;
12. restriction/re-lock is immediate, atomic, idempotent, and preserves business/payment history;
13. two concurrent reservations cannot exceed cumulative, monthly, daily, single-transaction, or receivable limits;
14. commit/release/expiry/refund/reversal replay cannot duplicate or corrupt usage;
15. subscription payments and Record Invoices never count as customer collection usage;
16. NGN/kobo conversion boundaries are exact and no floating-point amount is persisted;
17. false/missing global or merchant flags deny the corresponding capability;
18. Starter and Solo Lite can never receive receivable/deposit capabilities;
19. no browser role can mutate or execute privileged compliance/limit operations;
20. existing Starter Record Invoice, Solo Lite paid-setup lock, Settings/Profile save, and invoice regressions remain unchanged.

No migration should be proposed for production application until these tests, preflight, rehearsal, postflight, and an independent source review pass.

## 22. Pre-wiring contract decisions still required

Before runtime wiring is allowed:

- decide how an inactive/expired/conflicting entitlement is represented to the pure resolver so a paid plan label cannot pass;
- ensure merchant-level `can_collect_payments` and settlement-activation denial are consumed rather than discarded by the current adapter;
- finalize the exact table/column names, fixed-decimal precision, foreign-key deletion policy, and policy time-zone behavior;
- define whether the current-profile cumulative counter is maintained directly or is a verified projection from limit windows;
- define Business and Solo Lite review source records with stable IDs;
- design the controlled compatibility path from legacy verification/setup logic without approval backfill;
- define how the existing Solo Plus activation transaction will eventually incorporate the compliance profile without weakening its current fail-closed behavior.

## 23. Files reviewed

- `docs/deraledger-smart-storefront-prd.md`
- `docs/phase-alignment-and-roadmap-rebaseline.md`
- `docs/prd-phase-2-runtime-gate-audit.md`
- `docs/prd-phase-2-compliance-source-ownership.md`
- `src/lib/compliance/merchant-capabilities.ts`
- `src/lib/compliance/runtime-capability-context.ts`
- `src/lib/plans.ts`
- `src/lib/rbac.ts`
- `src/lib/data.ts`
- `src/lib/actions.ts`
- `src/lib/verification-requirements.ts`
- `src/lib/services/onboarding-flow.service.ts`
- `src/lib/services/verification.service.ts`
- `src/lib/services/fiat-payment-confirmation.service.ts`
- `src/lib/services/settlement-ledger.service.ts`
- `src/lib/services/payout-setup-refresh.service.ts`
- `src/lib/services/invoice-payment-safety.service.ts`
- `src/lib/solo-plus/state.ts`
- `src/lib/solo-plus/server/requirements.ts`
- `src/lib/solo-plus/server/review-service.ts`
- `src/lib/solo-plus/server/activation.ts`
- `src/lib/solo-plus/server/supabase-repository.ts`
- current subscription, Solo Plus, settlement, and paid-upgrade migration definitions, read only for compatibility understanding

## 24. Safety conclusion

- Migration required later: **yes**, after the unresolved decisions and required tests are approved.
- Runtime wiring allowed now: **no**.
- Payment testing allowed: **no**.
- Storefront work started: **no**.
- Production behavior changed: **no**.
