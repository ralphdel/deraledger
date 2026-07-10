# Solo Plus Phase 2 Roadmap

## Commit 7

```txt
Payment initiation and payment-confirmation lifecycle
```

Deployment note:

```txt
Historical root-level Breet SQL files are archival inputs only. They are not the deployment chain.
Canonical deployment now uses ordered migrations:
1. 20260707_01_breet_payment_substrate_reconciliation.sql
2. 20260707_02_solo_plus_payment_lifecycle.sql
These migrations are locally statically validated, passed disposable PostgreSQL harness validation, and are applied and verified on staging.
Commit 7 is staging-migration complete.
Deployment, production rollout, and feature flags remain blocked until separate release approval and sign-off.
```

Confirmed staging drift:

```txt
Staging missed the historical Breet substrate and partially applied the original Commit 7 migration.
The partial state already includes payment_records.onboarding_session_id, payment_records.solo_plus_case_id, and the related Commit 7 payment-record indexes.
The repair path reconciled the substrate first, then resumed the narrowed Solo Plus migration. Disposable PostgreSQL harness validation passed, and both ordered migrations are now applied and verified on staging.
```

Rules:

```txt
Create or reuse the Solo Plus case before payment initialization.
Create the canonical pending payment_records row before provider initialization.
Use payment_records.solo_plus_case_id as the authoritative Solo Plus payment linkage.
Use crypto_payment_sessions.payment_record_id for Breet platform plan-payment sessions.
Payment confirmation moves the case only to verification_pending.
Payment confirmation must not activate Solo Plus, change subscription_plan, clear setup mode, or enable capabilities.
Solo Plus renewal remains deferred until post-approval renewal rules are implemented.
```

Provider isolation:

```txt
Breet supports two isolated payment purposes:

1. Customer invoice and eligible storefront crypto collections that settle to merchants.
2. Merchant subscription and upgrade payments that settle to DeraLedger.

Solo Plus may use only the existing platform-settled Breet plan-payment path.
```
