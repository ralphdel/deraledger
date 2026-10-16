# Phase 2B Solo Plus approve success-path source package

Status: source-only implementation for independent review. The forward-only
success migration is not applied. No approve fixture, deployment, env setup,
approve action, or cleanup is authorized by this document.

The completed first-apply, postflight, rerun, 16 hostile-state, and seven
two-session race results prove the preceding fail-closed migration only.
They are closed evidence and must not be rerun for this source package. The
new success-path migration needs its own disposable PostgreSQL compilation,
first-apply/rerun, rollback, behavior, and two-session tests before any
staging planning. Offline tests cannot establish database atomicity.

## Transaction and writer boundary

`20261015000000_phase2b_approve_success_atomic.sql` requires the reviewed
fail-closed approve RPC body and unchanged legacy v1 body before replacing
only the separate approve RPC. v1 continues to handle RMI/reject and remains
fail-closed for approve. The approve RPC still requires the exact server-
resolved fixture run ID and synthetic scope.

Approval locks the case first, checks the expected version, and checks review
intent before payment or requirement reads. It locks the pointed-to payment
with NOWAIT, verifies successful status, case/merchant linkage, amount,
currency, purpose and synthetic provenance, then locks every other successful
qualifying payment. Exactly one qualifying success, the pointed-to row, is
required. Same-onboarding-session subscription successes are included.
Duplicate, missing, wrong-purpose, stale, or lock-busy payment states return
a safe conflict.

The RPC locks each of six requirements in canonical code order with NOWAIT,
checks passed state and synthetic evidence, then requires a total count of
six. AFTER STATEMENT child triggers inspect transition tables, lock each
affected case in UUID order, and advance its version once per trigger firing
only for material approval-relevant changes while the synthetic case is paid
and review-sensitive. A no-op update, a payment merely sharing a session, or
six requirements written in one statement cannot add six versions. Payment
relevance requires the case payment pointer, a successful case-linked payment,
or a successful onboarding subscription linked by session. An approved case
rejects material child changes. A later child statement cannot commit after
approval: its statement trigger waits for the case lock, then aborts.
An `INSERT ... ON CONFLICT DO UPDATE` that both inserts and updates can fire
both statement triggers and advance the version twice for one affected case;
the fixture must use the final observed version.

Legacy payment-first confirmation/recovery run while their cases are pending;
the child trigger locks the case but does not advance its version, leaving the
existing case UPDATE as the single version increment. Approval's NOWAIT child
locks avoid waiting behind a payment writer that is waiting for the case.
The case-side trigger validates a new payment pointer under a payment lock,
requires consistent case/merchant/session/purpose/amount/currency, and rejects
ambiguous successful payments when marking paid. It permits valid initial
linking before review, but paid or review-sensitive cases cannot relink even
with a larger row version. Direct requirement upserts cannot bypass the
statement trigger. Separate SQL statements can each advance the version; a
fixture must read the final actual version rather than assume version 1.

After every locked check, one case UPDATE sets approved and increments
`row_version`; one `case_approved` event INSERT follows in the same RPC
transaction. A uniqueness conflict rolls back the update subblock. An exact
replay returns the original event before the stale-version check; conflicting
key reuse returns `idempotency_conflict`. The repository now accepts the
reviewed success and replay outcomes, while the reviewer service permits
only a same-key completed replay under the same exact staging scope.
Orchestration checks a visibly stale fresh-case version before its advisory
eligibility read and lets approved-case replay reach the locked RPC.

The approve RPC does not call activation or mutate subscriptions, onboarding,
plans, merchant activation, providers, settlement, refunds, or live features.
Activation remains a separate controlled handoff. The child guard rejects
eligibility-changing writes to an approved synthetic fixture; any eventual
fixture teardown requires its own reviewed procedure and approval.

## Remaining review and validation

Review the migration's pre/post-DDL catalog assertions and the synthetic-
scope trigger effects on existing writers. Validate the success migration
only in a separately approved disposable database using new success-path
tests, including missing/duplicate payment, wrong purpose/linkage, missing/
duplicate/changed requirement, stale version, exact replay, conflicting
reuse, no-op and six-row statement version behavior, confirmation/recovery
single increments, concurrent child changes, late event failure rollback, and unchanged
RMI/reject behavior. Do not treat the prior fail-closed race matrix as proof
of this success path.
