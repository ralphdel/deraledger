# SQL Migration and Rehearsal Lessons Learned

This document records confirmed failures, root causes, corrections, and preventive rules discovered during DeraLedger migration, rollback-rehearsal, PowerShell, psql, catalog-inspection, and production-recovery work. Any agent or developer generating or modifying database migration runners, SQL inspection scripts, PowerShell database tooling, or credentialed execution instructions must review this document before making changes.

## 1. Purpose and Authority

This document is mandatory operational guidance for database-adjacent work in this repository. It captures defects already paid for through failed local, staging, or production-adjacent rehearsals so they are not rediscovered through another credentialed run.

Rules here apply to migrations, staging wrappers, rollback-only rehearsals, read-only recovery inspections, PostgreSQL catalog queries, psql output parsers, generated manifests, PowerShell native-process wrappers, and user-run credentialed instructions.

## 2. Mandatory Reading Order

1. `docs/database-migration-and-staging-safety-runbook.md`
2. `docs/sql-migration-rehearsal-lessons-learned.md`
3. Current task approval text and exact commit/branch constraints
4. Relevant migration, wrapper, harness, and script source files
5. Existing evidence files supplied by the user

## 3. Environment Facts

- Local disposable PostgreSQL is expected on host `127.0.0.1`, port `55432`, major version `15`, unless a task explicitly proves otherwise.
- Production PostgreSQL major version observed during this work is `17`.
- Local identity checks must use `host(inet_server_addr())`; do not compare `inet_server_addr()::text` to a bare address.
- Local SSL mode must be set through `PGSSLMODE=disable`, not by appending query parameters to a database URL.
- Protected feature flags are stored in `public.platform_settings`, with `key TEXT PRIMARY KEY` and `value TEXT NOT NULL`; missing protected keys normalize to `false`.

## 4. Incident Ledger

### ENV-001 - Wrong Local PostgreSQL Port/Version Assumptions

- Context: Disposable PostgreSQL harness and local validation work.
- Exact symptom or error: Tooling attempted the wrong local endpoint or major version.
- Root cause: Assuming default PostgreSQL port/version rather than the approved local test endpoint.
- Unsafe assumption: Local PostgreSQL is always on port `5432`.
- Durable correction: Use host `127.0.0.1`, port `55432`, PostgreSQL major `15` for approved local harnesses.
- Prevention rule: Verify executable path, host, port, database, and major version before creating a disposable database.
- Required regression: Local identity gate that rejects any non-local host, wrong port, or wrong major.
- Relevant files or migrations: PowerShell local harnesses and recovery scripts.
- Status: Corrected.
- Applicable commit: Commit 16 compatibility work.

### SQL-001 - pg_temp Helper Collision

- Context: Multiple ordered migrations ran in one psql session.
- Exact symptom or error: `cannot remove parameter defaults from existing function`
- Root cause: The same `pg_temp` function identity was reused across ordered migrations with incompatible defaults.
- Unsafe assumption: `pg_temp` helper names can be reused safely across migration includes in one session.
- Durable correction: Add migration-specific helper suffixes such as `_m010`, `_m011`, and `_m012`.
- Prevention rule: Build a `pg_temp` identity matrix across the exact execution order before generating a runner.
- Required regression: Static audit proving no duplicate executable `pg_temp` function identity across included migrations.
- Relevant files or migrations: Migrations `010`, `011`, `012`.
- Status: Corrected.
- Applicable commit: `2d0cfee4f81aa1c6416e65ad8eac60701d878ec5`.

### PS-001 - Redirected Stdout/Stderr Deadlock

- Context: PowerShell launched native psql and pg_dump commands with redirected output.
- Exact symptom or error: Runner appeared to hang or failed to collect complete output.
- Root cause: Sequential output reads can deadlock when stderr/stdout buffers fill.
- Unsafe assumption: A native process can be waited on before draining both streams.
- Durable correction: Drain stdout and stderr concurrently, use finite timeouts, write progress files, and terminate the process tree on timeout.
- Prevention rule: Never use native-process wrappers that read stdout and stderr sequentially for psql, pg_dump, or high-volume commands.
- Required regression: Offline high-volume stdout/stderr fixture above 2 MB plus timeout termination fixture.
- Relevant files or migrations: Production rehearsal PowerShell scripts.
- Status: Corrected.
- Applicable commit: Commit 16 rehearsal work.

### PSQL-001 - Wrong Settings Table

- Context: Recovery/preflight scripts checked protected flags.
- Exact symptom or error: Query targeted a nonexistent settings table.
- Root cause: Using `public.app_settings` instead of the canonical settings table.
- Unsafe assumption: Existing app setting names imply the database table name.
- Durable correction: Use `public.platform_settings`.
- Prevention rule: Protected flags must be read only from `public.platform_settings`; missing keys normalize to `false`.
- Required regression: CONTROL-row fixture requiring `platform_settings` schema and fail-closed behavior for true/invalid flags.
- Relevant files or migrations: Recovery and rehearsal scripts.
- Status: Corrected.
- Applicable commit: Commit 16 recovery work.

### PSQL-002 - CONTROL-Row Parser Failure

- Context: psql output parsing for preflight, postflight, and recovery checks.
- Exact symptom or error: CONTROL row missing, duplicated, or not parsed.
- Root cause: Parser did not account for psql formatting noise, CRLF/LF differences, leading BOM, or multiple rows.
- Unsafe assumption: psql emits exactly the desired row without format flags or normalization.
- Durable correction: Use `-q -A -t`, trim whitespace, support CRLF/LF, strip leading BOM, and require exactly one `CONTROL|` row.
- Prevention rule: Any CONTROL parser must fail closed on zero, incomplete, malformed, or multiple CONTROL rows.
- Required regression: Parser fixtures for BOM, CRLF/LF, missing rows, duplicate rows, and malformed fields.
- Relevant files or migrations: Recovery and rehearsal scripts.
- Status: Corrected.
- Applicable commit: Commit 16 recovery work.

### ENV-002 - inet_server_addr CIDR Behaviour

- Context: Local PostgreSQL identity checks.
- Exact symptom or error: Observed address output included CIDR notation, such as `127.0.0.1/32`.
- Root cause: Casting `inet_server_addr()` directly to text can include netmask formatting.
- Unsafe assumption: `inet_server_addr()::text` always equals `127.0.0.1`.
- Durable correction: Use `host(inet_server_addr())`.
- Prevention rule: Local identity SQL must compare `host(inet_server_addr())`, not raw inet text.
- Required regression: Offline script check for `host(inet_server_addr())` in local identity mode.
- Relevant files or migrations: Local validation scripts.
- Status: Corrected.
- Applicable commit: Commit 16 recovery work.

### ENV-003 - Malformed Disposable Database URL

- Context: Local disposable database URL construction.
- Exact symptom or error: Parsed database name was `=disable`.
- Root cause: SSL mode query text was appended and then parsed incorrectly as part of the database target.
- Unsafe assumption: Database URL parsing is harmless in ad hoc PowerShell.
- Durable correction: Set `PGSSLMODE` separately and parse/verify host, port, and database name before running.
- Prevention rule: Do not append `?sslmode=disable` in local recovery/rehearsal script target construction.
- Required regression: Static check that local modes do not use malformed URL parsing or `TEST_DATABASE_URL` where direct psql arguments are sufficient.
- Relevant files or migrations: Local recovery integration mode.
- Status: Corrected.
- Applicable commit: Commit 16 recovery work.

### CATALOG-001 - name[] Versus text[]

- Context: Recovery script inspected primary-key columns through PostgreSQL catalogs.
- Exact symptom or error: `operator does not exist: name[] = text[]`
- Root cause: `array_agg(a.attname ORDER BY ...)` returns `name[]`, while `ARRAY['key']` is `text[]`.
- Unsafe assumption: PostgreSQL will implicitly compare catalog `name[]` to `text[]`.
- Durable correction: Cast catalog names to text before aggregation and compare against explicitly typed text arrays.
- Prevention rule: Use `array_agg(a.attname::text ORDER BY ...) = ARRAY['key']::text[]`.
- Required regression: Static check that catalog-name arrays are cast to `text[]` and preserve deterministic ordinal order.
- Relevant files or migrations: `2d0cfee4-production-recovery-readonly.ps1`.
- Status: Corrected.
- Applicable commit: `2d0cfee4f81aa1c6416e65ad8eac60701d878ec5`.

### CATALOG-002 - text Concatenated With Internal "char"

- Context: Recovery script constructed schema fingerprints from PostgreSQL catalog constraints.
- Exact symptom or error: `operator is not unique: text || "char"`
- Root cause: Internal catalog `"char"` fields such as `pg_constraint.contype` were concatenated into text without explicit casts.
- Unsafe assumption: PostgreSQL will always infer the desired text concatenation overload for internal `"char"` values.
- Durable correction: Explicitly cast internal `"char"` catalog fields before text operations, for example `con.contype::text` and `con.confdeltype::text`.
- Prevention rule: Audit catalog fields including `pg_constraint.contype`, `confupdtype`, `confdeltype`, `confmatchtype`, `pg_class.relkind`, `relpersistence`, `pg_proc.prokind`, `pg_attribute.attidentity`, and `attgenerated` before text concatenation, comparisons, CASE, COALESCE, `string_agg`, `array_agg`, and fingerprints.
- Required regression: Static check proving no executable text operation uses an uncast internal `"char"` catalog field.
- Relevant files or migrations: `2d0cfee4-production-recovery-readonly.ps1`.
- Status: Corrected.
- Applicable commit: `2d0cfee4f81aa1c6416e65ad8eac60701d878ec5`.

### EVIDENCE-001 - Failure Output Deleted Before Preservation

- Context: Read-only recovery inspection returned nonzero.
- Exact symptom or error: Wrapper reported failure, but inspection stdout/stderr had been deleted with the temp directory.
- Root cause: Sanitized failure evidence was written only on success, and temp cleanup ran in `finally`.
- Unsafe assumption: PowerShell wrapper errors are enough to diagnose SQL failures.
- Durable correction: Write sanitized failure result and first PostgreSQL/psql error before temporary cleanup.
- Prevention rule: Any credentialed script must preserve sanitized first-error evidence on nonzero exit, timeout, parser failure, and cleanup paths.
- Required regression: Offline simulated nonzero psql exit that writes sanitized result and first-error evidence before cleanup.
- Relevant files or migrations: `2d0cfee4-production-recovery-readonly.ps1`.
- Status: Corrected.
- Applicable commit: Commit 16 recovery work.

### VALIDATION-001 - Static Checks Missed Runtime Catalog Errors

- Context: Recovery SQL passed static scans but failed when PostgreSQL resolved catalog operators.
- Exact symptom or error: Catalog `name[]` and internal `"char"` runtime errors.
- Root cause: Offline lexical checks cannot fully type-check PostgreSQL catalog expressions.
- Unsafe assumption: Static mutation scans imply runtime compatibility.
- Durable correction: Add disposable local integration execution of the exact generated recovery SQL before production.
- Prevention rule: Production-bound database scripts require offline validation plus representative disposable local runtime validation.
- Required regression: `-LocalRecoveryIntegrationValidate` mode that executes the full generated SQL and parses one CONTROL row.
- Relevant files or migrations: Recovery scripts.
- Status: Corrected with local mode; requires user execution.
- Applicable commit: Commit 16 recovery work.

### VALIDATION-002 - Baseline Compatibility Confused With Canonical Target

- Context: Read-only production recovery inspection for Migration 009 compatibility.
- Exact symptom or error: `Unexpected CONTROL value for processed_at_nullable: false`.
- Root cause: The recovery inspection required the post-migration canonical state while inspecting a rollback-restored pre-migration production baseline.
- Unsafe assumption: A repairable legacy schema must already satisfy the final canonical nullability/default contract.
- Durable correction: Report separate CONTROL fields for acceptable pre-migration compatibility, already-canonical state, and intended post-migration target.
- Prevention rule: Preflight and recovery inspections must distinguish accepted repairable legacy states from the final state a migration will enforce.
- Required regression: Local fixtures covering legacy `processed_at TIMESTAMPTZ NOT NULL DEFAULT now()`, canonical nullable/no-default state, and invalid defaults.
- Relevant files or migrations: `2d0cfee4-production-recovery-readonly.ps1`, Migration `009`.
- Status: Corrected in recovery script.
- Applicable commit: `2d0cfee4f81aa1c6416e65ad8eac60701d878ec5`.

### VALIDATION-003 - Foreign-Key Baseline Confused With Canonical Target

- Context: Read-only production recovery inspection for `public.payment_events.merchant_id`.
- Exact symptom or error: `Unexpected CONTROL value for merchant_fk_delete_cascade: false`.
- Root cause: Production had exactly one validated expected named FK from `payment_events(merchant_id)` to `public.merchants(id)` using `NO ACTION`, but the recovery inspection required the post-migration `CASCADE` state.
- Unsafe assumption: A migration-repairable foreign key must already satisfy the final canonical delete action.
- Durable correction: Report and validate actual FK state, pre-migration-compatible FK state, already-canonical FK state, and intended migration target separately.
- Prevention rule: Only an exact, uniquely identified, validated FK shape known to be safely repairable may be accepted as legacy-compatible.
- Required regression: Fixtures for expected named `CASCADE`, `NO ACTION`, and `RESTRICT` FKs, plus wrong name/reference, multiple, unvalidated, missing, `SET NULL`, and `SET DEFAULT` fail-closed cases.
- Relevant files or migrations: `2d0cfee4-production-recovery-readonly.ps1`, Migration `009`, Migration `017`.
- Status: Corrected in recovery script.
- Applicable commit: `2d0cfee4f81aa1c6416e65ad8eac60701d878ec5`.

### GIT-001 - Raw File Hash Failed After LF/CRLF Restoration

- Context: A temporary patch for the main runbook was intentionally retained after source changes.
- Exact symptom or error: The documentation patch was restored as a Git-visible modification, but a raw working-tree SHA256 comparison reported restoration failure because line-ending normalization changed the bytes.
- Root cause: Raw file hashes were used for a tracked text-file restoration check where Git could normalize line endings.
- Unsafe assumption: A raw working-tree SHA256 comparison is always an exact proxy for tracked-path patch restoration.
- Durable correction: Compare Git diffs or patch identity semantically, use `git stash` for exact tracked-path preservation when appropriate, and verify `git diff --check` after restoration.
- Prevention rule: Do not rely only on raw working-tree file hashes for temporarily preserved tracked changes, and never apply a preserved patch twice.
- Required regression: Final reports for retained patches must state `SAME SEMANTIC CHANGE`, `DIFFERENT CHANGE`, or `NOT APPLICABLE`.
- Relevant files or migrations: `docs/database-migration-and-staging-safety-runbook.md`, temporary runbook patch evidence.
- Status: Documented.
- Applicable commit: Commit 16 recovery work.

### PS-002 - Scalar Output Treated as a Collection Under StrictMode

- Context: Standalone FK diagnostic local integration result handling.
- Exact symptom or error: `The property 'Count' cannot be found on this object.`
- Root cause: A helper returning exactly one `FK_DETAIL` row was scalar-unrolled into a string, but the caller assumed array shape and accessed `.Count` under StrictMode.
- Unsafe assumption: A PowerShell function or command that usually emits a collection will keep array shape when it emits exactly one object.
- Durable correction: Normalize cardinality-sensitive command and function output with `@(...)` at assignment boundaries.
- Prevention rule: Test zero, one, and many results through the real orchestration helpers using database-free mocks.
- Required regression: Mocked runtime branch coverage for `CONTROL` rows, FK detail rows, fixture results, evidence lines, and cleanup collections under `Set-StrictMode -Version Latest`.
- Relevant files or migrations: `2d0cfee4-production-payment-events-fk-readonly-diagnostic.ps1`, `2d0cfee4-production-recovery-readonly.ps1`.
- Status: Documented.
- Applicable commit: `2d0cfee4f81aa1c6416e65ad8eac60701d878ec5`.

### ARTIFACT-001 - Commit-Specific Package Staleness

- Context: Generated migration bundles, manifests, runners, and rehearsal scripts.
- Exact symptom or error: Old generated artifacts no longer represented the current source commit.
- Root cause: Source changes were made after package generation.
- Unsafe assumption: A previous rehearsal artifact can be reused after any source or wrapper change.
- Durable correction: Tie every package to exact commit, source hashes, generated hashes, runner hash, and script hash.
- Prevention rule: Source changes invalidate runner, bundle, manifest, script, and hashes. Never patch generated SQL independently.
- Required regression: Hash verification for every source and generated file before execution.
- Relevant files or migrations: Commit-specific rehearsal artifacts.
- Status: Corrected.
- Applicable commit: `2d0cfee4f81aa1c6416e65ad8eac60701d878ec5`; prior `beecef35` artifacts are stale.

### ARTIFACT-002 - Generated Rehearsal Wrapper Omitted the Production-Proof Contract

- Context: Rollback-only production rehearsal package generation.
- Exact symptom or error: An independently reviewed bundle had a correct runner and correct migration copies, but its generated wrapper performed only basic token/hash checks before starting psql.
- Root cause: Artifact generation validated the SQL bundle but treated the execution wrapper as a thin launcher rather than as the production safety boundary.
- Unsafe assumption: A correct rollback-only SQL runner is sufficient to make a production rehearsal package executable.
- Durable correction: A production rehearsal package is incomplete unless its wrapper independently implements and tests identity, credential, environment, CONTROL parsing, pre/post fingerprint, rollback proof, session/lock/prepared-transaction, timeout, process-tree, evidence-preservation, and cleanup controls before it can be considered executable.
- Prevention rule: Wrapper generation must be tracked, template-driven, database-free testable, and independently reviewed before any user-run pre-execution validation.
- Required regression: Tracked wrapper generator/template, database-free offline validation mode, mutation tests for every fail-closed control, and independent review before any user-run pre-execution validation.
- Relevant files or migrations: Commit 16 rollback-only rehearsal generator and wrapper.
- Status: Documented.
- Applicable commit: Commit 16 artifact tooling correction work.

### ARTIFACT-003 - Target URL Validation Accepted Missing Identity Components

- Symptom: The rehearsal wrapper accepted target URLs without a host or username and reported database identity as true whenever `current_database()` was merely non-empty.
- Root cause: Structured URL validation checked only scheme/path shape, while the CONTROL SQL used a tautological non-empty database test.
- Durable rule: A target must contain an explicit host, username, and database, and preflight/postflight must compare `current_database()` to the validated expected database using a safely encoded temporary SQL literal.
- Required regression: Missing-host, missing-user, malformed URL/query, password, SSL, and exact identity-match/mismatch fixtures through the real wrapper helpers.
- Status: Corrected in source; local database-free validation required.

### ARTIFACT-004 - Mutation Matrix Reported Coverage Without Executing Mutations

- Symptom: The offline mutation matrix counted non-empty case names while executing only a valid package and one effective-COMMIT mutation.
- Root cause: Declarative labels were mistaken for executed regression cases.
- Durable rule: Every declared mutation requires a unique case ID, executed setup, the real shared production function, observed outcome, classified error, boundary invocation counts, and cleanup result; declared and executed counts must match exactly. Authentic offline mutation testing requires injectable production boundaries. Production and tests must use the same parsing, integrity, acceptance, process, and lifecycle functions. Test-only validators and wrappers are prohibited.
- Required regression: URL, identity, CONTROL, runner, artifact-integrity, process, credential-cleanup, and environment-restoration cases using the canonical production functions with isolated temporary artifacts and injected adapters. Offline cases must prove credential, executable-resolution, native-process, package-generation, and SQL boundary counts remain zero.
- Final architecture requirements:
  - Production and temporary artifacts must pass the same complete descriptor-driven integrity function; test-only artifact bypasses and early returns are prohibited.
  - Temporary pgpass files must be exact UTF-8 without BOM, must preserve the expected hostname prefix, must never enter evidence, and must be deleted on every path.
  - Baseline parity must be computed for every baseline function and classified as exact, named adapter plumbing, documented intentional correction, or unexplained. Acceptance requires zero unexplained differences; fixed expected counts are not evidence.
  - Native-process tests must execute deterministic local child processes for concurrent stdout/stderr draining, non-zero exit, timeout and descendant-tree termination, redaction before persistence, and process disposal.
  - The actual offline command must build an injected fake runtime context and invoke the real offline validation path while reporting zero credential, psql resolver, pg_dump resolver, process, package-generation, and SQL boundary calls.
  - The independent harness must parse both helper and generator ASTs and reject duplicate helpers, DR/test validator shadows, credential/executable/process/package/SQL boundary bypasses, and artifact-integrity bypass variables or members.
- Status: Corrected in source; independent offline architecture review required before package generation.

### ARTIFACT-005 - Finalized Manifest Paths Were Not Accepted by the Production Descriptor

- Symptom: The production wrapper rejected the finalized package before credentials with `RV.ARTIFACT.MANIFEST_MIGRATION_PATH` for migration `006`.
- Root cause: `Get-ProductionArtifactDescriptor` reconstructed ordered migration paths by stripping every three-digit filename prefix and sorting hashtable keys against source filenames. The staging migration filenames for `006` through `008` retain those prefixes, so all three received a sort key of `-1` and depended on hashtable enumeration. In the failed package, slot `006` resolved to the generated `008` file and slot `008` resolved to the generated `006` file; `007` aligned only by accident. The manifest itself stored machine-specific absolute generated paths, while offline fixtures bypassed this production reconstruction by reading manifest rows directly in order.
- Why prior gates missed it: Offline/static/package review did not execute the finalized wrapper's `Get-ProductionArtifactDescriptor -> Assert-ArtifactIntegrity` path. Hash and helper equivalence proved byte integrity, but not production runtime acceptance of the final split layout.
- Durable correction: One source-controlled `Get-TrustedMigrationSpecification` defines the ordered migration number, canonical source, generated filename, and transaction-envelope policy for `006` through `017`. Package generation, production descriptor construction, manifest mapping, and runtime integrity validation consume that same specification; order is never reconstructed from hashtable enumeration. Manifest migration entries contain one exact case-sensitive package-relative leaf filename, and the wrapper embeds finalized absolute paths that must independently match the trusted generated filename and approved bundle root before file and hash validation. Separators, rooted paths, traversal, case changes, missing values, duplicate mappings, and wrong number/file pairs are rejected.
- Permanent regression rule: No production rehearsal package is approvable until its FINALIZED artifact layout passes the SAME pre-credential runtime artifact-validation path used by the production wrapper.
- Required regression: Execute the generated wrapper's `-ArtifactValidationOnly` entrypoint against a root-wrapper/root-manifest plus temporary-package split fixture; cover migrations `006` through `017`, the old ordering defect, wrong/missing/duplicate/traversal/outside/case/separator paths, mutation after hashing, moved package roots, and credential/database boundary sentinels. Agreement between descriptor and manifest is insufficient if both can be correlatedly wrong. Runtime validation must bind both to an independent trusted canonical migration specification, with correlated descriptor-plus-manifest swaps, duplicates, renames, substitutions, and case changes rejected.
- Prevention rule: Static/hash equivalence is insufficient evidence for runtime artifact acceptance. The generator must run finalized bytes through the exact wrapper artifact validator before reporting package generation success.
- Status: Corrected in source; offline finalized-layout validation required before package generation.

### ROLLBACK-001 - Outer Rollback Contract

- Context: Rollback-only production rehearsal package.
- Exact symptom or error: A runner can accidentally commit or omit required markers.
- Root cause: Generated runner contract was not enforced centrally.
- Unsafe assumption: Included migrations can be trusted without runner-level transaction verification.
- Durable correction: Require exactly one outer `BEGIN`, zero `COMMIT`, one final `ROLLBACK`, expected RUNNING/PASSED markers, identical pre/post schema hashes, no lingering session, timeout false, and cleanup confirmed.
- Prevention rule: Reject runner packages that violate the rollback-only contract before any connection.
- Required regression: Static runner contract count plus local full-runner validation.
- Relevant files or migrations: Commit 16 rollback-only runner.
- Status: Corrected.
- Applicable commit: `2d0cfee4f81aa1c6416e65ad8eac60701d878ec5`.

### DATA-001 - payment_events Legacy Compatibility

- Context: Historical production audit rows had no merchant ownership.
- Exact symptom or error: Canonical migration expected `payment_events.merchant_id UUID NOT NULL`.
- Root cause: Migration contract did not account for legitimate historical ownerless rows.
- Unsafe assumption: Every `payment_events` row can be assigned to a real merchant.
- Durable correction: Preserve historical ownerless rows, keep `merchant_id` nullable UUID, maintain real merchant FK with cascade delete, and prevent current merchant-owned writes without real ownership in application code.
- Prevention rule: Do not backfill arbitrary merchants, create sentinel merchants, delete/archive/copy/replace historical rows, or rewrite data solely for metadata canonicalization.
- Required regression: Migration and lifecycle tests proving nullable ownership is intentional and rows are preserved.
- Relevant files or migrations: Migration `009`, migration `017`, payment lifecycle tests.
- Status: Corrected.
- Applicable commit: Commit 16 compatibility work.

### SECURITY-001 - Credential Handling

- Context: Production and local credentialed scripts.
- Exact symptom or error: Risk of credential exposure in commands, URLs, evidence, or assistant output.
- Root cause: Credential handling was not uniformly constrained.
- Unsafe assumption: Passwords in URLs or command arguments are acceptable for temporary scripts.
- Durable correction: Agents never request or receive passwords; user executes credentialed steps. Password is absent from URLs, arguments, logs, evidence, and manifests. Temporary pgpass lives outside the repository and is deleted in `finally`. `-w` prevents fallback prompts.
- Prevention rule: No secrets, connection strings, pgpass paths, hostnames, usernames, database names, or backend PIDs in sanitized evidence or final reports unless explicitly approved and safe.
- Required regression: Offline sanitized-result fixture and pgpass deletion fixture.
- Relevant files or migrations: All PowerShell database tooling.
- Status: Corrected.
- Applicable commit: Commit 16 recovery work.

## 5. PostgreSQL Catalog-Type Hazards

PostgreSQL catalog columns often use internal or specialized types. Before using catalog values in text operations or equality checks, identify their real type.

- Cast `name` values to `text` before array aggregation or comparison.
- Cast internal `"char"` values to `text` before text concatenation, CASE, COALESCE, string aggregation, array aggregation, fingerprints, or text comparisons.
- Preserve deterministic ordering with `ORDER BY ... ordinality` for constraint column arrays.
- Do not weaken schema assertions to avoid catalog typing errors.

Known internal `"char"` fields to check include `pg_constraint.contype`, `pg_constraint.confupdtype`, `pg_constraint.confdeltype`, `pg_constraint.confmatchtype`, `pg_class.relkind`, `pg_class.relpersistence`, `pg_proc.prokind`, `pg_attribute.attidentity`, and `pg_attribute.attgenerated`.

## 6. PowerShell and Native-Process Hazards

- Avoid `$args` and `$pid` as parameter names; they collide with PowerShell automatic variables.
- Use `UseShellExecute=false`.
- Drain stdout and stderr concurrently.
- Use finite timeouts and process-tree termination.
- Write progress files for long-running native processes.
- Treat native process exit codes as authoritative.
- Do not use `Start-Process -ArgumentList` for database runners where output and exit handling must be deterministic.

## 7. psql Output and CONTROL-Row Rules

- Use `-X -w -q -A -t -v ON_ERROR_STOP=1` for deterministic inspection output.
- Prefix machine-readable rows with `CONTROL|`.
- Strip leading BOM and trim CRLF/LF lines.
- Require exactly one CONTROL row.
- Persist sanitized stdout/stderr excerpts on failure.
- Do not parse NOTICE output as failure when psql exit code is zero.

## 8. Migration-Session and pg_temp Rules

- Build the exact ordered migration list before generating a runner.
- Strip only approved top-level transaction wrappers.
- Do not remove transaction words inside strings, comments, dynamic SQL, or function bodies.
- Audit `pg_temp` function identities across the full session.
- Suffix migration-private helpers when migrations share a psql session.

## 9. Generated-Artifact and Hash Rules

- Generated SQL, runner, manifest, and execution script are commit-specific.
- Record source hashes and generated hashes.
- Verify hashes before execution.
- Never patch generated SQL independently of source and regeneration.
- Treat stale commit artifacts as evidence only, not executable candidates.

## 10. Evidence-Preservation Requirements

- Write sanitized failure evidence before deleting temp directories.
- Preserve first PostgreSQL/psql error, native exit code, timeout status, CONTROL candidate count, cleanup status, and accepted=false.
- Do not include secrets, connection strings, pgpass paths, target hostnames, database names, usernames, backend PIDs, or full activity query text in sanitized evidence.
- Confirm password-file deletion and PostgreSQL environment cleanup.

## 11. Offline and Local Integration Requirements

- Offline validation must cover AST parsing, static mutation scan, runner/include absence, catalog-type regression fixtures, CONTROL parser fixtures, high-volume stdout/stderr capture, timeout handling, sanitized evidence, pgpass cleanup, and environment cleanup.
- Static checks are not enough for production-bound catalog SQL.
- Add a disposable local integration mode that executes the exact generated SQL against representative schema/data before production.
- Local integration must verify identity, exact host/port/version, disposable database name, one CONTROL row, read-only transaction state, zero timeout, and cleanup.

## 12. Production Execution Restrictions

- Agents must not connect to production unless a task explicitly authorizes that exact action.
- Agents must not request, receive, print, or store production passwords.
- Production runs must be user-executed with explicit approval for the exact script, commit, hashes, and environment.
- Rollback-only rehearsals must leave pre/post schema and control state unchanged.
- Read-only recovery inspections must execute no DDL, DML, migration include, runner include, advisory lock acquisition, or session termination.

## 13. Mandatory Pre-Generation Checklist

- Read source-of-truth documents.
- Verify branch and exact commit.
- Identify local and target PostgreSQL versions.
- Enumerate migrations in execution order.
- Scan `pg_temp` identities.
- Inspect PostgreSQL catalog types.
- Cast `name` and internal `"char"` values explicitly.
- Verify transaction-wrapper rules.
- Scan prohibited non-transactional statements.
- Design deterministic psql output.
- Design failure evidence before cleanup.
- Plan offline validation.
- Plan disposable local runtime validation.
- Assign commit-specific artifact names and hashes.

## 14. Mandatory Pre-Execution Checklist

- Verify branch, HEAD, remote branch, and main hashes.
- Verify clean tracked and staged state.
- Verify artifact hashes.
- Verify target identity.
- Verify expected PostgreSQL major.
- Confirm TLS where required.
- Confirm protected flags false.
- Confirm canonical `platform_settings` contract.
- Confirm no lingering rehearsal session.
- Confirm timeouts and process-tree handling.
- Confirm expected markers.
- Confirm rollback requirements.
- Confirm schema fingerprint expectations.
- Confirm pgpass cleanup.
- Confirm environment cleanup.
- Confirm explicit approval for the exact environment and step.

## 15. Future-Agent Handover Template

- Task:
- Branch:
- HEAD:
- Parent:
- Target environment:
- PostgreSQL version:
- Exact migration order:
- Approved files:
- Prohibited actions:
- Source hashes:
- Generated hashes:
- Known schema facts:
- Protected flags:
- Offline validation:
- Local integration validation:
- Unresolved risks:
- Latest exact error:
- Cleanup state:
- Next authorized step:

## 16. Change Log

- 2026-08-05: Initial lessons-learned document created from Commit 16 migration, rehearsal, and recovery work.
- 2026-08-05: Added `VALIDATION-002` and `GIT-001` from read-only recovery preflight contract and tracked runbook restoration handling.
- 2026-08-05: Added `VALIDATION-003` and `PS-002` from merchant-FK baseline/canonical recovery correction and StrictMode collection handling.
- 2026-08-05: Added `VALIDATION-004` from negative fixture setup failure in the local recovery integration matrix.
- 2026-08-05: Added `VALIDATION-005` from missing actual FK delete-action CONTROL field in the recovery script.
- 2026-08-05: Added `VALIDATION-006` from fixture manifest disagreement with generated SQL field semantics.
- 2026-08-05: Added `VALIDATION-007` from merchant FK shape being mistaken for complete merchant-linkage compatibility.
- 2026-08-05: Added `MIGRATION-001` from Migration 009 rejecting an exact legacy invoice FK before it could normalize it.
- 2026-08-05: Added `VALIDATION-008` from non-aggregated referenced-table catalog columns being placed in HAVING.
- 2026-08-05: Added `ARTIFACT-002` from a generated rollback-only rehearsal wrapper omitting the production-proof contract.
- 2026-08-07: Added `ARTIFACT-005` after finalized manifest migration paths passed static review but failed the production wrapper's exact artifact validator.

## VALIDATION-004 - Negative Fixture Failed During Setup

Exact symptom:

`Local fixture setup failed: wrong-referenced-table`

Root cause:

The negative fixture was intended to create a valid but semantically wrong foreign key. Its supporting schema was not sufficiently validated, so fixture creation failed before the recovery query could inspect and reject the intended condition.

Durable rule:

A negative integration fixture must be structurally valid and reach the code under test. Setup failure is not evidence that the inspected contract correctly rejected the fixture.

Required regression:

- Validate setup exit code separately.
- Execute the complete inspection SQL.
- Require exactly one CONTROL row.
- Assert rejection based on the intended classification.
- Structurally audit referenced tables, columns, types, uniqueness, and setup order before local execution.

## VALIDATION-005 - Required Actual CONTROL Field Conditionally Omitted

Exact symptom:

`Unexpected wrong-fk-name CONTROL value for merchant_fk_delete_action_actual: <missing>`

Root cause:

An actual-state field was calculated or serialized through a narrower expected, compatible, or canonical FK candidate path. A valid but differently named FK produced no value, causing the required CONTROL key to disappear.

Unsafe assumption:

Actual-state reporting was assumed to share the same candidate set as compatibility classification.

Durable rule:

Actual state, compatibility, canonical state, and final acceptance must be calculated independently.

Every CONTROL row must have a fixed key set and explicit sentinels for:

- zero candidates
- one candidate
- multiple candidates
- absent metadata
- unsupported or unknown values

Required regression:

- Every fixture passes through the real parser and assertion helper.
- Exact key-set validation.
- Missing key rejection.
- Duplicate key rejection.
- Empty value rejection.
- Invalid enum rejection.
- `NONE` state.
- `MULTIPLE` state.
- Every supported delete action.
- Wrong-name fixture still reports the actual delete action.
- Generated SQL proves non-NULL serialization for all cardinalities.

## VALIDATION-006 - Fixture Manifest Disagreed With SQL Field Semantics

Exact symptom:

`Unexpected wrong-fk-name CONTROL value for merchant_fk_conflicting_count: 1`

Root cause:

The generated SQL and fixture manifest used different meanings for `merchant_fk_conflicting_count`. Offline mocked fixtures reused the manifest's incorrect expectation, so the mocked parser and assertion tests were internally consistent but did not prove agreement with actual generated SQL behavior.

Durable rule:

Every derived CONTROL field must have one explicitly documented semantic definition. Fixture manifests, mocks, local assertions, and generic invariants must share that definition. Mocked values must also be tested against cross-field invariants so self-consistent but logically impossible expectations fail offline.

Required regression:

- Complete 18-fixture truth table.
- Generic cross-field invariants.
- Mutated conflicting-count failure tests.
- Compatible-with-conflict rejection.
- Accepted-without-compatibility rejection.
- Local SQL output compared against the same authoritative manifest.

## VALIDATION-007 - FK Shape Mistaken for Complete Merchant-Linkage Compatibility

Exact symptom:

The `merchant-id-not-null` fixture reported a correct-looking FK shape while still being rejected overall:

- `candidate_count=1`
- `expected_named_count=1`
- `exact_reference_count=1`
- `conflicting_count=0`
- `all_candidates_validated=true`
- `delete_action_actual=CASCADE`
- `merchant_fk_pre_migration_compatible=true`
- `merchant_fk_canonical_already=true`
- `recovery accepted=false`

Root cause:

The derived merchant FK compatibility fields drifted from complete column-plus-constraint compatibility into FK-constraint-shape compatibility only. The final recovery acceptance gate still required the full merchant linkage contract, so the truth table contradicted itself.

Durable rule:

Do not let a correct FK constraint override incompatible column metadata. `merchant_fk_pre_migration_compatible=true` requires the `merchant_id` column to exist, be `uuid`, be nullable, and have exactly one expected named validated FK to `public.merchants(id)` with no conflicts and a supported delete action. `merchant_fk_canonical_already=true` additionally requires the compatible FK to use `ON DELETE CASCADE`.

Canonical status cannot be true when `payment_events.merchant_id` is `NOT NULL`, missing, or not `uuid`.

Required regression:

- Truth-table fixtures include merchant_id type and nullability.
- SQL serialization for compatibility combines column metadata with FK shape.
- Mutated maps prove `compatible=true`, `canonical=true`, and final acceptance fail when `merchant_id` is missing, not `uuid`, or not nullable.

## MIGRATION-001 - Canonical-Only Invoice FK Assertion Rejected Safe Legacy NO ACTION State

Exact symptom:

`Migration A compatibility failure: payment_events.payment_events_invoice_id_fkey expected=on delete SET NULL actual=NO ACTION`

The production rollback-only rehearsal stopped in Migration 009 after Migrations 006, 007, and 008 passed inside the outer transaction. The subsequent read-only production recovery verification passed, confirming no durable production change remained after rollback.

Root cause:

Migration 009 asserted only the final canonical delete action for `payment_events_invoice_id_fkey` before allowing a known exact legacy constraint to be normalized.

Unsafe assumption:

A production constraint must already have the final canonical delete action before the migration responsible for canonicalizing it can run.

Durable rule:

Migrations that normalize legacy metadata must explicitly distinguish exact accepted legacy state, canonical-already state, unexpected state, and final canonical assertion. Only the exact proven legacy state may be normalized. Ambiguous states must fail closed.

Required regression:

- Exact legacy `NO ACTION` normalization.
- Canonical `SET NULL` idempotency.
- Wrong-name, wrong-reference, cardinality, and validation rejection.
- Unsupported action rejection.
- `NOT NULL` rejection.
- Data preservation.
- Rollback restoration.
- Second execution idempotency.

## VALIDATION-008 - Non-Aggregated Catalog Columns Used in HAVING

Symptom:

The real PostgreSQL 15 harness failed in `phase2_breet_payment_substrate_reconciliation.sql` because `ref_ns.nspname` and `ref_cls.relname` were referenced in `HAVING` without aggregation or inclusion in `GROUP BY`.

Root cause:

Row-level referenced-table filters were incorrectly placed in the aggregate `HAVING` clause.

Durable rule:

Catalog identity predicates belong in `WHERE`. `HAVING` is reserved for aggregate conditions unless every directly referenced column is grouped. SQL assertion queries must be executed against real PostgreSQL before production rehearsal.

Regression:

- Exact assertion block inspection.
- PostgreSQL local harness execution.
- Canonical invoice FK assertion.
- Legacy `NO ACTION` normalization assertion.
- Rerun idempotency.
