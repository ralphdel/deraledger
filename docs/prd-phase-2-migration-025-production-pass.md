Migration 025 production pass checkpoint

Current final status:

- Migration 025 local FULL PASS.
- Migration 025 staging PASS.
- Migration 025 production PASS.

Production evidence:

- Preflight PASS.
- First apply COMMIT / PASS.
- Second apply / idempotency COMMIT / PASS.
- Postflight PASS.
- `MIGRATION_025_PRODUCTION_SEQUENCE_COMPLETED`.
- Evidence folder: `.\local-evidence\migration-025-production-20260825-042501`

Production postflight PASS rows:

- `rpc.signature` PASS.
- `rpc.security` PASS.
- `rpc.browser_grants` PASS.
- `rpc.service_role_grant` PASS.
- `data.empty_after_apply` PASS.
- `summary` PASS.

Safety boundary:

- Production touched only for Migration 025.
- No runtime adoption.
- No activation.
- No collection unlock.
- No provider, payment, or checkout test.
- No storefront work.
- No runtime behavior changed.

Updated status:

- Migration 025 is now applied and verified in production.
- The reviewed-profile bootstrap RPC database path is now present in production.

Safe next steps:

- Commit this checkpoint.
- Do not add runtime call sites yet.
- Continue PRD Phase 2 with the next separately reviewed persistence path only.
- Keep collection locked until full compliance, limits, payout/provider readiness, activation, and runtime-adoption paths are approved.
