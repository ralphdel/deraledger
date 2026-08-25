# Migration 027 local disposable rehearsal runbook

Migration 027 is a cleanup-only replacement for the Migration 026 approval RPC. It must be rehearsed only on a disposable local PostgreSQL database; it is forbidden to run it against staging, production, or any Supabase project.

From the repository root, after independently reviewing the source package, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/rehearse-reviewed-profile-approval-rpc-local.ps1 -LocalConnectionString '<local disposable connection string>' -Confirmation 'REHEARSE MIGRATION 026 LOCAL DISPOSABLE DB ONLY' -Execute
```

The harness rejects non-local, staging, production, Supabase, credential-bearing, and non-disposable targets. It applies prerequisites, M024, M025, M026, then M027 twice; runs the M026 and M027 checks; and retains external fixture/protocol probes and all 29 approval, replay, rollback, hostile-role, and forbidden-write scenarios. A concurrent identical or stale replay may fail closed on row version.

Treat any `FAIL`, SQL error, or missing final `CONTROL|LOCAL_APPROVAL_REHEARSAL=PASS` as a rehearsal failure. Do not use staging or production as a substitute.

The M027 grant checks use effective privileges for `service_role`, `anon`, and `authenticated`, plus a direct ACL check for the PUBLIC pseudo-role. They intentionally do not treat owner or grantor metadata as an additional runtime execute grantee.
