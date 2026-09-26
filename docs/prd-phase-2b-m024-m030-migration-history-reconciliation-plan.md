# PRD Phase 2B Migration 024-030 History Reconciliation and Target Preflight Plan

**Date:** 2026-09-26  
**Status:** PLANNING/RECONCILIATION ONLY - no database connection, query, rehearsal, or apply is approved  
**Scope:** Migration 024 through Migration 030

## 1. Purpose

Before any local, staging, or production rehearsal/apply decision, reconcile the target's migration history with its actual object and security state for Migration 024 through Migration 030. This prevents a duplicate apply, a wrong-target apply, or treating the presence of source files or historical checkpoints as proof of a target's current state.

This plan is not a database runbook and contains no executable database command. Every future read-only preflight and every later write action requires separate explicit user approval.

## 2. Migration chain and PRD mapping

| Migration | Source package | Purpose | Dependency position |
| --- | --- | --- | --- |
| M024 | `20260820_00_prd_phase_2_compliance_schema_substrate.sql` | Additive, inert PRD Phase 2B canonical compliance-persistence substrate: seven empty, service-only RLS-protected tables, including `merchant_compliance_profiles`. | First package in this chain; requires compatible base business tables/extensions/roles. |
| M025 | `20260824_00_reviewed_profile_bootstrap_rpc.sql` | Trusted reviewed-profile bootstrap RPC that writes restrictive pending/test-mode profile, review, and event records. | Requires M024 profile/review/event schema and security. |
| M026 | `20260825_00_reviewed_profile_approval_rpc.sql` | Reviewed compliance approval-decision RPC. It does not activate a merchant or unlock collection. | Requires M024/M025 objects, signatures, and security. |
| M027 | `20260825_01_cleanup_approval_rpc_diagnostics.sql` | Cleanup/hardening of M026 approval-RPC diagnostics. | Requires M026. |
| M028 | `20260825_02_canonical_approval_snapshot_idempotency.sql` | Canonical approval decision-request/snapshot persistence and v1 RPC package. It intentionally fails closed where workspace linkage is unavailable. | Requires the hardened M026/M027 approval-RPC state as well as the earlier substrate/bootstrap baseline. |
| M029 | `20260826_00_canonical_workspace_linkage.sql` | Canonical merchant-to-workspace linkage and service-only reconciliation RPC. It does not itself make the M028 v1 flow ready. | Requires M028 security baseline and compatible workspace ownership data. |
| M030 | `20260827_00_m028_m029_readiness_integration.sql` | Service-only v2 canonical approval request/snapshot readiness integration. | Requires the complete prior M024-M029 chain, including the hardened M026/M027 approval-RPC state and M028/M029 canonical state. |

Dependency graph:

```text
compatible base schema
  -> M024 -> M025 -> M026 -> M027 -> M028 -> M029 -> M030
```

M024 remains the PRD Phase 2B compliance-persistence substrate. M025-M030 are later bootstrap, approval, cleanup, canonical-linkage, and readiness-integration gates. M028 is not independent of M026/M027: its source explicitly validates the approved RPC's availability and cleanup/security state. M030 requires the complete prior chain. M030 is not an alternative to M024 and its migration number does not authorize M030/live readiness, runtime adoption, activation, collection unlock, or commercial behavior.

## 3. Why source and historical evidence are insufficient

The repository contains source migrations and matching preflight/postflight manifests for every package in this chain. It also contains historical local, staging, and production checkpoint records for later packages. Those records are useful evidence of their recorded runs, but neither source presence nor a historical checkpoint proves the current state of any target.

Accordingly:

- do not assume M024 is absent just because this Phase 2B gate has not executed it;
- do not assume M025-M030 are currently present just because historical records claim a prior installation or verification;
- do not replay M024 against an unknown target;
- do not jump to M030 to bypass the chain; and
- do not treat a migration-history entry as sufficient without verifying the corresponding objects, signatures, RLS, policies, grants, and constraints.

If a target already has a matching M024 substrate, it must not be reapplied. If it has a complete matching M024-M030 chain, the next action is a separately chosen non-DB PRD gate, not another migration apply.

## 4. Future read-only target-state questions

For each target, a separately approved, user-run read-only preflight must answer all of the following with compact redacted evidence:

1. What are the expected and observed Supabase project refs, and do they match the approved environment?
2. What are the expected target database name and observed connected database name/role, and do they match the approved target?
3. Is the source SHA-256 for each candidate migration reviewed immediately before any future decision?
4. Is M024 recorded in migration history? Are M025, M026, M027, M028, M029, and M030 recorded?
5. Do the expected tables, functions/RPCs, signatures, ownership/security settings, constraints, indexes, and schema objects exist for every recorded migration in strict M024-to-M030 dependency order, including M026/M027 before M028 and the complete chain before M030?
6. Do RLS state, policy count, grants/revokes, default privileges, and service-only boundaries match the reviewed manifests?
7. Are there missing objects, unexpected objects, duplicate/conflicting definitions, partial-apply signs, or migration-history/object-state conflicts?
8. Does the target retain the required compatible base schema without unrelated business-schema drift affecting the chain?
9. Is `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` still `false` for the environment under review?
10. Is runtime adoption still absent, with no approved live capability, approval-execution, activation, collection-unlock, or commercial behavior change?

Expected/observed project refs, database names, connected roles, migration filenames, hashes, and PASS/FAIL/BLOCKED categories may be recorded. Do not record connection strings, full URLs, passwords, service-role keys, tokens, JWTs, cookies, headers, or raw environment values.

## 5. Target-specific preflight sequence

Each line is a separate approval boundary. No successful step authorizes the next one.

### Local disposable target

1. Obtain explicit approval before any read-only local database command.
2. Confirm the target is disposable and production-baseline-compatible; a shared developer database is not a substitute.
3. Capture local target identity, migration history, M024-M030 object/security state, and manifest comparison using redacted evidence.
4. Classify the result using the decision matrix below before planning any rehearsal.

### Staging target

1. Obtain explicit approval before any read-only staging database command.
2. Capture and compare expected versus observed staging Supabase project ref before reading migration/object state. Database name and connected role alone are insufficient.
3. Capture the staging migration history and M024-M030 object/security state against the matching manifests, with compact redacted evidence only.
4. Stop on target identity, chain, security, or drift uncertainty; do not plan or apply a migration from a preflight result that is not clean.

### Production target

1. Obtain explicit approval before any read-only production database command.
2. Capture and compare expected versus observed production Supabase project ref before reading migration/object state. Do not reuse staging evidence.
3. Independently capture production migration history and M024-M030 object/security state against the matching manifests, with compact redacted evidence only.
4. Production preflight is review evidence only. It does not authorize apply, runtime adoption, route enablement, or any business behavior.

## 6. Decision matrix after future preflight

| Observed state | Required decision |
| --- | --- |
| Disposable local target has no M024-M030 chain and compatible M024 prerequisites | A separate local-rehearsal package may be planned; no apply is authorized by this result alone. |
| M024 exists and exactly matches its source/manifests | Do not reapply M024. Classify later migration state before selecting a non-duplicate next gate. |
| M024-M030 are all recorded in order and their objects/security match | Do not reapply this chain. Proceed only to a separately approved non-DB PRD gate or later reviewed work. |
| Any partial, out-of-order, missing-prerequisite, or broken M024-M030 chain exists | Stop. Create a target-specific reconciliation plan; M028 cannot be classified without M026/M027 and M030 cannot be classified without the complete prior chain. Do not infer a safe continuation or patch during preflight. |
| Object/security drift exists | Stop. Create a drift review; do not broaden grants, weaken RLS, or overwrite objects. |
| Target project ref is missing, ambiguous, unexpected, or mismatched | Stop. Do not continue, rehearse, or apply. |
| Migration history conflicts with object state | Stop. Treat this as a reconciliation incident requiring a new reviewed plan. |

## 7. Hard stop conditions

Stop immediately on any of the following:

- missing, unexpected, ambiguous, or mismatched Supabase project ref;
- target database/role mismatch or unresolved identity;
- source-hash mismatch;
- missing or conflicting migration-history record;
- partial, out-of-order, missing-prerequisite, or conflicting M024-M030 chain; incompatible prerequisite; duplicate object; or signature mismatch;
- unexpected table, function/RPC, policy, grant, revoke, default privilege, constraint, or index;
- RLS/browser-access/service-role boundary mismatch;
- route flag not confirmed false, runtime adoption evidence, or any unapproved business unlock; or
- evidence that cannot be recorded redacted and compactly.

A stop result does not permit an in-place SQL patch, a rerun, a partial continuation, or automatic rollback. Return to source/design review and obtain a new explicit approval.

## 8. What this plan does not do

- It does not connect to a database, run a read-only query, execute SQL, rehearse, apply, postflight, or rollback any migration.
- It does not authorize jumping to M030, replaying M024, or assuming repository history equals current target state.
- It does not authorize runtime adoption, routes, UI, environment/Vercel/deployment changes, or route-flag changes.
- It does not authorize M030/live readiness, approval execution, merchant activation, collection unlock, or payment/provider/checkout/subscription/invoice/storefront behavior.

## 9. Source references

- `supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql` through `supabase/migrations/20260827_00_m028_m029_readiness_integration.sql`
- Matching `supabase/staging/preflight/024...030...` and `supabase/staging/postflight/024...030...` manifests
- `docs/prd-phase-2b-compliance-persistence-design-checkpoint.md`
- `docs/prd-phase-2b-1-compliance-persistence-source-package-checkpoint.md`
- `docs/prd-phase-2b-2-migration-024-execution-approval-plan.md`
- `docs/phase-alignment-and-roadmap-rebaseline.md`
- `docs/deraledger-smart-storefront-prd.md`
- Historical M025-M030 local, staging, and production checkpoint records
