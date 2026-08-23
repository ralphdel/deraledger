# PRD Phase 2 first shadow observation point

Status: design only. This document does not authorize runtime wiring, loader/repository imports into routes or actions, a migration, a profile insert/backfill, a payment test, collection checkout, provider calls, or storefront work.

## 1. Safest first observation point

The first approved shadow observation point should be the Collection Invoice access decision, and only after the existing gate has already finished deciding the response. The safest concrete boundary is the current `getInvoiceCreationAccess()` flow in `src/lib/services/access-control.ts`, specifically when it evaluates a requested `"collection"` invoice.

Record Invoice is excluded. Checkout, provider initialization, payment link creation, callbacks, webhooks, and upgrade/payment routes are excluded.

## 2. Why this point is safer than checkout/provider/payment routes

Collection Invoice access is safer because it is an earlier, purely permission-shaping decision that already exists in server-side access control. It can be observed after the response decision is fixed, without needing to initialize a payment method, select a provider, build a payment payload, or inspect provider credentials.

By contrast, checkout and provider routes are riskier because they can:

- initialize payment methods or payment links;
- branch into provider-specific logic;
- touch collection-only state;
- create confusion with Record Invoice versus live payment flow;
- increase the chance of a user-visible change if an observation hook is misplaced.

## 3. Exact existing gate that remains authoritative

The existing authoritative gate is `getInvoiceCreationAccess(merchant, requestedInvoiceType, currentLifetimeInvoiceCount)` in `src/lib/services/access-control.ts`.

For the first observation point, the current gate result from `getInvoiceCreationAccess()` remains the only customer-facing decision. The shadow observer may only compare a fixed result against the trusted resolver result after the gate has already completed.

## 4. Exact future import boundary

The future import boundary is a server-only consumer that already has the existing gate result and can invoke the observer only after the gate has returned.

That boundary must:

- call `auth.getUser()` or another trusted server auth source first;
- resolve the existing access decision first;
- pass that finalized result into the shadow observer as read-only input;
- never let the observer alter the returned response, redirect, cookies, cache state, revalidation, or database state;
- never import the observer into Record Invoice code paths.

The observer must remain downstream of the gate, not a replacement for it.

## 5. Default-off env/flag behavior

Shadow observation must remain off by default.

Required controls for the future implementation:

- server-only enable flag must default to `false`;
- separate kill switch must default to `true` or otherwise block observation until explicitly disabled;
- sampling must be explicitly enabled;
- no merchant-controlled, browser-controlled, or payment/provider-controlled flag may turn it on;
- if any control is missing, the observer must not run.

## 6. No-response-change guarantee

When shadow observation is later wired, it must not change the request outcome in any way.

The customer-visible decision must remain byte-for-byte and contract-for-contract identical to the pre-observation path:

- same allow or deny;
- same error text;
- same redirect behavior;
- same HTTP or server-action status;
- same cookies and cache behavior;
- same DB writes, or lack of them.

If the observer times out, errors, or cannot emit diagnostics, the original gate response still stands unchanged.

## 7. Expected result while compliance profiles are empty

Because the PRD Phase 2 compliance tables are currently empty in production, the expected shadow result for the first observation point is fail-closed and incomplete.

The most likely comparison outcome for a real merchant at this checkpoint is:

- resolver outcome: `incomplete`;
- reason code: `compliance_profile_missing`;
- existing gate: whatever the current access-control code returned;
- no attempt to create or backfill compliance profiles;
- no attempt to treat payment or plan text as compliance approval.

This is an observation signal only. It is not a trigger to alter behavior.

## 8. Redacted diagnostic route class

For the first observation point, the route class should be recorded only as a redacted class label such as:

- `collection_invoice`

No raw route path, raw query string, raw invoice payload, merchant ID, workspace ID, or provider detail should appear in diagnostics.

## 9. Timeout and error behavior

Observation must be best-effort and bounded.

If the loader/repository path times out or errors:

- the original gate decision still returns;
- diagnostics are reduced to safe reason codes only;
- no exception escapes to the caller because of the observer;
- no retries occur in the request path;
- no provider, payment, or DB mutation is allowed as a fallback.

## 10. Tests required before implementation

Before this first observation point is implemented, the following tests should exist or be extended:

- existing gate decision remains unchanged when observation is disabled;
- observer does not run when default-off, kill switch, or sampling is disabled;
- collection-invoice observation only runs after the gate has already returned;
- Record Invoice never imports or invokes the observer;
- empty compliance profile maps to `source_incomplete` plus `compliance_profile_missing`;
- timeout and loader error stay silent to the caller;
- no checkout/provider/payment route is used as the first observation point;
- no route/action/page import exists outside the approved boundary.

## 11. Rollback plan

Rollback is simple: keep the shadow observer unimported or disable it via the server-only kill switch.

Because the observer is not authoritative and must not mutate state, rollback must not require:

- database changes;
- provider changes;
- response changes;
- cache invalidation;
- user-visible fallback messaging.

## 12. Criteria before enabling even sampled shadow mode

Even sampled shadow mode should not be enabled until all of the following are true:

- the observer module has reviewer-approved redacted diagnostics;
- the first observation point is attached only after the existing gate result;
- all tests for no-behavior-change pass;
- compliance profiles, limits, and entitlement sources are intentionally reviewed for that route class;
- the team has a rollback toggle that stops observation immediately without changing gates;
- there is explicit sign-off that the first observation point is collection-invoice access only, not checkout/provider/payment.

## 13. Adoption order

The adoption order remains:

1. keep the design only;
2. separately approve a tiny, default-off collection-invoice observation wrapper;
3. validate that the wrapper cannot change responses or state;
4. review shadow aggregates;
5. only then consider the next route class.

Record Invoice remains excluded from the first observation point and from all payment/provider observation paths.

