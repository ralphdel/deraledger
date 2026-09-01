# Phase 2 Admin Readiness Staging Route-Flag Smoke Diagnostic

## Objective

Record the blocked staging smoke result and the source-only repair required
before any separately approved staging retry.

## Redacted smoke result

- `BLOCKED|route=issue|status=500|code=internal_unavailable`
- `BLOCKED|route=snapshot_without_csrf|status=500|code=internal_unavailable`
- Tested deployment: `https://deraledger-staging-git-main-ralphs-projects-25fcfa46.vercel.app/admin`
- Earlier custom staging-domain `404` evidence was a deployment-domain
  mismatch; it was not evidence that the committed route files were absent.

## Diagnosis and repair

The enabled routes deliberately fail closed to `internal_unavailable` when
their security configuration or cookie-bound security context is unavailable.
The prior source also had no HTTP delivery path for a synchronizer CSRF token:
the server-only `issueCsrfToken` composition seam existed but neither route
called it.

This repair makes the non-business `POST /api/internal/admin/compliance/
readiness/issue` endpoint call the server-only `issueCsrfToken` seam for a
`snapshot`-scoped token. It does not parse or execute a readiness command,
does not call the canonical readiness service, and logs no token. The returned
token and expiry are the only metadata needed for the next snapshot request.
`snapshot` remains a CSRF-protected, non-token-issuing endpoint.

The staging route flag was rolled back to `false` while this source repair is
reviewed. No database or production action occurred, and no environment value
is recorded here.

## Required readiness runtime key names

The source reads the following key names. Presence and validity must be
reviewed in the exact deployment target without recording their values.

- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED`
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN`
- `DERALEDGER_ADMIN_READINESS_ALLOWED_ORIGINS`
- `DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT`
- `DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT`
- `DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS`

The service-role key is server-only. The HMAC keys must be valid, distinct,
and never exposed to a browser. The explicit readiness origin policy, rather
than `APP_URL` or `NEXT_PUBLIC_APP_URL`, controls this route's CORS check.

## Current safe state and remaining gates

- Staging route flag: `false` while fixing.
- Production: untouched and blocked.
- No M030/live readiness, approval execution, merchant activation, collection
  unlock, or payment/provider/checkout/subscription/invoice/storefront behavior.

Remaining gates are unchanged: independent source review; exact-deployment
staging environment review; staging flag-enable approval; staging smoke;
production environment review and approval; production smoke; admin UI
integration/release; and M030/live-readiness review.
