# Phase 2C B1+B2 staging database adoption gate

This gate installs only the frozen Phase 2C B1 and B2 database migrations needed by the B3 runtime. It does not deploy the application, invoke either compliance RPC, create fixtures, write migration-ledger rows, or touch production.

Run it from the repository root on the reviewed branch and commit:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\reconcile-phase2c-b1-b2-staging.ps1 -Confirmation 'APPLY PHASE2C B1 B2 TO STAGING'
```

The runner fixes the target to the staging Supabase pooler, port `5432`, database `postgres`, and pooler username containing project ref `fsjljliiyfchkwbjifzw`. It requires the reviewed PostgreSQL 15 `psql` client, staging PostgreSQL server major `17`, SQL `current_user=postgres`, the Supabase `auth.users` catalog, the reviewed branch, a clean tracked worktree/index, local HEAD parity with `origin/staging/phase-2-rebuild-safe-baseline`, and proof that reviewed B3 baseline `336d090a769a15b127e0101ff88bbfadaef77fae` is an ancestor of local HEAD. Existing untracked `.local-evidence/` is allowed; any other untracked path blocks execution.

The external Windows `psql` to Supabase/Supavisor pooler leg is fail-closed through process-scoped `PGSSLMODE=require`; `PGGSSENCMODE=disable` prevents GSS encryption from substituting for SSL. The runner restores both variables and all other managed libpq variables in `finally`. Successful connection under this configuration is the enforcement proof, while `\conninfo` is recorded only as non-secret diagnostic evidence. `pg_stat_ssl` is also recorded as `backend_ssl=true|false`, but it describes the pooler-to-PostgreSQL connection visible to the backend and never blocks this gate. Supabase SSL Enforcement for that second leg is a separate operational/security gate and is not changed or claimed by this runner.

The operator enters the staging database password once. The password exists only in process memory and the child `psql` environment for this run. The runner restores the prior libpq process environment and clears its BSTR in `finally`. It never writes the password or a connection URI to evidence.

Before mutation, the gate verifies the two migration SHA-256 values and records bounded identity, connection, required-role, prerequisite-table, migration-ledger, and object-state facts. It then classifies B1 and B2 as `ABSENT`, `EXACTLY_INSTALLED`, `PARTIALLY_INSTALLED`, or `INCOMPATIBLE`, and checks the prerequisite schema, constraints, RLS, ACLs, roles, migration-owner authority, and trigger posture. Exact installation requires the reviewed function signatures and normalized body hashes, owner, language, return type, `SECURITY DEFINER` posture, hardened `search_path`, execute ACLs, direct review-UPDATE denial, and the B1 immutability trigger.

The existing `public.merchants` ACL is staging baseline state. Before apply, the gate computes a deterministic SHA-256 fingerprint from the relation owner and sorted `aclexplode` rows (grantor, grantee, privilege, and grantability). The runner validates that fingerprint and passes it explicitly to the B1 postflight, B2 postflight, and final check because Supavisor sessions are independent. Any change blocks as `BLOCKED|merchants_acl_changed`; the gate never grants, revokes, or repairs merchant privileges. Staging currently gives `service_role` broad direct privileges on `public.merchants`, including `UPDATE`. That access predates B1/B2 and is separate least-privilege security debt: this deployment preserves it and proves the frozen RPC bodies introduce no merchant mutation path, but does not characterize the existing access as ideal.

`EXACTLY_INSTALLED` is never reapplied. `ABSENT` is applied in B1-then-B2 order using the frozen migration files. `PARTIALLY_INSTALLED`, `INCOMPATIBLE`, a ledger-name mismatch, or a ledger record with absent objects blocks the run. The gate does not insert, update, delete, or repair `supabase_migrations.schema_migrations`; an exact object installation without a ledger row is recorded as observed state and left unchanged. Any future ledger reconciliation requires its own reviewed gate.

After each apply or exact-installed decision, the runner repeats catalog classification and runs its security postflight. The final check proves the three service-role RPCs remain tied to draft policy `2c-2b-draft-v1`, direct review UPDATE remains denied, the merchants ACL fingerprint is unchanged, and their reviewed bodies contain no profile, merchant, subscription, settlement, limits, assurance, or activation write path. No functional call or test row is created.

Evidence is written under `.local-evidence/phase2c-b1-b2-staging/<timestamp>/`:

- `00-environment.txt`
- `01-source-hashes.txt`
- `02-installed-state.txt`
- `03-preflight.txt`
- `04-b1-apply.txt` when B1 is applied
- `05-b1-postflight.txt`
- `06-b2-apply.txt` when B2 is applied
- `07-b2-postflight.txt`
- `08-final.txt`
- `summary.txt`

Do not stage evidence. A successful summary ends with `PASS|staging_b1_b2_database_gate_complete`. Any `BLOCKED|...` marker requires stopping; do not retry an apply after an ambiguous connection or postflight failure. Obtain a fresh read-only state review first.

After success, the next gate is an independently authorized B3 staging deployment and authenticated browser E2E against `https://deraledger-staging.vercel.app`. Production remains blocked.
