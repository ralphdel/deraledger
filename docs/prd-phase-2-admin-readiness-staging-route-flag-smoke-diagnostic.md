# Phase 2 Admin Readiness Staging Route-Flag Smoke Diagnostic

## Objective

Record the staging route-security diagnosis, remediation evidence, and the
removal of the temporary diagnostic implementation.

## Earlier blocked smoke evidence

- `BLOCKED|route=issue|status=500|code=internal_unavailable`
- `BLOCKED|route=snapshot_without_csrf|status=500|code=internal_unavailable`
- An earlier custom staging-domain `404` was a deployment-domain mismatch,
  not evidence that the committed route files were absent.
- A later `/issue` smoke from `https://deraledger-staging.vercel.app/admin`
  returned `400 origin_denied` after the exact staging origin and primary
  origin-policy keys were rechecked.

## Diagnosis and temporary diagnostic removal

The temporary redacted staging diagnostic identified
`hmac_configuration_invalid` as the failure category. The staging HMAC
environment values were replaced outside this source task. This source task
did not change any environment value.

The temporary response-visible `stagingDiagnostic` field and the temporary
`admin_readiness_staging_runtime_diagnostic` server log were removed after
diagnosis. `/issue` has returned to its planned opaque response behavior.

## Passed staging route-security smoke

- `PASS|route=issue|status=201|code=csrf_issued`
- `PASS|route=snapshot_without_csrf|status=400|code=csrf_denied`
- `PASS|route=snapshot_with_valid_csrf|status=404|code=canonical_snapshot_v2_request_missing|random_uuid`

The random UUID in the valid-CSRF snapshot smoke deliberately has no canonical
readiness request, so the safe `404 canonical_snapshot_v2_request_missing`
response confirms the security path reached the snapshot service without
performing any business action.

## Permanent route behavior

The non-business `POST /api/internal/admin/compliance/readiness/issue`
endpoint calls the server-only `issueCsrfToken` seam for a snapshot-scoped
synchronizer token. It does not parse or execute a readiness command and does
not call the canonical readiness service. `snapshot` remains CSRF-protected
and does not issue tokens.

The source preserves route-flag gating, explicit origin validation, durable
CSRF issuance, redacted logging, and opaque errors. No database, staging
database, production, or release action occurred in this source task.

## Required readiness runtime key names

The source reads the following names; review presence and validity in the
exact deployment target without recording values.

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

The service-role key remains server-only. HMAC keys remain valid, distinct,
and never browser-exposed.

## Current safe state and remaining gates

- Route flag is not changed by this source task.
- Production remains untouched and blocked.
- No M030/live readiness, approval execution, merchant activation, collection
  unlock, or payment/provider/checkout/subscription/invoice/storefront behavior.

Remaining gates are unchanged: independent source review; staging smoke
evidence review; production environment review and approval; production
smoke; admin UI integration/release; and M030/live-readiness review.
