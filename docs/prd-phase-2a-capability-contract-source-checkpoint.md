# PRD Phase 2A Capability Contract Source Checkpoint

Date: 2026-09-26

## Objective

Start the authoritative PRD Phase 2A Capability Contract by recording the
pure, deterministic, fail-closed `resolveMerchantCapabilities` contract and
its focused regression coverage.

## Contract Scope

`src/lib/compliance/merchant-capabilities.ts` defines explicit input, output,
entitlement, compliance, activation, risk, restriction, settlement, limit, and
blocking-reason contracts. The resolver has no I/O, database access, route,
environment, clock, or network dependency.

It normalizes plan codes through the shared plan catalog, including:

- `individual` to `solo_lite`;
- `corporate` to `business`; and
- canonical `starter`, `solo_lite`, `solo_plus`, and `business` codes.

Unknown or missing plans remain unrecognized and deny live capabilities rather
than falling back to an entitled plan.

## Fail-Closed Rules

Live collection, checkout, storefront, Instant Sale, Receivable Sale, and
Deposit & Balance remain denied unless every relevant contract input is
explicitly accepted. This includes a recognized non-Starter plan, active paid
entitlement, plan-appropriate verified compliance status, final approval,
acceptable risk, active restriction state, completed setup, enabled live
features, required flags and merchant entitlements, verified settlement
readiness, and an approved unused collection limit.

Starter remains limited to offline Record Invoice bookkeeping. Payment alone,
an inactive or expired entitlement, pending or rejected compliance, missing
inputs, an unknown plan, or incomplete verification cannot unlock a live
capability.

## Focused Coverage

`tests/merchant-capabilities.test.ts` covers Starter/default denial, Solo Lite
and legacy `individual`, Solo Plus, Business and legacy `corporate`, unknown
and missing plans, inactive/expired/cancelled entitlements, pending and
rejected compliance, approved compliance, feature and merchant entitlement
requirements, settlement and collection-limit gates, and deterministic
non-mutating resolution.

## Boundary

This is a contract-only checkpoint. It adds no route, UI, migration, database
operation, runtime adoption, environment change, payment/provider/checkout/
subscription/invoice/storefront behavior, M030/live readiness, approval
execution, merchant activation, or collection unlock.

Later PRD Phase 2B, 2C, and 2D gates remain separately approved work.
