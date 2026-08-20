# PRD Phase 2 trusted runtime capability loader design

Status: approved design only. This document does not authorize a loader implementation, resolver wiring, a migration, an RPC, profile creation, backfill, payment test, collection test, or storefront work.

## 1. Purpose and current safety boundary

The future loader assembles `TrustedRuntimeCapabilityContext`, then converts it with `toResolveMerchantCapabilitiesInput`. It is a server-only read adapter; it does not decide compliance, activate a merchant, contact a provider, reserve a limit, or mutate any data.

At this checkpoint, every `merchant_compliance_profiles` row is absent. Therefore the future loader would return an incomplete, fail-closed context for every production merchant. No current route may use it for enforcement or to relax an existing gate.

The current production locks remain authoritative operational controls:

- `setup_mode = true`;
- `live_features_enabled = false`;
- `verification_status = unverified`;
- customer collection, checkout, payment links, and storefront checkout remain locked.

## 2. Proposed server-only boundary

The future module should be named `src/lib/compliance/server/trusted-runtime-capability-loader.ts` and begin with `import "server-only"`.

Its public shape should accept only a trusted request context, not browser business data:

```ts
type LoadTrustedRuntimeCapabilityContextInput = {
  authenticatedUserId: string; // derived only from server auth.getUser()
  requestedWorkspaceId?: string | null; // an untrusted selector, never authority
  requestedCapability?: "collection_invoice" | "checkout" | "storefront" | "instant_sale" | "receivable_sale" | "deposit_balance";
  paymentEnvironment: "sandbox" | "live"; // trusted server configuration/route result
  provider?: "paystack" | "monnify" | "breet" | null; // trusted server route result
};
```

The request wrapper authenticates with the server Supabase client using `auth.getUser()`. It must never use `getSession().user`, browser session metadata, form values, URL merchant IDs, workspace cookies, plan labels, provider metadata, payment metadata, or auth user metadata as authority.

`resolveMerchantContextForUser` in `src/lib/merchant-context.ts` is the current reusable owner/team-membership resolution concept. The loader must retain its fail-closed outcomes (`unauthenticated`, ambiguous membership, membership query failure, merchant read failure, and no merchant) instead of substituting a demo, cookie, or first arbitrary merchant. A requested workspace is only a candidate: it must be proved to belong to the resolved merchant and be authorized for the resolved owner/team member.

Super-admin and sandbox identities are not normal merchant entitlement inputs. A separately audited internal diagnostic mode may observe a context, but must not turn sandbox/admin state into an entitlement or a live-capability bypass.

## 3. Query sequence and source precedence

The eventual loader should use a service-role read client only after the server-authenticated actor and merchant/workspace authorization have been established. It must return a typed outcome such as `resolved`, `denied`, or `source_error`; it must not throw raw provider/database errors into browser responses.

| Order | Input | Canonical source | Rule |
|---|---|---|---|
| 1 | User, merchant, role, workspace | server `auth.getUser()`, `merchants`, `merchant_team`, `roles`, `workspaces` | Resolve exactly one authorized merchant/workspace pair. Ambiguity or query error denies. |
| 2 | Commercial entitlement | `subscriptions`, `workspace_subscriptions`, then matching merchant/workspace plan projections | Subscription/workspace rows are authority; a merchant plan is a compatibility projection only. |
| 3 | Compliance decision and merchant entitlements | `merchant_compliance_profiles` | Exactly zero or one profile per merchant. Its reviewed status/limits/entitlements are authoritative only after later reviewed profile creation. |
| 4 | Global rollout flags | service-controlled `platform_settings` | Explicit known keys only; any missing/invalid key is false/unknown. |
| 5 | Limits and current usage | `merchant_collection_limit_windows`, reservations, reservation-window links, usage events | Window rows are operational authority; events are reconciliation/accounting authority. No reservation occurs in the loader. |
| 6 | Payout account | `merchant_settlement_accounts` | Require exactly one selected default, active, verified account owned by the merchant. |
| 7 | Provider mapping | `merchant_provider_settlement_accounts` plus trusted selected provider/environment | Require an exact mapping for the selected account, provider, and environment. |
| 8 | Operational locks | `merchants` and `workspaces` | Both projections must explicitly agree on setup/live state before a future live capability can pass. |
| 9 | Evidence provenance | existing verification, Solo Plus, and Business evidence sources | Evidence is diagnostic/reviewer input only; it does not replace the profile decision. |

All source reads must be scoped by the resolved `merchant_id`; every workspace read must also be scoped by its resolved `workspace_id` and merchant relationship. Service role is not permission to accept caller-selected IDs.

## 4. Commercial entitlement algorithm

The loader writes all of these fields into the context:

- `rawCommercialPlan`: normalized merchant compatibility projection;
- `rawActiveEntitlementPlan`: plan from the one trusted active subscription/workspace entitlement pair;
- `commercialEntitlementState`;
- `commercialPlan`: only the usable normalized plan, otherwise `null`.

`individual` normalizes to `solo_lite`; `corporate` normalizes to `business` through `src/lib/plans.ts`. Unknown labels remain unknown; they must never become Starter through `normalizePlanCode`'s compatibility fallback.

| State | Required evidence | Context plan result |
|---|---|---|
| `starter_free` | Resolved merchant/workspace projections are Starter, with no contradictory current paid entitlement. | `starter` |
| `active_paid` | Exactly one in-date active subscription and exactly one matching active workspace subscription; both normalize to the same paid plan; matching merchant/workspace plan projections. | Matching paid plan only |
| `grace_read_only` | A future explicit, reviewed grace policy/status. The current schema has no approved generic grace source. | `null` |
| `inactive` | Known entitlement exists but is not active, including current paid-setup/pending states that have not been approved as active. | `null` |
| `expired` | Trusted entitlement expiry is at or before the server clock, absent a separately approved explicit grace rule. | `null` |
| `cancelled` | A trusted subscription/workspace entitlement is cancelled. | `null` |
| `missing` | No complete entitlement evidence, unknown status, missing required projection, or an authoritative read has no row. | `null` |
| `conflicting` | Multiple candidate current rows, duplicate active rows, mismatched plans/statuses, merchant/workspace disagreement, or incompatible active sources. | `null` |

The active entitlement query must be deterministic and detect multiple rows; `order(...).limit(1)` is insufficient for capability authority. Any active Subscription paired with a `workspace_subscriptions.subscription_status = paid_setup` is not `active_paid`: paid setup is commercial evidence only and remains non-live until an explicit later activation path exists.

The loader must not derive a plan from `payment_records`, `subscription_payments`, `onboarding_sessions`, provider callback metadata, or `auth.users` metadata. Those are evidence/progression inputs, not a current entitlement authority. A pending Solo Plus case leaves the current active Solo Lite entitlement unchanged; the Solo Plus target is not a usable plan until its future approved activation projection is atomic and complete.

## 5. Compliance profile, limits, and merchant entitlements

The loader reads the unique `merchant_compliance_profiles` row by `merchant_id` using a server-only service-role client.

- No row produces `complianceStatus`, `activationStatus`, risk/restriction states, limits, and `merchantEntitlements` as `null`; it never invents approval from legacy `verification_status`, plan, or payment.
- More than one row, a query error, malformed enum/value, stale decision source, or a profile whose `plan_code` conflicts with the usable commercial plan produces a fail-closed source error or `conflicting` entitlement outcome.
- The profile maps one-to-one to `MerchantCapabilityEntitlements`: `can_collect_payments`, `can_use_instant_sale`, `can_use_receivable_sale`, `can_use_storefront`, `can_activate_settlement`, and `can_use_deposit_balance`.
- Missing profile, missing entitlement object, or any missing/false entitlement flag denies the corresponding live capability. Merchant flags cannot override plan exclusions: Starter and Solo Lite never receive Receivable Sale or Deposit & Balance.

For a future collection request, the loader selects only the applicable approved operational window(s), scoped to merchant/profile, active policy version, and the server time. It must validate the `Africa/Lagos` policy zone and half-open window interval. A generic display/preview read may expose no effective collection limit; it must not construct one from profile amounts alone.

The resolver's `collectionLimit` is populated only where a later approved policy defines a complete authorization summary. It must be derived from locked current window values (`limit_amount`, committed and reserved amount as appropriate), not from `cumulative_collection_used` on the profile. The loader performs no locking, reservation, commit, release, or usage-event write. Those require a separately reviewed transactional service.

## 6. Global flags and settlement readiness

Global rollout keys are independent service-controlled `platform_settings` values. The future implementation must define and load all five exact keys in one allowlisted query:

- `storefront_enabled`;
- `instant_sale_enabled`;
- `receivable_sale_enabled`;
- `merchant_confirmation_before_deposit_enabled`;
- `customer_registration_required_for_receivables`.

Until those keys and their ownership are separately approved, each resolver flag is `null`/false. Existing Solo Plus availability flags are not substitutes for these product rollout flags. Global flags never grant access without a matching plan, active entitlement, reviewed merchant entitlement, profile, risk, limits, operational locks, payout account, and provider mapping.

Payout readiness is true only for one merchant-owned, active, default `merchant_settlement_accounts` record whose `verification_status = verified`. Multiple defaults, active account ambiguity, wrong currency, stale/revoked status, or a query failure yields false/unknown.

Provider settlement readiness is separate. It requires a selected collection provider and environment from trusted server routing, then exactly one matching `merchant_provider_settlement_accounts` mapping for that selected account/provider/environment, a connected/active mapping status, and the real provider-specific settlement identifier required by that provider. `src/lib/services/invoice-payment-safety.service.ts` illustrates the existing separation of account verification from mapping/provider/environment checks. No provider API call occurs while loading context.

Payout readiness alone is never provider readiness. A settlement mapping for Paystack cannot satisfy Monnify or Breet; a sandbox mapping cannot satisfy live. Monnify additionally requires its real subaccount/income-split configuration; Breet requires its validated provider-specific mapping; neither may be inferred from legacy merchant fields.

## 7. Merchant/workspace locks and evidence boundaries

The loader reads `setup_mode` and `live_features_enabled` from both merchant and workspace. A future live-capability input may use `setupMode = false` only when both values are explicitly false; it may use `liveFeaturesEnabled = true` only when both values are explicitly true. Missing, disagreement, or query error remains fail-closed. The loader never calls `setupStatusForMerchant`, `syncMerchantSetupStatus`, or any generic synchronization helper.

Evidence boundaries remain strict:

- Solo Lite: existing BVN/selfie/payout/profile evidence and logs support a later `solo_lite` review. Only the reviewed profile may supply `lite_verified`.
- Solo Plus: `solo_plus_cases`, requirements, events, and the existing atomic case lifecycle remain the Enhanced evidence authority. A paid/pending case is not Enhanced approval and does not change the commercial plan.
- Business: KYB documents, affiliations, director evidence, verification logs, and reviewed risk/volume evidence support a later `business_kyb` review. Merchant legacy verification fields, CAC success, or a plan label do not supply `business_verified`.

Payment can provide entitlement evidence only. It must never create profile approval, activation approval, risk rating, restriction state, limit approval, merchant entitlement, payout verification, provider readiness, or an operational unlock.

## 8. Error, stale-data, and diagnostics policy

Every source result must carry an internal status: `resolved`, `missing`, `ambiguous`, `conflicting`, `stale`, `malformed`, or `query_error`. For capability output, every non-`resolved` condition becomes `null`/false and a stable blocking reason. It must not fall back to an older row, client metadata, a broad merchant plan, or a provider response.

Freshness rules are not yet approved for profiles, payout verification, mappings, risk, or limits. Until policy-defined freshness exists, data that needs freshness validation is treated as not ready. The implementation must make source timestamps and policy-version compatibility explicit rather than silently accepting stale records.

Diagnostics must be structured server logs/metrics only. Emit a request correlation ID, hashed merchant/workspace IDs, route/capability name, source status codes, entitlement state, normalized plan class, and blocking-reason codes. Never log raw BVN/NIN, account numbers, selfie/document URLs, raw provider payloads, risk notes, restriction notes, or service credentials. Browser responses receive only stable safe error categories.

## 9. Shadow mode and later route adoption

Before enforcement, the loader runs in shadow mode from a server-only observation point after the existing gate decision. It must not change a response, redirect, checkout initialization, provider selection, database write, or merchant/workspace state.

Shadow metrics compare existing gate result with resolver result by safe reason codes: `agree_allow`, `existing_allow_resolver_deny`, `existing_deny_resolver_allow`, `source_incomplete`, and `source_error`. Any resolver allow during the empty-profile period is a defect. Require reviewed samples for Starter, paid setup, verified Lite, pending/approved Solo Plus, Business, expired/cancelled/conflicting subscription, payout/mapping mismatches, and team members before enforcement approval.

Later adoption order, each as a separately approved commit:

1. server-only shadow loader with no route behavior change;
2. diagnostics/status projection only;
3. collection invoice and fiat checkout preflight, retaining all existing provider gates as final checks;
4. payment-link initialization and provider-specific customer collection paths;
5. Instant Sale/Receivable Sale only after limits/reservation transitions and reviewed profiles exist;
6. storefront live checkout only after all prior gates, products/orders, and direct-settlement contracts are separately approved.

Record Invoice is excluded from this adoption sequence. It remains offline/manual and must not invoke the loader to initialize checkout or mutate setup/live state.

## 10. Required tests before implementation

The implementation proposal must include unit, adapter-contract, and integration tests covering:

- `auth.getUser()` identity, owner/team membership, requested workspace validation, and ambiguous/missing context;
- each commercial entitlement state, expiry boundary using a controlled clock, duplicate active rows, plan aliases, projection mismatch, paid setup, cancelled, and conflicting rows;
- zero/one/multiple compliance profiles, invalid values, stale/unknown decision source, and exact profile-to-entitlement mapping;
- missing/false merchant entitlements and missing/false global flags independently and together;
- Starter, Solo Lite, Solo Plus, and Business plan/compliance/entitlement matrix;
- limits with missing/duplicate/expired/mismatched windows and no mutation during a loader call;
- verified payout account with missing, wrong-provider, wrong-environment, stale, or incomplete settlement mapping;
- merchant/workspace lock disagreements and no calls to synchronization helpers;
- query-error behavior for every source; no browser input or provider metadata can influence authority;
- shadow-mode observation with zero changed route behavior and redacted diagnostics;
- regression that Record Invoice remains side-effect-free and all existing collection/provider checks remain final deny gates.

## 11. Explicitly blocked until reviewed profiles exist

Until a reviewed process creates valid compliance profiles and approved limits, the loader must yield incomplete context. The following remain blocked regardless of paid subscription evidence:

- Collection Invoice activation, checkout initialization, payment links, and customer invoice collection;
- live storefront, Instant Sale, Receivable Sale, Deposit & Balance, and customer receivable flows;
- settlement activation and live provider routing;
- any mutation of `setup_mode`, `live_features_enabled`, or verification/KYC/KYB state.

Starter and paid merchants may retain existing offline Record Invoice behavior subject to current RBAC. This document makes no production behavior change.

## 12. Files reviewed

- `docs/deraledger-smart-storefront-prd.md`
- `docs/phase-alignment-and-roadmap-rebaseline.md`
- `docs/prd-phase-2-runtime-gate-audit.md`
- `docs/prd-phase-2-compliance-source-ownership.md`
- `docs/prd-phase-2-persistence-transition-contract.md`
- `docs/prd-phase-2-persistence-decision-record.md`
- `src/lib/compliance/merchant-capabilities.ts`
- `src/lib/compliance/runtime-capability-context.ts`
- `src/lib/plans.ts`
- `src/lib/data.ts`
- `src/lib/merchant-context.ts`
- `src/lib/services/access-control.ts`
- `src/lib/services/onboarding-flow.service.ts`
- `src/lib/services/invoice-payment-safety.service.ts`
- `src/lib/services/settlement-ledger.service.ts`
- `src/lib/services/payout-setup-refresh.service.ts`
- `src/lib/services/payment-routing.service.ts`
- `src/lib/services/verification.service.ts`
- `src/lib/solo-plus/server/access-context.ts`
- `src/lib/solo-plus/server/supabase-repository.ts`
- `src/lib/solo-plus/server/activation.ts`
