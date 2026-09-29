# Old staging manual baseline decision memo

This memo is a source-only classification. It does not authorize a database
connection, migration execution, staging refresh, migration-history repair,
or any production operation. Old staging is `fsjljliiyfchkwbjifzw`.
Production `gznwibespgkwknnvbrlv` remains a hard stop.

The current application/runtime dependency evidence and canonical ownership
recommendations are recorded in
`docs/old-staging-blocker-app-dependency-audit.md`.

## Decision summary

| Root source | Decision | Packaging status |
| --- | --- | --- |
| `setup_trigger.sql` | Extract the independent `is_test_mode` column; archive the historical auth trigger because reachable onboarding paths provision explicitly and the legacy `registerUser` action has no repository caller. | Resolved by partial extraction plus archival; any future trigger requires a new security design. |
| `20260514_phase2_migration.sql` | Extract the acknowledgement column; exclude config data and later-canonical columns; replace the incompatible historical storage policy with separate private server-mediated namespaces. | Reconciled by `20260514000000_platform_acknowledgement_column_baseline.sql` and `20260729010000_private_evidence_storage_baseline.sql`. |
| `kyc_compliance_migration.sql` | Do not copy. Extract only source-backed fresh-install evidence tables and secure the full evidence set with exact grants and owner/team-scoped browser reads. | Resolved by `20260729000000_kyc_evidence_security_baseline.sql`; provider config/URLs and legacy repair/backfill remain excluded. |
| `20260528_platform_update_controls.sql` | Extract the merchant column; keep environment-specific settings outside migrations. | Resolved extraction to `20260528000000_platform_update_column_baseline.sql`. |
| `verification_subject_migration.sql` | Package together with the KYC schema/security contract; preserve all source-used legacy/current values and fail on domain drift. | Resolved by the core verification-type CHECK plus `20260729000000_kyc_evidence_security_baseline.sql`; the root file's blind drop is excluded. |

The current source verdict is `READY_FOR_STAGING_REFRESH`. This is an offline
source-packaging verdict, not execution approval. The extracted fragments
create no provider/config rows, demo data, auth trigger, or migration-history
row. The KYC extraction adds reviewed RLS/grants; the storage extraction adds
only two private bucket configuration rows and no browser policy.

## 1. `setup_trigger.sql`

### Section classification

| Lines | Content | Classification | Decision |
| --- | --- | --- | --- |
| 1-2 | `merchants.is_test_mode` | baseline DDL safe for migration | Extracted without changing its nullable/default contract. |
| 4-65 | `public.handle_new_user()` | security-sensitive DDL; requires user decision | Keep blocked. It is `SECURITY DEFINER`, fixes `search_path` only to `public`, does not declare/reconcile the function owner, and does not revoke default `PUBLIC` execute. |
| 17-61 | Auth-user metadata to merchant/team writes | auth policy behavior; requires user decision | Keep blocked. It performs business writes synchronously from `auth.users`, defaults plan/name values, looks up legacy role `owner`, and is not idempotent when a merchant already exists. |
| 67-72 | Drop/recreate trigger on `auth.users` | auth policy behavior; security-sensitive DDL | Keep blocked. Replacing an auth trigger requires an exact existing-trigger and ownership preflight plus a rollback contract. |

### Dependencies and current application contract

- It depends on `auth.users`, `public.merchants`, `public.roles`, and
  `public.merchant_team`.
- `registerUser` calls `supabase.auth.signUp` without an explicit merchant
  insert, but a repository-wide symbol search finds no import/caller for this
  legacy action.
- The newer Starter provisioning service explicitly creates the auth user,
  merchant, membership, and workspace. That newer path does not prove the
  legacy function safe, but the active onboarding UI calls this explicit API.
- Paid onboarding also explicitly reconciles/creates its merchant and
  membership, while team invitation explicitly creates only the requested
  team membership. The historical trigger causes conflicting side effects for
  these current paths.
- The trigger searches for role `owner`, while the newer provisioning service
  searches for role `admin`. This is a material behavioral conflict, not a
  safe baseline choice.

### Required decision

Archive the historical function/trigger and retain only the extracted column.
Current reachable onboarding code provisions explicitly. If the unreferenced
`registerUser` action is ever reintroduced, it must first be routed through an
explicit provisioning owner or accompanied by a newly reviewed canonical
trigger covering owner, hardened search path, execute ACLs, duplicate
handling, role semantics, preflight, rollback, and application regression
tests. The historical function must not be copied as written.

## 2. `20260514_phase2_migration.sql`

### Section classification

| Lines | Content | Classification | Decision |
| --- | --- | --- | --- |
| 12-14, 99-100 | `last_acknowledged_version` and comment | baseline DDL safe for migration | Extracted because current proxy/UI/actions read and update it. |
| 16-20 | `platform_settings` table | deprecated/superseded | Already created by `20260424000000_core_schema_baseline.sql`; do not duplicate it. |
| 22-25 | `current_platform_version` row | config/seed data | Exclude from migrations. No seed/config package is approved. |
| 30-34, 73-75 | Merchant KYC columns | deprecated/superseded | Canonically reconciled by `20260819010000_merchant_settings_profile_compatibility.sql`; do not duplicate them. |
| 36-47 | Private `kyc-documents` bucket row | storage policy/auth policy behavior | Replaced by the canonical storage migration, which fail-closes on conflicting existing configuration and adds separate private `dispute-evidence`. |
| 49-69 | Storage policy replacement | security-sensitive DDL; storage policy/auth policy behavior | Excluded. The canonical contract installs no browser policy for either evidence bucket; service-role callers upload and sign after application authorization. |
| 80-90, 101-104 | Invoice columns/index/comments | deprecated/superseded, except unused legacy `archived_by` | `is_archived`, `archived_at`, `payment_provider`, and the archive index are owned by `20260818010000_core_merchant_app_contract_compatibility.sql`; crypto fields are owned by `20260707010000_breet_payment_substrate_reconciliation.sql`. `archived_by` has no current non-experimental application use and is not promoted into the baseline. |
| 92-96 | `subscription_expires_at` | deprecated/superseded | Current subscription state is represented by the workspace/subscription schema; no current application read/write of this merchant column was found. Do not revive it without a contract owner. |

### Required decision

This root source is reconciled without copying its policies. KYC retains its
merchant-oriented paths in private `kyc-documents`. Dispute evidence uses
`<merchant UUID>/<dispute UUID>/<object UUID>.<safe extension>` in private
`dispute-evidence`. PDF, JPEG, PNG, and WebP objects are limited to 10 MB, and
the server returns a ten-minute signed URL after merchant-context resolution.

## 3. `kyc_compliance_migration.sql`

### Section classification

| Lines | Content | Classification | Decision |
| --- | --- | --- | --- |
| 7-26, 35-37 | `verification_providers` shape | baseline DDL candidate | Source-derived and currently used, but do not extract until its exact security manifest is approved. |
| 28-33 | DOJAH/YOUVERIFY/SMILEID rows and sandbox URLs | config/seed data | Exclude from baseline. Provider selection, status, priority, URLs, and environment belong in a separately reviewed configuration gate. |
| 39-48 | Rename `verification_records` | legacy repair/backfill DML/DDL | Exclude from a fresh baseline. It is conditional legacy repair and uses unqualified catalog checks. |
| 50-76 | Fresh `verification_logs` shape | deprecated/superseded | Already owned by `20260424000000_core_schema_baseline.sql`; do not create it again. |
| 78-150 | Compatibility columns and constraint replacement | legacy repair/backfill DDL | Do not replay. Much of the target shape is already in the core baseline, and the final type domain is changed again by `verification_subject_migration.sql`. |
| 99-125, 152-166 | Legacy nullability/default repairs and row rewrites | legacy repair/backfill DML | Exclude. These updates and destructive constraint rewrites require target-specific drift evidence and are not fresh-baseline SQL. |
| 168-171 | `verification_logs` indexes | deprecated/superseded | Already in the core baseline. |
| 173-250 | Retry/rate/provider-health/director tables, indexes, comments | baseline DDL safe after security redesign | Extracted into `20260729000000_kyc_evidence_security_baseline.sql`; exact service grants, owner/team browser columns, RLS, and NO FORCE RLS are asserted. |

### Dependencies and security gap

- `verification_logs` depends on `public.merchants` and `auth.users` and is
  already created by the core baseline.
- `verification_retry_queue` depends on `verification_logs`.
- `verification_rate_limits` and `business_director_verifications` depend on
  `merchants`; the latter also depends on `verification_logs`.
- The later verification-subject additions depend on `director_invitations`
  and `business_affiliations`, which are created by
  `20260527000000_onboarding_workspace_baseline.sql`.
- Provider, retry, rate-limit, and health services use a service-role client.
  The dashboard also reads `verification_logs` and
  `business_director_verifications` from an authenticated browser client.
  The historical SQL defines no RLS or grant contract for any of these
  sensitive tables. Service-only lockdown would break current browser reads;
  open/default access would be unsafe.

### Resolved decision

The current source proves a minimal contract. Server operations remain
service-role only. The settings UI retains exactly two direct browser reads,
restricted by column grants and `can_read_merchant_row_v1(merchant_id)`
owner/team/superadmin policies. All other browser/anonymous table access is
revoked. The exact manifest and exclusions are documented in
`docs/old-staging-kyc-evidence-security-design.md`. Provider seed rows and all
legacy repair DML remain outside the baseline.

## 4. `20260528_platform_update_controls.sql`

### Section classification

| Lines | Content | Classification | Decision |
| --- | --- | --- | --- |
| 7-8, 19-20 | `last_update_logout_version` and comment | baseline DDL safe for migration | Extracted unchanged into the official chain. |
| 10-17 | Platform update text, force flag, and sandbox email | config/seed data | Excluded. The values are environment-specific, include a personal sandbox email, and have application fallbacks/admin management. Seed remains disabled. |

### Required decision

This root blocker is resolved. The DDL is packaged and the configuration rows
are deliberately not migration data. Any future defaults belong in an
environment-reviewed configuration script, not the schema chain.

## 5. `verification_subject_migration.sql`

### Section classification

| Lines | Content | Classification | Decision |
| --- | --- | --- | --- |
| 6-8 | Director-verification invitation FK | baseline DDL candidate | Source-derived, but must follow both the KYC director table and onboarding `director_invitations`. |
| 10-22 | Drop/recreate verification-type check | security-sensitive/destructive compatibility DDL; requires user decision | Do not extract independently. It drops a constraint without a drift assertion and its allowed values must be reconciled with current application usage. |
| 24-31 | Subject, invitation, affiliation, and name-match columns | baseline DDL candidate | Source-derived, but must be included in the same reviewed KYC contract and follow `director_invitations` plus `business_affiliations`. |

### Coupled contract resolution

The file expands the type domain with `representative_bvn_selfie`,
`business_registry`, and `director_bvn_selfie`. Current application queries
also reference `individual_bvn_selfie`, which is absent from the historical
replacement. The canonical source-backed domain therefore contains the four
legacy reader values, three current writer mappings, and
`individual_bvn_selfie`. The core baseline owns that text CHECK; the KYC
migration semantically verifies the exact set before adding linked evidence
columns. Existing values are never rewritten.

### Resolved decision

The additive columns/FKs and nullable three-value subject CHECK are packaged
with the reviewed KYC security migration, after onboarding and authorization
hardening. The root file's unconditional constraint drop is not copied. Any
unknown type/subject constraint shape fails closed.

## Remaining approval decisions

No root-SQL packaging decision remains. A linked staging refresh still requires
its own explicit destructive-operation approval and all runbook stop checks.

No production decision is implied. The renamed migration versions remain
fresh-staging-only until a separate production ledger reconciliation is
reviewed and approved.
