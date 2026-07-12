# Database Migration and Staging Safety Runbook

## 1. Purpose

This document defines the mandatory workflow for designing, testing, auditing and applying database migrations in the DeraLedger repository.

It applies to:

* PostgreSQL and Supabase migrations;
* staging wrappers;
* database RPCs;
* tables, indexes, constraints and triggers;
* RLS policies and grants;
* migration repair logic;
* staging drift detection;
* disposable database harnesses;
* preflight and postflight verification.

The primary goals are:

1. protect staging and production data;
2. detect all migration blockers before staging;
3. prevent agents from applying database changes without direct user control;
4. avoid fail-fix-rerun loops that expose one PostgreSQL issue at a time;
5. reduce token usage by returning compact diagnostic output;
6. make every migration auditable, reproducible and fail-closed.

---

# 2. Non-negotiable operating rules

## 2.1 Agent restrictions

Agents must not:

* connect to staging unless explicitly instructed;
* run staging SQL;
* apply migrations to staging;
* apply migrations to production;
* use production credentials;
* commit or push before authorization;
* deploy database changes;
* enable feature flags;
* silently repair staging drift;
* weaken RLS, grants or policy assertions;
* change expected catalog values merely to make tests pass;
* convert strict equality checks into loose substring checks;
* patch one harness failure at a time before collecting all failures;
* assume that local schema state matches staging;
* treat scratch SQL as canonical migration history.

Agents may:

* inspect repository files;
* create migration files;
* create staging wrappers;
* create read-only preflight scripts;
* create read-only postflight scripts;
* create disposable PostgreSQL tests;
* create hostile-drift simulations;
* run local application tests;
* run disposable local PostgreSQL tests when permitted;
* interpret terminal output supplied by the user.

## 2.2 User-controlled operations

The user personally controls:

* staging database credentials;
* staging preflight execution;
* staging migration execution;
* staging postflight execution;
* production migration execution;
* approval to commit;
* approval to push;
* approval to deploy.

No agent-generated migration is considered applied merely because local tests pass.

---

# 3. Required migration workflow

Every migration must pass through the following stages.

## Stage 0: Source-of-truth review

Before coding, the agent must identify and review:

1. the primary PRD;
2. the implementation plan;
3. existing canonical migrations;
4. existing staging wrappers;
5. affected tables and RPCs;
6. existing security conventions;
7. previous related migration tests.

The agent must report:

* the intended scope;
* out-of-scope behavior;
* existing invariants;
* expected security state;
* expected rollback behavior;
* expected staging dependencies.

No migration work should start until this scope is explicit.

---

## Stage 1: Read-only repository discovery

The agent must inspect the repository before writing SQL.

Required searches include:

* existing table definitions;
* duplicate or historical migrations;
* scratch SQL;
* generated database types;
* existing RPC signatures;
* existing indexes and constraints;
* RLS policy definitions;
* privilege grants;
* default privilege handling;
* staging wrapper order;
* migration harness behavior;
* related application repositories;
* service-role usage;
* browser-role access;
* rollback and idempotency tests.

The agent must distinguish:

* canonical committed schema;
* scratch or experimental schema;
* runtime assumptions not backed by migrations;
* staging-only drift;
* obsolete migration definitions.

Scratch SQL is never automatically treated as canonical.

---

## Stage 2: Read-only staging drift snapshot

Before a migration is applied, the user must run a read-only staging preflight script.

The agent prepares the script but does not execute it against staging.

The snapshot must report:

### Database identity

* current database;
* current user;
* PostgreSQL version;
* current search path.

It must not print:

* passwords;
* connection strings;
* access tokens;
* service-role secrets.

### Object existence

For all affected tables, functions, indexes and policies:

* existence;
* schema;
* owner;
* exact identity;
* unexpected duplicates or overloads.

### Table structure

For every affected table:

* columns;
* data types;
* defaults;
* nullability;
* check constraints;
* foreign keys;
* unique constraints;
* indexes;
* index predicates;
* triggers;
* RLS enabled state;
* forced RLS state;
* policies;
* grants.

### Function structure

For every affected RPC:

* exact signature;
* identity arguments;
* return type;
* owner;
* security mode;
* search path;
* execute privileges;
* definition hash;
* unexpected overloads.

### Security state

Report:

* PUBLIC grants;
* anon grants;
* authenticated grants;
* service_role grants;
* default table privileges;
* default sequence privileges;
* default function privileges.

### Compact output requirement

The preflight must output only:

* `PASS`;
* `WARN`;
* `FAIL`;
* one final summary.

Successful catalog rows should not be dumped individually.

The final row must include:

* prerequisite schema status;
* security manifest status;
* function status;
* default privilege status;
* migration compatibility status;
* overall preflight status.

No staging migration may proceed when the preflight returns `FAIL`.

---

# 4. Drift classification

Every discovered staging difference must be classified before DDL runs.

## 4.1 Repairable drift

A migration may repair drift only when the canonical desired state is unambiguous.

Examples include:

* required RPC is absent;
* exact-signature RPC has an outdated definition;
* exact-signature RPC has an unsafe search path;
* PUBLIC has an unintended function privilege;
* anon has an unintended function privilege;
* authenticated has an unintended function privilege;
* service_role lacks an intended execute privilege;
* a canonical RLS setting is disabled;
* canonical browser-role grants are broader than committed migrations allow;
* Supabase default grants recreate privileges that canonical migrations explicitly revoke.

Repairable drift must still be:

* detected explicitly;
* logged;
* tested in the disposable harness;
* repaired transactionally;
* verified after repair.

## 4.2 Unsafe drift

The migration must fail before DDL when it detects:

* missing prerequisite tables;
* incompatible column types;
* incompatible constraints;
* incompatible enum or check values;
* incompatible idempotency uniqueness;
* unknown or conflicting RPC overloads;
* unexpected triggers affecting the migration workflow;
* ambiguous object ownership;
* destructive schema differences;
* drift requiring data rewriting;
* drift requiring dropped columns;
* drift requiring guessed business behavior;
* security state with no committed canonical manifest;
* table structure that cannot be repaired without potential data loss.

Unsafe drift must never be silently repaired.

All unsafe-drift checks must run before:

* `CREATE TABLE`;
* `ALTER TABLE`;
* `CREATE OR REPLACE FUNCTION`;
* grants;
* revokes;
* policy changes;
* trigger changes.

---

# 5. Migration design requirements

Every migration must be:

* narrow;
* transactional;
* rerunnable where the repository convention requires it;
* fail-closed;
* explicit about privileges;
* explicit about search path;
* explicit about dependencies;
* free of unrelated schema repair.

A migration must not rely on application code to enforce database integrity that should be transactional.

For business-critical mutations, one transaction must own:

1. row locking;
2. state validation;
3. row-version validation;
4. idempotency checks;
5. business mutation;
6. audit-event persistence;
7. rollback on failure.

---

# 6. Security manifest requirements

Every affected table and RPC must have a documented security manifest.

## 6.1 Table security manifest

For each table, record:

* RLS enabled;
* RLS forced;
* policy names;
* policy commands;
* policy roles;
* policy `USING` expressions;
* policy `WITH CHECK` expressions;
* PUBLIC privileges;
* anon privileges;
* authenticated privileges;
* service_role privileges;
* relevant triggers.

## 6.2 RPC security manifest

For each RPC, record:

* exact signature;
* owner;
* `SECURITY INVOKER` or `SECURITY DEFINER`;
* hardened search path;
* PUBLIC execute state;
* anon execute state;
* authenticated execute state;
* service_role execute state;
* expected return type;
* expected overload count.

For service-role-only functions:

* revoke from PUBLIC;
* revoke from anon;
* revoke from authenticated;
* grant execute only to service_role.

Security must be asserted after migration application because default privileges can recreate unsafe access.

---

# 7. Disposable hostile-state harness

No staging execution is allowed until the disposable PostgreSQL harness passes.

The harness must simulate all relevant states independently.

Required scenarios include:

1. missing prerequisite tables;
2. canonical prerequisite tables;
3. incompatible prerequisite tables;
4. missing required columns;
5. incompatible column types;
6. incompatible constraints;
7. incompatible indexes;
8. incompatible partial-index predicates;
9. disabled RLS;
10. forced-RLS drift;
11. missing policies;
12. incompatible policies;
13. broad PUBLIC grants;
14. broad anon grants;
15. broad authenticated grants;
16. missing service_role grants;
17. Supabase default table grants;
18. Supabase default sequence grants;
19. Supabase default function grants;
20. pre-existing canonical RPC;
21. pre-existing outdated RPC;
22. unsafe RPC privileges;
23. unexpected RPC overload;
24. clean first apply;
25. rerun and idempotency;
26. injected migration late failure;
27. business-operation late failure;
28. rollback of DDL;
29. rollback of grants;
30. rollback of business mutation;
31. preservation of earlier migration behavior.

Each scenario must assert:

* expected success or failure;
* actual success or failure;
* final object state;
* final security state;
* cleanup success.

A scenario must not contaminate the next scenario.

Use:

* a fresh disposable database;
* a fresh isolated schema where valid;
* or a transaction guaranteed to roll back.

---

# 8. Collect-all diagnostic mode

## 8.1 When to use it

Collect-all mode is mandatory when:

* failures are being discovered sequentially;
* PostgreSQL catalog rendering differs from expected text;
* one assertion failure prevents later checks from running;
* repeated fix-and-rerun cycles have begun;
* more than one catalog or policy comparison exists.

The agent must stop patching individual failures and produce one consolidated diagnostic.

## 8.2 Required behavior

Collect-all mode must:

* run every scenario;
* continue after failures;
* isolate every scenario;
* record all failed checks;
* distinguish rendering differences from semantic differences;
* output one compact report;
* leave normal fail-fast mode unchanged.

## 8.3 Required summary format

```text
POSTGRES_DIAGNOSTIC_STATUS=PASS|FAIL
TOTAL_SCENARIOS=
PASSED_SCENARIOS=
FAILED_SCENARIOS=
TOTAL_FAILED_CHECKS=
```

Each failure must contain:

```text
FAIL_ID:
SCENARIO:
OBJECT:
CHECK:
EXPECTED:
ACTUAL:
LIKELY_CLASS:
SOURCE_FILE:
SOURCE_LINE:
```

Permitted failure classifications include:

* whitespace_rendering;
* redundant_outer_parentheses;
* same_schema_qualification;
* cast_rendering;
* array_catalog_type;
* policy_expression_difference;
* index_predicate_difference;
* constraint_definition_difference;
* privilege_difference;
* RLS_difference;
* schema_difference;
* actual_semantic_mismatch;
* harness_isolation_failure;
* rollback_failure.

No SQL expectation should be changed until the consolidated report has been reviewed.

---

# 9. PostgreSQL catalog normalization rules

PostgreSQL may render expressions differently from source SQL.

Normalization must remain narrow and semantics-preserving.

## 9.1 Permitted normalization

The following may be normalized when proven equivalent:

* insignificant whitespace;
* line breaks;
* redundant outer parentheses surrounding the entire expression;
* omission of `public.` for same-schema objects;
* explicit casts PostgreSQL adds during deparsing;
* catalog array type differences such as `name[]` versus expected `text[]`, using an explicit cast before strict comparison.

## 9.2 Forbidden normalization

Do not:

* remove arbitrary inner parentheses;
* change operator precedence;
* strip all schema names;
* use broad regular expressions that hide semantic differences;
* reduce structural equality to substring matching;
* ignore policy roles;
* ignore policy commands;
* ignore join conditions;
* ignore index predicates;
* ignore casts that change semantics;
* treat a different object name as equivalent;
* modify expected values merely to make the test pass.

Every normalization helper must have focused tests.

---

# 10. Manual PostgreSQL execution model

The user runs PostgreSQL commands.

Agents prepare commands but do not execute staging SQL.

## 10.1 Local disposable diagnostic

The user runs the local disposable harness and provides:

* final summary;
* all failed-check blocks;
* no unnecessary successful output.

## 10.2 Staging preflight

The user runs the read-only preflight manually.

Required options:

* no user startup file;
* stop on first SQL execution error;
* no credentials printed;
* output captured to a local text file.

Example:

```powershell
psql "$env:STAGING_DATABASE_URL" `
  -X `
  -v ON_ERROR_STOP=1 `
  -f ".\supabase\staging\preflight\<migration>_snapshot.sql" |
  Tee-Object ".\<migration>-staging-preflight.txt"
```

Only the final summary and `WARN` or `FAIL` lines should be shared.

## 10.3 Staging apply

The migration may be applied only when:

* collect-all diagnostics have zero failures;
* normal fail-fast harness passes;
* application tests pass;
* typecheck passes;
* build passes;
* preflight has no unsafe drift;
* the migration has been audited.

Example:

```powershell
psql "$env:STAGING_DATABASE_URL" `
  -X `
  -v ON_ERROR_STOP=1 `
  --single-transaction `
  -f ".\supabase\staging\<migration-wrapper>.sql" |
  Tee-Object ".\<migration>-staging-apply.txt"
```

The wrapper must first be confirmed compatible with `--single-transaction`.

## 10.4 Staging postflight

After application, the user runs the read-only postflight script.

Example:

```powershell
psql "$env:STAGING_DATABASE_URL" `
  -X `
  -v ON_ERROR_STOP=1 `
  -f ".\supabase\staging\postflight\<migration>_verify.sql" |
  Tee-Object ".\<migration>-staging-postflight.txt"
```

The postflight must verify:

* object signatures;
* function hash;
* search path;
* security mode;
* grants;
* RLS state;
* policies;
* prerequisite schema;
* earlier RPCs;
* absence of unexpected objects;
* migration-history evidence.

---

# 11. Application validation

After SQL changes, run:

```text
npm run test:<feature>
npx tsc --noEmit
npm run build
git diff --check
```

Also run:

* focused route or service tests;
* repository tests;
* orchestration tests;
* access-control tests;
* RPC mapping tests;
* error-mapping tests.

The test script must:

* include every relevant file;
* fail immediately when a test fails;
* not silently omit tests;
* not remove earlier regression tests.

---

# 12. Token-minimization protocol

To reduce unnecessary agent token use:

1. The user runs verbose PostgreSQL commands locally.
2. Full logs stay in local files.
3. Only compact summaries are returned.
4. Successful rows are not pasted.
5. Only `WARN`, `FAIL`, and final status lines are shared.
6. Collect-all diagnostics are preferred over repeated fail-fast debugging.
7. The agent fixes all confirmed issues in one batch.
8. The user reruns the same diagnostic once.
9. Normal fail-fast verification runs only after collect-all reaches zero failures.
10. Staging output is reviewed in three compact stages:

    * preflight summary;
    * apply output;
    * postflight summary.

The agent must not request the entire log unless the compact failure block lacks enough evidence.

---

# 13. Permission checkpoints

Agents must stop and request permission before:

* modifying a migration after audit;
* adding repair logic;
* changing security manifests;
* changing RLS or grants;
* connecting to staging;
* applying staging SQL;
* committing;
* pushing;
* deploying.

Permission for one action does not authorize the next action.

Examples:

* permission to edit the migration does not authorize staging apply;
* permission to run local tests does not authorize database connection;
* permission to prepare a command does not authorize running it;
* permission to apply staging does not authorize production;
* permission to commit does not authorize push.

---

# 14. Required exit criteria

## 14.1 Ready for manual staging preflight

A migration is ready for manual preflight only when:

* source-of-truth alignment passes;
* collect-all PostgreSQL diagnostic reports zero failures;
* normal fail-fast harness passes;
* hostile/default-grant harness passes;
* rollback tests pass;
* application tests pass;
* typecheck passes;
* build passes;
* diff check passes;
* preflight script exists;
* postflight script exists;
* no agent has connected to staging.

## 14.2 Ready for staging apply

A migration is ready for staging apply only when:

* manual preflight passes;
* no unsafe drift exists;
* all repairable drift is understood;
* migration transaction behavior is confirmed;
* security manifest is confirmed;
* exact apply command is reviewed.

## 14.3 Ready for commit

A migration is ready for commit only when:

* staging apply succeeds;
* staging postflight passes;
* no partial state remains;
* exact migration history is confirmed;
* application validation remains green;
* final audit reports no blocker;
* the user explicitly authorizes commit.

---

# 15. Mandatory agent response format

## 14.4 Batch Failure Discovery and Full Validation Gate

Every migration-backed feature must use a batch failure-discovery gate before repair work continues after the first failed validation.

### 14.4.1 No whack-a-mole validation

Run the complete applicable validation matrix and collect all independent failures before repairing implementation code or SQL.

Do not repeatedly:

* run one long pipeline;
* stop at the first failure;
* patch one symptom;
* rerun the entire pipeline only to expose the next failure.

### 14.4.2 One canonical command

Each migration-backed commit must expose one documented repository command that runs the full local validation gate, including:

* application tests;
* focused feature tests;
* typecheck;
* build;
* migration manifest checks;
* disposable bootstrap;
* SQL regression suites;
* hostile grant/default-privilege scenarios;
* rerun checks;
* rollback checks;
* final git checks.

Example:

```powershell
npm run validate:solo-plus:commit
```

### 14.4.3 Failure classifications

Every check in the gate must report exactly one of:

* `PASS`
* `FAIL`
* `BLOCKED`
* `SKIPPED`

Blocked checks must never be reported as passing.

### 14.4.4 Dependency-aware continuation

The orchestrator must continue after independent failures.

When a prerequisite fails:

* dependent checks must not run against unreliable state;
* dependent checks must be marked `BLOCKED`;
* the final summary must still include them.

Within one SQL scenario, keep `ON_ERROR_STOP=1` so that unreliable scenario state fails fast. Across scenarios, continue collecting failures.

### 14.4.5 Fresh-state isolation

Every major SQL regression or hostile scenario must run in:

* a fresh disposable database;
* a fresh disposable schema;
* or a transaction with proven rollback isolation.

Shared fixture state must not leak between scenarios.

### 14.4.6 Root-cause batching

After the first full gate run:

1. group failures by likely root cause;
2. fix root causes in batches;
3. rerun the full gate;
4. repeat only when a subsequent full run exposes genuinely new failures.

### 14.4.7 Local-only proof

Destructive, reset-based and hostile validation must reject non-local database targets.

Validation must:

* parse the real connection string;
* prove the host is local/disposable;
* redact credentials in output;
* refuse staging or production URLs;
* fail closed before reset operations when locality is uncertain.

### 14.4.8 Evidence handling

Validation logs should default to temporary or explicitly designated evidence directories, for example:

```text
$env:TEMP\deraledger-validation\<run-id>\
```

Generated logs must not silently enter commits.

### 14.4.9 Final gate requirement

A migration-backed change is not ready for review, staging or commit until the full validation gate returns:

* zero `FAIL`;
* zero unexpected `BLOCKED`;
* and a final non-zero exit is used whenever either condition is not met.

### 14.4.10 Exception reporting

When an environment limitation prevents a check:

* record the exact command;
* mark the result `BLOCKED` or `SKIPPED`;
* state the exact environment reason;
* do not claim full validation succeeded.

Expected summary format:

```text
PASS    APP-001  Solo Plus TypeScript tests
FAIL    DB-004   Commit 10 activation SQL assertions
BLOCKED DB-007   Commit 10 rollback harness
SKIPPED ENV-009  psql not available
```

Include:

* total checks;
* pass count;
* fail count;
* blocked count;
* skipped count;
* grouped root causes;
* exact failed commands;
* first relevant error excerpt;
* paths to full temporary logs;
* final exit status.

The full local validation gate supplements, but does not replace, migration-specific read-only staging preflight and postflight artifacts.

After local implementation, the agent must report:

1. source-of-truth documents reviewed;
2. migration files changed;
3. staging wrapper changed;
4. preflight file added;
5. postflight file added;
6. security manifests covered;
7. repairable drift handled;
8. unsafe drift rejected;
9. hostile scenarios tested;
10. collect-all diagnostic result;
11. fail-fast harness result;
12. rollback result;
13. application-test result;
14. typecheck result;
15. build result;
16. diff-check result;
17. confirmation no staging connection occurred;
18. remaining risks;
19. exact next manual command.

The agent must not claim that a migration is staging-safe solely because it passed locally.

---

# 16. Standard instruction for future migration agents

Use the following instruction at the beginning of future SQL migration tasks:

> Follow `docs/database-migration-and-staging-safety-runbook.md` as a mandatory execution policy. Do not connect to staging or apply SQL. Begin with source-of-truth review and read-only repository discovery. Build a drift-first migration, explicit security manifests, hostile/default-grant disposable tests, collect-all diagnostics and compact manual preflight/postflight scripts. Stop patching individual failures once sequential catalog issues appear; collect all failures before another fix. The user personally runs all staging PostgreSQL commands and supplies compact output. Do not commit, push or deploy without separate authorization.

---

# 17. Emergency stop conditions

Stop all migration work immediately when:

* a migration changes unrelated tables;
* destructive drift is discovered;
* object ownership is ambiguous;
* a canonical security manifest cannot be established;
* staging differs materially from committed schema;
* an unexpected overload exists;
* a trigger modifies the target workflow unexpectedly;
* a rollback test leaves partial state;
* collect-all mode shows semantic mismatches rather than rendering differences;
* default privileges restore browser-role access;
* staging credentials appear in logs;
* an agent connects to staging without permission;
* production state is referenced or changed.

At an emergency stop, return:

* the exact blocker;
* affected object;
* expected state;
* actual state;
* whether the state is repairable;
* the safest next read-only action.

Do not continue automatically.
