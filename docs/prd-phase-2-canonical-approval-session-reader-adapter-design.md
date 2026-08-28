# Canonical approval server-session reader adapter design

Date: 2026-08-28

## Status and scope

This is a source-only design for the concrete adapter that will eventually
supply `readAuthenticatedServerSessionUser()` to the canonical approval
reviewer resolver. It authorizes no implementation, database work, staging or
production access, route, action, webhook, admin API, or admin UI.

It does not issue an M030 request, read a readiness snapshot, execute an
approval, activate a merchant, unlock collection, or perform payment,
provider, checkout, subscription, invoice, or storefront work.

## Recommended boundary and API

Implement later at:

`src/lib/compliance/server/canonical-approval-readiness-session-reader.ts`

The module must begin with `import "server-only"`. Its sole public export
should be a narrow factory returning an object compatible with the resolver's
injected session-reader seam:

```ts
type ServerSessionUserReader = {
  readAuthenticatedServerSessionUser(): Promise<{
    id: string;
    app_metadata: Record<string, unknown> | null;
    user_metadata: Record<string, unknown> | null;
  } | null>;
};
```

The return value must contain no email, token, session, cookie, header,
provider identity, or generic client. `user_metadata` is included only so the
resolver can explicitly deny it as an authority source; it never authorizes a
reviewer.

## Trusted session source

Use `src/lib/supabase/server.ts` privately within the adapter. Its
`createClient()` uses `@supabase/ssr`, `next/headers` cookies, and the
anonymous project key to construct a request-cookie-bound server client.
The adapter must call `client.auth.getUser()` on that private client and map
the returned server-read user to the minimal shape above.

Do not use `requireAdminPortalSession`: it trusts an `admin_session` cookie and
does not resolve a Supabase Auth user. Do not use `requireSuperAdminSession`
unchanged: it currently accepts `user_metadata.is_super_admin`, which is not
acceptable for this approval boundary. Do not consume a browser-supplied JWT
payload, raw Authorization header, claimed role, claimed origin, email, or
metadata object.

The SSR client is broader than this adapter's needs, so it must remain a local
implementation detail. The adapter exports no Supabase client, Auth Admin
client, service-role key, generic auth helper, table reader, RPC surface, or
role-query surface.

## Algorithm and fail-closed rules

1. Construct the private cookie-bound server client through the existing
   server client factory.
2. Call `auth.getUser()`.
3. Return `null` when request context/cookies are unavailable, `getUser()`
   returns an error, no user is returned, the user ID is missing or invalid,
   or either metadata object is malformed.
4. Otherwise return only the ID plus copied server-read `app_metadata` and
   `user_metadata` records.
5. Let `createCanonicalApprovalReadinessReviewerResolver` decide authority:
   only `app_metadata.is_super_admin === true` can produce a reviewer.

Errors must not expose raw Auth responses, tokens, cookie values, or metadata
contents. The adapter must have no side effects and must not refresh or set
cookies deliberately; normal SSR client behavior must be reviewed in the
implementation context.

## Future domain and RBAC posture

The adapter is independent of URL routing and therefore can operate beneath a
future `admin.deraledger.com` portal without implementing domain, host,
redirect, or cookie-domain logic. Before adoption, deployment-specific cookie
scope, SameSite, Secure, and cross-subdomain behavior must be reviewed.

Only super-admin is relevant to current readiness work. `admin`, `support
manager`, `compliance manager`, `compliance officer`, `support`, and all other
RBAC roles remain deferred. This adapter must not create role unions, role
queries, role mappings, or compliance-reviewer support.

## Security questions and implementation review inputs

1. Confirm `src/lib/supabase/server.ts` remains cookie-bound in the intended
   Next.js server context and that `auth.getUser()` validates the session with
   Supabase Auth.
2. Confirm the adapter can call that helper without exporting the resulting
   broad client or inheriting any generic query surface.
3. Review `src/lib/admin-auth.ts` only as a contrast: do not reuse its
   user-metadata authority rule.
4. Review the reviewer resolver, readiness core/service, relevant server
   client tests, and the future deployment's `admin.deraledger.com` cookie
   policy before implementation.
5. Decide whether a fresh browser login or token refresh is required after
   changing `app_metadata`. Existing sessions/JWT claims can remain stale;
   `auth.getUser()` must be verified to return the intended fresh
   server-authoritative user data before any runtime adoption. Until that is
   proven, fail closed and require reauthentication/refresh rather than
   inferring authority from stale client claims.

## Test plan

- enforce a first-line `import "server-only"`;
- prove the private adapter calls `auth.getUser()` exactly once;
- prove it accepts no caller-provided user, role, metadata, or header;
- deny missing request/session, Auth error, missing user, invalid ID, and
  malformed metadata;
- prove only server-read metadata reaches the resolver and that user metadata
  is not authority;
- prove no client, service-role credential, Auth Admin surface, table query,
  or RPC surface is exported;
- prove no route, page, action, or webhook imports the adapter;
- prove no merchant/customer/business or payment/provider/commerce reads or
  writes are introduced;
- retain the source-only, no-runtime-adoption boundary.

## Safe next step

Independently review this design. A later implementation must be source-only
and separately reviewed before any admin API integration or runtime adoption.
