# Phase 2B Admin UI controlled staging review-action acceptance plan

**Plan status:** source hardening is implemented and ready for independent
review. Staging review-action execution remains blocked until the forward
migration and application patch are independently approved, applied/deployed
to staging under separate gates, and a fresh fixture receives explicit
execution approval.

**Completed prerequisite:** the read-only queue/detail staging gate and its
fixture cleanup are complete. No prior fixture may be reused.

## Purpose and boundary

This plan defines a short, reversible staging-only acceptance gate for Solo
Plus review decisions. It does not enable a flag, deploy code, create a
fixture, execute a review decision, connect to a database, or authorize any
production activity.

The gate covers the Admin UI and `POST /api/admin/solo-plus/review` only. It
does not cover private-document viewing, payment or refund execution,
activation, collection unlock, M030/live readiness, runtime adoption, legacy
admin APIs, or production.

## Source contract reviewed

The current source establishes these controls:

- `src/lib/server/solo-plus-review-action-release.ts` enables actions only
  when `DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED` is exactly `true`
  after trimming and case normalization. Unset, blank, or false is disabled.
- `VERCEL_ENV=production` disables actions even when the action flag is true.
- The review route checks the release gate before authentication, service
  construction, or mutation and returns a private/no-store `404` while
  disabled.
- The review service independently checks the same release gate and requires
  the DB-backed super-admin context.
- The Admin UI supplies `caseId`, `expectedRowVersion`, a generated
  idempotency key, the one exactly scoped decision, and its required reason.
  The staging gate can expose only request-more-information or reject;
  approve and reopen remain excluded.
- `review_solo_plus_case_v1` locks the case, checks idempotency before row
  version, checks row version before state, updates the case, and inserts one
  admin audit event atomically.
- Approval is separate from the activation RPC and does not itself unlock
  collection.
- The staging action scope now also requires an exact case UUID, one allowed
  decision (`request_more_information` or `reject`), and an exact fixture run
  ID. The service verifies the case's fixture markers before orchestration.
- All mutation responses are explicitly private/no-store and contain only the
  minimal case status/version and event type/time needed by the UI.

## Implemented source controls requiring independent review

The earlier global-only flag would have exposed every supported POST decision.
The current patch replaces that behavior with exact case, decision, and run
scope. The following work must be independently reviewed before any flag may
be enabled:

1. **Mechanical action scope.** The release gate now binds an acceptance window
   to one exact fixture case UUID, one exact allowed decision, and one fixture
   run ID. The route and service both reject a different case or decision, the
   service checks the DB fixture marker/run ID, and the UI exposes only the
   configured decision on the configured case. The staging-only names are
   `DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID` and
   `DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION`, plus
   `DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID`. Missing, malformed,
   non-UUID, unsupported, blank, non-preview/development, or production values
   keep mutation disabled.
2. **Bounded review text.** `SOLO_PLUS_REVIEW_REASON_MAX_LENGTH` is the shared
   1,000-character TypeScript contract. The UI, API route, and orchestration
   layer enforce it. The forward RPC migration enforces the same bound at the
   database boundary.
3. **Exact idempotency intent.** The new forward migration
   `20260930000000_phase2b_review_action_intent_hardening.sql` compares case,
   decision/event, reviewer, normalized reason, policy version, and original
   expected row version before returning an idempotent replay. A changed field
   returns an idempotency conflict. A review-event-only unique partial index
   prevents reuse of a review request key across cases. Before and after index
   creation, the migration compares its exact catalog structure and canonical
   predicate with an ephemeral expected-shape index; a same-name incompatible
   object fails closed.
4. **Private minimized responses.** Every success and error response uses
   `Cache-Control: private, no-store, max-age=0`. Success responses omit the
   reviewer identity, request key, reason, policy version, internal state,
   provider/payment references, and document/storage fields.
5. **Approval defense.** Orchestration requires `payment_status='paid'`, a
   payment record ID, and exactly the six canonical satisfied requirement rows.
   The forward RPC additionally requires the case payment record to point back
   to the case with payment status `successful`. The staging acceptance scope
   does not accept `approve`, so approval remains blocked from this gate.
6. **Reopen defense.** The staging acceptance scope does not accept `reopen`,
   and no Admin UI reopen control was added. Its future UI/refund-state design
   remains a separate gate.
7. **Regression coverage.** Focused tests cover default/production/missing
   scope, wrong case/decision/run marker with zero transition calls, bounded reasons,
   minimized no-store responses, exact and changed intent, approval eligibility,
   and absence of approve/reopen from the scoped UI.

These controls do not authorize execution. The global and scope flags must
remain absent/false until independent review, staging migration approval,
staging-only migration apply/postflight, source deployment, fresh-fixture
approval, and final action approval all pass.

## Required fixture strategy

Use a new app-created, isolated fixture for each accepted action. Never reuse
the cleaned read-only fixture and never use a real merchant.

Each fixture must:

- use an email and business name containing a dated `phase2b-action-fixture`
  marker;
- be created through normal staging signup/provisioning and Solo Plus draft
  creation;
- stop before payment and contain no payment/provider/document/storage data;
- be moved to `manual_review` only through the separately approved guarded
  fixture executor;
- contain exactly the six canonical pristine requirement rows and the fixture
  audit marker; and
- have no other active case for the fixture merchant.

Use separate fixtures and separate flag windows for request-more-information
and reject. Do not chain those two acceptance actions on one case. A future
reopen gate must use a third fixture dedicated to the reject-then-reopen
sequence. A future approval gate requires a different, separately designed
paid and evidence-eligible synthetic fixture; do not manufacture a paid state
or fake evidence with ad hoc SQL.

Capture post-action evidence before cleanup. Cleanup is a separately approved
mutation using the guarded fixture executor; it must not run automatically and
must not delete the synthetic identity, merchant, workspace, onboarding, or
payment data.

## Recommended action sequence

1. **Request more information first.** It is the least terminal decision,
   requires a reason, does not approve, reject, activate, or create a refund
   review, and moves `manual_review` to `verification_pending`.
2. **Reject second, on a fresh unpaid fixture.** It proves the confirmation,
   required reason, rejection audit, and unpaid refund boundary. Expected
   refund state is `none`; paid-rejection/refund behavior remains outside this
   gate.
3. **Approve later, under a separate gate.** It remains blocked until payment
   and requirement eligibility are source-enforced and the synthetic paid
   fixture design is independently approved.
4. **Reopen later, under a separate gate.** It remains blocked until an Admin
   UI control and refund/rejection-state contract are independently approved.

## Temporary staging flag procedure

This is a procedure for a future separately approved operator; it is not an
instruction to change an environment in this task.

1. Prove the deployment belongs only to the staging application/project and
   record its immutable deployment identifier.
2. Prove its runtime classification is not `VERCEL_ENV=production`. If the
   staging project uses Vercel's production environment classification, stop:
   the current hard block intentionally prevents enablement and must not be
   bypassed.
3. Prove the production project/environment has no pending flag change. Do
   not inspect or modify production credentials.
4. With separate approval, set
   `DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED=true` only in the
   non-production staging environment, set the independently reviewed exact
   fixture-case, allowed-decision, and run-ID scope values, and redeploy only
   staging.
   If either scope value is missing or differs from the approved fixture/action,
   the route and service must remain blocked.
5. Confirm an unauthenticated caller and an ordinary merchant cannot mutate,
   while the designated DB-backed staging super-admin can see the action form.
6. Execute only the single pre-approved action on the single approved fixture.
7. Immediately remove/disable the flag in staging and redeploy staging.
8. Confirm the POST route again returns private/no-store `404`, the detail page
   returns to the read-only notice, and no action controls remain.

Do not leave the action flag enabled between fixtures. Do not set the flag in
a shared scope. `VERCEL_ENV=production` must remain an unconditional block
even if the action flag is accidentally true.

## Required pre-action UI/API state

Before every action window, all of the following must pass:

- exact staging deployment/build and isolated fixture identity are proven;
- legacy admin APIs remain private/no-store `404`s;
- with the action flag disabled, the review POST is a private/no-store `404`;
- queue/detail GETs remain available only to the DB-backed super-admin;
- unauthenticated and ordinary merchant users cannot read or mutate the case;
- the exact fixture appears once in the queue and detail opens once;
- detail exposes no provider/payment reference, document/storage path, signed
  URL, or document data;
- case state is `manual_review` with the captured current row version;
- payment is pending, refund state is none, and direct and reverse payment
  links are absent for request-more-information/reject fixtures;
- activation idempotency is absent and no activation/collection readiness is
  present;
- all six requirement rows are pristine metadata-only rows; and
- console, network, and server logs have no unexpected failures.

## Read-only pre-action evidence

This is future user-run read-only SQL after separate target/query approval. It
must be run with `ON_ERROR_STOP`, inside one read-only transaction, against the
approved staging target only. Replace the placeholders locally. Retain only
the single compact result line; never paste connection details, raw rows,
reasons, tokens, provider fields, metadata, or document data.

```sql
BEGIN READ ONLY;
WITH expected AS (
  SELECT '<fixture_case_uuid>'::uuid AS case_id,
         '<fixture_run_id>'::text AS run_id
), state AS (
  SELECT
    c.id,
    c.merchant_id,
    c.case_status,
    c.payment_status,
    c.refund_status,
    c.row_version,
    c.payment_record_id,
    c.activation_idempotency_key,
    c.audit_metadata ->> 'fixture_scope' AS fixture_scope,
    c.audit_metadata ->> 'fixture_run_id' AS fixture_run_id,
    (SELECT count(*) FROM public.solo_plus_cases x
      WHERE x.merchant_id = c.merchant_id
        AND x.case_status IN ('draft','awaiting_payment','verification_pending','manual_review')) AS active_case_count,
    (SELECT count(*) FROM public.payment_records p
      WHERE p.solo_plus_case_id = c.id) AS reverse_payment_count,
    (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
      FROM public.solo_plus_case_requirements r
      WHERE r.case_id = c.id) AS requirement_codes,
    (SELECT count(*) FROM public.solo_plus_case_requirements r
      WHERE r.case_id = c.id
        AND (r.requirement_state <> 'not_started'
          OR r.verification_log_id IS NOT NULL
          OR r.evidence_source_type IS NOT NULL
          OR r.evidence_source_id IS NOT NULL
          OR r.evidence_reference IS NOT NULL
          OR r.original_completed_at IS NOT NULL
          OR r.reuse_decision_at IS NOT NULL
          OR r.reuse_reason IS NOT NULL
          OR r.policy_rule_applied IS NOT NULL
          OR r.reviewed_by_admin_id IS NOT NULL
          OR r.review_note IS NOT NULL
          OR r.provider_name IS NOT NULL
          OR r.provider_reference IS NOT NULL
          OR r.failure_reason IS NOT NULL
          OR r.completed_at IS NOT NULL
          OR r.metadata IS DISTINCT FROM '{}'::jsonb)) AS non_pristine_requirement_count
  FROM public.solo_plus_cases c
  JOIN expected e ON e.case_id = c.id
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM state) THEN 'BLOCKED|ACTION_PREFLIGHT|fixture_missing'
  WHEN (SELECT fixture_scope FROM state) IS DISTINCT FROM 'phase2b_admin_detail_smoke'
    OR (SELECT fixture_run_id FROM state) IS DISTINCT FROM (SELECT run_id FROM expected)
    THEN 'BLOCKED|ACTION_PREFLIGHT|fixture_marker_mismatch'
  WHEN (SELECT case_status FROM state) <> 'manual_review'
    THEN 'BLOCKED|ACTION_PREFLIGHT|case_not_manual_review'
  WHEN (SELECT active_case_count FROM state) <> 1
    THEN 'BLOCKED|ACTION_PREFLIGHT|active_case_conflict'
  WHEN (SELECT payment_status FROM state) <> 'pending'
    OR (SELECT refund_status FROM state) <> 'none'
    OR (SELECT payment_record_id FROM state) IS NOT NULL
    OR (SELECT reverse_payment_count FROM state) <> 0
    THEN 'BLOCKED|ACTION_PREFLIGHT|payment_or_refund_state_present'
  WHEN (SELECT activation_idempotency_key FROM state) IS NOT NULL
    THEN 'BLOCKED|ACTION_PREFLIGHT|activation_detected'
  WHEN (SELECT requirement_codes FROM state) IS DISTINCT FROM
    ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[]
    THEN 'BLOCKED|ACTION_PREFLIGHT|requirements_not_canonical'
  WHEN (SELECT non_pristine_requirement_count FROM state) <> 0
    THEN 'BLOCKED|ACTION_PREFLIGHT|requirements_not_pristine'
  ELSE 'PASS|ACTION_PREFLIGHT|manual_review_ready|row_version=' ||
       (SELECT row_version FROM state)::text
END AS evidence;
ROLLBACK;
```

The preflight is valid for the request-more-information and unpaid-reject
fixtures only. It intentionally blocks an approval attempt because the fixture
is unpaid and evidence-free.

## Action-level acceptance checks

### Request more information

Before the accepted action:

1. Select request-more-information with a blank/whitespace reason. The UI must
   show its validation error and make no POST request.
2. Enter a short synthetic reason containing no personal/provider/document
   data.
3. Record the pre-action row version locally; do not paste the reason or
   idempotency key into evidence.

Accepted first response:

- HTTP `200`, `kind=updated`;
- case state `verification_pending`;
- row version increments exactly once;
- refund remains `none`, payment remains pending, and activation remains null;
- exactly one `case_review_requested_more_information` event exists with
  actor type admin and the DB-backed reviewer ID; and
- the case leaves the manual-review queue and detail shows the safe updated
  state without action controls usable after the flag is disabled.

For the idempotency check, replay the exact same request body once within the
same authenticated browser session without copying cookies/tokens. It must
return HTTP `200`, `kind=idempotent_replay`, create no second event, and not
increment row version again. Do not perform a replay until the exact-intent
source prerequisite above is resolved.

For the stale-version check, a second tab loaded before the first action may
submit a new-key request using the old row version. It must return HTTP `409`,
`code=VERSION_CONFLICT`, with no state/event change. Stop if it returns a
success, a generic 500, or mutates a second time.

### Reject

Use a fresh, unpaid, pristine fixture. Test blank/whitespace reason locally
before the accepted action; it must make no POST. Approval confirmation copy
must not be shown for a reject decision, and the reject confirmation must name
the reject effect.

Accepted response and state:

- HTTP `200`, `kind=updated`;
- case state `rejected`, rejection timestamp and DB-backed admin actor set;
- the normalized synthetic reason is recorded once;
- row version increments exactly once;
- exactly one `case_rejected` event exists;
- payment remains pending, refund remains `none`, no refund idempotency key is
  created, and no payment/refund operation occurs; and
- activation/collection state remains untouched.

Run the same exact replay and new-key stale-version checks described above on
this fresh fixture only if each negative request has separate approval.

Paid rejection is not part of this gate. Source records
`refund_status='review_required'` for a paid rejected case, but that behavior
must be accepted in a separate paid-fixture/refund-boundary gate. No refund may
be approved, processed, or executed here.

### Approve

Approval remains blocked in this plan. Before a later approval gate can run:

- a source-backed eligibility rule must define and enforce the acceptable six
  requirement states and evidence/review posture;
- a separately approved synthetic case must already be legitimately paid
  without executing or fabricating a payment in this gate;
- the source/test suite must prove approval cannot succeed for pending/unpaid,
  incomplete, or stale cases; and
- the post-action check must prove `case_status='approved'`, payment remains
  paid, refund remains none, one `case_approved` event exists, row version
  increments once, and activation/collection/workspace entitlement state is
  unchanged.

Even after approval acceptance, no activation control or activation RPC may be
called. Approval is evidence for a later gate, not authorization to activate.

### Reopen

Reopen remains blocked. It is supported by the API/service/RPC but is absent
from `AdminReviewForm`. It also clears rejection and refund-idempotency state.
A future reopen gate needs:

- an independently reviewed Admin UI control and confirmation;
- a fresh fixture dedicated to a separately approved reject-then-reopen
  sequence;
- a policy for unpaid versus paid/review-required rejection state; and
- checks for `verification_pending`, cleared rejection fields, refund state
  `none`, one `case_reopened` event, one row-version increment, and no
  activation/payment/refund execution.

## Post-action read-only audit

Use this future user-run template only after the action and query are
separately approved. Supply the privately retained request key and reviewer
UUID locally, but do not paste either back. For the two actions in this plan,
use these tuples:

- request-more-information: `verification_pending`,
  `case_review_requested_more_information`, `none`;
- reject: `rejected`, `case_rejected`, `none`.

```sql
BEGIN READ ONLY;
WITH expected AS (
  SELECT '<fixture_case_uuid>'::uuid AS case_id,
         '<private_request_idempotency_key>'::text AS request_key,
         '<expected_reviewer_uuid>'::uuid AS reviewer_id,
         '<expected_status>'::text AS expected_status,
         '<expected_event_type>'::text AS expected_event,
         '<expected_refund_status>'::text AS expected_refund,
         <pre_action_row_version>::integer AS old_version
), state AS (
  SELECT
    c.case_status,
    c.payment_status,
    c.refund_status,
    c.row_version,
    c.activation_idempotency_key,
    c.payment_record_id,
    (SELECT count(*) FROM public.payment_records p
      WHERE p.solo_plus_case_id = c.id) AS reverse_payment_count,
    (SELECT count(*) FROM public.solo_plus_case_events ev
      WHERE ev.case_id = c.id
        AND ev.event_type = e.expected_event
        AND ev.request_idempotency_key = e.request_key
        AND ev.actor_type = 'admin'
        AND ev.actor_id = e.reviewer_id) AS exact_event_count
  FROM expected e
  JOIN public.solo_plus_cases c ON c.id = e.case_id
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM state) THEN 'BLOCKED|ACTION_POSTFLIGHT|fixture_missing'
  WHEN (SELECT case_status FROM state) <> (SELECT expected_status FROM expected)
    THEN 'FAIL|ACTION_POSTFLIGHT|case_status_mismatch'
  WHEN (SELECT row_version FROM state) <> (SELECT old_version + 1 FROM expected)
    THEN 'FAIL|ACTION_POSTFLIGHT|row_version_mismatch'
  WHEN (SELECT exact_event_count FROM state) <> 1
    THEN 'FAIL|ACTION_POSTFLIGHT|audit_event_mismatch'
  WHEN (SELECT payment_status FROM state) <> 'pending'
    OR (SELECT refund_status FROM state) <> (SELECT expected_refund FROM expected)
    OR (SELECT payment_record_id FROM state) IS NOT NULL
    OR (SELECT reverse_payment_count FROM state) <> 0
    THEN 'BLOCKED|ACTION_POSTFLIGHT|payment_or_refund_boundary_changed'
  WHEN (SELECT activation_idempotency_key FROM state) IS NOT NULL
    THEN 'BLOCKED|ACTION_POSTFLIGHT|activation_detected'
  ELSE 'PASS|ACTION_POSTFLIGHT|state_event_and_boundaries_verified'
END AS evidence;
ROLLBACK;
```

After an exact replay, rerun the query with the original old version: it must
still pass, proving there was no second row-version increment or duplicate
event. After a stale request, it must still pass unchanged.

## Expected post-action UI/API state

- The action response is private/no-store and returns only the approved case
  and audit fields; no provider/payment reference, storage/document path,
  signed URL, token, or raw metadata may appear.
- Queue membership changes consistently with the target status.
- Detail refresh shows the target state and decision history once.
- The disabled flag redeploy restores the read-only notice and removes all
  action controls.
- Unauthenticated/ordinary users remain denied before, during, and after the
  window.
- No activation, collection, payment, refund, document, or legacy-admin call
  appears in browser network or server logs.

## Cleanup/reset posture

There is no generic rollback of a review decision. Do not reverse an action
with ad hoc SQL and do not use reopen as cleanup.

After evidence review, request separate approval to run the existing guarded
fixture cleanup for that exact marked case. The cleanup must recheck the case
lock, reverse payment linkage, fixture markers, descendants, and exact
one-case deletion. Stop if the case has any payment linkage or other unexpected
state. Preserve compact audit evidence before deletion.

Synthetic user/merchant/workspace cleanup is outside the existing executor and
remains a separate decision; it must not be inferred from case cleanup.

## Stop conditions

Stop without retry and disable the staging flag if any of these occurs:

- target/deployment/environment proof is incomplete, `VERCEL_ENV` is
  production, or any production context is implicated;
- the action flag is present in a shared or production scope;
- the server-side configured case/decision scope is absent, malformed, or
  differs from the exact approved fixture/action;
- the source/test prerequisites in this plan are incomplete;
- fixture identity/marker is ambiguous, more than one active case exists, or
  the preflight line is not an exact pass;
- a requirement is non-pristine, a document/provider/payment link exists, or
  sensitive data is required to continue;
- unauthenticated or ordinary merchant access succeeds;
- blank required reason causes a POST, over-limit input is accepted, or the
  reason/comment contract is ambiguous;
- first action is not `updated`, exact replay is not `idempotent_replay`, a
  replay increments row version/duplicates an event, or a stale request does
  not return `VERSION_CONFLICT`;
- post-action status, row version, actor, audit event, payment/refund boundary,
  or UI state differs from the expected action contract;
- approval is attempted on the metadata-only/unpaid fixture;
- reopen, activation, collection unlock, payment/refund execution, document
  viewing, runtime adoption, M030/live readiness, or a legacy admin operation
  is invoked; or
- evidence cannot be kept compact, redacted, and free of credentials/tokens.

## Minimal evidence to paste back

Use only this redacted structure:

```text
ACTION_GATE_SOURCE_TESTS=PASS|BLOCKED
STAGING_BUILD_CLASSIFICATION=NON_PRODUCTION_CONFIRMED|BLOCKED
ACTION=request_more_information|reject
FIXTURE_MARKER=REDACTED_DATE_MARKER
ACTION_PREFLIGHT=PASS|ACTION_PREFLIGHT|manual_review_ready|row_version=<n>
REQUIRED_REASON_VALIDATION=PASS|BLOCKED
FIRST_RESPONSE=HTTP_200|updated
EXACT_REPLAY=HTTP_200|idempotent_replay
STALE_REQUEST=HTTP_409|VERSION_CONFLICT
ACTION_POSTFLIGHT=PASS|ACTION_POSTFLIGHT|state_event_and_boundaries_verified
QUEUE_DETAIL_STATE=PASS|BLOCKED
SENSITIVE_FIELDS=NOT_EXPOSED|BLOCKED
UNEXPECTED_NETWORK_OR_LOG_FAILURES=NONE|BLOCKED
ACTION_FLAG_AFTER_WINDOW=DISABLED_AND_404_NO_STORE|BLOCKED
CLEANUP=NOT_RUN_PENDING_SEPARATE_APPROVAL|SEPARATELY_APPROVED_PASS
REVIEW_ACTIONS_AFTER_WINDOW=BLOCKED
PRODUCTION=BLOCKED
```

Do not paste the fixture email, reason/comment, reviewer UUID, idempotency key,
cookies, authorization headers, JWTs, service keys, URLs with query strings,
connection details, raw SQL rows, provider data, or document/storage data.

## What remains blocked after this gate

Even after request-more-information and unpaid-reject acceptance pass, the
following remain blocked:

- approve until eligibility and paid-fixture prerequisites pass;
- reopen until its UI and refund/rejection-state contract pass;
- paid rejection/refund review and every refund execution path;
- private-document viewing and signed URL delivery;
- activation, collection unlock, payment execution, and merchant commercial
  state changes;
- M030/live readiness and runtime adoption;
- excluded legacy admin APIs; and
- all production flags, deployments, database access, and review actions.

## Gate verdict

**READY_FOR_REVIEW for the source hardening patch; BLOCKED for staging
review-action execution.** Action enablement is not approved until independent
source/security review, the forward staging migration gate and postflight,
staging-only deployment, a fresh fixture review, and separate final execution
approval all pass. Production remains hard-blocked.
