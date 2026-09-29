# Old staging baseline migration packaging plan

## Decision

`VERDICT=READY_FOR_STAGING_REFRESH`

Eight reviewed, data-free DDL/security layers were extracted into `supabase/migrations`:
the core schema, registration support column, platform acknowledgement column,
onboarding/workspace schema, platform-update column, and payment-record
prerequisite, plus the canonical KYC evidence/security and private evidence
storage substrates.
No root SQL was moved, no migration ledger row was created, and no remote
operation occurred. Every root SQL section is now extracted into reviewed
canonical migrations or explicitly excluded/superseded.

This offline source verdict does not itself authorize a linked refresh,
migration apply, runtime adoption, or production work.

## Source inventory and order

`supabase/baseline-packaging-manifest.json` inventories every root
`supabase/*.sql` file. Its order uses object dependencies first and commit time
within the same dependency layer:

1. `schema.sql` is the original core relation source, but it also inserts demo
   business rows and therefore cannot become a migration unchanged.
2. `setup_trigger.sql` depends on the core merchant, role, and team tables plus
   `auth.users`.
3. `rls-policies.sql` depends on the core tables, but is explicitly excluded:
   it grants broad development/demo access and must not be installed as a
   staging baseline.
4. The 2026-05-14 files depend on the core schema and Supabase `auth`/`storage`
   baseline. `20260514_breet_scaffold.sql` also alters `payment_events`, which
   is not created by any earlier root file.
5. The core baseline owns the fresh-install `verification_logs` table and its
   eight-value compatibility type domain. The canonical KYC evidence/security
   migration follows both onboarding and authorization hardening so its FKs and
   owner/team browser-read policies have reviewed prerequisites.
6. The remaining dated files follow commit chronology; same-day ordering is
   recorded in the manifest. `verification_subject_migration.sql` follows both
   the KYC and onboarding sources.

The payment, settlement, reference, merchant-profile, and Breet root scripts
must not be copied into the official chain: migrations 018, 021, 023, and the
large 009 Breet reconciliation already provide reviewed canonical or
compatibility definitions for many of the same objects.

## Packaging choice

Neither proposed shortcut is safe:

- Copying individual root files would replay overlapping table definitions,
  seed data, historical repair DML, and obsolete security policy.
- A single concatenated baseline would hide the same ordering and shape
  conflicts inside one opaque migration and make review/rollback harder.

The source-backed staging fragments now provide core tables without demo rows,
three isolated merchant support columns without configuration data,
onboarding/workspace prerequisites without configuration/backfill DML, and the
exact `payment_records` prerequisite needed before migration 009. The
section-level decisions are recorded in
`docs/old-staging-manual-baseline-decisions.md`. Current application/runtime
dependency evidence for the originally unresolved sources is recorded in
`docs/old-staging-blocker-app-dependency-audit.md`.

## Resolved storage decision

1. `20260514_phase2_migration.sql` is fully reconciled. Its historical browser
   policies are excluded. `20260729010000_private_evidence_storage_baseline.sql`
   creates private `kyc-documents` and `dispute-evidence` bucket rows, with no
   anon/authenticated storage policy. KYC and dispute writes are server/service
   mediated and reads use signed URLs. The KYC evidence security substrate and
   verification type/subject domain are resolved by
   `20260729000000_kyc_evidence_security_baseline.sql` and the core baseline;
   their source evidence and exact ACL design are recorded in
   `docs/old-staging-kyc-evidence-security-design.md`. The platform-update DDL decision
   is resolved; its environment-specific values remain excluded config data.
   The auth-trigger source is also resolved by extracting its independent
   column and archiving the trigger: current onboarding routes provision
   explicitly, the legacy `registerUser` symbol has no caller, and the
   historical trigger conflicts with current role/provisioning semantics.
2. `rls-policies.sql` contains broad development policies and is forbidden as
   a staging baseline.
3. Root and official sources contain historical duplicate `CREATE TABLE`
   shapes. They are warnings because those root files are classified as
   superseded and are not executed.

The former duplicate migration versions have been normalized to unique
timestamps while preserving order. This is safe for a fresh staging chain, but
production may retain the old ledger versions and therefore remains blocked
pending separate reconciliation. A minimal local CLI config is now present,
uses PostgreSQL 17, and disables seed execution.

Supabase's migration guidance requires migrations to have unique, correctly
ordered timestamps and describes reset as applying the scripts under
`supabase/migrations` sequentially. See the official
[migration troubleshooting guide](https://supabase.com/docs/guides/deployment/branching/troubleshooting)
and [database migrations guide](https://supabase.com/docs/guides/deployment/database-migrations).

## Offline validation

Run only these source checks now:

```powershell
npx tsx .\tests\supabase-baseline-packaging-validator.test.ts

npx tsx .\scripts\validate-supabase-baseline-packaging.ts `
  --backup ".\.diagnostics\staging-backups\old-staging-public-schema-20260928-172818.sql" `
  --linked-ref-file ".\supabase\.temp\project-ref"

npx tsc --noEmit

git diff --check
```

The repository audit is expected to emit `VERDICT=READY_FOR_STAGING_REFRESH`
when the backup, staging project-ref file, required canonical migrations, and
all other offline checks remain valid.

## Stop conditions

Stop immediately if the linked ref is absent, differs from
`fsjljliiyfchkwbjifzw`, or equals production
`gznwibespgkwknnvbrlv`; the backup is absent/empty; any duplicate migration
version remains; any baseline source is unclassified or unpackaged; config is
missing/unreviewed; an alter-before-create dependency remains; a manual
baseline decision remains; or a canonical
table/security definition is ambiguous.

Do not create migration-history rows to compensate for these failures.
