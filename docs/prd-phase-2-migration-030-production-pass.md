# Migration 030 Production Pass

Date: 2026-08-27

Migration file: `supabase/migrations/20260827_00_m028_m029_readiness_integration.sql`

Migration 030 production direct SQL passed after one narrow production-only prerequisite grant repair.

Evidence directories:

- `.local-evidence/migration-030-production-grant-repair-20260827-033918`
- `.local-evidence/migration-030-production-20260827-034103`

Confirmed production grant repair:

- `CONTROL|M030_PRODUCTION_SERVICE_ROLE_AUTH_USERS_GRANT=PASS`
- Applied repair: `GRANT SELECT ON TABLE auth.users TO service_role;`
- No browser/public/anon/authenticated grants were added.
- M030 was not applied until this grant repair passed.

Confirmed production result:

- `030 preflight: PASS`
- `030 first apply: COMMIT`
- `030 rerun apply: COMMIT`
- `030 postflight: PASS`
- `CONTROL|MIGRATION_030_PRODUCTION_DIRECT_SQL=PASS`

Recorded scope:

- Local disposable rehearsal previously passed with 32/32 behavior PASS.
- Staging direct SQL passed earlier.
- M030 v2 RPCs are now installed in production.
- M028 v1 remains preserved and fail-closed.
- M029 canonical authority remains intact.
- Installation created no business rows.
- Runtime adoption remains NO.
- Collection unlock remains NO.
- Activation remains NO.

Next gate:

- Continue PRD Phase 2 only with separately reviewed runtime adoption work.
