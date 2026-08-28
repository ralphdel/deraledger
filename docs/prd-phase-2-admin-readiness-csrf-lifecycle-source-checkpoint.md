# Admin readiness CSRF lifecycle source checkpoint

Date: 2026-08-28

## Scope

This source-only package implements narrow synchronizer-token lifecycle
helpers for the future admin readiness routes. It creates no route, does not
enable `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED`, and does not authorize a
production release or runtime adoption.

## CSRF boundary

The helpers generate unpredictable token material, store only SHA-256 token
and session-binding representations, and bind each token to a server-derived
session-binding reference, operation, method, and bounded expiry. The token is
anti-CSRF evidence only; it cannot replace cookie-bound `auth.getUser()`, the
reviewer resolver, or the sole current authority check of
`app_metadata.is_super_admin === true`. `user_metadata` is not authority.

Production storage is deliberately not configured by default. The lifecycle
validator returns only `allow`, `csrf_denied`, or `csrf_unavailable`; missing,
malformed, expired, session-mismatched, unavailable, or throwing storage fails
closed. The in-memory storage implementation is an isolated test/development
seam and is not a production configuration.

Rotation invalidates the replaced token. The exposed session-binding
invalidation contract covers logout, session replacement, and other
security-sensitive session refreshes when a future server session adapter
calls it.

## Non-goals and release boundary

This package does not wire either route to a token issuer or storage, does not
change their disabled-by-default gate, and does not call the readiness service
factory or issue M030 requests. It does not execute approval, activate
merchants, unlock collection, or perform payment, provider, checkout,
subscription, invoice, or storefront behavior. No database, staging, or
production system is touched.

The safe next step is independent source review. Any route enablement remains
blocked on reviewed CSRF issuance/storage wiring, CORS and deployment-cookie
configuration, throttle storage/configuration, logging/redaction verification,
and final route release review.
