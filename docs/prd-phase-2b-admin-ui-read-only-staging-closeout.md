# Phase 2B Admin UI read-only staging closeout

**Status:** read-only queue/detail acceptance complete; review actions, runtime
adoption, activation, collection unlock, M030/live readiness, and production
remain blocked.

## Completed staging gate

The Phase 2B Solo Plus admin queue/detail read path passed on staging. The
controlled synthetic fixture case `e5289804-558a-48e3-8a2e-303422a4c84a` was
visible in the queue, opened in the detail view, and was then removed through
the approved guarded cleanup path.

Accepted evidence:

- the legacy admin API boundary passed;
- the review-action release gate passed with no review controls exposed;
- `/admin/solo-plus/cases` opened and the fixture appeared in the queue;
- case detail opened without sensitive provider, payment, document, storage,
  or signed-URL fields;
- browser console/network and Vercel logs were clean; and
- cleanup returned `PASS|FIXTURE|admin_read_case_removed` followed by
  `PASS|FIXTURE_CLEANUP|case_descendants_absent`.

The fixture cleanup is complete. It removed only the exact fixture case, its
requirements, and its events. It did not authorize deletion of the synthetic
identity, merchant, workspace, onboarding records, payment records, or any
other staging data.

## Protections confirmed in this gate

- Admin authority is server-side and DB-backed through the authenticated
  user's `public.merchants.is_super_admin` record; auth metadata is not
  authority.
- Excluded legacy `/api/admin/*` APIs are private/no-store `404`s by default.
- Queue/detail routes remain read-only and protected by the DB-backed
  super-admin guard.
- Review mutations are default-disabled by
  `DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED` and remain disabled
  in production even if that flag is set.
- The detail DTO/UI excludes provider references, internal payment references,
  document paths, storage keys, bucket paths, and signed URLs.
- The fixture executor hard-blocks the production project reference and its
  cleanup transaction checks scoped identity, payment linkage, and exact
  one-row case deletion.

## Recommended next gate

The next Phase 2B admin gate should be a separately designed and independently
reviewed **controlled staging review-action acceptance**. It must use a new
isolated fixture, retain a default-disabled action gate until explicit staging
approval, and test one action at a time with read-only evidence after each
operation. It must keep approval separate from merchant activation.

M030/live readiness, activation, collection unlock, payment/refund execution,
document viewing, broader legacy-admin release, runtime adoption, and all
production activity are separate gates and must not be bundled into that
review-action work.

## Risks before the next gate

- Enabling a mutation route without an approved action-specific fixture and
  post-action evidence could change a real staging case.
- Review actions need explicit idempotency, stale-row-version, reason, refund
  posture, and approval-versus-activation checks in staging.
- Private-document viewing remains unimplemented; it requires a separate
  server-mediated authorization and short-lived access design.
- The cleaned read-only fixture cannot be reused. A fresh isolated fixture and
  separate creation/cleanup approvals are required for future action testing.

## Production boundary

Production remains blocked. This closeout authorizes no production deployment,
database access, route/action-flag enablement, review decision, activation,
collection unlock, payment/refund operation, M030/live readiness, or runtime
adoption.
