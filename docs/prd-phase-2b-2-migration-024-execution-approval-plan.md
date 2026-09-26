# PRD Phase 2B-2 — Migration 024 Database Execution Approval Plan

**Date:** 2026-09-26  
**Status:** PLANNING/PREFLIGHT ONLY — no database execution approved  
**Migration:** `supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql`

## 1. Gate purpose

This is the approval plan for a future, user-controlled execution of Migration 024, the inert Phase 2B compliance-persistence substrate. It is not an execution runbook, does not authorize a database connection, and does not apply the migration to local, staging, or production.

The migration remains schema/security only: seven empty service-only tables, constraints, indexes, RLS, grants/revokes, and schema-cache notification. It must not introduce runtime adoption, profile bootstrap, capability unlock, approval execution, activation, collection, payment/provider/checkout/subscription/invoice/storefront behavior, or M030/live readiness.

## 2. Exact source identity

| Artifact | Required identity |
| --- | --- |
| Migration source | `supabase/migrations/20260820_00_prd_phase_2_compliance_schema_substrate.sql` |
| Read-only preflight manifest | `supabase/staging/preflight/024_prd_phase_2_compliance_schema_substrate_snapshot.sql` |
| Read-only postflight manifest | `supabase/staging/postflight/024_prd_phase_2_compliance_schema_substrate_verify.sql` |
| Static source test | `tests/prd-phase-2-compliance-schema-substrate.test.ts` |
| Source-package checkpoint | `docs/prd-phase-2b-1-compliance-persistence-source-package-checkpoint.md` |

Before any future execution gate, the user must calculate the reviewed local source hash and record it in compact evidence:

```powershell
Get-FileHash -Algorithm SHA256 .\supabase\migrations\20260820_00_prd_phase_2_compliance_schema_substrate.sql
```

The hash is a source-integrity check only. It does not prove a target, grant permission to connect, or replace preflight/postflight evidence. The future apply gate must recompute and compare the reviewed hash immediately before applying the exact file.

## 3. Ordered execution sequence

Each numbered step is a separate approval boundary. A successful prior step does not authorize the next one.

1. **Local rehearsal gate:** separately approve a disposable, production-baseline-compatible rehearsal and hostile/default-grant validation. No shared/local developer database is an acceptable substitute.
2. **Staging preflight gate:** separately approve a user-run, read-only target identity, including an explicit expected-versus-observed **staging Supabase project ref**, migration-history, prerequisite, collision, security, and baseline snapshot.
3. **Staging apply gate:** separately approve the observed staging project ref, exact reviewed migration hash, and a user-run staging apply only after local rehearsal and clean staging preflight pass.
4. **Staging postflight gate:** separately approve/read the exact schema/security verification; all expected rows must pass before any production consideration.
5. **Production preflight gate:** separately approve a fresh, read-only production identity, including an explicit expected-versus-observed **production Supabase project ref**, migration-history, collision, security, and business-schema baseline snapshot. It must not reuse staging evidence.
6. **Production apply gate:** separately approve the observed production project ref, exact target, reviewed hash recomputed immediately before apply, and user-run production migration application.
7. **Production postflight gate:** separately approve/read the production schema/security evidence and confirm no behavior change.
8. **Rollback/stop gate:** stop on any failure. Rollback, if ever needed, requires a separate reviewed design and explicit user approval; it is never automatic.

## 4. Required preflight requirements

For staging and again independently for production, compact evidence must confirm all of the following before an apply approval is considered:

- expected Supabase project ref and observed Supabase project ref are both captured as redacted identity labels and compared against the approved environment before any apply; a database name and connected role alone are insufficient proof of target project identity;
- exact target environment identity, approved host, port, database name, and intended database role; do not infer identity from a copied connection string;
- connected database and role match the approved target; user credentials, passwords, service-role keys, and connection strings are never printed or sent to chat;
- exact Migration 024 filename and source SHA-256 are reviewed; target migration history confirms the migration is not already applied or otherwise requires an explicitly classified reconciliation decision;
- prerequisites (`merchants`, `invoices`, `payment_records`, required extensions) are present and compatible;
- existing target tables, indexes, constraints, policies, grants, functions/RPCs, triggers, and default privileges are checked for collision or unsafe drift;
- a business-schema baseline is captured before apply and is used only as drift evidence, not as a claim of full schema equivalence;
- the readiness route flag remains false, runtime adoption remains absent, and no profile/bootstrap/transition/collection behavior is introduced before or during the database gate;
- the preflight's `FAIL` result stops execution. A `WARN` is acceptable only where the reviewed migration explicitly and safely repairs that exact first-install/security state; otherwise it is `BLOCKED` pending review.

The existing Migration 024 preflight manifest is read-only and includes prerequisite, target-schema, RLS/policy/grant, and default-privilege checks. The future execution owner must add or independently record the expected/observed Supabase project ref, target identity, and migration-history evidence; those facts must never be assumed from source files alone.

### Immediate-before-apply identity checklist

For **each** staging and production apply, the explicit approval record must contain only the following non-secret identity/status fields:

- expected Supabase project ref;
- observed Supabase project ref;
- database name;
- connected role;
- reviewed and immediately recomputed Migration 024 SHA-256;
- route-flag status: `false`.

The user must explicitly approve the observed project ref for that environment immediately before apply. Missing, unexpected, ambiguous, or mismatched project ref is `BLOCKED`; do not apply, continue, or treat host/database/role agreement as a substitute.

## 5. Required postflight requirements

After each separately approved apply, the user must run the reviewed read-only postflight manifest and preserve compact redacted evidence confirming:

- all seven Migration 024 tables exist with the exact expected columns, nullability/defaults, constraints, foreign keys, and indexes;
- `merchant_compliance_profiles` remains one row per merchant by source constraint, with fail-closed defaults (`draft`, `test_mode`, false capability booleans, no permissive restriction default);
- RLS is enabled on every target table and browser policies count is zero;
- `PUBLIC`, `anon`, and `authenticated` have no target-table privileges;
- only the expected least-privilege `service_role` grants exist; no target table has a `DELETE` grant;
- append-only tables retain their expected `SELECT, INSERT` privilege shape;
- no unexpected function/RPC, trigger, policy, broad default privilege, or unrelated business-schema change appears;
- exact migration source hash, target identity result, apply result, and postflight summary are captured without secrets;
- no runtime adoption, route/UI change, capability unlock, payment/provider/checkout/subscription/invoice/storefront behavior, approval execution, merchant activation, collection unlock, or M030/live readiness occurred.

Any postflight `FAIL`, unexpected `WARN`, collision, privilege difference, or behavior deviation stops the sequence. Do not proceed to a later environment or try a partial continuation.

## 6. Explicit approval gates

| Gate | Required user approval before action | Evidence required to enter next gate |
| --- | --- | --- |
| Local rehearsal | Run disposable rehearsal only | All applicable harness/static/type/build checks pass; hostile/default-grant results reviewed. |
| Staging preflight | Connect read-only to the exact staging target | Expected and observed staging project refs explicitly match; target identity, source hash, and no unsafe drift confirmed. |
| Staging apply | Apply exact reviewed source to staging | User explicitly approves the observed staging project ref; local rehearsal/preflight pass and immediate-before-apply hash continuity confirmed. |
| Staging postflight | Run/read read-only staging verification | Exact expected schema/security state; no unexpected behavior. |
| Production preflight | Connect read-only to exact production target | Expected and observed production project refs explicitly match; fresh identity, migration-history, baseline, and collision/security evidence pass. |
| Production apply | Apply exact reviewed source to production | User explicitly approves the observed production project ref after fresh preflight and immediate hash continuity comparison. |
| Production postflight | Run/read read-only production verification | Exact expected schema/security state and compact evidence pass. |
| Rollback | Design or execute any rollback action | A separately approved, target-specific rollback/disable plan. |

## 7. User-run command and evidence posture

- The user, not the agent, runs all database commands manually in PowerShell.
- Future commands must use local secure prompts such as `Read-Host -AsSecureString` where authentication is required; they must not print passwords, connection strings, database URLs, service-role keys, or other secrets.
- No credential, token, cookie, JWT, raw header, or service-role key is pasted into chat.
- Future evidence uses only compact `PASS|`, `FAIL|`, `WARN|`, `BLOCKED|`, and `SKIPPED|` lines plus a final summary. It records expected/observed project refs as non-secret identifiers, database name, connected role, route-flag status, and migration hash only; successful catalog dumps stay local.
- The user must verify the exact target in the Vercel/Supabase/PowerShell context before any command. This plan intentionally contains no executable connection or apply command.

## 8. Failure and rollback posture

- Stop immediately on a missing, unexpected, ambiguous, or mismatched Supabase project ref; target mismatch; source-hash mismatch; migration-history ambiguity; prerequisite failure; incompatible object; unexpected policy/grant/function/trigger; or postflight mismatch.
- Do not patch SQL during execution, rerun into partial state, broaden grants, weaken RLS, or continue from a failed target without a new reviewed plan.
- Preserve compact evidence, classify the drift, and return to source review. The next action requires a new explicit approval.
- Rollback is not automatic and no rollback SQL is created by this plan. It requires a separately approved target-specific design that does not erase or weaken security evidence.

## 9. Out of scope

- Runtime adoption, routes, UI, environment/Vercel changes, deployment, and route-flag changes.
- M030/live readiness, approval execution, merchant activation, or collection unlock.
- Payment, provider, checkout, subscription, invoice, storefront, Instant Sale, Receivable Sale, or Deposit & Balance behavior.
- Any local, staging, or production database connection, SQL execution, rehearsal, preflight, apply, postflight, or rollback.
