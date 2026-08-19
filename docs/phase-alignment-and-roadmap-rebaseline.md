# Phase Alignment and Roadmap Rebaseline

## Authority

The phase numbering in `docs/deraledger-smart-storefront-prd.md` is the authoritative roadmap for future DeraLedger work.

The existing `docs/phase 2 full implementation plan.md` and Solo Plus Phase 2 roadmap/closeout documents remain valid implementation records. Their use of "Phase 2" is historical stream naming, not the controlling PRD phase number.

When the documents conflict on phase labels, use this order:

1. Smart Storefront PRD phase number and acceptance criteria.
2. Coding Agent Build Contract phase gates.
3. Phase-specific implementation plans for technical detail within the matching PRD phase.
4. Historical roadmap, closeout, and staging documents as evidence of completed work.

## Canonical PRD Phases

| PRD phase | Canonical name | Primary outcome |
| --- | --- | --- |
| Phase 2 | Compliance and Limit Engine | Plan-neutral compliance profiles, risk/activation state, collection limits, and `resolveMerchantCapabilities` |
| Phase 3 | Solo Plus Onboarding and Enhanced Verification | Solo Plus onboarding/upgrade, payment-without-activation, Enhanced KYC, manual review, and atomic approval |
| Phase 4 | Storefront Foundation | Store identity, slug, settings, products, rules, pickup/delivery notice, and preview with no unapproved live payment |

## Historical Solo Plus "Phase 2" Mapping

The lifecycle described by `docs/phase 2 full implementation plan.md` maps to **PRD Phase 3: Solo Plus Onboarding and Enhanced Verification**.

This includes its Solo Plus:

- case schema and lifecycle state machine;
- evidence reuse and six-requirement orchestration;
- onboarding and Solo Lite-to-Solo Plus upgrade cases;
- platform plan-payment linkage and replay protection;
- `payment confirmed -> verification_pending` transition;
- admin review, rejection, reopening, and refund review;
- atomic approval and activation;
- authenticated routes, status UI, and controlled rollout work.

The historical filenames and commit references should not be renamed. New reports should refer to this work as the **Solo Plus implementation stream (PRD Phase 3)** and may include the historical label in parentheses for traceability.

The Solo Plus stream consumes PRD Phase 2 capability decisions but does not replace the plan-neutral compliance engine.

## Existing Work That Remains Valid

The reclassification does not invalidate completed work. The following remains valid subject to its existing audit and rollout status:

- Phase 1 plan compatibility: Starter, Solo Lite/legacy `individual`, Solo Plus, and Business/legacy `corporate`.
- Solo Plus case, requirement, event, evidence-reuse, repository, access, review, activation, route, UI, and recovery foundations.
- Canonical pending payment-record linkage before provider initialization.
- Payment confirmation moving a Solo Plus case only to `verification_pending`.
- Payment success never activating Solo Plus, clearing setup mode, or enabling capabilities.
- Existing Solo Lite access remaining unchanged while an upgrade case is pending.
- Manual review and an explicit atomic approval service as the only Solo Plus activation path.
- Replay/idempotency protections and manual refund review for rejected paid cases.
- Isolation between merchant customer collections and DeraLedger platform-settled subscription/upgrade payments, including Breet purpose isolation.
- Protection of existing Record Invoice, Collection Invoice, checkout, provider, webhook, settlement, and renewal behavior.

Historical status statements must still be read at their recorded scope. A staging runbook or migration closeout is not, by itself, a full PRD Phase 3 production exit report.

## Missing PRD Phase 2 Work

PRD Phase 2 is not complete until the following plan-neutral capabilities exist and pass their acceptance gates:

- a canonical `merchant_compliance_profiles` persistence model or an explicitly approved equivalent;
- normalized `business_type` handling;
- canonical `compliance_status`, `activation_status`, and `risk_rating` handling;
- approved monthly volume and collection-limit profiles;
- cumulative collection cap and usage tracking;
- hidden daily velocity and single-transaction controls;
- outstanding receivable limits where required by the PRD;
- one fail-closed `resolveMerchantCapabilities` contract;
- trusted repository/adaptor wiring from authenticated merchant context into that resolver;
- plan-specific enforcement for Starter, Solo Lite, Solo Plus, and Business;
- tests proving payment alone cannot unlock collection;
- tests proving Starter cannot collect, Solo Lite cannot use Receivable Sale, Solo Plus requires Enhanced approval, and Business requires KYB approval;
- limit-exhaustion, restriction, suspension, missing-input, feature-flag, and settlement-readiness tests;
- a Phase 2 traceability report, manual QA evidence, independent audit, and explicit approval before Phase 4 begins.

Recommended cap values in the PRD remain proposals until explicitly approved by the product owner.

## Why `resolveMerchantCapabilities` Is PRD Phase 2

The resolver determines access from commercial plan, compliance, activation, risk, limits, feature flags, setup/live state, restrictions, and verified settlement readiness. These are the defining inputs and acceptance criteria of the PRD Compliance and Limit Engine.

Solo Plus services should supply Enhanced-verification outcomes to this resolver. They should not maintain a second, Solo-Plus-only permission system. Likewise, payment, UI, provider metadata, or a plan label must never independently grant live access.

The resolver must be pure and fail closed first. Runtime integration, persistence, and route adoption should follow in separately approved commits.

## Why Storefront Foundation Must Wait

Storefront preview and configuration depend on a stable answer to which merchant may publish or collect. Starting PRD Phase 4 before PRD Phase 2 is accepted would risk:

- Starter or paid-setup merchants reaching live checkout;
- payment being mistaken for verification approval;
- Solo Lite reaching Receivable Sale or Deposit & Balance;
- Solo Plus reaching receivables before Enhanced approval;
- Business collecting before KYB approval;
- collection without verified merchant settlement mapping;
- duplicated plan and compliance checks across storefront routes.

No live storefront, Instant Sale, Receivable Sale, or storefront payment integration may begin until the Phase 2 resolver and gates are approved. Phase 4 foundation must initially remain feature-flagged and non-payment/preview-only.

## Future Commit Labels

Use PRD-aligned labels from this point forward:

- **PRD Phase 2A — Capability contract:** pure types, normalized plan aliases, fail-closed resolver, and unit tests.
- **PRD Phase 2B — Compliance persistence:** additive profile schema, RLS/security manifest, repository adapter, and migration evidence after separate approval.
- **PRD Phase 2C — Limit and risk enforcement:** approved volumes, cumulative usage, velocity/single-transaction controls, restriction handling, and tests.
- **PRD Phase 2D — Runtime integration and exit:** trusted merchant resolution, existing access-control integration, regression QA, traceability, audit, and phase approval.
- **Solo Plus implementation stream (PRD Phase 3):** continue Enhanced KYC, review, activation, recovery, and controlled-launch work under this label.
- **Storefront Foundation (PRD Phase 4):** start only after explicit PRD Phase 2 exit approval; do not pull Instant Sale or Receivable Sale forward.

Each commit must remain narrow. Do not combine compliance persistence, runtime integration, provider changes, or storefront work into the pure resolver commit.

## Current Production Safety Checkpoint

- Starter core flow works.
- The first controlled Solo Lite NGN 5,000 platform subscription payment passed.
- The merchant remains in paid setup.
- `setup_mode=true`.
- `live_features_enabled=false`.
- Customer collection remains disabled.
- Payment success did not complete verification or unlock collection.
- No further payment test is approved.
- No live storefront checkout is approved.
- No production database, environment, credential, or provider change is authorized by this rebaseline.

## Next Safe Commit

Immediately after this documentation-only rebaseline:

```text
feat(compliance): add fail-closed merchant capability resolver
```

This is **PRD Phase 2A**. It should add only the pure resolver, types/contracts, normalized legacy plan handling, and focused tests. It must not add a migration, wire production routes, change payment behavior, enable live features, or begin storefront implementation.
