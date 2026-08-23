# PRD Phase 2 shadow capability observation plan

Status: design only. This document does not authorize runtime wiring, a migration, a profile insert/backfill, a payment test, collection checkout, provider call, or storefront work.

## 1. Objective and current safety boundary

Shadow mode will later measure whether `loadTrustedRuntimeCapabilityContext()` and `resolveMerchantCapabilities()` agree with an already-completed production decision. It is an observability exercise, not an authorization mechanism.

At this checkpoint Migration 024 tables exist but contain no compliance profiles, reviewed limits, reservations, or usage events. Therefore the expected shadow result for every merchant is incomplete and fail-closed, normally including `compliance_profile_missing`. Existing production gates remain the sole authority:

- `setup_mode = true`, `live_features_enabled = false`, and `verification_status = unverified` remain operational locks;
- Starter Record Invoice remains offline/manual;
- customer collection, checkout, payment links, and storefront checkout remain locked;
- payment, provider, and verification flows are not part of shadow mode.

## 2. Exact non-behavior-change guarantee

Any future shadow observation call must run only after the current server-side gate has reached its response decision. It must not alter that decision or execute before a response-sensitive operation.

It must never:

- allow or deny an action, replace an existing capability check, change an error, or change an HTTP/server-action response;
- redirect, revalidate, alter a cookie/session, alter cache state, or change a rendered UI state;
- initialize checkout, create a payment link, select a provider, call Paystack/Monnify/Breet, or read provider credentials;
- insert, update, delete, upsert, reserve, commit, release, or call an RPC;
- mutate `setup_mode`, `live_features_enabled`, subscription state, verification/KYC/KYB state, settlement state, or any merchant/workspace row;
- accept a browser merchant ID, workspace ID, plan, payment reference, provider metadata, or auth metadata as loader authority.

If observation cannot finish within a small bounded budget or returns any error, it is discarded or emitted as a safe source-status metric. The original action response proceeds unchanged.

## 3. Eligible future observation points

The first separately approved implementation may use one narrowly scoped, server-only observation point at a time. It must obtain a trusted authenticated user with `auth.getUser()`, retain the existing authorization result, then invoke the injected repository/loader asynchronously after the decision is fixed.

Candidate order:

1. Collection Invoice access-denial/allow decision in `getInvoiceCreationAccess` consumers, observation only after the existing decision has been calculated. Record Invoice is excluded.
2. Fiat checkout/payment-link preflight after all current invoice/payment safety gates have completed, without changing the result or calling a provider.
3. Provider-specific collection preflight only after the prior observation has been reviewed; current Paystack, Monnify, and Breet safeguards remain final authorities.
4. Future Instant Sale/Receivable Sale observation only after approved profile and transactional limit design work exists.
5. Storefront live-checkout observation only after the preceding gates, products/orders, and direct-settlement design are separately approved.

Observation must not be attached to a provider callback, webhook, subscription payment confirmation, upgrade activation, admin approval/rejection, profile save, onboarding mutation, or Record Invoice action.

## 4. Routes and actions that remain untouched now

This design authorizes no imports into routes, pages, or actions. In particular, do not modify:

- `src/lib/actions.ts`, `src/lib/services/access-control.ts`, or invoice creation actions;
- onboarding, upgrade, subscription, manual-payment, callback, confirmation, or webhook paths;
- Paystack, Monnify, Breet, settlement, payout refresh, or payment-routing services;
- dashboard/profile/verification/admin approval actions;
- any API route, Server Component, client component, redirect, middleware, or storefront placeholder.

The current `shouldSyncMerchantSetup` distinction remains unchanged: Record Invoice must not synchronize setup/live state, while existing Collection Invoice behavior remains untouched until a later reviewed integration.

## 5. Future redacted diagnostic event

Shadow output is server-only structured logging/metrics. It must use an allowlisted, versioned event shape:

```ts
type ShadowCapabilityObservationV1 = {
  event: "merchant_capability_shadow_v1";
  observationId: string;
  occurredAt: string;
  routeClass:
    | "collection_invoice"
    | "checkout_preflight"
    | "provider_collection_preflight"
    | "instant_sale"
    | "receivable_sale"
    | "storefront_checkout";
  existingGate: "allow" | "deny" | "not_evaluated";
  resolverOutcome: "allow" | "deny" | "incomplete" | "source_error";
  comparison:
    | "agree_allow"
    | "agree_deny"
    | "existing_allow_resolver_deny"
    | "existing_deny_resolver_allow"
    | "source_incomplete"
    | "source_error";
  merchantHash: string | null;
  workspaceHash: string | null;
  relationship: "owner" | "team_member" | "unresolved";
  entitlementState:
    | "starter_free" | "active_paid" | "grace_read_only" | "inactive"
    | "expired" | "cancelled" | "missing" | "conflicting";
  normalizedPlanClass: "starter" | "solo_lite" | "solo_plus" | "business" | "unknown";
  existingReasonCodes: readonly string[];
  resolverReasonCodes: readonly string[];
  sourceDiagnosticCodes: readonly string[];
  sampleRate: number;
};
```

`merchantHash` and `workspaceHash` use a stable server-side keyed hash only; raw IDs are not emitted. An implementation must allowlist every enum and reason code before logging. It must not serialize the loader context, Supabase rows, errors, request body, headers, or provider responses.

## 6. Reason-code taxonomy

The comparison value is for aggregate outcomes only. Source diagnostics use the existing loader safe codes, such as:

- identity/context: `trusted_identity_missing`, `merchant_workspace_missing`, `merchant_workspace_query_error`;
- entitlement: `commercial_entitlement_missing`, `commercial_entitlement_conflicting`, `commercial_entitlement_query_error`, plus the normalized entitlement state;
- compliance: `compliance_profile_missing`, `compliance_profile_ambiguous`, `compliance_profile_query_error`, `merchant_entitlements_missing`;
- rollout/limits: `global_feature_flags_missing`, `global_feature_flags_query_error`, `collection_limit_missing`, `collection_limit_query_error`;
- settlement: `payout_readiness_missing`, `payout_readiness_query_error`, `provider_mapping_missing`, `provider_mapping_query_error`;
- locks: `operational_state_missing`, `operational_state_disagreement`, `operational_state_query_error`.

Resolver reason codes may be emitted only from the established allowlisted `MerchantCapabilityBlockingReasonCode` union. Existing gate reasons must be mapped to a small local allowlist such as `plan_gate`, `rbac_gate`, `verification_gate`, `setup_gate`, `live_feature_gate`, `settlement_gate`, `invoice_type_gate`, or `unknown_existing_deny`; never log the original human-facing message.

## 7. Data exclusions

Never emit raw or derived values for:

- BVN, NIN, CAC numbers, selfie/document/media URLs, verification payloads, evidence snapshots, or reviewer notes;
- bank name/code, account number/name, settlement account ID, provider subaccount/account reference, mapping identifier, or payout payload;
- provider webhook/callback payload, reference, authorization token, payment amount, email, invoice/client name, request body, cookies, IP address, or user-agent;
- risk/restriction notes, reason text, decision-source IDs, raw DB errors, SQL errors, credentials, or environment secrets.

Plan class, entitlement state, safe diagnostic codes, and a keyed hash are sufficient for aggregate observation.

## 8. Sampling, rate limiting, and delivery

- Start disabled by default behind a server-only kill switch, separate from merchant/global capability flags.
- Sample at a conservative fixed rate (initially at most 1% of eligible server decisions), with deterministic hashing of the trusted merchant/workspace pair to avoid repeat bursts.
- Cap observations per merchant/workspace and route class per rolling hour; cap global volume as well.
- Do not observe unauthenticated, malformed, or browser-only candidate contexts beyond one aggregated safe counter.
- Logging/metric delivery is best-effort and bounded. Failure, timeout, queue saturation, or serialization failure is ignored after a safe internal counter; it cannot delay or change the request.
- Never use payment/provider throughput, callback traffic, or Record Invoice traffic as a sampling source.

## 9. Comparison and missing-data handling

The observer records the current authoritative decision first, then calculates a resolver classification without returning it to the caller:

| Existing gate | Resolver result | Shadow comparison |
|---|---|---|
| allow | requested live capability allowed | `agree_allow` |
| deny | requested live capability denied | `agree_deny` |
| allow | resolver denied | `existing_allow_resolver_deny` |
| deny | resolver allowed | `existing_deny_resolver_allow` |
| any | loader status `incomplete` | `source_incomplete` |
| any | loader status `source_error` | `source_error` |

During the current empty-profile checkpoint, `source_incomplete` with `compliance_profile_missing` is expected. It is not a reason to create/backfill a profile, modify a gate, suppress the existing gate, or reduce logging safeguards.

Adapter query errors become `source_error` with one safe code. They must not be retried in the request path, exposed to a browser, or replaced by plan/payment/provider metadata. Multiple or stale source rows remain incomplete/fail-closed.

Any `existing_deny_resolver_allow` is a review signal only. It must never create a bypass. Any `existing_allow_resolver_deny` is a review signal only. It must never block the existing allowed request.

## 10. Provider and payment safety

The observer may read the trusted repository snapshot only after existing safety gates. It must not call provider SDKs/APIs, create payment records, initialize a transaction, create a reference, refresh settlement/payout state, or inspect credentials.

Subscription/upgrade payment flows remain out of scope. Customer collection remains fail-closed under current verification, live-feature, and provider-settlement guards. A verified payout account without an exact active/connected provider-and-environment mapping remains not ready in both the repository result and the shadow classification.

## 11. Success criteria before implementation or adoption

Before any shadow wiring is approved:

1. Security review approves the redacted event schema, keyed-hash rotation/retention, logger destination, and server-only kill switch.
2. Repository/loader unit coverage proves all missing/ambiguous/error states deny live capabilities.
3. A proposed observation wrapper proves no response, redirect, cache, cookie, DB, setup/live, payment, or provider change.
4. Static tests prove no client component, webhook, callback, Record Invoice, or payment-confirmation path imports the observer.
5. Controlled non-payment samples show the expected empty-profile `source_incomplete` result and no sensitive fields in output.
6. A reviewed dashboard/metric aggregates comparison codes without raw merchant data.
7. Written approval defines threshold, sample rate, retention, alert ownership, and exact stop conditions.

No enforcement adoption is eligible while profiles/limits are empty. No payment or collection test is authorized by satisfying these criteria.

## 12. Tests required before any shadow implementation

- server-only marker and no import-time read/write/provider activity;
- observer accepts only trusted server identity/context and rejects browser-selected authority fields;
- current action response, status, body, redirect, cache/revalidation, and cookies are byte-for-byte/contract unchanged with observation enabled versus disabled;
- no DB write/RPC/provider initialization occurs, including on loader/repository/logging failures;
- Record Invoice never invokes the observer;
- empty profile produces `source_incomplete` + `compliance_profile_missing` only;
- each query error, duplicate profile, entitlement conflict, lock disagreement, missing flag/limit/payout/mapping produces safe codes only;
- exact provider/environment mismatch is not ready;
- sampling, merchant/global caps, timeout, queue failure, and kill switch produce no customer-visible effect;
- diagnostics do not contain the excluded sensitive fields, raw error strings, IDs, emails, payment references, or provider payloads;
- no route/action/page currently imports the observer, loader, or repository before the separately approved adoption commit.

## 13. Kill switch, rollback, and adoption order

The future implementation requires a server-only default-off kill switch that is evaluated before any loader/repository read. It must not be merchant-controlled, browser-controlled, or reused from a payment/provider feature flag. Disabling it must immediately stop new observation reads/emits without cache invalidation, deployment rollback, or database mutation.

The observer needs independent hard caps, a timeout, and a logging-disable switch. Kill conditions include sensitive-data risk, unexpected provider/write activity, response-latency breach, non-empty-profile resolver allow without approved profile evidence, or unexpected comparison volume. Recovery is to disable observation only; never to change customer gates or data.

After this design, the approved order remains:

1. review this plan; no runtime change;
2. separately implement a server-only, default-off observer with contract tests only;
3. collect and review shadow aggregates while current gates stay authoritative;
4. separately approve a diagnostics/status projection if findings are safe;
5. separately evaluate Collection Invoice/fiat checkout enforcement, retaining existing provider checks;
6. consider payment links/provider paths, then limits-backed Instant Sale/Receivable Sale, then storefront live checkout only after their own approvals.

Record Invoice remains outside every shadow and live-collection adoption step.

## 14. Files reviewed

- `docs/prd-phase-2-trusted-runtime-loader-design.md`
- `docs/prd-phase-2-persistence-decision-record.md`
- `src/lib/compliance/trusted-runtime-capability-loader.ts`
- `src/lib/compliance/trusted-runtime-capability-loader-core.ts`
- `src/lib/compliance/trusted-runtime-capability-repository.ts`
- `src/lib/compliance/trusted-runtime-capability-repository-core.ts`
- `src/lib/compliance/runtime-capability-context.ts`
- `src/lib/compliance/merchant-capabilities.ts`
- `src/lib/actions.ts`
- `src/lib/services/access-control.ts`
- `src/lib/services/invoice-payment-safety.service.ts`
- `src/lib/services/settlement-ledger.service.ts`
