# Old staging KYC evidence and verification-domain design

## Scope and decision

This is a source-only canonical contract for the old-staging refresh package.
It does not authorize a Supabase connection, refresh, migration execution,
runtime adoption, or any production action. Old staging is
`fsjljliiyfchkwbjifzw`; production `gznwibespgkwknnvbrlv` remains a hard stop.

The KYC evidence and verification-domain decisions are resolved by:

- `20260424000000_core_schema_baseline.sql`, which owns the fresh-install
  `verification_logs` table and the canonical compatibility type domain; and
- `20260729000000_kyc_evidence_security_baseline.sql`, which owns the remaining
  operational evidence tables, subject/linkage columns, RLS, policies, and
  exact grants.

No root SQL file is copied wholesale. Provider rows, provider URLs, secrets,
environment config, repair DML, value backfills, and historical constraint
drops are excluded.

## Source evidence

Current server code uses service-role clients for:

- provider registry reads and health/status updates;
- verification-log reads, inserts, updates, and merchant deletion cleanup;
- retry-queue reads, inserts, and updates;
- rate-limit reads, upserts, and deletion cleanup;
- provider-health inserts and admin/operational reads;
- director-evidence reads, inserts, updates, and deletion cleanup; and
- registry snapshot, affiliation, invitation, director verification, and cost
  evidence operations.

`src/app/(dashboard)/settings/page.tsx` has exactly two direct authenticated
browser reads. They are restricted to:

- `verification_logs`: `returned_bvn_name` and `name_match_status`, with
  `merchant_id`, `verification_type`, and `created_at` needed for filtering and
  ordering; and
- `business_director_verifications`: `id`, `director_name`, `director_role`,
  and `verification_status`, with `merchant_id` and `created_at` needed for
  filtering and ordering.

The settings director query is narrowed from `select("*")` to that explicit
column list. Both tables use authenticated SELECT policies backed by the
already-canonical `public.can_read_merchant_row_v1(uuid)` owner/team/superadmin
authorization function from the authorization-hardening migration. There is
no direct `anon` access.

## Canonical verification domain

The source-backed `verification_logs.verification_type` compatibility values
are:

```text
bvn_selfie
business
director
identity
representative_bvn_selfie
individual_bvn_selfie
business_registry
director_bvn_selfie
```

The first four are legacy/current retry-reader values, the next three are
current writer mappings, and `individual_bvn_selfie` is explicitly read by
current approval code. A text CHECK is retained instead of a PostgreSQL enum:
it preserves current text comparisons and makes any future expansion an
explicit constraint migration rather than an enum-order mutation. The new KYC
migration semantically verifies the existing check's literal set and fails on
unknown drift; it does not rewrite existing evidence values.

`verification_subject` is nullable for legacy evidence and, when present, is
restricted to `representative`, `business`, or `director`. Its constraint is
also semantically asserted. Invitation and affiliation UUID links follow the
onboarding baseline and use `ON DELETE SET NULL` so evidence remains auditable.

## Table and security ownership

The new migration creates only these missing operational tables:

- `verification_providers`
- `verification_retry_queue`
- `verification_rate_limits`
- `provider_health_events`
- `business_director_verifications`

The onboarding baseline already owns `user_kyc_profiles`,
`business_registry_snapshots`, `business_affiliations`,
`director_invitations`, `director_verifications`, and `verification_costs`.
The core baseline owns `verification_logs`. The KYC migration secures all 12
tables together so none is left on default ACL/RLS posture.

For every protected table, RLS is enabled and FORCE RLS is disabled. All table
privileges are revoked from `PUBLIC`, `anon`, `authenticated`, and
`service_role` before the source-derived grants are applied. `service_role`
then receives only the table operations used by current server code. The two
browser tables receive only the explicit authenticated column SELECT grants
listed above. Post-apply assertions compare exact service-role table privilege
arrays, exact authenticated column arrays, policy roles/commands, and the RLS
force state. Any mismatch aborts the migration.

## Deliberate exclusions

- No provider registry row, URL, sandbox endpoint, credential, or secret.
- No rename from `verification_records` and no legacy repair/backfill DML.
- No broad authenticated or anonymous table grants.
- No storage bucket or `storage.objects` policy. Storage remains a separate
  unresolved blocker because current private KYC signed-read paths conflict
  with the browser dispute upload/public-URL path.
- No M024-M030 compliance-decision object is duplicated. Those migrations
  consume evidence from this substrate.

## Remaining blocker

`20260514_phase2_migration.sql` remains package-pending only for canonical
storage design. Current service paths need a private `kyc-documents` namespace
with service-role writes and signed reads, while the current dispute browser
flow writes `dispute-rebuttals/...` to the same bucket and calls
`getPublicUrl`. The historical policy authorizes a different path shape and
cannot safely reconcile that contradiction. A product/security decision must
choose a separate private dispute namespace plus server-mediated upload/read,
or an explicitly public evidence model with its exposure accepted. Until that
decision is made and tested, the offline validator must remain `BLOCKED`.
