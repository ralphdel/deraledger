# Migration 028 production installation/security PASS

Date: 2026-08-25

## Status

Migration 028 passed production installation and security checks only. It was
installed on production with evidence stored at
`.local-evidence/migration-028-production-install-only`.

## Evidence

- M028 postflight summary: PASS
- M028 policy and decision-request tables exist
- RLS enabled and not forced
- `service_role`-only grants
- no `PUBLIC`/anon/authenticated execute
- no browser table grants or policies
- no diagnostics
- no forbidden writes
- no compliance business rows created

## Confirmed safety

- workspace linkage remains deferred
- issue/snapshot cannot become ready
- runtime adoption was not performed
- collection was not unlocked

## Boundary

This was a production-only installation/security rehearsal. Runtime adoption
was not performed, and no collection or payment-related behavior was touched.

## Next gate

The next M028 gate is separate source review or the next separately approved
rehearsal step. No runtime adoption should begin from this checkpoint alone.
