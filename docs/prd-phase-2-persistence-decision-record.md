# PRD Phase 2 Persistence Decision Record

Status: approved design decisions for preparing a future schema-only Migration 024; no migration, runtime wiring, or production change is authorized by this document

Decision date: 2026-08-20

PRD phase: Phase 2 — Compliance and Limit Engine

## 1. Context and authority

This record closes the persistence questions left by `docs/prd-phase-2-persistence-transition-contract.md`. The decision order is:

1. `docs/deraledger-smart-storefront-prd.md`
2. `docs/phase-alignment-and-roadmap-rebaseline.md`
3. `docs/prd-phase-2-runtime-gate-audit.md`
4. `docs/prd-phase-2-compliance-source-ownership.md`
5. `docs/prd-phase-2-persistence-transition-contract.md`
6. `src/lib/compliance/merchant-capabilities.ts`
7. `src/lib/compliance/runtime-capability-context.ts`

The current production state remains unchanged: paid setup is locked, `setup_mode = true`, `live_features_enabled = false`, verification is unapproved, and customer collection is disabled.

## 2. Decision summary

| # | Question | Decision |
|---|---|---|
| 1 | Exact table names | Use the seven tables in section 3. No aliases or plan-specific profile tables. |
| 2 | Exact column names | Use the canonical manifests in sections 4–10. PRD amount names are retained without `_ngn` suffixes; their unit is fixed by contract. |
| 3 | NGN precision | All money columns use `numeric(18,2)` in NGN major units. No floating-point or mixed kobo storage. |
| 4 | Policy timezone | Store instants as `timestamptz`/UTC. Policy windows use IANA zone `Africa/Lagos` and half-open `[start, end)` boundaries. |
| 5 | FK deletion | Use `ON DELETE RESTRICT`/equivalent non-cascading behavior for compliance, review, event, limit, reservation, invoice, and payment relationships. Actor and polymorphic source IDs have no FK. |
| 6 | Counter ownership | Locked `merchant_collection_limit_windows` rows are operational authority; immutable usage events are accounting authority; the profile counter is a reconciliation/display projection only. |
| 7 | Entitlement representation | Use the exact entitlement states in section 13. Only `starter_free` or `active_paid` supplies a known plan to the resolver. All other states supply `commercialPlan = null`. |
| 8 | Merchant feature flags | Keep merchant entitlements separate from global rollout flags. Add a pure `MerchantCapabilityEntitlements` input before wiring; missing/false denies. |
| 9 | Business source ID | Create a `merchant_compliance_reviews` row with `review_type = business_kyb`; its UUID is the profile decision source ID. |
| 10 | Solo Lite source ID | Create a `merchant_compliance_reviews` row with `review_type = solo_lite`; its UUID is the profile decision source ID. |
| 11 | Legacy compatibility | No approval backfill. Legacy state creates evidence snapshots and at most a `draft`/pending, `test_mode`, false-entitlement profile through a later reviewed service. |
| 12 | Solo Plus activation | Later introduce a versioned atomic activation path that includes the profile; never bolt on a post-commit profile write or weaken the existing case checks. |
| 13 | Migration 024 scope | Schema/security only: tables, columns, constraints, indexes, RLS, grants, and schema-cache notification. No rows, triggers, transition RPCs, reservation RPCs, or provider/payment changes. |
| 14 | RLS/grants | All seven tables are service-only base tables: RLS enabled, zero browser policies, no PUBLIC/anon/authenticated privileges, explicit least-privilege service-role grants. |
| 15 | Rehearsal | Follow the mandatory runbooks, use a production-baseline-compatible disposable harness, collect all failures, exercise hostile/default-grant and partial-apply states, and require manual preflight/postflight. |

## 3. Exact table names

Migration 024 may later create exactly these tables:

1. `public.merchant_compliance_profiles`
2. `public.merchant_compliance_reviews`
3. `public.merchant_compliance_events`
4. `public.merchant_collection_limit_windows`
5. `public.merchant_collection_limit_reservations`
6. `public.merchant_collection_limit_reservation_windows`
7. `public.merchant_collection_usage_events`

Existing subscription, payment, verification, Solo Plus, Business evidence, payout, provider mapping, merchant, and workspace tables remain authoritative in their existing domains. Migration 024 must not duplicate or rewrite them.

## 4. Exact `merchant_compliance_profiles` manifest

| Column | Type | Null/default | Constraint/meaning |
|---|---|---|---|
| `id` | `uuid` | Not null; generated UUID | Primary key. |
| `merchant_id` | `uuid` | Not null | Unique; FK to `public.merchants.id`, delete restricted. |
| `plan_code` | `text` | Not null; no default | `starter`, `solo_lite`, `solo_plus`, `business`. Snapshot only; active entitlement remains external. |
| `business_type` | `text` | Nullable; no default | PRD business-type allowlist. Unknown remains null. |
| `compliance_status` | `text` | Not null; default `draft` | Exact resolver/PRD allowlist. |
| `activation_status` | `text` | Not null; default `test_mode` | Exact resolver/PRD allowlist. |
| `risk_rating` | `text` | Nullable; no default | `low`, `medium`, `high`, `restricted`. Missing denies. |
| `restriction_state` | `text` | Nullable; no default | `active`, `restricted`, `suspended`. It must never default to `active`. |
| `restriction_reason_code` | `text` | Nullable | Machine-readable current reason. |
| `restriction_notes` | `text` | Nullable | Internal reviewed notes; never exposed through the base table to browsers. |
| `restriction_effective_at` | `timestamptz` | Nullable | Current restriction start. |
| `restriction_review_due_at` | `timestamptz` | Nullable | Next restriction review. |
| `collection_limit_basis` | `text` | Nullable; no default | `none`, `cumulative`, `monthly`, `approved_volume`. |
| `approved_monthly_volume` | `numeric(18,2)` | Nullable; no default | NGN, non-negative. |
| `cumulative_collection_cap` | `numeric(18,2)` | Nullable; no default | NGN, non-negative. |
| `cumulative_collection_used` | `numeric(18,2)` | Nullable; no default | NGN reconciliation/display projection, never authorization authority. |
| `hidden_daily_velocity_limit` | `numeric(18,2)` | Nullable; no default | NGN, positive when approved. |
| `single_transaction_limit` | `numeric(18,2)` | Nullable; no default | NGN, positive when approved. |
| `outstanding_receivable_cap` | `numeric(18,2)` | Nullable; no default | NGN, non-negative; required for receivable capability. |
| `collection_limit_approved` | `boolean` | Not null; default `false` | A number alone is not approval. |
| `limits_approved_at` | `timestamptz` | Nullable | Required by later transition logic when limits are approved. |
| `limits_approved_by` | `uuid` | Nullable; no FK | Trusted admin actor snapshot. |
| `can_collect_payments` | `boolean` | Not null; default `false` | Merchant entitlement; every other live gate still applies. |
| `can_use_instant_sale` | `boolean` | Not null; default `false` | Merchant entitlement. |
| `can_use_receivable_sale` | `boolean` | Not null; default `false` | Always false for Starter and Solo Lite. |
| `can_use_storefront` | `boolean` | Not null; default `false` | Live storefront only, not preview. |
| `can_activate_settlement` | `boolean` | Not null; default `false` | Does not prove payout/mapping readiness. |
| `can_use_deposit_balance` | `boolean` | Not null; default `false` | Requires receivable entitlement. |
| `policy_version` | `text` | Nullable while draft | Required by later reviewed/approved transitions. |
| `decision_source_type` | `text` | Nullable while draft | `solo_lite_review`, `solo_plus_case`, `business_kyb_review`, `restriction_review`, `system_reconciliation`. |
| `decision_source_id` | `uuid` | Nullable while draft; no FK | Polymorphic source UUID. Source type and ID must both be null or both present. |
| `decision_source_version` | `bigint` | Nullable | Review/case row version used for the projection. |
| `last_reviewed_at` | `timestamptz` | Nullable | Current decision review timestamp. |
| `next_review_due_at` | `timestamptz` | Nullable | Scheduled re-review. |
| `reviewed_by` | `uuid` | Nullable; no FK | Trusted actor snapshot. |
| `row_version` | `bigint` | Not null; default `1` | Positive optimistic-concurrency version. |
| `created_at` | `timestamptz` | Not null; default current timestamp | Creation time. |
| `updated_at` | `timestamptz` | Not null; default current timestamp | Updated explicitly by later commands; Migration 024 adds no trigger. |

Required row-local checks:

- all allowlists above;
- all amount columns non-negative, with positive daily/single limits when non-null;
- `decision_source_type` and `decision_source_id` are paired;
- `row_version > 0`;
- approved limits require a non-`none` basis plus approval time/actor;
- `can_use_receivable_sale` implies `can_collect_payments`;
- `can_use_deposit_balance` implies `can_use_receivable_sale`;
- Starter and Solo Lite cannot set receivable/deposit entitlements true.

The exact profile allowlists are:

- `business_type`: `unregistered_individual`, `sole_proprietor`, `registered_business_name`, `limited_liability_company`, `incorporated_trustee`, `other_entity`;
- `compliance_status`: `draft`, `lite_pending`, `lite_verified`, `enhanced_pending`, `enhanced_verified`, `business_pending`, `business_verified`, `needs_attention`, `restricted`, `rejected`;
- `activation_status`: `test_mode`, `pre_approved`, `awaiting_review`, `approved`, `needs_attention`, `restricted`, `suspended`;
- `risk_rating`: `low`, `medium`, `high`, `restricted`;
- `restriction_state`: `active`, `restricted`, `suspended`;
- `collection_limit_basis`: `none`, `cumulative`, `monthly`, `approved_volume`;
- `decision_source_type`: `solo_lite_review`, `solo_plus_case`, `business_kyb_review`, `restriction_review`, `system_reconciliation`.

Migration 024 does not attempt cross-table transition checks or create approval rows.

## 5. Exact `merchant_compliance_reviews` manifest

This table provides stable source IDs for Solo Lite and Business decisions. Solo Plus continues to use its existing case row.

| Column | Type | Null/default | Constraint/meaning |
|---|---|---|---|
| `id` | `uuid` | Not null; generated | Primary key and canonical review source ID. |
| `merchant_id` | `uuid` | Not null | FK to merchant, delete restricted. |
| `profile_id` | `uuid` | Not null | FK to compliance profile, delete restricted. |
| `review_type` | `text` | Not null | `solo_lite` or `business_kyb`. |
| `target_plan_code` | `text` | Not null | `solo_lite` for Lite review; `business` for KYB review. |
| `review_status` | `text` | Not null; default `draft` | `draft`, `pending`, `approved`, `rejected`, `needs_attention`, `cancelled`. |
| `evidence_snapshot` | `jsonb` | Not null; default empty object | IDs, statuses, checksums and policy results only; no raw BVN, selfie, account number, or provider secret. |
| `decision_reason_code` | `text` | Nullable | Machine-readable review outcome reason. |
| `decision_notes` | `text` | Nullable | Internal notes. |
| `policy_version` | `text` | Nullable until submitted | Required before approval. |
| `submitted_at` | `timestamptz` | Nullable | Review submission time. |
| `reviewed_at` | `timestamptz` | Nullable | Decision time. |
| `reviewed_by` | `uuid` | Nullable; no FK | Trusted admin actor snapshot. |
| `idempotency_key` | `text` | Not null | Unique with merchant to prevent duplicate review creation/decision. |
| `row_version` | `bigint` | Not null; default `1` | Positive concurrency version. |
| `created_at` | `timestamptz` | Not null; current timestamp | Creation time. |
| `updated_at` | `timestamptz` | Not null; current timestamp | Explicitly maintained later. |

Canonical uniqueness is `(merchant_id, idempotency_key)`. Review approval later requires non-empty evidence, policy version, reviewer, and reviewed timestamp, but Migration 024 creates no approval transition function.

## 6. Exact `merchant_compliance_events` manifest

| Column | Type | Null/default | Meaning |
|---|---|---|---|
| `id` | `uuid` | Not null; generated | Primary key. |
| `merchant_id` | `uuid` | Not null | Restricted-delete merchant FK. |
| `profile_id` | `uuid` | Not null | Restricted-delete profile FK. |
| `event_type` | `text` | Not null | Versioned transition/audit event name. |
| `from_state` | `jsonb` | Not null | Safe pre-transition snapshot. |
| `to_state` | `jsonb` | Not null | Safe post-transition snapshot. |
| `reason_code` | `text` | Nullable | Machine-readable reason. |
| `notes` | `text` | Nullable | Internal notes. |
| `actor_type` | `text` | Not null | `system`, `admin`, `merchant`, `reconciliation`. Merchant actors cannot approve. |
| `actor_id` | `uuid` | Nullable; no FK | Actor snapshot. |
| `source_type` | `text` | Nullable | Review/case/restriction/reconciliation source type. |
| `source_id` | `uuid` | Nullable; no FK | Polymorphic source. |
| `policy_version` | `text` | Nullable | Required for reviewed transitions. |
| `idempotency_key` | `text` | Not null | Unique with merchant. |
| `expected_row_version` | `bigint` | Nullable | Caller expectation. |
| `resulting_row_version` | `bigint` | Not null | Profile version after transition. |
| `metadata` | `jsonb` | Not null; empty object | Non-secret supporting data. |
| `created_at` | `timestamptz` | Not null; current timestamp | Append-only event time. |

There is no `updated_at`: events are immutable. Corrections are compensating events.

## 7. Exact `merchant_collection_limit_windows` manifest

| Column | Type | Null/default | Meaning |
|---|---|---|---|
| `id` | `uuid` | Not null; generated | Primary key. |
| `merchant_id` | `uuid` | Not null | Restricted-delete merchant FK. |
| `profile_id` | `uuid` | Not null | Restricted-delete profile FK. |
| `window_type` | `text` | Not null | `cumulative`, `monthly`, `daily_velocity`, `outstanding_receivable`. |
| `window_key` | `text` | Not null | Stable policy/window identifier. |
| `window_start` | `timestamptz` | Not null | UTC instant for inclusive start. |
| `window_end` | `timestamptz` | Nullable | UTC instant for exclusive end; null only for cumulative policy epoch. |
| `policy_timezone` | `text` | Not null; default `Africa/Lagos` | Phase 2 accepts only `Africa/Lagos`. |
| `limit_amount` | `numeric(18,2)` | Not null | Positive NGN approved limit for this window. |
| `committed_amount` | `numeric(18,2)` | Not null; default `0` | Non-negative committed gross customer collection. |
| `reserved_amount` | `numeric(18,2)` | Not null; default `0` | Non-negative outstanding reservations. |
| `policy_version` | `text` | Not null | Policy/approval version. |
| `row_version` | `bigint` | Not null; default `1` | Positive lock/version counter. |
| `created_at`, `updated_at` | `timestamptz` | Not null; current timestamp | Lifecycle timestamps. |

Canonical uniqueness is `(merchant_id, window_type, window_key, policy_version)`. Authorization always uses locked window values, never the profile projection.

## 8. Exact reservation manifests

### `merchant_collection_limit_reservations`

| Column | Type | Null/default | Meaning |
|---|---|---|---|
| `id` | `uuid` | Not null; generated | Primary key. |
| `merchant_id` | `uuid` | Not null | Restricted-delete merchant FK. |
| `profile_id` | `uuid` | Not null | Restricted-delete profile FK. |
| `invoice_id` | `uuid` | Nullable | Restricted-delete invoice FK when the source is an invoice. |
| `payment_record_id` | `uuid` | Nullable | Restricted-delete payment-record FK once present. |
| `source_type` | `text` | Not null | `invoice`, `storefront_order`, or `receivable`; this is infrastructure only and does not start storefront work. |
| `source_id` | `uuid` | Not null; no polymorphic FK | Trusted source identifier. |
| `internal_reference` | `text` | Not null | DeraLedger collection reference, never provider-owned identity. |
| `idempotency_key` | `text` | Not null | Request replay key. |
| `amount` | `numeric(18,2)` | Not null | Positive gross NGN amount. |
| `currency` | `text` | Not null; default `NGN` | Must equal `NGN` in Phase 2. |
| `status` | `text` | Not null; default `reserved` | `reserved`, `committed`, `released`, `expired`, `reversed`. |
| `reserved_at` | `timestamptz` | Not null; current timestamp | Reservation time. |
| `expires_at` | `timestamptz` | Not null | Expiry instant. |
| `committed_at` | `timestamptz` | Nullable | Successful commit time. |
| `released_at` | `timestamptz` | Nullable | Release/expiry/reversal time. |
| `release_reason_code` | `text` | Nullable | Machine-readable release reason. |
| `provider_reference` | `text` | Nullable | Supporting evidence only. |
| `row_version` | `bigint` | Not null; default `1` | Positive concurrency version. |
| `created_at`, `updated_at` | `timestamptz` | Not null; current timestamp | Lifecycle timestamps. |

Canonical uniqueness is both `(merchant_id, internal_reference)` and `(merchant_id, idempotency_key)`.

### `merchant_collection_limit_reservation_windows`

| Column | Type | Null/default | Meaning |
|---|---|---|---|
| `reservation_id` | `uuid` | Not null | Restricted-delete reservation FK. |
| `window_id` | `uuid` | Not null | Restricted-delete limit-window FK. |
| `amount` | `numeric(18,2)` | Not null | Positive NGN amount reserved against this window. |
| `created_at` | `timestamptz` | Not null; current timestamp | Link creation time. |

The primary key is `(reservation_id, window_id)`. The join table is required because one attempt can consume cumulative/monthly, daily-velocity, and receivable-exposure windows simultaneously.

## 9. Exact `merchant_collection_usage_events` manifest

| Column | Type | Null/default | Meaning |
|---|---|---|---|
| `id` | `uuid` | Not null; generated | Primary key. |
| `merchant_id` | `uuid` | Not null | Restricted-delete merchant FK. |
| `profile_id` | `uuid` | Not null | Restricted-delete profile FK. |
| `window_id` | `uuid` | Not null | Restricted-delete limit-window FK. |
| `reservation_id` | `uuid` | Nullable | Restricted-delete reservation FK; null only for reviewed correction events. |
| `payment_record_id` | `uuid` | Nullable | Restricted-delete payment-record FK. |
| `event_type` | `text` | Not null | `collection_committed`, `refund_adjustment`, `chargeback_adjustment`, `reservation_released`, `manual_correction`. |
| `direction` | `text` | Not null | `debit` increases usage; `credit` decreases it. |
| `amount` | `numeric(18,2)` | Not null | Positive NGN amount. |
| `currency` | `text` | Not null; default `NGN` | Must equal `NGN`. |
| `internal_reference` | `text` | Not null | DeraLedger source reference. |
| `provider_reference` | `text` | Nullable | Supporting evidence only. |
| `idempotency_key` | `text` | Not null | Unique with merchant/window. |
| `actor_type` | `text` | Not null | `system`, `admin`, `reconciliation`. |
| `actor_id` | `uuid` | Nullable; no FK | Actor snapshot. |
| `reason_code` | `text` | Nullable | Required later for corrections/adjustments. |
| `metadata` | `jsonb` | Not null; empty object | Non-secret supporting data. |
| `created_at` | `timestamptz` | Not null; current timestamp | Immutable event time. |

Canonical uniqueness is `(merchant_id, window_id, idempotency_key)`. There is no update/delete application path.

## 10. Canonical indexes

Migration 024 must use stable names and verify exact definitions:

- `uq_merchant_compliance_profiles_merchant_id`
- `idx_merchant_compliance_profiles_decision_state` on merchant plan/compliance/activation/restriction state
- `uq_merchant_compliance_reviews_idempotency` on `(merchant_id, idempotency_key)`
- `idx_merchant_compliance_reviews_queue` on review type/status/created time
- `uq_merchant_compliance_events_idempotency` on `(merchant_id, idempotency_key)`
- `idx_merchant_compliance_events_timeline` on `(merchant_id, created_at)`
- `uq_merchant_collection_limit_windows_identity` on `(merchant_id, window_type, window_key, policy_version)`
- `idx_merchant_collection_limit_windows_active` on merchant/window type/start/end
- `uq_merchant_collection_reservations_reference` on `(merchant_id, internal_reference)`
- `uq_merchant_collection_reservations_idempotency` on `(merchant_id, idempotency_key)`
- `idx_merchant_collection_reservations_expiry` on status/expiry
- composite primary key on `merchant_collection_limit_reservation_windows`
- `uq_merchant_collection_usage_events_idempotency` on `(merchant_id, window_id, idempotency_key)`
- `idx_merchant_collection_usage_events_timeline` on `(merchant_id, created_at)`

No partial index is required in Migration 024. Avoiding predicates reduces catalog-rendering ambiguity before transition behavior exists.

## 11. Numeric precision and unit decision

Every amount named in sections 4 and 7–9 is `numeric(18,2)` and represents NGN major units. The service boundary must convert verified provider kobo using exact integer-to-decimal conversion before calling future limit operations. The database must reject non-NGN currency, negative amounts, and zero reservation/usage amounts.

The existing `merchants.monthly_collection_limit numeric(12,2)` remains untouched as a legacy field. It is not copied into the new profile and cannot approve a PRD limit.

## 12. Policy timezone decision

- Store every timestamp as an absolute `timestamptz` instant.
- Phase 2 policy time zone is exactly `Africa/Lagos`.
- Daily and monthly window keys are calculated in that zone and stored with their UTC start/end instants.
- Windows are half-open: start inclusive, end exclusive.
- A cumulative policy epoch has a required start and null end until superseded.
- Server, browser, database-session, or provider-local timezone must not affect window selection.
- Changing time zone later requires a new policy version and new windows; existing history is never reinterpreted.

## 13. Entitlement representation decision

The future trusted context uses exactly:

- `starter_free`
- `active_paid`
- `grace_read_only`
- `inactive`
- `expired`
- `cancelled`
- `missing`
- `conflicting`

Resolution rules:

- `starter_free` requires a positively identified Starter merchant/workspace and supplies plan `starter`.
- `active_paid` requires an active, in-date subscription/workspace subscription plus matching normalized merchant projection and supplies its paid plan.
- `grace_read_only`, `inactive`, `expired`, `cancelled`, `missing`, and `conflicting` supply `commercialPlan = null` to `resolveMerchantCapabilities`, producing an unknown-plan denial. They are never silently downgraded to Starter.
- `conflicting` includes multiple incompatible active rows or disagreement between merchant, subscription, and workspace subscription projections.
- A pending Solo Plus upgrade retains the merchant's current active Solo Lite entitlement. The target plan remains in the Solo Plus case until approved activation.

Before runtime wiring, `runtime-capability-context.ts` must represent this exact entitlement result rather than carrying only raw subscription text.

## 14. Merchant entitlement and global feature-flag decision

Merchant-specific decisions and platform rollout flags remain separate.

A future pure-contract commit must add:

```text
MerchantCapabilityEntitlements
- canCollectPayments
- canUseInstantSale
- canUseReceivableSale
- canUseStorefront
- canActivateSettlement
- canUseDepositBalance
```

These map one-to-one from the false-by-default profile columns. Missing entitlement object or missing value denies the corresponding capability.

Existing `MerchantCapabilityFeatureFlags` remains the global/environment rollout input:

- `storefrontEnabled`
- `instantSaleEnabled`
- `receivableSaleEnabled`
- `merchantConfirmationBeforeDepositEnabled`
- `customerRegistrationRequiredForReceivables`

The trusted adapter reads rollout values from service-controlled `platform_settings`; missing keys resolve to null/false. Effective access requires plan inclusion, explicit merchant entitlement, applicable global flags, and all compliance/risk/limit/setup/live/settlement gates. Payment-route availability and provider configuration remain separate final checks.

Migration 024 does not seed platform settings or change the TypeScript contract.

## 15. Lite and Business review source decisions

### Solo Lite

- Canonical source type: `solo_lite_review`.
- Canonical source ID: UUID of `merchant_compliance_reviews.id` where `review_type = solo_lite`.
- The evidence snapshot contains stable verification/evidence IDs, normalized status, reviewed timestamps, and policy results, but no raw identity or provider payload.
- Approval is not inferred from the latest verification log or `merchants.verification_status`.

### Business

- Canonical source type: `business_kyb_review`.
- Canonical source ID: UUID of `merchant_compliance_reviews.id` where `review_type = business_kyb`.
- The snapshot references registry, affiliation, document, director/beneficial-owner, identity, payout, screening, and volume/risk evidence IDs as applicable.
- Approval is not inferred from plan, business name/type, CAC success, or a legacy final flag.

### Solo Plus

- Canonical source type: `solo_plus_case`.
- Canonical source ID: existing `solo_plus_cases.id`.
- Canonical source version: the approved case row version; the approved event/requirements are referenced in event metadata.
- No duplicate Solo Plus review row is created.

## 16. Legacy verification compatibility decision

Migration 024 creates empty tables and performs no compatibility backfill.

A later, separately approved bootstrap/review service may:

1. resolve the trusted merchant/workspace and normalized active entitlement;
2. read legacy verification fields, `verification_step_state`, `verification_logs`, Business evidence, and settlement evidence;
3. create a non-sensitive evidence snapshot in a new review row;
4. create a profile only as `draft` or the matching pending status, with `activation_status = test_mode`, null risk/restriction/limits, and all merchant entitlement flags false;
5. submit it for explicit review.

It must never map any of the following directly to approval:

- `verification_status = verified`;
- `setup_mode = false`;
- `live_features_enabled = true`;
- an existing plan or subscription payment;
- populated bank fields or legacy subaccount codes;
- `monthly_collection_limit`;
- sandbox/super-admin identity.

Before runtime cutover, existing live merchants need explicit reviewed profiles. Shadow comparison may report differences but cannot change decisions. Wiring is prohibited while any merchant expected to collect lacks a reviewed profile, because missing profiles correctly fail closed.

## 17. Solo Plus activation integration decision

Migration 024 does not modify `activate_solo_plus_case_v1`.

A later activation migration/runtime commit must:

1. create and rehearse a versioned `activate_solo_plus_case_v2` path;
2. preserve every current v1 case, payment, requirement, manual-review, row-version, actor, and idempotency validation;
3. additionally lock and validate the compliance profile, entitlement, risk, restriction, approved limits, merchant entitlements, payout account, and exact provider/environment settlement mapping;
4. atomically write the Enhanced profile decision, activation approval, Solo Plus plan projection, merchant/workspace setup/live state, existing case activation state, and compliance/case events;
5. roll back every write on any failure;
6. return the existing result on replay without duplicate events;
7. switch callers only after staging/shadow parity passes;
8. replace v1 with a fail-closed delegate to v2 or revoke its service-role execute privilege in the same controlled cutover so v1 cannot remain a bypass.

There must never be a post-commit “update compliance profile” side effect after v1 activation. Until the versioned path is approved and deployed, existing Solo Plus behavior remains unchanged and the resolver remains unwired.

## 18. Migration 024 scope decision

Migration 024 is authorized for **future source-controlled preparation only** after this record is reviewed. It must create:

- the seven empty tables;
- exact columns, defaults, simple checks, FKs, unique constraints, and indexes;
- RLS state and exact grants/revokes;
- schema comments/manifest support where repository convention requires it;
- final `NOTIFY pgrst, 'reload schema'` after successful DDL.

It must not create:

- compliance transition RPCs;
- activation/re-lock RPCs;
- limit reservation/commit/release RPCs;
- automatic `updated_at` or approval triggers;
- provider/payment functions;
- browser-readable views or policies;
- seed rows, default profiles, default limits, reviews, windows, reservations, or usage;
- data-copy/backfill logic;
- changes to applied migrations 018–023.

Pure SQL transition/reservation functions belong to a later separately approved migration after repository interfaces, exact signatures, atomic failure behavior, and hostile-state tests are designed. This keeps Migration 024 additive, empty, inert, and production-behavior-neutral.

## 19. RLS and grant decision

All seven tables are service-only base tables for Migration 024.

| Table | RLS | Browser policies | `PUBLIC`/`anon`/`authenticated` | `service_role` |
|---|---|---|---|---|
| `merchant_compliance_profiles` | Enabled | None | No privileges | `SELECT`, `INSERT`, `UPDATE`; no `DELETE` |
| `merchant_compliance_reviews` | Enabled | None | No privileges | `SELECT`, `INSERT`, `UPDATE`; no `DELETE` |
| `merchant_compliance_events` | Enabled | None | No privileges | `SELECT`, `INSERT`; no `UPDATE`/`DELETE` |
| `merchant_collection_limit_windows` | Enabled | None | No privileges | `SELECT`, `INSERT`, `UPDATE`; no `DELETE` |
| `merchant_collection_limit_reservations` | Enabled | None | No privileges | `SELECT`, `INSERT`, `UPDATE`; no `DELETE` |
| `merchant_collection_limit_reservation_windows` | Enabled | None | No privileges | `SELECT`, `INSERT`; no `UPDATE`/`DELETE` |
| `merchant_collection_usage_events` | Enabled | None | No privileges | `SELECT`, `INSERT`; no `UPDATE`/`DELETE` |

Zero policies is intentional and must be reported as PASS for these service-only tables when RLS is enabled and browser grants are absent. `service_role` remains explicit in the privilege manifest even though Supabase service roles bypass RLS.

No direct authenticated read is allowed because profiles/windows contain hidden risk and internal limit data. A later server endpoint may expose a safe merchant-facing projection after authorization; it is not part of Migration 024.

Default privileges must be inspected and hostile-tested so they cannot restore PUBLIC/anon/authenticated access. Migration 024 creates no RPC execute grants.

## 20. Foreign-key deletion decision

- Every FK from the seven tables to merchant, profile, review, window, reservation, invoice, or payment record uses restricted/non-cascading deletion.
- Compliance and usage history cannot disappear through a normal merchant, invoice, or payment deletion.
- Actor IDs (`reviewed_by`, `limits_approved_by`, `actor_id`) are UUID snapshots without auth/admin FKs so account deletion cannot erase or block retained audit state.
- Polymorphic decision/source IDs have no FK and are validated by later transition services.
- No `ON DELETE CASCADE`, `SET NULL`, or table-trigger cleanup is allowed in Migration 024.
- Any legal erasure/anonymization/retention workflow is a separate audited design and is not implemented here.

The existing merchant-deletion action must be audited before profiles are populated; it must not be silently modified as part of Migration 024.

## 21. Counter ownership and mismatch decision

Operational authorization uses locked `merchant_collection_limit_windows.committed_amount + reserved_amount` against `limit_amount` for every applicable window. Immutable `merchant_collection_usage_events` is the accounting/reconciliation history.

`merchant_compliance_profiles.cumulative_collection_used` is retained because the PRD names it, but it is only a display/reconciliation projection. A future commit transactionally updates it where applicable after the window/ledger write. It is never the value used to approve a reservation.

If the profile projection, window counter, or usage ledger disagrees:

- do not auto-select the lowest/highest value;
- deny new collection;
- record a reconciliation-required result outside browser-visible metadata;
- require an idempotent reviewed reconciliation command that writes a compensating event, never history mutation.

## 22. Clean-production rehearsal decision

Before Migration 024 is written, the migration author must re-read:

- `docs/database-migration-and-staging-safety-runbook.md`
- `docs/sql-migration-rehearsal-lessons-learned.md`

The future package must include one canonical validation command and:

1. source inspection of all canonical/historical definitions and privilege conventions;
2. a SQL Editor-compatible, read-only preflight that reports compact PASS/WARN/FAIL and detects every object, column, type, default, nullability, check, FK, index, RLS state, policy, grant, default privilege, and unexpected collision before DDL;
3. a production-baseline-compatible disposable database built through the clean-production 018–023 contract or an independently verified equivalent schema fingerprint;
4. no requirement to mutate a stale/non-representative shared staging database merely to catch it up;
5. collect-all hostile-state coverage for missing/canonical/incompatible/partially-created tables, columns, constraints, indexes, RLS, grants, default grants, and late transactional failure;
6. normal fail-fast first apply and second-apply idempotency after collect-all reaches zero failures;
7. rollback proof for DDL and privilege changes in the disposable harness;
8. exact verification that apply performs zero business-row DML and preserves merchant/workspace setup/live, verification, subscription, payment, invoice, settlement, role, and provider data/counts;
9. exact service-role/browser privilege and RLS-zero-policy assertions;
10. SQL Editor-compatible postflight with one final PASS only when the full manifest matches;
11. schema-cache reload verification;
12. targeted schema contract tests, typecheck, build, and `git diff --check`;
13. independent source review before any user-run database preflight;
14. manual user-controlled staging/representative-environment preflight, apply, and postflight before any production consideration;
15. a fresh explicit approval checkpoint for commit, push, deployment, and production application.

The agent must not connect to staging/production or run these scripts against either environment. A preflight FAIL stops apply; WARN is acceptable only when the migration explicitly and safely fixes that exact state.

## 23. Closed and deferred decisions

All 15 persistence questions requested by this task are closed for Migration 024 preparation.

The following are deliberately **deferred rather than open Migration 024 blockers** because Migration 024 excludes executable transitions and runtime integration:

- exact RPC names/signatures for profile transitions, activation/re-lock, and limit reservation/commit/release;
- the TypeScript implementation of `MerchantCapabilityEntitlements` and entitlement-state loading;
- merchant-facing safe status projection/API;
- legacy review/bootstrap execution and any reviewed existing-merchant rollout;
- Solo Plus v2 activation implementation/cutover;
- resolver runtime adoption and route ordering.

Each requires a separate approval after Migration 024's inert persistence substrate is reviewed and rehearsed.

## 24. Files reviewed

- `docs/deraledger-smart-storefront-prd.md`
- `docs/phase-alignment-and-roadmap-rebaseline.md`
- `docs/prd-phase-2-runtime-gate-audit.md`
- `docs/prd-phase-2-compliance-source-ownership.md`
- `docs/prd-phase-2-persistence-transition-contract.md`
- `docs/database-migration-and-staging-safety-runbook.md`
- `docs/sql-migration-rehearsal-lessons-learned.md`
- `src/lib/compliance/merchant-capabilities.ts`
- `src/lib/compliance/runtime-capability-context.ts`

## 25. Safety conclusion

- Migration 024 source preparation allowed next: **yes**, after explicit user approval for that separate task.
- Migration 024 database application allowed now: **no**.
- Runtime wiring allowed now: **no**.
- Payment testing allowed: **no**.
- Storefront work started: **no**.
- Production behavior changed: **no**.
