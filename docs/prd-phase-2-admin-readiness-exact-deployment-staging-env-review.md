# Phase 2 Admin Readiness Exact-Deployment Staging Environment Review

## Objective

Review the exact env key names and deployment boundary needed before any
separate staging route re-enable decision for the committed HTTP CSRF
issuance-flow repair.

## Reviewed source and deployment reference

- Review date: 2026-09-01.
- Reviewed commit: `22730c1 fix(security): add readiness csrf issue route`.
- Exact deployment URL previously exercised for staging smoke:
  `https://deraledger-staging-git-main-ralphs-projects-25fcfa46.vercel.app/admin`
- Production remains out of scope and untouched.

## Compact redacted evidence

- `PASS|reviewed_commit_identified_as_latest_local_head`
- `PASS|source_env_key_names_confirmed_from_committed_route_runtime_files`
- `PASS|route_flag_key_name_confirmed_as_deraledger_admin_readiness_routes_enabled`
- `PASS|source_accepts_supabase_url_or_next_public_supabase_url`
- `PASS|source_requires_server_only_supabase_service_role_key`
- `PASS|source_requires_exact_readiness_origin_policy_keys`
- `PASS|source_requires_matching_deployment_and_supabase_environment_labels`
- `PASS|source_requires_distinct_csrf_and_throttle_hmac_keys`
- `PASS|source_requires_explicit_bounded_throttle_env_values`
- `PASS|exact_staging_smoke_deployment_url_known_from_prior_reviewed_diagnostic`
- `PASS|custom_staging_domain_was_previously_identified_as_non_serving_route_target`
- `PASS|previous_exact_deployment_env_validity_blocker_cleared_by_user_confirmed_safe_staging_values`
- `PASS|exact_deployment_target_readiness_keys_present_and_valid`
- `PASS|exact_deployment_origin_policy_supports_reviewed_staging_origin`
- `PASS|deployment_and_supabase_environment_labels_are_staging_aligned`
- `PASS|csrf_and_throttle_hmac_keys_present_and_distinct`
- `PASS|throttle_settings_present_and_bounded`
- `PASS|route_flag_present_and_literal_false_for_exact_deployment_target`
- `PASS|exact_deployment_ready_for_separate_staging_reenable_approval`
- `PASS|staging_redeployed_after_env_fix`

No secrets, env values, tokens, cookies, JWTs, headers, connection strings, or
service-role material are recorded here.

## Source-read env key names

The committed runtime path reads these exact key names:

- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED`
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT`
- `DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT`
- `DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN`
- `DERALEDGER_ADMIN_READINESS_ALLOWED_ORIGINS`
- `DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS`

`APP_URL` and `NEXT_PUBLIC_APP_URL` are not read by the readiness runtime
security configuration. They may still matter operationally elsewhere, but they
do not satisfy the readiness origin-policy requirement by themselves.

## Key review outcome

- Route gate: only literal `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED === "true"`
  enables the issue and snapshot routes.
- Supabase runtime: the committed source accepts `SUPABASE_URL` or
  `NEXT_PUBLIC_SUPABASE_URL`, but it requires `SUPABASE_SERVICE_ROLE_KEY`
  exactly for the server-only durable RPC client. The exact deployment target
  now has the required accepted Supabase URL key and the server-only
  `SUPABASE_SERVICE_ROLE_KEY` present.
- Origin policy: the runtime requires
  `DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN` and may additionally use
  `DERALEDGER_ADMIN_READINESS_ALLOWED_ORIGINS`. No wildcard origin is allowed.
  The staging/preview target now has an origin policy that supports the exact
  reviewed staging deployment origin.
- Environment labels:
  `DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT` and
  `DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT` must both be present,
  individually valid, and exactly equal, or the runtime fails closed. The
  exact deployment target now has both labels staging-aligned.
- HMAC keys:
  `DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY` and
  `DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY` must both be present,
  individually valid, and distinct, or the runtime fails closed. The exact
  deployment target now has both keys present and distinct.
- Throttle settings:
  `DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT`,
  `DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT`, and
  `DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS` must all be present and
  parse to bounded positive integers. Missing values do not fall back safely
  for this runtime path; missing or malformed values fail closed. The exact
  deployment target now has bounded reviewed values: issue limit `10`,
  snapshot limit `30`, and window seconds `60`.

## Exact-deployment target review

- Exact deployment URL to be smoked is known:
  `https://deraledger-staging-git-main-ralphs-projects-25fcfa46.vercel.app/admin`
- The exact Vercel staging/preview target was corrected after the earlier
  blocked review.
- The user confirmed that every source-read readiness key required by the
  committed route/runtime package is now present and valid enough for the exact
  deployment target.
- The staging deployment was redeployed after the env fix.
- The route flag remains present and literal `false`, so the exact deployment
  remains disabled by default at this stage.
- This clears the previous deployment-env validity blocker, but it does not
  approve a staging smoke retry or a route-flag change by itself.

## Custom staging-domain status

The earlier custom staging-domain `404` remains treated as a deployment-domain
mismatch, not as proof that the reviewed route source was absent. This review
does not attempt to reclassify or reuse that domain for re-enable approval.

## Current safe state

- Environment was changed only to safe staging values for the exact deployment
  target; no secret values were printed.
- No database was touched.
- No staging or production DB action occurred.
- No route flag was enabled.
- No smoke run was performed.
- Production remains untouched.

## Redeploy Record

- `STAGING_REDEPLOYED_AFTER_ENV_FIX=YES`
- exact deployment env/key blocker remains cleared
- route flag remains false
- route flag enabled = NO
- ready for staging re-enable approval = YES
- no staging smoke retry yet

## Conclusion

The source-side readiness env contract is now explicit and complete, but the
exact deployment target now has the required source-read readiness env keys,
staging-aligned labels, distinct HMAC keys, bounded throttle settings, and a
literal disabled route flag. This clears the previous exact-deployment
env-validity blocker. Staging route re-enable approval remains a separate gate,
and no staging smoke retry or production action is approved here.

## Remaining Gates

1. exact-deployment env target/key validity review
2. staging re-enable approval
3. staging route-flag re-enable
4. staging smoke checks
5. production env review
6. production route-flag approval
7. production route-flag enablement
8. production smoke checks
9. admin UI integration/release gate
10. M030/live-readiness gate
