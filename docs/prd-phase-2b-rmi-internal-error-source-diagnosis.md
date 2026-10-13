# Phase 2B RMI INTERNAL_ERROR source diagnosis

Verdict: **ROOT_CAUSE_FOUND**. The current source deterministically reproduces
the reported failure before the mutation/RPC boundary. No sanitized Vercel log
for this attempt was available locally; this is source and in-memory test
evidence, not a claim to have inspected the deployed artifact or server logs.

## Incident evidence supplied by the user

- Case: `2c4dde2a-2c9b-47c4-927c-607a0bae951e`.
- Run: `phase2b-rmi-20261001-002`.
- Decision: `request_more_information`; expected row version: `1`.
- Blank reason was rejected in the browser without a POST.
- The valid attempt returned HTTP 500 / `INTERNAL_ERROR` with
  `Solo Plus review decision failed unexpectedly.`
- The supplied post-failure diagnostic found `manual_review`, row version `1`,
  no RMI event, two total events, six requirements, the matching fixture marker,
  no merchant-visible reason, no payment records, and no activation.
- The local preflight evidence records
  `PASS|RMI_PREFLIGHT|ready|row_version=1|boundary=d5c57a38f657fa0702e37a38dfbf8592`.

## Root cause and execution order

The POST handler constructs `createSoloPlusReviewerService()` without options.
That service passed `options.generateId` (undefined) into orchestration. The
orchestration default deliberately throws when an ID is requested without a
configured generator. Every existing successful reviewer-service test supplied
`generateId`, concealing the missing runtime default.

For RMI the execution order is:

1. Resolve the release scope, authenticate the admin, check browser origin,
   parse the five payload fields, and check case/decision scope.
2. Construct the service, validate server configuration, resolve DB-backed
   super-admin authority again, and create the repository/orchestration.
3. Read the case and check its fixture scope/run markers.
4. Validate the RMI input and read the case again in orchestration.
5. Build the review event. `id: params.generateId()` throws here.
6. `repository.transitionCaseStatus(...)` is never entered, so the review RPC
   is never called on this failure path.
7. The route has no domain-response mapping for the thrown error code and returns
   the observed generic HTTP 500 message.

The first safe error reproduced locally was:

```text
name=SoloPlusOrchestrationError
code=SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE
message=No ID generator configured for Solo Plus orchestration.
transition_calls=0
case_unchanged=true
events=0
```

The regression was first run against the original source and failed with
`500 !== 200`; its diagnostic assertions proved the unchanged in-memory case
and absent transition/events. After the minimal fix, the same default-generator
path returns 200, generates a UUID, creates one in-memory event, and advances
the synthetic row version from 1 to 2.

The reviewed RPC generates its persisted event ID itself, but orchestration
still constructs a complete event before handing control to the repository.
That construction needs the application ID generator even though the RPC does
not take an event ID parameter.

## Requested contract audit

| Check | Finding |
| --- | --- |
| UI/route payload shape | Both use `caseId`, `expectedRowVersion`, `requestIdempotencyKey`, `decision`, and `reason`. No missing UI field is required by the route. |
| Decision string | `request_more_information` agrees across the form contract, parser, service dispatch, repository decision mapping, release gate, and reviewed RPC. The distinct audit event type is `case_review_requested_more_information`. |
| Reason | The form sends trimmed `reason`; the parser normalizes it; orchestration requires it for RMI; the repository passes `event.reason` as `p_reason`. The 1,000-character limit agrees. |
| Version | The form maps its `rowVersion` prop to `expectedRowVersion`; service/orchestration preserve that name; the RPC receives `p_expected_row_version`. |
| Idempotency | `requestIdempotencyKey` agrees between form, route, service, and orchestration, then becomes `p_request_idempotency_key`. |
| Fixture run/scope | The route takes its scope from server environment. The service independently resolves the same server scope and checks `audit_metadata.fixture_scope` and `fixture_run_id`; client-supplied scope/run fields are unnecessary and rejected. |
| Release mismatch | Disabled/mismatched route scope returns 404; disabled/mismatched service scope or fixture markers produce `SOLO_PLUS_SERVER_FORBIDDEN`, mapped to 403. These do not explain this reproduced 500. |
| RPC signature | The named argument object matches `review_solo_plus_case_v1(uuid,bigint,text,text,uuid,text,text)`: case ID, expected version, request idempotency, decision, reviewer admin ID, reason, policy version. PostgREST uses argument names, not JavaScript object insertion order. |
| RPC return fields | The reviewed success envelope has `kind`, `case`, and `event`, as the repository expects. `reviewState` and `actionRequired` are derived presentation fields, not physical columns required by this mutation. No return-field mismatch was found for RMI. The reproduced error occurs before any RPC response. |
| Auth/admin context | Service authority construction can separately throw or produce a configuration error after the route guard. It is not needed to explain the reproduced failure: injected trusted authority reproduces the same 500. The service constructs `admin_review` context from the resolved user ID. |
| Error collapse | The public generic 500 avoids exposing internal failures, but does not distinguish configuration, repository, or orchestration failures. `onUnexpectedError` receives the original error. The current production logger prints the raw error; safe future logging should emit only an allowlisted category/name/fixed message and execution stage, excluding payloads, keys, headers, cookies, tokens, and stacks. No logging change is necessary for the minimal functional fix. |

## Minimal source-only patch and validation

In `src/lib/solo-plus/server/review-service.ts`, import `randomUUID` from
`node:crypto` and pass `generateId: options.generateId ?? randomUUID`. This
matches the established UUID default in `server/service-factory.ts` and keeps
injected deterministic generators available to tests. Leave the orchestration
fail-closed default intact for other callers.

Changed files:

- `src/lib/solo-plus/server/review-service.ts`: the runtime default.
- `tests/solo-plus-review-service.test.ts`: real route/service/orchestration
  coverage with omitted `generateId`, injected authority and an in-memory
  repository; assert HTTP success, one UUID event and the expected row version.
- `tests/solo-plus-supabase-repository.test.ts`: fake-client RMI coverage for all
  seven named arguments and mapping of the reviewed flat success envelope.
- This diagnosis document.

All five targeted suites passed: review route, review service, review release
gate, UI contract, and Supabase repository. These tests use local doubles/static
rendering; they do not connect to Supabase or submit a live review. No browser
interaction, hydration, or live-network acceptance result is claimed by them.

## Safety and fixture reuse

The patch supplies an event identifier before the existing mutation boundary.
It does not broaden the release gate or grant admin authority. Existing
case/run/decision checks, reason validation, version checks, idempotency rules,
and the seven-argument atomic RPC contract still apply. Release readiness still
requires a separately authorized deployed verification; local tests do not
authorize a deployment or acceptance attempt.

The fixture remains eligible for reuse based on the supplied post-failure
diagnostic: its case state/version/marker and event/payment/activation counts
are unchanged. No cleanup or replacement is indicated by this failure. That
diagnostic is a historical snapshot, not a live assertion: a future authorized
attempt must first re-establish the exact case/run boundary and current row
version, and use a refreshed single-tab context. Do not retry or replay now.

No DB connection, SQL execution, psql execution, deployment, environment-value
change, live review action/retry/replay, cleanup, fixture mutation, or production
action occurred during this source-only investigation.
