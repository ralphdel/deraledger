# Phase 2 Production Readiness Route-Security Diagnostic

## Status and scope

This is a temporary, source-only production diagnostic for the admin
readiness CSRF-issuance route. Production smoke from
`https://admin.deraledger.com` returned `400 origin_denied` twice even though
the browser origin was the reviewed production admin origin. The production
route flag was rolled back to `false` after the failed smoke and must remain
false while this diagnostic is reviewed and deployed through a separate
approved action.

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

The first production diagnostic reported the deployment and Supabase labels
as present and equal but collapsed the policy failure into
`environment_policy_invalid`. Source review confirms that lowercase
`production` is an accepted literal, the `production`/`production` pair is
allowed, there is no separate pair allowlist, and labels are compared exactly
without trimming or case normalization. There is no staging-only guard in the
environment policy.

The policy also validates rules that the first diagnostic did not distinguish:
the exact supported label literals, pair equality, environment-compatible
admin origin, every additional origin, duplicate admin origins, and whether
any `NEXT_PUBLIC_*` name/value appears to expose a service-role credential or
secret. The refined diagnostic reports these as separate booleans and closed
categories; it does not weaken any policy rule.

The refined production diagnostic later reported
`environment_policy_browser_secret_exposure`. A source audit found that the
two intentional browser credentials reported by the operator,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`, were not
matched by the existing forbidden-name expression. The policy now makes that
intent explicit with a narrow allowlist containing those names and
`NEXT_PUBLIC_SUPABASE_URL`.

The allowlist applies to names only. All allowlisted variables still undergo
the fail-closed sensitive-value checks, so an `sb_secret_` value or a JWT whose
role is `service_role` remains rejected. Any `NEXT_PUBLIC_*` name containing a
service-role, secret, private, password, or token marker also remains rejected,
including `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SECRET_KEY`,
`NEXT_PUBLIC_PRIVATE_KEY`, and `NEXT_PUBLIC_ACCESS_TOKEN`. The diagnostic does
not return variable names or values. Consequently, the two intentional public
keys alone do not explain the earlier exposure category; a separate forbidden
browser-variable name or sensitive-shaped value must still be checked through
a names-only Vercel review before another production smoke decision.

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
- `allowed_origins_all_valid`
- `deployment_environment_present`
- `supabase_environment_present`
- `deployment_and_supabase_environment_equal`
- `deployment_environment_literal_valid`
- `supabase_environment_literal_valid`
- `deployment_environment_is_production`
- `supabase_environment_is_production`
- `production_pair_allowed`
- `environment_pair_allowed`
- `browser_environment_secret_exposure_detected`
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

Environment-policy failure categories distinguish unsupported deployment and
Supabase labels, a valid-label pair mismatch, invalid or environment-conflicting
admin origins, invalid or duplicate additional origins, browser-visible secret
exposure, and an unknown fail-closed fallback. Configuration categories for
Supabase presence, HMAC validity/distinctness, throttle validity, and final
configuration construction remain separate.

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
- The production readiness route flag remains `false` pending a separate
  reviewed diagnostic deployment and smoke decision.
