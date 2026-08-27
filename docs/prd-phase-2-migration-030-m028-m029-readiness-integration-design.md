# Migration 030 M028/M029 canonical approval readiness integration design

Date: 2026-08-27

## Status and purpose

This is a design-only proposal for an additive Migration 030. It describes how
the canonical approval-request and snapshot path introduced by Migration 028
can consume the immutable, approval-owned canonical workspace link introduced
by Migration 029.

M028 is installed in local, staging, and production but its v1 issue and
snapshot RPCs intentionally return a workspace-linkage-unavailable result.
M029 is installed and supplies the missing ownership authority through
`public.merchant_canonical_workspaces`. Neither package has adopted a runtime
caller. M030 must not be created, applied, called, or rehearsed from this
design document.

The package is not an approval decision, merchant activation, collection
unlock, or payment capability change. Migration 026 remains the only future
writer of compliance profile decision fields and compliance events.

## Existing authority to consume

M029 establishes one canonical link per merchant:

- `merchant_canonical_workspaces.merchant_id` is the primary key;
- `workspace_id` is unique;
- `(workspace_id, merchant_id)` has a foreign key to the proven composite
  workspace ownership key; and
- the link table is RLS enabled/not forced, with no browser grant or policy.

The M029 reconcile RPC can insert that link only after proving exactly one
workspace candidate for the merchant. It preserves an identical link as a
safe replay and fails closed for absent, ambiguous, cross-merchant,
conflicting, or idempotency-mismatched state. M030 must never derive a
workspace from `merchants.workspace_id`, a UI selection, recency, team
membership, or an application fallback.

## M030 scope and RPC versioning decision

M030 should add two new deterministic v2 RPCs rather than replace the installed
M028 v1 bodies:

```text
public.issue_canonical_approval_decision_request_v2(
  uuid, uuid, text, text, text
)

public.read_canonical_approval_snapshot_v2(
  uuid
)
```

The v2 signatures intentionally match the respective M028 v1 input shapes.
They permit future server-side repository code to change selectors explicitly,
while preserving M028 v1's installed fail-closed behavior for every existing
caller. There is no runtime caller today, so this is a compatibility and
rollout safeguard rather than a runtime migration.

M030 may create no new business authority beyond the two functions. Its only
permitted future write is the existing M028 `approval_decision_requests` insert
performed by the v2 issue RPC after all canonical gates pass. It must not
backfill, repair, update, or delete M029 links; link reconciliation remains the
separate M029 service-role-only operation.

## Canonical M028/M029 integration

Both v2 functions must re-read the link inside their own transaction/call; a
workspace ID stored in an older request is not sufficient proof by itself.

For the issue RPC, after its current payload, reviewer, profile, plan/status,
source, policy, version, reason, and idempotency validations, it must:

1. Derive the merchant exclusively from the trusted profile row.
2. Read `merchant_canonical_workspaces` for that merchant and require exactly
   one row.
3. Require a non-null workspace ID and re-prove ownership by joining the
   link to the M029-supported workspace ownership pair on both
   `workspace_id` and `merchant_id`.
4. Treat a missing link, zero/multiple query result, broken ownership join,
   changed merchant/profile relationship, or query error as a safe non-ready
   result with no request insert.
5. Copy the proven workspace ID to the immutable M028 request row only in the
   same successful request-insert path as its opaque database-generated
   idempotency key and canonical fingerprint.

The v2 snapshot RPC must fetch the immutable request, re-read its profile, and
then require exactly one current M029 link for the request merchant. It must
require all of the following equality/ownership facts before returning a ready
or replay-safe snapshot:

- `request.merchant_id = profile.merchant_id`;
- `request.workspace_id = canonical_link.workspace_id`;
- `canonical_link.merchant_id = request.merchant_id`; and
- the M029 composite ownership proof still resolves that workspace for that
  merchant.

Any absence, ambiguity, mismatch, stale request workspace, or ownership-proof
failure returns a safe blocked result with no approval command fields. The
implementation must return no partial trusted context for such results.

An exact, structurally valid M029 link is necessary but not sufficient. Only
after it passes may v2 continue to the existing canonical gates: profile/source
relationship and allowed plan/status, source version, expected profile row
version, immutable policy provenance, reviewer/time requirements,
target/reason compatibility, decision-request fingerprint, and replay
evidence. The M026 approval RPC remains the final atomic decision and replay
authority.

## Readiness rules

| Canonical workspace state | v2 issue/snapshot result |
| --- | --- |
| No link for the derived merchant | Safe workspace-linkage-unavailable/blocked result; no request write or ready snapshot. |
| Link cardinality, ownership join, or request workspace is conflicting | Safe workspace-linkage-conflict/blocked result; no partial context. |
| Link is valid but any existing profile/source/policy/version gate fails | Existing exact safe failure result; never ready. |
| Link and every existing canonical gate pass | Issue may create or safely replay one immutable request; snapshot may return ready/replay-safe facts. |

Result-code names are implementation details, but must be safe, stable,
non-sensitive, and distinguish unavailable from conflicting linkage without
disclosing workspace or database details. Unknown errors map to a generic safe
failure code only; no raw SQL errors are exposed.

## Security and atomicity

Each M030 RPC must use `SECURITY INVOKER`, a hardened
`search_path TO pg_catalog, public`, and one exact signature. `EXECUTE` must
be revoked from `PUBLIC`, `anon`, and `authenticated`, and granted only to
`service_role`. M030 must add no browser table grants, default privileges, or
RLS policies. It must preserve M028 and M029 RLS/grant posture rather than
loosening it.

The issue RPC's M029 re-read and M028 request insert belong in one transaction
so an invalid or changing link cannot yield a request. A duplicate-key race may
return a replay only after exact request-fingerprint and canonical-link
equivalence are verified; any different reviewer, profile, source/version,
workspace, target, policy, or reason fails closed. The snapshot RPC is
read-only and must revalidate, not trust, stored request context.

## Required preflight design

The source package must provide PASS/FAIL preflight that safely gates on all
required catalog facts before M030 DDL:

1. M028 tables, v1 exact RPC signatures, `SECURITY INVOKER`, hardened search
   paths, and service-role-only execute remain intact.
2. M029 `merchant_canonical_workspaces` and exact reconcile RPC signature
   exist, are RLS enabled/not forced, have the approved primary/unique/composite
   ownership constraints, and retain service-role-only grants with no browser
   grants or policies.
3. M026/M027 approval RPC posture remains intact because M030 produces
   canonical context for that later decision path.
4. Required M028 request columns and canonical fingerprint/idempotency
   constraints exist, including nullable `workspace_id` ready to receive a
   proven value.
5. Existing M029 supporting ownership index/constraint has its exact approved
   definition; do not infer workspace ownership from similarly named objects.
6. No conflicting v2 overload or named M030 object exists. Missing roles,
   tables, and functions must produce FAIL rows and a FAIL summary, not a
   catalog-query error.

Preflight must use `to_regclass`, `to_regprocedure`, and ACL expansion for
`PUBLIC` rather than pseudo-role privilege calls. It must not create data,
reconcile a canonical link, or test approval behavior.

## Required postflight design

Postflight must prove installation/security only and create no business rows.
It must verify:

1. Exactly one v2 issue and one v2 snapshot signature, with the intended
   return shapes.
2. `SECURITY INVOKER`, hardened search paths, and only `service_role` execute;
   no effective `PUBLIC`, anon, or authenticated execute.
3. No browser/public table grants or browser policies on M028/M029 authority.
4. M029 table RLS/not-forced posture, exact ownership constraints/index, and
   canonical-link grants remain intact.
5. V2 function definitions reference M029 canonical authority and validate
   merchant/workspace ownership before the ready/request-insert branch.
6. V1 functions remain unchanged and retain their explicit
   workspace-linkage-unavailable behavior.
7. V2 bodies contain no diagnostics and no writes to forbidden tables or
   states, and installation created no M028 request, M029 link, profile,
   compliance-event, or other business rows.

A postflight source/body check can establish that v2 is no longer globally
hard-coded unavailable; the separate disposable behavior rehearsal must prove
that a valid link can actually reach ready. Staging and production postflight
must not manufacture test links or approval contexts merely to prove that
behavior.

## Required disposable local rehearsal

A future local-only harness must begin from the proven M024--M029 baseline,
apply M030 preflight/first apply/rerun/postflight, and use only disposable
fixtures. It must collect all scenario results before final failure and retain
the existing hostile-role and forbidden-write checks.

Required scenarios:

- no canonical link: v2 issue and snapshot remain blocked;
- valid M029 link plus valid Lite, Business, and Solo Plus source/profile/
  policy/version facts: issue can create a request and snapshot returns ready;
- matching request/link retry: exact issue replay and snapshot ready/replay
  result preserve the original opaque request/key;
- a request whose stored workspace no longer equals the canonical link, a
  broken ownership proof, or contradictory link fixture: safe blocked result;
- stale profile or source version: safe blocked result with no new request;
- cross-plan or incompatible pending status: safe blocked result;
- idempotency reuse with changed reviewer, source/version, target, policy,
  reason, or workspace: safe mismatch result;
- anon and authenticated cannot execute v2 functions or read/write M028/M029
  authority; service role has only the prerequisite access expressly needed;
- no M026 approval decision, profile/event mutation, merchant/workspace
  mutation, activation, collection entitlement, limit, provider, payment,
  checkout, subscription, invoice, or storefront write occurs.

The harness must prove that an M029 reconcile/link is a prerequisite fixture,
not an M030 side effect. It must also prove that a failed v2 issue does not
leave a partial M028 request.

## Explicit boundaries

M030 must not approve compliance by itself, call M026, activate a merchant,
set `setup_mode=false`, set `live_features_enabled=true`, set
`can_collect_payments=true`, set `activation_status='active'`, unlock
collection, or alter collection entitlement. It must not write limits,
merchants, workspaces, providers, checkout, payments, settlements,
subscriptions, invoices, or storefront data.

Runtime adoption remains forbidden. A future server-only workflow may consume
v2 only after M030 has passed independent source review, disposable local
rehearsal, staging progression, production progression, repository binding
review, and a separate runtime-adoption authorization gate.

## Rollout gates and safe next steps

1. Independently review this M030 design, especially the v2 compatibility
   decision and the strict re-read of the M029 composite ownership proof.
2. Prepare a source-only additive M030 package with static tests and safe
   preflight/postflight scripts.
3. Independently review that package before any local database execution.
4. Pass a disposable local install/rerun/postflight and behavior rehearsal.
5. Obtain separate approvals for staging and production progression.
6. Keep routes, actions, pages, webhooks, the approval runtime boundary, and
   collection state unchanged until a separately approved runtime-adoption
   workflow is complete.
