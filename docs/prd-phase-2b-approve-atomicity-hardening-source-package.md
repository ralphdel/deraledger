# Phase 2B approve atomicity: forward-only RPC/source package

**Status: design-only source package for independent review. No migration, RPC,
repository, or runtime approval path is changed here. Approve fixture planning,
fixture creation, preflight execution, env setup, deployment, approval, and
cleanup remain blocked.** The existing action gates remain default-blocked.
This package authorizes no database operation or production change.

## Source findings and migration boundary

The latest reviewed `review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)`
locks the case and checks its expected version, then performs unlocked reads of
six requirements and the linked successful payment. The reviewer service
checks `fixture_scope`, `fixture_run_id`, and the synthetic marker before the
RPC, but the seven-argument RPC receives **no expected run ID**. The current
requirements repository uses a direct child-table upsert with no expected
case version or parent lock. Solo Plus payment confirmation and recovery each
lock payment before case. The case version therefore cannot detect every
eligibility change, and simply adding a blocking payment lock to approval
would introduce an inverse-lock-order deadlock risk.

There is no safe one-function patch. The implementation must be a **new,
forward-only migration plus coordinated source changes**, with the historical
migration left intact. Audit all callers of the existing review RPC before
replacing its behavior. Preserve RMI/reject behavior, but make the old v1
`approve` branch fail closed once the new approve-specific path exists; an
unguarded service-role call to v1 must not bypass the new boundary. Do not
deploy a partial migration or source cutover with approve enabled.

## Proposed transactional approval contract

Use a new service-role-only approve RPC with a distinct identity, provisionally
`review_solo_plus_case_approve_atomic_v1`, that receives the existing case ID,
expected row version, request idempotency key, reviewer ID, reason, and policy
version **plus the exact expected fixture run ID**. The fixture scope is fixed
inside the RPC to `phase2b_approve_acceptance`; the service passes the run ID
resolved from the exact staging gate, not a browser-supplied value. Keep the
legacy seven-argument review RPC for the other decisions, with its approve
branch disabled. The final signature and privileges require independent review.

Within one transaction, the approve RPC must perform these operations in order:

1. Lock the exact case row first. Reject missing case, stale
   `expected_row_version`, anything other than `manual_review` with derived
   `under_review`, earlier review decision or activation, non-`none` refund,
   or an idempotency conflict. The case audit metadata must contain the exact
   fixture scope, expected run ID, and `synthetic_approve_acceptance=true`.
   The RPC must not trust the earlier service read for any of these facts.
2. Lock the case's non-null `payment_record_id` row next. Check it is owned by
   this case and synthetic merchant, is `successful`, and still matches case
   payment state `paid`, amount, currency, purpose, and approved synthetic
   provenance. Reject a missing, changed, duplicate, or lock-busy payment
   boundary. The payment record must be locked before eligibility is read.
3. Lock all six requirement rows in canonical code order, then verify exactly
   one row per code, each in an allowed satisfied state with the required
   synthetic evidence provenance. An aggregate count without row locks is not
   enough. Reject missing, extra, changed, or lock-busy rows. Recheck the
   case/payment/requirement eligibility after obtaining every lock.
4. Update only the case to `approved`, increment its version once, and insert
   exactly one `case_approved` event with the same idempotency key in this
   transaction. Any failure rolls back both. No activation RPC or mutation of
   subscriptions, onboarding, plans, provider, settlement, refund, collection,
   or live features is part of this path.

Use the common order **case → linked payment → requirements by canonical code**
for all new Solo Plus eligibility-changing writers. A fail-closed, bounded
`NOWAIT`/lock-conflict result for the payment lock is required while old
payment-first transactions might still execute: approval must never wait on
a payment row held by a transaction waiting on its locked case. Map lock-busy,
version, state, marker, and evidence conflicts to safe non-success results;
never automatically retry an approve decision. PostgreSQL lock semantics and
the exact error mapping must be proven in a disposable database.

## Writer cutover and unresolved shared-table risk

The requirements sync input/repository contract must gain an expected case
version. Its persistence transaction locks the case before writing child rows,
rejects approved/rejected or otherwise ineligible cases, checks the version,
and advances it once for an eligibility-changing write. The caller must use
the returned case/version rather than a stale pre-sync case. Audit create,
sync, insert, update, delete, privileged direct writes, and trigger behavior.
The existing direct `.upsert` must be replaced before approval can run.

Payment confirmation and recovery should obtain the case ID by a non-locking
lookup, lock the case, then lock and re-read the identified payment row. They
must revalidate identity, ownership, linkage, state, amount, purpose, and
idempotency after locking. Payment eligibility changes must advance the case
version and reject incompatible changes after approval. During rollout, the
approve RPC's fail-closed payment `NOWAIT` is needed until old payment-first
transactions have drained. Other writers of the shared `payment_records`
table, including generic payment services and direct privileged writes, must
be audited for linked Solo Plus rows. Broadly revoking shared-table DML could
break unrelated payments; a naive child-first trigger could deadlock. The
implementation package must choose and test a scoped enforcement mechanism
before claiming all writers obey the protocol. Until then, approval remains
blocked even if the new RPC's own reads are locked.

The migration must check exact prerequisite schema/function identities,
security mode, search path, overloads, triggers, grants, and RLS before DDL;
preserve existing data; and prove rollback, rerun, and service-role-only
execution. No existing migration is edited. Do not infer staging schema from
local source: a separately approved read-only drift preflight is required
before any eventual staging apply.

## Disposable database race-test plan (not executed here)

Use a fresh local disposable PostgreSQL database with two controlled sessions
and finite lock timeouts. Run the exact generated migration and repository
RPCs, not test-only replacements. Each case checks the returned result, final
case version, payment/requirement rows, review-event count, and absence of
activation/subscription/onboarding/plan/provider/settlement/refund effects.

| Scenario | Required outcome |
| --- | --- |
| Unpaid case; missing, unlinked, wrong-owner, unsuccessful, or changed payment | Approve fails; no event or version change |
| Fewer than six, duplicate/extra, or unsatisfied requirement; changed evidence | Approve fails; no event or version change |
| Wrong case/scope/run/marker, prior decision/activation, or stale version | Approve fails before mutation |
| Requirement writer wins before approval | Parent version advances; approve sees stale version or ineligibility |
| Approval wins before requirement writer | Writer waits or fails; after approval it cannot change eligibility |
| Payment writer wins before approval | Approve sees changed version/payment and fails |
| Approval wins before payment writer | Writer waits or fails; it cannot invalidate approved payment |
| Legacy payment-first confirmation/recovery holds payment while approve holds case | Approve fails promptly on lock conflict; no deadlock or review event |
| Late error after case update or event insert | Whole transaction rolls back |
| Repeated idempotency key or concurrent approve | At most one approval event and one version increment; conflicting intent fails |

Cover first apply, rerun, missing/incompatible prerequisites, grants/default
grants, unexpected overloads, hostile drift, and rollback in the migration
harness. Static and in-memory tests in this source package only identify the
current gaps and specify expected behavior; they do **not** prove the future
RPC, writer protocol, or PostgreSQL race outcomes. Do not create the paid
fixture or schedule approve execution until this implementation and local
race evidence pass independent review, then a separate approve-only fixture
procedure passes its own review and approvals.
