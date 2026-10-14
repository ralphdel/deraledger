# Phase 2B staging unpaid reject acceptance gate

**Status: historical reject acceptance package.** The exact reject action,
default-block restoration, fixture cleanup, and postcleanup completed. This
document authorizes no further fixture, environment, deployment, action,
cleanup, or production activity. The proposed approve package is
`docs/prd-phase-2b-admin-ui-staging-approve-acceptance-runbook.md`; approve
fixture planning remains blocked. The historical reject gate used exactly one
fresh synthetic unpaid case, one `phase2b-reject-<yyyymmdd>-<random-suffix>`
run ID, and `reject` only. The completed RMI and reject fixtures cannot be reused.

## Boundary and approvals

Before any acceptance window, separately approve: this source/security review;
fresh synthetic fixture creation; the exact case UUID and run ID; read-only
preflight access; the six exact staging environment values below; staging
deployment; the single reject execution; default-block restoration deployment;
and, later, guarded cleanup. An approval for one step grants no later step.
Request more information, approve, reopen, paid rejection/refund processing,
payment, document/provider access, activation, collection unlock, and production
remain outside this gate.

The server requires both the general review-action flag and the new
`DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED=true` flag. It accepts
only `decision=reject`, an exact case UUID, a fresh run ID matching
`phase2b-reject-YYYYMMDD-<3-to-16-lowercase-alphanumeric-characters>`, and
positive dedicated staging target, Supabase project, and app-origin identity.
The route checks the exact case and decision. The service also checks the DB
fixture scope/run marker, the synthetic fixture marker, unpaid case fields,
row version 1, `manual_review`, and absence of a prior review decision event.
The atomic RPC still owns the version/state/idempotency mutation boundary.
The reviewed canonical payment paths increment `row_version` when setting a
case paid, so their concurrent update would conflict with the expected version.
The unpaid service check itself is outside the RPC transaction, and the RPC
supports paid rejection for other gates. Independent source/security review
must confirm there is no alternate unversioned payment path before granting
reject execution approval; otherwise a separately reviewed atomic RPC guard
is required. This package does not authorize paid rejection.

## Fresh fixture preparation

Use a newly owned test inbox, dated synthetic business name, and new random
suffix. Create a starter account/workspace and Solo Plus draft case only through
the normal staging UI. Stop before payment, provider selection, documents,
verification, or any real customer data. Record the exact case UUID privately.
Do not reuse the RMI case or run ID, another fixture, or a paid case.

The existing guarded `scripts/phase2b-admin-detail-fixture-staging.ps1` owns
fixture creation. Under a separate fixture approval, its read-only `Preflight`
must first return `PASS|FIXTURE|draft_case_eligible`; its separately approved
`Create` must return `PASS|FIXTURE|admin_read_case_prepared`; its read-only
`Postflight` must return `PASS|FIXTURE|admin_detail_ready`. Keep its exact
staging target and email/business-name guards. Do not edit or bypass it.

With all review-action values absent, confirm one exact queue/detail case,
six pristine requirements, no sensitive fields, and a read-only notice with no
action controls. The fixture must have `manual_review`, `row_version=1`,
`payment_status=pending`, `refund_status=none`, no payment/provider/document
data, no review decision event, and no activation or refund idempotency state.

## Read-only reject preflight

This template is for a separately approved read-only staging inspection path.
It has not been run by this package. Replace both placeholders locally, inspect
the compact line only, and stop unless it is an exact PASS. Preserve the
boundary fingerprint and row version privately for the later postflight.
Never paste raw rows, personal data, keys, reasons, or credentials.

```sql
BEGIN TRANSACTION READ ONLY;
WITH expected AS (
  SELECT '<fresh-reject-case-uuid>'::uuid AS case_id,
         '<fresh-reject-run-id>'::text AS run_id
), state AS (
  SELECT c.id, c.case_status, c.row_version, c.payment_status, c.refund_status,
         c.payment_provider, c.payment_reference, c.payment_record_id,
         c.activation_idempotency_key, c.refund_idempotency_key,
         c.approved_at, c.approved_by_admin_id, c.rejected_at,
         c.rejected_by_admin_id, c.reopened_at, c.reopened_by_admin_id,
         c.rejection_reason,
         c.audit_metadata ->> 'fixture_scope' AS fixture_scope,
         c.audit_metadata ->> 'fixture_run_id' AS fixture_run_id,
         c.audit_metadata ->> 'synthetic_read_only_admin_smoke' AS synthetic_marker,
         w.id IS NOT NULL AS workspace_exists,
         (SELECT count(*) FROM public.solo_plus_cases x
            WHERE x.merchant_id = c.merchant_id AND x.case_status IN
              ('draft','awaiting_payment','verification_pending','manual_review')) AS active_case_count,
         (SELECT count(*) FROM public.payment_records p
            WHERE p.solo_plus_case_id = c.id) AS payment_count,
         (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
            FROM public.solo_plus_case_requirements r WHERE r.case_id = c.id) AS requirement_codes,
         (SELECT count(*) FROM public.solo_plus_case_requirements r
            WHERE r.case_id = c.id AND (r.requirement_state <> 'not_started'
              OR r.verification_log_id IS NOT NULL OR r.evidence_source_type IS NOT NULL
              OR r.evidence_source_id IS NOT NULL OR r.evidence_reference IS NOT NULL
              OR r.original_completed_at IS NOT NULL OR r.reuse_decision_at IS NOT NULL
              OR r.reuse_reason IS NOT NULL OR r.policy_rule_applied IS NOT NULL
              OR r.reviewed_by_admin_id IS NOT NULL OR r.review_note IS NOT NULL
              OR r.provider_name IS NOT NULL OR r.provider_reference IS NOT NULL
              OR r.failure_reason IS NOT NULL OR r.completed_at IS NOT NULL
              OR r.metadata IS DISTINCT FROM '{}'::jsonb)) AS non_pristine_count,
         (SELECT count(*) FROM public.solo_plus_case_events ev
            WHERE ev.case_id = c.id AND ev.event_type = 'fixture_admin_read_smoke_prepared'
              AND ev.request_idempotency_key = 'phase2b-fixture:' || e.run_id || ':admin-read-smoke') AS fixture_event_count,
         (SELECT count(*) FROM public.solo_plus_case_events ev
            WHERE ev.case_id = c.id AND ev.event_type IN
              ('case_review_requested_more_information','case_approved','case_rejected','case_reopened')) AS review_event_count,
         md5(jsonb_build_object(
           'merchantSubscriptionPlan',m.subscription_plan,'merchantTier',m.merchant_tier,
           'monthlyCollectionLimit',m.monthly_collection_limit,
           'merchantOnboardingStatus',m.onboarding_status,'merchantSetupMode',m.setup_mode,
           'merchantLiveFeaturesEnabled',m.live_features_enabled,
           'merchantVerificationStatus',m.verification_status,
           'merchantLiveFeaturesActivatedAt',m.live_features_activated_at,
           'workspacePlanType',w.plan_type,'workspaceOnboardingStatus',w.onboarding_status,
           'workspaceSetupMode',w.setup_mode,'workspaceLiveFeaturesEnabled',w.live_features_enabled
         )::text) AS boundary
  FROM expected e JOIN public.solo_plus_cases c ON c.id = e.case_id
  JOIN public.merchants m ON m.id = c.merchant_id
  LEFT JOIN public.workspaces w ON w.id = m.workspace_id
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM state) THEN 'BLOCKED|REJECT_PREFLIGHT|fixture_missing'
  WHEN (SELECT fixture_scope FROM state) IS DISTINCT FROM 'phase2b_admin_detail_smoke'
    OR (SELECT fixture_run_id FROM state) IS DISTINCT FROM (SELECT run_id FROM expected)
    OR (SELECT synthetic_marker FROM state) IS DISTINCT FROM 'true'
    THEN 'BLOCKED|REJECT_PREFLIGHT|fixture_marker_mismatch'
  WHEN (SELECT case_status FROM state) IS DISTINCT FROM 'manual_review'
    OR (SELECT row_version FROM state) IS DISTINCT FROM 1
    OR (SELECT active_case_count FROM state) <> 1
    OR NOT (SELECT workspace_exists FROM state)
    THEN 'BLOCKED|REJECT_PREFLIGHT|fresh_case_state_mismatch'
  WHEN (SELECT payment_status FROM state) IS DISTINCT FROM 'pending'
    OR (SELECT refund_status FROM state) IS DISTINCT FROM 'none'
    OR (SELECT payment_provider FROM state) IS NOT NULL
    OR (SELECT payment_reference FROM state) IS NOT NULL
    OR (SELECT payment_record_id FROM state) IS NOT NULL
    OR (SELECT payment_count FROM state) <> 0
    OR (SELECT activation_idempotency_key FROM state) IS NOT NULL
    OR (SELECT refund_idempotency_key FROM state) IS NOT NULL
    THEN 'BLOCKED|REJECT_PREFLIGHT|commercial_state_present'
  WHEN (SELECT approved_at FROM state) IS NOT NULL
    OR (SELECT approved_by_admin_id FROM state) IS NOT NULL
    OR (SELECT rejected_at FROM state) IS NOT NULL
    OR (SELECT rejected_by_admin_id FROM state) IS NOT NULL
    OR (SELECT reopened_at FROM state) IS NOT NULL
    OR (SELECT reopened_by_admin_id FROM state) IS NOT NULL
    OR (SELECT rejection_reason FROM state) IS NOT NULL
    THEN 'BLOCKED|REJECT_PREFLIGHT|prior_decision_state_present'
  WHEN (SELECT requirement_codes FROM state) IS DISTINCT FROM
    ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[]
    OR (SELECT non_pristine_count FROM state) <> 0
    OR (SELECT fixture_event_count FROM state) <> 1
    OR (SELECT review_event_count FROM state) <> 0
    THEN 'BLOCKED|REJECT_PREFLIGHT|fixture_or_review_events_unexpected'
  ELSE 'PASS|REJECT_PREFLIGHT|ready|row_version=' || (SELECT row_version FROM state)::text ||
       '|boundary=' || (SELECT boundary FROM state)
END AS evidence;
ROLLBACK;
```

## Proposed exact staging environment values

These are a template, not current values or permission to change them. Replace
the placeholders only after the fresh fixture and read-only preflight are
approved. Apply solely to the dedicated staging project for one short window.
The staging Supabase public project URL and app origin must already identify
the approved staging tuple; do not change or print credentials.

```text
DERALEDGER_DEPLOYMENT_TARGET=staging
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED=true
DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED=true
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID=<fresh exact reject fixture case UUID>
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION=reject
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID=<fresh exact phase2b-reject-YYYYMMDD-random run ID>
```

No placeholder is deployable. A dedicated staging `VERCEL_ENV=production` slot
still needs the exact staging target, Supabase project, and app origin; a real
production indicator blocks the gate. The reject gate also requires these
positive staging identities for preview/development classification. Stop if a
scope is shared, broad, malformed, or includes the old RMI fixture.

## UI and API acceptance after separate approvals

First confirm the exact staging build and env scope, preflight PASS, DB-backed
super-admin identity, and the exact fresh case detail. Only **Reject** may be
visible on that case. Request more information, approve, and reopen controls
must be absent; every other case must remain read-only. An ordinary merchant
and unauthenticated caller must not be able to act.

1. Leave the reason blank or whitespace. The UI must show the required-reason
   error and send no POST.
2. Enter a short synthetic reason without customer, payment, provider, or
   document data. Open the reject confirmation and verify it names rejection,
   not approval or activation. Cancel once; no POST should occur.
3. Only after separate **execution approval**, open the confirmation again and
   submit **Reject** once from the refreshed single tab. No replay, stale tab,
   second decision, or other action is part of this gate.
4. Expect HTTP 200, private/no-store, `kind=updated`, `caseStatus=rejected`,
   and row version 2. The response must omit the reviewer, reason, request key,
   payment/provider details, and internal diagnostics. Stop on any other result;
   do not retry.

## Read-only post-action verification

Only through a separately approved read-only inspection path, verify the same
exact case/run marker and preflight boundary: `case_status=rejected`, row
version 2, nonempty synthetic rejection reason, rejection timestamp and admin
actor, exactly one `case_rejected` event with previous `manual_review`/version
1 and new `rejected`/version 2, and zero RMI/approve/reopen events. Six pristine
requirements, pending payment, `refund_status=none`, no payment record,
provider reference, refund operation/idempotency key, activation, or merchant/
workspace commercial change must remain. The compact result must be
`PASS|REJECT_POSTFLIGHT|state_event_and_boundaries_verified`; any other result
blocks the gate. Preserve redacted evidence before cleanup.

The following template uses the privately retained exact case/run and
preflight fingerprint. It has not been executed by this package.

```sql
BEGIN TRANSACTION READ ONLY;
WITH expected AS (
  SELECT '<fresh-reject-case-uuid>'::uuid AS case_id,
         '<fresh-reject-run-id>'::text AS run_id,
         '<preflight-boundary-fingerprint>'::text AS old_boundary
), state AS (
  SELECT c.id, c.case_status, c.row_version, c.payment_status, c.refund_status,
         c.payment_provider, c.payment_reference, c.payment_record_id,
         c.activation_idempotency_key, c.refund_idempotency_key,
         c.rejection_reason, c.rejected_at, c.rejected_by_admin_id,
         c.approved_at, c.approved_by_admin_id, c.reopened_at, c.reopened_by_admin_id,
         c.audit_metadata ->> 'fixture_scope' AS fixture_scope,
         c.audit_metadata ->> 'fixture_run_id' AS fixture_run_id,
         c.audit_metadata ->> 'synthetic_read_only_admin_smoke' AS synthetic_marker,
         (SELECT count(*) FROM public.payment_records p
            WHERE p.solo_plus_case_id = c.id) AS payment_count,
         (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
            FROM public.solo_plus_case_requirements r WHERE r.case_id = c.id) AS requirement_codes,
         (SELECT count(*) FROM public.solo_plus_case_requirements r
            WHERE r.case_id = c.id AND (r.requirement_state <> 'not_started'
              OR r.verification_log_id IS NOT NULL OR r.evidence_source_type IS NOT NULL
              OR r.evidence_source_id IS NOT NULL OR r.evidence_reference IS NOT NULL
              OR r.original_completed_at IS NOT NULL OR r.reuse_decision_at IS NOT NULL
              OR r.reuse_reason IS NOT NULL OR r.policy_rule_applied IS NOT NULL
              OR r.reviewed_by_admin_id IS NOT NULL OR r.review_note IS NOT NULL
              OR r.provider_name IS NOT NULL OR r.provider_reference IS NOT NULL
              OR r.failure_reason IS NOT NULL OR r.completed_at IS NOT NULL
              OR r.metadata IS DISTINCT FROM '{}'::jsonb)) AS non_pristine_count,
         (SELECT count(*) FROM public.solo_plus_case_events ev
            WHERE ev.case_id = c.id AND ev.event_type = 'case_rejected'
              AND ev.actor_type = 'admin' AND ev.actor_id = c.rejected_by_admin_id
              AND ev.request_idempotency_key IS NOT NULL
              AND ev.reason = c.rejection_reason
              AND ev.policy_version = c.requirements_policy_version
              AND ev.previous_state ->> 'caseStatus' = 'manual_review'
              AND ev.previous_state ->> 'rowVersion' = '1'
              AND ev.new_state ->> 'caseStatus' = 'rejected'
              AND ev.new_state ->> 'rowVersion' = '2') AS exact_reject_event_count,
         (SELECT count(*) FROM public.solo_plus_case_events ev
            WHERE ev.case_id = c.id AND ev.event_type = 'case_rejected') AS total_reject_event_count,
         (SELECT count(*) FROM public.solo_plus_case_events ev
            WHERE ev.case_id = c.id AND ev.event_type IN
              ('case_review_requested_more_information','case_approved','case_reopened')) AS other_decision_count,
         md5(jsonb_build_object(
           'merchantSubscriptionPlan',m.subscription_plan,'merchantTier',m.merchant_tier,
           'monthlyCollectionLimit',m.monthly_collection_limit,
           'merchantOnboardingStatus',m.onboarding_status,'merchantSetupMode',m.setup_mode,
           'merchantLiveFeaturesEnabled',m.live_features_enabled,
           'merchantVerificationStatus',m.verification_status,
           'merchantLiveFeaturesActivatedAt',m.live_features_activated_at,
           'workspacePlanType',w.plan_type,'workspaceOnboardingStatus',w.onboarding_status,
           'workspaceSetupMode',w.setup_mode,'workspaceLiveFeaturesEnabled',w.live_features_enabled
         )::text) AS boundary
  FROM expected e JOIN public.solo_plus_cases c ON c.id = e.case_id
  JOIN public.merchants m ON m.id = c.merchant_id
  LEFT JOIN public.workspaces w ON w.id = m.workspace_id
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM state) THEN 'BLOCKED|REJECT_POSTFLIGHT|fixture_missing'
  WHEN (SELECT fixture_scope FROM state) IS DISTINCT FROM 'phase2b_admin_detail_smoke'
    OR (SELECT fixture_run_id FROM state) IS DISTINCT FROM (SELECT run_id FROM expected)
    OR (SELECT synthetic_marker FROM state) IS DISTINCT FROM 'true'
    THEN 'BLOCKED|REJECT_POSTFLIGHT|fixture_marker_mismatch'
  WHEN (SELECT case_status FROM state) IS DISTINCT FROM 'rejected'
    OR (SELECT row_version FROM state) IS DISTINCT FROM 2
    OR (SELECT rejected_at FROM state) IS NULL
    OR (SELECT rejected_by_admin_id FROM state) IS NULL
    OR NULLIF(btrim((SELECT rejection_reason FROM state)), '') IS NULL
    OR (SELECT approved_at FROM state) IS NOT NULL
    OR (SELECT approved_by_admin_id FROM state) IS NOT NULL
    OR (SELECT reopened_at FROM state) IS NOT NULL
    OR (SELECT reopened_by_admin_id FROM state) IS NOT NULL
    THEN 'FAIL|REJECT_POSTFLIGHT|case_decision_state_mismatch'
  WHEN (SELECT exact_reject_event_count FROM state) <> 1
    OR (SELECT total_reject_event_count FROM state) <> 1
    OR (SELECT other_decision_count FROM state) <> 0
    THEN 'FAIL|REJECT_POSTFLIGHT|review_event_mismatch'
  WHEN (SELECT payment_status FROM state) IS DISTINCT FROM 'pending'
    OR (SELECT refund_status FROM state) IS DISTINCT FROM 'none'
    OR (SELECT payment_provider FROM state) IS NOT NULL
    OR (SELECT payment_reference FROM state) IS NOT NULL
    OR (SELECT payment_record_id FROM state) IS NOT NULL
    OR (SELECT payment_count FROM state) <> 0
    OR (SELECT activation_idempotency_key FROM state) IS NOT NULL
    OR (SELECT refund_idempotency_key FROM state) IS NOT NULL
    THEN 'BLOCKED|REJECT_POSTFLIGHT|commercial_side_effect_detected'
  WHEN (SELECT requirement_codes FROM state) IS DISTINCT FROM
    ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[]
    OR (SELECT non_pristine_count FROM state) <> 0
    THEN 'FAIL|REJECT_POSTFLIGHT|requirements_changed'
  WHEN (SELECT boundary FROM state) IS DISTINCT FROM (SELECT old_boundary FROM expected)
    THEN 'BLOCKED|REJECT_POSTFLIGHT|merchant_or_workspace_boundary_changed'
  ELSE 'PASS|REJECT_POSTFLIGHT|state_event_and_boundaries_verified'
END AS evidence;
ROLLBACK;
```

## Restore default block

After postflight evidence, separately approve removal of all six temporary
review-action/deployment-target values from dedicated staging and a staging-only
redeploy. Confirm the POST returns private/no-store 404 and the exact detail
page and queue show no Request more information, Reject, Approve, or Reopen
control. Do not run cleanup while any action value remains.

## Cleanup and evidence

Cleanup is not authorized by fixture creation or reject acceptance. After
default-block evidence and separate cleanup approval, use only the existing
guarded fixture executor on the exact marked case/run. It must recheck the
locked target, payment linkage, and exact one-case deletion; then separately
verify descendants absent. Synthetic user/merchant/workspace cleanup is a
different decision. Do not use reopen or ad hoc SQL as cleanup.

Record only compact status lines, exact deployment identifiers, row version,
and boundary fingerprint. Never paste cookies, tokens, request keys, reasons,
auth headers, raw request bodies, full rows, or personal/payment/provider data.
Production remains untouched.
