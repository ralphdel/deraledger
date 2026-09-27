# PRD Phase 2B M024 Local Prerequisite Bootstrap Design

**Date:** 2026-09-27  
**Status:** DESIGN ONLY — no database connection, SQL execution, bootstrap, or migration apply is authorized.  
**Target:** `127.0.0.1:55432`, user `postgres`, database `deraledger_m024_m030_rehearsal` only.

## 1. Purpose and boundary

This is a local-disposable rehearsal baseline design for the ordered M024 → M030 source package. It exists because M024 deliberately fails closed when its pre-existing application substrate is absent. It is not a Supabase, staging, or production bootstrap; it does not authorize runtime adoption, business data seeding, routes, UI, M030/live readiness, approval execution, activation, collection unlock, or commercial behavior.

The design has two layers:

1. an M024 minimum baseline that is unambiguously derived from M024 source; and
2. a later full-chain baseline review for earlier application contracts that M025–M030 consume but do not create.

No source in this design is executable. A separate reviewed source package and a separate user approval are required before any local bootstrap action.

## 2. Source-derived prerequisite inventory

| Prerequisite | Source dependency | Why it is needed | Plain-local posture | Bootstrap classification |
| --- | --- | --- | --- | --- |
| `public` schema | Every M024 table, index, foreign key, grant, and function reference uses `public.*` | M024 creates and references `public.*` objects and therefore requires the schema before any prerequisite table or migration object can be created | Standard PostgreSQL usually has it, but a disposable target must verify it | `REQUIRED_FOR_LOCAL_REHEARSAL` |
| `public.merchants` | M024 prerequisite loop and M024 foreign keys | Must be an ordinary table with `id uuid NOT NULL` and a valid non-partial unique key | May be absent | `REQUIRED_FOR_LOCAL_REHEARSAL` |
| `public.invoices` | M024 prerequisite loop and reservation foreign key | Same `id` contract as above | May be absent | `REQUIRED_FOR_LOCAL_REHEARSAL` |
| `public.payment_records` | M024 prerequisite loop and reservation/usage foreign keys | Same `id` contract as above | May be absent | `REQUIRED_FOR_LOCAL_REHEARSAL` |
| `anon`, `authenticated`, `service_role` | M024 prerequisite loop; later revoke/grant and RPC checks | M024–M030 explicitly revoke browser access and grant narrowly to `service_role` | May be absent in plain PostgreSQL; present in a Supabase-managed baseline | `REQUIRED_FOR_LOCAL_REHEARSAL` |
| `gen_random_uuid()` | M024 prerequisite block and UUID defaults; used by later tables/RPCs | Required before M024 table defaults can be created | Availability varies by PostgreSQL baseline | `REQUIRED_FOR_LOCAL_REHEARSAL` |
| `public.solo_plus_cases` | M025, M026, M028, and M030 prerequisite column checks | Earlier plan-review source; M025 needs `id`/`merchant_id`, later migrations require its review/status/version fields | Not created by M024–M030 | `UNKNOWN_NEEDS_REVIEW` |
| `auth.users` | M028 approval-request foreign key; M029/M030 prerequisite and linkage checks | Earlier authentication contract with UUID user identity | Not present in plain PostgreSQL; normally present in Supabase | `UNKNOWN_NEEDS_REVIEW` |
| `public.workspaces` | M029/M030 prerequisite and canonical workspace-owner contract | Earlier workspace contract, including source-verified merchant ownership columns/indexes | Not created by M024–M030 | `UNKNOWN_NEEDS_REVIEW` |
| M024 compliance tables | Created by M024 | Must be absent before M024 rehearsal | N/A | `ALREADY_CREATED_BY_M024_TO_M030` |
| M025 bootstrap RPC, M026 decision RPC, M027 hardened cleanup state | Created in ordered M025–M027 | Later migrations require exact signatures, `SECURITY INVOKER`, hardened search path, and service-only execution | N/A | `ALREADY_CREATED_BY_M024_TO_M030` |
| M028 approval tables/RPCs | Created by M028 | M029/M030 consume them and verify their security posture | N/A | `ALREADY_CREATED_BY_M024_TO_M030` |
| M029 canonical workspace-link table/RPC | Created by M029 | M030 consumes its immutable workspace-authority contract | N/A | `ALREADY_CREATED_BY_M024_TO_M030` |
| `auth`/`storage` application schemas beyond `auth.users` | No M024 requirement; later source references only `auth.users` | Do not create unsupported platform surface | May differ by platform | `MUST_NOT_BOOTSTRAP` |
| `approval_policy_versions`, `approval_decision_requests`, or any M024–M030 protected table/RPC | Created by the ordered package | Pre-creating them would mask migration behavior and invalidate chain-absent preflight | N/A | `MUST_NOT_BOOTSTRAP` |
| arbitrary extension or a hand-written UUID stub | M024 requires only the function, not a named extension | Creating an unreviewed extension/function can mask a platform/version defect | Varies | `MUST_NOT_BOOTSTRAP` |

M024 contains no `CREATE EXTENSION`, no `CREATE SCHEMA` (including no `CREATE SCHEMA public`), no `auth`/`storage` dependency, and no `SECURITY DEFINER`/`SECURITY INVOKER` function. Its `NOTIFY pgrst` statement is a schema-reload notification, not a bootstrap prerequisite. M025–M030 introduce `SECURITY INVOKER` RPCs and require their exact security/grant posture only after their predecessor migration has created them.

## 3. Full-chain dependency summary

- M024 needs the three base public tables, managed roles, and `gen_random_uuid()`; it creates the compliance/limit substrate.
- M025 requires M024 plus the earlier `solo_plus_cases` identity contract.
- M026 requires M025, the expanded `solo_plus_cases` review/status/version contract, and M024 security posture.
- M027 hardens/cleans M026’s approval RPC; it adds no independent application baseline.
- M028 requires M024–M027, the managed roles, `solo_plus_cases`, `public.merchants`, and an `auth.users` contract before its approval-request foreign key can be created.
- M029 requires M024–M028 plus the pre-existing `public.workspaces` and `auth.users` ownership contracts.
- M030 requires the complete M024–M029 chain, managed roles, `public.workspaces`, `auth.users`, and the preceding security manifests.

Therefore the M024 minimum baseline is sufficient to diagnose and rehearse M024 only. A claim of complete M024–M030 rehearsal readiness remains blocked until the `solo_plus_cases`, `auth.users`, and `workspaces` contracts are separately source-mapped and approved. No placeholder may be presented as parity with a real Supabase target.

## 4. Minimal local-only SQL design — non-executable

The future bootstrap source, if separately approved, must be an isolated local-only artifact with the following conceptual sequence. This is design notation, not runnable SQL.

1. Assert exact loopback target, port, user, disposable database name, and typed `LOCAL BOOTSTRAP M024 PREREQS` confirmation in its PowerShell boundary before any `psql` invocation.
2. Re-run the approved read-only preflight; require `chain_absent` and `protected_objects_absent`.
3. Verify the `public` schema exists and is owned/usable by the local rehearsal owner. If it is absent, stop. A future local-only package may propose `CREATE SCHEMA public` only after an ownership-safe, separately reviewed design; no creation is authorized here.
4. Verify each managed role. Create only a missing local rehearsal role with a least-privilege/no-login posture; do not grant broad privileges and do not alter an existing role.
5. Verify `gen_random_uuid()` by signature. If absent, stop for separate PostgreSQL-version/extension design approval; do not create a stub function.
6. Ensure only the three M024 base relations exist with the source-required empty-table contract: ordinary relation, `id uuid NOT NULL`, and a valid non-partial unique key. Any additional column, foreign-key, policy, role grant, trigger, or seed requirement is outside this minimum M024 design.
7. Re-verify that no M024–M030 migration history, protected table, protected RPC, policy, or service grant has been applied.
8. Commit only this prerequisite baseline. It must not insert business rows, execute M024, seed an approval, issue a token, or enable any application feature.

The exact DDL, role ownership, and extension behavior are deliberately deferred. In particular, a minimal synthetic baseline validates M024 source behavior against its stated prerequisites; it is not a claim that historical application migrations or a managed Supabase platform baseline are reproduced.

## 5. Local-only safety gates

Any future bootstrap proposal must stop before password prompt, temporary SQL creation, or native process launch unless all conditions hold:

- host is exactly `127.0.0.1`;
- port is exactly `55432`;
- user is exactly `postgres`;
- database is exactly `deraledger_m024_m030_rehearsal` or a separately approved disposable name accepted by the existing reserved-token guard;
- the name contains none of `production`, `prod`, `staging`, `stage`, `preview`, `live`, `main`, `primary`, `shared`, `default`, `template`, `postgres`, or `supabase`;
- the user types exactly `LOCAL BOOTSTRAP M024 PREREQS`;
- the latest read-only preflight is clean and reports an absent chain/protected objects; and
- no staging, production, connection-string, secret, or non-redactable evidence requirement exists.

The future boundary must use a secure local password prompt only after those checks, discrete `psql` arguments, no connection string, and `PGPASSWORD` restoration in `finally`.

## 6. Post-bootstrap verification design

The future read-only verification must emit compact evidence only:

```text
PASS|BOOTSTRAP_TARGET|local_disposable
PASS|SCHEMA|public|exists
PASS|BOOTSTRAP_ROLE_BASELINE|required_roles_present
PASS|BOOTSTRAP_UUID_FUNCTION|available
PASS|BOOTSTRAP_BASE_TABLES|m024_contract_present
PASS|MIGRATION_HISTORY|chain_absent
PASS|OBJECT_STATE|protected_objects_absent
PASS|BOOTSTRAP_SCOPE|m024_to_m030_not_applied
PASS|DECISION|READY_FOR_M024_LOCAL_APPLY_REVIEW
```

It must block if a role is missing, the UUID function is unavailable, any base-table contract differs, any M024–M030 object/history exists, or evidence cannot remain redacted. The verification must not expose raw catalog rows, paths, URLs, passwords, tokens, service-role values, or environment values.

If the schema check fails, emit only `BLOCKED|SCHEMA|public|missing` and do not continue to role, table, password, or migration steps.

## 7. Stop conditions

Stop and return to design review if `public` is missing and no separately reviewed local-only schema-creation step exists; any prerequisite is not source-derived; a destructive action, seed row, broad grant, fake security policy, or unreviewed extension/function would be needed; an earlier application contract is ambiguous; a target indicator is non-local; a migration object/history conflict exists; a real migration defect would be masked; or compact redacted evidence is impossible.

## 8. Next gates

1. Independent review of this design.
2. Separate approval for an optional source-only local bootstrap package, only after mapping unresolved `solo_plus_cases`, `auth.users`, and `workspaces` contracts.
3. Separate user approval for local bootstrap execution.
4. Post-bootstrap read-only preflight.
5. Separate user approval for local M024–M030 apply retry.
6. Local postflight review.

No stage authorizes staging, production, runtime adoption, routes/UI, M030/live readiness, approval execution, merchant activation, collection unlock, or payment/provider/checkout/subscription/invoice/storefront behavior.
