# Canonical approval reviewer resolver — source checkpoint

## Scope

This source-only package implements the injected reviewer resolver required by canonical approval readiness. It does not create a database client, call an RPC, execute an approval, or wire any route, page, action, webhook, or admin UI.

## Authority boundary

The resolver is server-only and accepts one narrow injected server-session user reader. It derives authority solely from an authenticated session user with a valid reviewer UUID and `app_metadata.is_super_admin === true`.

`user_metadata`, caller-supplied role/authority/origin/email/headers, merchant and customer identities, team roles, malformed metadata, and resolver failures are all denied. Compliance reviewer support remains deferred.

## Explicit boundaries

- Runtime adoption: no.
- Admin API integration: no.
- Approval execution or M030 request issuance: no.
- Activation or collection unlock: no.
- Payment, provider, checkout, subscription, invoice, or storefront behavior: no.
- Database execution: no.

## Safe next step

Perform an independent source review before any future server-session implementation or admin API integration.
