# Root SQL classification for old staging refresh

This is a source classification, not execution approval. Root SQL remains
immutable historical evidence; only reviewed extractions may enter the official
migration chain.

| Root source | Classification | Decision |
| --- | --- | --- |
| `schema.sql` | safe baseline schema + unsafe demo data | Core DDL extracted to `20260424000000_core_schema_baseline.sql`; all demo merchant/client/invoice/payment rows excluded. |
| `setup_trigger.sql` | safe column + legacy security-sensitive auth behavior | `is_test_mode` extracted to `20260425000000_merchant_registration_columns_baseline.sql`; historical trigger archived because reachable onboarding provisions explicitly and `registerUser` has no repository caller. Any future trigger requires a new hardened design. |
| `rls-policies.sql` | deprecated/archive | Broad development/demo policies must never enter a production-like baseline. |
| `20260514_phase2_migration.sql` | safe additive DDL + config + obsolete storage security behavior | `last_acknowledged_version` is extracted to `20260514000000_platform_acknowledgement_column_baseline.sql`; later migrations own overlapping merchant/invoice columns; the historical storage policies are excluded and replaced by `20260729010000_private_evidence_storage_baseline.sql`. |
| `20260514_kyc_references_collections.sql` | deprecated/archive | Canonical reference and merchant compatibility are owned by migrations 018 and 023. |
| `20260514_breet_scaffold.sql` | deprecated/archive | Its `payment_events` dependency and configuration are covered by canonical payment reconciliation migration 009. |
| `20260519_crypto_treasury_infra.sql` | deprecated/archive | Table/function shapes are reconciled by migration 009. |
| `20260520_add_business_type.sql` | deprecated/archive | Canonical nullable merchant field is owned by migration 021. |
| `kyc_compliance_migration.sql` | safe fresh-install KYC evidence DDL mixed with config and legacy repair | Resolved by partial extraction to `20260729000000_kyc_evidence_security_baseline.sql`. Provider rows/URLs, secrets, repair branches, and backfills remain excluded; exact service grants plus two owner/team-scoped browser reads are asserted. |
| `20260527_onboarding_verification_upgrade_flow.sql` | safe baseline schema + seed/backfill candidate | DDL extracted to `20260527000000_onboarding_workspace_baseline.sql`; platform-setting inserts and merchant backfill excluded. |
| `20260527_payment_checkout_provider_routing.sql` through `20260617_expand_provider_settlement_account_status_check.sql` | deprecated/archive unless listed below | Payment/settlement shapes and disabled defaults are owned by migrations 009/010 and later compatibility migrations. |
| `20260528_platform_update_controls.sql` | safe DDL + excluded config | Merchant DDL extracted to `20260528000000_platform_update_column_baseline.sql`; environment-specific messages, force flag, and sandbox email remain outside migrations. |
| `verification_subject_migration.sql` | safe additive candidates + unsafe destructive constraint replacement | Resolved across the core baseline and `20260729000000_kyc_evidence_security_baseline.sql`. The canonical text CHECK includes current mappings plus legacy `individual_bvn_selfie`; the migration asserts the existing domain and never performs the root file's blind constraint drop. |

`supabase/staging/006_solo_plus_prerequisites.sql` is an already-curated,
data-free prerequisite source. It was extracted unchanged to
`20260706000000_payment_records_prerequisite.sql` so migration 009 sees the
required canonical `payment_records` substrate. It creates no business rows.

## Seed posture

There is no approved seed package. Demo rows from `schema.sql` are excluded,
provider/configuration inserts and platform-update values remain candidates
for later review, and
`supabase/config.toml` explicitly disables seed execution.

The line-by-line classifications and dependency evidence are in
`docs/old-staging-manual-baseline-decisions.md`.

The canonical storage extraction creates only private `kyc-documents` and
`dispute-evidence` bucket configuration rows. It creates no browser storage
policy. KYC callers already use service-role uploads and signed URLs; dispute
uploads now cross a merchant/team-authorized server boundary and receive a
short-lived signed URL. Demo/development policies and public buckets remain
excluded.

## Production implication of version normalization

The renamed migration files are source normalization for a fresh staging
chain. Production project `gznwibespgkwknnvbrlv` remains blocked. Its existing
ledger may contain the former eight-digit versions, so these renames must not
be used for production push, reset, or repair without a separate read-only
ledger reconciliation and explicit production approval.
