# Phase 2 Admin Domain Routing Gate

## Objective

Keep operational portals exclusive to `https://admin.deraledger.com` while
leaving public landing pages on `deraledger.com` and `www.deraledger.com`
unchanged.

## Current routing boundary

- `https://admin.deraledger.com/admin` already opens the protected admin portal.
- `https://admin.deraledger.com/` now redirects to `/admin`.
- `https://admin.deraledger.com/compliance` is allowed through for a future
  compliance portal when that route is separately implemented and reviewed.
- Future operational departments belong under `admin.deraledger.com`, such as
  `/support`, `/risk`, `/finance`, or `/operations`, after adding them to the
  centralized protected-prefix list and completing their own gates.

## Public-domain exclusion

The public production hosts redirect these operational prefixes to their own
root landing page and must not render an operational portal:

- `https://deraledger.com/admin`
- `https://www.deraledger.com/admin`
- `https://deraledger.com/compliance`
- `https://www.deraledger.com/compliance`

The root cause was that `admin.deraledger.com/` had no host-root redirect;
the application only had the `/admin` path. Staging and preview hosts are not
public production hosts, so their existing `/admin` behavior is unchanged.
API paths, including the internal readiness issue and snapshot endpoints, are
not operational portal paths and are unaffected by this guard.

## Security and release boundary

Existing admin authentication still protects `/admin` after host routing.
Production readiness `DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN` remains
`https://admin.deraledger.com`. The production readiness route flag remains
`false` until separate explicit approval.

This source-only gate changed no database, environment value, deployment, or
production setting. It does not approve M030/live readiness, approval
execution, merchant activation, collection unlock, or payment/provider/
checkout/subscription/invoice/storefront behavior.
