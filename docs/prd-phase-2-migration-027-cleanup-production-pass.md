# Migration 027 cleanup production pass

Date: 2026-08-25

Environment: production.

Evidence directory: `.\local-evidence\migration-027-production-20260825-140851`

Migration file: `supabase/migrations/20260825_01_cleanup_approval_rpc_diagnostics.sql`

Migration 027 production sequence is a full pass.

Preflight: PASS

First apply: PASS / COMMIT

Second apply / idempotency: PASS / COMMIT

Postflight: PASS

`rpc.diagnostics_removed`: PASS

Confirmed preflight:

- Migration 026 exact approval RPC exists.
- Migration 026 RPC is `SECURITY INVOKER` with hardened search path.
- No conflicting approval RPC overload exists.
- No effective `anon` / `authenticated` or explicit `PUBLIC` approval RPC EXECUTE grant exists.
- `service_role` has EXECUTE on the exact approval RPC signature.
- No browser/public compliance-table grants exist.
- Zero browser policies exist on compliance tables.
- Summary PASS.

Confirmed postflight:

- One exact 13-argument approval RPC exists.
- `SECURITY INVOKER` with hardened search path is preserved.
- No local diagnostic instrumentation remains in the RPC body.
- No effective `anon` / `authenticated` or explicit `PUBLIC` approval RPC EXECUTE grant exists.
- `service_role` has EXECUTE on the exact signature.
- No browser/public compliance-table grants exist.
- Zero browser policies exist.
- The migration created no compliance business rows.
- Summary PASS.

Explicit boundaries:

- No runtime adoption.
- No approval executed against real production data.
- No activation executed.
- No collection unlock.
- No provider / payment testing.
- No storefront work.
- Production safe state remains unchanged except RPC cleanup.

Next gate:

- Continue PRD Phase 2 with the next source-only package / review step.
- Do not adopt runtime or unlock collection without a separate reviewed gate.
