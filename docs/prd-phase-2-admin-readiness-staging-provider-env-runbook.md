# Admin readiness staging provider and environment runbook

Date: 2026-08-29

## Scope

This is a docs-only staging provider and environment configuration runbook plus
release checklist for the disabled-by-default admin readiness issue and
snapshot routes. It creates no code, environment change, provider account
setup, credential creation, database action, staging mutation, production
mutation, runtime adoption, production release, M030 issuance, approval
execution, activation, collection unlock, or payment/provider/checkout/
subscription/invoice/storefront behavior.

This runbook does not authorize route enablement. The route flag must remain
unset or false:

`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED !== "true"`

## Current safe state

The currently approved state on 2026-08-29 is:

- durable Redis-backed security adapters are committed in source only
- the issue and snapshot routes still exist in disabled-by-default form
- no provider credentials are configured
- no admin-readiness environment values are configured
- no staging or production release is approved
- no route-flag enablement is approved

This runbook is preparation for a future staging-only configuration review. It
is not permission to configure anything now.

## Staging admin URL handling

The future staging admin surface uses the existing staging deployment:

- staging main URL: `https://deraledger-staging.vercel.app/`
- staging admin UI path: `https://deraledger-staging.vercel.app/admin`
- staging CORS/admin origin: `https://deraledger-staging.vercel.app`

Important distinction:

- `/admin` is a browser route path, not an Origin
- Origin means scheme plus host only
- `https://deraledger-staging.vercel.app/admin` must never be stored as the
  admin origin value
- `https://deraledger-staging.vercel.app` is the only approved staging origin
  value for this runbook

Do not use `admin.deraledger-staging.vercel.app` unless a later custom-domain
review confirms that it actually exists, verifies, and serves the intended
staging deployment with valid TLS.

## Production admin URL handling

This runbook distinguishes between the current and future production states:

- current production admin UI path: `https://www.deraledger.com/admin`
- current production origin: `https://www.deraledger.com`
- future target production admin UI: `https://admin.deraledger.com`
- future target production origin: `https://admin.deraledger.com`

The future target production admin origin is blocked until all of the
following are complete and verified:

- the correct Vercel production project has `admin.deraledger.com` added under
  Project Settings -> Domains
- Cloudflare DNS contains the exact required admin subdomain record that
  Vercel specifies
- Vercel domain verification succeeds
- TLS/SSL issuance succeeds

Until that work is complete, no production route configuration may assume that
`https://admin.deraledger.com` is active.

## Required future production domain setup

Before any future production origin transition:

1. Add `admin.deraledger.com` to the correct Vercel production project domain
   list.
2. Add the exact DNS record required by Vercel in Cloudflare DNS.
3. Prefer DNS-only validation first until Vercel verification and TLS are
   fully green.
4. Confirm that `https://admin.deraledger.com` serves the intended production
   project and presents valid SSL before any app configuration depends on it.

This runbook does not authorize performing those steps. It records the
required boundary only.

## Required staging provider setup later

The future staging configuration must use dedicated staging-only durable
storage:

- one dedicated staging Upstash Redis resource
- one staging-only Redis REST URL
- one staging-only Redis REST token
- one staging-only namespace
- no production Redis credential reuse
- no shared production/staging Redis resource
- no in-memory staging fallback for the durable path
- no in-memory production fallback

The durable security adapters already fail closed when configuration is absent
or invalid. That fail-closed posture must remain intact until real staging
configuration is separately reviewed and supplied.

## Required staging environment contract later

The following values are future staging-only configuration targets. They are
documented here for later review only and must not be set by this task:

- `DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT=staging`
- `DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT=staging`
- `DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN=https://deraledger-staging.vercel.app`
- `DERALEDGER_ADMIN_READINESS_SECURITY_NAMESPACE=admin_readiness_staging_v1`
- `UPSTASH_REDIS_REST_URL=<staging-only Upstash Redis REST URL>`
- `UPSTASH_REDIS_REST_TOKEN=<staging-only Upstash Redis REST token>`
- `DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY=<staging-only 32+ byte base64url secret>`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY=<staging-only 32+ byte base64url secret distinct from the CSRF key>`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT=<reviewed staging value>`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT=<reviewed staging value>`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS=<reviewed staging value>`

The route flag is intentionally excluded from this contract because this
runbook does not authorize enabling the routes.

## Route flag boundary

For this runbook:

- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` must remain unset or false
- no staging flag enablement is approved
- no production flag enablement is approved
- route enablement is a later, separate, controlled decision after staging
  configuration, staging deployment checks, and a final enablement review

The presence of complete staging configuration values alone must not be
treated as permission to enable the routes.

## Safety checks before any future staging setup

Before any future staging environment import or configuration review:

- no `NEXT_PUBLIC_` variable may contain secrets
- no `sb_secret_` value may appear in any public environment variable
- no legacy `service_role` JWT value may appear in any public environment
  variable
- `DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT` must be exactly `staging`
- the Redis resource must be staging-only
- any production Redis credential must be rejected
- any production Supabase label must be rejected
- `DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN` must be exactly
  `https://deraledger-staging.vercel.app`
- the `/admin` path must not appear in the Origin environment value
- origin, domain, CSRF, throttle, session binding, and provider config remain
  defense-in-depth only, not authority
- authority remains:
  `auth.getUser() -> resolver -> app_metadata.is_super_admin === true`
- `user_metadata` is not authority

## Validation commands for future staging review

These are documentation-only checks for a later explicit staging review. Do
not run any staging or production mutation from this task.

- Names-only environment inventory:
  `vercel env ls`
- Safe names-only review of required env keys after import, without echoing
  secret values:
  `vercel env ls | rg "DERALEDGER_ADMIN_READINESS|UPSTASH_REDIS"`
- Public-environment names review to ensure no admin-readiness secret is under
  a `NEXT_PUBLIC_` key:
  `vercel env ls | rg "NEXT_PUBLIC_|DERALEDGER_ADMIN_READINESS|UPSTASH_REDIS"`
- Disabled-route flag review:
  verify `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED` is absent or not `true`
- Package/test checks:
  `npx tsx tests/admin-readiness-route-security-primitives.test.ts`
  `npx tsx tests/admin-readiness-csrf-lifecycle.test.ts`
  `npx tsx tests/admin-readiness-release-gates.test.ts`
  `npx tsx tests/admin-readiness-route-composition.test.ts`
  `npx tsx tests/admin-readiness-routes.test.ts`
  `npx tsc --noEmit`
  `git diff --check`
- Disabled-route staging deploy check:
  verify deployed routes still return the disabled opaque response while the
  flag remains unset or false
- Provider connectivity check:
  allowed only after a separate explicit approval for staging-only provider
  verification

Any future command execution must avoid printing secret values, raw provider
tokens, or derived secret material into logs, shells, or captured evidence.

## Explicit forbidden actions

This runbook does not allow any of the following:

- no production environment setup
- no production Redis setup
- no provider credential creation in this task
- no route-flag enablement
- no live M030 readiness issuance
- no approval execution
- no activation
- no collection unlock
- no payment/provider/checkout/subscription/invoice/storefront behavior

## Required review sequence

The required future sequence is:

1. Review and commit this docs-only runbook.
2. Obtain explicit approval for provider account/resource setup.
3. Obtain explicit approval for staging environment value preparation.
4. Obtain explicit approval for staging environment import/configuration.
5. Run a disabled-route staging deploy and validation check.
6. Run a final route-enable review.
7. Only then consider a separate controlled decision about setting the route
   flag in staging.

No step above authorizes production release.

## Safe next step

Review this runbook, commit it with exact `git add` paths only, and keep all
existing untracked evidence or artifact files out of the commit. The next
separate task, if approved later, is provider account/resource setup planning,
not route enablement.
