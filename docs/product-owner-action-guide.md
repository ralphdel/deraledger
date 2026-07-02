# DeraLedger Product Owner Action Guide
## What You Must Personally Handle and How to Manage the Smart Storefront Build

## Document Purpose

This guide is for the DeraLedger product owner/founder. It explains the exact things you must personally handle while the coding agent builds the Smart Storefront project.

The coding agent can write code, propose implementation plans, create migrations, run tests, and produce reports. However, the coding agent must not make product, compliance, provider, legal, pricing, or production-release decisions on your behalf.

## 1. Your Main Role

Your job is to act as product owner, compliance gatekeeper, and release approver.

You are responsible for:

```txt
Approving phase scope.
Approving product behavior.
Approving compliance rules.
Approving provider assumptions.
Protecting production credentials.
Testing core user journeys manually.
Approving merges and rollout.
```

You should not allow the coding agent to move from one phase to another without your approval.

## 2. Files You Should Put in the Repo

Create a `/docs` folder in your repo and add these files:

```txt
/docs/deraledger-smart-storefront-prd.md
/docs/deraledger-coding-agent-build-contract.md
/docs/product-owner-action-guide.md
/docs/storefront-phase-exit-report-template.md
/docs/storefront-test-checklist.md
```

Recommended practical command:

```bash
mkdir -p docs
```

Then paste each document into the right file.

## 3. How to Start Each Phase

Before starting a phase, open a new agent session and use this prompt:

```txt
Read these documents first:

/docs/deraledger-smart-storefront-prd.md
/docs/deraledger-coding-agent-build-contract.md

We are implementing Phase [X]: [PHASE NAME] only.

Do not code yet.

First produce an implementation plan showing:
1. PRD sections covered
2. Exact phase scope
3. Explicit non-scope
4. Files expected to change
5. Database migrations needed
6. Feature flags involved
7. Existing flows that must remain untouched
8. Tests to add/update
9. Manual QA checklist
10. Risks, assumptions, and questions

Wait for my approval before coding.
```

Do not let the agent code until it gives you the plan.

## 4. How to Review the Agent's Implementation Plan

When the agent gives a plan, check these things:

```txt
Does the plan only cover the current phase?
Did it mention the exact PRD sections?
Did it list files that make sense?
Did it avoid future features?
Did it protect existing invoice, checkout, reference, Record Invoice, Collection Invoice, deposit, and settlement flows?
Did it include tests?
Did it include feature flags?
Did it identify risks and assumptions?
```

If anything looks broad or unclear, respond:

```txt
Do not code yet. Tighten the scope. Remove anything outside Phase [X]. Explain how existing invoice, checkout, payment reference, Record Invoice, Collection Invoice, deposit, and settlement flows will be protected.
```

Approve only when the plan is tight.

## 5. Exact Things You Must Decide Yourself

## 5.1 Product Scope Decisions

You must personally approve:

```txt
Final PRD version.
Each phase scope.
Any change to phase order.
Any new feature not in the PRD.
Any feature the agent wants to move earlier.
Any change to Instant Sale or Receivable Sale behavior.
Any change to merchant confirmation before deposit.
Any change to discount calculation.
Any change to rating visibility.
```

The agent can suggest. You decide.

## 5.2 Pricing and Plan Decisions

You must personally decide:

```txt
Starter remains free.
Solo Lite remains NGN 5,000/month.
Solo Plus remains NGN 13,000/month.
Business remains NGN 20,000/month.
Whether existing Individual users are automatically migrated.
Whether any existing users are grandfathered.
Whether Solo Plus is public, hidden, beta-only, or invite-only.
Whether discount codes are available to all verified Solo Lite merchants or only selected merchants during beta.
```

Recommended decision for now:

```txt
Existing Individual -> Solo Lite automatically.
Solo Plus hidden behind feature flag until Solo Plus KYC is ready.
Discount codes beta-only until Instant Sale is stable.
Receivable Sale beta-only for trusted merchants first.
```

## 5.3 Compliance and Limit Decisions

You must personally approve:

```txt
Solo Lite verification requirements.
Solo Plus enhanced verification requirements.
Business KYB requirements.
Collection cap for Solo Lite.
Approved monthly band for Solo Plus.
Business approved-volume rule.
Internal hidden daily velocity limits.
Single transaction limits.
Outstanding receivable caps.
High-risk product categories.
Merchant suspension rules.
Receivable Sale unlock criteria.
```

Recommended working model:

```txt
Starter: no live collection.
Solo Lite: basic verified collection, Instant Sale only, cumulative cap.
Solo Plus: enhanced verified collection, Instant Sale + Receivable Sale.
Business: KYB verified collection, full storefront features.
```

## 5.4 Provider Decisions

You must personally confirm provider behavior before the agent relies on it.

Confirm:

```txt
Paystack subaccount/split behavior.
Monnify subaccount/incomeSplitConfig behavior.
Breet per-address settlement behavior.
Which provider is active for storefront card/transfer/USSD.
Which provider is active for crypto storefront payment.
Which provider is active for subscription payment.
Whether a provider supports delayed settlement or not.
Whether refunds can be initiated through each provider.
Whether provider webhooks have enough metadata for storefront order reconciliation.
```

For MVP, use direct settlement only.

Do not approve escrow, protected settlement, customer-confirmed release, or delayed settlement unless a provider and legal adviser confirm it.

## 5.5 Legal and Compliance Wording

You must personally approve or get legal review for:

```txt
Terms of service.
Privacy policy.
Data protection policy.
Storefront merchant terms.
Customer checkout terms.
Deposit and reservation wording.
Refund/cancellation wording.
Delivery disclaimer.
Merchant ratings moderation policy.
KYC consent language.
Data retention policy.
NDPC/data protection obligations.
```

The agent can draft, but should not finalize legal wording.

## 5.6 Production Credentials and Security

You must personally manage:

```txt
Production API keys.
Provider dashboard credentials.
Webhook secrets.
Environment variables.
Vercel production environment.
Cloudflare settings.
Database production access.
Payment provider live-mode activation.
```

Do not paste production secrets into general agent prompts.

If the coding agent needs an environment variable, give it the variable name, not the secret value.

Example:

```txt
Use PAYSTACK_SECRET_KEY from environment. Do not hardcode it.
```

## 5.7 Merge and Release Approval

You must personally approve:

```txt
Every branch merge.
Every database migration.
Every production deployment.
Every feature flag activation.
Every beta merchant rollout.
Every public release.
```

The agent should not merge or deploy without your approval.

## 6. Manual Testing You Must Do Yourself

Automated tests are not enough. You must manually test or watch the agent demonstrate the critical flows.

## 6.1 Existing Product Regression Tests

After every phase, test:

```txt
Create normal invoice.
Create Record Invoice.
Create Collection Invoice.
Generate payment reference.
Open checkout link.
Complete sandbox payment.
Confirm webhook updates invoice once.
Confirm duplicate webhook does not duplicate payment.
Confirm existing deposit/reference behavior still works.
Confirm settlement account page still works.
Confirm existing merchant dashboard still works.
```

If any existing flow breaks, stop the phase.

## 6.2 Phase 1 Manual Test: Plan Migration

Test:

```txt
Existing Individual user displays as Solo Lite.
Existing billing amount remains NGN 5,000/month.
Business remains NGN 20,000/month.
Starter remains free.
Old invoices still open.
Old Collection Invoices still work.
Old Record Invoices still work.
Old references still resolve.
Solo Plus is not visible unless feature flag allows it.
```

## 6.3 Phase 2 Manual Test: Compliance Engine

Test:

```txt
Starter cannot create live Collection Invoice.
Solo Lite can collect only after required verification.
Solo Lite cannot use Receivable Sale.
Solo Plus cannot use Receivable Sale before Enhanced approval.
Business cannot collect before KYB approval.
Changing compliance status changes feature access correctly.
```

## 6.4 Phase 3 Manual Test: Solo Plus KYC

Test:

```txt
Merchant can select Solo Plus.
Merchant sees NGN 13,000/month pricing.
Enhanced KYC form works.
Documents upload correctly.
Admin can approve.
Admin can reject.
Admin can request more information.
Receivable Sale unlocks only after approval.
```

## 6.5 Phase 4 Manual Test: Storefront Foundation

Test:

```txt
Merchant creates storefront.
Slug works at /store/business-name.
Merchant can create product.
General product rule applies.
Product override works.
Pickup address displays.
Pickup days and hours display.
Delivery disclaimer displays.
No payment is active if Instant Sale flag is off.
```

## 6.6 Phase 5 Manual Test: Instant Sale

Test:

```txt
Customer opens storefront.
Customer selects product.
Customer chooses pickup or delivery.
Customer pays full amount.
Collection Invoice is created.
Payment reference is generated.
Payment confirmation updates order.
Merchant sees order.
Customer gets receipt.
Settlement tracking record is created.
```

## 6.7 Phase 6 Manual Test: Discount Codes

Test:

```txt
Merchant creates discount code.
Merchant sets percentage.
Merchant sets usage limit.
Merchant sets expiry date.
Customer applies valid discount.
Customer sees subtotal, discount, and final amount.
Collection Invoice amount equals discounted total.
Expired code fails.
Exceeded usage code fails.
Same customer cannot exceed per-customer limit.
Discount usage counts only after successful payment.
```

## 6.8 Phase 7 Manual Test: Merchant Ratings

Test:

```txt
Customer can review after completed order.
Customer cannot review without order.
Customer cannot review same order twice.
Merchant cannot edit review.
Merchant can reply.
Public rating summary updates.
Admin can hide abusive review.
```

## 6.9 Phase 8 Manual Test: Receivable Sale

Test:

```txt
Guest cannot use Receivable Sale.
Registered customer can submit request.
No payment link appears before merchant confirmation.
Merchant can accept request.
Merchant can reject request.
Acceptance creates deposit Collection Invoice.
Customer pays deposit.
Reservation becomes active.
Balance due date starts after deposit payment.
Balance Collection Invoice works.
Discount applies before deposit and balance calculation.
Terms snapshot is saved.
```

## 6.10 Phase 9 Manual Test: Reminders and Expiry

Test:

```txt
Reminder schedule is created.
Reminder email/dashboard notice sends.
Balance overdue status works.
Reservation expiry works.
Balance payment updates receivable.
Duplicate payment does not double-count.
```

## 6.11 Phase 10 Manual Test: Dispute and Risk

Test:

```txt
Customer can report issue.
Merchant can respond.
Admin can review.
Storefront can be suspended.
Product can be suspended.
Discount code can be suspended.
Receivable Sale can be disabled for risky merchant.
```

## 7. How to Accept or Reject a Phase

Before accepting a phase, ask:

```txt
Did the agent implement only this phase?
Did the agent avoid future phase work?
Did existing invoice, checkout, reference, Record Invoice, Collection Invoice, deposit, webhook, and settlement flows still work?
Did all tests pass?
Did build pass?
Did the agent provide an evidence report?
Did the agent provide a traceability matrix?
Did an independent audit confirm the work?
Did I manually test the key flows?
Are feature flags safe?
Are there unresolved compliance/provider/legal decisions?
```

If any answer is no, do not merge.

## 8. How to Run an Independent Audit

After the coding agent finishes a phase, start a fresh agent session and say:

```txt
Audit this branch against:

/docs/deraledger-smart-storefront-prd.md
/docs/deraledger-coding-agent-build-contract.md

Audit Phase [X] only: [PHASE NAME].

Do not write code.

Confirm:
1. Every Phase X requirement is implemented.
2. No future phase was implemented early.
3. Existing invoice, deposit, payment reference, Record Invoice, Collection Invoice, checkout, provider, webhook, and settlement flows were not broken.
4. Feature flags are correctly used.
5. Database migrations are safe.
6. Tests cover the acceptance criteria.
7. There are no hidden escrow, BNPL, logistics, or unsupported settlement assumptions.
8. Discount, deposit, receivable, and invoice calculations are consistent where applicable.
9. List every gap before merge.
```

Only merge after the audit is clean or all issues are fixed.

## 9. How to Handle Database Migrations

Before approving any migration, ask the agent:

```txt
What table will be created or changed?
Will existing data be modified?
Is the migration reversible?
What happens if migration fails halfway?
Will it lock a production table?
Does it affect existing invoices, payments, references, or settlement records?
Was it tested on a local/sandbox copy?
```

For production, run migrations only after backup and testing.

## 10. How to Handle Feature Flags

Feature flags should start as false in production.

Rollout path:

```txt
Local only
Internal admin only
Sandbox merchant only
One trusted beta merchant
Two or three trusted beta merchants
Limited public release
Full release
```

Do not enable Storefront, Instant Sale, Discount Codes, and Receivable Sale for everyone at the same time.

## 11. How to Choose Beta Merchants

Pick merchants who are:

```txt
Known to you.
Verified or easy to verify.
Low dispute risk.
Selling simple products first.
Available to give feedback.
Willing to test carefully.
```

Avoid early beta with:

```txt
High-value electronics.
Regulated goods.
Medicine.
Investment products.
Crypto trading services.
Unknown merchants.
Merchants with unclear identity.
Merchants who cannot fulfil orders reliably.
```

Start beta with Instant Sale before Receivable Sale.

## 12. Messages You Should Personally Approve

Approve all customer/merchant-facing messages for:

```txt
Plan migration notice.
Solo Plus launch notice.
Storefront beta invitation.
KYC/KYB request.
Receivable Sale explanation.
Deposit and reservation terms.
Delivery disclaimer.
Discount terms.
Rating/review policy.
Refund and dispute process.
```

Do not let the agent invent final public messaging without review.

## 13. Decision Log You Should Maintain

Create a decision log file:

```txt
/docs/deraledger-storefront-decision-log.md
```

Use this format:

```txt
Date:
Decision:
Reason:
Affected phase:
Approved by:
Notes:
```

Track decisions such as:

```txt
Solo Lite cap amount.
Solo Plus monthly band.
KYC/KYB requirements.
Discount maximum percentage.
Rating visibility threshold.
Beta merchant list.
Provider routing choice.
Feature flag activation date.
```

## 14. Recommended Weekly Build Routine

For each active build week:

```txt
Monday: Review phase scope and approve agent implementation plan.
Tuesday-Wednesday: Agent codes and runs tests.
Thursday: Review evidence report and run independent audit.
Friday: Manual UAT and merge decision.
Weekend: No risky production deployment unless necessary.
```

For a solo founder, the simpler version is:

```txt
One phase at a time.
One branch at a time.
One test report at a time.
One approval at a time.
```

## 15. Final Product Owner Rule

Never approve a phase just because the agent says it is done.

Approve only when:

```txt
The phase scope was followed.
The PRD requirement is traceable.
Existing flows still work.
Tests pass.
You have evidence.
You have manually tested.
Audit is clean.
Feature flags are safe.
```

Your most important job is to protect what already works while the new storefront is added.
