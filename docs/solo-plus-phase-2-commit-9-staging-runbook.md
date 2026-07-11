# Commit 9 Manual Staging Workflow

Commit 9 staging remains manually operated.

1. Run the read-only preflight first.
2. Stop immediately if `overall_preflight_status = FAIL`.
3. Paste the compact preflight output back for review before applying anything.
4. Run the local disposable PostgreSQL harness, including the hostile/default-drift scenarios.
5. Apply the staging wrapper manually with `ON_ERROR_STOP=1` from your own terminal. The migration owns its own transaction with internal `BEGIN`/`COMMIT`, so do not add `-1` or `--single-transaction`.
6. Run the read-only postflight verification immediately after apply.
7. Paste the compact apply and postflight output back for review.
8. Do not commit Commit 9 until staging verification passes.

Example manual sequence:

```powershell
$env:PGSSLMODE = "require"

psql -X -v ON_ERROR_STOP=1 -f .\supabase\staging\preflight\011_solo_plus_review_decision_rpc_snapshot.sql

# Stop here if overall_preflight_status = FAIL.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-breet-solo-plus-migrations.ps1

psql -X -v ON_ERROR_STOP=1 -f .\supabase\staging\011_solo_plus_review_decision_rpc.sql

psql -X -v ON_ERROR_STOP=1 -f .\supabase\staging\postflight\011_solo_plus_review_decision_rpc_verify.sql
```

Use your own connection environment variables or local `psql` defaults. Do not put credentials in this file.

Important:

* the wrapper path remains `supabase/staging/011_solo_plus_review_decision_rpc.sql`;
* the migration owns its own transaction through internal `BEGIN`/`COMMIT`;
* do not rerun a failed apply blindly;
* do not reapply the wrapper or migration after a successful postflight;
* do not create `supabase_migrations.schema_migrations`;
* do not write to `public.plan_migrations`;
* do not modify the `auth`, `realtime`, or `storage` migration tables.
