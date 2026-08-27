# Migration 029 production installation/security pass

Date: 2026-08-27

Migration file:
`supabase/migrations/20260826_00_canonical_workspace_linkage.sql`

Environment: production

Evidence directory:
`.local-evidence/migration-029-production-install-only-20260827-011709`

## Result

- M029 production preflight: PASS
- M029 first apply: PASS / COMMIT
- M029 rerun apply: PASS / COMMIT
- M029 postflight: PASS
- Summary row: `summary | PASS | All postflight checks must pass`

## Confirmed

- Canonical workspace-link authority exists
- RLS enabled and not forced
- service_role-only grants
- no browser grants/policies
- no diagnostics
- no forbidden writes
- no canonical-link business rows created by installation
- M028 remains fail-closed
- runtime adoption: NO
- collection unlock: NO
- activation: NO
