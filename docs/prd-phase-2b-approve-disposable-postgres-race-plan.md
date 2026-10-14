# Phase 2B approve atomicity: disposable PostgreSQL race plan

**Source plan only. No database session was opened for this package.** Run this
only in a fresh disposable PostgreSQL instance after independent migration
review. Never point a harness at staging or production. The fail-closed RPC in
the current migration must return `state_conflict` in every eligible scenario;
success-path races require a later writer-protocol migration and review.

Build one isolated synthetic case per scenario, with a unique exact run ID,
linked synthetic successful payment, six synthetic passed requirements, and
known row version. Use no provider, document, customer, settlement, or live
subscription data. Have a coordinator open two sessions with finite statement
and lock timeouts, record both transaction IDs, and enforce a barrier after the
first lock acquisition. Abort on an unexpected schema, grant, function
overload, or fixture state. Preserve a sanitized first error and roll back the
disposable database after each scenario.

| Schedule | Session A | Session B | Current required result |
| --- | --- | --- | --- |
| Payment-first legacy overlap | Lock linked payment, then wait for case | Lock case via approve RPC, attempt payment `NOWAIT` | B returns conflict promptly; no deadlock |
| Requirement update overlap | Lock or update one requirement | Call approve RPC after A holds row | B returns conflict; no review event |
| Payment drift before approve | Commit changed payment status/amount | Call approve with the old case version | B returns conflict; no review event |
| Requirement drift before approve | Commit changed state/evidence | Call approve with the old case version | B returns conflict; no review event |
| Case version drift | Increment case version under lock | Call approve with previous version | B returns version conflict |
| Marker or run drift | Change case marker under lock and commit | Call approve with original run ID | B returns conflict |
| Concurrent approve | Hold case lock | Call approve for same case | B waits or times out without an event; after release it still conflicts |

Also test unpaid case, missing/unlinked payment, wrong merchant, unsuccessful
payment, a second linked successful payment, each of six unsatisfied
requirements, a missing requirement, stale
version, and wrong fixture scope/run independently. Inspect final case,
payment, requirements, event count, and side-effect tables after every run.
Expected now: case version and event count unchanged; no activation, payment,
subscription, onboarding, plan, provider, settlement, refund, or live-feature
effect. Test both first migration apply and rerun, rejection of incompatible
prerequisites, service-role-only grants, and transaction rollback on error.
The current RPC always conflicts, so a duplicate-payment case returning
`state_conflict` does not prove duplicate detection. Add an explicit check or
constraint before any future success path.

Before a later success-path RPC can be reviewed, implement parent-case/version
discipline for every requirement and linked-payment writer, then repeat these
schedules with both winner orders. Approval may succeed only after all locks
and rechecks; the competing writer must either advance the case version first
or fail after approval. The current static tests cannot establish those races.
