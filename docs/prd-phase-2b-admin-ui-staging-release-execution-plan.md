# Phase 2B Admin UI staging release execution plan

**Status:** staging-only acceptance plan. It authorizes no database action,
runtime change, route-flag change, decision execution, activation, collection
unlock, payment behaviour, or production activity by itself.

## Confirmed staging status

The following user-supplied staging evidence is accepted as the starting point
for this plan:

- staging was rebuilt successfully from the source migration chain and its
  migration ledger matches local through `20260831`;
- the staging Vercel deployment, ordinary signup/login, and starter workspace
  provisioning work; and
- the legacy-admin boundary has returned the expected private/no-store `404`
  for an excluded legacy endpoint, and the repaired `/admin/solo-plus/cases`
  route has rendered its safe empty state without treating `cases` as a case
  identifier; and
- Solo Plus is available in staging after the separately controlled staging
  settings `solo_plus_enabled=true` and `solo_plus_kyc_enabled=true`; and
- the designated staging support account has been restored through the
  DB-backed authority contract: its authenticated user ID owns a
  `public.merchants` row with `is_super_admin = true`. Auth metadata is not the
  evidence of authority; and
- the read-only queue/detail fixture smoke and its guarded cleanup both passed.
  The fixture case was removed with `PASS|FIXTURE|admin_read_case_removed` and
  `PASS|FIXTURE_CLEANUP|case_descendants_absent`. See
  `docs/prd-phase-2b-admin-ui-read-only-staging-closeout.md`.

This is not evidence that an admin UI may perform decisions, activate a
merchant, issue M030 readiness, unlock collection, or change commercial
behaviour. Production remains blocked and out of scope.

## What is complete

- `/admin/solo-plus/cases` and `/admin/solo-plus/cases/[caseId]` have
  server-side super-admin guards and use private/no-store admin API responses.
  The older root paths redirect to these canonical paths after the same guard.
- The queue and detail APIs reject unauthenticated and non-super-admin callers
  before accessing the Solo Plus read service.
- The detail UI shows a requirement-level summary and case-event history, not
  direct table access or a document-storage browser.
- The reviewed action form implementation retains row-version/idempotency and
  reason requirements, but the current release gate withholds the form and
  shows a read-only disabled-actions notice. No activation control exists.
- The existing Solo Plus state model distinguishes `approved_pending_activation`
  from `activated`; its separate activation RPC is not part of this plan.

## Source/security resolution status

The Phase 2B source package now resolves the two code-level blockers:

- `src/lib/admin-rbac.ts` resolves authority from the server-only
  `public.merchants.is_super_admin` record for the authenticated user. Neither
  `user_metadata` nor `app_metadata` can grant Phase 2B queue, detail, or
  review-service authority. An unavailable DB authority lookup fails closed.
- `src/lib/solo-plus/server/review-service.ts` now creates the distinct
  `admin_review` context only after that DB-backed authority resolution.
  `internal_test` remains limited to its earlier controlled test-case creation
  contract and is rejected by review orchestration.
- `src/proxy.ts` no longer treats auth metadata as admin authority. It performs
  navigation/session work only; the server page/API guard owns authorization.
- `src/proxy.ts` also enforces the legacy admin API release boundary before
  creating an auth client. Every `/api/admin/*` route outside the explicit
  `/api/admin/solo-plus/*` allowlist returns `404` unless the server-only
  `DERALEDGER_LEGACY_ADMIN_APIS_ENABLED` flag is exactly `true`. Unset, blank,
  or false values remain blocked; Vercel production remains blocked even if
  the flag is set.
- The Phase 2B admin payment summary no longer returns or renders the internal
  payment/provider reference. The DTO retains only the provider classification,
  amount, currency, status, and confirmation time needed for review.
- Solo Plus review mutations are now controlled by the server-only
  `DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED` release gate. Unset,
  blank, and false values return a private/no-store `404` before authorization
  or service construction. `VERCEL_ENV=production` always disables actions,
  even if the flag is true. The reviewer service independently enforces the
  same gate. Queue/detail GET routes are not gated and remain read-only.
- The case-detail page computes the gate on the server. While disabled it
  renders a read-only release notice and no approve, reject, request-more-
  information, or reopen controls.

Document bytes are **deferred** from this release. The case-detail UI is
intentionally metadata/status-only and exposes no document action or broken
link. A server-mediated, short-lived signed-URL design remains a separate
future gate if product review later requires document viewing.

## Remaining staging blockers

1. The read-only fixture is cleaned up and cannot be reused. Any future
   review-action testing requires a new isolated fixture plus separate
   creation, action, and cleanup approvals. Do not create test rows through
   direct SQL outside an approved guarded fixture package.
2. Review actions remain technically blocked. Enabling the action gate requires
   a new source/security review and a controlled staging action-acceptance
   plan; approval must remain separate from activation.
3. The M024-M030 approval-request/readiness RPCs remain separate from this
   older Solo Plus review UI. M030/live readiness, merchant activation, and
   collection unlock remain disabled.

Queue/detail route smoke becomes allowed only after this source package is
independently approved and deployed to staging. Approve, reject,
request-more-information, and reopen remain technically blocked by default;
an approved fixture does not enable them. Enabling the action flag requires a
separate source/security review, staging action plan, and explicit approval.
No decision request is authorized by this document.

Legacy admin endpoints are not made release-ready by this package. They are
server-blocked by default even if the caller holds the historical
`admin_session` cookie. This gate covers the DB-guarded Solo Plus queue, detail,
and review routes only; enabling the legacy flag or releasing any broader
admin-portal surface requires a separate source/security review. Production
cannot enable the legacy surface through this flag.

## Required staging test data

Use only the independently approved, non-production staging fixture plan in
`docs/prd-phase-2b-admin-ui-staging-detail-fixture-plan.md`. Its initial
identity and draft case are created by the normal product flow; the narrowly
scoped manual transition exists only to exercise the queue/detail read path.
It must contain:

- one ordinary authenticated user (negative RBAC test);
- the designated staging account whose authenticated user ID has a matching
  `public.merchants.is_super_admin = true` row (positive RBAC test);
- one isolated merchant/workspace and one Solo Plus case in `manual_review`;
- exactly the six normal-flow canonical requirement rows, shown only as
  non-sensitive code/state metadata, with every evidence/provider/completion/
  reuse/review/failure field null and JSON metadata exactly empty; and
- no document/evidence row, storage path, signed URL, or document payload.

Do not put real or synthetic KYC documents, provider credentials, production
references, or payment instruments in this fixture. Document/evidence viewing
is deferred. Fixture creation and any future review decision are separate
explicit staging approvals; neither is covered by this document.

The approved fixture executor cleanup must lock the exact marked case before
rechecking reverse payment linkage, and must prove that `DELETE ... RETURNING`
removed exactly that one marked case. A missing target, concurrent payment
link, or non-one-row result rolls the cleanup transaction back. Its offline
unit-test mode stops before psql/password handling and exists only to exercise
target and mutation gates without database access.

## Acceptance checklist

Each step records compact redacted evidence (`PASS|...`, `FAIL|...`, or
`BLOCKED|...`) plus an approved screenshot or browser-network summary that
contains no document content, tokens, cookies, URLs with signatures, or
personal data.

### 0. Preflight and release boundary

1. Confirm the tested deployment is staging and the production deployment is
   not open or modified.
2. Confirm the migration ledger is still aligned through `20260831` and the
   Solo Plus staging settings remain explicitly enabled.
3. Confirm no M030/readiness, activation, collection-unlock, or commercial
   route flag was enabled for this exercise.
4. Confirm the legacy admin API release flag is classified as unset/disabled,
   then verify a representative excluded `/api/admin/*` route returns `404`
   even with the historical admin cookie. Do not record the cookie or raw
   environment value.
5. Record the immutable build identifier and the feature-flag state only as
   redacted classifications, never as raw environment output.

Stop if the target, build, flags, or fixture identity cannot be established
without exposing sensitive values.

### 1. Portal route and RBAC

1. Open `/admin/solo-plus/cases` unauthenticated: it must redirect to
   `/admin-login` or return the approved unauthorized result, without queue
   data. `/admin/solo-plus` must redirect to this canonical queue path for an
   authorized user.
2. Sign in as the ordinary fixture user: the page/API must deny with `403` and
   show no case data.
3. Sign in as the designated super-admin fixture user: `/admin/solo-plus/cases`
   must render the queue page and call `GET /api/admin/solo-plus/cases` only;
   it must never call `/api/admin/solo-plus/cases/cases`. Case links must open
   `/admin/solo-plus/cases/<caseId>`, whose detail request is
   `GET /api/admin/solo-plus/cases/<caseId>`. Both responses must be
   private/no-store.
4. Refresh and use browser back/forward. No response may be served from a
   shared cache and no failed API call or browser-console warning is allowed.

**Decision gate:** confirm ordinary-user denial and DB-backed super-admin
acceptance in staging. Stop if metadata-only authority succeeds or if an
`internal_test` context appears in review evidence.

### 2. Queue and case-detail read path

1. Exercise queue filters, merchant search, pagination, empty state, and a
   malformed/unknown case URL. The UI must not reveal data to a non-admin or
   return an unhandled error.
2. Open the approved fixture case. Check merchant summary, payment/refund
   summary, review state, activation state, requirement list, and history
   pagination.
3. Confirm this metadata-only fixture is not activated and the page presents
   neither an activation control nor a review-action control. The broader
   state model must continue to distinguish `approved_pending_activation`
   from `activated`, but this fixture does not exercise either state.
4. Inspect the case-detail response and rendered payment summary. Neither may
   contain `providerReference`, `paymentReference`, an internal transaction
   reference, or any equivalent provider identifier.

### 3. Requirement and evidence status

For each fixture requirement, verify that the UI shows only its canonical code
and non-sensitive state. This fixture intentionally has no evidence source,
capture time, file metadata, or document. It must not render a provider
reference, internal payment reference, storage key, evidence or bucket path,
raw provider payload, checksum, signed URL, document URL, or document bytes.

The UI intentionally has no document-view action in this release. A later private-document gate
must introduce a reviewed server endpoint that authorizes the super-admin on
every request and returns a short-lived signed URL or streams the object. It
must not use `getPublicUrl`, browser storage listing, anonymous access, or a
bucket-wide browser policy.

### 4. Decision history and action readiness

The current release must show the read-only disabled-actions notice and no
action controls. A direct POST to `/api/admin/solo-plus/review` must return a
private/no-store `404` while the gate is off. Do not set the action flag for
this queue/detail smoke.

Only after a separate review explicitly enables the mutation gate may a future
plan test, on independent fixtures:

1. request more information (reason required);
2. reject (reason required; confirm any refund review state is only recorded,
   not executed); and
3. approve (optional note; assert approval leaves activation pending).

Use a fresh row version and a unique idempotency key for each test. Repeat the
same request once only to verify idempotent replay, then issue a stale
row-version request to verify a `409` conflict. Never use the UI to call the
separate activation RPC.

## Read-only SQL evidence templates

These are **future user-run staging checks only**. They are not commands for
this task and require separate target-specific approval. Replace
`<approved_case_uuid>` with the approved fixture case UUID. Run each template
inside a single read-only transaction and retain only its compact result line;
do not retain raw rows, reasons, provider references, document paths, or
metadata.

### A. Queue/detail and requirement summary

```sql
BEGIN;
SET TRANSACTION READ ONLY;
WITH target AS (
  SELECT '<approved_case_uuid>'::uuid AS case_id
), summary AS (
  SELECT c.case_status, c.row_version,
         c.activation_idempotency_key IS NOT NULL AS activated,
         count(r.id) AS requirement_count,
         count(r.id) FILTER (
           WHERE r.requirement_state IN ('passed', 'reused', 'waived')
         ) AS satisfied_count
  FROM public.solo_plus_cases c
  JOIN target t ON t.case_id = c.id
  LEFT JOIN public.solo_plus_case_requirements r ON r.case_id = c.id
  GROUP BY c.case_status, c.row_version, c.activation_idempotency_key
)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM summary)
    THEN 'PASS|CASE_READ|present|requirements=' ||
         (SELECT requirement_count FROM summary)::text ||
         '|satisfied=' || (SELECT satisfied_count FROM summary)::text ||
         '|activation=' || CASE WHEN (SELECT activated FROM summary) THEN 'activated' ELSE 'not_activated' END
  ELSE 'BLOCKED|CASE_READ|fixture_missing'
END AS evidence;
ROLLBACK;
```

Run it after queue load, case-detail load, and every UI refresh. A case marked
`activated` is a stop condition for this release gate unless that was the
pre-approved fixture state and a separate activation audit owns the evidence.

### B. Safe private-document boundary

```sql
BEGIN;
SET TRANSACTION READ ONLY;
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND roles && ARRAY['anon', 'authenticated']::name[]
  ) THEN 'BLOCKED|DOCUMENT_ACCESS|browser_storage_policy_present'
  ELSE 'PASS|DOCUMENT_ACCESS|no_browser_storage_policy'
END AS evidence;
ROLLBACK;
```

This checks the release boundary only; it does not authorize a policy, reveal
an object, or prove that a future signed-URL endpoint is correctly authorized.

### C. Post-action state and audit check

After each separately approved action, use this template with the expected
event name: `case_review_requested_more_information`, `case_rejected`, or
`case_approved`.

```sql
BEGIN;
SET TRANSACTION READ ONLY;
WITH target AS (
  SELECT '<approved_case_uuid>'::uuid AS case_id,
         '<expected_event_name>'::text AS expected_event
), state AS (
  SELECT c.case_status, c.row_version,
         c.activation_idempotency_key IS NOT NULL AS activated,
         count(e.id) FILTER (WHERE e.event_type = t.expected_event) AS expected_event_count
  FROM public.solo_plus_cases c
  JOIN target t ON t.case_id = c.id
  LEFT JOIN public.solo_plus_case_events e ON e.case_id = c.id
  GROUP BY c.case_status, c.row_version, c.activation_idempotency_key
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM state) THEN 'BLOCKED|ACTION_AUDIT|fixture_missing'
  WHEN (SELECT activated FROM state) THEN 'BLOCKED|ACTION_AUDIT|activation_detected'
  WHEN (SELECT expected_event_count FROM state) <> 1 THEN 'FAIL|ACTION_AUDIT|event_count_unexpected'
  ELSE 'PASS|ACTION_AUDIT|state_and_event_recorded|row_version=' ||
       (SELECT row_version FROM state)::text
END AS evidence;
ROLLBACK;
```

For approve, the acceptable case state is `approved` and the result must be
`not_activated`. For request-more-information, the expected case state is
`verification_pending`. For reject, expected refund status must be reviewed
in the UI/API response and by a separate compact query before any refund
operation; this plan authorizes no refund execution.

## Evidence to return for review

Collect only:

- staging build classification and route/flag classification;
- RBAC results for unauthenticated, ordinary-user, and super-admin requests;
- queue/filter/pagination and case-detail screenshot identifiers with personal
  data redacted;
- compact result from template A for each read-only UI step;
- document-boundary result from template B;
- if a later mutation gate is approved, one compact template-C line and the
  corresponding API status for each action; and
- browser-console/API summary: no controlled/uncontrolled or hydration
  warnings and no unexpected failed API calls.

Never collect passwords, cookies, JWTs, authorization headers, service keys,
connection strings, signed URLs, storage paths, raw SQL output, raw provider
responses, or document contents.

## Stop conditions

Stop immediately and do not retry an action if any of the following occurs:

- target/build/fixture proof is ambiguous or production is implicated;
- metadata alone grants super-admin authority;
- review service reports or constructs `internal_test` access;
- a route returns data to unauthenticated or ordinary users;
- a browser API response is cacheable/shared, a console warning appears, or an
  unexpected API request fails;
- a document is public, storage path is exposed, a public URL is used, or a
  browser storage policy is detected;
- an excluded legacy admin API does not return `404` while the release flag is
  unset/disabled, or any Phase 2B admin DTO renders an internal/provider
  reference;
- an action activates a merchant, unlocks collection, initiates a payment or
  refund, issues M030 readiness, or changes commercial state;
- row-version, idempotency, audit-event, or expected state evidence is missing
  or inconsistent; or
- any evidence cannot be kept compact and redacted.

## Required gate sequence

1. Independently review the DB-backed authority and `admin_review` source
   package.
2. Deploy the approved source to staging; document viewing remains deferred.
3. Separately approve and execute the isolated staging queue/detail fixture
   plan; it does not authorize a review action.
4. Run staging read-only admin route/RBAC/queue/detail acceptance.
5. Keep the review-action flag disabled. Any later flag change and staged
   action test requires a new source/security review and explicit approval.
6. Separate release decision for any runtime adoption, M030/live readiness,
   activation, collection unlock, payment/refund operation, or production.

Production remains blocked throughout this sequence.
