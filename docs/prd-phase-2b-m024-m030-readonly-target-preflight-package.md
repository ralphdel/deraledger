# PRD Phase 2B M024-M030 Read-Only Target Preflight Package

**Date:** 2026-09-26  
**Status:** SOURCE/PLANNING ONLY - this package does not approve or run a database query  
**Scope:** Future user-run target reconciliation for M024 through M030

## 1. Purpose and approval boundary

This package defines the evidence and classifications for a future read-only target preflight. Its only purpose is to establish the actual M024-M030 migration, object, and security state of a specifically approved local disposable, staging, or production target before any rehearsal or apply decision.

It contains no executable database command or credentialed helper. The user must explicitly approve each future target-specific read-only preflight before any database connection is made. A clean preflight is review evidence only; a separately approved apply gate is still required.

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

- RLS enabled on the M024 base tables and later target tables where required;
- zero browser policies where the manifests require no browser policy;
- no `PUBLIC`, `anon`, or `authenticated` privilege on service-only tables/functions;
- only reviewed least-privilege `service_role` grants;
- no `DELETE` grant where the manifest prohibits it;
- no broad `authenticated` grant, permissive policy, unsafe default privilege, or browser/public function execution; and
- no object/security condition that lets merchant-controlled or browser-visible data unlock capability.

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
- This package creates no PowerShell helper because a future credentialed script must be separately designed under the migration-safety runbooks and approved before use.
- No migration is applied and no data/schema/security state is mutated by this package.
- No M030/live readiness, approval execution, merchant activation, collection unlock, payment/provider/checkout/subscription/invoice/storefront behavior, or other commercial behavior is authorized.

## 10. Source references

- `docs/prd-phase-2b-m024-m030-migration-history-reconciliation-plan.md`
- `docs/prd-phase-2b-2-migration-024-execution-approval-plan.md`
- `docs/prd-phase-2b-1-compliance-persistence-source-package-checkpoint.md`
- M024-M030 migration sources and their matching staging preflight/postflight manifests
