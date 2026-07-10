# Solo Plus Phase 2 Commit 7 Closeout

Scope:

```txt
Payment initiation and payment-confirmation lifecycle for Solo Plus onboarding subscription and Solo Lite -> Solo Plus upgrade.
```

Deployment reconciliation:

```txt
Commit 7 now depends on a separate Breet substrate repair unit.
Historical root-level SQL files remain archival reference material and are not deployment scripts.
Ordered deployment is:
1. 20260707_01_breet_payment_substrate_reconciliation.sql
2. 20260707_02_solo_plus_payment_lifecycle.sql
```

Confirmed staging drift:

```txt
Staging was missing payment_sessions, crypto_payment_sessions, settlement_records, treasury/settlement support tables, current Breet invoice functions, and Breet/crypto platform settings.
The failed single Commit 7 migration had already added payment_records.onboarding_session_id, payment_records.solo_plus_case_id, and the Commit 7 payment-record indexes.
Those partial additions are preserved and Migration B is guarded to resume safely from that state, but PostgreSQL execution must still prove the guarded DDL path before staging use.
```

Implemented:

```txt
Canonical payment linkage through payment_records.solo_plus_case_id.
Relational Breet session linkage through crypto_payment_sessions.payment_record_id.
Shared atomic confirmation RPC that marks payment paid and moves the Solo Plus case to verification_pending.
Provider support limited to Paystack, Monnify, and Breet platform plan payments.
```

Explicitly deferred:

```txt
Solo Plus renewal.
Activation and plan switching after payment.
Setup-mode clearing.
Capability enablement.
Admin approval and KYC orchestration beyond verification_pending.
```

Breet protection:

```txt
Customer invoice crypto collection remains isolated from platform subscription and upgrade payments.
Solo Plus uses only Breet plan_subscription and plan_upgrade with platform settlement attributes.
trade.address.created and trade.pending remain non-terminal.
trade.completed is the only confirming Solo Plus Breet event.
```

Validation status:

```txt
Designed behaviour: documented and implemented in the ordered migration chain.
Locally statically validated behaviour: repository audit, SQL source/test review, TypeScript checks, and build checks passed.
Runtime PostgreSQL harness validation: passed in the disposable PostgreSQL harness, including clean apply, rerun, guarded negative cases, and rollback checks for Migration A and Migration B.
Staging-verified behaviour: passed. Migration A and Migration B both applied successfully on staging, printed COMMIT, exited with code 0, and passed post-apply verification with exit code 0.
Staging security verification: passed. Migration A substrate tables exist, payment_events remains internal-only with RLS intentionally disabled, zero policies, and zero PUBLIC/anon/authenticated grants; merchant-readable tables retain authenticated SELECT only with RLS enabled and merchant/team scoped policies; internal-only tables retain zero browser grants.
Migration B verification: passed. Staging verification confirmed Solo Plus payment-lifecycle columns, foreign keys, indexes, check constraints, and that the Migration A security model remained intact after Migration B.
confirm_solo_plus_payment_v1 privilege verification: passed. function_count = 1, service_role_can_execute = true, anon_can_execute = false, authenticated_can_execute = false, ACL shows service_role EXECUTE only, and search_path = public, pg_temp.
Commit 7 staging-migration status: complete. Deployment, production rollout, and feature flags remain blocked pending separate release approval and sign-off.
```
