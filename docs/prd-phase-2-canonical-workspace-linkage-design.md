# Canonical workspace-linkage package design

Date: 2026-08-26

## Status and purpose

This is a design-only proposal for the prerequisite that must exist before
Migration 028 canonical approval issue/snapshot RPCs may produce `ready`.
Migration 028 is installed as an installation/security foundation, but it
intentionally returns a safe workspace-linkage-unavailable result. This design
does not create SQL, migrate data, issue approval requests, adopt runtime, or
change collection state.

The purpose of the future package is to make one workspace identity provable
for one merchant without treating a UI choice, a cookie, a team membership, or
an application fallback as canonical database authority.

## Current source-schema facts

Repository source establishes the following historical application contract:

- `supabase/20260527_onboarding_verification_upgrade_flow.sql` creates
  `public.workspaces` with `id uuid` as its primary key and nullable
  `merchant_id uuid references public.merchants(id) on delete cascade`.
- The same definition contains `UNIQUE (merchant_id)`, which permits at most
  one non-null merchant-linked workspace.
- That migration adds nullable `public.merchants.workspace_id` without a
  foreign key. It is a mirrored application pointer, not sufficient canonical
  proof by itself.
- The current onboarding code creates or reads a workspace by
  `workspaces.merchant_id`, then mirrors the chosen `workspaces.id` into
  `merchants.workspace_id`. `ensureWorkspaceForMerchant` and Starter
  provisioning use `maybeSingle`, so their intended application contract is
  one workspace per merchant.
- `src/lib/merchant-context.ts` resolves a user to a merchant through owner or
  active `merchant_team` membership. It does not establish a database-canonical
  workspace identity. A selected merchant context therefore must not be reused
  as approval workspace authority.
- Compatibility migrations 019 and 021 also name the `workspaces.id` and
  `workspaces.merchant_id` columns as prerequisites. This is source evidence,
  not a substitute for catalog verification in every target environment.

Consequently, `public.workspaces` is an established application schema
contract in repository history, rather than an M024--M028 substrate object.
No database was queried for this design, so source inspection cannot prove that
the table, its unique constraint, or its foreign key are intact in every
environment. Migration 029 must prove them at preflight and fail closed if they
are absent, ambiguous, or incompatible.

## Contract assessment

`UNIQUE (workspaces.merchant_id)` is a useful one-workspace intent, but there
is no dedicated immutable approval-owned canonical-link record. The nullable
merchant pointer can be absent, stale, or disagree with the workspace row; it
also has no foreign key in the source definition. Existing application logic
can create/update a workspace during onboarding and uses convenient lookup
semantics. It is not an authorization-grade proof that the workspace is the
one approval context must use.

Therefore the durable canonical workspace-linkage contract does **not** yet
exist for Phase 2 approval. A separate additive Migration 029 is required.

## Proposed Migration 029 scope

Migration 029 should be additive and limited to workspace-linkage authority.
It should not change the existing `workspaces` table's business behavior or
modify M026/M027/M028 function definitions.

### Preconditions

Before any DDL, preflight and the migration guard must use safe catalog lookups
to require:

1. `public.merchants` and `public.workspaces` exist.
2. `merchants.id`, `workspaces.id`, and `workspaces.merchant_id` are UUID
   columns with the expected nullability/identity semantics.
3. `workspaces.merchant_id` has exactly one validated foreign key to
   `merchants.id`, with the approved `ON DELETE CASCADE` behavior.
4. a count-one candidate constraint exists for non-null
   `workspaces.merchant_id` (the historical `UNIQUE (merchant_id)` is the
   expected form), with no conflicting duplicate constraints.
5. M024--M028 required compliance objects retain their approved RLS and
   browser-grant posture.

Missing tables, columns, FKs, uniqueness, unsafe grants, unexpected duplicate
constraints, or query errors must produce PASS/FAIL evidence and a safe
failure. The package must not create a guessed workspace table, infer a key
name, select the newest workspace, or repair pre-existing workspace data.

### New authority

Subject to source review, add an approval-owned table such as
`public.merchant_canonical_workspaces`:

- `merchant_id uuid primary key references public.merchants(id)`;
- `workspace_id uuid not null`;
- `created_at`, `created_by`, and an immutable provenance/version field;
- `unique (workspace_id)`;
- a composite foreign key `(workspace_id, merchant_id)` to a uniquely indexed
  `(workspaces.id, workspaces.merchant_id)` pair, so a link proves ownership
  rather than merely that both records exist;
- RLS enabled and not forced; no browser policies or table grants;
- no direct UPDATE or DELETE capability for browser roles, and no mutable
  generic application repository surface.

If the composite FK requires a redundant unique index on
`workspaces(id, merchant_id)`, the migration may add only that non-behavioral
supporting index after exact catalog verification. It must never alter a
workspace's merchant ID to make a link fit.

The canonical table is the Phase 2 approval authority. The existing
`merchants.workspace_id` remains historical application data and is neither
required nor updated by this package.

### Creation, conflict, and repair posture

Installation creates schema objects only; it creates no canonical-link rows
and does not bulk backfill merchants. A separately invoked,
service-role-only, deterministic reconcile RPC may later insert one canonical
link only after it locks the merchant and the exact workspace candidate and
proves all of the following:

- exactly one non-null `workspaces.merchant_id = merchant.id` row exists;
- the row satisfies the expected FK/unique contract;
- an existing canonical link is either exactly identical (safe replay) or
  absent;
- the caller is service role and supplies a server-owned repair request
  identity/idempotency key.

Zero candidates return `workspace_linkage_unavailable`; more than one candidate
or contradictory canonical data returns `workspace_linkage_ambiguous` or
`workspace_linkage_conflict`. A mismatching legacy `merchants.workspace_id`
is a safe conflict/audit condition, not permission to overwrite either table.
Any historical repair that would change an existing merchant or workspace must
be designed, independently reviewed, and rehearsed as its own migration/RPC;
it is outside M029.

The reconcile RPC may write only the new canonical-link authority and its
append-only safe audit/reconciliation event, if such an event table is added
and approved. It must not update `merchants`, `workspaces`, compliance
profiles/events, M028 requests/policies, or operational business tables.

## Security and grants

Every future M029 RPC must have a deterministic signature, `SECURITY INVOKER`,
and hardened `search_path`. Revoke `EXECUTE` from `PUBLIC`, `anon`, and
`authenticated`; grant it only to `service_role`. The canonical-link table
must have RLS enabled/not forced and no browser/public grants or policies.

The future runtime workflow never calls the table or these RPCs from a browser.
Any future server binding must be compliance-owned, server-only, and narrow;
it must not export a generic Supabase client or unrelated table/payment API.

## Preflight, postflight, and rehearsal

Preflight must safely verify exact workspace columns, UUID types, the
merchant-link FK, count-one uniqueness, M024--M028 dependencies, and the
existing browser-denial posture. It must use `to_regclass` for
missing-object-sensitive paths and emit a summary FAIL rather than crashing.

Postflight must prove the exact table/RPC signatures, RLS enabled/not forced,
service-role-only table/function grants, no browser/public policies or grants,
the composite ownership constraint/index, no business rows created by
installation, and no forbidden function-body write paths.

A disposable local rehearsal must exercise: clean installation/rerun;
one-candidate insertion; exact replay; zero candidate; duplicate/corrupt
candidate; legacy pointer mismatch; cross-merchant workspace attempt; hostile
role denial; late-write rollback; and no partial canonical-link row. Staging
and production are never rehearsal substitutes.

## M028 integration plan

M029 alone must leave M028's current issue/snapshot RPCs fail-closed. After
M029 has independently passed local, staging, and production installation and
behavior rehearsal, a separately reviewed follow-up migration may replace the
M028 RPC bodies to:

1. read exactly one `merchant_canonical_workspaces` row;
2. verify its composite merchant/workspace ownership relation;
3. copy its `workspace_id` into a new immutable approval decision request;
4. return `ready` only after the existing profile, source, policy, version,
   and idempotency gates also pass.

Missing, duplicate, stale, contradictory, or query-error link state must
remain a safe non-ready result. M028 must not query `merchants.workspace_id`,
choose a workspace by recency, or treat a UI workspace selection as authority.

## Explicit boundaries

This package is not activation or collection enablement. It must not set
`setup_mode=false`, `live_features_enabled=true`,
`can_collect_payments=true`, a collection entitlement, or
`activation_status='active'`. It must not unlock collection or write limits,
providers, checkout, payment records, settlements, subscriptions, invoices,
storefront data, merchants, or workspaces.

Runtime adoption remains blocked. A canonical workspace link only resolves one
repository prerequisite; it is neither a compliance decision nor approval,
payment verification, provider readiness, limit approval, activation, or
collection unlock.

## Rollout gates and safe next steps

1. Independently review this design and confirm the historical workspace
   schema against current catalog evidence in a separately approved,
   read-only preflight step.
2. Prepare a narrow M029 source package with static tests, safe preflight, and
   postflight.
3. Independently review the source, then pass disposable local installation
   and behavior/rollback rehearsal.
4. Obtain separate approvals for staging and production progression.
5. Only then design the separate M028 RPC replacement/integration package.
6. Keep the approval runtime boundary unadopted and collection locked until
   every independent compliance, commercial, risk, limit, payout, provider,
   activation, and runtime-adoption gate is approved.
