# Old staging blocker application-dependency audit

## Scope and verdict

This is a source-only audit of the four root SQL files that entered this gate
as blockers for the old-staging baseline package. It does not authorize a Supabase connection,
migration execution, refresh, migration-history repair, runtime adoption, or
any production operation. Old staging is `fsjljliiyfchkwbjifzw`. Production
`gznwibespgkwknnvbrlv` remains a hard stop.

`VERDICT=READY_FOR_STAGING_REFRESH`

The follow-up source audit proves exact canonical DDL for the KYC evidence and
verification-domain sources. Their source-only migration and regression
contract and private evidence storage are now packaged. The manifest has no
remaining `packagePending` entry.

| Root source | Current dependency result | Decision |
| --- | --- | --- |
| `setup_trigger.sql` | The only direct `auth.signUp` action is unreferenced in the repository. Reachable Starter and paid onboarding provision explicitly; team invitations explicitly create membership. | `ARCHIVE`: retain the extracted `is_test_mode` column, but exclude the historical trigger. Any future reuse of the legacy action requires a new provisioning/security design. |
| `20260514_phase2_migration.sql` | Its safe DDL is extracted or superseded. KYC callers use service-role upload/signed reads; the dispute page was the only browser writer/public-URL caller. | `EXTRACTED`: two private namespaces plus a server-mediated dispute route replace the historical policy. |
| `kyc_compliance_migration.sql` | Its operational KYC/evidence tables are actively used and are not replaced by M024-M030. Current source proves service-role operations plus two narrow settings-browser reads. | `EXTRACTED`: `20260729000000_kyc_evidence_security_baseline.sql` contains fresh-install DDL, exact grants, RLS, and owner/team-scoped column reads; config and repair DML remain excluded. |
| `verification_subject_migration.sql` | Its columns and mapped subject types are used by current flows, and readers prove the legacy `individual_bvn_selfie` compatibility value. | `EXTRACTED`: core owns the eight-value text CHECK; the KYC migration asserts it and adds the subject/linkage contract without a blind constraint drop or value rewrite. |

## Audit method

The four SQL files were read in full and searched against current `src/`, the
official `supabase/migrations/` chain, and the Phase 2 source-ownership and
persistence records. This audit distinguishes a current runtime dependency
from canonical ownership: a runtime reference proves that an object or
capability is needed, but it does not make historical SQL or its security
posture safe to replay.

## A. `setup_trigger.sql`

### Current dependency evidence

- `src/app/(auth)/actions.ts`, `registerUser`, calls
  `supabase.auth.signUp` with business metadata and does not explicitly create
  a merchant or creator membership. Repository-wide symbol search finds its
  definition but no import or caller, so it is legacy/unreachable in the
  current application build rather than an active onboarding path.
- `src/lib/services/starter-workspace.service.ts` creates the auth user and
  then explicitly runs `ensureStarterWorkspace`, which creates the merchant,
  creator membership, and workspace when absent. It resolves the creator role
  by the current name `admin`.
- `src/lib/services/fiat-payment-confirmation.service.ts` also creates an auth
  user and explicitly reconciles/creates the merchant. It preferentially
  ignores a trigger-created `Default Business` row when a better merchant row
  exists, proving the historical trigger can produce duplicate/undesired
  side effects in a newer flow.
- `src/lib/actions.ts`, `sendInviteAction`, creates auth users for team
  members and then explicitly writes the selected `merchant_team` membership.
  An unconditional auth-user trigger can create a separate default merchant
  for that invited team user.
- No current official migration owns `public.handle_new_user` or
  `on_auth_user_created`. The already extracted
  `20260425000000_merchant_registration_columns_baseline.sql` owns only the
  independent `merchants.is_test_mode` column.

### Security and compatibility findings

- The function is `SECURITY DEFINER` and sets `search_path = public`, but it
  does not establish/reconcile an expected owner, use a hardened
  `pg_catalog`/empty search path strategy, or revoke default `PUBLIC` execute.
- The synchronous trigger trusts mutable auth metadata for plan, business
  name, and phone, and writes business state during `auth.users` insertion.
- The merchant insert is not idempotent and has no explicit conflict policy.
- It looks up the legacy role name `owner`; current Starter provisioning uses
  `admin`, and repository role-cleanup sources treat `owner` as legacy.
- Dropping/replacing an `auth.users` trigger without an existing-definition,
  owner, dependency, and rollback preflight is not acceptable baseline work.

### Decision

`ARCHIVE`. Current reachable onboarding/provisioning code does not require the
historical trigger, and its side effects conflict with current role and
provisioning ownership. The already extracted `is_test_mode` column remains;
the function and trigger are deliberately excluded and the root source is
classified as reconciled by that extraction plus archival. If `registerUser`
is ever imported or exposed again, that change must first add an explicit
provisioning owner or a separately reviewed canonical trigger defining exact
metadata validation, idempotency, role semantics, owner, hardened search
path, ACLs, preflight, rollback, and regression coverage.

## B. `20260514_phase2_migration.sql`

### Superseded or already packaged sections

- `last_acknowledged_version` is actively read by `src/proxy.ts` and
  `src/components/platform-update-modal.tsx` and updated by
  `src/lib/actions.ts`; it is already isolated in
  `20260514000000_platform_acknowledgement_column_baseline.sql`.
- `platform_settings` already belongs to the core baseline. The
  `current_platform_version` row is environment configuration, not baseline
  schema.
- Later merchant compatibility migration
  `20260819010000_merchant_settings_profile_compatibility.sql` owns the
  overlapping KYC/profile columns.
- Later official payment/core compatibility migrations own
  `is_archived`, `archived_at`, `payment_provider`, the archive index, and the
  crypto invoice fields. No current non-experimental read/write of
  `archived_by` or `merchants.subscription_expires_at` was found, so neither
  should be revived from this root file.

### Active storage dependency evidence

- Server/service code uploads KYC evidence to `kyc-documents` in
  `src/lib/actions.ts`, `src/lib/services/verification.service.ts`, and
  `src/lib/services/director-verification.service.ts`; signed reads also use
  that bucket.
- Before this correction, `src/app/(dashboard)/dashboard/disputes/[id]/page.tsx`
  performed a browser upload under `dispute-rebuttals/...` and called
  `getPublicUrl`. It now posts to the merchant dispute-evidence route and
  renders only a short-lived signed URL returned by that route.
- The historical bucket was private while the old UI expected a public URL;
  the corrected contract keeps both evidence buckets private.
- The historical authenticated INSERT policy requires the first path segment
  to equal `auth.uid()`. It cannot authorize the current
  `dispute-rebuttals/...` path. Copying it would package a known runtime and
  access-control mismatch.
- The root file drops/recreates policies on Supabase-managed
  `storage.objects` and inserts a managed bucket row. This requires a distinct
  storage ownership/security review, not ordinary table-baseline extraction.

### Decision

`EXTRACTED`. `20260729010000_private_evidence_storage_baseline.sql` defines
private `kyc-documents` and `dispute-evidence` buckets, identical reviewed MIME
and 10 MB limits, no browser storage policies, and fail-closed drift checks.
The dispute page no longer calls browser storage or `getPublicUrl`; its server
route resolves owner/team/superadmin context, uploads with service-role, stores
an opaque private reference, and returns a ten-minute signed URL. Both merchant
and admin dispute detail pages use that endpoint for the private attachment.

## C. `kyc_compliance_migration.sql`

### Current operational dependencies

| Object | Current source dependency | Ownership result |
| --- | --- | --- |
| `verification_providers` | `verification.service.ts`, `src/lib/kyc/`, provider-health cron, and admin provider APIs/UI read or update provider state and costs. | Active operational schema. Provider rows, priorities, statuses, and URLs remain environment config and must not be migrated from the root INSERT. |
| `verification_logs` | Verification services write it; admin APIs/UI, dashboard settings, compliance evidence loaders, and Solo Plus requirement logic read it. | Active evidence schema, already created by `20260424000000_core_schema_baseline.sql`; do not recreate it. |
| `verification_retry_queue` | `src/lib/services/retry.service.ts` inserts, selects, and updates queue state. | Active service-only operational schema candidate. |
| `verification_rate_limits` | `verification.service.ts` reads/upserts counters; merchant cleanup code references it. | Active service-only operational schema candidate. |
| `provider_health_events` | Provider-health code appends health evidence. | Active append-only operational schema candidate. |
| `business_director_verifications` | Director verification/invitation services create and update it; server actions and dashboard settings read it. | Active sensitive evidence schema candidate with mixed service and current browser access. |

`user_kyc_profiles`, registry snapshots, affiliations, and invitations are
separate onboarding evidence objects already owned by
`20260527000000_onboarding_workspace_baseline.sql`; they are dependencies of
the wider workflow but are not created by this KYC root file.

### Relationship to M024-M030

The M024-M030 chain creates canonical compliance decision/profile, review,
event, approval-request/snapshot, and workspace-linkage state. It does not
create the KYC provider, retry, rate-limit, health, director, or legacy
verification-log substrate. The Phase 2 persistence record explicitly keeps
existing verification and business evidence tables authoritative in their
own domains, and the source-ownership record treats `verification_logs` and
director/registry evidence as inputs rather than compliance approval.

Therefore M024-M030 supersedes unsafe inference of approval from legacy KYC
status; it does not supersede the operational evidence tables themselves.

### Historical-file exclusions and security resolution

- Exclude provider seed/config rows and sandbox URLs.
- Exclude the conditional `verification_records` rename, data rewrites,
  nullability relaxations, and legacy constraint replacement from a fresh
  baseline. Those are target-specific repair operations.
- Do not duplicate `verification_logs` or its indexes; the core baseline owns
  them.
- The historical file defines no adequate RLS/policy/grant contract. Current
  source resolves that gap: server writes/admin reads remain service-role only;
  dashboard settings receives explicit columns on `verification_logs` and
  `business_director_verifications`, scoped by
  `can_read_merchant_row_v1(merchant_id)`. No anonymous access is retained.

### Minimum current schema and decision

The source-derived minimum is: the existing canonical `verification_logs`;
fresh-install shapes for `verification_providers`,
`verification_retry_queue`, `verification_rate_limits`,
`provider_health_events`, and `business_director_verifications`; their exact
indexes/FKs; and the verification-subject additions described below. Provider
configuration remains separate.

`EXTRACTED`. The migration secures the core/onboarding evidence tables
together with the five missing operational tables. It asserts exact
service-role table privileges, exact authenticated column grants, policy
roles/commands, RLS enabled, and NO FORCE RLS. No provider URL/config row or
legacy repair/backfill enters the baseline. See
`docs/old-staging-kyc-evidence-security-design.md`.

## D. `verification_subject_migration.sql`

### Current dependency evidence

- `src/lib/services/verification.service.ts` writes
  `verification_subject`, `invitation_id`, `business_affiliation_id`,
  invited/returned names, and name-match state. It maps `bvn_selfie` to
  `representative_bvn_selfie`, `business` to `business_registry`, and
  `director` to `director_bvn_selfie`.
- Director invitation/verification services use the link to
  `director_invitations`; dashboard/admin paths read the resulting director
  and verification evidence.
- Current readers accept legacy categories `bvn_selfie`, `business`,
  `director`, and `identity`, the three mapped categories above, and also
  query `individual_bvn_selfie` in server/admin views.
- The historical check contains the first seven values but omits
  `individual_bvn_selfie`. Applying it unchanged can reject a value the
  current application intentionally reads from historical evidence.
- The subject/FK additions depend on the KYC tables plus
  `director_invitations` and `business_affiliations` from the onboarding
  baseline. They cannot safely execute as an independent root migration.

### Canonical ownership recommendation

Verification subject/type describes operational KYC evidence. It belongs in
the new canonical KYC evidence migration, not in M024's compliance-decision
profile domain. The minimum compatibility domain evidenced by current source
is:

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

This is now the executable fresh-baseline text CHECK. The KYC migration
semantically verifies the exact set before adding linked columns. A target with
unknown constraint drift fails; the migration does not rewrite evidence or
drop and replace the constraint blindly.

### Decision

`EXTRACTED`. The additive columns/FKs and subject constraint are packaged in
the reviewed KYC evidence/security migration after their onboarding
prerequisites. The root file is not copied as written.

## Final dependency decision

No source-packaging blocker remains. Offline validation may now return
`READY_FOR_STAGING_REFRESH`; that verdict is not remote execution approval.
Production remains hard-blocked and any staging refresh still requires the
separate approval sequence in the runbook.
