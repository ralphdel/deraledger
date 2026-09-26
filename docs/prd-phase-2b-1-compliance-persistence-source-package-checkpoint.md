# PRD Phase 2B-1 Compliance Persistence Source Package Checkpoint

**Date:** 2026-09-26  
**Status:** SOURCE PACKAGE ONLY — not approved for database execution  
**PRD gate:** Phase 2B-1 — Compliance Persistence migration/RLS package

## Objective

Record the additive, fail-closed compliance-persistence source package that supplies the canonical profile and supporting review/audit/limit-accounting schema for a future trusted capability adapter. It does not connect to, inspect, migrate, or mutate a database.

The existing package is deliberately retained instead of creating a duplicate table migration:

- Migration: `supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql` (Migration 024)
- Source manifests: `supabase/staging/preflight/024_prd_phase_2_compliance_schema_substrate_snapshot.sql` and `supabase/staging/postflight/024_prd_phase_2_compliance_schema_substrate_verify.sql`
- Static source check: `tests/prd-phase-2-compliance-schema-substrate.test.ts`

This checkpoint does **not** claim that Migration 024 is applied, populated, or authoritative in local, staging, or production.

## Source package boundary

Migration 024 is additive, empty, and inert. It creates seven service-only base tables:

1. `merchant_compliance_profiles`
2. `merchant_compliance_reviews`
3. `merchant_compliance_events`
4. `merchant_collection_limit_windows`
5. `merchant_collection_limit_reservations`
6. `merchant_collection_limit_reservation_windows`
7. `merchant_collection_usage_events`

It contains no data backfill, transition/approval/activation RPC, trigger, browser policy, route, provider/payment change, or runtime adoption. Existing subscription, merchant/workspace, verification, Solo Plus, payout, provider-mapping, payment, and invoice sources remain owners of their respective facts.

## Canonical `merchant_compliance_profiles` contract

The profile supplies the reviewed merchant-side capability decision facts:

| Capability fact | Canonical profile field(s) | Safe source posture |
| --- | --- | --- |
| Merchant identity | `merchant_id uuid NOT NULL`, unique, FK to `merchants(id)` with `ON DELETE RESTRICT` | One profile per merchant; no profile is a denial. |
| Normalized plan snapshot | `plan_code text NOT NULL` constrained to `starter`, `solo_lite`, `solo_plus`, `business` | Legacy aliases normalize at the TypeScript boundary; the snapshot does not replace active entitlement resolution. |
| Business/compliance/verification decision | `business_type`, `compliance_status` (default `draft`) and review/provenance fields | Missing/draft/pending/rejected status does not unlock. Legacy evidence requires a later reviewed projection. |
| Approval and activation decision | `activation_status` (default `test_mode`), review timestamps/actor and decision source | This records no live activation action; only a later audited transition may reach a resolver-valid approved state. |
| Risk/restriction | `risk_rating`, `restriction_state`, reason and review fields | Unknown remains nullable and denies downstream; `restriction_state` has no permissive default. |
| Merchant feature entitlements | `can_collect_payments`, `can_use_instant_sale`, `can_use_receivable_sale`, `can_use_storefront`, `can_activate_settlement`, `can_use_deposit_balance` | All are `NOT NULL DEFAULT false`; plan/dependency checks prevent permissive combinations. |
| Reviewed limits | limit basis, approved volume/caps, `collection_limit_approved DEFAULT false`, approval provenance | Null is never unlimited; a numeric value alone is not approval. |
| Audit/concurrency | policy/source/version/review fields, `row_version DEFAULT 1`, timestamps | Supports later trusted reviewed transitions; no current write path is introduced. |

The profile intentionally does **not** duplicate active subscription state, setup/live locks, selected payout account, provider settlement mapping, or global rollout switches. Those facts have existing owning domains and require a future server-only adapter to reconcile exact trusted reads. Their absence or inconsistency remains a denial.

## Fail-closed defaults and constraints

- No profile row, or an absent/ambiguous/malformed source, must supply missing/false inputs to `resolveMerchantCapabilities`.
- `compliance_status` defaults to `draft`; `activation_status` defaults to `test_mode`; risk/restriction/limits are not permissively defaulted.
- Every merchant feature entitlement defaults to `false`; no default permits collection, checkout, live storefront, Instant Sale, Receivable Sale, settlement activation, or Deposit & Balance.
- `collection_limit_approved` defaults to `false`; approved limits require a non-`none` basis, timestamp, and actor.
- Check constraints enforce the canonical plan/status/risk/restriction/limit-basis allowlists, non-negative/positive monetary semantics, decision-source pairing, positive row version, and feature dependencies.
- Starter and Solo Lite cannot persist Receivable Sale or Deposit & Balance entitlement; Receivable Sale requires collection entitlement; Deposit & Balance requires Receivable Sale.
- `cumulative_collection_used` is a reconciliation/display projection only. Future authorization must use locked limit windows, reservations, and immutable usage events rather than this profile field.

## RLS and security manifest

All seven tables have the same base boundary:

| Control | Required source state |
| --- | --- |
| RLS | Enabled on every table. |
| Browser policies | Intentionally none. |
| Browser privileges | `PUBLIC`, `anon`, and `authenticated` receive no privileges after explicit revocation. |
| Service-role privileges | Explicit least privilege only: profile/review/window/reservation tables receive only required `SELECT`/`INSERT`/`UPDATE`; event, usage, and reservation-window tables are append-only (`SELECT`/`INSERT`); no `DELETE` grant. |
| Browser data exposure | No direct profile, review, event, limit, risk, restriction-note, or evidence access; no service-role key is exposed. |
| Capability authority | A merchant-controlled field, browser input, payment/provider setting, or legacy verification flag cannot unlock a capability. |

The migration itself creates no RLS policy, function, trigger, or RPC. The static source test checks explicit RLS, revoke/grant statements, absence of permissive policies, absence of direct data mutations, absence of broad business-table alteration, and the expected source manifests.

## Constraints, indexes, and audit posture

- All foreign keys use restricted deletion; no cascade, `SET NULL`, or cleanup trigger is introduced.
- The profile has a unique merchant key and server lookup index over merchant/plan/compliance/activation/restriction state.
- Review, event, window, reservation, junction, and usage tables have source-defined uniqueness and lookup indexes for later trusted processing.
- Review/event provenance and positive row versions are retained for later idempotent, optimistic-concurrency-safe commands.
- This migration creates no rows and no automatic `updated_at` trigger; future reviewed commands own writes explicitly.

## Deliberately deferred work

1. Trusted repository/adapter implementation and runtime adoption.
2. Active-entitlement precedence/reconciliation across subscription sources.
3. Profile bootstrap/backfill and reviewed Lite, Enhanced, and Business KYB projections.
4. Approval, activation/re-lock, restriction, and review transition commands/RPCs.
5. Atomic reservation/commit/release and authoritative capacity enforcement; the schema is inert until that separate design is approved.
6. Global feature-flag names, environment scope, and precedence.
7. Settlement-account/provider-mapping selection and freshness policy.
8. Routes, UI, payment/provider/checkout/subscription/invoice/storefront behavior, M030/live readiness, merchant activation, and collection unlock.

## Product-owner decisions still required

- Confirm the business-type, compliance, activation, risk, restriction, limit-basis, and decision-source enumerations.
- Define the reviewed state combinations that may set each entitlement boolean, with payment remaining insufficient.
- Define plan/risk/business-type-specific amounts, units, reset rules, approved-volume semantics, and remaining-capacity calculations.
- Define review evidence, actor authority, re-review/revocation, transition idempotency, and retained audit policy.
- Define global rollout keys and exact feature precedence.
- Define settlement/provider selection and freshness conflict rules.

## Future database-execution gate

Database execution requires separate approval and the mandatory migration safety process: source review, disposable hostile/default-grant harness, read-only preflight, manual staging apply/postflight, independent review, and a separately approved production sequence. A `FAIL` or `BLOCKED` result stops the next stage.

## Source-only safety statement

- No database connection or execution occurred.
- No local, staging, or production database was touched.
- No environment, Vercel configuration, deployment, route flag, route, UI, or runtime behavior was changed.
- No payment/provider/checkout/subscription/invoice/storefront behavior, approval execution, merchant activation, collection unlock, or M030/live readiness occurred.
