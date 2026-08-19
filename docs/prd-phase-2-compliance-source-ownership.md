# PRD Phase 2 Compliance Source Ownership

Status: source-only design decision; no runtime wiring or schema change

PRD phase: Phase 2 — Compliance and Limit Engine

Production checkpoint: Starter and the first Solo Lite subscription payment are healthy, while the paid merchant remains in `paid_setup` with `setup_mode = true`, `live_features_enabled = false`, and customer collection locked.

## Purpose and authority

This document defines who owns each trusted input to `resolveMerchantCapabilities` before persistence or runtime integration is designed. It follows, in order:

1. `docs/deraledger-smart-storefront-prd.md`
2. `docs/phase-alignment-and-roadmap-rebaseline.md`
3. `docs/prd-phase-2-runtime-gate-audit.md`
4. `src/lib/compliance/merchant-capabilities.ts`
5. `src/lib/compliance/runtime-capability-context.ts`

The PRD deliberately separates commercial entitlement from compliance approval. A successful plan payment can establish a paid plan entitlement or open the next verification stream. It cannot establish compliance, approve risk, assign a collection limit, verify payout or provider settlement, clear setup mode, enable live features, or unlock customer collection.

The proposed canonical persistence name below is `merchant_compliance_profiles`, matching the PRD. A schema design may choose supporting decision/history tables, but it must preserve the ownership and fail-closed semantics in this document.

## Source-selection rules

- The runtime loader must start from the trusted, authenticated merchant/workspace resolution path. Browser-supplied merchant, workspace, plan, payment, or provider metadata is not a source.
- A current commercial entitlement, a compliance decision, and operational live switches are separate facts. Agreement between them is required; one cannot substitute for another.
- Legacy merchant verification fields and verification evidence can support a reviewed decision, but cannot be translated directly into an approved resolver status without an explicit, auditable projection rule.
- Query errors, ambiguous rows, stale evidence, missing values, or conflicting sources stay missing in `TrustedRuntimeCapabilityContext`. They must not receive permissive defaults.
- Monetary limits are NGN-denominated policy values. Usage must come from authoritative successful customer-collection accounting, not subscription payments, Record Invoices, pending attempts, or provider metadata.
- Payout verification and provider settlement mapping are separate inputs. A verified bank account does not prove that a provider/environment mapping is usable.
- Super-admin, sandbox, demo, and test bypasses remain outside ordinary merchant capability context.

## Source ownership matrix

| Resolver/context input | Canonical owner/source | Current available source | Missing persistence or decision | Fail-closed default | Migration later | Runtime wiring blocked |
|---|---|---|---|---|---|---|
| Commercial plan entitlement | Subscription entitlement domain. Resolve the current active entitlement from `subscriptions` and `workspace_subscriptions`, scoped to the trusted merchant/workspace; normalize aliases through `src/lib/plans.ts`. `merchants.subscription_plan`/`merchant_tier` are compatibility projections and must agree. | `subscriptions.plan_type/status/expiry_date`, `workspace_subscriptions.plan_type/subscription_status`, merchant plan fields, and atomic paid-upgrade activation. | Define one server repository rule for active, expired, cancelled, conflicting, and legacy-alias rows. `payment_records` and provider metadata remain payment evidence only. | Unknown plan / no paid entitlement. Starter is permitted only when Starter is positively established. | No new table expected; schema changes only if the repository audit proves a constraint/projection gap. | Yes — trusted entitlement precedence is not yet implemented in the capability loader. |
| `compliance_status` | Compliance decision domain, canonically `merchant_compliance_profiles.compliance_status`, written only by reviewed compliance transitions. | Legacy `merchants.verification_status`, step fields, `verification_step_state`, and `verification_logs` provide evidence, not the canonical PRD status. | Persist PRD statuses and their reviewed transition/audit provenance. | `null`/missing, which denies live capabilities. A newly created profile may begin as `draft`; absence must not be synthesized as approval. | Yes. | Yes. |
| `activation_status` | Compliance activation domain, canonically `merchant_compliance_profiles.activation_status`, changed only by an explicit final activation/restriction transition after all gates pass. | `onboarding_status`, Solo Plus case activation, `setup_mode`, and `live_features_enabled` are related operational state but are not this decision. | Persist PRD activation status and auditable actor/reason/timestamps. Do not derive it from payment or setup synchronization. | `null`/missing. | Yes. | Yes. |
| `risk_rating` | Risk/compliance decision owner, canonically the current reviewed rating on `merchant_compliance_profiles`, backed by immutable assessment evidence/history. | Risk/admin UI and verification evidence exist, but no single current PRD `low/medium/high/restricted` merchant rating is consumed by runtime gates. | Persist the current rating, assessment version, reviewer/source, and review dates; keep history separately if required. | `null`/missing, which denies live capabilities. | Yes. | Yes. |
| Restriction/suspension state | Account restriction domain with an explicit current state (`active`, `restricted`, or `suspended`) and auditable reason. It must take precedence over all allow decisions. | `merchants.verification_status = suspended`, subscription hard-lock logic in `src/lib/data.ts`, rejection/reset actions, and Solo Plus case outcomes are fragmented signals. | Add a canonical restriction state or an approved deterministic projection with reason, actor, effective time, and expiry. Billing expiry/read-only state should remain separately visible rather than silently becoming compliance approval. | `null`/missing; deny live access. Any positive restricted/suspended signal wins. | Yes, unless a later schema audit finds an existing canonical account-restriction record. | Yes. |
| `approved_monthly_volume` | Compliance/limit decision owner on the merchant compliance profile, set by reviewed policy. For Business this is KYB/risk-approved volume, not an unlimited-plan assumption. | Legacy `merchants.monthly_collection_limit` and plan labels exist, but do not prove PRD approval semantics. | Persist reviewed amount, currency/unit, policy version, effective dates, and reviewer/source. | `null`; never unlimited. | Yes. | Yes. |
| `cumulative_collection_cap` | Compliance/limit decision owner on the merchant compliance profile. | PRD recommendation exists; no canonical approved runtime cap is loaded. Legacy plan limits are not equivalent. | Persist explicit approved cap and policy/version/effective dates. | `null`; collection denied. | Yes. | Yes. |
| `cumulative_collection_used` | Customer-collection accounting/limit ledger is source of truth; a compliance-profile counter may be an atomically maintained projection. Count only successful settled/confirmed customer collections defined by policy. | Invoice/payment/transaction/settlement records can provide evidence, but there is no canonical, transactionally maintained PRD counter used by the resolver. | Specify included statuses, refunds/reversals, reset rules, concurrency and reconciliation. Exclude subscription payments, provider attempts, and offline Record Invoice amounts. | `null`; collection denied. | Yes, for a durable counter/ledger projection or an equivalent approved atomic design. | Yes. |
| `hidden_daily_velocity_limit` | Risk/limit policy owner on the compliance profile or a versioned merchant limit assignment. This is never exposed as a public plan promise. | No canonical runtime source found. | Persist reviewed value, effective window/time zone, policy version, and override audit. | `null`; collection denied. | Yes. | Yes. |
| `single_transaction_limit` | Risk/limit policy owner on the compliance profile or versioned merchant limit assignment. | No canonical runtime source found. | Persist reviewed value, currency/unit, policy version, and override audit. | `null`; collection denied. | Yes. | Yes. |
| Capability feature flags | Feature-access policy is the conjunction of global rollout/kill switches and explicit merchant eligibility. Global settings belong in service-role-controlled `platform_settings`; merchant eligibility belongs in the compliance profile (`can_collect_payments`, `can_use_instant_sale`, `can_use_receivable_sale`, `can_use_storefront`, and related policy). | `platform_settings` currently supplies Solo Plus availability/KYC flags; payment-route and provider flags exist; the resolver-specific storefront, Instant Sale, receivable, confirmation, and customer-registration flags are not loaded. | Define exact global keys, merchant-level fields, precedence, environment scope, and audit ownership. Payment/provider-route availability must not be mistaken for product entitlement. | Whole flag object or any required flag missing means denied. Explicit `false` means denied. | Yes for canonical merchant capability persistence and any approved missing global keys. | Yes. |
| Payout verification | Settlement-account domain. The selected account must be owned by the trusted merchant, active, and explicitly verified in `merchant_settlement_accounts`. | `merchant_settlement_accounts` has merchant linkage, default/active state, and `verification_status`; legacy bank fields on `merchants` are weaker compatibility data. | Define deterministic selection when rows conflict and evidence freshness/revocation rules. Do not query a provider while resolving capabilities. | Missing/ambiguous/stale/not active/not verified => `payoutAccountVerified = false` or unknown; both deny. | No new table expected; migration only if a later contract audit proves a constraint/status gap. | Yes — strict adapter and freshness policy are not yet defined. |
| Provider settlement readiness | Provider-settlement mapping domain. Use the exact intended provider and environment row in `merchant_provider_settlement_accounts`, linked to the selected verified settlement account, with a connected/active status and the provider-specific real mapping identifier. | `settlement-ledger.service.ts`, `payout-setup-refresh.service.ts`, and `invoice-payment-safety.service.ts` already enforce stronger provider/environment mapping checks at provider boundaries. | Define the provider/environment selected for the capability decision and a common stale/mismatch policy. Monnify requires a real subaccount/split mapping; broad legacy bank/subaccount indicators are insufficient. No provider call occurs in the capability loader. | Missing, mismatched, stale, test/live mismatch, or incomplete mapping => `providerMappingReady = false` or unknown; both deny. | No new table expected; migration only if a later mapping contract audit proves a missing invariant. | Yes — one trusted read adapter is still missing. |
| Solo Lite verification | Lite compliance reviewer owns the final projection to `compliance_status = lite_verified`; it requires the approved Lite evidence set, payout setup, and final review. | Merchant BVN/selfie/status fields, `verification_step_state`, `verification_logs`, settlement account records, and `adminApproveVerificationAction` provide the current legacy workflow. | Define an explicit, idempotent projection from reviewed current evidence into the PRD compliance profile. Legacy `verification_status = verified` alone is insufficient. | Missing/not-final/ambiguous => not verified (`null` or `lite_pending`). | Yes for compliance-profile projection. Existing evidence tables can remain sources. | Yes. |
| Solo Plus Enhanced verification | Solo Plus case/review domain owns Enhanced approval. A paid case must complete required evidence, enter admin review, be explicitly approved, and be activated; then an auditable projection may set `enhanced_verified`. | `solo_plus_cases`, `solo_plus_case_requirements`, `solo_plus_case_events`, state validation, review service, and service-role-only atomic activation RPC/repository. | Define the one-way/idempotent projection into the PRD compliance profile and how reopen/reject/revoke events remove eligibility. Do not reuse Lite approval as Enhanced approval. | Missing case, unpaid-only case, incomplete requirements, non-approved case, or non-activated case => not enhanced verified. | Yes for the compliance projection; no replacement of the existing Solo Plus case lifecycle is proposed. | Yes. |
| Business KYB verification | Business compliance/KYB review owner. Final approval must cover business registration, business/address documents, owner/director authority and identity, payout setup, risk review, and approved volume before projecting `business_verified`. | Merchant KYB/status/step fields, `verification_logs`, registry snapshots, business affiliations, director invitations/verifications, document evidence, and final admin approval action. | Define the canonical Business case/decision projection, revocation/re-review rules, approved volume, risk outcome, and audit provenance. Legacy merchant status alone is insufficient. | Missing or incomplete evidence/review => not business verified (`null` or `business_pending`). | Yes. | Yes. |
| `setup_mode` / `live_features_enabled` | Merchant/workspace activation controls are operational kill switches and defense-in-depth inputs. Compliance activation owns any future transition: only after entitlement, compliance, risk, limits, flags, payout, and mapping all pass may an explicit atomic action set `setup_mode = false` and `live_features_enabled = true`. | Matching fields exist on `merchants` and `workspaces`. Legacy `setupStatusForMerchant`/`syncMerchantSetupStatus` derives them from a narrower verification model. | Specify merchant/workspace consistency, atomic transition/re-lock behavior, and remove capability approval inference from generic synchronization before runtime integration. Existing paid setup remains locked. | `setup_mode` missing is not cleared; only explicit `false` passes. `live_features_enabled` missing is not enabled; only explicit `true` passes. | No new columns expected; a later atomic transition/RPC may require a migration after design review. | Yes. |
| Facts that must never be inferred from payment alone | No payment component owns compliance or live capability. Payment owns only verified payment evidence and resulting commercial entitlement/case progression. | `payment_records`, `subscription_payments`, `subscriptions`, `workspace_subscriptions`, and paid-upgrade confirmation establish payment/entitlement state. | Enforce tests and transition rules proving payment cannot set compliance approval, activation approval, risk, restrictions, limits, product flags, payout verification, provider readiness, Lite/Enhanced/KYB approval, `setup_mode = false`, or `live_features_enabled = true`. | All non-entitlement values remain missing/locked. | No separate payment schema is requested here; compliance persistence and transition constraints are required later. | Yes. |

## Evidence-to-decision boundaries

### Commercial entitlement

The active subscription/workspace subscription is the entitlement source. `payment_records` and `subscription_payments` prove that a payment was handled; they do not independently prove which entitlement is current. The merchant plan columns are useful compatibility projections, but conflicting values must fail closed until reconciled by a trusted server process.

### Verification evidence

The following are evidence inputs, not direct capability flags:

- `merchants.verification_status`, BVN/selfie/CAC/utility/affiliation statuses, and `verification_step_state`;
- `verification_logs` and provider references;
- business registry snapshots, affiliations, director invitations, and director verification records;
- Solo Plus case requirements and events;
- settlement account and provider-mapping records.

An explicit compliance decision must consume these sources, record its policy version and provenance, and persist the resulting PRD status. Runtime code must read that decision rather than re-running an inconsistent subset of legacy requirements at each route.

### Limits and usage

`approved_monthly_volume`, cumulative cap, hidden daily velocity, and single-transaction limit are approved policy inputs. `cumulative_collection_used` is accounting-derived state. A future design must make collection authorization and usage reservation concurrency-safe so two simultaneous attempts cannot both spend the same remaining limit. This document does not choose an RPC/table implementation and does not authorize a migration.

### Feature access

Feature flags do not replace plan, compliance, risk, limit, or settlement gates. The effective flag is fail-closed and should require:

1. the plan includes the product;
2. the platform/environment rollout switch is explicitly enabled;
3. the merchant-specific compliance decision explicitly allows it; and
4. all resolver base gates pass.

Solo Lite can never receive Receivable Sale or Deposit & Balance. Solo Plus and Business eligibility remains denied until Enhanced/KYB approval and every other gate passes.

### Setup and live state

`setup_mode` and `live_features_enabled` are not compliance evidence. They are final operational locks. A future activation command must set merchant and workspace state consistently and must be able to re-lock them when restriction, suspension, expiry policy, risk, settlement readiness, or compliance status changes. Generic profile save, Record Invoice creation, plan payment, and evidence upload must never perform that transition.

## Missing persistence

PRD Phase 2 still needs an approved persistence design for:

- `merchant_compliance_profiles` (or an explicitly approved equivalent) with compliance, activation, risk, plan snapshot, reviewed limits, capability decisions, review dates, and audit provenance;
- an explicit current restriction/suspension state if it is not included in that profile;
- concurrency-safe cumulative collection usage and limit reservation/reconciliation semantics;
- capability-specific global and merchant feature flags;
- projections from Lite verification, Solo Plus Enhanced approval, and Business KYB approval into the compliance profile;
- auditable, atomic activation/restriction transitions that keep merchant/workspace operational locks consistent.

Existing subscription, verification evidence, Solo Plus case, settlement-account, and provider-mapping tables should be reused. They should not be duplicated merely to make the resolver easier to call.

## Runtime wiring decision

Runtime wiring is **not allowed yet**. The pure resolver and normalization contract are ready, but canonical persistence and loader semantics are incomplete. Wiring now would either deny every live merchant because inputs are absent or recreate unsafe approval inference from legacy plan/payment/status fields.

The next implementation must remain source-controlled and reviewed in this order:

1. agree the Phase 2 persistence/transition contract, including source precedence and audit fields;
2. prepare a narrow additive migration package with preflight, postflight, RLS/grants, and clean-production contract tests;
3. implement a trusted server-only repository/adapter that loads the authorized merchant/workspace and preserves missing values;
4. add shadow comparison/diagnostic tests without changing production decisions;
5. only after explicit approval, integrate the resolver edge-by-edge, keeping provider-specific validation and all current collection gates fail-closed.

Storefront Foundation remains PRD Phase 4 and must not begin until Phase 2 persistence, limit accounting, runtime context loading, restriction handling, and safe activation controls are complete.

## Files reviewed

- `docs/deraledger-smart-storefront-prd.md`
- `docs/phase-alignment-and-roadmap-rebaseline.md`
- `docs/prd-phase-2-runtime-gate-audit.md`
- `src/lib/compliance/merchant-capabilities.ts`
- `src/lib/compliance/runtime-capability-context.ts`
- `src/lib/plans.ts`
- `src/lib/data.ts`
- `src/lib/actions.ts`
- `src/lib/verification-requirements.ts`
- `src/lib/services/access-control.ts`
- `src/lib/services/onboarding-flow.service.ts`
- `src/lib/services/verification.service.ts`
- `src/lib/services/settlement-ledger.service.ts`
- `src/lib/services/payout-setup-refresh.service.ts`
- `src/lib/services/invoice-payment-safety.service.ts`
- `src/lib/solo-plus/state.ts`
- `src/lib/solo-plus/server/requirements.ts`
- `src/lib/solo-plus/server/review-service.ts`
- `src/lib/solo-plus/server/activation.ts`
- `src/lib/solo-plus/server/supabase-repository.ts`

## Safety checkpoint

- No runtime code is changed by this document.
- No migration or production SQL is created or run.
- No payment/provider configuration is changed.
- No payment test or collection checkout test is authorized.
- Existing `setup_mode = true`, `live_features_enabled = false`, and unverified compliance state remain unchanged.
- Record Invoice remains offline/manual and independent of checkout.
- Storefront work has not started.
