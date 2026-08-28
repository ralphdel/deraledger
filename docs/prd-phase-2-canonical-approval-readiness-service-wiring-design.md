# Canonical approval readiness service wiring design

Date: 2026-08-28

## Status and scope

This is a source-only design for an internal server composition module. It
authorizes no code implementation, database work, local/staging/production
access, route, page, action, webhook, admin API, or admin UI.

It does not issue an M030 request from a live handler, execute an approval,
activate a merchant, unlock collection, or perform payment, provider,
checkout, subscription, invoice, or storefront work. Runtime adoption remains
blocked.

## Proposed module and public surface

Implement later at:

`src/lib/compliance/server/canonical-approval-readiness-service-factory.ts`

The module must begin with `import "server-only"`. Its sole public export
should be one zero-argument factory for internal server use. It returns only
the existing readiness `issue` and `readSnapshot` operations. It must not
return a Supabase client, Auth Admin client, service-role key, generic RPC or
table/query function, generic role checker, session object, or Auth user.

A zero-argument production factory is preferred over caller-supplied
dependencies: accepting a caller-provided reviewer, session reader, transport,
or authority object would create a bypass risk. Test seams should be achieved
by module-level mocks or an internal-only composition helper that is not
exported from the runtime module.

## Composition plan

The future factory composes existing narrow modules in this order:

1. `createCanonicalApprovalReadinessSessionReader()` creates the private,
   cookie-bound `auth.getUser()` session reader.
2. `createCanonicalApprovalReadinessReviewerResolver({ sessionUserReader })`
   receives that reader and derives a reviewer only from server-read
   `app_metadata.is_super_admin === true`.
3. `createCanonicalApprovalReadinessService({ reviewerResolver })` receives
   only the resolver. Its existing private M030 transport/client boundary is
   responsible for the two approved readiness RPC seams.
4. The factory returns only the service's `issue` and `readSnapshot`
   operations.

The factory must not call either operation during construction. It creates no
direct table writer and does not call the approval RPC.

## Authority flow and bypass prevention

The only accepted flow is:

`cookie-bound auth.getUser()` -> minimal session reader -> reviewer resolver ->
derived super-admin reviewer -> readiness service.

Callers provide only the already-defined readiness command fields. They cannot
provide or override reviewer authority, role, email, user ID, metadata,
origin, JWT payload, header, cookie, or transport. The session reader does not
authorize; the resolver is the only authority decision point, and it accepts
only `app_metadata.is_super_admin === true`. `user_metadata` is never an
authority source.

## M030 and transport boundary

The composition module does not add a new transport. It uses the existing
`canonical-approval-readiness-service` private M030 transport/client seam only
after its resolver has been composed. A later internal operation may use only
the approved M030 v2 readiness RPCs through that seam; it must not issue a
request from a live handler until a separate admin API adoption gate passes.

No direct table writes are allowed. The only future permitted M030-side write
is the existing immutable approval-decision-request issuance performed by the
approved service transport after all readiness gates pass. This package does
not execute a compliance approval decision.

## Fail-closed behavior and error normalization

- Missing session-reader result, malformed server user, or resolver `null`
  produces the existing authority-denied result without exposing Auth details.
- Missing configuration/client construction, unavailable transport, malformed
  command/context, malformed RPC response, and RPC failure map through the
  existing readiness fail-closed result vocabulary.
- Unknown reason codes and unknown RPC result codes remain rejected; no raw
  Auth, session, database, or RPC error details reach a caller.
- Factory construction must not catch and reinterpret authorization as success.

## Future domain and RBAC posture

The module is route-independent and must not mention or hardcode
`deraledger.com/admin`. It can later be used beneath `admin.deraledger.com`,
but cookie scope, SameSite, Secure, and cross-subdomain behavior require a
separate review before runtime adoption.

`admin`, `support manager`, `compliance manager`, `compliance officer`,
`support`, and `compliance reviewer` remain deferred. This package adds no
role union, role mapping, staff lookup, or RBAC query. Super-admin
creation, removal, recovery, and management are also outside its scope.

## Security questions before implementation

1. Keep the factory zero-argument in production; use only non-exported or
   module-mocked seams for unit tests so callers cannot bypass the resolver.
2. Test composition by proving the session reader is passed to the resolver,
   the resolver is passed to the readiness service, and neither `issue` nor
   `readSnapshot` receives caller authority.
3. Confirm every construction/transport error maps to an existing opaque
   readiness failure result rather than exposing Auth or RPC details.
4. Review before implementation:
   - `canonical-approval-readiness-core.ts`
   - `canonical-approval-readiness-service.ts`
   - `canonical-approval-readiness-reviewer-resolver.ts`
   - `canonical-approval-readiness-session-reader.ts`
   - `src/lib/supabase/server.ts`
   - existing readiness/resolver/session-reader tests.
5. Keep runtime use blocked until a separately reviewed admin API design
   defines authorization, canonical reads, response handling, audit behavior,
   and deployment cookie policy.

## Test plan for later implementation

- enforce first-line `import "server-only"`;
- prove the session reader is wired into the resolver and the resolver into
  the readiness service;
- prove callers cannot pass authority or reviewer values directly;
- deny session-reader null, resolver null, malformed commands, and transport
  failures through fail-closed results;
- prove only the narrow factory is exported;
- prove no route/page/action/webhook or admin API imports the factory;
- prove no runtime adoption, direct business-table writes, approval execution,
  activation, collection unlock, payment, provider, checkout, subscription,
  invoice, or storefront behavior.

## Safe next step

Independently review this design. Implementing the factory remains source-only
and must be separately reviewed before any admin API integration or runtime
adoption.
