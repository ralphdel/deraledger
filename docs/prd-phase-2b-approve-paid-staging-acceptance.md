# Phase 2B paid Solo Plus Approve: staging acceptance package

**Status: source-only operator package.** Preparing these files authorizes only a later, separately approved, read-only staging preflight. Migration apply, synthetic fixture creation, temporary environment changes, deployment, the single Approve action, and emergency cleanup each require their own explicit approval. No staging connection or action occurred while preparing this package. The prior local first-apply, rerun, hostile-drift, writer, replay, and race gates are complete; do not repeat them in staging.

## Boundary and target

Use only `scripts/phase2b-approve-paid-staging.ps1` for database operations. It pins the existing staging pooler host `aws-1-eu-central-2.pooler.supabase.com`, port `5432`, database `postgres`, and pooler user `postgres.fsjljliiyfchkwbjifzw`. That username routes to the reviewed staging project. There is no target override, connection URL with a password, environment password, `.pgpass`, or fallback. Inherited libpq target/password settings block before any connection. `psql -W` prompts interactively once per operation; the wrapper never receives the password. The SQL also checks the pinned project marker, database, and backend role. **The SQL marker alone is not independent proof of project identity; the fixed pooler tuple in the wrapper is the target boundary.** Do not invoke the SQL files through an alternate connection command.

All commands below are for the operator in Windows PowerShell from the repository root, after the separate approval named for that step. Do not paste raw database errors, credentials, cookies, request bodies, or idempotency keys into review evidence. Share only compact markers. Run `-Operation SourceCheck` before requesting preflight approval; it has no database connection or password prompt.

```powershell
& .\scripts\phase2b-approve-paid-staging.ps1 -Operation SourceCheck
```

Expected: `PASS|APPROVE_STAGING|source_checked|password_prompts=0`. A source hash mismatch blocks the package. This does not establish staging migration state.

## Gate 1: separately approved read-only staging preflight

```powershell
& .\scripts\phase2b-approve-paid-staging.ps1 -Operation Preflight
```

One interactive password prompt. The catalog-based preflight checks the exact seven- and eight-argument RPC bodies/signatures, reviewed grants and security posture, required tables/RLS, and the presence or absence of the seven success triggers. It returns exactly one of:

- `PASS|APPROVE_STAGING|migration_success_installed` — the new success body is present with reviewed trigger bodies; proceed only to separately approved fixture planning after app-build and detailed source/security evidence are reviewed.
- `PASS|APPROVE_STAGING|migration_predecessor_only` — the fail-closed predecessor is installed and the success migration is absent. The success apply is a **separate decision**.
- `BLOCKED|APPROVE_STAGING|...` — missing predecessor, incompatible body/overload/security state, or unproven target. Stop.

This script reports database object state, not a migration-ledger repair. It never inserts into `supabase_migrations.schema_migrations`. The success migration contains its own exact pre-DDL schema, policy, grant, constraint, trigger, and RLS assertions; a separately approved apply must pass them before replacing the RPC. A missing predecessor is not silently applied. The actual current staging state is unknown until this preflight is run by the operator.

## Gate 2: conditional success migration apply

Only after a fresh `migration_predecessor_only` result and **separate migration-apply approval**:

```powershell
& .\scripts\phase2b-approve-paid-staging.ps1 -Operation ApplySuccess `
  -Confirmation 'APPLY APPROVE SUCCESS TO STAGING'
```

One password prompt, one `psql` process. The apply script rechecks the fail-closed predecessor immediately before including only `20261015000000_phase2b_approve_success_atomic.sql`. It does not include or rerun the predecessor migration or any completed hostile/race matrix. The migration is transactional and fail-closed. The script then checks the success body and trigger count. Expected: `PASS|APPROVE_STAGING|success_applied`. Any other result stops fixture planning. Run Gate 1 again after a successful apply, under the read-only preflight authorization, and require `migration_success_installed`. Do not repair or forge the migration ledger as part of this gate.

If the migration transaction commits but this script's later postflight fails, **do not assume rollback and do not rerun apply**. Stop and obtain a fresh read-only staging-state review; the failure is not fixture authorization.

## Gate 3: separately approved synthetic paid fixture

Before this gate, independently verify the deployed staging build includes the approved review service, repository routing, and success migration contract. The database script cannot prove what is deployed in Vercel. Confirm the staging admin origin and exact scoped release gate; no app deploy or environment change is authorized by this document.

Generate a new run ID locally. It is an identifier, not a credential:

```powershell
$RunId = 'phase2b-approve-{0}-{1}' -f (Get-Date -Format yyyyMMdd), ([guid]::NewGuid().ToString('N').Substring(0,8))
```

Only after separate fixture-creation approval:

```powershell
& .\scripts\phase2b-approve-paid-staging.ps1 -Operation CreateFixture `
  -RunId $RunId -Confirmation "CREATE SYNTHETIC APPROVE $RunId"
```

One password prompt. In one transaction the script creates one new synthetic merchant and workspace, an upgrade-origin Solo Plus case, one provider-free `successful` payment record, and six `passed` requirements carrying the same exact run marker. It neither charges a customer nor calls a payment provider. The script refuses an already-used run ID. After commit it runs the read-only fixture preflight **in the same `psql` process**. Require both:

```text
PASS|APPROVE_STAGING|fixture_created|case_id=<uuid>|row_version=<actual>
PASS|APPROVE_PREFLIGHT|ready|row_version=<actual>|boundary=<private-md5>
```

The case's `row_version` may advance during fixture setup. Record the exact observed positive value and the private boundary fingerprint; never assume version 1. The fingerprint includes the synthetic merchant, workspace, payment, six requirements, subscriptions, plan migrations, and settlement rows. If creation commits but the follow-up preflight blocks, treat the fixture as existing and stop. Never rerun creation with the same run ID or reuse a partial fixture.

The case idempotency key and synthetic payment reference contain the run ID. The browser generates its own fresh review idempotency key; the server resolves and checks the run ID separately and the approve RPC rechecks it inside its transaction. Do not copy the browser key into logs.

Before any action, refresh the read-only boundary with the exact case/run from the creation result:

```powershell
$CaseId = [guid]'REPLACE_WITH_EXACT_FIXTURE_CASE_UUID'
& .\scripts\phase2b-approve-paid-staging.ps1 -Operation FixturePreflight `
  -RunId $RunId -CaseId $CaseId
```

One prompt. Require `PASS|APPROVE_PREFLIGHT|ready|row_version=<actual>|boundary=<private-md5>`. If version or fingerprint changed, stop; do not use a stale tab or retry automatically. This read-only query verifies the exact marker, paid/manual-review state, single qualifying provider-free payment, six synthetic requirements, no previous review event, no activation key, and no subscription, plan, or settlement descendant.

## Gate 4: temporary app scope and one real Approve action

The action release is separately gated by the existing source in `src/lib/server/solo-plus-review-action-release.ts`. After exact fixture preflight, separate environment/deployment approval is required to set these temporary values on the **staging app only**:

```text
DERALEDGER_DEPLOYMENT_TARGET=staging
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED=true
DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED=true
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID=<exact CaseId>
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION=approve
DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID=<exact RunId>
```

The reject-specific flag must be absent. The app gate also requires the reviewed staging Supabase identity and staging app origin; a deployment-target string alone is insufficient. Verify the deployed build and scoped environment after deployment, and confirm the exact case displays only **Approve**. RMI, Reject, Reopen, and every other case remain blocked. Use one fresh browser tab at `https://deraledger-staging.vercel.app/admin`; sign in through the normal super-admin flow. The UI sends `POST /api/admin/solo-plus/review` with `caseId`, the displayed `expectedRowVersion`, a fresh browser-generated `requestIdempotencyKey`, `decision=approve`, and a nonblank `reason`. The route enforces same-origin browser mutation and the authenticated super-admin session. Do not hand-craft an HTTP request or expose session material.

The blank-reason and confirmation-cancel UI checks send no POST. After a fresh Gate 3 preflight and separate **Approve execution approval**, enter a short synthetic reason, review the confirmation, and click Approve **once**. Expect HTTP 200 `kind=updated`, `caseStatus=approved`, `paymentStatus=paid`, and `rowVersion=preflight+1`. On any error, stop; do not replay, retry, use a stale tab, or switch to direct RPC execution. The route's public error remains generic.

## Gate 5: separately approved read-only postflight and handoff

Use the exact pre-action version and boundary from the final preflight:

```powershell
$BeforeVersion = 0 # REPLACE with the exact positive pre-action row_version
$Boundary = 'REPLACE_WITH_EXACT_32_CHARACTER_PREFLIGHT_BOUNDARY'
& .\scripts\phase2b-approve-paid-staging.ps1 -Operation Postflight `
  -RunId $RunId -CaseId $CaseId -ExpectedRowVersion $BeforeVersion `
  -Boundary $Boundary
```

One prompt. Require `PASS|APPROVE_POSTFLIGHT|approved_without_activation|row_version=<before+1>|event_id=<uuid>`. The check requires one `case_approved` event with coherent previous/final state and actor, exactly the final version, unchanged synthetic payment/requirements/merchant/workspace and subscription/plan/settlement fingerprint, and no activation/refund key. No direct RPC call is part of staging acceptance.

After postflight, separately approve removing temporary action values and redeploy the staging app default-blocked. Confirm all four review controls are absent again. **Keep the approved synthetic fixture** for the next, separately reviewed Reopen gate. Handoff only the case UUID, run ID, final approved row version, approval event UUID, and `approved`/`paid` state. Never hand off a password, cookie, session token, payment reference, or request idempotency key.

## Emergency abandonment only

The successful fixture is not cleaned up during this gate. If the gate fails before Reopen or the operator explicitly abandons it, obtain separate cleanup approval and inspect the exact case/run state first. The cleanup script requires exact UUID/run markers, the synthetic merchant and payment, six marked requirements, no activation/refund/subscription/settlement descendants, and no unknown FK descendants. It deletes only the marked case, its exact descendants, and the isolated synthetic merchant/workspace in one transaction. An unexpected descendant or any Reopen event blocks. It never deletes normal staging data by broad predicate.

```powershell
& .\scripts\phase2b-approve-paid-staging.ps1 -Operation EmergencyCleanup `
  -RunId $RunId -CaseId $CaseId `
  -Confirmation "ABANDON SYNTHETIC APPROVE $RunId $CaseId"
```

Expected only after separate approval: `PASS|APPROVE_STAGING|emergency_cleanup_done`. Then, under separate read-only postcleanup approval, run:

```powershell
& .\scripts\phase2b-approve-paid-staging.ps1 -Operation PostCleanup `
  -RunId $RunId -CaseId $CaseId
```

Require `PASS|APPROVE_STAGING|postcleanup_absent`. A cleanup marker alone is insufficient. No cleanup command is part of normal successful acceptance.

Each database operation above uses one `psql` process and one interactive password prompt; SourceCheck uses none. The fixture creation plus immediate DB preflight share one prompt. The fresh pre-action preflight and post-action verification each need their own prompt because the real browser action occurs between them. The optional conditional apply and optional emergency cleanup each add one prompt. No old 16-scenario hostile matrix or seven-scenario fail-closed race matrix is invoked.
