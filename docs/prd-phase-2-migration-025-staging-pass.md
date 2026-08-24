Migration 025 staging pass checkpoint

Current status:

- Migration 025 local rehearsal is FULL PASS.
- Migration 025 staging is PASS.
- Production was not touched.

Staging evidence:

- Preflight PASS.
- First apply COMMIT / PASS.
- Second apply / idempotency COMMIT / PASS.
- Postflight rerun PASS.

Postflight PASS rows:

- `rpc.signature` PASS.
- `rpc.security` PASS.
- `rpc.browser_grants` PASS.
- `rpc.service_role_grant` PASS.
- `data.empty_after_apply` PASS.
- `summary` PASS.

Password typo note:

- The first postflight attempt failed because of a password authentication typo only.
- The corrected postflight rerun passed.

Safety boundary:

- Staging only.
- Production not touched.
- No real production rows.
- No runtime behavior changed.
- No collection, payment, or provider behavior changed.

Updated status:

- Migration 025 is now applied and verified in staging.
- Production apply still requires separate approval.

Safe next steps:

- Commit this checkpoint.
- Prepare the production preflight / apply / postflight runbook separately.
- Do not run production until explicitly approved.
