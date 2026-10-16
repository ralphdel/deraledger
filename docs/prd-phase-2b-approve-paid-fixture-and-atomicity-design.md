# Phase 2B approve paid-fixture and atomicity design

**Status: source-only fixture design. A successful atomic approve source
migration has been prepared but has not passed disposable PostgreSQL
verification or been applied. No executable fixture is reviewed. Approve
fixture planning, creation,
preflight execution, env changes, deployment, action, and cleanup remain blocked.**
Each later mutation needs its own explicit approval. This design uses no prior
RMI or reject case, run ID, payment, merchant, or workspace.

## Decision and exact target

Create a **separate approve-only fixture procedure**, rather than extending
`scripts/phase2b-admin-detail-fixture-staging.ps1`. That procedure deliberately
requires an unpaid case and its cleanup refuses payment descendants. Changing
those invariants would weaken the completed RMI/reject boundary. The future
approve procedure needs independent create, read-only preflight, and guarded
cleanup modes, each separately reviewed and authorized. No procedure is
implemented here.

The future create mode must use one fresh, isolated synthetic staging merchant
and workspace with no real customer identity, provider account, documents,
settlement account, subscription, or production link. Prefer an `upgrade`
case with synthetic `solo_lite` source-plan context. In one transaction, create
or prepare only the exact case UUID and `phase2b-approve-YYYYMMDD-<random>` run
ID, then establish this final boundary:

| Field | Required pre-action value |
| --- | --- |
| Case | `manual_review`; derived `review_state=under_review` (not a physical column); `action_required=none` |
| Payment | `payment_status=paid`; `refund_status=none`; non-null `payment_record_id` identifying exactly one linked `payment_records` row owned by this case with `payment_status=successful`; no other linked payment attempt |
| Requirements | Exactly the six canonical codes, each `passed` with synthetic manual evidence and a completion timestamp; no `waived` or `reused` shortcut |
| Version | Read the actual positive `row_version` after every fixture write commits; bind preflight and approve to that exact value. Do not assume version 1. |
| Marker | `audit_metadata.fixture_scope=phase2b_approve_acceptance`, exact `fixture_run_id`, and `synthetic_approve_acceptance=true` |
| Review and activation | No earlier review decision, approval, activation key/event, active Solo Plus subscription, collection unlock, or live feature |

The successful row is **synthetic ledger test data**, not proof that money moved.
Use a unique fixture-prefixed internal reference and matching synthetic amount,
currency, purpose, and merchant ownership. Provider name/reference/payload,
customer email, real instrument, charge, webhook, and settlement fields remain
empty. The schema permits nullable provider fields, but a later source and
schema review must verify all constraints, RLS/grants, and downstream consumers
before choosing final values. Never call payment initialization, provider
confirmation, recovery, or webhooks to produce this row. A future fixture
writer must fail closed if any real record or existing payment is encountered,
and prevent the synthetic row from entering collection, reconciliation,
notification, recovery, refund, or provider processing. This isolation has not
been proven yet. If it cannot be proven, do not create the paid fixture.

The six synthetic `passed` rows may use `manual_submission` evidence IDs and
fixture-marked notes; they must not reference verification logs, uploaded
documents, provider responses, or settlement accounts. A later review must
prove these fields satisfy the current requirements policy without implying
real verification. Cleanup must identify every descendant by exact case/run
marker, refuse unrelated rows, and be reviewed separately; do not reuse the
unpaid fixture cleanup.

## Atomicity hardening required before execution planning

The historical seven-argument approve branch remains fail-closed. The
separate approve RPC has a prepared success-path source migration, but its
new statement-level child guards and paid-link validation have not been
compiled or race-tested in PostgreSQL. Payment confirmation and recovery
still lock a payment row before the case. The approval RPC therefore keeps
NOWAIT child locks. A case `row_version` and preflight cannot by themselves
stabilize child rows before this migration is proven and applied.

**Current source: fail-closed predecessor plus unverified approve-success
migration.** Defer the approve-only fixture procedure until the success
migration has independent review and disposable-database concurrency evidence.
The fixture writer must consume a proven boundary.

Approval locks **case, linked payment, then requirements in canonical code
order**. Payment confirmation and recovery still lock payment first. Their
child statements reach an AFTER STATEMENT parent-case guard; approval uses
`NOWAIT` child locks so it can fail closed instead of waiting behind a
payment-first writer. Disposable two-session tests must prove this interaction
and its error mapping. No legacy payment lock-order change is part of this
source package.

The prepared forward-only migration and repository path must satisfy these
conditions before execution planning:

1. Preserve the seven-argument review RPC for RMI/reject while making its old
   approve branch fail closed. The exact fixture run ID is not among those
   seven arguments, so a new approve-specific RPC must receive it from the
   server-side gate and check it inside the transaction. See the
   [forward-only atomicity package](prd-phase-2b-approve-atomicity-hardening-source-package.md).
   Preserve case `FOR UPDATE`, state, idempotency, and expected-version checks.
   In the new approve RPC, acquire stable locks on the linked successful payment
   row and all six canonical requirement rows before rechecking eligibility,
   ownership, amount/currency/purpose, count, states, `refund_status=none`,
   and no prior activation in the same transaction. The lock query must not
   substitute an unlocked aggregate read. Lock-busy and stale boundaries must
   fail closed without an automatic approve retry.
2. The prepared success migration uses AFTER STATEMENT transition-table
   triggers to serialize material payment and requirement changes through the
   parent case and advance its version once per trigger firing when the
   synthetic case is paid and review-sensitive. No-op changes and unrelated
   session payments must not advance it. Payment confirmation and recovery
   retain their own single case increment while the case is pending. This
   allows a mixed `INSERT ... ON CONFLICT DO UPDATE` to advance twice if both
   statement trigger events contain material rows; the preflight uses the
   final observed version. This contract requires disposable-database proof,
   including direct upserts and
   deletes; application prechecks are not a substitute.
3. The prepared case-link guard validates initial payment linkage under lock
   and rejects paid/review-sensitive relinking. Its compatibility with normal
   confirmation and recovery requires disposable-database proof. Direct table
   writes and background workers must not bypass the guarded contract.
4. Fail approval if the payment or any requirement is missing, ineligible,
   changed, or lock-busy. Preserve one case update and one `case_approved`
   event. Do not call activation or subscription, onboarding, plan, provider,
   settlement, refund, collection, or live-feature code.

Required database regression coverage in a disposable local PostgreSQL
environment: unpaid case, missing/wrong/unlinked/unsuccessful payment,
incomplete requirement set, mismatched fixture marker, stale case version,
requirement update/insert/delete races, payment status/link/amount races,
payment-confirmation and recovery lock-order deadlock cases, and no side
effects. Static or
in-memory tests in this package detect the current gap but cannot prove
transactional safety. Do not apply or execute any SQL under this package.

## Future acceptance boundaries (not authorized)

After the fixture procedure and atomicity migration each pass independent
source/security review and disposable-database rehearsal, separately approve
a staging read-only preflight. It must verify exact staging identity, case/run
marker, the freshly read exact version, synthetic merchant/workspace/payment
provenance, six
requirements, no other review/payment/activation descendants, and a private
fingerprint of payment, requirements, plans, subscriptions, and features. Only
after a fresh passing preflight may exact env values and deployment be
considered for separate approval. The approve action requires its own approval
and one fresh expected-version/idempotency boundary; no retry or replay.

Separately approved postflight must prove pre-action version plus one, one
`case_approved` event,
unchanged synthetic payment and requirement snapshot, no activation, and no
plan/subscription/onboarding/collection/provider/refund/settlement side effect.
Then separately approve removing temporary gate env values and restoring the
default-blocked staging deployment. Guarded paid-fixture cleanup and read-only
postcleanup require another approval. Production remains outside this package.
