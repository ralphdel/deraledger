# Canonical approval snapshot and decision-idempotency package design

Date: 2026-08-25

## Status and purpose

This is a design-only proposal for the additive database package required
before implementing the server-only approval repositories. It addresses the
canonical review context, workspace, policy provenance, and durable
idempotency gaps identified by the approval repository design.

It creates no SQL, migration, data, RPC call, runtime entrypoint, or approval
decision. Migration 026's cleaned approval RPC remains the only future writer
of compliance profile decision fields and compliance events. This package is
not activation, collection entitlement, checkout, payment, or provider work.

## Proposed Migration 028 scope

Subject to a separate source review, Migration 028 should be a narrow,
additive package containing only:

1. An immutable `approval_policy_versions` authority, populated only by a
   separately approved policy publication process.
2. An append-only/server-owned `approval_decision_requests` authority for
   canonical decision intent and its opaque RPC idempotency key.
3. A service-role-only canonical snapshot RPC, and a service-role-only request
   issue/reconcile RPC.
4. The minimum indexes, constraints, RLS posture, and grants needed for those
   objects.

It must not modify M024 profile/review/case semantics, M026/M027 function
definitions, merchant/workspace data, or existing business rows. If a required
schema dependency is absent or ambiguous, the migration must fail before DDL;
it must not invent links or backfill policy values.

## Canonical approval snapshot reader

The proposed read-only, deterministic RPC is conceptually:

`public.read_canonical_approval_snapshot_v1(p_decision_request_id uuid)`.

It accepts only the opaque, server-issued request ID. It never accepts a
browser-provided merchant ID, profile ID, source ID/type/version, workspace ID,
policy version, reviewer ID, row version, or idempotency key as authority.
The server-only workflow may use the request ID only as a selector; the RPC
must re-read and validate every canonical relationship.

It returns only safe facts needed to construct the existing 13-argument M026
approval command/RPC call:

- request ID and opaque decision idempotency key;
- merchant, profile, and exactly one workspace ID;
- plan code, current compliance status, expected profile row version;
- source type, source ID, source row version, and safe source state;
- immutable policy version;
- source-derived reviewed timestamp and reviewer linkage where required;
- target status, safe reason code, and a `ready` or exact `replay_candidate`
  state.

The RPC must return one safe failure state—not partial fields—when a request,
profile, source, policy, workspace, version, or linkage is missing, duplicated,
stale, conflicting, unsupported, or query-error. No raw constraint, role,
record, or SQL error is returned.

For a `ready` snapshot it must verify, at minimum:

- exactly one profile for the request and its merchant;
- a positive current profile row version and plan/status compatible with the
  request target;
- profile `decision_source_type`, `decision_source_id`, and
  `decision_source_version` equal the derived source;
- exactly one mapped Lite/Business review with matching merchant/profile,
  review type, target plan, allowed pending/needs-attention source status, and
  source row version; or exactly one Solo Plus case with matching merchant,
  plan, version, and source decision semantics;
- an immutable policy record matching the request; for Solo Plus it must also
  equal the case's `requirements_policy_version`;
- the source evidence/reviewer/time requirements needed by M026. In particular,
  Solo Plus must use the case's authoritative decision timestamp and actor and
  reject a different requested reviewer rather than substituting `now()`.

For an exact replay, the reader may return the original request facts only when
one append-only compliance event and the current profile state prove the same
request fingerprint, expected/resulting versions, target, actor, source,
policy, and safe reason. Any partial or conflicting replay evidence fails
closed. The M026 RPC remains the final atomic replay authority.

## Durable decision-idempotency authority

`approval_decision_requests` is a server-owned authority, not a browser
idempotency cache. A conceptual issue/reconcile RPC,
`public.issue_canonical_approval_decision_request_v1(...)`, receives only
server-derived internal review context, current reviewer identity, requested
target, and allowlisted reason. Its exact signature is deferred until the
protected review-context/API design is approved.

Inside one transaction it must:

1. Resolve the canonical profile and source from the server-internal context.
2. Derive workspace, current profile/source versions, plan, immutable policy,
   reviewer linkage, and source-specific reviewed timestamp.
3. Validate target/reason compatibility before creating any request.
4. Generate the opaque decision idempotency key in the database, not from a
   browser field or predictable hash.
5. Insert or return exactly one immutable request bound to reviewer, merchant,
   workspace, profile, source type/ID/version, expected profile version, target,
   policy version, safe reason, and creation timestamp.
6. Return only request ID/key and safe `created`/`existing`/`rejected` results.

The request table needs a database-generated key, immutable canonical
fingerprint, creation time, and state sufficient to distinguish `prepared`,
`submitted`, `replay_confirmed`, and safe terminal conflict/unavailable
outcomes. A uniqueness constraint must cover every behavior-bearing canonical
field—not merely profile or source—so a changed reviewer, target, reason,
policy, source/version, or expected profile version cannot reuse a key.

Retry first reuses the request/fingerprint under the same protected context,
then asks the snapshot reader for the key. A replay with mismatched canonical
facts fails closed. The UI may retain an opaque request presentation token only
as a selector; it never supplies or chooses the underlying idempotency key.

The table must not be updated by browsers. If a lifecycle update is required
after M026 reports success or replay, it must occur through a later narrow
service-role-only reconciliation RPC that verifies the M026 event/profile
linkage. The request authority must never claim decision success merely because
it issued a key.

## Workspace linkage

M024 compliance profiles have `merchant_id` but no `workspace_id`. The actual
canonical relationship is the reverse one: exactly one
`workspaces.merchant_id` row references a merchant. Migration 028 must require
that column's exact foreign key to `merchants(id)` and its one-column unique
constraint, then derive the workspace only from that row. It must not assume,
create, or backfill `merchants.workspace_id`. Missing, duplicate, stale, or
conflicting links are safe failures.

Migration 028 preflight must inspect the actual deployed merchant/workspace
columns, foreign key, and uniqueness semantics before any DDL. If that
inspection cannot prove the one-workspace `workspaces.merchant_id` relationship,
the package must stop. It must not update merchant/workspace rows or choose the
newest/default workspace as a workaround.

## Policy provenance

Each request must reference an immutable policy record whose version is
nonblank, unique, published, and compatible with the plan/source/target.
Lite/Business reviews created through the M025 bootstrap path may not contain a
policy version, so their review row alone is not enough provenance. The issue
RPC must bind the selected policy record to the immutable request after trusted
server workflow resolution; no UI policy value or silent default is allowed.

Solo Plus additionally requires equality between the selected policy version
and `solo_plus_cases.requirements_policy_version`. A missing or mismatched case
policy is a safe rejection. Historical sources without provable policy
provenance remain ineligible until separately reviewed evidence is available;
the migration may not backfill or infer it.

## Security model

Both RPCs must use `SECURITY INVOKER` with a hardened `search_path`, a
deterministic signature, and explicit function ownership/security verification.
`EXECUTE` must be revoked from `PUBLIC`, `anon`, and `authenticated`, and
granted only to `service_role`. There must be no browser table grants, browser
RLS policies, generic client wrapper, or direct table access exposed by this
package.

The issue RPC is the only proposed write surface and may write only its new
decision-request/policy-link authority. The snapshot RPC is read-only. Both
return safe result codes/minimal safe metadata and never raw SQL errors,
connection details, evidence snapshots, or personally identifying data.

## Non-activation and forbidden-write boundary

Migration 028 must not set `setup_mode=false`,
`live_features_enabled=true`, `can_collect_payments=true`, collection
entitlements, or `activation_status='active'`. It must not create or update
limits, merchants, workspaces, subscriptions, invoices, payment records,
provider/settlement data, checkout state, or storefront state.

Issuing a canonical request is not compliance approval. Reading a snapshot is
not an approval decision. Only a later, separately approved server workflow may
pass the resulting canonical command to M026; M026 approval itself remains
separate from activation and collection unlock.

## Preflight, postflight, and local rehearsal

Before implementation, the migration package must include compact PASS/FAIL
preflight and postflight scripts. Preflight must verify M024 profile/review/event
columns and constraints, M025/M026/M027 exact signatures and grants, actual
merchant/workspace linkage schema, Solo Plus case policy/decision columns, RLS,
browser grants/policies, absence of conflicting overloads, and no unsafe
default privileges.

Postflight must verify exact new RPC signatures, `SECURITY INVOKER`, hardened
search paths, service-role-only execute, no browser grants/policies, immutable
request constraints/indexes, snapshot read-only behavior, and no business rows
created by installation. It must also prove forbidden-table write paths remain
absent.

A disposable PostgreSQL harness must apply prerequisites/M024/M025/M026/M027
then M028 preflight, first apply, second apply, and postflight. It must exercise
unique workspace success and missing/ambiguous/conflicting workspace failures;
Lite, Business, and Solo Plus canonical snapshots; null/mismatched policy
failures; issue/retry/replay/mismatch idempotency; hostile role denial; no
browser grants; late request-write rollback; no M026 profile/event mutation
from snapshot or request issuance; and all forbidden-write assertions. The
collect-all diagnostic mode and no-BOM/local-disposable safeguards from the
database safety runbook are required.

## Rollout gates

1. Independently review this design, especially the request fingerprint,
   workspace invariant, and policy publication authority.
2. Produce a narrow Migration 028 source package with static tests and
   preflight/postflight verification.
3. Pass an independent source review and disposable local rehearsal.
4. Obtain a separate approval for staging preflight, then staging apply/rerun/
   postflight, then a separate production approval.
5. Implement fake-backed server-only repositories against the proven package;
   keep them unimported by routes, actions, pages, and webhooks.
6. Consider runtime adoption only after a separately reviewed authorization/API
   workflow. Collection remains locked until all independent future gates pass.
