# PRD Phase 2B M024-M030 Read-Only Target Preflight Package

**Date:** 2026-09-26  
**Status:** SOURCE/PLANNING ONLY - this package does not approve or run a database query  
**Scope:** Future user-run target reconciliation for M024 through M030

## 1. Purpose and approval boundary

This package defines the evidence and classifications for a future read-only target preflight. Its only purpose is to establish the actual M024-M030 migration, object, and security state of a specifically approved local disposable, staging, or production target before any rehearsal or apply decision.

It includes `scripts/preflight-m024-m030-target-readonly.ps1`, an opt-in user-run read-only helper. This task did not execute it. The user must explicitly approve each future target-specific use before any database connection is made. A clean preflight is review evidence only; a separately approved apply gate is still required.

The helper now classifies `CHAIN_ABSENT`, `CHAIN_PARTIAL`, and `CHAIN_FULL_RECORDED` separately. A disposable local target whose whole chain and related objects are absent may produce `READY_FOR_LOCAL_REHEARSAL`; absent objects are not mislabeled as drift in that narrow case. A fully recorded, matching target produces `NO_APPLY_NEEDED_TARGET_ALREADY_MATCHES`, rather than an apply-review result. Partial, history/object-conflicting, drifted, or security-mismatched chains remain blocked.

The source dependency chain is strict:

```text
M024 -> M025 -> M026 -> M027 -> M028 -> M029 -> M030
```

M024 remains the PRD Phase 2B compliance-persistence substrate. M028 requires the hardened M026/M027 approval-RPC state, and M030 requires the complete verified M024-M029 chain. Repository files and historical checkpoints are not proof of a current target state.

## 2. Future target identity checks

For each separately approved target, future read-only evidence must establish:

| Check | Required redacted evidence | Stop condition |
| --- | --- | --- |
| Target label | `local`, `staging`, or `production` only | Unknown or inconsistent label. |
| Supabase project identity | Expected and observed project refs, compared to the approved environment | Missing, ambiguous, unexpected, or mismatched ref. |
| Database identity | Expected and observed database name | Mismatch or inability to establish identity. |
| Connected role | Observed role classification/name only | Wrong or ambiguous role. |
| Server/session state | Server-version classification and current schema/search-path classification where relevant | Unsafe/unexpected schema/search-path state. |
| Local constraint | Local host must be `127.0.0.1` and target must be disposable/production-baseline-compatible | Any other local host or a shared developer database. |
| Readiness safety | Redacted independent evidence that the route flag remains `false`, if available without exposing values | Route flag cannot be confirmed false or runtime adoption is detected. |

Database name and connected role are insufficient by themselves to prove a target. Project-ref proof is mandatory for staging and production; local target identity must meet the explicit loopback/disposable constraint.

The helper compares observed `current_database()`, `current_user`, `session_user`, and server/session metadata against expected values. The repository does not currently define an approved, source-backed, target-bound Supabase project-ref metadata contract. Therefore staging and production always return `BLOCKED_PROJECT_REF_UNPROVEN`; typed values and custom database/session settings are not accepted as project proof. Local rehearsal preflight remains available under its loopback/disposable safeguards.

No evidence may include a password, connection string, full URL, service-role key, token, JWT, cookie, header, or raw environment value.

## 3. Future migration-history checks

The future read-only preflight must compare the target migration history to the exact ordered source package names:

1. `20260820_00_prd_phase_2_compliance_schema_substrate.sql` (M024)
2. `20260824_00_reviewed_profile_bootstrap_rpc.sql` (M025)
3. `20260825_00_reviewed_profile_approval_rpc.sql` (M026)
4. `20260825_01_cleanup_approval_rpc_diagnostics.sql` (M027)
5. `20260825_02_canonical_approval_snapshot_idempotency.sql` (M028)
6. `20260826_00_canonical_workspace_linkage.sql` (M029)
7. `20260827_00_m028_m029_readiness_integration.sql` (M030)

For every entry, evidence must classify it as `recorded_and_ordered`, `absent`, `unexpected`, `out_of_order`, or `history_object_conflict`. It must also record the reviewed SHA-256 of every migration that a later decision proposes to rehearse or apply. A history entry alone is insufficient: it must be reconciled with object, signature, and security checks below.

## 4. Future object and signature checks

Use the matching M024-M030 preflight/postflight manifests as the source of exact catalog expectations. The future read-only checks must establish at least the following:

| Package | Required target objects |
| --- | --- |
| M024 | Seven compliance/limit base tables, including `merchant_compliance_profiles`, `merchant_compliance_reviews`, events, windows, reservations, and usage tables. |
| M025 | `bootstrap_reviewed_profile_v1` with the reviewed signature and service-only posture. |
| M026 | `review_compliance_profile_decision_v1` with the reviewed signature and service-only posture. |
| M027 | The M026 function body/security state is the reviewed cleanup state; no prior diagnostic implementation remains. |
| M028 | Canonical approval policy/request objects plus `issue_canonical_approval_decision_request_v1` and `read_canonical_approval_snapshot_v1`. |
| M029 | `merchant_canonical_workspaces` and `reconcile_canonical_merchant_workspace_link_v1`. |
| M030 | `issue_canonical_approval_decision_request_v2` and `read_canonical_approval_snapshot_v2`. |

For each expected RPC/function, the future preflight must compare function name, argument signature, expected `SECURITY DEFINER`/`SECURITY INVOKER` posture, and required hardened search-path posture. Missing, overloaded, mismatched, or unexpectedly owned definitions are `BLOCKED`.

## 5. Future security checks

The future read-only preflight must verify the exact manifest expectations, including:

- RLS enabled and `NO FORCE ROW LEVEL SECURITY` retained on the M024/M028/M029 protected tables covered by the manifests;
- zero browser policies and browser/public grants across M024 base tables plus M028 request/policy and M029 linkage tables where the manifests require no browser access;
- no `PUBLIC`, `anon`, or `authenticated` privilege on service-only tables/functions;
- exact reviewed least-privilege `service_role` grant arrays: M024 profile/review/window/reservation write shapes, append-only event/usage/junction shapes, M028 policy/request (`approval_decision_requests` includes `INSERT`), and M029 linkage (`INSERT`, `SELECT`);
- no `DELETE` grant where the manifest prohibits it;
- no broad `authenticated` grant, permissive policy, unsafe default privilege, or browser/public function execution;
- M027 cleanup evidence: the legacy local approval-diagnostic implementation must be absent from the M026 approval RPC; and
- no object/security condition that lets merchant-controlled or browser-visible data unlock capability.

Function PUBLIC execute checks use the same ACL-backed posture as the reviewed migrations: `pg_proc.proacl` is expanded with `aclexplode(...)`, and `grantee = 0` with `EXECUTE` is rejected. The helper never treats `PUBLIC` as a normal role for `has_function_privilege`.

Any policy, grant, default-privilege, function-security, RLS, or browser-access mismatch is `BLOCKED_SECURITY_MISMATCH`; it must not be repaired during preflight.

## 6. Drift and conflict classification

The future preflight must explicitly classify, rather than repair, these cases:

| Condition | Required outcome |
| --- | --- |
| Object exists but migration history is absent | `BLOCKED_DRIFT` |
| Migration history exists but required object is missing | `BLOCKED_DRIFT` |
| Function/RPC signature or security posture differs | `BLOCKED_DRIFT` or `BLOCKED_SECURITY_MISMATCH` |
| Policy, grant, revoke, or RLS mismatch | `BLOCKED_SECURITY_MISMATCH` |
| Partial, out-of-order, or missing-prerequisite M024-M030 chain | `BLOCKED_PARTIAL_CHAIN` |
| Target project ref/database/role mismatch | `BLOCKED_TARGET_MISMATCH` |
| Route flag not false or runtime adoption evidence is present | `BLOCKED_RUNTIME_ADOPTION_DETECTED` |

Do not patch SQL, broaden privileges, alter policy, retry into a partial target, or infer a safe continuation from any blocked outcome.

## 7. Allowed decision outputs

Only these final classifications may be produced after a future approved read-only preflight:

- `READY_FOR_LOCAL_REHEARSAL` - only for a disposable compatible local target with an absent chain and no conflicts; this does not authorize rehearsal or apply.
- `READY_FOR_STAGING_APPLY_REVIEW` - only after separately approved staging preflight evidence establishes the reviewed target state required for the next decision; this does not authorize apply.
- `READY_FOR_PRODUCTION_APPLY_REVIEW` - only after separately approved production preflight evidence establishes the reviewed target state required for the next decision; this does not authorize apply.
- `NO_APPLY_NEEDED_TARGET_ALREADY_MATCHES` - only where the entire applicable M024-M030 history, objects, signatures, and security state match in order.
- `BLOCKED_PARTIAL_CHAIN`
- `BLOCKED_DRIFT`
- `BLOCKED_TARGET_MISMATCH`
- `BLOCKED_SECURITY_MISMATCH`
- `BLOCKED_RUNTIME_ADOPTION_DETECTED`

An omitted, ambiguous, or mixed result is `BLOCKED` until a new reviewed reconciliation plan classifies it.

## 8. Evidence format and hard stops

Future output must contain compact redacted lines only:

```text
PASS|TARGET_IDENTITY|project_ref_match
PASS|MIGRATION_CHAIN|recorded_and_ordered
FAIL|M028_SIGNATURE|mismatch
BLOCKED|DECISION|BLOCKED_DRIFT
```

It may record non-secret target labels, project refs, database names, role classifications, migration names, hash digests, and fixed category labels. It must never emit raw SQL output, catalog dumps, full URLs, connection strings, credentials, service-role keys, passwords, tokens, cookies, JWTs, headers, or environment values.

Hard-stop conditions are: unknown target label; invalid local host; project-ref mismatch; database/role uncertainty; source-hash mismatch; missing/out-of-order chain; migration-history/object conflict; function/signature/security mismatch; browser/public access; route-flag uncertainty; runtime-adoption evidence; or non-redactable output.

## 9. Approval posture and non-goals

- This package does **not** approve running a preflight. Explicit user approval is required before each local, staging, or production read-only database command.
- A future apply, rehearsal, postflight, rollback, runtime adoption, or route/UI change always requires a separate approval after evidence review.
- The helper accepts only `local`, `staging`, or `production`; it rejects unknown labels. Its database work is disabled unless the user explicitly supplies `-RunReadOnlyChecks` after the target-specific approval.
- The helper is compatible with Windows PowerShell: it uses `ProcessStartInfo.Arguments` with Windows-safe argument quoting, not the PowerShell 7-only `ArgumentList` collection. It resolves `psql` in order from an explicit `-PsqlPath`, the current command path, then `C:\Program Files\PostgreSQL\15\bin\psql.exe` and `C:\Program Files\PostgreSQL\17\bin\psql.exe`. It emits only `PASS|PSQL|resolved` or `BLOCKED|PSQL|not_found`; it never emits the executable path.
- A clean disposable database can lack `supabase_migrations.schema_migrations`. The helper now uses psql conditional control flow so it classifies that state without later querying the absent relation; this preserves `CHAIN_ABSENT` evaluation rather than causing an opaque native-process failure. Nonzero native outcomes are reported only as `psql_exit_nonzero`, `psql_timeout`, `psql_invocation_failed`, or `readonly_sql_failed`; raw stderr is never emitted.
- The helper emits compact evidence before its one final decision. A clean local disposable target emits local identity, `psql`, migration-history, object-state, and security-baseline evidence, then `PASS|DECISION|READY_FOR_LOCAL_REHEARSAL`. Missing, duplicate, or malformed labelled control records emit `BLOCKED|PREFLIGHT|control_row_missing`, `control_row_duplicate`, or `control_row_malformed`, followed by exactly one `BLOCKED|DECISION|BLOCKED_CONTROL_ROWS`. It does not depend on a fragile fixed control-row count, and includes an opt-in no-database `-RunOfflineParserSelfTests` validation mode.
- A plain local disposable PostgreSQL target can also lack the Supabase `service_role`, `anon`, and `authenticated` roles. The helper checks those role OIDs through `pg_roles` before evaluating function ACLs; it never passes an absent role name to `has_function_privilege`. Complete absence is accepted only with a clean local `CHAIN_ABSENT` target and produces `PASS|ROLE_BASELINE|supabase_roles_absent_clean_local`. If migration history or protected objects exist, any required-role absence remains `BLOCKED_SECURITY_MISMATCH` through the `required_role_missing` control category. The helper remains unexecuted by this source task.
- The helper uses a local secure password prompt only at the opt-in execution boundary, after local target safety checks and `psql` resolution. It invokes `psql` with `BEGIN READ ONLY` and `ROLLBACK`, explicitly disposes its native process, removes its temporary SQL file, restores its process-level PostgreSQL environment, and emits only compact categorized evidence. It never prints its prompts, target fields, password, connection string, full URL, or raw catalog output.
- For local use it requires `127.0.0.1`, port `55432`, user `postgres`, an explicit typed confirmation, and a disposable DeraLedger database name such as `deraledger_m024_m030_rehearsal`. Reserved environment tokens are blocked anywhere in the name before executable resolution or a password prompt: `production`, `prod`, `staging`, `stage`, `preview`, `live`, `main`, `primary`, `shared`, `default`, `template`, `postgres`, and `supabase`. Examples allowed: `deraledger_m024_m030_rehearsal`, `deraledger_compliance_rehearsal`, and `deraledger_phase2b_rehearsal`. Examples blocked: `deraledger_production_rehearsal`, `deraledger_staging_rehearsal`, `deraledger_prod_rehearsal`, `deraledger_live_rehearsal`, `deraledger_supabase_rehearsal`, `postgres`, and `template1`. Reserved-name rejection emits only `BLOCKED|LOCAL_DATABASE|reserved_environment_token`. For staging/production it requires matching expected/observed project refs and an environment-specific typed confirmation before it can prompt for a password.
- No migration is applied and no data/schema/security state is mutated by this package.
- No M030/live readiness, approval execution, merchant activation, collection unlock, payment/provider/checkout/subscription/invoice/storefront behavior, or other commercial behavior is authorized.

The helper remains unexecuted by this source task. Any future local execution requires separate explicit approval; staging and production remain separate approval gates and are blocked by the project-ref-proof limitation.

## 10. Source references

- `docs/prd-phase-2b-m024-m030-migration-history-reconciliation-plan.md`
- `docs/prd-phase-2b-2-migration-024-execution-approval-plan.md`
- `docs/prd-phase-2b-1-compliance-persistence-source-package-checkpoint.md`
- M024-M030 migration sources and their matching staging preflight/postflight manifests
