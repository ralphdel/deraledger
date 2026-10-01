# Phase 2B review-action hardening staging migration runbook

**Status:** source-only operator package. Nothing in this document has been
run. It does not authorize a database connection, migration apply, app
deployment, flag change, fixture, review action, or production activity.

## Purpose and locked boundary

This runbook prepares a user-controlled, staging-only preflight, manual apply,
and postflight for:

`supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql`

The tracked operator wrapper is:

`scripts/phase2b-review-action-hardening-staging-migration.ps1`

The only accepted external target tuple is:

- project ref `fsjljliiyfchkwbjifzw`;
- host `aws-1-eu-central-2.pooler.supabase.com`;
- port `5432`;
- database `postgres`;
- pooler user `postgres.fsjljliiyfchkwbjifzw`.

Production ref `gznwibespgkwknnvbrlv` is an unconditional hard stop. The
wrapper also rejects any production, `prod`, or live indicator. It revalidates
the complete tuple and production block before every preflight, apply, or
postflight password prompt and again immediately before every native process.
No production command or fallback exists.

The migration creates one unique partial index, replaces the exact seven-
argument review RPC, and canonicalizes its execute privileges. It does not
apply a review action. Its transaction does not invoke the replaced RPC and
does not write business rows or migration-history rows.

The manual psql path deliberately does **not** insert or repair
`supabase_migrations.schema_migrations`. Preflight requires version
`20260930000000` to be absent, and postflight proves the ledger remained
unchanged. `supabase migration repair`, direct ledger inserts, and ad hoc
history reconciliation remain separate, unapproved gates.

## Tracked and locked artifacts

- Operator wrapper:
  `scripts/phase2b-review-action-hardening-staging-migration.ps1`
- Read-only preflight:
  `supabase/ops/phase2b_review_action_hardening_staging_preflight.sql`
- Reviewed migration:
  `supabase/migrations/20260930000000_phase2b_review_action_intent_hardening.sql`
- Read-only postflight:
  `supabase/ops/phase2b_review_action_hardening_staging_postflight.sql`
- Expected migration SHA-256:
  `bac24995ad801432c6ba53e06d820d7495b0d6bc0bd6e4d1be35e03908648ba9`
- Typed apply confirmation:
  `STAGING APPLY PHASE2B REVIEW HARDENING`

The preflight and postflight use `BEGIN TRANSACTION READ ONLY` and `ROLLBACK`.
They contain no DDL, DML, migration include, advisory lock,
migration-history write, or review-action call.

## Wrapper safety contract

The wrapper:

- uses discrete psql arguments and never constructs a connection string;
- requires `PGSSLMODE=require` and `PGCONNECT_TIMEOUT=15`;
- clears and restores inherited libpq variables in `finally`;
- securely prompts for the password only after all pre-credential guards;
- uses concurrent stdout/stderr draining with `UseShellExecute=false`;
- enforces phase-specific lock, statement, and native-process timeouts;
- terminates the psql process tree on timeout, makes one bounded last-chance
  tree-termination attempt when the primary attempt is not confirmed, and
  fails closed if the process still survives;
- gives redirected stdout/stderr a final combined two-second drain window and
  never waits indefinitely for streams left open by a surviving process;
- preserves a still-open Windows Job Object handle for the `finally` cleanup
  retry instead of clearing it after a failed close;
- suppresses all raw psql output;
- emits at most one normalized diagnostic category after a fixed failure
  line; and
- recomputes the migration hash before any apply credential prompt and again
  immediately before the native apply boundary.

Timeouts are finite:

| Phase | Connect | Lock | Statement / idle transaction | Native process |
| --- | ---: | ---: | ---: | ---: |
| Preflight | 15 s | 10 s | 90 s | 120 s |
| Apply | 15 s | 30 s | 840 s | 900 s |
| Postflight | 15 s | 10 s | 90 s | 120 s |

Safe diagnostic categories are limited to `authentication_failed`,
`network_or_tls_failure`, `syntax_error`, `lock_timeout`,
`statement_timeout`, `permission_denied`, `catalog_mismatch`, or
`psql_error`. No raw line, hostname, username, URL, password, token, SQL text,
or object value is emitted.

## Phase 0: local offline validation only

Run from the repository root. This does not resolve psql, prompt for a
password, create SQL, or start a process:

```powershell
$Target = @{
  ProjectRef = 'fsjljliiyfchkwbjifzw'
  DbHost = 'aws-1-eu-central-2.pooler.supabase.com'
  DbPort = 5432
  DbName = 'postgres'
  DbUser = 'postgres.fsjljliiyfchkwbjifzw'
}

& .\scripts\phase2b-review-action-hardening-staging-migration.ps1 `
  @Target `
  -Operation Preflight `
  -OfflineValidationOnly `
  -OfflineFlagConfirmation 'STAGING REVIEW ACTION FLAGS DISABLED'
if ($LASTEXITCODE -ne 0) { throw 'offline_validation_blocked' }
```

Required result:

```text
PASS|TARGET|staging_guarded
PASS|PRODUCTION_REF|blocked
PASS|FLAGS|operator_confirmed_disabled
PASS|SOURCE_HASH|20260930000000|matched
PASS|OFFLINE_BOUNDARIES|password=0|psql_resolve=0|process=0
```

Any wrong tuple, production ref/indicator, present review-action flag, or hash
mismatch blocks with all three offline boundary counts remaining zero.

## Phase 1: separately authorized read-only preflight

Create an untracked local evidence directory, then run the preflight. This
step is user-controlled and is not authorized merely because this runbook
exists.

```powershell
$EvidenceDirectory = '.\.local-evidence\phase2b-review-hardening'
New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$PreflightEvidence = Join-Path $EvidenceDirectory 'staging-preflight.txt'

& .\scripts\phase2b-review-action-hardening-staging-migration.ps1 `
  @Target `
  -Operation Preflight 2>&1 |
  Tee-Object -FilePath $PreflightEvidence
if ($LASTEXITCODE -ne 0) { throw 'staging_preflight_blocked' }
```

The wrapper requires the typed confirmation:

```text
STAGING REVIEW ACTION FLAGS DISABLED
```

It then securely prompts for the staging database password. Expected compact
evidence includes:

```text
PASS|TARGET|staging_guarded
PASS|PRODUCTION_REF|blocked
PASS|FLAGS|operator_confirmed_disabled
PASS|SOURCE_HASH|20260930000000|matched
PASS|SESSION|database|postgres
PASS|SESSION|role|postgres
PASS|PREREQUISITES|required_tables_present
PASS|ROLES|required_present
PASS|MIGRATION_HISTORY|20260930000000|not_applied
PASS|INDEX|absent_ready_for_create
PASS|IDEMPOTENCY_KEYS|no_duplicates
PASS|RPC_SIGNATURE|exact
PASS|RPC_PERMISSIONS|observed|public=<true|false>|anon=<true|false>|authenticated=<true|false>|service_role=<true|false>
PASS|BUSINESS_ROW_COUNTS|cases=<count>|requirements=<count>|events=<count>|payments=<count>
PASS|DECISION|READY_FOR_STAGING_REVIEW_HARDENING_APPLY
```

Current RPC permissions are reported rather than required to be canonical in
preflight because this migration owns the reviewed revoke/grant repair.
Missing roles, a missing or wrong RPC signature, duplicate keys, an unexpected
overload, an existing migration-history row, or any same-named index blocks.
A compatible but unrecorded index is partial state and does not authorize a
rerun.

Paste back the fixed target/hash/flag lines, every `BLOCKED` or `FAIL` line,
the RPC-permissions line, and the final decision. Keep count values local for
the wrapper's postflight comparison.

## Phase 2: separately approved manual apply

Do not run this because preflight passed. First obtain explicit approval for
the exact preflight evidence, migration hash, and staging tuple. Keep every
review-action flag disabled.

```powershell
$ApplyEvidence = Join-Path $EvidenceDirectory 'staging-apply.txt'

& .\scripts\phase2b-review-action-hardening-staging-migration.ps1 `
  @Target `
  -Operation Apply `
  -ApprovedPreflightEvidencePath $PreflightEvidence 2>&1 |
  Tee-Object -FilePath $ApplyEvidence
if ($LASTEXITCODE -ne 0) { throw 'staging_apply_blocked' }
```

The wrapper validates the retained preflight evidence and requires both typed
confirmations, including:

```text
STAGING APPLY PHASE2B REVIEW HARDENING
```

It computes a fresh SHA-256 before password handling and computes it again
immediately before psql. It runs only the locked migration file. Do not add
`--single-transaction`: the reviewed migration owns its explicit
`BEGIN`/`COMMIT`.

Success emits:

```text
PASS|APPLY|20260930000000|committed
```

Failure emits only bounded evidence, for example:

```text
BLOCKED|APPLY|psql_exit_nonzero
BLOCKED|APPLY_DIAGNOSTIC|permission_denied
```

or:

```text
BLOCKED|APPLY|native_process_timeout
BLOCKED|APPLY_DIAGNOSTIC|timeout_process_tree_terminated
```

If both bounded termination attempts cannot confirm process-tree exit, the
wrapper returns promptly after the bounded stream drain with:

```text
BLOCKED|APPLY|native_process_timeout
BLOCKED|APPLY_DIAGNOSTIC|timeout_process_tree_termination_unconfirmed
```

Stop on any failure form. Do not retry, repair history, or attempt an ad hoc
rollback.

## Phase 3: immediate read-only postflight

Run only after apply emitted its fixed success line:

```powershell
$PostflightEvidence = Join-Path $EvidenceDirectory 'staging-postflight.txt'

& .\scripts\phase2b-review-action-hardening-staging-migration.ps1 `
  @Target `
  -Operation Postflight `
  -ApprovedPreflightEvidencePath $PreflightEvidence 2>&1 |
  Tee-Object -FilePath $PostflightEvidence
if ($LASTEXITCODE -ne 0) { throw 'staging_postflight_blocked' }
```

Expected fixed evidence is:

```text
PASS|SESSION|database|postgres
PASS|SESSION|role|postgres
PASS|INDEX|review_request_intent|exact
PASS|MIGRATION_HISTORY|20260930000000|unchanged_by_manual_psql
PASS|RPC_SIGNATURE|review_solo_plus_case_v1|exact
PASS|RPC_PERMISSIONS|public_anon_authenticated_revoked_service_role_granted
PASS|BUSINESS_ROW_COUNTS|cases=<same>|requirements=<same>|events=<same>|payments=<same>
PASS|POSTFLIGHT|OBJECTS_AND_SECURITY_EXACT
PASS|BUSINESS_DATA|row_counts_unchanged
PASS|DECISION|STAGING_REVIEW_HARDENING_MIGRATION_VERIFIED
```

The index assertion requires the public target table, valid/ready/live unique
B-tree state, one key and one total attribute, no included columns, no
expression keys, exact `request_idempotency_key`, a non-null key predicate,
and exactly these events:

- `case_review_requested_more_information`;
- `case_approved`;
- `case_rejected`;
- `case_reopened`.

The RPC assertion requires the exact signature, JSONB result, invoker posture,
hardened search path, no overload, no PUBLIC/anon/authenticated execute, and
service-role execute. Pre/post business counts must match exactly.

## Rollback posture

There is no casual rollback command in this package.

- Before the migration reaches its internal `COMMIT`, any SQL error under
  `ON_ERROR_STOP=1` aborts the transaction. Do not assume rollback solely from
  the error category; request a separate read-only state inspection.
- If apply reports success but postflight fails, preserve compact evidence and
  stop. Do not drop the index, restore an older RPC, change grants, edit the
  ledger, or rerun the migration.
- Any compensating migration or rollback must be source-backed, independently
  reviewed, staging-targeted, and separately approved.
- `supabase migration repair` and direct writes to
  `supabase_migrations.schema_migrations` are prohibited.

## Stop conditions

Stop immediately when:

- the tuple differs from the locked staging target;
- the production ref or any production/live indicator appears;
- any review-action flag is present or disabled staging flags cannot be
  independently confirmed;
- offline validation does not report zero password, psql-resolution, and
  process boundaries;
- TLS, secure prompting, psql resolution, or environment restoration fails;
- either fresh apply hash differs from the locked SHA-256;
- migration history, prerequisite, index, duplicate-key, signature, overload,
  or permission checks block;
- preflight lacks the exact ready decision;
- retained preflight evidence is missing, duplicated, changed, or contains a
  blocker;
- psql exits nonzero, reaches a timeout, or process-tree termination is not
  confirmed;
- postflight reports an object/security mismatch or row counts change;
- a non-redactable diagnostic is required; or
- any request arises to repair history, enable flags, create a fixture,
  execute a review action, deploy, or touch production.

## Evidence to paste back

Paste only:

```text
TARGET_GUARD=PASS
SOURCE_HASH=PASS|20260930000000
FLAGS_DISABLED=PASS
PREFLIGHT_FINAL=PASS|DECISION|READY_FOR_STAGING_REVIEW_HARDENING_APPLY
PREFLIGHT_INDEX=PASS|INDEX|absent_ready_for_create
PREFLIGHT_IDEMPOTENCY=PASS|IDEMPOTENCY_KEYS|no_duplicates
PREFLIGHT_RPC_SIGNATURE=PASS|RPC_SIGNATURE|exact
PREFLIGHT_RPC_PERMISSIONS=<the compact observed line>
APPLY=PASS|APPLY|20260930000000|committed
POSTFLIGHT_INDEX=PASS|INDEX|review_request_intent|exact
POSTFLIGHT_HISTORY=PASS|MIGRATION_HISTORY|20260930000000|unchanged_by_manual_psql
POSTFLIGHT_RPC_SIGNATURE=PASS|RPC_SIGNATURE|review_solo_plus_case_v1|exact
POSTFLIGHT_RPC_PERMISSIONS=PASS|RPC_PERMISSIONS|public_anon_authenticated_revoked_service_role_granted
BUSINESS_DATA=PASS|BUSINESS_DATA|row_counts_unchanged
POSTFLIGHT_FINAL=PASS|DECISION|STAGING_REVIEW_HARDENING_MIGRATION_VERIFIED
```

For failure, paste only the compact `BLOCKED|...` or `FAIL|...` lines and
stop. Never paste a password, connection string, raw psql output, URL, token,
environment value, service key, local path, or database row.

## Gates that remain closed

Even after complete postflight success:

- app deployment requires separate staging approval;
- all review-action flags remain absent/disabled;
- fixture creation remains separately reviewed and approved;
- request-more-information, reject, approve, and reopen remain blocked;
- activation, collection unlock, document access, payment/refund execution,
  M030/live readiness, runtime adoption, and production remain blocked.
