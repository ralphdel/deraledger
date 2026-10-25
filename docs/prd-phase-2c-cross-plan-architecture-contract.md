# Phase 2C-0 Cross-Plan Architecture Contract

## 1. Status and authority

This document is the architecture contract for Phase 2C-0. It freezes the cross-plan boundaries that can be decided from the approved product documents, current source, and the completed cross-plan audit. It does not approve runtime adoption, a database migration, a data backfill, a limit value, a KYC/KYB rule, or a commercial-policy change.

The controlling inputs are:

1. `docs/deraledger-smart-storefront-prd.md`;
2. `docs/phase-alignment-and-roadmap-rebaseline.md`;
3. `docs/phase 2 full implementation plan.md`, as the historical Solo Plus implementation record; and
4. the completed Phase 2C cross-plan architecture and implementation gap audit.

The Smart Storefront PRD controls product intent and PRD phase naming. The historical Phase 2 plan remains authoritative for the accepted Solo Plus implementation stream where it does not conflict with later accepted behavior. In particular, the accepted Phase 2A/2B Solo Plus lifecycle separates review approval from activation; stale historical wording that combined approval and activation does not reopen that decision.

The terms below are used deliberately:

- **Frozen**: implementation must preserve this rule unless Product, Compliance, and Engineering approve a replacement contract.
- **Source-proven**: current repository behavior or a confirmed implementation defect.
- **Unresolved**: no implementation may guess the policy; only work independent of the decision may proceed.
- **Recommended boundary**: an architecture constraint derived from the authoritative inputs and accepted here as part of this contract.

## 2. Architecture decision record

| ID | Frozen decision | Consequence |
| --- | --- | --- |
| 2C0-01 | Commercial entitlement, compliance assurance, and operational activation are independent state dimensions. | No payment, plan label, compliance result, setup flag, or live flag may substitute for the other dimensions. |
| 2C0-02 | Payment may establish or renew commercial entitlement or advance a plan-specific case. It never establishes compliance approval or live readiness by itself. | Payment callbacks and purchase flows cannot set verified compliance, approved risk/limits, or enable live financial capabilities. |
| 2C0-03 | Compliance approval records reviewed assurance only. | Approval does not activate collection unless a separately approved activation transition atomically establishes every operational prerequisite. |
| 2C0-04 | Solo Plus remains a plan-owned case domain. | `solo_plus_cases`, its six controlled-launch requirements, payment linkage, events, transitions, and accepted RPC semantics remain intact and regression-protected. |
| 2C0-05 | Shared compliance tables are canonical projections and review infrastructure, not replacements for every domain source. | Solo Plus integrates through a trusted adapter/projection; Lite and Business may use canonical reviews backed by their own evidence policies. |
| 2C0-06 | Starter, Solo Lite, Solo Plus, and Business do not share an assumed KYC/KYB checklist. | A shared engine may normalize evidence and decisions, while plan/entity policy remains explicit and versioned. |
| 2C0-07 | Commercial plan and business/entity classification are separate facts. | `business` is a plan; registered business name, limited liability company, incorporated trustee, and other entity types are compliance subjects, not plan aliases. |
| 2C0-08 | Legacy aliases remain compatible without blind physical rewrites. | `individual` resolves to `solo_lite`; `corporate` resolves to `business`; original evidence and billing references remain preserved. |
| 2C0-09 | Existing merchants enter canonical enforcement through observation, reviewed projection, and controlled adoption. | A missing canonical profile cannot immediately remove existing access, and a legacy verified flag cannot confer stronger assurance. |
| 2C0-10 | Capability rollout is ordered and cannot skip stages. | Shadow comparison precedes projection, reviewed backfill, activation/limit integration, and selected-boundary enforcement. |
| 2C0-11 | The generic activation persistence mismatch is a design blocker, not a reason to widen a database check. | The exact operational state vocabulary and atomic persistence contract require a later Sol-owned design and review. |
| 2C0-12 | Phase 2A and Phase 2B Solo Plus acceptance remains closed. | Phase 2C work may add adapters and shared presentation but cannot destructively generalize or reopen the accepted review lifecycle. |
| 2C0-13 | A canonical profile record is not itself reviewed assurance. | An eligible Solo Lite or Business merchant may have one inert draft profile before B4 submission; only a later terminal decision can project reviewed/trusted assurance into that same profile. |

## 3. Three independent state dimensions

| Dimension | Meaning | Canonical authority | Must not imply |
| --- | --- | --- | --- |
| Commercial entitlement | Which plan was purchased, is current, and is commercially usable | Reconciled `subscriptions` and `workspace_subscriptions`, with merchant/workspace plan columns treated as compatibility projections | Compliance approval, risk clearance, collection limits, setup unlock, or live capability |
| Compliance assurance | Current canonical compliance state and, when backed by a versioned trusted decision source, reviewed identity/business assurance including `lite_verified`, `enhanced_verified`, `business_verified`, pending, needs-attention, restricted, and rejected states | `merchant_compliance_profiles`; an inert `draft`/`test_mode` profile is a lifecycle state, not reviewed assurance | Active subscription, operational readiness, provider readiness, or activation |
| Operational activation/readiness | Whether live financial capabilities may operate now | A separately approved atomic transition plus `resolveMerchantCapabilities`, using entitlement, compliance, risk, restrictions, limits, setup/live state, settlement/provider readiness, feature flags, and merchant entitlements | A new plan purchase, stronger compliance assurance, or historical evidence mutation |

The dimensions may agree, disagree, or be incomplete. Disagreement and missing trusted inputs are reconciliation states, not permission grants. The runtime resolver must fail closed once enforcement is approved. Before enforcement, discrepancies are reported through the staged shadow process in section 9.

Profile existence is distinct from reviewed assurance. A `draft`/`test_mode` profile has no trusted decision provenance and cannot grant verified compliance, limits, collection, settlement, storefront, or other live capability.

Solo Plus preserves the accepted rule:

```text
payment confirmed -> paid verification/review case
review approved    -> approved case and review event
activation         -> separate controlled transition
```

There is no automatic review-to-activation implication.

## 4. Plan-specific domain ownership

| Plan | Canonical code / current price | Frozen domain ownership | Shared integration boundary | Explicitly not decided here |
| --- | --- | --- | --- | --- |
| Starter | `starter` / Free | Free/offline bookkeeping, draft and Record Invoice behavior, and preview remain available under their existing contract. No paid compliance case is required merely for offline use. Live collection remains unavailable unless a later approved policy says otherwise. | Deterministic plan normalization and a safe Starter capability projection. A canonical profile may be observed or projected later, but it cannot become a prerequisite for current offline access during shadow adoption. | Any future path that grants Starter live collection. |
| Solo Lite | `solo_lite` / ₦5,000 | Existing onboarding, payment, verification, and compatibility sources remain the domain inputs. Do not clone the Solo Plus case model. | A versioned Solo Lite evidence adapter may create `merchant_compliance_reviews` and project reviewed results into `merchant_compliance_profiles`. | Exact evidence checklist, conditional fields, manual-review policy, limit basis/value, and rejection/refund behavior. |
| Solo Plus | `solo_plus` / ₦13,000 | Preserve `solo_plus_cases`, exactly six controlled-launch requirements, case events, review transitions, row-version/idempotency rules, payment linkage, and accepted RPC semantics. | A trusted adapter projects an approved Solo Plus case and its reviewed source version into `merchant_compliance_profiles`. No duplicate canonical review row is required for the same decision. | Future renewal policy, approved limit policy, and the generic activation persistence vocabulary. |
| Business | `business` / ₦20,000 | Retain CAC/registry snapshots, affiliations, representative/director evidence, documents, verification providers, and current audit provenance. Do not copy Solo Plus requirements into Business. | A versioned Business evidence adapter may create `business_kyb` canonical reviews and project reviewed results into `merchant_compliance_profiles`. | Entity-specific documents, representative/director/UBO authorization, screening, volume policy, manual-review detail, and rejection/refund behavior. |

The plan label does not determine entity type. A Solo Lite or Solo Plus customer may be an individual or sole operator under an approved policy; Business may cover several registered entity types. Those classifications must be stored and evaluated separately from commercial entitlement.

Before B4 initial submission, an eligible Solo Lite or Business merchant may have one inert profile with the matching `plan_code`, `compliance_status = draft`, `activation_status = test_mode`, and `row_version = 1`. Every capability flag and `collection_limit_approved` remains false; policy, decision-source, reviewer, and reviewed-time provenance remain null. This initializes no assurance, does not adopt Lite or Business policy, and does not change the Starter or Solo Plus paths. Starter has no B4 draft-profile requirement. Solo Plus retains its `solo_plus_cases` lifecycle and is not represented by a Lite/Business B4 review.

## 5. Shared canonical infrastructure

Phase 2C must use or extend the existing shared boundaries where their contracts fit:

- plan catalog, canonical codes, labels, prices, and legacy aliases;
- authenticated merchant and canonical workspace resolution;
- disclosures and accepted disclosure versions;
- payment purpose and purchase intent;
- verification-provider adapters and provider audit logs;
- safe evidence references, provenance, assurance, freshness, and policy versioning;
- `merchant_compliance_profiles` for the current canonical compliance state, including an inert draft lifecycle state and a later reviewed/trusted assurance projection;
- `merchant_compliance_reviews` for Lite and Business review decisions;
- `merchant_compliance_events` for canonical immutable audit history;
- collection limit windows, reservations, reservation-window links, and usage events;
- the activation/restriction transport after its persistence contract is corrected and approved;
- `resolveMerchantCapabilities` as the single plan-neutral runtime decision contract;
- shared admin queue/detail presentation with plan-specific evidence and actions; and
- shadow comparison and discrepancy reporting.

No duplicate compliance-profile, review, event, limit, reservation, or usage table may be created without a reviewed schema requirement that the canonical tables cannot satisfy.

Shared infrastructure does not mean shared policy. Reviewed assurance adapters must supply an explicit plan, source type, source ID, source row version, policy version, evidence provenance, and reviewed outcome. Missing or ambiguous source identity is not projectable. Inert profile initialization supplies none of those reviewed-assurance claims.

## 6. Review and projection architecture

```text
eligible Solo Lite / Business merchant
                    │
                    v
         canonical workspace resolution
                    │
                    v
   inert merchant_compliance_profiles row
                    │
                    v
  draft evidence diagnostics -> review submission -> pending review
                    │                         │
                    │                         └-> correction / corrected resubmission
                    v
       future terminal decision -> reviewed/trusted profile projection

solo_plus_cases + requirements + events
                    │
                    └─> separate trusted, versioned adapter/projection
                                        │
                                        v
                            merchant_compliance_profiles
```

The shared admin framework may provide common queue, detail, actor, decision-history, and safe evidence-reference presentation. Plan-specific modules retain:

- evidence requirements and conditionality;
- source-state eligibility;
- allowed review decisions and transitions;
- refund/recovery consequences;
- assurance policy and freshness rules; and
- activation prerequisites.

`merchant_compliance_profiles` holds the current canonical compliance state. Its inert draft lifecycle state is not a reviewed projection and carries no decision provenance; a later terminal decision may project reviewed/trusted assurance and its provenance into the same row. Profile existence does not mean a review has occurred, and a B1 pending review does not make the profile verified. B1 creates the pending review and immutable submission event using the existing profile; it does not insert or update that profile. Future terminal-decision work owns approval, rejection, and trusted profile projection. It must not become:

- subscription or billing history;
- pending purchase intent;
- payment status storage;
- every case or review-history record;
- a replacement for Solo Plus cases, requirements, or events; or
- an operational usage ledger.

Canonical events provide projection audit. Domain events remain the authority for domain transitions. Projection must be idempotent and version-aware; a weaker or stale source version cannot overwrite a stronger reviewed projection without an explicitly approved transition.

The current Lite/Business review lifecycle is non-adopted: `policy_version = 2c-2b-draft-v1`, evidence `policyStatus = draft`, and its event trust marker is `unverified_diagnostic`. Neither inert initialization nor B4/B1/B2/B3 may create `lite_verified` or `business_verified`, approved collection limits, collections or settlement entitlement, storefront or receivable-sale access, or deposit/balance access.

Responsibility remains deliberately bounded:

- B4P ensures an inert Solo Lite or Business draft profile exists.
- B4 resolves merchant, owner, plan, workspace, and profile; evaluates draft evidence; and permits initial submission.
- B1 atomically creates the pending review and immutable submission event using the existing profile.
- B2/B3 provide correction and corrected-resubmission lifecycle only.
- A future terminal-decision slice owns approval, rejection, and trusted compliance projection.
- A future activation slice owns capability and settlement activation.

## 7. Plan aliases and compatibility

The deterministic commercial normalization contract is:

| Accepted stored/input value | Canonical commercial plan |
| --- | --- |
| `starter` | `starter` |
| `individual` or `solo_lite` | `solo_lite` |
| `solo_plus` | `solo_plus` |
| `corporate` or `business` | `business` |

An unrecognized value must remain unknown and fail closed at an authorization boundary. It must not silently grant Starter, paid, or Business capabilities. Display and reconciliation tools may preserve the raw value for diagnosis.

Compatibility rules:

- no blind rewrite of existing plan values;
- no overwrite of payment references, invoice references, subscription history, settlement accounts, verification evidence, or audit history;
- every future physical normalization or backfill requires provenance, an explicit policy version, deterministic reconciliation, and a separately reviewed rollback/rehearsal plan;
- UI labels use Solo Lite and Business while readers continue to accept `individual` and `corporate`; and
- business/entity classification is never derived solely from the commercial alias.

## 8. Existing-user safety contract

The following rules are frozen:

1. No existing merchant loses current access merely because a canonical profile has not yet been created.
2. A legacy `verified` flag, completed setup flag, plan label, populated bank fields, or successful payment cannot automatically confer `lite_verified`, `enhanced_verified`, or `business_verified`.
3. Existing evidence, payment/provider references, invoices, deposits, settlement accounts, subscription records, and audit history are preserved.
4. A pending Solo Plus upgrade retains its prior active Solo Lite commercial entitlement until the separately controlled Solo Plus activation transition succeeds.
5. Backfill and projection must record source provenance, source version, policy version, decision time, and reviewed actor/authority where applicable.
6. Legacy contradictions are reported and reviewed; they are not silently resolved by choosing the newest, strongest, or most permissive value.
7. Initial runtime adoption uses shadow reconciliation. Existing decisions remain authoritative until the merchant is eligible for a reviewed projection and the relevant enforcement stage is explicitly approved.
8. Enforcement may not begin for a population that lacks a completed migration/backfill eligibility decision and rollback-safe rollout plan.
9. Controlled creation or recovery of an inert profile must not alter existing access or confer assurance.

These rules protect current users during adoption. They do not grandfather unsafe behavior indefinitely: restrictions, fraud controls, or explicit reviewed suspension may still deny access under their existing authority.

## 9. Mandatory rollout stages

| Stage | Allowed work | Required exit evidence | Prohibited shortcut |
| --- | --- | --- | --- |
| 1. Source adapters and shadow comparison | Read-only adapters, deterministic normalization, safe discrepancy categories, and comparison logging with no decision mutation | Source-contract tests, no-secret logging review, representative shadow results, and no runtime decision change | Writing profiles or changing live access from shadow results |
| 2. Canonical lifecycle state, projections, and discrepancy reporting | Idempotent inert profile initialization for eligible Solo Lite/Business merchants; separately authorized projection commands for newly reviewed decisions; admin-safe discrepancy visibility | Draft-state invariants, replay behavior, authorization, audit events, provenance for reviewed projections, and rollback-safe release gate | Treating inert initialization, legacy flags, or payment as approval; enabling collection, settlement, or any capability from an inert profile |
| 3. Reviewed legacy backfill/projection | Explicitly eligible merchants only, in bounded batches with review and reconciliation | Approved eligibility policy, dry-run manifest, counts/fingerprints, review evidence, rollback/recovery plan, and postflight | Blanket backfill or automatic assurance upgrade |
| 4. Controlled activation and limit integration | Approved activation persistence and atomic limit operations behind exact rollout gates | Disposable/staging transaction tests, concurrency/replay proof, reconciled entitlement, and explicit policy values | Widening checks or enabling from payment/profile alone |
| 5. Selected-boundary capability enforcement | Adopt `resolveMerchantCapabilities` at named collection boundaries in controlled cohorts | Shadow parity, merchant coverage, fallback/recovery, route-level tests, monitoring, and owner approval | Global cutover or storefront/payment expansion before the gate |

Stages are sequential for a given capability and merchant population. Later-stage source code may be designed in isolation, but it cannot be enabled or treated as authoritative before the preceding stage exits.

## 10. Unresolved policy register

| Decision | Why unresolved / source conflict | Blocks | Required owner | Safest temporary behavior |
| --- | --- | --- | --- | --- |
| Exact Solo Lite KYC requirements | The PRD describes Lite verification at product level; current legacy requirement code and stored fields do not constitute an approved canonical checklist. | Lite evidence adapter, review policy, assurance projection, and enforcement | Product + Compliance | Preserve existing Lite behavior; observe only; do not mint `lite_verified` from legacy fields. |
| Mandatory vs conditional NIN, government ID, address, and phone | Product text makes some identity fields conditional; Solo Plus controlled launch expressly excludes mandatory phone absent approved OTP. No cross-plan rule is approved. | Plan evidence policies and UI required-field logic | Compliance + Product | Require only current plan-owned behavior; missing undecided fields cannot be silently marked passed. |
| Solo Lite manual-review policy | It is unclear which Lite results are automatic, escalated, or always manually reviewed. | Lite review transitions and admin actions | Compliance + Product | Keep current verification flow; no canonical approval transition from an inferred result. |
| Business entity-specific KYB documents | Existing code has generic business/corporate document branches, while exact documents vary by entity type and are not frozen. | Business review policy and evidence completeness | Compliance + Legal/Product | Preserve collected evidence and current flow; do not declare `business_verified` through the canonical engine. |
| Representative, director, UBO, and authorization requirements | Current registry/director/representative infrastructure is partial and alias-sensitive; exact authority/ownership thresholds are not approved. | Business eligibility, review, and assurance projection | Compliance + Legal | Escalate to existing manual review; do not infer authority from plan or registry match alone. |
| Business screening policy | The PRD names broader risk concepts, but sanctions/PEP/adverse-media scope, provider, matching, and escalation policy are not approved end to end. | Business approval and risk rating | Compliance + Legal/Risk | No canonical Business approval; preserve any existing restricted/manual-review outcomes. |
| Solo Lite collection limit | Current legacy behavior presents a ₦5m monthly limit; the PRD proposes an ₦8m cumulative cap and labels recommended caps as proposals. | Lite limit-window creation and enforcement | Product + Compliance/Risk | Preserve current behavior; shadow both interpretations without authorizing from either canonical projection. |
| Solo Plus collection limits | Current source includes legacy limits while the PRD proposes a reviewed monthly band. The accepted Solo Plus lifecycle did not approve a cross-plan limit policy. | Plus canonical limit projection and capability enforcement | Product + Compliance/Risk | Preserve accepted Solo Plus behavior; do not change limits in Phase 2C-0. |
| Business approved-volume policy | The PRD avoids a preset public cap but still requires reviewed volume, provider, and risk constraints. Exact calculation and review authority are absent. | Business limit windows and collection authorization | Product + Compliance/Risk | No canonical live authorization from “unlimited”; retain existing behavior under shadow observation. |
| Rejected paid Lite/Business refund policy | Solo Plus has a reviewed refund path; that plan-specific rule cannot be copied without a Lite/Business commercial and finance decision. | Paid onboarding rejection transitions and recovery | Product + Finance + Compliance | Fail closed on new automatic refund/credit behavior; use existing manually controlled support/refund paths only where already authorized. |
| Renewal, grace, and downgrade policy | Current subscription, expiry, grace, and workspace projections are not one reconciled contract. | Entitlement reconciliation, renewal activation, expiry enforcement, and downgrade | Product + Finance + Engineering | Do not alter access from a new canonical resolver; fix proven dispatch defects separately behind existing behavior. |
| Solo Plus renewal deferral | Crypto explicitly blocks renewal while fiat handling is inconsistent. Post-approval renewal semantics are not approved. | Solo Plus renewal routes and entitlement extension | Product + Finance + Engineering | Keep Solo Plus renewal blocked consistently; do not route it through generic initial provisioning. |
| Billing-clock timing | Start/extension time relative to payment, compliance approval, and activation is not frozen across plans. | Subscription dates, grace calculations, and entitlement state | Product + Finance | Preserve current dates; no backdated or approval-based clock rewrite. |
| Evidence freshness | The Solo Plus evidence-reuse policy exists, but cross-plan ages, expiry, revocation, and re-verification intervals are not approved. | Lite/Business evidence adapters, backfill eligibility, and ongoing assurance | Compliance | Keep source timestamps/provenance; stale or unknown evidence cannot create a stronger canonical assurance. |
| Legacy merchant backfill eligibility | Existing merchants have heterogeneous plan, verification, subscription, and live-state histories. No reviewed mapping population is approved. | Rollout Stage 3 and later enforcement | Product + Compliance + Engineering | Shadow and classify discrepancies only; no bulk profile approval. |
| Compliance approval vs operational activation vocabulary | Canonical compliance persistence uses approved-style activation values, while the generic command prepares `active` and persistence intentionally reports `activation_schema_incompatible`. | Activation persistence, Stage 4, and runtime cutover | Product + Compliance + Engineering (Sol design owner) | Keep persistence blocked; do not widen the database check or translate values implicitly. |

An unresolved decision blocks only the listed dependent work. It does not block documentation, pure normalization, source-only adapters that cannot authorize, or shadow comparison that preserves current behavior.

Non-adoption blocks trusted approval and policy adoption. It does not block bounded draft diagnostics, initial draft submission, pending review, correction, or corrected resubmission where those operations remain non-authoritative.

## 11. Phase 2C-1 source-defect queue

These are source-proven defects or inconsistencies. They are recorded here and are not fixed by this document.

| ID | Defect | Source evidence | Risk | Bounded Phase 2C-1 action |
| --- | --- | --- | --- | --- |
| 2C1-A | Trusted capability entitlement loading reads `merchants.plan`, while canonical merchant source uses `subscription_plan`. | `src/lib/compliance/trusted-runtime-capability-repository-core.ts`; `src/lib/data.ts` | The future trusted loader can fail, read a nonexistent/incorrect field, or report a false entitlement conflict. | Correct the selected field and add fail-closed fixture/unit coverage without enabling runtime enforcement. |
| 2C1-B | `subscriptions`, `workspace_subscriptions`, merchant projection, and workspace projection lack one deterministic, implemented precedence/reconciliation contract. | `src/lib/compliance/trusted-runtime-capability-repository-core.ts`; `src/lib/data.ts`; `src/lib/subscription.ts` | Conflicts, expiry, and legacy aliases can produce inconsistent access decisions. | Implement a pure reconciler from the already documented entitlement states; keep it shadow-only. Policy-dependent renewal/grace cases remain blocked. |
| 2C1-C | Fiat renewal records `plan_subscription` while metadata says `subscription_renewal`; confirmation prioritizes stored purpose and can dispatch renewal as initial provisioning. | `src/app/api/payment/renew-initialize/route.ts`; `src/app/api/payment/renew/route.ts`; `src/lib/services/fiat-payment-confirmation.service.ts` | A successful renewal can enter the wrong provisioning handler. | Align purpose and dispatch with focused replay/regression tests; preserve payment-provider behavior and do not decide new renewal policy. |
| 2C1-D | Solo Plus renewal deferral is explicit in crypto but inconsistent in fiat entry paths. | `src/app/api/checkout/crypto-subscription/route.ts`; fiat renewal routes and confirmation service | A deferred product path can remain reachable through one rail. | Add one consistent fail-closed boundary pending the unresolved renewal decision. |
| 2C1-E | Collection authorization input loading omits fields consumed by the legacy verification requirement calculation. | `src/lib/actions.ts`; `src/lib/services/onboarding-flow.service.ts`; `src/lib/verification-requirements.ts` | Decisions can be made from an incomplete snapshot and disagree with onboarding status. | Load the complete existing input contract and add parity tests; do not change the requirements themselves. |
| 2C1-F | Privileged Business verification has inconsistent `business` versus legacy `corporate` branches. | `src/lib/actions.ts`; `src/lib/verification-requirements.ts`; plan normalization helpers | Canonical Business and legacy Corporate records can receive different representative/director checks. | Normalize the branch input before privileged checks and add alias-parity tests; do not invent Business KYB rules. |

Every defect fix must be a narrow change with its own source review. Fixing these defects does not authorize capability enforcement, data backfill, payment execution, or activation.

## 12. Activation contract and blocker

The following concepts remain distinct:

| Concept | Question answered | Example effect |
| --- | --- | --- |
| Compliance approval | Has the plan-specific assurance policy been reviewed and accepted? | Profile becomes `lite_verified`, `enhanced_verified`, or `business_verified` with provenance. |
| Operational activation | May live financial capabilities operate now? | An atomic transition records operational readiness after entitlement, risk, limits, payout/provider, flags, and compliance all pass. |
| Setup lock/unlock | May the merchant leave the setup/restricted experience? | `setup_mode` may be cleared only by an approved transition; it is not proof of compliance. |
| Capability enablement | Which concrete actions are allowed at this instant? | `resolveMerchantCapabilities` evaluates all trusted dimensions and route-specific prerequisites. |

Current source prepares generic activation with target `active`, while the canonical compliance persistence vocabulary contains `approved` and the persistence layer deliberately returns `activation_schema_incompatible`. This is a useful fail-closed blocker.

The later activation design must define, before any migration:

- whether operational activation has its own state vocabulary or uses a precisely defined existing value;
- the authority and version of the compliance, entitlement, risk, restriction, limit, settlement, provider, setup, and feature-flag inputs;
- one atomic transaction, row-version and lock order, idempotency/replay behavior, immutable events, and rollback semantics;
- re-lock, restriction, suspension, expiry, and recovery transitions; and
- compatibility with the accepted Solo Plus activation path without creating a bypass.

Merely adding `active` to a CHECK constraint, mapping `active` to `approved`, or treating `live_features_enabled` as the activation authority is prohibited. This design is Sol-owned because it changes security-sensitive persistence and concurrency semantics.

## 13. Work allowed before policy closure

After this contract is independently approved, implementation may begin only where it cannot encode an unresolved product/compliance choice.

Safe, bounded work includes:

- Phase 2C-1 defect fixes 2C1-A through 2C1-F, with the policy-dependent parts left fail closed;
- pure plan/alias and entity-classification adapters with unknown-value denial tests;
- read-only, versioned source adapters that emit no approval and perform no mutation;
- shadow comparison and allowlisted discrepancy reporting;
- shared admin presentation contracts using injected, non-authoritative read models;
- provenance and policy-version types;
- inert profile initialization and non-adopted draft-review plumbing that cannot authorize operational capability;
- source-contract tests proving payment, plan, and legacy verification cannot independently authorize; and
- traceability updates.

Work that must wait for the relevant unresolved decisions includes:

- Lite or Business approval rules;
- new KYC/KYB required-field UI;
- canonical limit values or enforcement;
- legacy approval backfill;
- activation persistence or runtime enforcement;
- renewal/grace/downgrade behavior beyond closing a proven dispatch hole; and
- automatic refund behavior.

## 14. Task ownership guidance

### Terra-suitable after approval

- documentation and traceability maintenance;
- pure alias/entity mapping and deterministic normalization tests;
- presentational shared admin queue/detail components over an already approved read model;
- source inventory and static contract tests;
- allowlisted shadow discrepancy formatting and redaction tests; and
- mechanical adapter typing where the decision policy is injected and cannot authorize.

### Sol-required design or review

- commercial entitlement precedence and reconciliation when it affects access;
- payment renewal dispatch and replay-sensitive fixes;
- privileged Lite/Business verification alias corrections;
- compliance decision transitions and evidence policy;
- every migration, RLS/grant change, backfill, and database RPC;
- limit reservation/commit/release accounting and concurrency;
- activation/re-lock/suspension persistence;
- enforcement at collection/payment boundaries; and
- rollout, rollback, and legacy-access safety review.

The owner labels describe task risk and review depth. They do not authorize work or settle the unresolved policy register.

## 15. Acceptance and change control

This contract is accepted only when reviewers confirm:

- the three state dimensions cannot substitute for one another;
- Solo Plus remains regression-protected behind an adapter;
- Lite and Business policies are not inferred from Solo Plus;
- aliases and entity types remain separate;
- existing-user adoption begins with shadow reconciliation;
- every unresolved policy remains visibly blocked at its dependent boundary;
- the six Phase 2C-1 defects are queued without being silently fixed here;
- profile existence, pending review, reviewed/trusted assurance, and activation/capability remain distinct states, with no earlier state implying a later one; and
- activation persistence remains blocked pending an explicit design.

Any later change that alters these rules must cite the affected decision ID, the approving owner, the replacement contract, compatibility impact, and rollout/rollback evidence.

## 16. Recommended next bounded task

After independent approval of this document, the next task is:

```text
Phase 2C-1A — correct the trusted entitlement loader's merchant plan source and add shadow-only alias/reconciliation contract tests.
```

Scope it to source and tests. It must not enable runtime capability enforcement, mutate profiles, change subscription state, decide renewal/grace policy, or touch the accepted Solo Plus lifecycle.
