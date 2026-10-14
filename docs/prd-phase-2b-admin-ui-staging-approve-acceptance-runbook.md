# Phase 2B staging approve acceptance source package

**Status: source-only proposal for independent review. Fresh approve fixture
planning and creation are blocked.** The separate
[paid-fixture and atomicity design](prd-phase-2b-approve-paid-fixture-and-atomicity-design.md)
defines a candidate synthetic boundary and required hardening; it provides no
executable fixture. A separate fail-closed migration remains unapplied and
unproven. This document authorizes no database
access, environment change, deployment, approval action, activation, cleanup,
or production activity. Every mutation requires a separate explicit approval.
The completed RMI and reject cases and run IDs were cleaned up and cannot be
reused.

The [forward-only atomicity source package](prd-phase-2b-approve-atomicity-hardening-source-package.md)
contains a fail-closed RPC/source cutover: v1 approve returns a conflict, and
the new approve RPC receives the exact run ID but always returns a conflict
after its eligibility checks. Payment and requirement writer hardening remains
unimplemented. Approve fixture planning remains blocked until hardening
is completed, independently reviewed, and proven by disposable-database
race tests, and a separate approve-only fixture procedure is reviewed.

## Decision boundary

This gate is designed for one new synthetic staging case, one exact case UUID,
one `phase2b-approve-YYYYMMDD-<3-to-16-lowercase-alphanumeric-characters>` run
ID, and `decision=approve` only. It requires the general review-action flag,
the new `DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED=true` flag,
and positive dedicated staging target, Supabase project, and app-origin
identity. If the reject flag is also present, neither gate resolves. Request
more information, reject, and reopen cannot resolve under the approve gate.
The service requires `fixture_scope=phase2b_approve_acceptance`, the exact run
marker, `synthetic_approve_acceptance=true`, a fresh paid manual-review case,
and no earlier review decision or activation key. The RPC owns case-row
locking, expected `row_version`, state, idempotency, and its eligibility check.

The future synthetic pre-action case must be **paid**, with one linked
successful payment record and exactly six canonical requirements, each
`passed` with synthetic manual evidence. Pending payment, an absent payment
record, or pristine requirements fail the orchestration eligibility check.
Waived or reused requirements are outside this synthetic fixture design.

## Current fail-closed cutover boundary

The old seven-argument `review_solo_plus_case_v1` approve branch returns
`state_conflict` before its historical update/event code. The new
`review_solo_plus_case_approve_atomic_v1` receives the server-resolved run ID,
locks and rechecks the case, pointed-to payment, and six requirements, then
unconditionally returns `state_conflict`. It performs no approval update,
writes no `case_approved` event, and calls no activation or other side-effect
mutation. The source package has not been applied or validated in a database.
The pointed-to payment must have `payment_records.payment_status=successful`;
the RPC does not yet prove there is no second linked successful payment row.
Approve execution remains blocked. Activation is a separate, higher-impact RPC
that can change workspace subscriptions, merchant plan/onboarding fields, and
live features; no activation or subscription/collection change belongs to a
future approve acceptance gate.

## Blocker: fresh synthetic paid fixture

The existing `phase2b-admin-detail-fixture-staging.ps1` creates only an unpaid
manual-review case with six pristine requirements. It must not be reused or
altered for the paid approve case. A separate approve-only procedure is
proposed in the design above, but no reviewed staging-only procedure currently
establishes a successful **synthetic** payment record, six eligible synthetic
requirements, and the new approve fixture markers without real customer,
payment, provider, document, settlement, or production data. Until the design,
fixture procedure, and atomicity hardening pass independent review and
disposable-database rehearsal, **fresh approve fixture planning,
preflight execution, environment changes, deployment, and approve execution
remain blocked**. Any fixture procedure, payment simulation, or requirement
evidence writer needs its own source/security review and approval.

The fixture design must prove that no real charge, provider call, document
upload, settlement instruction, subscription activation, or collection unlock
can occur. It must specify a single synthetic merchant/workspace, exact case
and run markers, payment-record provenance, six requirement evidence sources,
rollback/cleanup boundaries, and a read-only way to detect side effects. A
source assertion alone cannot establish staging data state.

**Requirement-write race blocker:** the current requirements service can
upsert `solo_plus_case_requirements` without locking or incrementing the parent
case `row_version`. The historical v1 approve branch reads requirements without
locking them; the new RPC locks the six existing rows but always rejects.
Before any success path can be reviewed, every requirement writer must use a
parent-case/version protocol, including insert/delete paths. Passing preflight
or the orchestration's earlier requirement read is insufficient. The
fail-closed source package does not resolve that race.

## Read-only preflight contract (not executable yet)

After the fixture design and its creation are separately approved, a separately
reviewed **read-only** inspection must return one compact
`PASS|APPROVE_PREFLIGHT|ready|row_version=<n>|boundary=<digest>` line or a
specific `BLOCKED` line. Do not prepare or run that inspection against staging
under this package. It must verify, for the one exact case and run:

- dedicated staging identity; exact synthetic fixture scope/run/marker; one
  active case for its synthetic merchant/workspace; no real identity or data;
- `manual_review`, a positive current `row_version`, `payment_status=paid`,
  `refund_status=none`, a linked **synthetic** successful payment record owned
  by that case, and no duplicate payment or refund operation;
- exactly the six canonical requirements, each eligible under a reviewed
  synthetic evidence policy; no real documents, provider references, or
  settlement data;
- no earlier RMI/reject/approve/reopen event, approval/rejection/reopen state,
  activation event/key, active Solo Plus subscription, live feature, or
  collection unlock; and
- a private fingerprint of merchant, workspace, subscription, payment, and
  requirement boundaries to compare after the action.

Stop unless all checks pass and the exact current row version is retained
privately. Recheck the boundary immediately before any separately approved
single action. The payment-confirmation application RPC increments case
`row_version` when marking it paid, and recovery also increments it. The
new fail-closed RPC locks the case and checks the expected version and paid state. The
known payment-confirmation path requires `awaiting_payment`, so it cannot turn
an already manual-review fixture paid without a conflicting version/state
change. Audit any new or direct payment write path before execution. The
requirement-write race above remains a blocker; a stale preflight is
insufficient.
The historical v1 approve branch reads the linked payment without locking it.
The new RPC locks the pointed-to payment row with `NOWAIT`, but neither that
lock nor the current code proves there is no second linked successful payment
record. Linked-payment writers still lack parent-case/version discipline.
The linked design also identifies payment-first confirmation and recovery lock
order. This source package makes no transactional guarantee for a successful
approval.

## Proposed exact staging environment values (not current values)

The existing `DERALEDGER_DEPLOYMENT_TARGET=staging` identity remains in place.
Only after separate fixture, preflight, exact-scope, and deployment approvals,
the proposed temporary action values are:

```text
DERALEDGER_DEPLOYMENT_TARGET=staging
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED=true
DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED=true
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID=<fresh exact approve fixture case UUID>
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION=approve
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID=<fresh exact phase2b-approve-YYYYMMDD-random run ID>
```

The reject flag must be absent. Placeholders are not deployable. Only the
dedicated staging Supabase project and app origin may satisfy the gate; known
production indicators block it even when the deployment target says staging.
Never print or change credentials as part of this package.

## UI and API acceptance after separate approvals

Confirm the exact approved build, env scope, synthetic fixture, fresh read-only
preflight, and DB-backed super-admin identity. Only **Approve** may appear for
that case; Request more information, Reject, and Reopen remain absent. Other
cases stay read-only. No activation control is present.

1. Leave the reason blank or whitespace. The form must show its required
   reason message and send no POST.
2. Enter a short synthetic reason. Open the **Approve** confirmation; it must
   state that approval does not activate Solo Plus. Cancel once; no POST.
3. Only after separate **approve execution approval**, refresh the single tab
   and submit once with the exact case, current `expectedRowVersion`, decision
   `approve`, and a new request idempotency key. Do not replay or retry.
4. Expect HTTP 200, private/no-store, `kind=updated`, `caseStatus=approved`,
   `paymentStatus=paid`, `refundStatus=none`, and version incremented exactly
   once. Stop on any other result. Never expose reviewer, reason, request key,
   payment details, or internal diagnostics in evidence.

## Read-only post-action contract

Through a separately approved read-only inspection, compare the exact case,
run, and retained preflight fingerprint. Require one `case_approved` event with
the prior manual-review version and new approved version, reviewer and approval
timestamp, no other review decision, unchanged synthetic paid record and six
requirements, `refund_status=none`, and no activation event/key. Merchant plan,
workspace plan, subscriptions, onboarding, live features, collection limits,
and refund/settlement state must match the preflight boundary. Return only
`PASS|APPROVE_POSTFLIGHT|approved_without_activation` or a specific failure.
Do not treat a successful API response alone as postflight proof.

## Restore default block and cleanup

After separately approved postflight evidence, separately approve removing the
five temporary review-action values and redeploying the dedicated staging app.
Keep `DERALEDGER_DEPLOYMENT_TARGET=staging` as the staging identity. Verify
private/no-store 404 for the POST and no review controls on queue/detail.

Cleanup requires a later, separate approval and a newly reviewed guarded
procedure for a **paid** synthetic case. The unpaid RMI/reject fixture cleanup
path must not be reused. It must prove payment, event, requirement, merchant,
workspace, and subscription descendants are handled without touching any real
record; verify postcleanup read-only. No cleanup is authorized here.
