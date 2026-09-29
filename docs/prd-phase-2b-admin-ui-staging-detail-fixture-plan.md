# Phase 2B Solo Plus admin detail staging fixture plan

**Status:** source-only, pending independent review and a separate staging
fixture-execution approval. This document authorizes no connection, SQL
execution, deployment, review decision, activation, collection unlock,
payment/refund operation, M030 readiness, or production activity.

## Purpose and release boundary

This package prepares exactly one synthetic, metadata-only case for the
Phase 2B admin queue/detail read smoke. It does not test documents, evidence
bytes, provider integrations, payment, decisions, activation, or lifecycle
completion.

The fixture must use all of these markers:

- an email containing `phase2b` or `fixture`;
- a business name containing `Phase 2B Fixture`;
- a run ID matching `[a-z0-9][a-z0-9-]{0,79}`; and
- the UUID of the draft case created by the normal application flow.

Never use a real customer, the support super-admin, or production data.
Production project ref `gznwibespgkwknnvbrlv` remains hard-blocked.

## Source-backed creation method

Create the synthetic identity and its draft through normal staging signup,
workspace provisioning, and **Start or resume Solo Plus review**. Stop before
payment. The normal case-creation RPC atomically creates the draft, the
`case_created` event, and exactly these six requirement rows:

- `bvn`
- `selfie_liveness`
- `id_document`
- `proof_of_address`
- `settlement_account`
- `activity_profile`

The fixture adds no document or evidence record. Requirement rows may be shown
in the admin UI only as non-sensitive code/state metadata. Document/evidence
viewing remains deferred.

## Mechanical old-staging gate

All fixture SQL is owned by
`scripts/phase2b-admin-detail-fixture-staging.ps1`. Do not extract and run its
embedded SQL directly.

There is no approved immutable database-side Supabase project-ref value on
which this fixture can rely. The executor therefore fails closed before psql
resolution or password prompting unless the user supplies the exact approved
external target tuple:

- project ref: `fsjljliiyfchkwbjifzw`;
- host: `aws-1-eu-central-2.pooler.supabase.com`;
- port: `5432`;
- database: `postgres`; and
- pooler user: `postgres.fsjljliiyfchkwbjifzw`.

The same expected staging ref is passed into every SQL transaction and checked
again before catalog reads or mutation. Database name alone is never accepted
as project identity. Any target field containing the production ref or a
production/live marker blocks. The executor uses discrete psql arguments,
requires SSL, prompts securely, restores all PostgreSQL process environment
variables, deletes its temporary SQL file, suppresses raw psql output, and
emits only compact evidence.

All five target parameters are mandatory and have no default target values.
The operator must explicitly provide and verify them under a separate
approval.

## Fixture safety invariants

Before the `Create` operation can mutate anything, the guarded transaction
requires:

- exactly one merchant matching both fixture email and business name;
- the supplied case belongs to that merchant and is an unmarked
  `draft`/`pending`/`none` normal-flow case;
- case payment provider/reference/record fields are null;
- **all** active cases for the fixture merchant, independent of the supplied
  case UUID, total exactly one;
- the exact six canonical requirement codes are present;
- all six requirements remain `not_started` with no verification-log,
  evidence-source/reference, provider, completion, reuse, policy, review, or
  failure state, and with metadata exactly `{}`;
- no `payment_records` row has
  `solo_plus_case_id = <fixture_case_uuid>`; and
- the case has no existing fixture marker.

The payment-record check is independent of
`solo_plus_cases.payment_record_id`; either direction of linkage blocks the
fixture. The transition changes only the fixture case status/row version/audit
marker and adds one fixture-scoped event. It never writes payment/provider,
document/storage, approval, activation, collection, merchant-plan, workspace,
or migration-history data.

## Future user-run sequence

These command shapes are documentation only. This source task did not run
them. Do not include a password, connection string, URL, token, or service key
in a command.

1. Obtain independent package approval and a separate approval naming the
   fixture run ID.
2. Create the marked synthetic account and draft through the UI; stop before
   payment.
3. Run the executor with `-Operation Preflight` and the exact target/fixture
   parameters. Required result:

   `PASS|FIXTURE|draft_case_eligible`

4. Only after explicit mutation approval, run `-Operation Create
   -RunMutation`. The executor additionally requires the exact typed phrase:

   `STAGING CREATE PHASE2B ADMIN DETAIL FIXTURE`

   Required result:

   `PASS|FIXTURE|admin_read_case_prepared`

5. Run `-Operation Postflight`. Required result:

   `PASS|FIXTURE|admin_detail_ready`

6. As the DB-backed staging super-admin, observe `/admin/solo-plus/cases` and
   `/admin/solo-plus/cases/<fixture_case_uuid>`. Do not attempt a decision.
7. After separate cleanup approval, run `-Operation Cleanup -RunMutation`.
   The executor requires:

   `STAGING CLEANUP PHASE2B ADMIN DETAIL FIXTURE`

8. Run `-Operation PostCleanup`. Required result:

   `PASS|FIXTURE_CLEANUP|case_descendants_absent`

The executor also emits `PASS|TARGET|old_staging_guarded`, `PASS|SSL|required`,
and `PASS|PSQL|resolved` before a phase result. Any `BLOCKED|...` or
`FAIL|...` is a stop condition.

`-OfflineValidationOnly` is reserved for the repository's no-DB unit test. It
exercises the real target, `-RunMutation`, and typed-confirmation gates and
then exits before psql resolution, password prompting, temporary SQL creation,
or execution. It is not a substitute for the approved preflight/postflight
sequence and cannot create or clean up a fixture.

## Queue/detail expectations

- the queue uses `GET /api/admin/solo-plus/cases` and shows one
  `manual_review` fixture;
- its link is `/admin/solo-plus/cases/<fixture_case_uuid>`;
- detail uses `GET /api/admin/solo-plus/cases/<fixture_case_uuid>`;
- the detail shows pending payment, no refund, six requirement metadata rows,
  and one fixture event;
- it exposes no provider/payment reference, storage key, evidence path,
  bucket path, signed URL, document URL, or document bytes; and
- it displays that review actions are disabled, with no actionable review
  controls.

The server route `/api/admin/solo-plus/review` is separately default-blocked
by `DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED`; production remains
blocked even if that flag is set. This fixture plan does not authorize setting
the flag.

## Cleanup scope

Cleanup is permitted only when the case belongs to the exact fixture merchant
and carries both the expected fixture scope and run ID. Inside one transaction,
it locks that exact marked case `FOR UPDATE`, then rechecks reverse
`payment_records.solo_plus_case_id` linkage. This prevents a payment link from
racing the cleanup and being changed through `ON DELETE SET NULL`. It deletes,
in order, only:

1. `solo_plus_case_events` for the fixture case UUID;
2. `solo_plus_case_requirements` for the fixture case UUID; and
3. the fixture `solo_plus_cases` row for the exact case, merchant, fixture
   scope, and run ID.

The case delete uses `DELETE ... RETURNING` plus checked affected-row count.
Anything other than exactly one returned fixture-case ID raises and rolls the
whole transaction back, including child deletions; success evidence cannot be
emitted after a zero-row delete.

It does not delete the auth user, merchant, workspace, onboarding record,
payment record, or any unrelated staging row. Identity cleanup remains a
separate retention/lifecycle decision.

## Stop conditions

Stop without retrying or weakening a guard if:

- target proof is absent/mismatched or any production indicator appears;
- the explicit run/confirmation gate is absent;
- any identifier placeholder or fixture marker is invalid;
- merchant identity is not unique;
- any other active case exists for the fixture merchant;
- the draft state or exact requirement set differs;
- either case-side or payment-record-side payment linkage exists;
- any document/evidence, provider, non-empty metadata, completion, reuse,
  policy, review, failure, activation, or fixture marker already exists;
- cleanup cannot lock exactly the marked fixture case, a payment link exists
  after locking, or exactly one marked case is not deleted;
- psql cannot be resolved or SSL/secure prompting fails;
- output cannot remain compact/redacted; or
- any review-action control or mutation route is available in this release
  state.

## Evidence to paste back

Return only:

- compact executor evidence lines;
- the fixture case UUID;
- a redacted queue/detail screenshot or browser-network summary;
- the two GET API paths with status/cache classification;
- confirmation of no console warning/unexpected failed call; and
- confirmation that no review action control was available or submitted.

Never return cookies, tokens, authorization headers, credentials, connection
strings, raw rows, URLs, signed URLs, storage keys, provider/payment
references, or document content.

## Explicit exclusions

This plan does not authorize approve, reject, request-more-information,
reopen, provider/payment confirmation, document upload/viewing, refund
processing, merchant activation, collection unlock, M030 readiness, runtime
adoption, deployment, migration work, production, or deletion of the
synthetic identity.
