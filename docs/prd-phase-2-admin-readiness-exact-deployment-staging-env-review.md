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
- `SKIPPED|vercel_cli_not_available_in_workspace`
- `SKIPPED|no_linked_vercel_project_metadata_present_in_workspace`
- `BLOCKED|exact_deployment_env_target_not_independently_verifiable_from_available_local_or_vercel_mechanisms`
- `BLOCKED|exact_deployment_env_key_presence_and_value_compatibility_not_proven_for_reenable_decision`

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
  exactly for the server-only durable RPC client.
- Origin policy: the runtime requires
  `DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN` and may additionally use
  `DERALEDGER_ADMIN_READINESS_ALLOWED_ORIGINS`. No wildcard origin is allowed.
- Environment labels:
  `DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT` and
  `DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT` must both be present,
  individually valid, and exactly equal, or the runtime fails closed.
- HMAC keys:
  `DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY` and
  `DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY` must both be present,
  individually valid, and distinct, or the runtime fails closed.
- Throttle settings:
  `DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT`,
  `DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT`, and
  `DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS` must all be present and
  parse to bounded positive integers. Missing values do not fall back safely
  for this runtime path; missing or malformed values fail closed.

## Exact-deployment target review

- Exact deployment URL to be smoked is known:
  `https://deraledger-staging-git-main-ralphs-projects-25fcfa46.vercel.app/admin`
- The likely deployment class is a Vercel preview/branch deployment, but the
  exact Vercel target classification could not be independently confirmed from
  the available local tooling in this workspace.
- The repo has no linked `.vercel` project metadata, and `vercel` CLI is not
  available here.
- Because the exact deployed env target could not be inspected directly, this
  review cannot prove that the deployment currently serving that URL has:
  the route flag present and false, the required readiness keys present, the
  exact readiness origin compatible with that URL, or staging-aligned
  environment-label values.

## Custom staging-domain status

The earlier custom staging-domain `404` remains treated as a deployment-domain
mismatch, not as proof that the reviewed route source was absent. This review
does not attempt to reclassify or reuse that domain for re-enable approval.

## Current safe state

- No environment value was changed during this review.
- No database was touched.
- No staging or production DB action occurred.
- No route flag was enabled.
- No smoke run was performed.
- Production remains untouched.

## Conclusion

The source-side readiness env contract is now explicit and complete, but the
exact deployment currently serving the reviewed staging smoke URL has not been
independently verified for key presence or target alignment from the available
workspace tooling. Staging route re-enable approval should remain blocked until
that exact deployment target is reviewed through a linked Vercel mechanism or
equivalent names-only deployment inspection.

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
