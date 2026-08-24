# PRD Phase 2 Bootstrap RPC Disposable Rehearsal Runbook

This harness is local-only. It is forbidden to run it against staging, production, any Supabase project, or with a Supabase URL/key.

## Preconditions

- A disposable local PostgreSQL database whose name includes `rehearsal`, `disposable`, or `local`.
- A passwordless local `psql` path; the harness rejects password-bearing strings and never prints its connection string.
- An explicit confirmation phrase and `-Execute` switch.

## Guarded invocation

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\rehearse-reviewed-profile-bootstrap-rpc-local.ps1 `
  -LocalConnectionString 'postgresql://localhost/deraledger_rehearsal' `
  -Confirmation 'REHEARSE LOCAL DISPOSABLE DB ONLY' `
  -Execute
```

Without `-Execute`, the harness validates only its local target guard and performs no database work.

## What it validates

- local-only host/database naming and confirmation guard;
- disposable prerequisites plus Migration 024 baseline;
- Migration 025 preflight, first apply, rerun idempotency, and postflight;
- service-role-only RPC grants/security shape;
- Solo Lite, Business, and Solo Plus case-binding behavior;
- Solo Plus has no compliance review row;
- replay behavior and fail-closed bootstrap state;
- all behavior writes occur in an outer transaction that ends in `ROLLBACK`.

The harness must be extended with isolated hostile duplicate and injected late-failure scenarios before it can be treated as a complete migration gate. It never authorizes staging, production, activation, collection, payments, providers, or route adoption.
