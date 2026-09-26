# Phase 2 Compliance/Admin Readiness Security Gate Closure

Date: 2026-09-26

## Gate Decision

**Status: CLOSED**

This checkpoint closes the Phase 2 compliance/admin readiness **security
gate**. It records completion of the durable CSRF/throttle substrate, guarded
admin-readiness route composition, staging and production route-security
validation, production admin-domain routing, and disabled-route concealment.

This decision does not claim that the entire PRD Phase 2 Compliance and Limit
Engine is complete. It does not authorize live M030 readiness, approval,
activation, collection, or commercial behavior.

## Production Evidence

- The local public-environment audit returned `PASS` for all five reviewed
  browser-visible variables:
  - `NEXT_PUBLIC_APP_ENV`
  - `NEXT_PUBLIC_APP_URL`
  - `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_SUPABASE_URL`
- Production route-security smoke passed while the route flag was temporarily
  enabled under the separately reviewed smoke gate:
  - `/issue` returned `201 csrf_issued`;
  - `/snapshot` without CSRF returned `400 csrf_denied`;
  - `/snapshot` with valid CSRF and a random UUID returned
    `404 canonical_snapshot_v2_request_missing`.
- The temporary `productionDiagnostic` response behavior was removed after
  diagnosis. It is not part of the permanent route contract.
- With the route flag disabled, both readiness endpoints are concealed:
  - `/issue` returns `404 not_found`;
  - `/snapshot` returns `404 not_found`.
- Disabled handling occurs before request parsing, environment/security
  configuration, Supabase client creation, CSRF/throttle work, database access,
  or readiness-service work.

## Corrected Production Environment Issue

The production failure was an environment credential mix-up:

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` incorrectly contained a `service_role` key;
- `SUPABASE_SERVICE_ROLE_KEY` contained the wrong secret API key rather than
  the required production service-role credential.

The values were corrected outside this documentation task. No value is
recorded here. The retained local audit subsequently returned `PASS` for all
five reviewed public variables, and the production route-security smoke then
passed.

## Final Safe Production State

- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=false`.
- Admin readiness issue and snapshot routes are concealed as `404 not_found`
  while disabled.
- The temporary production diagnostic is removed.
- Production admin portal paths remain exclusive to
  `https://admin.deraledger.com` under the reviewed host-routing guard.
- No live M030 readiness request is authorized by this checkpoint.
- No approval, activation, collection unlock, or commercial behavior is
  authorized by this checkpoint.

## Permanent Safeguards Retained

- Local value-free public-environment audit:
  `scripts/audit-readiness-public-env.ts`.
- Shared browser-environment classifier:
  `src/lib/compliance/admin-readiness-browser-environment-policy.ts`.
- Fail-closed production environment policy and server-only service-role
  boundary.
- Exact admin-origin and CORS checks.
- Server-derived super-admin authority and session-binding checks.
- Durable Supabase CSRF and throttle storage, with service-role-only access.
- Opaque response mapping and redacted logging.
- Disabled-first route gating and `404 not_found` concealment.
- Host-aware admin-domain routing that prevents public production domains from
  exposing operational portal paths.

## Explicitly Not Touched or Approved

- M030/live readiness issuance: `NO`.
- Approval execution: `NO`.
- Merchant activation: `NO`.
- Collection unlock: `NO`.
- Payment/provider/checkout/subscription/invoice/storefront behavior: `NO`.
- Database or SQL action by this checkpoint: `NO`.
- Environment, Vercel, deployment, or route-flag change by this checkpoint:
  `NO`.

## Next Safe PRD Gate

**PRD Phase 2A: Capability Contract.**

The next PRD implementation gate is the authoritative roadmap rebaseline's
explicit next safe commit:

```text
feat(compliance): add fail-closed merchant capability resolver
```

It is a source-only capability-contract gate for:

- a pure fail-closed `resolveMerchantCapabilities` resolver;
- normalized plan handling, including legacy plan aliases;
- narrow contracts and types; and
- focused unit tests.

It must not include:

- new routes or UI;
- migrations or runtime adoption;
- payment, provider, checkout, subscription, invoice, or storefront behavior;
- M030/live readiness or approval execution; or
- merchant activation or collection unlock.

This ordering follows `docs/phase-alignment-and-roadmap-rebaseline.md`,
sections **Authority**, **Missing PRD Phase 2 Work**, **Why
`resolveMerchantCapabilities` Is PRD Phase 2**, and **Next Safe Commit**. The
Smart Storefront PRD's section **32, Phase 2: Compliance and Limit Engine**
likewise makes a fail-closed compliance capability decision the prerequisite
for later operational and storefront behavior.

The admin UI integration/release gate remains a later readiness-specific gate.
It is not the next PRD implementation gate, and it does not authorize M030,
approval, activation, collection unlock, or commercial behavior.

## Documentation Ambiguity

The phrase "Phase 2" is used in two ways in the repository:

- the authoritative Smart Storefront PRD uses Phase 2 for the plan-neutral
  **Compliance and Limit Engine**;
- `docs/phase 2 full implementation plan.md` historically uses Phase 2 for the
  Solo Plus lifecycle now mapped to PRD Phase 3.

`docs/phase-alignment-and-roadmap-rebaseline.md` resolves this naming conflict
in favor of the Smart Storefront PRD. Therefore this checkpoint closes only
the named compliance/admin readiness security gate. A separate traceability
and exit decision is still required before anyone may claim all of canonical
PRD Phase 2 complete or move to the later admin UI integration/release,
storefront, M030, activation, or collection-unlock gates.

## Safe Next Step

Create a source-only PRD Phase 2A capability-contract plan or implementation
package for the pure fail-closed resolver, normalized plan handling,
contracts/types, and focused tests. It must not add routes, UI, migrations,
runtime adoption, M030, approval, activation, collection unlock, or commercial
behavior.
