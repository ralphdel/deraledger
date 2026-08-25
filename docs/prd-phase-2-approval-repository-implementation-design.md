# Approval repository implementation design

Date: 2026-08-25

## Status and scope

This is a source-only design for the two repositories already represented by
`approval-runtime-boundary-core.ts`. It authorizes no runtime adoption and
creates no database client, query, RPC call, migration, or write. Migration
026's approval RPC and Migration 027's diagnostic cleanup are already proven
database paths; this document does not expand their scope.

The future repositories must be server-only, narrow, injectable, and read-only.
They must return canonical facts to the existing boundary, which accepts from
the UI only a target compliance status and an optional safe reason code.

## Proposed modules

Later, separately reviewed implementations should be placed under the
compliance server boundary:

- `src/lib/compliance/server/approval-reviewer-identity-repository.ts` implements
  `ApprovalReviewerIdentityRepository`.
- `src/lib/compliance/server/canonical-approval-read-repository.ts` implements
  `CanonicalApprovalReadRepository`.
- `src/lib/compliance/server/approval-review-context-resolver.ts` may bind an
  already-authorized internal review work item to those two readers. It must
  not accept browser-selected profile, merchant, source, version, reviewer, or
  idempotency values.

Each module must begin with `import "server-only"`. They may use private,
injected narrow data-source dependencies, but must not export a Supabase client,
generic table query surface, generic RPC surface, service-role key, or mutation
API. The existing broad Solo Plus/admin service clients are useful examples of
session and super-admin checks, but are not suitable dependencies to re-export.

## Reviewer identity read

The identity repository should use the cookie-bound server auth client to read
the current authenticated user (`auth.getUser`) and return only the actor
classification and immutable user ID required by the runtime-boundary
interface.

The only currently authorized actor is a `super_admin`, derived by the existing
server-side convention (`app_metadata.is_super_admin === true` or
`user_metadata.is_super_admin === true`). `requireAdminPortalSession` alone is
not sufficient: its cookie does not identify a reviewer or prove a scoped
authorization grant. The implementation must reject a missing session, missing
user ID, browser-supplied identity, merchant owner, merchant team member,
customer, and anonymous caller before canonical profile/source reads.

`compliance_reviewer_deferred` may remain representable in types but must be
denied. A future approval-capable compliance-reviewer role needs an independent
platform-scoped RBAC design with grant provenance, revocation, expiry, audit,
and conflict rules. Merchant/team roles can never substitute for it.

## Canonical approval read

The reader must be initiated from a trusted server-internal review context. The
current runtime-boundary UI contract intentionally contains no selector, so a
future route/action design must first resolve its own protected review work
item; it may not pass UI IDs into this repository as authority.

The reader must fail closed unless each relevant lookup returns exactly one row.
It should derive and cross-check the following immediately before command
construction:

| Canonical fact | Required derivation and cross-check |
| --- | --- |
| Profile and merchant | One `merchant_compliance_profiles` row associated with the protected review context; reject missing, duplicate, stale, or non-positive `row_version`. |
| Workspace | `merchant_compliance_profiles` has no `workspace_id`; derive exactly one approved workspace association from a separately designed trusted server read, then cross-check its merchant. |
| Plan/status/version | Read `plan_code`, current pending/attention-compatible `compliance_status`, and current profile `row_version`; do not accept UI copies. |
| Lite/Business source | One `merchant_compliance_reviews` row matching ID, merchant, profile, mapped `review_type` (`solo_lite` or `business_kyb`), `target_plan_code`, allowed pending/needs-attention status, and current `row_version`. |
| Solo Plus source | One `solo_plus_cases` row matched by the profile's approved source linkage, merchant, `target_plan`, case decision state, and current source version. Do not assume a `profile_id` column on the case table if the schema does not provide one. |
| Source linkage | The profile's `decision_source_type`, `decision_source_id`, and `decision_source_version` must match the derived source before a command is created. |
| Policy/reason/target | Resolve policy from an approved server policy registry/workflow context; validate target and reason against the existing command contract. |
| Reviewer/time | Use the identity repository's user ID and a server-generated timestamp only. |

The repository remains a precondition reader. Migration 026 remains the
authoritative atomic writer: it locks the profile and repeats source,
row-version, transition, idempotency, profile-update, and event-append checks.

## Idempotency design

The reader must not manufacture durable idempotency by writing directly to a
compliance table. Migration 026's event is the durable replay record only after
the RPC succeeds. A future runtime workflow therefore needs a separately
reviewed server-owned decision-request/idempotency authority that binds one
opaque key to reviewer, profile, source, target, policy, and safe reason across
retries. It must never take that key from the UI as authority or derive it from
a predictable browser-visible hash.

Until that authority exists, `reconcileDecisionIdempotency` must fail closed
and runtime adoption remains blocked.

## Current gaps and future database design

The following gaps require separate design/review before repository
implementation or runtime adoption:

- There is no active platform-scoped `compliance_reviewer` role; only the
  current super-admin metadata convention is available.
- Profiles do not contain `workspace_id`; a canonical one-to-one
  merchant/workspace relationship and conflict handling must be specified.
- Although the substrate has a review `policy_version` column, the deployed
  Migration 025 bootstrap path may create Lite/Business review rows without a
  policy version. The repository needs an immutable, approved policy registry
  or review-work-item policy reference rather than a UI fallback.
- A durable server-owned approval-decision idempotency/request record is not
  yet defined.
- Solo Plus source correlation must use the actually supported case fields and
  profile decision-source linkage; no inferred case-to-profile column may be
  introduced in application code.

Possible future additive SQL/RPC work is therefore a separate package, not a
change to M026/M027: a service-role-only canonical approval snapshot reader or
view, an immutable review-work-item/idempotency authority, and, only if
required, a platform reviewer-grant model. Each would require source review,
disposable local rehearsal, staging preflight/apply/postflight, and a separate
production approval. No database change is authorized by this document.

## Security and prohibited-write boundary

Repositories may perform only server-side canonical reads. They must expose
safe absence/conflict/staleness outcomes rather than raw database errors. They
must not write or expose operations for merchants, workspaces, subscriptions,
invoices, payments, providers, settlement, limits, capabilities, or storefront
resources.

They must not change `setup_mode`, `live_features_enabled`, collection
entitlements, or `activation_status`, and must not initialize checkout, call a
provider, approve a payment, or activate/unlock collection. Approval remains a
profile-decision transition plus the RPC's append-only compliance event; it is
not activation or commercial entitlement.

## Safe next steps

1. Independently review this repository design and resolve the listed
   canonical-context, workspace, policy, and durable-idempotency gaps.
2. Design any required additive SQL/RPC package separately and rehearse it on a
   disposable local database before staging or production consideration.
3. Implement fake-backed, server-only repositories only after those decisions;
   keep them unimported by routes, actions, pages, and webhooks.
4. Consider runtime adoption only after an additional authorization/API design,
   repository tests, and a separately approved runtime gate. Collection remains
   locked throughout.
