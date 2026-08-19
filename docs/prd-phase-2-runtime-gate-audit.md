# PRD Phase 2 Runtime Gate Audit

Audit date: 2026-08-19

Status: source-only audit. `resolveMerchantCapabilities` is not wired into runtime decisions. This report changes no production behavior.

Source-of-truth order:

1. `docs/deraledger-smart-storefront-prd.md`
2. `docs/phase-alignment-and-roadmap-rebaseline.md`
3. The historical Solo Plus implementation stream, which maps to PRD Phase 3
4. Current runtime source and tests

The current production checkpoint remains fail-closed: Starter works, the first Solo Lite subscription payment reached `paid_setup`, `setup_mode=true`, `live_features_enabled=false`, and customer collection remains disabled.

## 1. FILES_REVIEWED

Product and phase contracts:

- `docs/deraledger-smart-storefront-prd.md`
- `docs/phase-alignment-and-roadmap-rebaseline.md`
- `docs/phase 2 full implementation plan.md`
- `docs/solo-plus-phase-2-roadmap.md`

Capability, plan, identity, and workspace access:

- `src/lib/compliance/merchant-capabilities.ts`
- `src/lib/plans.ts`
- `src/lib/services/access-control.ts`
- `src/lib/services/onboarding-flow.service.ts`
- `src/lib/verification-requirements.ts`
- `src/lib/rbac.ts`
- `src/lib/merchant-context.ts`
- `src/lib/data.ts`
- `src/lib/actions.ts`

Invoice and public checkout entry points:

- `src/app/(dashboard)/invoices/create/page.tsx`
- `src/app/(dashboard)/invoices/page.tsx`
- `src/app/(dashboard)/invoices/[id]/page.tsx`
- `src/app/pay/[invoiceId]/page.tsx`
- `src/app/api/invoice/[invoiceId]/route.ts`
- `src/app/api/checkout/payment-methods/route.ts`
- `src/app/api/demo-payment/route.ts`
- `src/app/api/checkout/crypto-invoice/route.ts`

Payment routing, providers, settlement, and confirmation:

- `src/lib/payment/PaymentService.ts`
- `src/lib/payment/adapters/PaystackAdapter.ts`
- `src/lib/payment/adapters/MonnifyAdapter.ts`
- `src/lib/payment/adapters/BreetAdapter.ts`
- `src/lib/services/payment-routing.service.ts`
- `src/lib/services/invoice-payment-safety.service.ts`
- `src/lib/services/settlement-ledger.service.ts`
- `src/lib/services/breet-crypto.service.ts`
- `src/lib/services/fiat-payment-confirmation.service.ts`
- `src/app/api/payment/upgrade/route.ts`
- `src/app/api/payment/upgrade/recover/route.ts`
- `src/app/api/payment/renew/route.ts`
- `src/app/api/payment/renew-initialize/route.ts`
- `src/app/api/onboarding/initialize-payment/route.ts`

Solo Plus and Business approval paths:

- `src/lib/solo-plus/state.ts`
- `src/lib/solo-plus/server/activation.ts`
- `src/lib/solo-plus/server/supabase-repository.ts`
- `src/app/api/solo-plus/case/route.ts`
- Business/KYB actions in `src/lib/actions.ts`

Relevant contracts/tests:

- `tests/merchant-capabilities.test.ts`
- `tests/invoice-creation-access.test.ts`
- `tests/invoice-payment-initialization-safety.test.ts`
- `tests/checkout-payment-methods-contract.test.ts`

## 2. CURRENT_GATE_LOCATIONS

| Decision | Current authoritative or supporting gate | Current inputs |
| --- | --- | --- |
| Authenticated merchant and role permission | `resolveMerchantAccess` in `src/lib/rbac.ts`, backed by `resolveMerchantContextForUser` and `requirePermission` | Trusted `auth.getUser()`, owner/team membership, role permissions, subscription state, suspended verification state |
| Plan normalization | `src/lib/plans.ts` | Stored/canonical plan aliases; `individual -> solo_lite`, `corporate -> business` |
| Record versus Collection Invoice creation | `getInvoiceCreationAccess` in `src/lib/services/access-control.ts`, called by `createInvoiceAction` | Plan, lifetime invoice count, invoice type, legacy live-feature state |
| Collection Invoice UI | Invoice create/list/detail pages | `isLiveFeatureEnabled`, plan, subscription state, invoice status |
| Legacy live collection | `isLiveFeatureEnabled` and `getLiveFeatureLockReasons` in `src/lib/services/onboarding-flow.service.ts` | Plan requirements, legacy verification fields, `setup_mode`, `live_features_enabled`, legacy settlement fields |
| Automatic setup/live-state derivation | `setupStatusForMerchant` and `syncMerchantSetupStatus` | Legacy verification requirements and settlement bank fields |
| Public payment page | `src/app/pay/[invoiceId]/page.tsx` | Invoice status, plan, monthly total, subscription status, legacy live gate, broad settlement indicators |
| Payment-method discovery | `src/app/api/checkout/payment-methods/route.ts` | Route configuration, requested purpose, provider settlement readiness, Breet runtime flags |
| Fiat invoice initialization | `src/app/api/demo-payment/route.ts` | Collection Invoice check, legacy live gate, payment route, provider/environment-specific settlement mapping |
| Crypto invoice initialization | `src/app/api/checkout/crypto-invoice/route.ts` | Collection Invoice check, legacy live gate, Breet runtime flags, provider mapping, settlement account validation |
| Paystack merchant collection destination | `getVerifiedProviderSubaccountCode` plus the Paystack initialization payload | Verified provider mapping for the exact provider/environment |
| Monnify merchant collection destination | `getVerifiedProviderSubaccountCode` plus `incomeSplitConfig` | Verified Monnify mapping for the exact environment; adapter rejects merchant collection without a split |
| Breet collection readiness | `canUseBreetCryptoCheckout` and the crypto route | Breet live/config flags, invoice crypto flag, settlement mode, merchant/provider mapping, verified bank account where merchant-settled |
| Provider payment confirmation | Provider verification plus `confirmInvoicePayment` | Reference/idempotency, invoice type, amount and outstanding balance; it records/reconciles an already-received payment |
| Solo Plus activation | Solo Plus case state/requirements and the atomic activation service/RPC | Payment-confirmed case, six Enhanced requirements, manual review, explicit superadmin activation |
| Business/KYB approval | `adminApproveVerificationAction` and verification requirement helpers | Identity evidence, business documents, registry/director state, final review, legacy settlement fields |
| Storefront | No runtime route, component, model, or checkout implementation exists | Pure resolver contract only |

`resolveMerchantCapabilities` has no runtime call site. Its only current call sites are tests.

## 3. WHERE_CURRENT_LOGIC_MATCHES_RESOLVER

- Canonical aliases match: legacy `individual` resolves to Solo Lite and `corporate` resolves to Business.
- Starter is plan-blocked from Collection Invoice creation and live checkout while retaining offline Record Invoice creation.
- A Solo Lite merchant in `paid_setup` with `setup_mode=true` and `live_features_enabled=false` is denied by the current legacy collection gate.
- The invoice UI distinguishes Record Invoice from Collection Invoice and does not deliberately generate a payment link for a Record Invoice.
- Both fiat and crypto initialization routes call `getInvoicePaymentInitializationError` before provider initialization. Record Invoices therefore cannot initialize Paystack, Monnify, or Breet even if a public Record Invoice URL is opened directly.
- Fiat initialization requires a ready provider route and a verified provider/environment-specific subaccount code before attaching Paystack or Monnify merchant settlement instructions.
- Monnify's adapter rejects merchant collection purposes without `incomeSplitConfig` and rejects platform plan payments that incorrectly carry merchant split instructions.
- Crypto initialization checks `isLiveFeatureEnabled` before Breet address generation and additionally requires Breet runtime flags, webhook configuration, invoice-crypto enablement, and settlement readiness.
- Platform subscription/upgrade routes and customer invoice collection routes are separate. Plan-payment initialization does not pass merchant Paystack subaccounts or Monnify split configuration.
- Solo Plus payment confirmation does not activate Solo Plus. Enhanced requirements, manual review, and an explicit atomic activation operation remain separate.
- Business final approval checks identity and business evidence and can leave live features locked while payout setup remains incomplete.
- Provider confirmation is idempotent at the payment/reference level and refuses to treat Record Invoices as online collection invoices.

These matches are layered protections. The resolver must complement—not replace—trusted authentication/RBAC, invoice-state validation, provider verification, idempotent accounting, and provider-specific settlement validation.

## 4. WHERE_CURRENT_LOGIC_DIFFERS_FROM_RESOLVER

| Severity | Difference | Consequence |
| --- | --- | --- |
| High | Runtime never calls `resolveMerchantCapabilities`. | Current routes cannot enforce its complete plan/compliance/activation/risk/restriction/limit contract. |
| High | `normalizePlanTier` converts every `individual`-capability plan, including canonical `solo_plus`, to `individual_tier_1`. | Generic runtime gates evaluate Solo Plus with Lite requirements instead of Enhanced approval requirements. The separate Solo Plus activation path is stronger, but downstream generic gates do not consult the Solo Plus case. |
| High | Current collection authorization has no canonical compliance status, activation status, risk rating, restriction state, approved limit profile, or capability feature-flag input. | `live_features_enabled` plus legacy fields can represent less information than the resolver requires. Missing PRD Phase 2 inputs cannot fail closed because they are not loaded. |
| High | `setupStatusForMerchant` can derive `live_features_enabled=true` from legacy requirements alone. | Legacy completion can mutate setup/live state without the resolver's risk, restriction, limit, feature-flag, or verified provider-mapping decisions. |
| High | Paid-plan Record Invoice creation returns `shouldSyncMerchantSetup=true`; `createInvoiceAction` then calls `syncMerchantSetupStatus`. | An offline bookkeeping action can trigger setup/live-state mutation. This conflicts with the resolver's side-effect-free Record Invoice capability and the PRD rule that Record Invoice must not initialize or unlock collection. |
| High | Breet invoice checkout permits the configured `treasury_manual` settlement mode, where the settlement recipient is the platform, while the PRD MVP requires direct merchant settlement. | A future enabled crypto invoice flow could have a settlement destination inconsistent with the storefront/collection contract. It remains behind several flags today, but must not be treated as resolver-ready. |
| Medium | `isLiveFeatureEnabled` rejects only `setup_mode === true`; null or missing setup state is not itself blocking. | The resolver correctly requires explicit `setupMode=false`. A partial projection can therefore behave differently from the resolver. |
| Medium | Merchant projections passed to the same legacy gate are inconsistent. For example, Collection Invoice creation and fiat initialization omit settlement fields required by `getIncompleteRequirements`. | Some paths fail closed for the wrong reason and may continue to deny a fully approved merchant; other paths using `select("*")` can reach a different result for the same merchant. |
| Medium | Provider mapping is checked at payment initialization, not at Collection Invoice creation. | Runtime can create/present a Collection Invoice before provider settlement is ready, while the resolver denies `canCreateCollectionInvoice` and `canUseCheckout` together. |
| Medium | Payment-method discovery does not load invoice type or merchant compliance/setup/live/subscription/limit state. | It can advertise configured methods before the authoritative initialization route later rejects them. No provider call bypass was found, but the discovery response is not resolver-equivalent. |
| Medium | The public pay page has no early Record Invoice branch and uses broad legacy settlement indicators. | A directly opened Record Invoice URL may render payment UI for an otherwise live merchant, although both initialization APIs reject it server-side. |
| Medium | Server-side invoice payment initialization does not consistently re-check current subscription/restriction state or PRD collection limits. The public page does some of this client-side. | Direct API callers rely on the narrower legacy live gate and provider readiness rather than one server-authoritative capability decision. |
| Medium | `validateMonthlyCollectionLimit` exists but is not called by `createInvoiceAction`; creation checks only active Collection Invoice count. | Collection-limit enforcement is not aligned with the resolver's approved limit profile and used/remaining amount. |
| Medium | Existing limits are plan constants: Solo Lite and Solo Plus share a 5m monthly/20-active-invoice model and Business is unlimited. | This differs from PRD cumulative/reviewed/approved-volume profiles and ignores merchant-specific risk approval. |
| Medium | Business approval mixes canonical and storage names: some checks accept `business` or `corporate`, while representative/director branches check only `corporate`. | A canonical Business row can follow a different KYB branch from a legacy Corporate row. Resolver input must be produced only after one normalized KYB decision. |
| Medium | The public invoice API defaults a missing subscription row to `active`. | Missing commercial state is not fail-closed and cannot be cleanly translated into the resolver's restriction/activation inputs. |
| Controlled exception | `isSuperadminSandboxMerchant` bypasses plan, verification, setup, and live gates for `is_super_admin` or a configured/default email. | This is not represented by the resolver. It must remain an explicitly isolated sandbox-only exception and must never be folded into ordinary production merchant capability input. |
| Dormant conflict | `canCollectAfterIdentityVerification` would allow any non-Starter plan after `identity_verified=true`, but no runtime call site was found. | It conflicts with the resolver and should not be adopted as a fallback; Solo Plus and Business require stronger approval. |

Expected layering differences are not defects: RBAC may deny a Record Invoice even though the pure resolver says the commercial capability exists, and provider confirmation must reconcile funds already received rather than silently discard them because a merchant's later capability state changed.

## 5. PAYMENT_COLLECTION_RISK_AREAS

1. Automatic setup synchronization from paid Record Invoice creation is the clearest current side-effect risk. It is reachable without choosing Collection Invoice.
2. Solo Plus is not distinguishable from Solo Lite inside the generic verification-requirement gate. No generic collection route should be wired until the runtime context supplies Enhanced approval explicitly.
3. Current live gates do not consume risk, restriction, approved collection limit, or feature-flag state. `live_features_enabled=true` is necessary today but is not sufficient under the PRD contract.
4. Collection Invoice creation and payment initialization use different settlement thresholds. The latter is stricter, so collection is currently fail-closed at the provider boundary, but capability decisions and UI can disagree.
5. Payment-method discovery can expose a method that the initialization route later rejects because it does not evaluate the full invoice/merchant gate.
6. The public payment page can render payment controls for a directly opened Record Invoice; backend initialization remains blocked.
7. Paystack legacy settlement fallbacks remain in settlement-readiness helpers. Fiat initialization's final `getVerifiedProviderSubaccountCode` check prevents a missing mapping from reaching provider initialization, but discovery/readiness results can still disagree.
8. Breet `treasury_manual` for customer invoice collection conflicts with the PRD direct-merchant-settlement model. Do not approve live Breet invoice collection until this policy is resolved separately.
9. The sandbox/superadmin bypass is broader than resolver policy. Any future integration must keep it out of live merchant collection decisions.
10. Payment confirmation does not run the resolver. That is not automatically wrong—funds may already have moved—but initialization, expiry, restriction, and post-payment manual-review/reconciliation rules need an explicit design before replacement.

No ordinary merchant path was found that lets a Record Invoice reach provider initialization, and no Paystack/Monnify invoice initialization path was found that omits the final verified subaccount/split requirement. This audit does not certify live collection.

## 6. STORE_FRONT_BLOCKERS

- PRD Phase 4 has not started in runtime source. No storefront route, component, checkout, order, or receivable implementation was found.
- The resolver's storefront, Instant Sale, Receivable Sale, merchant-confirmation, and registered-customer flags exist only as pure input contracts/tests; there is no trusted runtime source for them.
- Canonical compliance, activation, risk, restriction, and approved collection-limit profiles are not available to current runtime gates.
- Storefront checkout cannot safely inherit the current public invoice-page gate because that gate is legacy-field-based and not provider-neutral.
- Direct merchant settlement must be made an invariant for storefront customer payments; Breet treasury/manual invoice settlement is unresolved.
- Limit reservation and concurrency-safe usage accounting do not exist for Instant Sale or Receivable Sale.
- Solo Plus Enhanced approval and Business KYB approval are not yet translated into the plan-neutral capability contract.
- A Phase 2 runtime traceability test must prove every live storefront/payment entry point consumes the same trusted capability decision before PRD Phase 4 begins.

Storefront preview is conceptually allowed by the resolver only for a known, active, unrestricted merchant. No preview implementation should be inferred from that contract, and no Storefront Phase 4 work is approved by this audit.

## 7. SOLO_LITE_GATING_GAPS

- The current `paid_setup` production state is safely denied by `setup_mode=true` and `live_features_enabled=false`.
- Runtime has Lite KYC and legacy final-review checks, but no explicit `lite_verified` compliance profile or `approved` activation input.
- Legacy settlement completion means bank fields exist; it is not the same as both a verified payout account and a ready provider mapping.
- There is no approved cumulative limit profile/usage input. Current limits use shared Individual constants instead of the PRD Solo Lite profile.
- Missing feature flags do not deny Collection Invoice in the legacy model because those flags are not loaded.
- Solo Lite's permanent denial of Receivable Sale and Deposit & Balance exists only in the pure resolver because those runtime features do not yet exist.
- Paid Record Invoice creation can invoke setup synchronization and must be separated before capability wiring.

## 8. SOLO_PLUS_GATING_GAPS

- The Solo Plus case model, payment-without-activation lifecycle, six Enhanced requirements, manual review, and atomic activation service are valid PRD Phase 3 work.
- Generic runtime verification normalizes `solo_plus` to the Lite tier. It does not consume case status, Enhanced requirement completion, or approval identity.
- Payment alone remains non-activating, but a later generic gate currently sees merchant flags/legacy requirements rather than an explicit `enhanced_verified + approved` capability context.
- No approved reviewed-volume profile, risk rating, restriction state, or receivable-specific flags are supplied to runtime.
- Receivable Sale and Deposit & Balance are correctly denied by the resolver until every Enhanced, risk, limit, settlement, and feature-flag gate passes; no equivalent runtime consumer exists.
- The activation adapter must not infer Enhanced approval merely from plan=`solo_plus` or `live_features_enabled=true`.

## 9. BUSINESS_KYB_GATING_GAPS

- Current Business verification includes business documents, registry/director evidence, identity review, manual approval, and payout-pending handling.
- Direct string comparisons are inconsistent: document checks accept `business` and `corporate`, while several representative/director-affiliation branches accept only `corporate`.
- Runtime represents approval primarily through legacy `verification_status` and setup/live fields, not `business_verified` plus an explicit activation decision.
- No approved-volume profile, risk rating, restriction state, or Business storefront/receivable flag set is loaded.
- Legacy bank-field completion can permit setup-state derivation before provider settlement mapping exists; provider initialization is stricter and then rejects the payment.
- Business must never be treated as unlimited solely because of plan. The PRD requires KYB, provider limits, risk review, and approved volume.

## 10. RECOMMENDED_INTEGRATION_ORDER

1. **Isolate Record Invoice side effects.** In a separately approved narrow safety commit, ensure Record Invoice creation never calls setup/live synchronization; add a paid-plan regression test, not only the existing Starter test.
2. **Define a trusted runtime capability-context contract without wiring decisions.** Specify how authenticated merchant/workspace identity, normalized plan, subscription restriction, canonical compliance/activation, risk, limits, feature flags, and provider settlement readiness are loaded. Missing or query-error fields must remain missing so the resolver denies them.
3. **Resolve persistence/source ownership under PRD Phase 2B approval.** Do not synthesize `lite_verified`, `enhanced_verified`, `business_verified`, risk ratings, or approved limits from plan/payment metadata. Map Solo Plus case approval and Business KYB approval deliberately.
4. **Add parity tests around existing gates.** Cover missing projections, null setup state, subscription expiry, sandbox isolation, provider mapping, canonical Business aliases, and Solo Plus Enhanced status.
5. **Adopt the resolver first at authenticated Collection Invoice creation.** Keep RBAC and invoice validation as separate outer gates. Do not change Record Invoice semantics.
6. **Adopt the same decision at public payment-method discovery and fiat/crypto initialization.** Initialization remains the authoritative final check; keep provider-specific settlement validation after the resolver.
7. **Keep confirmation/reconciliation layered.** Do not naively reject or discard already-received funds. Define manual-review behavior for a capability that becomes restricted between initialization and confirmation.
8. **Remove or quarantine conflicting legacy helpers only after parity is proven.** This includes the identity-only progressive unlock and any setup auto-activation path.
9. **Run Phase 2 exit QA and independent audit.** Only explicit approval after traceability and fail-closed tests can authorize PRD Phase 4 Storefront Foundation.

## 11. FILES_TO_TOUCH_IN_NEXT_COMMIT

Recommended next narrow commit: `fix(compliance): keep paid Record Invoice side-effect-free`.

- `src/lib/services/access-control.ts`
- `src/lib/actions.ts`
- `tests/invoice-creation-access.test.ts`

That commit should only remove setup/live synchronization from the Record Invoice path and prove paid-plan Record Invoice remains offline. It should not wire `resolveMerchantCapabilities` or change Collection Invoice/provider behavior.

After that safety fix, the first unwired context-contract commit should preferably add:

- `src/lib/compliance/runtime-capability-context.ts` (new)
- `tests/runtime-capability-context.test.ts` (new)

Existing plan, Solo Plus, verification, settlement, and resolver modules should initially be read-only dependencies unless a separately reviewed contract correction is necessary.

## 12. FILES_NOT_TO_TOUCH

Until a specific later commit is approved:

- Any SQL schema, migration, seed, production inspection, or data repair file
- `.env*`, provider credentials, provider routing settings, or deployment configuration
- Paystack, Monnify, or Breet adapters and live-provider behavior
- Payment confirmation, webhook, atomic paid-upgrade confirmation, or subscription activation code
- Storefront routes, components, orders, checkout, Instant Sale, Receivable Sale, Deposit & Balance, or discount checkout behavior
- Production `setup_mode`, `live_features_enabled`, verification, settlement, subscription, or role data
- Existing production payment records or the completed Solo Lite payment path

## 13. DB_REQUIRED=NO

This audit creates no migration and requires no database action. Later PRD Phase 2B persistence work requires separate approval and the database-safety runbooks before any SQL is prepared.

## 14. PAYMENT_TESTING_ALLOWED=NO

No additional subscription, collection, checkout, Paystack, Monnify, or Breet payment test is authorized by this audit.

## 15. PRODUCTION_BEHAVIOR_CHANGED=NO

Only this documentation report is added. The resolver remains unwired, live collection remains locked, and Storefront Phase 4 has not begun.
