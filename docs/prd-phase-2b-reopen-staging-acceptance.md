# Phase 2B rejected-case Reopen staging acceptance

Status: source-only package. It authorizes no database connection, environment
change, deployment, Reopen action, or cleanup. Each mutation remains separately
approved. The authoritative transition is `rejected -> verification_pending`.
Approved cases cannot Reopen and the completed Approve fixture is excluded.

## Source contract

The admin route parses `decision=reopen`; the reviewer service dispatches to
the existing orchestration/repository path; and
`review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)` performs the
atomic transition. It locks the case, checks the expected version and rejected
source state, increments the version once, clears rejection metadata, leaves
payment otherwise unchanged, sets refund state to `none`, records reopened
metadata, and appends exactly one `case_reopened` event. Exact-key replay is
idempotent, conflicting reuse fails closed, and another Reopen from
`verification_pending` is a state conflict. Activation remains separate.

## Fixture selection

First run the read-only preflight against the historical Reject fixture:

```text
case_id=10566c02-2bf9-4aa3-b573-bae8ff56f869
run_id=phase2b-reject-20261013-001
```

If it returns `fixture_missing`, stop. Under separate fixture and Reject gate
approvals, create a new synthetic admin-detail fixture with the existing
`scripts/phase2b-admin-detail-fixture-staging.ps1`, using a fresh
`phase2b-reject-YYYYMMDD-<3-16 lowercase letters/digits>` run ID. Use the
already reviewed Reject gate once to produce `rejected`, restore the default
block, and then run this Reopen preflight. Any other preflight failure blocks;
do not repair, broaden, or substitute a case. Never use the completed Approve
fixture `b5987ad9-f354-48a8-88d3-d0d347b67d83`.

From repository root, the read-only preflight is one password prompt:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\phase2b-reopen-staging.ps1 `
  -Operation Preflight `
  -CaseId 10566c02-2bf9-4aa3-b573-bae8ff56f869 `
  -RunId phase2b-reject-20261013-001
```

An unprepared rejected fixture returns exactly:

```text
PASS|REOPEN_PREFLIGHT|candidate_requires_preparation|row_version=<observed>|boundary=<32 lowercase hex>
```

That marker is read-only evidence, not permission to mutate. After separate
fixture-preparation approval, promote only that exact rejected fixture to the
dedicated Reopen acceptance scope. Use the observed candidate version and type
the exact confirmation string shown here:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\phase2b-reopen-staging.ps1 `
  -Operation PrepareFixture `
  -CaseId <exact rejected fixture UUID> `
  -RunId <exact phase2b-reject run ID> `
  -ExpectedRowVersion <candidate row version> `
  -Confirmation "PREPARE REOPEN FIXTURE <exact run ID> <exact case UUID>"
```

Require `PASS|REOPEN_FIXTURE|prepared|row_version=<candidate+1>`, then rerun
the read-only preflight. An already prepared fixture skips the mutation and
must directly return:

```text
PASS|REOPEN_PREFLIGHT|ready|row_version=<observed>|boundary=<32 lowercase hex>
```

Only the `ready` marker permits later release planning. Privately retain its
exact observed version and boundary. Do not paste raw
rows, reasons, request keys, credentials, cookies, or authorization material.

## Temporary staging-only release scope

Only after the preflight, environment-update approval, and deployment approval,
set these exact values on the dedicated staging deployment. Replace placeholders
with the exact passing rejected fixture. The normal staging Supabase URL and app
origin must already identify the dedicated staging tuple.

```text
DERALEDGER_DEPLOYMENT_TARGET=staging
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED=true
DERALEDGER_PHASE2B_SOLO_PLUS_REOPEN_ACCEPTANCE_ENABLED=true
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID=<exact rejected fixture UUID>
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION=reopen
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID=<exact phase2b-reject run ID>
```

The Reject and Approve action-specific flags must be absent. The gate requires
the exact case/run/decision and positive dedicated staging identity. Any real
production indicator, malformed/wildcard scope, other case, other run, or other
decision blocks all actions.

## One real admin action

After separate deployment and Reopen execution approvals, sign in normally as
super-admin in one fresh browser tab. Open the exact rejected case. Confirm the
case is `rejected`, the displayed row version equals the preflight value, and
only **Reopen** is available. Approve, Reject, Request more information, and
activation controls must be absent. Enter a short synthetic reason, open the
confirmation, and verify it says **Reopen Solo Plus review?** and describes a
return to verification pending with payment and activation unchanged.

Click Reopen exactly once. Do not retry, replay, use a stale tab, or hand-call
the RPC. Expect HTTP 200 through the admin application route and a refreshed
case at `verification_pending`, with row version incremented by one. Reopen and
all other review actions must then be absent under this Reopen-only scope.

## Read-only postflight and default-block restoration

Run the postflight with the privately retained pre-action values; it uses one
password prompt:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\phase2b-reopen-staging.ps1 `
  -Operation Postflight `
  -CaseId <exact rejected fixture UUID> `
  -RunId <exact phase2b-reject run ID> `
  -ExpectedRowVersion <preflight row version> `
  -Boundary <preflight boundary>
```

The only passing result is:

```text
PASS|REOPEN_POSTFLIGHT|verification_pending_without_side_effects|row_version=<preflight+1>|event_id=<uuid>
```

It proves one Reopen event, preservation of the prior Reject event and all
non-Reopen history, unchanged payment/requirements/merchant/workspace and
commercial descendants, no activation, and no refund/provider/settlement/
subscription/plan mutation. Any other result blocks without retry.

After separate approval, remove the four general review-action values and the
Reopen-specific flag, retaining the standing staging deployment identity only,
then redeploy staging default-blocked. Verify the case offers no review action.
Cleanup is not authorized by this runbook; it requires a separate approval and
a dedicated exact-marker cleanup or scope-restoration package. Do not run the
legacy admin-detail cleanup while `fixture_scope=phase2b_reopen_acceptance`.

No predecessor hostile/race matrix or completed Approve matrix is part of this
acceptance. Production is outside the package.
