# Admin readiness staging provider setup approval plan

Date: 2026-08-29

## Scope

This is a docs-only approval plan for later staging Upstash Redis provider and
account/resource setup for the admin readiness security backend. It creates no
code, dependency change, environment change, provider account or resource,
credential, database action, staging mutation, production mutation, runtime
adoption, route-flag enablement, M030 issuance, approval execution,
activation, collection unlock, or payment/provider/checkout/subscription/
invoice/storefront behavior.

The route flag must remain unset or false throughout this plan:

`DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED !== "true"`

## Current safe state

The currently approved state on 2026-08-29 is:

- durable Redis security adapters are committed
- the staging provider/environment runbook is committed
- the admin readiness routes remain disabled by default
- no provider is configured
- no credentials have been created or imported
- no staging or production release is approved
- no route-flag enablement is approved

This plan is approval-only. It does not authorize creating or configuring any
provider resource yet.

## Provider setup decision

The later provider setup, once separately approved, must use:

- a dedicated staging Upstash Redis resource
- a resource that is separate from production
- no shared production/staging Redis resource
- no in-memory fallback for the durable path
- no provider analytics unless separately reviewed

The purpose of this plan is to obtain approval for that later provider setup
decision, not to perform it now.

## Human setup steps for later execution

After this plan is approved and a separate execution task is authorized, the
human operator should:

1. Create or select an Upstash account.
2. Create a dedicated staging Redis resource.
3. Confirm the resource exposes an HTTPS REST URL and token.
4. Confirm the resource is clearly identified as staging-only.
5. Record the resource identity without exposing the token.
6. Leave Vercel environment import for a separate later approval step.

Nothing in this plan authorizes performing those steps now.

## Credential boundaries

The later staging credentials must obey all of the following:

- `UPSTASH_REDIS_REST_URL` must be staging-only
- `UPSTASH_REDIS_REST_TOKEN` must be staging-only
- credentials must never be committed to the repository
- credentials must never be pasted into chat or an agent prompt
- credentials must never use `NEXT_PUBLIC` names
- production credentials must not be used

The plan does not permit any credential creation in this task.

## Future staging environment values

The following are documented as future-only staging env targets. They are
placeholders only and must not be set by this task:

- `DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT=staging`
- `DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT=staging`
- `DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN=https://deraledger-staging.vercel.app`
- `DERALEDGER_ADMIN_READINESS_SECURITY_NAMESPACE=admin_readiness_staging_v1`
- `UPSTASH_REDIS_REST_URL=<staging-only Upstash Redis REST URL>`
- `UPSTASH_REDIS_REST_TOKEN=<staging-only Upstash Redis REST token>`
- `DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY=<staging-only 32+ byte base64url secret>`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY=<staging-only 32+ byte base64url secret, distinct from the CSRF key>`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT=<reviewed staging value>`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT=<reviewed staging value>`
- `DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS=<reviewed staging value>`

Explicitly excluded from this plan:

- `DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED`

## Manual secret generation guidance

When this plan is later executed by a separate approved task, generate the two
HMAC keys locally and keep them out of chat, repos, logs, and shell history.
Use any approved local secret-generation method that produces at least 32
random bytes and encodes them as base64url. Example guidance only:

- generate a 32+ byte random value locally
- base64url-encode it
- keep the CSRF binding key distinct from the throttle subject key
- do not output the secret value to the terminal once generated

This task does not generate or store secrets.

## Future validation checklist

Before any later staging environment import, verify:

- the provider resource is staging-only
- no production Redis is involved
- environment names were reviewed before value import
- no `NEXT_PUBLIC` secret names are present
- no `sb_secret_` values are present in public env
- no `service_role` JWT is present in public env
- the staging origin has no `/admin` path in the Origin env value
- the route flag remains disabled

## Forbidden actions

This plan does not allow any of the following:

- no provider setup in this task
- no credential creation in this task
- no Vercel env import in this task
- no route flag enablement
- no provider connectivity test
- no live M030
- no approval execution
- no activation
- no collection unlock
- no production action
- no payment/provider/checkout/subscription/invoice/storefront behavior

## Next sequence after this doc

The required future sequence is:

1. Review and commit this approval plan.
2. Run a separate approval task for staging Upstash resource creation.
3. Prepare env values locally without importing them yet.
4. Review env names only.
5. Import staging env only after a separate approval.
6. Deploy and check disabled routes.
7. Run the final enablement review.
8. Only then consider whether the staging route flag should be set.

No step in this sequence authorizes production release.

## Safe next step

Approve this plan as a docs-only checkpoint, then keep provider/resource
creation as a separate human execution task with its own approval boundary.
