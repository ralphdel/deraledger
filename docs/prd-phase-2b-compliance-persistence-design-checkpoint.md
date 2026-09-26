# PRD Phase 2B-0 Compliance Persistence Design Checkpoint

**Date:** 2026-09-26  
**Status:** DESIGN REVIEW ONLY — no database execution approved  
**Authoritative gate:** PRD Phase 2B — Compliance Persistence

## 1. Purpose and boundary

Phase 2B designs the canonical, plan-neutral, fail-closed persistence needed to supply facts to the already committed pure `resolveMerchantCapabilities` contract. It is additive: it does not reinterpret payments, legacy verification evidence, or UI state as a live capability decision.

This checkpoint approves neither a migration nor runtime use of the proposed data. A missing, conflicting, malformed, ambiguous, stale, or query-error source must produce absent resolver input and deny live capability.

## 2. Resolver facts that need canonical persistence

| Capability fact | Resolver input / decision role | Fail-closed rule |
| --- | --- | --- |
| Plan identity | Normalized commercial plan (`starter`, `solo_lite`, `solo_plus`, `business`) | Missing, unknown, or conflicting plan denies live capability. Aliases are normalized at the contract boundary, never stored as entitlement facts. |
| Entitlement status | Active commercial entitlement state | Paid evidence alone is insufficient; inactive, expired, cancelled, missing, or conflicting entitlement denies. |
| Compliance and verification | Compliance status plus final Lite/Enhanced/KYB verification decision | Pending, rejected, restricted, unverified, or missing decision denies. |
| Approval and activation | Reviewed approval state and final operational activation state | No implicit approval or activation from payment, plan, onboarding, or legacy verification fields. |
| Risk and restriction | Risk rating, current restriction state, reason, and review dates | Missing risk or restriction state is not permissive; restricted/suspended denies. |
| Setup and live locks | Merchant/workspace `setup_mode` and `live_features_enabled` agreement | Only explicit unlocked/enabled values can pass a later runtime gate. |
| Settlement readiness | Verified selected payout account and matching provider/environment mapping | Missing, ambiguous, stale, inactive, or mismatched records deny settlement-dependent capability. |
| Feature entitlement | Explicit merchant booleans plus separately approved global rollout flags | Missing object/value or explicit `false` denies. Payment/provider route flags are not product entitlement. |
| Approved limits and remaining capacity | Policy limit, approved basis, approval provenance, and later authoritative usage/reservation state | Null is never unlimited. A profile display/reconciliation value is not an authorization counter. |

## 3. Canonical profile design

The preferred canonical projection is the already source-defined `public.merchant_compliance_profiles` manifest in `supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql` and `docs/prd-phase-2-persistence-decision-record.md`. This is a design/source target only; this checkpoint does **not** assert that the table is applied, populated, or authoritative in any environment.

One profile is intended per merchant (`merchant_id` unique, restricted-delete FK). Its status and entitlement defaults are deliberately non-permissive.

| Field group | Proposed columns/types | Null/default posture and Phase 2B meaning |
| --- | --- | --- |
| Identity and commercial snapshot | `id uuid`; `merchant_id uuid`; `plan_code text` | `merchant_id` and normalized `plan_code` are non-null; plan snapshot does not replace the current subscription entitlement source. |
| Classification and decision state | `business_type text`; `compliance_status text default 'draft'`; `activation_status text default 'test_mode'`; `risk_rating text`; `restriction_state text`; restriction reason/timestamps | Unknown business/risk/restriction values remain null; `draft` and `test_mode` do not unlock. `restriction_state` must never default to `active`. |
| Reviewed limits | `collection_limit_basis text`; approved monthly/cumulative/velocity/single-transaction/receivable `numeric(18,2)` fields; `collection_limit_approved boolean default false`; approval timestamp/actor | Numeric values are nullable; a number is not an approval. Limits require explicit basis and approval provenance. `cumulative_collection_used` is reconciliation/display state, not later authorization authority. |
| Merchant capability decision | `can_collect_payments`, `can_use_instant_sale`, `can_use_receivable_sale`, `can_use_storefront`, `can_activate_settlement`, `can_use_deposit_balance` booleans | All non-null with default `false`. Plan constraints prevent Starter/Solo Lite receivable/deposit entitlement; dependent capability checks remain explicit. |
| Audit/provenance | `policy_version`, decision source type/id/version, review timestamps/actor, `row_version bigint default 1`, timestamps | Nullable while draft where specified; provenance must be sufficient for a later reviewed projection and optimistic concurrency. Internal restriction notes must never be browser-exposed. |

**Required now in the future schema package:** the row identity, normalized plan snapshot, classification/decision state, false-by-default merchant entitlement booleans, reviewed-limit metadata, provenance, audit timestamps, unique merchant constraint, validation checks, and RLS/grant manifest.

**Required later before live enforcement:** exact transition commands, reviewed profile creation/backfill rules, global flag contract, trusted usage/reservation accounting, freshness policy, provider/payout selection policy, and an atomic activation/restriction design. No `activation_status` value represents merchant activation in this checkpoint.

## 4. Existing-source mapping

| Fact | Source status | Existing source / proposed owner | Design conclusion |
| --- | --- | --- | --- |
| Plan aliases | Existing authoritative source | `src/lib/plans.ts` | Normalize `individual` to `solo_lite` and `corporate` to `business`; persist canonical codes only. |
| Current commercial entitlement | Existing partial source | `subscriptions` and `workspace_subscriptions`; merchant/workspace plan columns are compatibility projections | A later trusted server adapter must reconcile exact active entitlement; payments are evidence, not authority. |
| Compliance, approval, risk, restriction, merchant feature decision | Proposed new canonical field | `merchant_compliance_profiles` source manifest | Legacy verification fields, Solo Plus cases, and KYB evidence inform a reviewed projection only; none directly unlocks. |
| Lite, Enhanced, and KYB verification evidence | Existing partial source | Verification steps/logs, Solo Plus cases/requirements/events, merchant/KYB evidence | Preserve evidence domains; add an explicit, auditable projection to profile status later. |
| Setup/live operational locks | Existing partial source | `merchants` and `workspaces` | They are final operational locks, not compliance evidence; later adapter requires exact agreement. |
| Global rollout flags | Existing partial source | Service-role-controlled `platform_settings` | Resolver-specific global keys and precedence are still missing/require approval. |
| Merchant feature eligibility | Proposed new canonical field | False-by-default profile entitlement booleans | Payment/provider flags may not substitute for these product decisions. |
| Payout verification | Existing authoritative source domain | `merchant_settlement_accounts` | A later adapter needs deterministic selected-account, freshness, and conflict rules. |
| Provider settlement mapping | Existing authoritative source domain | `merchant_provider_settlement_accounts` | A later adapter needs exact provider/environment selection; no provider call in the resolver loader. |
| Approved limits and remaining capacity | Missing source for authorization accounting | Profile policy fields plus future windows/reservations/usage events | Future Phase 2C must define atomic usage/reservation semantics; do not authorize from a profile counter. |

## 5. Security and RLS design

- Base compliance tables are service-only: RLS enabled, zero browser policies, no `PUBLIC`, `anon`, or `authenticated` grants, and least-privilege service-role grants verified in the future security manifest.
- Browser/client code receives neither a generic database client nor service-role credentials. Any future repository lives in a server-only module.
- Admin/compliance actors do not receive direct base-table browser access. A later separately approved server command/RPC must authenticate the actor, enforce role and merchant scope, validate transition provenance, and record audit data.
- Merchant-facing UI, if ever approved, consumes a deliberately safe derived projection, not profile rows, notes, evidence snapshots, or service diagnostics.
- Missing, duplicate, malformed, stale, conflicting, or inaccessible profile data is a resolver denial. No legacy fallback may infer approval.

## 6. Proposed repository adapter contract

No adapter is implemented or authorized in Phase 2B-0. A later source-only design may expose a read-only server-side contract shaped as follows:

```ts
type MerchantComplianceProfileRead =
  | { kind: "found"; profile: Readonly<MerchantComplianceProfile> }
  | { kind: "missing" }
  | { kind: "ambiguous" }
  | { kind: "malformed" }
  | { kind: "stale" }
  | { kind: "query_error" };

interface MerchantComplianceProfileRepository {
  readForTrustedMerchant(input: Readonly<{ merchantId: string }>): Promise<MerchantComplianceProfileRead>;
}
```

The adapter must start with trusted authenticated merchant/workspace resolution, preserve source-status detail internally, map every non-`found` result to missing/false resolver inputs, perform no mutation, accept no browser-supplied authority, and make no provider calls. Runtime adoption, routes, UI, and shadow mode are separate reviewed gates.

## 7. Future migration package — plan only

Any future migration requires a separate approval before SQL is written or executed. The package must be additive and forward-only, and should include the profile plus its required review/event and limit-accounting support only when each component has an approved ownership/transition contract.

The future package must define and test:

1. exact schema manifest: types, nullability, false/test defaults, checks, unique/FK/indexes, and no permissive backfill;
2. RLS/grant manifest: RLS enabled, zero browser policies, revocation of broad grants, and explicit service-only permissions;
3. clean-production and hostile/default-grant preflight, with no assumptions that a source migration was applied;
4. local disposable rehearsal, then staging preflight/apply/postflight and behavior evidence, followed by a separately approved production sequence;
5. stop-on-FAIL/BLOCKED evidence, compact redaction, and a separately reviewed rollback/disable posture.

No migration, SQL, database inspection, or database execution is created by this checkpoint.

## 8. Product-owner decisions required before implementation

1. Confirm or amend the `business_type`, compliance, activation, risk, restriction, limit-basis, and decision-source enumerations in the existing manifest.
2. Define which reviewed state combinations may set each merchant capability boolean; payment alone must remain insufficient.
3. Define plan-specific limit fields, units/currency, cap resets, approved-volume interpretation, remaining-capacity calculation, and whether limits vary by risk/business type.
4. Define restriction/suspension/re-review/revocation transitions, freshness periods, and the conditions that re-lock merchant/workspace operational state.
5. Define Lite, Solo Plus Enhanced, and Business KYB projection ownership, evidence minimums, reviewer authority, provenance, idempotency, and correction/reopen behavior.
6. Define exact global rollout keys, environment scope, and precedence with merchant entitlements.
7. Define selected payout-account/provider-mapping conflict and freshness policy, without calling providers from capability resolution.

## 9. Explicit out-of-scope confirmation

- No SQL or migration was created, changed, run, or applied.
- No database, environment, Vercel setting, deployment, runtime adapter, route, or UI was changed.
- No capability was unlocked; the resolver remains contract-only and fail-closed.
- No M030/live readiness, approval execution, merchant activation, collection unlock, payment/provider/checkout/subscription/invoice/storefront behavior occurred.

## Sources reviewed

- `docs/deraledger-smart-storefront-prd.md` — PRD Phase 2 compliance and capability requirements.
- `docs/phase-alignment-and-roadmap-rebaseline.md` — authoritative Phase 2A/2B/2C/2D sequence.
- `docs/prd-phase-2a-capability-contract-source-checkpoint.md` — completed pure-contract boundary.
- `docs/phase-2-compliance-admin-readiness-gate-closure.md` — closed, separate readiness-security gate.
- `docs/phase 2 full implementation plan.md` — historical Solo Plus stream, not the canonical Phase 2 sequence.
- `src/lib/compliance/merchant-capabilities.ts` and `src/lib/plans.ts` — current resolver inputs and plan normalization.
- `docs/prd-phase-2-compliance-source-ownership.md`, `docs/prd-phase-2-persistence-decision-record.md`, and `docs/prd-phase-2-trusted-runtime-loader-design.md` — source ownership, source manifest, and later loader boundary.
- `supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql` — source-defined schema manifest only; not executed by this task.
