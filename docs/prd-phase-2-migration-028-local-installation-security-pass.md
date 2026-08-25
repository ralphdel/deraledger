# Migration 028 local installation/security PASS

Date: 2026-08-25

## Status

Migration 028 passed local disposable installation and security checks only.
It was installed on the disposable local database `deraledger_m028_disposable_install_only_20260825_185159`
and verified with evidence stored at
`.local-evidence/migration-028-local-install-only-20260825-185237`.

## Evidence

- M024–M027 baseline: PASS
- M028 preflight: PASS
- M028 first apply: COMMIT
- M028 rerun apply: completed with harmless existing-object notices suppressed
- M028 postflight: PASS
- Postflight summary: `summary | summary | PASS | All postflight checks must pass`

## Confirmed safety

- M028 tables and RPCs installed safely
- RLS enabled and not forced
- `service_role`-only grants
- no browser grants or policies
- no diagnostics
- no forbidden writes
- no compliance business rows created
- workspace linkage remains deferred
- issue/snapshot cannot become ready

## Boundary

This was a disposable local-only rehearsal. Staging was not touched, production
was not touched, runtime adoption was not performed, and collection was not
unlocked.

## Next gate

The next M028 gate is separate source review or the next separately approved
rehearsal step. No staging or production work should begin from this checkpoint
alone.
