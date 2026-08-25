# Approval RPC service-role transport source checkpoint

Date: 2026-08-25

Implemented a compliance-owned, server-only service-role transport at `src/lib/compliance/server/reviewed-profile-approval-rpc-service-role-transport.ts`.

The module exposes one factory and one transport method from the existing adapter contract. The method can invoke only `review_compliance_profile_decision_v1` with its exact 13 typed arguments. The Supabase client factory is private and returns no client, table API, auth admin API, generic RPC API, payment/provider, activation, collection, invoice, subscription, or storefront surface.

Tests inject a narrow fake RPC client. The production path validates configuration lazily, creates a private service-role client only when the transport is invoked, disables session persistence, and converts configuration, client creation, Supabase, and response-shape failures into safe coded errors. The existing adapter continues to map those errors and unknown result codes fail closed.

This is source-only transport infrastructure. It has no runtime route/page/action/webhook import, performs no database work at import or construction, and does not authorize or execute real approval. No activation, collection unlock, payment/provider testing, or storefront work occurred.

Next gate: independently review the transport source and tests. Any adapter binding into a real server workflow requires a separate reviewed runtime-adoption plan.
