# Approval RPC transport source checkpoint

Date: 2026-08-25

## Review result

No existing factory is safe to bind to the approval RPC adapter at this time.

The closest candidate is `createSoloPlusServiceRoleClient` in `src/lib/solo-plus/server/supabase-repository.ts`. It creates a service-role Supabase client from environment variables, but the factory module itself has no `server-only` import and exposes a broad client used by Solo Plus review, activation, payment, and recovery code. It is not an approval-scoped, compliance-owned transport boundary.

`src/lib/supabase/server.ts` is also unsuitable: it creates a cookie-bound anon/session client, not a service-role client.

## Current safety boundary

The approval RPC adapter remains transport-injected and server-only through its facade. It has no Supabase client factory, no service-role key access, no import-time database work, and no route, page, action, or webhook import. Transport exceptions are reduced to a safe fail-closed result without exposing error details.

## Required future work

Before any binding is introduced, separately design and review a compliance-owned server-only service-role RPC transport with a narrow `rpc(name, arguments)` surface, explicit environment validation, no browser import path, injectable test double, and no broader table/write methods. Its runtime adoption remains a later, separately approved gate.

No runtime adoption, real approval execution, activation, collection unlock, provider/payment testing, or storefront work occurred.
