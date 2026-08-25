# PRD Phase 2 Approval RPC Source Package Checkpoint

Status: Migration 026 local install/security rehearsal is PARTIAL PASS: preflight, first apply, second apply/idempotency, and postflight passed on a disposable local database. Behavior/rollback rehearsal remains incomplete; Migration 026 has not been applied to staging or production.

## Package scope

Migration 026 prepares `public.review_compliance_profile_decision_v1(...)`, its staging preflight/postflight scripts, and static schema regression test. The intended RPC is `SECURITY INVOKER`, uses `search_path = pg_catalog, public`, revokes execution from `PUBLIC`, `anon`, and `authenticated`, and grants execution only to `service_role`.

The source package supports canonical Solo Lite, Solo Plus, and Business profile decision transitions from their pending/attention states to plan-matching verified, `needs_attention`, `restricted`, or `rejected` outcomes. It locks the profile and trusted review/case source, enforces row-version and exact idempotency checks, updates only reviewed profile-decision fields, and appends one `merchant_compliance_events` row.

## Deliberate write boundary

The RPC may write only `merchant_compliance_profiles` and `merchant_compliance_events`. It validates existing Lite/Business review rows and Solo Plus cases as decision sources but never creates or changes them. It creates no profile, review, limit, reservation, usage event, payout, provider, payment, invoice, subscription, merchant, or workspace record.

All collection entitlements must already be false before a transition and are not written by this RPC. The RPC never sets `setup_mode=false`, `live_features_enabled=true`, `can_collect_payments=true`, or `activation_status='active'`. A `risk_suspended` restriction outcome remains non-operational through `activation_status=suspended` and `restriction_state=suspended`.

## Compatibility and fail-closed notes

Migration 024 supports every profile status used by this package. It does not permit `activation_status='active'`; this RPC does not attempt it. `verification_pending` and `manual_review` remain Solo Plus case states, not profile statuses; the package maps profile more-information requests to `needs_attention`.

The independent source review found that Migration 025 creates Lite/Business review rows as `pending` and without a policy-version value. Migration 026 was repaired to treat those rows as submission/evidence sources in `pending` or `needs_attention`; the trusted service-role approval command supplies the reviewer, decision, policy version, reviewed time, and safe reason. The narrow RPC does not mutate the review row. Solo Plus keeps its distinct case-decision validation boundary.

The review also found missing-table-sensitive preflight casts that could terminate before the required compact summary. Migration 026 preflight now uses `to_regclass(...)` for those checks so absent Migration 024 prerequisites produce `FAIL` rows and `summary FAIL` instead of a relation-resolution crash. Replay comparison now includes reviewer, plan, and complete non-operational target state.

The first local Lite approval invocation exposed an append-only event-lock mismatch: the RPC attempted `SELECT ... FOR UPDATE` on `merchant_compliance_events`, while Migration 024 correctly grants `service_role` only `SELECT, INSERT` on that append-only table. The RPC now reads the idempotency event without an update lock; profile and trusted source locks remain the serialization boundary. A second local run still returned a generic atomic failure, so the package now records only safe stage-specific codes (including profile-update and event-insert failures) and the local harness collects all scenario results before one final failure. No raw SQL errors are returned by the RPC.

The database has no canonical internal-compliance-role table. The package revalidates that the reviewer UUID exists in `auth.users`, while internal reviewer/operator authorization remains a required trusted server-side boundary before service-role invocation. It does not infer authorization from browser input.

## Required validation before any apply

The local install/security sequence has passed, but the repaired package requires a fresh disposable local behavior/rollback rehearsal before staging can be considered. That rehearsal must prove allowed transitions, exact grants, hostile-role denial, sequential replay, stale/ambiguous failures, late-write rollback, and absence of forbidden writes. Only after a full local PASS may separately approved staging preflight/apply/postflight be prepared.

Production remains unchanged: Migration 024 and 025 are applied, collection is locked, `setup_mode=true`, `live_features_enabled=false`, and no runtime route/action imports this future approval RPC.
