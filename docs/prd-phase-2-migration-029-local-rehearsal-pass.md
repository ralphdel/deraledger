# Migration 029 local rehearsal pass

Date: 2026-08-26

Migration file:
`supabase/migrations/20260826_00_canonical_workspace_linkage.sql`

Environment: disposable local PostgreSQL only

Evidence directory:
`C:\Users\HP\Desktop\Purpledger\local-evidence\migration-029-local-20260826-185626`

## Result

- M024-M028 baseline: PASS
- M029 preflight: PASS
- M029 first apply: PASS / COMMIT
- M029 rerun apply: PASS / COMMIT
- M029 postflight: PASS
- M029 behavior/security rehearsal: PASS
- Final control line: `CONTROL|LOCAL_CANONICAL_WORKSPACE_LINKAGE_REHEARSAL=PASS`

## Behavior coverage

- zero candidate fails closed
- one candidate creates canonical link
- exact replay preserved
- conflicting idempotency fails closed
- cross-merchant workspace fails closed
- duplicate candidate blocked
- anon/authenticated execute denied
- anon/authenticated table denied
- service_role prerequisite reads granted
- merchant/workspace unchanged
- forbidden writes absent

## Boundary

- staging not touched
- production not touched
- runtime adoption: NO
- collection unlock: NO
- provider/payment testing: NO
- activation executed: NO

## Next gate

Migration 029 staging preflight/apply/rerun/postflight may be considered only after this checkpoint is committed and reviewed.
