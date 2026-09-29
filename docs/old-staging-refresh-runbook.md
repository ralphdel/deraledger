# Old staging refresh runbook (source gate ready; execution not approved)

## Scope and hard target guard

This runbook applies only to old staging project `fsjljliiyfchkwbjifzw`.
Production project `gznwibespgkwknnvbrlv` is a hard stop and must never be
linked, reset, pushed, or queried through this workflow.

Current source status: `READY_FOR_STAGING_REFRESH`. Version collisions, clean
core/registration/platform/onboarding/payment extraction, and minimal local
CLI configuration are resolved. The historical auth trigger is archived after
its independent column extraction. The KYC evidence tables, exact security
manifest, and verification type/subject domain are now canonical source
packages. Private KYC and dispute evidence now use separate service-mediated
buckets, and browser public-URL behavior has been removed.
The source-backed runtime evidence and redesign decisions are in
`docs/old-staging-blocker-app-dependency-audit.md`.
No staging refresh command is authorized by this source-only change. The
destructive operation remains a separate explicit user-approval gate.

## Source-only checks the user may run now

```powershell
$expectedStagingRef = 'fsjljliiyfchkwbjifzw'
$blockedProductionRef = 'gznwibespgkwknnvbrlv'
$backup = Resolve-Path -LiteralPath '.\.diagnostics\staging-backups\old-staging-public-schema-20260928-172818.sql'
$linkedRef = (Get-Content -LiteralPath '.\supabase\.temp\project-ref' -Raw).Trim()

if ((Get-Item -LiteralPath $backup).Length -le 0) { throw 'staging_backup_missing_or_empty' }
if ($linkedRef -eq $blockedProductionRef) { throw 'production_ref_linked' }
if ($linkedRef -ne $expectedStagingRef) { throw 'staging_ref_mismatch' }

npx tsx .\tests\supabase-baseline-packaging-validator.test.ts
npx tsx .\scripts\validate-supabase-baseline-packaging.ts `
  --backup $backup `
  --linked-ref-file '.\supabase\.temp\project-ref'
npx tsc --noEmit
git diff --check
```

These commands read local files only. They do not prove the remote target
state, modify a database, create migration history, or authorize refresh.

## Approval sequence after source repair

1. Resolve every static blocker and obtain `READY_FOR_STAGING_REFRESH` from
   the offline validator.
2. Independently review the extracted baseline, normalized migration versions,
   CLI config, and post-refresh verifier.
3. Reconfirm the backup and staging link locally.
4. Obtain explicit user approval for the exact destructive staging refresh
   command in a separate gate.
5. Run only that approved staging command manually.
6. Run read-only post-refresh verification and review compact evidence.

This document deliberately withholds the destructive linked refresh command;
source readiness is not permission to execute it.

The normalized filenames are intended only for a fresh staging chain.
Production `gznwibespgkwknnvbrlv` may retain the former version values and must
remain blocked until a separate read-only production-ledger reconciliation is
reviewed and approved.

## Post-refresh verification SQL design

After a future approved refresh, the reviewed verifier must start a read-only
transaction and emit compact checks for: current database/session role;
ordered and unique migration versions; required core, onboarding, payment,
compliance, approval, workspace-linkage, and admin-readiness objects; RLS and
NO FORCE RLS manifests; exact grants; absence of broad browser grants; and the
M024-M030 chain. It must finish with `ROLLBACK` and one final
`PASS|DECISION|STAGING_REFRESH_VERIFIED` or a fixed `BLOCKED|DECISION|...`
line. Raw catalog rows, credentials, URLs, and environment values are
forbidden.

## Stop conditions

Stop for a missing/empty backup, any target-ref ambiguity, production ref or
indicator, static audit blocker, unreviewed CLI config, duplicate version,
missing migration, source hash mismatch, refresh error, partial chain,
post-refresh schema/security mismatch, unexpected storage policy, public
evidence bucket, or non-redactable evidence requirement.
