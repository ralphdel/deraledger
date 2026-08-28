# Canonical approval readiness service factory source checkpoint

Date: 2026-08-28

## Scope

This source-only checkpoint records the narrow internal composition factory at
`src/lib/compliance/server/canonical-approval-readiness-service-factory.ts`.
It is not an admin API, route, page, action, webhook, or runtime-adoption
change.

## Composition and authority boundary

The zero-argument production factory is server-only and composes the existing
cookie-bound session reader, reviewer resolver, and readiness service. It
returns only `issue` and `readSnapshot`; it does not expose a Supabase client,
Auth Admin surface, service-role key, session, Auth user, generic RPC/table
surface, or role checker.

Authority remains server-derived: `auth.getUser()` feeds the minimal session
reader, then the resolver accepts only `app_metadata.is_super_admin === true`.
Callers cannot supply or replace a session reader, resolver, transport,
reviewer, role, authority, metadata, user ID, email, JWT, header, cookie, or
origin claim. `user_metadata` is not authority.

Future admin, support manager, compliance manager, compliance officer,
support, and compliance reviewer RBAC remains deferred. Super-admin creation,
removal, recovery, and management are outside this package.

## Preserved boundaries

The factory does not issue live M030 requests during construction, execute an
approval, create an admin API, or adopt runtime behavior. It contains no
direct table writes and no activation, collection unlock, payment, provider,
checkout, subscription, invoice, or storefront behavior.

## Verification and next step

The focused tests prove zero-argument composition, narrow exports, no
construction-time operation call, and no route/page/action/webhook import.
The safe next step is independent source review before commit; any future
admin API integration remains separately gated.
