# Phase 2 Production Readiness Route-Security Diagnostic

## Status and scope

This is a temporary, source-only production diagnostic for the admin
readiness CSRF-issuance route. Production smoke from
`https://admin.deraledger.com` returned `400 origin_denied` twice even though
the browser origin was the reviewed production admin origin. The production
route flag must be returned to `false` while this diagnostic is reviewed and
deployed through a separate approved action.

The source task changed no environment value, touched no database, performed
no deployment, and ran no production smoke. It authorizes no M030/live
readiness, approval execution, merchant activation, collection unlock, or
payment/provider/checkout/subscription/invoice/storefront behavior.

## Why the diagnostic is needed

The same public `origin_denied` response can result when the fail-closed route
composition cannot create its complete security configuration. Staging showed
the same symptom; its redacted diagnostic identified
`hmac_configuration_invalid`, after which externally replacing the staging
HMAC values allowed the staging smoke to pass.

## Narrow production gate

The `/api/internal/admin/compliance/readiness/issue` response includes a
temporary `productionDiagnostic` object only when all of these conditions hold:

1. the issuance outcome is exactly `origin_denied`;
2. the request URL origin is exactly `https://admin.deraledger.com`;
3. the request pathname is exactly
   `/api/internal/admin/compliance/readiness/issue`; and
4. `NODE_ENV` is exactly `production`.

Successful issuance, other denial outcomes, other request origins, other
paths, staging, preview, development, and snapshot responses remain unchanged.
No diagnostic route or server-log diagnostic was added.

## Redacted fields

The response diagnostic contains only booleans and one fixed category label:

- `request_origin_present`
- `request_origin_matches_admin_origin`
- `admin_origin_present`
- `admin_origin_parse_valid`
- `allowed_origins_key_present`
- `allowed_origins_empty_string`
- `allowed_origins_duplicates_admin_origin`
- `deployment_environment_present`
- `supabase_environment_present`
- `deployment_and_supabase_environment_equal`
- `origin_policy_created`
- `supabase_url_present`
- `service_role_key_present`
- `csrf_hmac_key_present`
- `throttle_hmac_key_present`
- `hmac_keys_distinct`
- `throttle_issue_limit_valid`
- `throttle_snapshot_limit_valid`
- `throttle_window_seconds_valid`
- `security_configuration_created`
- `final_failure_category`

Allowed failure categories are closed source constants. The object never
contains raw environment values, origins, Supabase URLs, service-role values,
HMAC values, cookies, JWTs, headers, connection strings, CSRF tokens, UUIDs,
or database diagnostics.

## Removal requirement

This response-visible diagnostic must be removed immediately after the
production failure category is captured and the resulting configuration issue
is resolved. The cleanup requires source review before normal production
route-security smoke resumes. Production readiness route enablement remains a
separate, explicit gate.

## Safe state

- `DB_TOUCHED=NO`
- `STAGING_DB_TOUCHED=NO`
- `PRODUCTION_TOUCHED=NO`
- `ENV_CHANGED=NO`
- `ROUTE_FLAG_CHANGED=NO`
- `PRODUCTION_RELEASE=NO`

