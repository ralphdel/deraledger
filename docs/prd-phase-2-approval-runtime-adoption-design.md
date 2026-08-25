# Approval RPC authorized runtime workflow design

Date: 2026-08-25

## Status and purpose

Migration 026's approval RPC and Migration 027's cleanup are installed and verified, while the command validator, executor bridge, adapter, and narrow service-role transport remain source-only. This document designs a future authorized workflow; it does not adopt one.

Approval changes a reviewed compliance profile decision only. It is not merchant activation, collection enablement, payout/provider readiness, payment processing, checkout initialization, subscription state, invoice state, or storefront release.

## Existing pattern review and proposed entrypoint

The closest reference pattern is `createSoloPlusReviewerService`: a server-only service resolves an authenticated super-admin before obtaining a service-role-backed repository, takes explicit idempotency/version fields, and performs a narrow decision. Its Solo Plus service-role factory must not be reused for compliance approval because it is broad and coupled to payment and activation workflows.

The existing `src/lib/actions.ts` manual verification actions must not be extended to call the new RPC. They carry legacy verification behavior and are not the approval-RPC authority boundary.

The future entrypoint should instead be a new server-only service:

`src/lib/compliance/server/reviewed-profile-approval-service.ts`

It should be invoked only by a future internal admin/compliance-review API handler after a separate route/UI adoption review. The handler is not an RPC proxy and must never pass browser authority or database credentials to the client. The service performs, in order:

1. Resolve the authenticated internal operator through a dedicated RBAC helper.
2. Require an explicit `super_admin`/compliance-reviewer authorization grant. Merchant owner, workspace member, team member, customer, unauthenticated, and ordinary authenticated users are denied.
3. Resolve the canonical reviewer ID from the server session, never from the browser payload.
4. Resolve canonical merchant/profile/source facts from a separately designed trusted read boundary; reject missing, multiple, stale, or cross-merchant records.
5. Build `ComplianceProfileApprovalCommandRequest` using trusted identity, reviewer, evidence, and server-generated/reconciled idempotency data.
6. Create the compliance-owned transport and adapter, then call `executeComplianceProfileApprovalRpcTransaction` with `databaseRole: "service_role"` and `internalReviewAuthorized: true` only after the prior checks pass.
7. Return a safe response object; never return a service-role transport, raw RPC row, database error, credential, or evidence payload.

No existing route, page, action, webhook, or background task is authorized to implement this sequence yet.

## Required decision contract

The server workflow owns the full decision intent and forwards the exact fields below to the command/adapter/RPC chain:

| Field | Trusted source / rule |
| --- | --- |
| `merchant_id` | Canonical profile lookup, not browser authority. |
| `profile_id` | Exact canonical compliance profile; one row only. |
| `plan_code` | Canonical profile/source plan; must match the allowed transition. |
| `source_type` | `solo_lite_review`, `business_kyb_review`, or `solo_plus_case`. |
| `source_id` | Canonical review/case record ID. |
| `source_version` | Canonical evidence/review/case version. |
| `target_compliance_status` | Reviewer-selected allowlisted decision only. |
| `expected_profile_row_version` | Canonical profile version re-read immediately before the decision. |
| `reviewer_id` | Authenticated authorized operator ID, server-derived. |
| `decision_idempotency_key` | Server-generated or server-reconciled immutable decision key. |
| `policy_version` | Approved policy version selected server-side. |
| `reviewed_at` | Server-issued review timestamp, not browser time. |
| `reason_code` | Allowlisted safe code; required for rejected/restricted/needs-attention outcomes. |

The UI may propose a target and safe reason code. It may not supply reviewer identity, source authority, row versions, profile identity, policy version, or an idempotency key as trusted facts without server verification.

## Authorization and browser boundary

The future API must use an internal session/RBAC helper that validates authenticated user identity and a distinct compliance-reviewer or super-admin capability. Authorization must be checked before canonical reads or transport construction. It must reject any impersonation header, merchant/team role, public token, service-role-looking input, client-provided reviewer ID, or direct browser call to the approval RPC.

The browser can call only the future authenticated internal API. Database EXECUTE remains service-role-only; `PUBLIC`, `anon`, and `authenticated` cannot execute the RPC. The service-role key remains private in the server-only transport.

## Result and UI/API mapping

| Internal outcome | Future safe API/UI response |
| --- | --- |
| `created` | `decision_recorded`; show profile/event IDs only where the internal admin UI is authorized. |
| `replay` | `decision_already_recorded`; show a non-error idempotent result. |
| `preserved` | `profile_not_changed`; require a fresh review workflow for a preserved state. |
| command/RPC stale-version rejection | `review_state_changed`; refresh canonical review data. |
| source/transition/reviewer rejection | `decision_not_accepted`; show only a mapped safe reason. |
| transport or malformed/unknown response | `decision_unavailable`; do not claim success; retry only with the same key after investigation. |

No raw SQL, transport, auth, source evidence, policy internals, or secret detail may appear in API or UI responses. Unknown result codes are always fail-closed and must be logged only as a safe internal diagnostic category.

## Fail-closed rules

- Unauthorized caller: deny before reads, adapter construction, or RPC invocation.
- Stale row version: return `review_state_changed`; no retry with a changed version without a new review decision.
- Replay mismatch: return conflict; never reinterpret or overwrite the prior decision key.
- Missing/ambiguous source or cross-merchant/profile source: reject and record no decision.
- Unsupported plan/source/target/status transition: reject through the validator/RPC safe result code.
- Transport failure, malformed RPC response, or unknown result: return unavailable; no success response and no alternate table write.
- All non-success outcomes leave activation and collection state unchanged.

## Audit model

On an applied decision, the RPC atomically updates only the approved profile decision fields and appends one immutable `merchant_compliance_events` event. The event already binds before/after safe state, reviewer actor, source, policy version, idempotency key, expected/resulting versions, and safe reason code.

The future service should produce structured, redacted operational telemetry for attempt/outcome categories and request correlation, but must not duplicate the compliance decision event or store raw evidence/secrets. Replay should be observable as replay, not a second decision. Failed authorization attempts may be security-audited by the existing internal security logging mechanism only if that mechanism is separately reviewed for retention and redaction.

## Explicit non-activation and prohibited-write boundary

This workflow must not set `setup_mode=false`, `live_features_enabled=true`, any collection entitlement, or `activation_status='active'`. It must not create limits, modify merchant/workspace state, call providers, initialize checkout, create payment records, modify subscriptions/invoices, or begin storefront behavior. Approval output can later be a prerequisite for a separately designed activation transition only.

## Adoption gates

1. Independently review this design and the source-only transport/bridge.
2. Design and test the dedicated compliance-reviewer RBAC helper and canonical read boundary.
3. Design the internal admin API contract and UI with no direct RPC/browser capability.
4. Add source tests for authorization, input canonicalization, idempotency, response redaction, and no forbidden runtime imports/writes.
5. Rehearse the full server workflow with fakes before any controlled runtime adoption proposal.
6. Obtain separate explicit approval for a limited internal runtime rollout; collection remains locked.
