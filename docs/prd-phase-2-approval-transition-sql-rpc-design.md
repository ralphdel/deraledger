# PRD Phase 2 Approval Transition SQL/RPC Package Design

Status: design-only. This document authorizes no SQL, migration, database connection, profile decision, runtime call site, activation, collection unlock, payment test, or production behavior change.

## 1. Purpose

The future approval RPC is a narrow, service-role-only transaction for recording a reviewed compliance decision on one existing compliance profile. It may move a plan-matching profile from a canonical pending or attention-required state to the appropriate verified, `rejected`, `restricted`, or `needs_attention` state, and append one immutable decision event.

The RPC consumes a validated, trusted approval command; it is not a browser-facing review surface and is not the source of review evidence. Its job is to persist an already authorized decision atomically and fail closed if the profile, decision source, row version, authorization, or idempotency state is missing, stale, conflicting, or ambiguous.

`verification_pending` and `manual_review` are not canonical `merchant_compliance_profiles.compliance_status` literals in Migration 024 or the current source contracts. This package must not introduce them. A request for more evidence is represented by `needs_attention`; a pending path remains `lite_pending`, `enhanced_pending`, or `business_pending`.

## 2. Explicit non-activation boundary

Approval establishes a reviewed compliance outcome only. It is separate from paid subscription entitlement, bootstrap, limit approval, payout verification, provider/environment settlement mapping, and merchant activation.

The future RPC must never:

- set `setup_mode = false` or `live_features_enabled = true`;
- set `can_collect_payments = true`, or set any other merchant entitlement true;
- set `activation_status = active` (that literal is not permitted by Migration 024 and remains separately schema-blocked);
- create or update limit windows, reservations, links, usage events, or approved limits;
- create payout or provider readiness, call a provider, initialize checkout, create payment records, or create collection invoices;
- update merchants, workspaces, subscriptions, invoices, payment records, provider configuration, settlement accounts, or runtime feature flags.

A verified outcome may later be an activation prerequisite, but can never activate collection by itself. Until a separately reviewed and rehearsed activation path exists, production remains `setup_mode=true`, `live_features_enabled=false`, and collection locked.

## 3. Decision scope and canonical transitions

The first package should support only these reviewed decisions:

| Plan path | Allowed source state | Verified target | Other targets |
| --- | --- | --- | --- |
| Solo Lite | `lite_pending` or `needs_attention` | `lite_verified` | `needs_attention`, `restricted`, `rejected` |
| Solo Plus | `enhanced_pending` or `needs_attention` | `enhanced_verified` | `needs_attention`, `restricted`, `rejected` |
| Business | `business_pending` or `needs_attention` | `business_verified` | `needs_attention`, `restricted`, `rejected` |

For Lite and Business, the trusted decision source is the matching existing `merchant_compliance_reviews` row (`solo_lite` or `business_kyb`). For Solo Plus, it is the existing trusted `solo_plus_case`. The RPC validates the relevant source’s identity, plan, decision/evidence version, and reviewed outcome, but the first narrow RPC does not create a compliance review row and does not update the Solo Plus case. Any source-decision mutation belongs to its separately authorized review/case workflow and must precede this RPC.

`restricted` requires an explicit safe restriction reason and a non-operational profile state. A suspension is not a compliance-status literal: it is represented by `restriction_state = suspended` and `activation_status = suspended`, while the profile retains a canonical reviewed status, normally `restricted`. Rejection, restriction, suspension, and needs-attention outcomes stay non-operational. Existing verified, rejected, restricted, or suspended profiles are preserved unless a separately approved re-review or re-lock transition authorizes a change.

Unsupported plan/status combinations, a source-plan mismatch, missing source evidence, invalid reviewer authorization, a stale row version, duplicate rows, or an unsupported target return safe fail-closed result codes such as `approval_source_target_mismatch`, `approval_evidence_incomplete`, `approval_profile_preserved`, `approval_row_version_conflict`, `approval_ambiguous_state`, or `approval_payload_invalid`.

## 4. Authorization and deterministic RPC boundary

The future migration must define one deterministic, versioned function signature. The signature should accept only the minimum validated command data: trusted merchant/workspace identity, plan and canonical source/target state, server-generated approval decision key, expected profile row version, trusted reviewer ID, reviewed source type/ID and version, reviewed timestamp, policy version, and allowlisted safe reason code where required. It must not accept browser authority, raw evidence, raw risk notes, payment/provider payloads, or setup/live state as approval authority.

The function must be `SECURITY INVOKER`, use a hardened `search_path` (at least `pg_catalog, public`), and have execute privileges only for `service_role`. The migration must revoke execution from `PUBLIC`, `anon`, and `authenticated`; it must not create browser-accessible table grants or policies. The calling server boundary must establish internal-compliance-reviewer or compliance-operator authorization before constructing a service-role transaction client.

## 5. Required atomic transaction

The future RPC must perform the following in one PostgreSQL transaction, returning success only after commit:

1. Revalidate required non-empty identifiers, canonical plan/state values, reason-code requirements, and non-operational target fields.
2. Lock and read exactly one target `merchant_compliance_profiles` row by trusted `merchant_id`.
3. Lock and validate the corresponding Lite/Business review or Solo Plus case decision source, plus the approval-event idempotency key.
4. Re-read the profile’s expected row version, plan code, source state, preservation state, source linkage, evidence/decision version, policy version, and reviewer/operator authorization.
5. Resolve a matching replay, a preservation result, or a safe rejection before any mutation.
6. Conditionally update only the profile’s reviewed-decision fields, incrementing `row_version` exactly once.
7. Append exactly one `merchant_compliance_events` decision event containing the matching resulting version.
8. Commit both writes together, or roll back all work on any error.

The profile update may change only canonical compliance-decision fields: `compliance_status`, non-operational `activation_status`/`restriction_state` when required by a restriction outcome, safe restriction fields, `decision_source_type`, `decision_source_id`, `decision_source_version`, `last_reviewed_at`, `next_review_due_at` when policy requires it, `reviewed_by`, `policy_version`, and `row_version`. It must preserve every entitlement as `false` and must not write limit, payout, provider, or activation data.

## 6. Idempotency, concurrency, and preservation

The decision idempotency key is scoped to the merchant’s append-only event stream. The RPC locks and checks it before changing the profile.

- A replay is safe only if one existing event matches the merchant, profile, decision key, source type/ID/version, target state, expected/resulting versions, policy version, and safe reason code. It returns the original opaque result without a second update or event.
- A reused key that differs in plan, source, target, expected version, policy version, or reason fails closed as `approval_idempotency_conflict`.
- Zero or more than one matching profile, source, or event where a unique row is required is an ambiguity failure; the function must not select an arbitrary row.
- A changed profile row version is `approval_row_version_conflict`; it creates no event and performs no update.
- Existing verified, rejected, restricted, or suspended state returns `approval_profile_preserved` unless an explicitly designed later transition permits re-review. It never silently overwrites, downgrades, or reactivates that profile.

## 7. Append-only audit event and safe diagnostics

Each state-changing decision appends one `merchant_compliance_events` row with an allowlisted event type such as `compliance_profile_approval_v1`. Its redacted shape includes:

- safe before/after profile state;
- a redacted actor snapshot (`actor_type = admin` and trusted reviewer identifier stored only where the schema permits);
- trusted source type/ID, policy version, and safe reason code;
- expected and resulting profile row versions; and
- decision idempotency key plus minimal allowlisted metadata identifying this transition version.

The event and returned diagnostics must not expose BVN/NIN/CAC, selfie or evidence contents, bank data, provider/payment references or payloads, risk notes, decision notes, raw IDs to an untrusted caller, headers, cookies, tokens, credentials, or raw database errors. Stable reason codes are sufficient for operations and shadow diagnostics.

## 8. Allowed and prohibited future writes

The first approval-RPC package may write only:

- `public.merchant_compliance_profiles`: the reviewed-decision fields listed in the transaction boundary; and
- `public.merchant_compliance_events`: one append-only event for a successful state-changing decision.

It may lock/read the corresponding existing compliance review or Solo Plus case decision source, but must not create or mutate that source in this narrow package. It may not write any other table.

In particular, it may not write merchant/workspace setup or live flags, merchant entitlements, limits, payout/provider state, subscriptions, invoices, payment records, settlement state, or an `active` activation status.

## 9. RLS and grants posture

Migration 024’s service-only posture remains authoritative: RLS stays enabled with zero browser policies, and `PUBLIC`, `anon`, and `authenticated` retain no compliance-table grants. The approval migration must retain that posture, use `SECURITY INVOKER`, revoke all default function execute privileges, and grant execute only to `service_role`.

Preflight must reject missing/incorrect Migration 024 prerequisites; conflicting overloads; incompatible table types, columns, constraints, or RLS/policy/grant state; and unexpected function grants. Postflight must verify the exact function signature, `SECURITY INVOKER`, hardened `search_path`, service-role-only execute privilege, browser/public execute denial, unchanged zero browser policies, permitted table grants only, and no business rows created by installation.

## 10. Rehearsal and rollout gates

Before any SQL package is prepared, this design requires approval of the exact signature, safe result-code taxonomy, review/case evidence interface, reviewer authorization boundary, write-set static tests, preflight, postflight, and rollback cases.

Before staging, a disposable local PostgreSQL rehearsal must prove first apply, second apply/idempotency, postflight, service-role execution, PUBLIC/anon/authenticated denial, every allowed plan transition, `needs_attention`/rejected/restricted handling, replay consistency, stale-version and duplicate-state failures, and late profile/event failure rollback. It must also prove no forbidden-table writes and no entitlement/setup/live/provider/checkout mutation. The local harness must reject staging- and production-looking connection strings and credentials.

The rollout sequence is:

1. Design and independent source review.
2. A separately approved SQL migration/preflight/postflight/static-test package.
3. Clean disposable local rehearsal, including rollback and hostile-grant checks.
4. Separately approved staging preflight, first apply, second apply/idempotency, and postflight.
5. Separately approved production preflight, first apply, second apply/idempotency, and postflight.
6. A checkpoint documenting the database result.
7. A separate runtime-adoption plan and approval; no route/action imports are authorized by this package.

Migration 025’s bootstrap RPC has completed local, staging, and production verification, but that does not authorize this new approval SQL/RPC package or runtime adoption.

## 11. Current safety status and next boundary

Production has Migration 024’s empty compliance/limit substrate and Migration 025’s reviewed-profile bootstrap RPC path. This approval design changes neither. No profile approval is executed, no compliance/limit rows are inserted, `setup_mode` stays `true`, `live_features_enabled` stays `false`, and collection remains locked.

The safe next step is an independent review of this design followed, only if approved, by a source-only approval-RPC migration package with preflight/postflight and static contract tests. Runtime wiring, collection unlock, provider work, checkout, payment tests, and storefront work remain prohibited.
