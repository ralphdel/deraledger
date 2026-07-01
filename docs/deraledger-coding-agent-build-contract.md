# DeraLedger Smart Storefront Build Contract for Coding Agent

## Document Purpose

This document is the build contract for the coding agent implementing the DeraLedger Smart Storefront project.

The coding agent must follow this document together with the main PRD:

```txt
/docs/deraledger-smart-storefront-prd.md
/docs/deraledger-coding-agent-build-contract.md
```

The agent must not treat the PRD as a loose suggestion. It is the product contract. Every implementation must be traceable to a PRD requirement and a phase gate.

## 1. Non-Negotiable Build Rule

The agent must not build the whole storefront at once.

The required workflow is:

```txt
PRD
-> Phase ticket
-> Agent implementation plan
-> Product owner approval
-> Code implementation
-> Tests
-> Evidence report
-> Independent audit
-> Merge
-> Next phase
```

The agent must implement only the current approved phase. The agent must not implement future phases early, even if it appears convenient.

## 2. Existing DeraLedger Flows That Must Be Protected

The following existing DeraLedger flows are production-sensitive and must not be broken:

```txt
Existing invoicing
Existing deposit logic
Existing payment/reference generation
Existing checkout
Existing Record Invoice flow
Existing Collection Invoice flow
Existing live payment collection
Existing payment webhooks
Existing settlement account logic
Existing provider routing
Existing merchant dashboard behavior
Existing subscription/plan billing behavior
```

If any current phase appears to require changing one of these flows, the agent must stop and ask the product owner for approval before coding.

## 3. Product Architecture Boundaries

The agent must observe these boundaries:

```txt
Reuse existing Collection Invoice and checkout architecture for live storefront payments.
Reuse existing Record Invoice only for manual/offline records.
Do not create a separate storefront payment engine.
Do not bypass existing DeraLedger payment references.
Do not bypass existing provider abstraction.
Do not create escrow behavior in MVP.
Do not create BNPL/lending behavior.
Do not create DeraLedger-managed logistics.
Do not promise customer funds are held or guaranteed by DeraLedger.
```

MVP settlement model is direct settlement:

```txt
Customer pays.
Provider routes funds to merchant settlement route/subaccount/per-address settlement.
DeraLedger records payment, invoice, order, receivable, reference, and settlement status.
DeraLedger does not hold customer funds.
```

## 4. Required Repository Files

Before implementation starts, the following files should exist in the repo:

```txt
/docs/deraledger-smart-storefront-prd.md
/docs/deraledger-coding-agent-build-contract.md
/docs/storefront-phase-exit-report-template.md
/docs/storefront-test-checklist.md
```

Optional phase-specific checklists:

```txt
/docs/phase-0-audit-checklist.md
/docs/phase-1-plan-migration-checklist.md
/docs/phase-2-compliance-engine-checklist.md
/docs/phase-3-solo-plus-kyc-checklist.md
/docs/phase-4-storefront-foundation-checklist.md
/docs/phase-5-instant-sale-checklist.md
/docs/phase-6-discount-codes-checklist.md
/docs/phase-7-merchant-ratings-checklist.md
/docs/phase-8-receivable-sale-checklist.md
/docs/phase-9-reminders-expiry-checklist.md
/docs/phase-10-disputes-refunds-risk-checklist.md
/docs/phase-11-hardening-rollout-checklist.md
```

## 5. Branching Contract

One phase must equal one branch.

Recommended branches:

```bash
git checkout -b feature/phase-0-storefront-audit
git checkout -b feature/phase-1-plan-migration
git checkout -b feature/phase-2-compliance-engine
git checkout -b feature/phase-3-solo-plus-kyc
git checkout -b feature/phase-4-storefront-foundation
git checkout -b feature/phase-5-instant-sale
git checkout -b feature/phase-6-discount-codes
git checkout -b feature/phase-7-merchant-ratings
git checkout -b feature/phase-8-receivable-sale
git checkout -b feature/phase-9-reminders-expiry
git checkout -b feature/phase-10-disputes-refunds-risk
git checkout -b feature/phase-11-hardening-rollout
```

Branch rules:

```txt
One phase = one branch.
No future phase work inside the current branch.
No unrelated refactor inside a phase branch.
No production behavior change without feature flag.
No merge until the phase exit report is approved by the product owner.
```

## 6. Feature Flag Contract

All new storefront-related work must be behind feature flags.

Required flags:

```txt
plan_migration_solo_lite_enabled
solo_plus_enabled
solo_plus_kyc_enabled
storefront_enabled
storefront_instant_sale_enabled
storefront_receivable_sale_enabled
merchant_confirmation_before_deposit_enabled
customer_registration_required_for_receivables
storefront_pickup_enabled
storefront_delivery_notice_enabled
storefront_product_rule_overrides_enabled
storefront_discount_codes_enabled
storefront_percentage_discounts_enabled
storefront_discount_product_targeting_enabled
storefront_discount_usage_limits_enabled
storefront_discount_expiry_enabled
storefront_receivable_discount_enabled
merchant_ratings_enabled
storefront_disputes_enabled
storefront_refunds_enabled
```

Default production value:

```txt
false
```

The agent must not silently enable incomplete features in production.

## 7. Agent Workflow Before Coding

Before writing code for any phase, the agent must produce an implementation plan containing:

```txt
1. Phase name
2. PRD sections being implemented
3. Exact scope of this phase
4. Explicit non-scope items
5. Expected files to change
6. Database migrations needed
7. Feature flags involved
8. Existing flows that must remain untouched
9. Tests to add or update
10. Manual QA checklist
11. Risks and assumptions
12. Questions requiring product owner approval
```

The agent must wait for product owner approval before coding.

## 8. Agent Workflow After Coding

After coding, the agent must provide an evidence report containing:

```txt
Phase completed:
Branch name:
Commit hash:
PRD sections implemented:
Files changed:
Database migrations:
Feature flags added/updated:
Tests added:
Tests run:
Test results:
Build result:
Manual QA completed:
Screenshots/video evidence:
Existing flows regression result:
Known issues:
Items deferred:
PRD traceability matrix:
Recommendation:
```

No phase is complete without this report.

## 9. Stop Conditions

The agent must stop and ask the product owner if any of these occur:

```txt
Existing invoice behavior may change.
Existing checkout behavior may change.
Existing payment reference behavior may change.
Existing Collection Invoice behavior may change.
Existing Record Invoice behavior may change.
Existing provider routing may change.
Existing webhook behavior may change.
Existing settlement logic may change.
A database migration may affect production data.
A future phase seems required to complete the current phase.
A provider capability is uncertain.
A compliance decision is unclear.
A requirement is ambiguous.
Tests fail.
Build fails.
Database schema does not support the PRD cleanly.
```

The agent must not guess or invent product decisions.

## 10. Required Traceability Matrix

Every phase must include this table before acceptance:

| PRD Requirement | Phase | Implementation Files | Test/Evidence | Status |
|---|---|---|---|---|
| Requirement from PRD | Phase number | Files changed | Test or evidence | Done / Gap |

Example:

| PRD Requirement | Phase | Implementation Files | Test/Evidence | Status |
|---|---|---|---|---|
| Individual becomes Solo Lite | Phase 1 | plan resolver, migration script | Migration test passed | Done |
| Existing Collection Invoice remains working | Phase 1 | No payment flow changes | Regression test passed | Done |
| Solo Plus hidden behind feature flag | Phase 1 | feature flag config | Flag test passed | Done |

## 11. Independent Audit Requirement

After implementation, a separate audit pass must be performed before merge.

Audit prompt:

```txt
Audit this branch against the DeraLedger Smart Storefront PRD and the Coding Agent Build Contract.

Audit Phase [X] only: [PHASE NAME].

Confirm:
1. Every Phase X requirement is implemented.
2. No future phase was implemented early.
3. Existing invoice, deposit, payment reference, Record Invoice, Collection Invoice, checkout, provider, webhook, and settlement flows were not broken.
4. Feature flags are correctly used.
5. Database migrations are safe.
6. Tests cover the acceptance criteria.
7. There are no hidden escrow, BNPL, logistics, or unsupported settlement assumptions.
8. Discount, deposit, receivable, and invoice calculations are consistent where applicable.
9. List all gaps before merge.

Do not write code. Audit only.
```

## 12. Phase Gates

### Phase 0: Audit and Branch Setup

Purpose:

```txt
Understand current architecture before changing anything.
```

Must document:

```txt
Plan model
Subscription billing
Invoice schema
Deposit schema
Payment/reference generation
Record Invoice flow
Collection Invoice flow
Checkout session flow
Payment session flow
Webhook flow
Settlement account flow
Provider abstraction
Merchant verification/KYC flow
Current feature flags
```

Exit criteria:

```txt
Technical audit completed.
No production behavior changed.
Existing invoice and checkout flows documented.
Existing Record Invoice and Collection Invoice flows documented.
Existing payment reference flow documented.
Existing settlement flow documented.
Risks and dependencies listed.
```

### Phase 1: Plan Update and Migration

Must implement:

```txt
Individual -> Solo Lite migration
Solo Plus plan at NGN 13,000/month
Starter remains free
Business remains NGN 20,000/month
Migration logs
Backward compatibility for old individual references
Feature flag for Solo Plus visibility
```

Exit criteria:

```txt
Existing Individual users display as Solo Lite.
Billing remains NGN 5,000/month.
Business remains NGN 20,000/month.
Starter remains free.
Existing invoices still work.
Existing deposits still work.
Existing payment references still resolve.
Existing Collection Invoices still work.
Existing Record Invoices still work.
Existing settlement records remain unchanged.
Solo Plus exists but remains hidden/disabled behind feature flag until enabled.
```

### Phase 2: Compliance and Limit Engine

Must implement:

```txt
merchant_compliance_profiles
business_type
compliance_status
activation_status
risk_rating
approved_monthly_volume
cumulative_collection_cap
cumulative_collection_used
hidden_daily_velocity_limit
single_transaction_limit
resolveMerchantCapabilities(merchant_id)
```

Exit criteria:

```txt
Plan payment alone does not unlock collection.
Compliance status controls collection.
Starter cannot collect live payments.
Solo Lite cannot use Receivable Sale.
Solo Plus cannot use Receivable Sale before Enhanced approval.
Business cannot collect before KYB approval.
Existing users are not accidentally restricted.
```

### Phase 3: Solo Plus Onboarding and Enhanced Verification

Must implement:

```txt
Solo Plus upgrade flow
Enhanced KYC form
Estimated monthly sales field
Business profile field
Proof of address upload
Valid ID upload
Occupation/employer/source of income field
Social/website field
Manual compliance review
PEP/sanctions hooks where available
Enhanced verification status
```

Exit criteria:

```txt
Solo Plus can be subscribed to.
Enhanced verification can be submitted.
Admin can approve, reject, or request more information.
Receivable Sale remains locked until Enhanced verification is approved.
Existing Solo Lite flow still works.
```

### Phase 4: Storefront Foundation

Must implement:

```txt
Storefront settings
Store slug
Public route /store/[slug]
Store identity
Customer care details
Pickup settings
Delivery notice settings
General product rules
Product creation
Product-level overrides
Product listing
Product detail page
Store preview mode
```

Exit criteria:

```txt
Merchant can create storefront.
Store slug is unique.
Store URL works.
Products can be created.
General product rules apply.
Product overrides work.
Pickup details display.
Delivery notice displays.
No live payment is enabled unless Instant Sale flag is enabled.
```

### Phase 5: Instant Sale Storefront

Must implement:

```txt
Instant Sale checkout
Guest checkout
Registered customer checkout
Storefront order creation
Collection Invoice creation
Existing checkout integration
Payment confirmation
Merchant notification
Customer receipt
Order dashboard
Settlement tracking record
```

Exit criteria:

```txt
Customer can buy product in full.
Collection Invoice is created.
Existing checkout is reused.
Payment reference is generated.
Webhook updates order once.
Duplicate webhook does not duplicate payment.
Merchant sees order.
Customer receives receipt.
Settlement tracking record is created.
Existing non-storefront Collection Invoice still works.
```

### Phase 6: Storefront Discount Codes

Must implement:

```txt
Discount code data model
Merchant discount management UI
Discount validation service
Instant Sale checkout discount application
Collection Invoice discount snapshot
Discount redemption tracking
Usage limit enforcement
Per-customer usage enforcement
Expiry enforcement
Admin controls
```

Exit criteria:

```txt
Merchant can create percentage discount code.
Discount code is unique per merchant/storefront.
Usage limit works.
Expiry works.
Per-customer usage works.
Invalid code is rejected clearly.
Discount applies before Collection Invoice creation.
Collection Invoice amount equals discounted total.
Discount snapshot is saved.
Usage is counted only after successful payment.
Concurrent redemption cannot exceed limit.
Existing invoice discounts, if any, are not double-applied.
```

### Phase 7: Merchant Ratings for Instant Sale

Must implement:

```txt
Review eligibility after completed order
Secure review link for guest customers
Customer dashboard review for registered customers
Merchant rating summary
Public rating display
Merchant reply
Admin moderation
```

Exit criteria:

```txt
Only verified customers can review.
One review per order.
Merchant cannot review themselves.
Merchant cannot edit customer review.
Average rating updates.
Public storefront displays verified rating count.
Admin can hide abusive reviews.
```

### Phase 8: Receivable Sale Foundation

Must implement:

```txt
Registered customer requirement
Receivable request creation
Merchant confirmation flow
Payment link locked before merchant confirmation
Deposit Collection Invoice created after confirmation
Deposit payment tracking
Reservation activation
Balance due date
Balance Collection Invoice/payment link
Terms snapshot
Customer dashboard
Merchant dashboard
Receivable Sale discount support
```

Exit criteria:

```txt
Guest cannot use Receivable Sale.
Registered customer can submit request without paying first.
Payment link is inactive before merchant confirmation.
Merchant can accept or reject.
Merchant rejection closes request without payment.
Merchant acceptance creates deposit Collection Invoice.
Deposit payment activates reservation.
Discount applies before deposit/balance calculation.
Balance due date starts after deposit payment.
Terms snapshot is saved.
Existing deposit logic is not broken.
```

### Phase 9: Receivable Reminders and Reservation Expiry

Must implement:

```txt
Reminder scheduler
Email reminders
Dashboard reminders
Balance overdue status
Reservation expiry status
Merchant cancellation action
Customer balance payment link
```

Exit criteria:

```txt
Reminders send before due date.
Overdue status updates.
Reservation expiry works according to terms.
Balance payment updates receivable.
Duplicate balance payment does not double-count.
```

### Phase 10: Dispute, Refund Request, and Risk Controls

Must implement:

```txt
Customer report issue button
Refund request flow
Merchant response flow
Admin review flow
Risk flags
Storefront suspension
Product suspension
Discount code suspension
Receivable Sale suspension
Settlement status flagging
```

Exit criteria:

```txt
Customer can report issue.
Merchant can respond.
Admin can review.
Storefront can be suspended.
Product can be suspended.
Discount code can be suspended.
Receivable Sale can be disabled for risky merchant.
```

### Phase 11: Hardening and Production Rollout

Must implement:

```txt
End-to-end tests
Migration tests
Webhook idempotency tests
Discount redemption race-condition tests
Security review
KYC data protection review
Admin audit logs
Performance checks
Feature flag rollout
Selected beta merchants
```

Exit criteria:

```txt
Build passes.
All critical tests pass.
Regression tests pass.
Security review completed.
KYC/data protection handling reviewed.
Feature flags verified.
Beta merchant rollout plan approved.
Production rollback plan exists.
```

## 13. Final Agent Instruction

The agent must follow this instruction throughout the build:

```txt
Build carefully.
Stay inside the current phase.
Protect existing DeraLedger flows.
Use feature flags.
Reuse existing invoice and checkout architecture.
Do not create a separate payment engine.
Do not introduce escrow, BNPL, or logistics assumptions.
Do not move to the next phase without product owner approval.
```
