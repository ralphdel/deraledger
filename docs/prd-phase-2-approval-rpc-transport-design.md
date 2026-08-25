# Approval RPC service-role transport design

Date: 2026-08-25

## Purpose and status

This document designs, but does not implement or adopt, a compliance-owned transport for the installed and cleaned approval RPC:

`public.review_compliance_profile_decision_v1(uuid, uuid, text, text, uuid, bigint, text, bigint, uuid, text, text, timestamptz, text)`.

The current adapter and executor bridge remain source-only. No database is contacted by this design, and no route, page, action, webhook, payment flow, or activation flow may import the future transport without a separate reviewed runtime-adoption gate.

## Existing factory review

`src/lib/supabase/server.ts` is not suitable because it creates a cookie/session-bound anon client.

`src/lib/solo-plus/server/supabase-repository.ts` exposes `createSoloPlusServiceRoleClient`, but it is not suitable for reuse because the factory module has no direct `server-only` boundary and its client surface is shared with Solo Plus review, activation, payment, and recovery behavior. Reusing it would couple compliance approval to a broad live-domain client and undermine the narrow transport boundary.

## Proposed module and API

Create the implementation only after separate approval at:

`src/lib/compliance/server/reviewed-profile-approval-rpc-service-role-transport.ts`

The first line must be `import "server-only";`. The module must not re-export a Supabase client, its factory, a generic `rpc` method, or table/query methods.

Its public API should be limited to:

```ts
export function createReviewedProfileApprovalServiceRoleTransport(
  dependencies?: {
    createServiceRoleRpcClient?: () => ApprovalRpcClient;
  },
): ReviewedProfileApprovalRpcTransport;
```

`ApprovalRpcClient` should expose exactly one typed method internally:

```ts
rpc(
  name: "review_compliance_profile_decision_v1",
  arguments_: ReviewedProfileApprovalRpcArguments,
): Promise<{ data: readonly ReviewedProfileApprovalRpcRow | null; error: unknown | null }>;
```

The returned transport must expose only `callApprovalDecisionRpc` from the existing adapter contract. The function name must be a constant, not caller-controlled. The RPC argument object must be passed unchanged and retain all 13 fields: merchant/profile IDs, plan/source/source version, target status, expected version, reviewer, decision key, policy version, reviewed time, and reason code.

## Server-only and credential boundary

The future implementation must create its service-role client only inside the server-only module, after validating non-empty server environment configuration. It must use a non-public URL configuration value where the deployment provides one; any existing public URL variable may be read only if it is the project URL and never exposes a credential. The service-role key must remain server environment-only and must never be returned, logged, interpolated into errors, placed in module exports, or accepted as a function argument.

The client factory must be private. The only injectable seam is `createServiceRoleRpcClient`, allowing unit tests to supply a narrow fake without importing Supabase or using environment credentials. No browser component can import a module containing `server-only`; static import checks must cover routes, pages, actions, and webhooks.

## RPC scope and prohibited surface

The transport may call only `review_compliance_profile_decision_v1`. It may not expose generic RPC dispatch, `.from`, `.select`, `.insert`, `.update`, `.upsert`, `.delete`, storage, auth admin, provider, checkout, payment, invoice, subscription, merchant, workspace, capability, collection-limit, settlement, or activation operations.

The transport does not decide approval authority. The existing command validator and executor bridge continue to enforce the trusted service-role/internal-review context before calling the adapter. The RPC itself remains the atomic database decision boundary.

## Failure behavior

- Missing configuration or client-factory failure must reject through the adapter's safe transport failure result.
- Supabase transport errors must not expose raw database messages, SQLSTATE, connection strings, headers, tokens, evidence, or PII.
- A malformed response must map to `approval_rpc_response_invalid`.
- Unknown RPC result codes must map to `approval_rpc_result_unknown`.
- Known non-success RPC outcomes must remain fail-closed unless they are the exact replay or preserved outcomes already mapped by the adapter.
- The transport must return no partial success representation; it forwards one RPC response only.

## Required implementation tests and gates

Before implementation, add tests proving the server-only marker, exact single RPC name, exact 13 arguments, private/non-exported client factory, no generic/table APIs, environment failure safety, transport error redaction, unknown-code fail-closed behavior, dependency-injected fake support, and no runtime imports.

After source review, any implementation remains source-only until a distinct runtime-adoption design defines the authorized reviewer entry point, canonical profile-ID resolution, operator authorization, audit/observability, rollback, local rehearsal, staging proof, and production approval. Collection stays locked throughout.
