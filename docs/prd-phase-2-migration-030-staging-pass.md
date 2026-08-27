# Migration 030 Staging Pass

Date: 2026-08-27

Migration file: `supabase/migrations/20260827_00_m028_m029_readiness_integration.sql`

Migration 030 staging direct SQL passed after one narrow staging-only prerequisite grant repair.

Evidence directories:

- `.local-evidence/migration-030-staging-grant-repair-20260827-032441`
- `.local-evidence/migration-030-staging-20260827-032833`

Confirmed grant repair:

- `CONTROL|M030_STAGING_SERVICE_ROLE_AUTH_USERS_GRANT=PASS`
- Applied repair: `GRANT SELECT ON TABLE auth.users TO service_role;`
- No browser/public/anon/authenticated grants were added.
- M030 was not applied until the grant repair passed.

Confirmed staging result:

- `030 preflight: PASS`
- `030 first apply: COMMIT`
- `030 rerun apply: COMMIT`
- `030 postflight: PASS`
- `CONTROL|MIGRATION_030_STAGING_DIRECT_SQL=PASS`

Recorded scope:

- M030 staging was direct SQL only, no staging harness.
- M030 v2 RPCs installed successfully.
- M028 v1 remained preserved and fail-closed.
- M029 canonical authority remained intact.
- v2 signatures, security, grants, and posture were verified.
- Installation created no business rows.
- Runtime adoption remains NO.
- Collection unlock remains NO.
- Production is not yet touched.

Next gate:

- Production can be considered only after this staging checkpoint is committed and reviewed.
