# Phase 2 Production Readiness Route-Security Diagnostic

## Status and scope

The temporary production response diagnostic is closed and removed. It was
introduced after production smoke from `https://admin.deraledger.com` returned
`400 origin_denied` despite the browser using the reviewed production admin
origin. The diagnostic and retained local audit identified configuration
errors, the environment was corrected externally, and the production
route-security smoke then passed.

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

The subsequent names-only production audit found exactly five browser-visible
variables. In addition to the three already documented public Supabase and
Paystack names, it found `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_APP_ENV`.
These are intentional public application metadata, so both are now included
in the explicit allowlist. Neither name matched the prior forbidden-name
expression, so ordinary values under these names were already accepted; the
new entries make that contract explicit and protect it with regression tests.

The allowlist applies to names only. All allowlisted variables still undergo
the fail-closed sensitive-value checks, so an `sb_secret_` value or a JWT whose
role is `service_role` remains rejected. Any `NEXT_PUBLIC_*` name containing a
service-role, secret, private, password, or token marker also remains rejected,
including `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SECRET_KEY`,
`NEXT_PUBLIC_PRIVATE_KEY`, and `NEXT_PUBLIC_ACCESS_TOKEN`. The diagnostic does
not return variable names or values. Consequently, the two intentional public
keys alone did not explain the earlier exposure category, and neither do the
two application metadata names by themselves. With the names-only audit now
complete, a sensitive-shaped value under one of the five audited names remains
the likely policy trigger if the diagnostic persists. This source refinement
does not weaken that value-level rejection. A later production smoke decision
remains separate and explicitly gated.

Production continued to report browser-visible secret exposure after the
names-only audit. The next diagnostic step was therefore a local-only value-shape
audit using `scripts/audit-readiness-public-env.ts`. The script and runtime
policy share the same classifier. It inspects only `NEXT_PUBLIC_*` variables
and prints only `PASS|<key-name>|<fixed-reason>` or
`BLOCKED|<key-name>|<fixed-reason>`; it never prints values or JWT payloads.

The operator may create the ignored local file
`.env.production-public-audit.local` with the five production public variables
and run:

```text
# Local template only: replace each placeholder on the operator's machine.
NEXT_PUBLIC_APP_URL=<local-value>
NEXT_PUBLIC_APP_ENV=<local-value>
NEXT_PUBLIC_SUPABASE_URL=<local-value>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local-value>
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY=<local-value>
```

Then run:

```text
npx tsx scripts/audit-readiness-public-env.ts .env.production-public-audit.local
```

The file is covered by the repository's `.env*` ignore rule and must never be
committed. Production environment values must not be pasted into chat or
checkpoint evidence. Exit code `0` means no inspected variable was blocked;
exit code `1` means at least one variable was blocked or the requested file
could not be read. A missing optional file emits only
`WARN|LOCAL_ENV_FILE|file_missing` and audits the current process environment.

## Final root cause

The production environment contained two incorrect Supabase credentials:

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` contained a `service_role` key instead of the
  browser-safe anonymous key. The local audit correctly reported
  `BLOCKED|NEXT_PUBLIC_SUPABASE_ANON_KEY|sensitive_value_pattern`.
- `SUPABASE_SERVICE_ROLE_KEY` contained the wrong secret API key instead of the
  production service-role credential expected by the server-only client.

The values were corrected externally without recording them in source,
evidence, or chat. The retained local audit then reported `PASS` for all five
reviewed public variables.

## Production smoke evidence

After the environment correction, the production route-security smoke passed:

- `/issue` returned `201 csrf_issued` with the synchronizer token present and
  no `productionDiagnostic` field.
- `/snapshot` without CSRF returned `400 csrf_denied`.
- `/snapshot` with valid CSRF and a random UUID returned
  `404 canonical_snapshot_v2_request_missing`.

These checks exercised route security only. They did not issue M030/live
readiness, execute approval, activate a merchant, unlock collection, or invoke
payment/provider/checkout/subscription/invoice/storefront behavior.

## Diagnostic removal and retained safeguards

The temporary `productionDiagnostic` response construction, production-only
request gate, and diagnostic-only route tests have been removed. Normal
`origin_denied` responses are again only the stable `400` denied envelope.

The following permanent safeguards remain:

- the shared browser public-environment classifier;
- the local-only `scripts/audit-readiness-public-env.ts` safety tool;
- permanent browser-secret exposure policy and regression tests;
- disabled-by-default route-flag enforcement;
- origin, authority, session-binding, throttle, and durable CSRF protections;
- opaque client failures and redacted operational logging.

## Safe state

- `DB_TOUCHED=NO`
- `STAGING_DB_TOUCHED=NO`
- `PRODUCTION_TOUCHED=NO`
- `ENV_CHANGED=NO`
- `ROUTE_FLAG_CHANGED=NO`
- `PRODUCTION_RELEASE=NO`
- No database, environment, route-flag, deployment, or business action was
  performed by this source cleanup task.
