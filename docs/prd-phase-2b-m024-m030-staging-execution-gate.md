# PRD Phase 2B M024-M030 Staging Execution Gate

**Status:** PREPARATION ONLY — no database connection, read-only query, SQL execution, migration apply, runtime adoption, Admin UI release, approval execution, activation, collection unlock, or commercial behavior is authorized by this document.

## Boundary

**Current evidence state:** User-run target proof and connection evidence identified the approved staging target without exposing credentials. The subsequent read-only preflight reported `BLOCKED|MIGRATION_HISTORY_TABLE|missing`. Target proof does not make an absent migration ledger safe to bypass: M024-M030 apply remains blocked pending the separate [staging migration-ledger bootstrap decision gate](prd-phase-2b-staging-migration-ledger-bootstrap-gate.md).

This is the staging path for the ordered M024-M030 package when a managed Supabase staging baseline is available. It replaces neither target reconciliation nor project identity proof. It is explicitly separate from the plain-local bootstrap path:

- Never run `scripts/bootstrap-m024-prereqs-local.ps1` against staging or production.
- Never run `scripts/postflight-m024-prereqs-local.ps1` against staging or production.
- Those scripts deliberately enforce loopback and disposable-database assumptions; they must not be repurposed as managed-target tooling.

## Gate 0: trusted staging target proof

Before any future staging read-only command, the user must separately approve the target-specific preflight and provide compact, redacted evidence of all of the following:

| Required proof | Acceptance rule |
| --- | --- |
| Expected Supabase project ref | Comes from an approved environment inventory outside chat and identifies staging. |
| Observed Supabase project ref | Comes from a repository-approved, target-bound Supabase mechanism. A typed value, database name, connected role, custom GUC, session setting, or historical checkpoint is not proof. |
| Project-ref comparison | Expected and observed refs match exactly; evidence records the pair without any URL, credential, or connection string. |
| Database host and expected staging URL/context | Compared locally against the approved staging context; evidence records only a redacted host/context classification, never a full URL. |
| Database name and connected role | Observed from the eventual read-only target session and compared to expected values. They supplement, but never replace, project-ref proof. |
| Staging/not-production posture | The approved environment context is explicitly staging and its project ref is distinct from production. |
| Route/runtime safety | Deployment evidence records `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=false`; source/release evidence confirms no runtime adoption, M030 live-readiness activation, Admin UI release, approval execution, activation, collection unlock, or commercial behavior. |

If approved target-bound project-ref evidence is unavailable or no longer matches the expected staging environment, every staging attempt ends here:

```text
BLOCKED|DECISION|BLOCKED_PROJECT_REF_UNPROVEN
```

This is a hard stop, including for otherwise read-only preflight. No script is created by this gate because an executable staging helper must not establish missing proof itself.

## Gate 1: future user-run read-only preflight

Only after Gate 0 passes and the user explicitly approves a staging read-only command, a dedicated staging preflight package must emit compact `PASS`, `FAIL`, or `BLOCKED` evidence. It must not print catalog rows, full URLs, connection strings, passwords, tokens, service-role keys, headers, cookies, or environment values.

The preflight must verify:

1. Proven staging target identity, expected/observed project ref match, observed database name, connected role, server/session classification, and staging/not-production context.
2. `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED=false` evidence and absence of runtime adoption/M030 readiness activation.
3. The `supabase_migrations.schema_migrations` ledger exists and its ordered M024-M030 history is classified as absent chain, exact full chain, or blocked partial/out-of-order/history-object conflict. A missing ledger table is not an absent chain: it emits `BLOCKED|MIGRATION_HISTORY_TABLE|missing` and `BLOCKED|DECISION|STAGING_PREFLIGHT_BLOCKED`.
4. Existing prerequisite base tables, `public` schema, `anon`/`authenticated`/`service_role`, and `gen_random_uuid()` availability.
5. Protected M024-M030 tables and RPCs: consistently absent for an apply candidate, or fully present and manifest-matching for a no-apply result.
6. Function signatures/overloads, SECURITY DEFINER/INVOKER posture, hardened search paths, and M027 cleanup marker state.
7. RLS, NO FORCE RLS where required, zero browser policies, no PUBLIC/anon/authenticated access, exact service-role grants, and no prohibited DELETE grants.

Safe final classifications are:

```text
BLOCKED|DECISION|BLOCKED_PROJECT_REF_UNPROVEN
BLOCKED|DECISION|BLOCKED_TARGET_MISMATCH
BLOCKED|DECISION|BLOCKED_PARTIAL_CHAIN
BLOCKED|DECISION|BLOCKED_DRIFT
BLOCKED|DECISION|BLOCKED_SECURITY_MISMATCH
BLOCKED|DECISION|BLOCKED_RUNTIME_ADOPTION_DETECTED
BLOCKED|DECISION|STAGING_PREFLIGHT_BLOCKED
PASS|DECISION|NO_APPLY_NEEDED_TARGET_ALREADY_MATCHES
PASS|DECISION|READY_FOR_STAGING_APPLY_REVIEW
```

`READY_FOR_STAGING_APPLY_REVIEW` is evidence only; it never approves an apply.

## Gate 2: conditional staging apply review

Apply is possible only when Gate 1 returns `PASS|DECISION|READY_FOR_STAGING_APPLY_REVIEW`, including proof that `supabase_migrations.schema_migrations` exists and records a clean absent M024-M030 chain, all results are independently reviewed, and the user gives a new explicit staging-apply approval. The M024-M030 apply package must never create the schema, table, or ledger rows. The migration order is fixed:

```text
M024 → M025 → M026 → M027 → M028 → M029 → M030
```

Immediately before any apply, recompute each source SHA-256 and compare it to the locked reviewed manifest in [the local rehearsal package](prd-phase-2b-m024-m030-local-rehearsal-and-postflight-package.md). The expected values are:

| Step | Migration source | SHA-256 |
| --- | --- | --- |
| M024 | `20260820_00_prd_phase_2_compliance_schema_substrate.sql` | `8a42669b40ae29d1170dd09831f0b79e795052614fd874432e6077d1072816cf` |
| M025 | `20260824_00_reviewed_profile_bootstrap_rpc.sql` | `e607cb2f1ef95feae26dffa153d8206e2d63efcccf039026df9cb48f2862d948` |
| M026 | `20260825_00_reviewed_profile_approval_rpc.sql` | `c2c27e0f457add4eebc90f2e839367e80c875825ede8e4124667eea8d910d76c` |
| M027 | `20260825_01_cleanup_approval_rpc_diagnostics.sql` | `ac7334c3c080dc4d6d7a68dd005ff1b3e2f16f082972fe8335764ea1a722376e` |
| M028 | `20260825_02_canonical_approval_snapshot_idempotency.sql` | `89ddba1421c1d796ee8c9e84f5d0c608d5c83ac538e4ee881cf2cc50f3d4ef28` |
| M029 | `20260826_00_canonical_workspace_linkage.sql` | `3ec3dfa172f5ebc1c34903853fb9746efb012731ded2ce3b344c7533951a34f9` |
| M030 | `20260827_00_m028_m029_readiness_integration.sql` | `8759bed04e9f019762b69fdf25c155f9deaaff691d844dfcbbe69663f604d49b` |

Missing, placeholder, malformed, or mismatched hashes stop before apply. The future user-run apply must use discrete database arguments, `-X`, `ON_ERROR_STOP=1`, no connection string, a secure local credential prompt, and fail fast at the first migration error. It must not proceed from a partial chain or an already matching target.

## Gate 3: conditional staging postflight

After a separately approved successful apply, the user must separately approve a read-only postflight. It must report compact redacted evidence and verify:

- M024-M030 migration history is present in exact dependency order;
- M024 tables, M025-M030 RPCs/objects, and their exact signatures/overload counts match manifests;
- function SECURITY DEFINER/INVOKER posture and hardened search paths match;
- RLS is enabled and NO FORCE RLS is retained where required;
- browser/public/anon/authenticated unsafe grants and policies are absent;
- service-role grant arrays match exactly and prohibited DELETE grants are absent;
- M027 legacy diagnostic marker cleanup is present; and
- M028/M029/M030 canonical request, linkage, and readiness objects match their reviewed manifests without enabling live readiness or runtime behavior.

Any mismatch is `FAIL` or `BLOCKED`, never warning-only. A postflight pass does not authorize runtime adoption, route enablement, Admin UI release, approval execution, activation, collection unlock, payment, checkout, subscription, invoice, or storefront behavior.

## Hard stop conditions

Stop without continuation on project-ref proof unavailable/mismatch, target mismatch, production indicator, route flag not proven false, runtime-adoption evidence, a missing migration-history table, hash mismatch, drift, partial chain, protected-object collision, postflight mismatch, missing security manifest, unsafe grant/policy, or any evidence that cannot remain redacted.

## PowerShell phase-output pattern for future user-run tooling

Future staging tooling must not put an evidence-writing phase directly inside a boolean condition such as `if (-not (Invoke-Phase))`. In Windows PowerShell, success-stream evidence can be captured by that expression and disappear from the user-visible record.

Each phase must print compact evidence outside the success stream (for example, with `Write-Host`) and return an explicit Boolean status separately. The caller must store and test that status:

```powershell
$preflightOk = Invoke-StagingPreflight
if ($preflightOk -ne $true) { exit 1 }
```

No phase may hide a `PASS`, `FAIL`, or `BLOCKED` line merely because its result is tested. The phase output must remain redacted and compact; this pattern does not authorize a staging script or any database action.

## Next authority sequence

1. Keep the established target proof current and independently review it before each user-run staging operation.
2. Resolve the missing ledger only through the separate staging migration-ledger bootstrap decision gate; M024-M030 apply is blocked until that gate has separately approved and completed a ledger action, if one is source-backed and necessary.
3. Obtain explicit user approval for a staging read-only preflight.
4. Review compact preflight evidence.
5. Obtain separate explicit approval for staging apply, only if the preflight returns `READY_FOR_STAGING_APPLY_REVIEW`.
6. Obtain separate explicit approval for staging postflight.
7. Choose any later non-DB PRD gate separately.

No step authorizes production, local bootstrap on managed targets, runtime adoption, Admin UI release, M030/live readiness, approval execution, merchant activation, collection unlock, or payment/provider/checkout/subscription/invoice/storefront behavior.
