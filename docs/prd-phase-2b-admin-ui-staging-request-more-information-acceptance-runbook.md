# Phase 2B staging request-more-information acceptance runbook

**Status:** source-only controlled package. It authorizes creation of one fresh
synthetic staging fixture only after independent review. It does not authorize
an environment change, deployment, review mutation, cleanup, or production
activity. Each later mutation remains a separate approval.

## Fixed boundary

This gate covers exactly:

- one synthetic Solo Plus case created through the normal staging app flow;
- one fresh fixture run ID;
- one exact case UUID captured from that app-created case; and
- `request_more_information` as the only review decision.

Approve, reject, reopen, document access, activation, collection unlock,
payment/refund execution, live readiness, and production remain blocked. This
package adds no route, action runner, database migration, or arbitrary-case
mutation script.

The existing guarded fixture executor remains the only fixture SQL owner:

`scripts/phase2b-admin-detail-fixture-staging.ps1`

## Synthetic identity and fixture scope

Choose one UTC stamp and a short random suffix. Use it consistently:

```text
Fixture run ID: phase2b-rmi-<yyyymmdd>-<suffix>
Fixture email: <owned-test-inbox>+phase2b-rmi-<yyyymmdd>-<suffix>@<test-domain>
Business name: Phase 2B Fixture <yyyymmdd> Request More Information <suffix>
```

Do not use a real customer identity, the support administrator identity, real
business data, or a case that existed before this gate.

Through the staging UI only:

1. Sign up the marked synthetic user and complete normal starter provisioning.
2. Start or resume Solo Plus only far enough for the normal application flow
   to create its draft case and six requirement rows.
3. Stop before payment, document upload, provider selection, or verification.
4. Capture the exact case UUID from the normal case response or case URL.
5. Confirm all review-action environment flags are still absent and the detail
   page shows the read-only release notice with no action control.

If the case UUID, fixture email, business name, or run ID is ambiguous, stop.

## Guarded fixture preparation

Run these commands only after the package and fixture creation receive their
respective approvals. They contain only the locked old-staging tuple and the
fresh synthetic identifiers.

```powershell
$Fixture = @{
  ProjectRef = 'fsjljliiyfchkwbjifzw'
  DbHost = 'aws-1-eu-central-2.pooler.supabase.com'
  DbPort = '5432'
  DbName = 'postgres'
  DbUser = 'postgres.fsjljliiyfchkwbjifzw'
  FixtureCaseId = [guid]'<fresh-fixture-case-uuid>'
  FixtureEmail = '<fresh-synthetic-email>'
  FixtureBusinessName = '<fresh-synthetic-business-name>'
  FixtureRunId = '<fresh-fixture-run-id>'
}

& .\scripts\phase2b-admin-detail-fixture-staging.ps1 `
  @Fixture `
  -Operation Preflight
if ($LASTEXITCODE -ne 0) { throw 'fixture_preflight_blocked' }
```

Required final line:

```text
PASS|FIXTURE|draft_case_eligible
```

Stop on any other result. The preflight must prove one exact merchant and
draft, one active case for that merchant, six canonical pristine requirements,
and no payment, provider, document, evidence, activation, or existing fixture
state.

Only after separate fixture-mutation approval:

```powershell
& .\scripts\phase2b-admin-detail-fixture-staging.ps1 `
  @Fixture `
  -Operation Create `
  -RunMutation
if ($LASTEXITCODE -ne 0) { throw 'fixture_creation_blocked' }
```

Type exactly when prompted:

```text
STAGING CREATE PHASE2B ADMIN DETAIL FIXTURE
```

Required final line:

```text
PASS|FIXTURE|admin_read_case_prepared
```

Then run the guarded postflight:

```powershell
& .\scripts\phase2b-admin-detail-fixture-staging.ps1 `
  @Fixture `
  -Operation Postflight
if ($LASTEXITCODE -ne 0) { throw 'fixture_postflight_blocked' }
```

Required final line:

```text
PASS|FIXTURE|admin_detail_ready
```

## Disabled-action queue/detail evidence

Before any environment change, the DB-backed staging super-admin must verify:

- the exact fixture is visible once in `/admin/solo-plus/cases`;
- `/admin/solo-plus/cases/<fresh-fixture-case-uuid>` opens;
- the page shows the read-only release notice;
- no request-more-information, approve, reject, or reopen control is usable;
- six requirement rows are shown only as non-sensitive status metadata;
- no provider/payment reference, document/storage path, signed URL, raw
  metadata, or document content is exposed; and
- browser console, network, and staging logs contain no unexpected failure.

Record only:

```text
FIXTURE_RUN_ID=<fresh exact run ID>
FIXTURE_CASE_ID=<fresh exact case UUID>
QUEUE_VISIBLE=YES
DETAIL_VISIBLE=YES
REVIEW_CONTROLS_WHILE_DISABLED=HIDDEN
SENSITIVE_FIELDS=NOT_EXPOSED
```

## Read-only action preflight

Run this only through a separately approved staging read-only inspection path.
Replace the two placeholders locally. Preserve only the compact result line.

```sql
BEGIN TRANSACTION READ ONLY;
WITH expected AS (
  SELECT '<fresh-fixture-case-uuid>'::uuid AS case_id,
         '<fresh-fixture-run-id>'::text AS run_id
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
    c.refund_idempotency_key,
    c.approved_at,
    c.approved_by_admin_id,
    c.rejected_at,
    c.rejected_by_admin_id,
    c.reopened_at,
    c.reopened_by_admin_id,
    c.rejection_reason,
    w.id IS NOT NULL AS workspace_exists,
    c.audit_metadata ->> 'fixture_scope' AS fixture_scope,
    c.audit_metadata ->> 'fixture_run_id' AS fixture_run_id,
    (SELECT count(*) FROM public.solo_plus_cases x
      WHERE x.merchant_id = c.merchant_id
        AND x.case_status IN ('draft','awaiting_payment','verification_pending','manual_review')) AS active_case_count,
    (SELECT count(*) FROM public.payment_records p
      WHERE p.solo_plus_case_id = c.id) AS reverse_payment_count,
    (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
      FROM public.solo_plus_case_requirements r WHERE r.case_id = c.id) AS requirement_codes,
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
          OR r.metadata IS DISTINCT FROM '{}'::jsonb)) AS non_pristine_requirement_count,
    (SELECT count(*) FROM public.solo_plus_case_events ev
      WHERE ev.case_id = c.id
        AND ev.event_type IN (
          'case_review_requested_more_information',
          'case_approved',
          'case_rejected',
          'case_reopened'
        )) AS prior_review_event_count,
    md5(jsonb_build_object(
      'merchantSubscriptionPlan', m.subscription_plan,
      'merchantTier', m.merchant_tier,
      'monthlyCollectionLimit', m.monthly_collection_limit,
      'merchantOnboardingStatus', m.onboarding_status,
      'merchantSetupMode', m.setup_mode,
      'merchantLiveFeaturesEnabled', m.live_features_enabled,
      'merchantVerificationStatus', m.verification_status,
      'merchantLiveFeaturesActivatedAt', m.live_features_activated_at,
      'workspacePlanType', w.plan_type,
      'workspaceOnboardingStatus', w.onboarding_status,
      'workspaceSetupMode', w.setup_mode,
      'workspaceLiveFeaturesEnabled', w.live_features_enabled
    )::text) AS commercial_boundary_fingerprint
  FROM expected e
  JOIN public.solo_plus_cases c ON c.id = e.case_id
  JOIN public.merchants m ON m.id = c.merchant_id
  LEFT JOIN public.workspaces w ON w.id = m.workspace_id
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM state) THEN 'BLOCKED|RMI_PREFLIGHT|fixture_missing'
  WHEN (SELECT fixture_scope FROM state) IS DISTINCT FROM 'phase2b_admin_detail_smoke'
    OR (SELECT fixture_run_id FROM state) IS DISTINCT FROM (SELECT run_id FROM expected)
    THEN 'BLOCKED|RMI_PREFLIGHT|fixture_marker_mismatch'
  WHEN (SELECT case_status FROM state) <> 'manual_review'
    THEN 'BLOCKED|RMI_PREFLIGHT|case_not_manual_review'
  WHEN (SELECT active_case_count FROM state) <> 1
    THEN 'BLOCKED|RMI_PREFLIGHT|active_case_conflict'
  WHEN NOT (SELECT workspace_exists FROM state)
    THEN 'BLOCKED|RMI_PREFLIGHT|workspace_missing'
  WHEN (SELECT payment_status FROM state) <> 'pending'
    OR (SELECT refund_status FROM state) <> 'none'
    OR (SELECT payment_record_id FROM state) IS NOT NULL
    OR (SELECT reverse_payment_count FROM state) <> 0
    OR (SELECT activation_idempotency_key FROM state) IS NOT NULL
    OR (SELECT refund_idempotency_key FROM state) IS NOT NULL
    THEN 'BLOCKED|RMI_PREFLIGHT|commercial_state_present'
  WHEN (SELECT approved_at FROM state) IS NOT NULL
    OR (SELECT approved_by_admin_id FROM state) IS NOT NULL
    OR (SELECT rejected_at FROM state) IS NOT NULL
    OR (SELECT rejected_by_admin_id FROM state) IS NOT NULL
    OR (SELECT reopened_at FROM state) IS NOT NULL
    OR (SELECT reopened_by_admin_id FROM state) IS NOT NULL
    OR (SELECT rejection_reason FROM state) IS NOT NULL
    THEN 'BLOCKED|RMI_PREFLIGHT|other_decision_state_present'
  WHEN (SELECT requirement_codes FROM state) IS DISTINCT FROM
    ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[]
    OR (SELECT non_pristine_requirement_count FROM state) <> 0
    THEN 'BLOCKED|RMI_PREFLIGHT|requirements_not_pristine'
  WHEN (SELECT prior_review_event_count FROM state) <> 0
    THEN 'BLOCKED|RMI_PREFLIGHT|prior_review_event_present'
  ELSE 'PASS|RMI_PREFLIGHT|ready|row_version=' ||
       (SELECT row_version FROM state)::text || '|boundary=' ||
       (SELECT commercial_boundary_fingerprint FROM state)
END AS evidence;
ROLLBACK;
```

Record the pre-action row version and boundary fingerprint locally. Do not
paste raw rows or commercial values.

## Exact staging environment scope

No environment change is authorized by this document alone. After preflight
evidence receives separate approval, use the Vercel project dashboard and
select only the dedicated staging project. Do not use team-wide/shared scope.

Vercel may report `VERCEL_ENV=production` for the production slot of this
separate staging project. That classification alone is not deployment
identity. In that case the source gate requires all three positive staging
identity checks: `DERALEDGER_DEPLOYMENT_TARGET=staging`, the existing
`NEXT_PUBLIC_SUPABASE_URL` host must identify the approved staging Supabase
project, and an existing Vercel/app-origin value must resolve exactly to
`deraledger-staging.vercel.app`. The explicit label cannot enable the gate by
itself. A missing or ambiguous identity, the real production Supabase ref, or
the production app origin fails closed. Do not copy, print, or change any
Supabase credential while checking the public project URL.

For the dedicated staging project, set exactly these five scoped values for
one short acceptance window:

```text
DERALEDGER_DEPLOYMENT_TARGET=staging
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED=true
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID=<fresh exact fixture case UUID>
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION=request_more_information
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID=<fresh exact fixture run ID>
```

Do not add another case, decision, or run value. Redeploy only the staging app
after a separate staging deployment approval. The route and service must both
remain blocked unless all five values, the positive staging project/origin
identity, and the database fixture marker agree. Preview deployments continue
to require the four action-scope values; the explicit deployment-target value
exists only to distinguish the dedicated staging project's Vercel production
slot from the real production deployment.

After redeployment:

- the exact fixture detail may show only **Request more information**;
- approve, reject, and reopen controls must remain absent;
- queue/detail GET routes must remain DB-RBAC protected;
- an ordinary merchant must remain unable to read or mutate the case; and
- no other case may expose an action control.

Any deviation is a stop condition. Do not probe another real case.

## Controlled UI/API acceptance

The following three requests form one separately approved acceptance sequence
for the exact fixture and decision. Do not execute them under fixture-creation
approval alone.

1. Open two authenticated super-admin tabs on the exact fixture before the
   first action. Both must show the same pre-action row version.
2. In the first tab, try a blank/whitespace reason. The UI must reject it and
   the Network panel must show no POST.
3. Enter a short synthetic reason containing no person, provider, payment, or
   document data. Submit **Request more information** once.
4. Require HTTP `200`, `Cache-Control: private, no-store, max-age=0`,
   `kind=updated`, `caseStatus=verification_pending`, and row version exactly
   one greater than preflight. The response must omit reviewer identity,
   request key, reason, policy data, provider/payment references, documents,
   storage data, and debug fields.
5. From the first request in the browser Network panel, use the browser's
   replay function exactly once. Do not copy cookies, authorization headers,
   or the request body into another tool. Require HTTP `200` and
   `kind=idempotent_replay` with the same resulting row version.
6. In the untouched second tab, submit the same allowed decision with a new
   generated request key and its stale row version. Require HTTP `409` with
   `code=VERSION_CONFLICT`. It must not create another event or increment the
   row version.
7. Stop immediately on any other response or state.

The replay and stale request are validation probes, not authorization for a
second decision. No reject, approve, reopen, activation, payment, refund, or
document request is permitted.

## Read-only post-action verification

Run this only through the same separately approved staging read-only path.
Replace the placeholders with the exact fixture values and the locally saved
preflight values.

```sql
BEGIN TRANSACTION READ ONLY;
WITH expected AS (
  SELECT '<fresh-fixture-case-uuid>'::uuid AS case_id,
         '<fresh-fixture-run-id>'::text AS run_id,
         <pre-action-row-version>::integer AS old_version,
         '<pre-action-boundary-fingerprint>'::text AS boundary_fingerprint
), state AS (
  SELECT
    c.id,
    c.case_status,
    c.payment_status,
    c.refund_status,
    c.row_version,
    c.payment_record_id,
    c.activation_idempotency_key,
    c.refund_idempotency_key,
    c.approved_at,
    c.approved_by_admin_id,
    c.rejected_at,
    c.rejected_by_admin_id,
    c.reopened_at,
    c.reopened_by_admin_id,
    c.rejection_reason,
    w.id IS NOT NULL AS workspace_exists,
    c.audit_metadata ->> 'fixture_scope' AS fixture_scope,
    c.audit_metadata ->> 'fixture_run_id' AS fixture_run_id,
    (SELECT count(*) FROM public.payment_records p
      WHERE p.solo_plus_case_id = c.id) AS reverse_payment_count,
    (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
      FROM public.solo_plus_case_requirements r WHERE r.case_id = c.id) AS requirement_codes,
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
          OR r.metadata IS DISTINCT FROM '{}'::jsonb)) AS non_pristine_requirement_count,
    (SELECT count(*) FROM public.solo_plus_case_events ev
      JOIN expected e2 ON e2.case_id = ev.case_id
      WHERE ev.event_type = 'case_review_requested_more_information'
        AND ev.actor_type = 'admin'
        AND ev.actor_id IS NOT NULL
        AND ev.request_idempotency_key IS NOT NULL
        AND ev.reason IS NOT NULL
        AND char_length(ev.reason) BETWEEN 1 AND 1000
        AND ev.previous_state ->> 'caseStatus' = 'manual_review'
        AND ev.previous_state ->> 'rowVersion' = e2.old_version::text
        AND ev.new_state ->> 'caseStatus' = 'verification_pending'
        AND ev.new_state ->> 'rowVersion' = (e2.old_version + 1)::text
        AND ev.policy_version = c.requirements_policy_version) AS exact_request_event_count,
    (SELECT count(*) FROM public.solo_plus_case_events ev
      WHERE ev.case_id = c.id
        AND ev.event_type IN ('case_approved','case_rejected','case_reopened')) AS prohibited_review_event_count,
    md5(jsonb_build_object(
      'merchantSubscriptionPlan', m.subscription_plan,
      'merchantTier', m.merchant_tier,
      'monthlyCollectionLimit', m.monthly_collection_limit,
      'merchantOnboardingStatus', m.onboarding_status,
      'merchantSetupMode', m.setup_mode,
      'merchantLiveFeaturesEnabled', m.live_features_enabled,
      'merchantVerificationStatus', m.verification_status,
      'merchantLiveFeaturesActivatedAt', m.live_features_activated_at,
      'workspacePlanType', w.plan_type,
      'workspaceOnboardingStatus', w.onboarding_status,
      'workspaceSetupMode', w.setup_mode,
      'workspaceLiveFeaturesEnabled', w.live_features_enabled
    )::text) AS commercial_boundary_fingerprint
  FROM expected e
  JOIN public.solo_plus_cases c ON c.id = e.case_id
  JOIN public.merchants m ON m.id = c.merchant_id
  LEFT JOIN public.workspaces w ON w.id = m.workspace_id
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM state) THEN 'BLOCKED|RMI_POSTFLIGHT|fixture_missing'
  WHEN (SELECT fixture_scope FROM state) IS DISTINCT FROM 'phase2b_admin_detail_smoke'
    OR (SELECT fixture_run_id FROM state) IS DISTINCT FROM (SELECT run_id FROM expected)
    THEN 'BLOCKED|RMI_POSTFLIGHT|fixture_marker_mismatch'
  WHEN (SELECT case_status FROM state) <> 'verification_pending'
    OR (SELECT row_version FROM state) <> (SELECT old_version + 1 FROM expected)
    THEN 'FAIL|RMI_POSTFLIGHT|case_state_or_version_mismatch'
  WHEN NOT (SELECT workspace_exists FROM state)
    THEN 'BLOCKED|RMI_POSTFLIGHT|workspace_missing'
  WHEN (SELECT exact_request_event_count FROM state) <> 1
    OR (SELECT prohibited_review_event_count FROM state) <> 0
    THEN 'FAIL|RMI_POSTFLIGHT|review_event_mismatch'
  WHEN (SELECT requirement_codes FROM state) IS DISTINCT FROM
    ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[]
    OR (SELECT non_pristine_requirement_count FROM state) <> 0
    THEN 'FAIL|RMI_POSTFLIGHT|requirements_changed'
  WHEN (SELECT payment_status FROM state) <> 'pending'
    OR (SELECT refund_status FROM state) <> 'none'
    OR (SELECT payment_record_id FROM state) IS NOT NULL
    OR (SELECT reverse_payment_count FROM state) <> 0
    OR (SELECT activation_idempotency_key FROM state) IS NOT NULL
    OR (SELECT refund_idempotency_key FROM state) IS NOT NULL
    THEN 'BLOCKED|RMI_POSTFLIGHT|commercial_side_effect_detected'
  WHEN (SELECT approved_at FROM state) IS NOT NULL
    OR (SELECT approved_by_admin_id FROM state) IS NOT NULL
    OR (SELECT rejected_at FROM state) IS NOT NULL
    OR (SELECT rejected_by_admin_id FROM state) IS NOT NULL
    OR (SELECT reopened_at FROM state) IS NOT NULL
    OR (SELECT reopened_by_admin_id FROM state) IS NOT NULL
    OR (SELECT rejection_reason FROM state) IS NOT NULL
    THEN 'BLOCKED|RMI_POSTFLIGHT|other_decision_side_effect_detected'
  WHEN (SELECT commercial_boundary_fingerprint FROM state) IS DISTINCT FROM
       (SELECT boundary_fingerprint FROM expected)
    THEN 'BLOCKED|RMI_POSTFLIGHT|merchant_or_workspace_boundary_changed'
  ELSE 'PASS|RMI_POSTFLIGHT|state_requirements_event_and_boundaries_verified'
END AS evidence;
ROLLBACK;
```

After the exact replay and stale-version probe, this query must still emit the
same PASS line. That proves the row version changed once and only one accepted
review event exists.

## Close the action window before cleanup

Immediately after postflight evidence:

1. Remove all five review-action/deployment-target environment values from the
   staging scope.
2. Redeploy only staging under separate approval.
3. Require the review POST to return private/no-store `404` again.
4. Require the exact detail page to show the read-only notice and no controls.

Do not proceed to cleanup while any action value is present.

## Separately approved cleanup

Cleanup is not authorized by fixture creation or action acceptance. After
evidence review and a separate cleanup approval, reuse the unchanged `$Fixture`
map:

```powershell
& .\scripts\phase2b-admin-detail-fixture-staging.ps1 `
  @Fixture `
  -Operation Cleanup `
  -RunMutation
if ($LASTEXITCODE -ne 0) { throw 'fixture_cleanup_blocked' }
```

Type exactly:

```text
STAGING CLEANUP PHASE2B ADMIN DETAIL FIXTURE
```

Required final line:

```text
PASS|FIXTURE|admin_read_case_removed
```

Then verify:

```powershell
& .\scripts\phase2b-admin-detail-fixture-staging.ps1 `
  @Fixture `
  -Operation PostCleanup
if ($LASTEXITCODE -ne 0) { throw 'fixture_postcleanup_blocked' }
```

Required final line:

```text
PASS|FIXTURE_CLEANUP|case_descendants_absent
```

The executor locks and revalidates the exact case, merchant, fixture scope,
and run ID; rechecks reverse payment linkage; deletes only that case's events
and requirements plus exactly one marked case; and rolls back on a mismatch.
It does not delete the synthetic auth user, merchant, workspace, or any
payment row.

## Stop conditions

Stop and remove the staging action values, if already present, when:

- the fixture is not fresh, synthetic, exact, and uniquely identified;
- preflight or postflight emits anything except its exact PASS line;
- the case/run/decision environment scope is missing, shared, broadened, or
  mismatched;
- a Vercel production-classified deployment lacks the exact staging target,
  staging Supabase project identity, or staging app-origin identity;
- a real production project/ref/origin indicator is detected;
- any action other than request-more-information is exposed or requested;
- a real case, merchant, payment, document, provider record, or customer datum
  would be touched;
- blank input makes a POST, the first response is not `updated`, exact replay
  is not `idempotent_replay`, or stale input is not `VERSION_CONFLICT`;
- row version changes more than once or event count differs from one;
- requirements, payment/refund, merchant/workspace, activation, collection,
  or sensitive-field boundaries change;
- raw credentials, tokens, reasons, request keys, rows, or sensitive fields
  would need to be copied; or
- cleanup cannot prove and delete exactly the marked synthetic fixture case.

## Evidence to paste back

Return only:

```text
FIXTURE_RUN_ID=<fresh exact run ID>
FIXTURE_CASE_ID=<fresh exact case UUID>
FIXTURE_PREFLIGHT=PASS|FIXTURE|draft_case_eligible
FIXTURE_CREATE=PASS|FIXTURE|admin_read_case_prepared
FIXTURE_POSTFLIGHT=PASS|FIXTURE|admin_detail_ready
QUEUE_VISIBLE=YES
DETAIL_VISIBLE=YES
REVIEW_CONTROLS_WHILE_DISABLED=HIDDEN
SENSITIVE_FIELDS=NOT_EXPOSED
RMI_PREFLIGHT=PASS|RMI_PREFLIGHT|ready|row_version=<n>|boundary=<digest>
ACTION_SCOPE=ONE_CASE|ONE_RUN|request_more_information
BLANK_REASON_POST=NOT_SENT
FIRST_RESPONSE=HTTP_200|updated|private_no_store
EXACT_REPLAY=HTTP_200|idempotent_replay|no_second_change
STALE_REQUEST=HTTP_409|VERSION_CONFLICT|no_change
RMI_POSTFLIGHT=PASS|RMI_POSTFLIGHT|state_requirements_event_and_boundaries_verified
UNEXPECTED_NETWORK_OR_LOG_FAILURES=NONE
ACTION_VALUES_AFTER_WINDOW=REMOVED
REVIEW_ROUTE_AFTER_WINDOW=HTTP_404|private_no_store
CLEANUP=NOT_RUN_PENDING_SEPARATE_APPROVAL|SEPARATELY_APPROVED_PASS
PRODUCTION=BLOCKED
```

Do not paste the synthetic email, business name, reason, idempotency key,
reviewer UUID, cookies, authorization headers, credentials, raw database rows,
provider/payment data, or document/storage data.

## Gate sequence

1. Independent package review.
2. Separately approved fixture creation only.
3. Disabled-action queue/detail and read-only preflight evidence review.
4. Separately approved exact environment change and staging deployment.
5. Separately approved three-request acceptance sequence.
6. Read-only postflight.
7. Remove all action values and restore the default-blocked staging deployment.
8. Separate cleanup review and approval.

Passing fixture creation does not authorize steps 4–8. Production remains
blocked throughout.
