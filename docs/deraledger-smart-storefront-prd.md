# DeraLedger Smart Storefront PRD

## Plan Migration, Compliance Tiers, Storefront, Instant Sale, Receivable Sale, Discount Codes, Merchant Ratings, and Existing Invoice/Checkout Integration

## 1. Product Context

DeraLedger already has an existing receivables foundation. The new storefront feature must extend the current product, not replace or duplicate it.

Current DeraLedger product capabilities already include:

```txt
Invoicing
Deposit handling
Payment/reference generation
Checkout implementation
Record Invoice flow
Collection Invoice flow for live payment collection
Payment provider abstraction
Settlement account logic
Provider routing for card, transfer, USSD, and crypto
Merchant dashboard
Receivables tracking
Partial/deposit-style payment logic
```

The storefront build must respect this current architecture.

The new storefront product should introduce:

```txt
Plan migration from Individual to Solo Lite
New Solo Plus plan
Compliance-tier-driven feature access
Storefront URL: deraledger.com/store/business-name
Product/service catalogue
Instant Sale
Receivable Sale
Merchant confirmation before deposit payment
General product rules
Product-level rule overrides
Pickup settings
Merchant-managed offline delivery notice
Discount codes
Verified merchant ratings and reviews
Customer dashboard for receivable orders
Direct settlement model
No escrow in MVP
```

## 2. Product Positioning

DeraLedger Smart Storefront is not a full Shopify-style e-commerce product.

It should be positioned as:

> A simple storefront layer that helps African merchants sell, collect full or partial payments, track balances, send reminders, and reconcile payments through DeraLedger.

The unique product angle is not just “create an online store.”

The unique angle is:

> Merchants can sell through a public store page, collect instantly or by deposit, track outstanding balances, remind customers, and maintain a live receivables ledger.

## 3. Product Name

Recommended name:

```txt
DeraLedger Smart Storefront
```

Recommended tagline:

```txt
Sell online, collect full or partial payments, and track every balance automatically.
```

## 4. Public Store URL

Each merchant storefront must use this format:

```txt
deraledger.com/store/business-name
```

Examples:

```txt
deraledger.com/store/ade-fashion
deraledger.com/store/tolu-cakes
deraledger.com/store/abc-spare-parts
```

Custom domains are not part of MVP.

## 5. Core Product Principles

### 5.1 Storefront must reuse existing DeraLedger payment architecture

Do not build a separate storefront payment engine.

Correct architecture:

```txt
Storefront
→ Storefront Order
→ Existing Collection Invoice / Checkout engine
→ Existing Payment Session
→ Existing Provider Abstraction
→ Existing Payment Reference
→ Existing Ledger/Receivable Record
→ Existing Settlement Tracking
```

### 5.2 Record Invoice remains for manual/offline payment records

Record Invoice should continue to serve:

```txt
Manual payment records
Offline payment tracking
Historical receivable entries
Cash/bank-transfer records
Non-live receivable tracking
```

### 5.3 Collection Invoice remains the live payment rail

Collection Invoice should be used for:

```txt
Instant Sale full payment
Receivable Sale deposit payment
Receivable Sale balance payment
Storefront checkout payments
```

### 5.4 DeraLedger must not be positioned as escrow in MVP

DeraLedger should not say:

```txt
Escrow
Buyer guarantee
Money held by DeraLedger
Released after delivery
Guaranteed delivery
```

Use safer language:

```txt
Verified merchant checkout
Payment tracking
Order records
Receivable tracking
Dispute reporting
Merchant ratings
Direct provider settlement
```

### 5.5 Direct settlement model for MVP

For MVP, use:

```txt
Model A: Direct Settlement
```

Meaning:

```txt
Customer pays.
Provider routes funds to merchant settlement route/subaccount/per-address settlement.
DeraLedger records payment, invoice, order, receivable, reference, and settlement status.
DeraLedger does not hold customer funds.
DeraLedger does not act as escrow.
```

## 6. Current Plan Structure

Current plans:

```txt
Starter: Free
Individual: ₦5,000/month
Business: ₦20,000/month
```

## 7. New Plan Structure

New plans:

```txt
Starter: Free
Solo Lite: ₦5,000/month
Solo Plus: ₦13,000/month
Business: ₦20,000/month
```

Migration rule:

```txt
Individual → Solo Lite
```

Business remains Business.

Starter remains Starter.

## 8. Plan Migration Requirements

### 8.1 Existing Individual merchants

All existing Individual merchants should automatically become Solo Lite merchants.

Requirements:

```txt
Existing Individual users must display as Solo Lite.
Billing remains ₦5,000/month.
No existing invoice should break.
No existing deposit should break.
No existing payment reference should break.
No existing checkout link should break.
No existing record invoice should break.
No existing collection invoice should break.
No existing settlement account should be overwritten.
No existing KYC/KYB status should be reset.
```

### 8.2 Existing Business merchants

Requirements:

```txt
Business users remain Business.
Billing remains ₦20,000/month.
Existing Business access should not reduce.
```

### 8.3 Existing Starter merchants

Requirements:

```txt
Starter users remain on free plan.
Starter users should not receive live collection access unless upgraded and verified.
```

### 8.4 Backward compatibility

Developer must support old internal references to `individual` during migration.

Recommended approach:

```txt
Create new plan_code = solo_lite.
Map old individual display name to Solo Lite.
Keep backward compatibility resolver for old individual records.
Log every migration in a plan_migrations table.
```

## 9. Commercial Plan vs Compliance Status

Plan subscription and compliance status must be separate.

A merchant paying for a plan does not automatically mean the merchant can collect money or use every feature.

DeraLedger should track these layers separately:

```txt
Commercial plan
Business type
Compliance status
Risk rating
Collection limit profile
Feature entitlements
Activation status
```

### 9.1 Commercial plan codes

```txt
starter
solo_lite
solo_plus
business
```

### 9.2 Business type values

```txt
unregistered_individual
sole_proprietor
registered_business_name
limited_liability_company
incorporated_trustee
other_entity
```

### 9.3 Compliance status values

```txt
draft
lite_pending
lite_verified
enhanced_pending
enhanced_verified
business_pending
business_verified
needs_attention
restricted
rejected
```

### 9.4 Risk rating values

```txt
low
medium
high
restricted
```

### 9.5 Activation status values

```txt
test_mode
pre_approved
awaiting_review
approved
needs_attention
restricted
suspended
```

## 10. Collection Limit Philosophy

Do not publicly market DeraLedger with very small daily limits for serious merchants.

Use public-facing cumulative/monthly limits, while keeping internal daily velocity controls hidden for risk.

### 10.1 Public-facing limit model

Recommended public approach:

```txt
Starter:
No live collection.

Solo Lite:
Starter-stage cumulative collection cap.

Solo Plus:
Reviewed monthly collection band.

Business:
No preset public cap, subject to KYB, provider limits, risk review, and approved volume.
```

### 10.2 Recommended default limits

These values should be configurable by admin/compliance.

```txt
Starter:
Live collection: ₦0

Solo Lite:
Cumulative collection cap: ₦8,000,000
Receivable Sale: disabled
Upgrade required after cap is reached

Solo Plus:
Default approved monthly collection band: ₦10,000,000
Higher monthly limit requires manual compliance review
Receivable Sale enabled only after Enhanced verification

Business:
No preset public cap
Approved volume based on KYB, declared sales, risk review, and provider capability
```

### 10.3 Internal risk controls

Even if public limits are monthly/cumulative, DeraLedger should keep internal controls such as:

```txt
hidden_daily_velocity_limit
single_transaction_limit
monthly_approved_volume
cumulative_collection_used
outstanding_receivable_cap
refund_rate_threshold
dispute_rate_threshold
sudden_volume_spike_flag
high_risk_category_flag
manual_review_required
```

These controls should not be marketed aggressively to customers. They should be compliance/risk controls.

## 11. Plan Feature Matrix

| Feature              | Starter       | Solo Lite                   | Solo Plus                       | Business               |
| -------------------- | ------------- | --------------------------- | ------------------------------- | ---------------------- |
| Create account       | Yes           | Yes                         | Yes                             | Yes                    |
| Create draft invoice | Yes           | Yes                         | Yes                             | Yes                    |
| Record Invoice       | Yes           | Yes                         | Yes                             | Yes                    |
| Collection Invoice   | No            | Yes after Lite verification | Yes after verification          | Yes after KYB          |
| Checkout             | Preview only  | Yes                         | Yes                             | Yes                    |
| Payment links        | No            | Yes                         | Yes                             | Yes                    |
| Storefront preview   | Yes           | Yes                         | Yes                             | Yes                    |
| Live storefront      | No            | Yes                         | Yes                             | Yes                    |
| Instant Sale         | No            | Yes                         | Yes                             | Yes                    |
| Receivable Sale      | No            | No                          | Yes after Enhanced verification | Yes after KYB          |
| Deposit & Balance    | No            | No                          | Yes                             | Yes                    |
| Automated reminders  | No            | No                          | Yes                             | Yes                    |
| Discount codes       | No live codes | Instant Sale only           | Instant + Receivable            | Instant + Receivable   |
| Merchant ratings     | View only     | Yes                         | Yes                             | Yes                    |
| Staff roles          | No            | Basic/predefined            | Future/limited                  | Yes                    |
| Advanced reports     | No            | Basic                       | Standard                        | Advanced               |
| API access           | No            | No                          | Future/manual approval          | Future/manual approval |
| Custom domain        | No            | No                          | Future                          | Future                 |

## 12. Plan-by-Plan Requirements

## 12.1 Starter

Price:

```txt
Free
```

Purpose:

```txt
Exploration, draft invoice creation, record invoice use, and storefront preview.
```

Allowed:

```txt
Create account
Create draft invoices
Create Record Invoices
Preview storefront
View upgrade prompts
```

Blocked:

```txt
Live payment collection
Collection Invoice activation
Checkout payment activation
Storefront live checkout
Settlement activation
Receivable Sale
Deposit collection
Live discount code usage
Withdrawals
```

## 12.2 Solo Lite

Price:

```txt
₦5,000/month
```

Migration:

```txt
Existing Individual users become Solo Lite.
```

Purpose:

```txt
Unregistered sellers, freelancers, small vendors, and early merchants who need basic live collection.
```

Allowed after Lite verification:

```txt
Collection Invoices
Checkout
Payment links
Instant Sale storefront
Basic storefront products
Percentage discount codes for Instant Sale
Direct provider settlement
Merchant ratings
Basic reports
```

Blocked:

```txt
Receivable Sale
Deposit & Balance through storefront
Automated balance reminders for storefront receivables
High-risk product categories
Advanced settlement features
```

Minimum verification should include:

```txt
Full name
Phone verification
Email verification
BVN
NIN where required
Selfie/liveness
Valid government-issued ID where required by verification level
Residential address
Proof of address or acceptable address validation where required
Personal bank account matching account owner
Business profile or nature of activity
Estimated monthly sales
Website/social media page where available
```

## 12.3 Solo Plus

Price:

```txt
₦13,000/month
```

Purpose:

```txt
Unregistered sellers who need higher collection capacity and receivable/deposit tools.
```

Important rule:

```txt
Paying for Solo Plus does not automatically unlock Receivable Sale.
Receivable Sale unlocks only after Enhanced verification approval.
```

Allowed after Enhanced verification:

```txt
Instant Sale
Receivable Sale
Deposit & Balance
Balance payment links
Automated reminders
Customer dashboard receivables
Merchant confirmation before deposit
Percentage discount codes for Instant Sale and Receivable Sale
Merchant ratings and reviews
Higher reviewed monthly collection band
```

Enhanced verification should include:

```txt
Everything in Solo Lite
Utility bill or tenancy agreement
Occupation/employer or business activity profile
Source of income/source of funds where required
Address verification
PEP screening
Sanctions screening
Adverse media check where available
Manual compliance review
Approved monthly collection band
```

## 12.4 Business

Price:

```txt
₦20,000/month
```

Purpose:

```txt
Registered businesses.
```

Allowed after KYB:

```txt
Collection Invoices
Checkout
Payment links
Instant Sale
Receivable Sale
Deposit & Balance
Storefront
Discount codes for Instant Sale and Receivable Sale
Merchant ratings
Higher approved limits
Advanced reporting
Staff roles
```

Minimum KYB should include:

```txt
Business type
Registered business name
Trading name, if different
RC/BN/IT number
Certificate of Incorporation or Business Name certificate
CAC status report or CAC forms
MEMART/Form 1.1/business object where applicable
TIN or tax certificate where applicable
Registered address
Operating address
Proof of address
Director/proprietor/trustee details
Beneficial owner details
Government ID or NIN/BVN of relevant directors/proprietors
Board resolution or director authorization where applicable
Authorized operator details
Business bank account matching registered/trading name
Estimated monthly sales
Nature of business
Product/service category
PEP screening
Sanctions screening
Adverse media check where available
Manual compliance review
```

## 13. Existing Invoice Flow Integration

## 13.1 Record Invoice

Record Invoice should remain for non-live/manual payment tracking.

Use cases:

```txt
Manual/offline payments
Internal receivable records
Historical payment recording
Cash/bank transfer records
Merchant ledger completeness
```

Storefront should not use Record Invoice for live payment unless a merchant/admin is manually recording an offline payment.

## 13.2 Collection Invoice

Collection Invoice is the live payment rail.

Storefront should create Collection Invoices for:

```txt
Instant Sale full payment
Receivable Sale deposit payment
Receivable Sale balance payment
```

Required invoice purposes:

```txt
storefront_instant_sale
storefront_receivable_deposit
storefront_receivable_balance
```

## 13.3 Payment reference handling

Every storefront payment must have a unique DeraLedger reference.

Reference must connect:

```txt
storefront_order_id
collection_invoice_id
checkout_session_id
payment_session_id
provider_reference
merchant_id
customer_id
```

No storefront payment should bypass DeraLedger reference generation.

## 13.4 Discount and invoice integration

If the existing invoice engine already supports discounts, storefront discount codes should still be treated carefully.

Rule:

```txt
Storefront discount code is an order-level promotional discount.
It must be resolved before Collection Invoice creation.
The Collection Invoice amount must equal the final payable amount after discount.
```

Avoid double-discounting.

If invoice-level manual discount exists, then for storefront-generated Collection Invoices:

```txt
The storefront discount code should populate the invoice discount fields/snapshot.
Manual invoice discount editing should be locked after storefront checkout creation.
```

## 14. Settlement Model

## 14.1 MVP settlement model

Use direct settlement.

```txt
Customer pays.
Provider routes funds to merchant subaccount or settlement route.
DeraLedger records the transaction.
DeraLedger does not hold customer funds.
```

For card, USSD, and transfer:

```txt
Use provider-supported subaccount/split/income-split setup where available.
```

For crypto:

```txt
Use Breet per-address settlement where configured.
Merchant receives NGN settlement.
DeraLedger records the crypto payment and settlement events.
```

## 14.2 Settlement tracking fields

Even with direct settlement, DeraLedger should track:

```txt
settlement_status
provider
provider_settlement_reference
settlement_expected_at
settlement_completed_at
settlement_failed_reason
merchant_payout_account_id
provider_fee
settlement_amount
gross_payment_amount
```

Important rule:

```txt
Invoice balance should reduce by gross customer payment amount, not provider net settlement amount.
Provider fee and net settlement should be tracked separately.
```

## 15. Storefront Overview

DeraLedger Smart Storefront lets verified merchants create a public page where customers can view products/services and pay through DeraLedger.

Storefront supports:

```txt
Product/service listing
Instant Sale
Receivable Sale
Discount codes
Pickup information
Merchant-managed delivery notice
Merchant ratings
Verified merchant badges
```

## 16. Storefront Sale Modes

## 16.1 Instant Sale

Definition:

```txt
Customer pays full product amount immediately.
```

Eligible merchants:

```txt
Solo Lite after verification
Solo Plus after verification
Business after KYB
```

Customer type:

```txt
Guest customer allowed
Registered customer allowed
```

Flow:

```txt
Customer opens storefront
Customer views product
Customer chooses pickup or delivery
Customer applies discount code if available
System validates discount
System calculates final payable amount
System creates storefront order
System creates Collection Invoice
System creates checkout/payment session
Customer pays full amount
Payment provider confirms payment
DeraLedger updates order/invoice/payment status
Merchant receives notification
Customer receives receipt
Settlement tracking begins
```

Instant Sale statuses:

```txt
created
awaiting_payment
payment_failed
paid
merchant_notified
ready_for_pickup
fulfilled
cancelled
refund_requested
refunded
disputed
closed
```

## 16.2 Receivable Sale

Definition:

```txt
Customer submits a request to reserve a product/service with deposit and balance payment.
Merchant confirms availability before any deposit payment link is activated.
Customer pays minimum deposit only after merchant confirmation.
DeraLedger tracks deposit, balance, due date, reminders, and reservation terms.
```

Eligible merchants:

```txt
Solo Plus after Enhanced verification
Business after KYB
```

Customer type:

```txt
Registered customer only
```

Correct flow:

```txt
Customer opens storefront
Customer selects product
Customer chooses Deposit & Balance
Customer logs in/registers
Customer chooses pickup or delivery
Customer applies discount code if available
System validates discount
Customer submits receivable request
Order status becomes awaiting_merchant_confirmation
Merchant receives request
Merchant confirms availability
System revalidates or honors reserved discount according to rules
System creates deposit Collection Invoice
Payment link becomes active
Customer pays minimum deposit
Reservation becomes active
Balance due date starts
Reminder schedule begins
Customer pays balance
Order becomes fully paid
Merchant fulfils order
Customer can rate merchant
```

Wrong flow to avoid:

```txt
Customer pays deposit before merchant confirms availability.
```

Receivable Sale statuses:

```txt
order_request_created
awaiting_merchant_confirmation
merchant_rejected_unavailable
merchant_confirmed_available
payment_link_active
deposit_link_expired
awaiting_deposit
deposit_failed
deposit_paid
reservation_active
balance_due
balance_partially_paid
balance_fully_paid
ready_for_pickup
fulfilled
overdue
reservation_expired
cancelled
refund_requested
refunded
disputed
closed
```

## 17. Deposit and Balance Rules

## 17.1 Minimum deposit

Each receivable product must have a minimum deposit requirement.

Deposit types:

```txt
percentage
fixed_amount
```

Example percentage:

```txt
Product price: ₦200,000
Deposit: 30%
Deposit required: ₦60,000
Balance: ₦140,000
```

Example fixed amount:

```txt
Product price: ₦500,000
Deposit required: ₦150,000
Balance: ₦350,000
```

## 17.2 Deposit activation rules

```txt
No deposit payment link before merchant confirmation.
No active reservation before minimum deposit payment.
No customer balance countdown before deposit payment.
```

## 17.3 Deposit link expiry

Default:

```txt
48 hours
```

If customer does not pay before expiry:

```txt
Status becomes deposit_link_expired.
No reservation is active.
Merchant may re-confirm if needed.
```

## 17.4 Balance due date

Balance due date can be:

```txt
X days after deposit payment
Specific calendar date
Manual due date selected by merchant during confirmation
```

MVP recommendation:

```txt
X days after deposit payment
```

## 17.5 Reservation expiry wording

Customer-facing wording:

```txt
Your deposit reserves this item until [date]. If the balance is not paid on or before this date, the merchant may cancel the reservation and make the item available to another customer, subject to the refund and cancellation terms shown before payment.
```

Avoid:

```txt
You will lose the product.
```

Use:

```txt
Your reservation may expire.
```

## 18. General Product Rules and Product Overrides

## 18.1 Rule hierarchy

```txt
Product custom rule
↓
Storefront general rule
↓
DeraLedger system default
```

## 18.2 Storefront general product rules

Merchant should set default storefront rules once.

Fields:

```txt
default_sale_mode
default_availability_mode
default_fulfilment_mode
default_deposit_type
default_deposit_value
default_balance_due_days
default_reservation_expiry_days
default_deposit_link_expiry_hours
default_refund_cancellation_note
default_reminder_schedule
```

Recommended system defaults:

```txt
default_sale_mode: instant_sale
default_availability_mode: available_for_immediate_payment
default_fulfilment_mode: pickup_and_delivery
default_deposit_type: percentage
default_deposit_value: 30
default_balance_due_days: 7
default_reservation_expiry_days: 7
default_deposit_link_expiry_hours: 48
```

## 18.3 Product-level override

Product form must include:

```txt
Use default storefront rules? Yes/No
```

If yes:

```txt
Product inherits storefront general rules.
```

If no:

```txt
Merchant can override rules for that product.
```

Override fields:

```txt
sale_mode_override
availability_mode_override
fulfilment_mode_override
deposit_type_override
deposit_value_override
balance_due_days_override
reservation_expiry_days_override
deposit_link_expiry_hours_override
refund_cancellation_note_override
```

## 19. Discount Codes

## 19.1 Feature purpose

Merchants should be able to create discount codes for their storefront. Customers should be able to apply a valid discount code at checkout.

Discount codes should support:

```txt
Percentage discount
Usage limit
Per-customer usage limit
Start date
Expiry date
Activation status
Product eligibility
Sale mode eligibility
```

MVP supports percentage discounts only.

Do not support delivery discounts in MVP because DeraLedger does not manage delivery fees.

## 19.2 Discount principle

Discount must be calculated before Collection Invoice and checkout session creation.

Correct flow:

```txt
Customer selects product
Customer applies discount code
System validates discount
System calculates discounted total
System creates Collection Invoice using discounted amount
Customer pays through existing checkout
DeraLedger records original amount, discount amount, and final payable amount
```

Do not apply discount after payment.

Do not manually alter paid invoice amounts after payment confirmation.

## 19.3 Discount access by plan

| Plan      | Discount code access                                |
| --------- | --------------------------------------------------- |
| Starter   | Preview only, no live discount codes                |
| Solo Lite | Discount codes for Instant Sale only                |
| Solo Plus | Discount codes for Instant Sale and Receivable Sale |
| Business  | Discount codes for Instant Sale and Receivable Sale |

Rules:

```txt
Starter cannot create live discount codes.
Solo Lite can create discount codes for Instant Sale only.
Solo Plus can create discount codes for Instant Sale and Receivable Sale.
Business can create discount codes for Instant Sale and Receivable Sale.
```

## 19.4 Discount type for MVP

Supported:

```txt
percentage_discount
```

Example:

```txt
Code: WELCOME10
Discount: 10%
```

Not MVP:

```txt
Fixed amount discount
Free delivery
Buy one get one free
Customer segment discount
First-order-only discount
Referral discount
Automatic discount
Stackable discount
```

## 19.5 Discount code settings

Merchant should be able to create a discount code with:

```txt
Code
Description/internal note
Percentage discount
Start date/time
End date/time
Total usage limit
Per-customer usage limit
Applicable products
Applicable sale modes
Minimum order amount
Active/inactive status
```

Example:

```txt
Code: NEWCUSTOMER10
Discount: 10%
Usage limit: 100 uses
Per-customer limit: 1 use
Starts: 1 July 2026
Expires: 31 July 2026
Applies to: All products
Sale mode: Instant Sale only
Minimum order amount: ₦10,000
```

## 19.6 Discount validation rules

A discount code is valid only if:

```txt
Code exists.
Code belongs to the merchant/storefront.
Code is active.
Current date/time is within start and expiry window.
Total usage limit has not been exceeded.
Customer usage limit has not been exceeded.
Product is eligible.
Sale mode is eligible.
Order amount meets minimum order amount.
Merchant plan allows discount codes.
Merchant compliance status allows live collection.
Merchant/storefront is not suspended.
```

A discount code is invalid if:

```txt
Expired
Inactive
Archived
Usage limit exceeded
Wrong merchant/storefront
Wrong product
Wrong sale mode
Below minimum order amount
Customer has already used it beyond allowed limit
Merchant is suspended or restricted
```

## 19.7 Instant Sale discount calculation

Formula:

```txt
Product subtotal
- Discount amount
= Final payable amount
```

Example:

```txt
Product price: ₦100,000
Discount code: SAVE10
Discount: 10%
Discount amount: ₦10,000
Final payable amount: ₦90,000
```

Collection Invoice amount:

```txt
₦90,000
```

## 19.8 Receivable Sale discount calculation

For Receivable Sale, discount should apply before deposit calculation.

Correct formula:

```txt
Original product price
- Discount amount
= Discounted order total

Deposit percentage applies to discounted order total.
Balance is calculated from discounted order total.
```

Example:

```txt
Original product price: ₦200,000
Discount code: SAVE10
Discount: 10%
Discount amount: ₦20,000
Discounted order total: ₦180,000
Deposit rule: 30%
Deposit required: ₦54,000
Balance after deposit: ₦126,000
```

This avoids confusion and keeps invoice, deposit, balance, and ledger values aligned.

## 19.9 Discount and Receivable Sale flow

Receivable Sale requires merchant confirmation before deposit payment.

Flow:

```txt
Customer selects Deposit & Balance.
Customer applies discount code.
System validates discount code.
Customer submits receivable request.
System stores discount snapshot on request.
Merchant confirms availability.
System revalidates or honors discount according to reservation rule.
System creates deposit Collection Invoice using discounted order total.
Customer pays deposit.
Discount usage is counted only after successful deposit payment.
```

Important rule:

```txt
Discount usage should not be permanently consumed when customer only submits a receivable request.
Usage should be consumed after successful payment.
```

## 19.10 Discount reservation for Receivable Sale

For Receivable Sale, the discount may need to be temporarily reserved after merchant confirmation.

Reservation trigger:

```txt
Merchant confirms receivable request and deposit payment link is created.
```

Reservation expiry:

```txt
Same as deposit payment link expiry.
```

If customer pays deposit:

```txt
Discount reservation becomes redeemed.
Usage count increases.
```

If customer does not pay deposit:

```txt
Discount reservation expires.
Usage count is released.
Order status becomes deposit_link_expired.
```

## 19.11 Discount expiry during merchant confirmation

Recommended MVP behavior:

```txt
If the code was valid when the customer submitted the request, honor it until the merchant confirmation/payment link expiry window ends.

If the customer does not pay before deposit link expiry, the discount reservation is released.
```

This prevents merchant delay from unfairly affecting the customer.

## 19.12 Discount and Collection Invoice fields

Every storefront-generated Collection Invoice should store:

```txt
original_amount
discount_code_id
discount_code
discount_type
discount_percentage
discount_amount
final_payable_amount
discount_snapshot_json
```

For Instant Sale:

```txt
Collection Invoice amount = final payable amount.
```

For Receivable Sale deposit:

```txt
Deposit Collection Invoice amount = discounted deposit required.
```

For Receivable Sale balance:

```txt
Balance Collection Invoice amount = discounted balance remaining.
```

## 19.13 Discount snapshot

Every storefront order must save the exact discount details used.

Save:

```txt
discount_code
discount_type
discount_percentage
original_product_amount
discount_amount
discounted_order_total
deposit_required_after_discount
balance_after_discount
discount_applied_at
discount_valid_from
discount_valid_until
usage_limit
per_customer_usage_limit
discount_terms_snapshot
```

This protects the platform if the merchant later edits or deletes the discount.

## 19.14 Customer-facing discount display

For Instant Sale:

```txt
Subtotal: ₦100,000
Discount code: SAVE10
Discount: -₦10,000
Total due today: ₦90,000
```

For Receivable Sale:

```txt
Original price: ₦200,000
Discount: -₦20,000
Discounted total: ₦180,000
Deposit required after discount: ₦54,000
Balance after deposit: ₦126,000
```

Invalid code message:

```txt
This discount code is invalid, expired, not available for this product, or has reached its usage limit.
```

## 19.15 Discount security rules

```txt
Discount code must be unique per merchant/storefront.
Code should be case-insensitive.
Code should be trimmed before validation.
Discount percentage must be greater than 0.
Discount percentage must not exceed merchant/system maximum.
Recommended MVP maximum discount: 80%.
Discount cannot reduce payable amount below ₦1.
Expired discount cannot be applied to new orders.
Archived discount cannot be applied.
Suspended merchant cannot create active discount codes.
Usage count must be updated transactionally.
Two simultaneous redemptions must not exceed usage limit.
```

## 20. Delivery and Pickup

## 20.1 Delivery model for MVP

Use Option 1.

Delivery is merchant-managed offline.

DeraLedger does not:

```txt
Calculate delivery fee
Manage dispatch
Assign riders
Guarantee delivery timeline
Settle logistics providers
```

Customer-facing message:

```txt
Delivery is handled directly by the merchant.

This payment does not include delivery fee. Please contact the merchant to confirm delivery cost, delivery timeline, and dispatch arrangement.
```

## 20.2 Delivery fields

Merchant storefront settings:

```txt
delivery_enabled
delivery_note
customer_care_phone
whatsapp_number
support_email
```

Customer checkout can collect:

```txt
delivery_area
delivery_address
delivery_note
```

This helps the merchant review and confirm Receivable Sale requests.

## 20.3 Pickup model

Merchant can enable pickup.

Pickup fields:

```txt
pickup_enabled
pickup_address
pickup_days
pickup_opening_time
pickup_closing_time
pickup_instructions
customer_care_phone
```

Customer-facing pickup message:

```txt
Pickup available

Address:
[Merchant pickup address]

Pickup days:
[Available days]

Pickup hours:
[Opening time - closing time]

Please come with your payment receipt or order code.
```

## 21. Merchant Ratings and Verified Reviews

## 21.1 Purpose

Ratings help customers assess merchants before doing business, without DeraLedger becoming escrow or guaranteeing products.

## 21.2 Review rule

Only verified transaction customers can rate a merchant.

Rules:

```txt
Only customers with a real DeraLedger order can review.
One review per order.
Merchant cannot review themselves.
Merchant cannot edit or delete customer reviews.
Merchant can reply once.
Admin can hide abusive, private, fraudulent, or unsafe reviews.
```

## 21.3 Review eligibility

For Instant Sale:

```txt
Review allowed after payment is successful and order is fulfilled or closed.
```

For Receivable Sale:

```txt
Review allowed after order is fulfilled, closed, refunded, cancelled, or dispute is resolved.
```

## 21.4 Review fields

```txt
overall_rating
comment
product_accuracy_rating
communication_rating
fulfilment_rating
issue_resolution_rating
```

Public storefront should display:

```txt
Average rating
Number of verified reviews
Recent comments
Merchant verification badge
Completed order count range where appropriate
```

Example:

```txt
⭐ 4.7 from 38 verified DeraLedger customers
Enhanced Verified Merchant
```

Avoid:

```txt
DeraLedger guarantees this merchant.
```

Use:

```txt
Reviews are from customers who completed payments through DeraLedger.
```

## 22. Merchant Verification Badges

Public storefront should show merchant verification status.

Badge examples:

```txt
Lite Verified
Enhanced Verified
Business Verified
```

Badge wording:

```txt
This merchant has completed DeraLedger verification checks. The merchant remains responsible for product availability, fulfilment, delivery arrangement, and refunds according to the terms shown before payment.
```

Avoid:

```txt
Guaranteed by DeraLedger
DeraLedger-protected seller
Escrow protected
```

## 23. Customer Protection Without Escrow

Because DeraLedger is not holding funds in MVP, customer trust must come from:

```txt
Merchant verification badges
Clear product/payment terms
Merchant confirmation before deposit
Minimum deposit transparency
Balance due transparency
Reservation expiry transparency
Pickup/delivery disclosure
Terms acceptance checkbox
Immutable terms snapshot
Verified customer reviews
Dispute/report issue flow
Refund request tracking
Merchant risk scoring
Storefront suspension controls
```

## 24. Customer-Facing Copy

## 24.1 Before Receivable Request

```txt
Deposit & Balance

Product price: ₦[amount]
Minimum deposit required after merchant approval: ₦[amount]
Balance after deposit: ₦[amount]
Balance due: [X days] after deposit payment

Your request will be sent to the merchant first. Payment will only become available after the merchant confirms that this product is available.
```

## 24.2 Awaiting Merchant Confirmation

```txt
Your request has been sent to the merchant.

Payment is not available yet. The merchant is confirming product availability and will activate your payment link if the request is accepted.
```

## 24.3 Merchant Confirms Availability

```txt
The merchant has confirmed availability.

Minimum deposit required: ₦[amount]
Pay before: [date/time]

After your deposit is paid, your reservation becomes active.
```

## 24.4 Deposit Paid

```txt
Deposit received.

Your reservation is now active.
Balance remaining: ₦[amount]
Balance due date: [date]

If your balance is not paid by the due date, your reservation may expire and the merchant may make the item available to another customer, subject to the refund and cancellation terms shown before payment.
```

## 24.5 Required checkbox before deposit payment

```txt
I understand and agree to the deposit amount, balance amount, due date, reservation expiry, delivery/pickup terms, discount terms where applicable, and refund/cancellation terms shown above.
```

## 25. Terms Snapshot

Every storefront order must save the exact terms shown to the customer.

Save:

```txt
product_name
product_price
sale_mode
availability_mode
deposit_type
deposit_value
deposit_required_amount
balance_amount
balance_due_rule
reservation_expiry_rule
deposit_link_expiry
fulfilment_option
pickup_details
delivery_notice
discount_details
refund_cancellation_note
merchant_customer_care_phone
terms_accepted_at
customer_ip
customer_user_agent
```

This protects DeraLedger and the merchant if product rules or discount rules change later.

## 26. Merchant Dashboard Requirements

## 26.1 Storefront settings

Sections:

```txt
Store identity
Store URL
Customer care
Pickup settings
Delivery settings
Default product rules
Discount codes
Receivable sale rules
Ratings and reviews
```

Fields:

```txt
store_name
store_slug
store_logo
store_description
customer_care_phone
whatsapp_number
support_email
pickup_enabled
pickup_address
pickup_days
pickup_opening_time
pickup_closing_time
pickup_instructions
delivery_enabled
delivery_note
default_sale_mode
default_availability_mode
default_fulfilment_mode
default_deposit_type
default_deposit_value
default_balance_due_days
default_reservation_expiry_days
default_deposit_link_expiry_hours
default_refund_cancellation_note
```

## 26.2 Product management

Merchant can:

```txt
Create product
Edit product
Archive product
Mark product available/unavailable
Upload image
Set price
Set category
Use default rules
Override rules
Set Instant Sale
Set Receivable Sale
Set pickup/delivery availability
Preview customer-facing terms
```

## 26.3 Discount code management

Add a `Discount Codes` section under Storefront.

Merchant can:

```txt
Create discount code
Edit discount code
Activate/deactivate discount code
Set percentage discount
Set start date
Set expiry date
Set total usage limit
Set per-customer usage limit
Select eligible products
Select eligible sale modes
View total redemptions
View revenue impact
Archive discount code
```

Discount list should show:

```txt
Code
Percentage
Status
Start date
Expiry date
Usage count
Usage limit
Applicable products
Applicable sale modes
Created date
```

## 26.4 Orders

Order tabs:

```txt
All
Instant Sales
Receivable Requests
Awaiting Confirmation
Awaiting Deposit
Active Reservations
Balance Due
Overdue
Fulfilled
Disputed
Refunded
```

Order card fields:

```txt
Customer name
Customer phone/email
Product
Original amount
Discount amount
Final amount
Deposit required
Deposit paid
Balance remaining
Order status
Due date
Fulfilment option
Pickup/delivery note
Collection invoice reference
Payment status
Settlement status
```

## 26.5 Receivable request review

Merchant can:

```txt
View request
View customer details
View delivery/pickup choice
View applied discount if any
Accept request
Reject request
Adjust due date where allowed
Confirm final terms
Activate deposit payment link
```

If accepted:

```txt
System creates deposit Collection Invoice.
System activates payment link.
Customer is notified.
```

If rejected:

```txt
No payment link is created.
Customer is notified.
Order closes.
```

## 27. Customer Dashboard Requirements

Registered customers should see:

```txt
Pending requests
Active payment links
Active reservations
Balance due
Paid orders
Disputes
Refund requests
Reviews to submit
```

Before merchant approval:

```txt
Status: Awaiting merchant confirmation
Payment: Not available yet
```

After merchant approval:

```txt
Status: Payment link active
Minimum deposit required
Discount applied if any
Deposit link expiry
Pay deposit button
```

After deposit:

```txt
Status: Reservation active
Deposit paid
Balance remaining
Due date
Pay balance button
Reminder history
Pickup/delivery details
```

## 28. Notifications

## 28.1 Merchant notifications

Trigger:

```txt
New instant sale
New receivable request
Discount code used
Customer paid deposit
Customer paid balance
Balance overdue
Customer raised dispute
Customer submitted review
Refund request
```

## 28.2 Customer notifications

Trigger:

```txt
Request submitted
Merchant confirmed availability
Merchant rejected request
Discount applied
Deposit payment successful
Balance reminder
Balance overdue
Reservation expired
Order fulfilled
Review request
Refund/dispute update
```

## 29. Data Model Guidance

Developer should adapt naming to existing DeraLedger conventions.

## 29.1 plan_migrations

```txt
id
merchant_id
old_plan_code
new_plan_code
migration_reason
migrated_at
migration_status
metadata_json
```

## 29.2 merchant_compliance_profiles

```txt
id
merchant_id
plan_code
business_type
compliance_status
activation_status
risk_rating
approved_monthly_volume
cumulative_collection_cap
cumulative_collection_used
hidden_daily_velocity_limit
single_transaction_limit
outstanding_receivable_cap
can_collect_payments
can_use_instant_sale
can_use_receivable_sale
can_use_storefront
can_activate_settlement
last_reviewed_at
next_review_due_at
created_at
updated_at
```

## 29.3 verification_checks

```txt
id
merchant_id
check_type
provider
provider_reference
status
result_summary
failure_reason
checked_at
metadata_json
```

## 29.4 storefronts

```txt
id
merchant_id
store_name
store_slug
store_description
store_logo_url
customer_care_phone
whatsapp_number
support_email
is_active
created_at
updated_at
```

## 29.5 storefront_settings

```txt
id
merchant_id
storefront_id
pickup_enabled
pickup_address
pickup_days_json
pickup_opening_time
pickup_closing_time
pickup_instructions
delivery_enabled
delivery_note
default_sale_mode
default_availability_mode
default_fulfilment_mode
default_deposit_type
default_deposit_value
default_balance_due_days
default_reservation_expiry_days
default_deposit_link_expiry_hours
default_refund_cancellation_note
default_reminder_schedule_json
created_at
updated_at
```

## 29.6 storefront_products

```txt
id
merchant_id
storefront_id
name
slug
description
price_amount
currency
image_url
category
status
stock_quantity_nullable
use_default_rules
sale_mode_override
availability_mode_override
fulfilment_mode_override
deposit_type_override
deposit_value_override
balance_due_days_override
reservation_expiry_days_override
deposit_link_expiry_hours_override
refund_cancellation_note_override
created_at
updated_at
archived_at
```

## 29.7 storefront_orders

```txt
id
merchant_id
storefront_id
customer_id_nullable
order_type
order_status
fulfilment_type
delivery_address_nullable
delivery_note_nullable
pickup_snapshot_json
delivery_snapshot_json
subtotal_amount
original_subtotal_amount
discount_code_id_nullable
discount_code_snapshot_json
discount_amount
discounted_total_amount
delivery_fee_amount
total_amount
currency
collection_invoice_id_nullable
record_invoice_id_nullable
created_at
updated_at
closed_at
```

Important MVP rule:

```txt
delivery_fee_amount must be 0 or null because delivery fee is handled offline by merchant.
```

## 29.8 storefront_order_items

```txt
id
order_id
product_id
product_name_snapshot
product_price_snapshot
quantity
line_total
product_rule_snapshot_json
created_at
```

## 29.9 storefront_receivables

```txt
id
order_id
merchant_id
customer_id
product_id
deposit_collection_invoice_id
balance_collection_invoice_id_nullable
total_amount
original_total_amount
discount_code_id_nullable
discount_amount
discounted_total_amount
deposit_type
deposit_value
deposit_required_amount
deposit_required_after_discount
deposit_paid_amount
balance_amount
balance_after_discount
balance_paid_amount
balance_due_date
reservation_expiry_date
deposit_link_expiry_at
receivable_status
merchant_confirmed_at
deposit_paid_at
fully_paid_at
terms_accepted_at
terms_version
terms_snapshot_json
discount_snapshot_json
created_at
updated_at
```

## 29.10 storefront_discount_codes

```txt
id3
merchant_id
storefront_id
code
description
discount_type
discount_percentage
status
starts_at
expires_at
total_usage_limit
total_usage_count
per_customer_usage_limit
minimum_order_amount
applies_to_all_products
applicable_sale_modes_json
created_at
updated_at
archived_at
```

Allowed statuses:

```txt
draft
active
inactive
expired
archived
suspended
```

Allowed sale modes:

```txt
instant_sale
receivable_sale
both
```

## 29.11 storefront_discount_products

Use this table if a discount applies only to selected products.

```txt
id
discount_code_id
product_id
created_at
```

## 29.12 storefront_discount_redemptions

```txt
id
discount_code_id
merchant_id
storefront_id
customer_id_nullable
order_id
collection_invoice_id_nullable
payment_id_nullable
redemption_status
discount_code_snapshot_json
original_amount
discount_amount
final_amount
redeemed_at
created_at
updated_at
```

Redemption statuses:

```txt
reserved
redeemed
released
expired
cancelled
refunded
```

## 29.13 merchant_reviews

```txt
id
merchant_id
storefront_id
order_id
customer_id
overall_rating
comment
product_accuracy_rating
communication_rating
fulfilment_rating
issue_resolution_rating
review_status
merchant_reply
merchant_replied_at
reported_at
admin_moderation_reason
created_at
updated_at
```

## 29.14 merchant_rating_summaries

```txt
merchant_id
average_rating
total_reviews
total_completed_orders
rating_1_count
rating_2_count
rating_3_count
rating_4_count
rating_5_count
last_reviewed_at
```

## 30. Services / Resolver Functions

## 30.1 resolveMerchantCapabilities(merchant_id)

Purpose:

```txt
Determine what the merchant can do based on plan, compliance status, risk rating, limits, and feature flags.
```

Output:

```txt
can_collect_payments
can_create_collection_invoice
can_use_instant_sale
can_use_receivable_sale
can_use_storefront
can_activate_settlement
can_create_discount_codes
can_apply_discount_to_receivable_sale
current_collection_limit
upgrade_required
manual_review_required
```

## 30.2 resolveProductSaleRules(product_id)

Purpose:

```txt
Resolve product-level sale rules using product override, storefront general rules, and system defaults.
```

Resolution order:

```txt
Product custom rule
↓
Storefront general rule
↓
DeraLedger system default
```

## 30.3 validateStorefrontDiscountCode(input)

Purpose:

```txt
Validate whether a discount code can be applied to a storefront order.
```

Input:

```txt
merchant_id
storefront_id
customer_id_nullable
product_ids
sale_mode
order_amount
discount_code
current_time
```

Output:

```txt
is_valid
failure_reason
discount_code_id
discount_percentage
discount_amount
final_amount
discount_snapshot_json
```

## 30.4 redeemDiscountCode(input)

Purpose:

```txt
Redeem or reserve discount usage safely.
```

Important:

```txt
Must run transactionally.
Must not allow usage count to exceed limit.
Must not count usage permanently until successful payment.
```

## 31. Feature Flags

All new work must be feature-flagged.

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

## 32. Build Phases

## Phase 0: Audit and Branch Setup

Recommended branch:

```bash
git checkout -b feature/plan-migration-storefront-foundation
```

Audit existing:

```txt
Plan model
Subscription billing
Invoice schema
Deposit schema
Reference generation
Record Invoice flow
Collection Invoice flow
Checkout session flow
Payment session flow
Settlement account flow
Provider abstraction
Merchant verification/KYC flow
Feature flags
```

Deliverables:

```txt
Technical audit notes
Migration-safe branch
No production behavior change
```

## Phase 1: Plan Update and Migration

Build:

```txt
Rename Individual to Solo Lite
Add Solo Plus plan at ₦13,000/month
Keep Business at ₦20,000/month
Keep Starter free
Create migration script
Add plan_code values
Add plan migration logs
Add backward compatibility for old individual references
```

Acceptance criteria:

```txt
Existing Individual users become Solo Lite.
No billing break.
No invoice break.
No checkout break.
No collection invoice break.
No record invoice break.
No payment reference break.
No settlement break.
Solo Plus exists but is hidden behind feature flag.
```

## Phase 2: Compliance and Limit Engine

Build:

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
feature access resolver
```

Build:

```txt
resolveMerchantCapabilities(merchant_id)
```

Acceptance criteria:

```txt
Plan payment alone does not unlock collection.
Compliance status controls collection.
Solo Lite has starter-stage cap.
Solo Plus has reviewed monthly band.
Business uses approved KYB volume.
```

## Phase 3: Solo Plus Onboarding and Enhanced Verification

Build:

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
PEP/sanctions hooks
Enhanced verification status
```

Acceptance criteria:

```txt
Solo Plus can be subscribed to.
Receivable Sale remains locked until Enhanced verification is approved.
Admin can approve/reject/request more information.
Merchant sees clear status.
```

## Phase 4: Storefront Foundation

Build:

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

Acceptance criteria:

```txt
Merchant can create storefront.
Slug is unique.
Store URL works.
Products can be created.
General rules apply.
Product overrides work.
Pickup details display.
Delivery notice displays.
No payment yet unless Instant Sale flag is enabled.
```

## Phase 5: Instant Sale Storefront

Build:

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

Acceptance criteria:

```txt
Customer can buy product in full.
Collection Invoice is created.
Payment reference is generated.
Payment confirmation updates order.
Merchant sees order.
Customer receives receipt.
Settlement record is created.
Duplicate webhook does not duplicate payment.
```

## Phase 6: Storefront Discount Codes

Build after Instant Sale foundation is stable.

Build:

```txt
Discount code data model
Merchant discount management UI
Discount validation service
Instant Sale checkout discount application
Collection Invoice discount snapshot
Discount redemption tracking
Usage limit enforcement
Expiry enforcement
Admin controls
```

Acceptance criteria:

```txt
Merchant can create percentage discount code.
Merchant can set usage limit.
Merchant can set expiry date.
Merchant can set per-customer usage limit.
Customer can apply valid code at checkout.
Invalid code is rejected with clear message.
Discount is calculated before Collection Invoice is created.
Collection Invoice stores discount details.
Instant Sale payment uses discounted total.
Discount usage is counted only after successful payment.
Discount usage does not exceed set limit.
Expired discount cannot be used.
Archived/inactive discount cannot be used.
Order stores discount snapshot.
Merchant can see redemption count.
```

## Phase 7: Merchant Ratings for Instant Sale

Build:

```txt
Review eligibility after completed order
Secure review link for guest customers
Customer dashboard review for registered customers
Merchant rating summary
Public rating display
Merchant reply
Admin moderation
```

Acceptance criteria:

```txt
Only verified customers can review.
One review per order.
Average rating updates.
Public storefront displays verified rating count.
Merchant cannot edit customer review.
```

## Phase 8: Receivable Sale Foundation

Build:

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

Acceptance criteria:

```txt
Guest cannot use Receivable Sale.
Customer can submit request without paying.
Payment link is inactive before merchant confirmation.
Merchant can accept/reject.
Acceptance creates deposit Collection Invoice.
Deposit payment activates reservation.
Discount is applied before deposit/balance calculation.
Balance due date starts after deposit payment.
Terms snapshot is saved.
```

## Phase 9: Receivable Reminders and Reservation Expiry

Build:

```txt
Reminder scheduler
Email reminders
Dashboard reminders
Balance overdue status
Reservation expiry status
Merchant cancellation action
Customer balance payment link
```

Acceptance criteria:

```txt
Reminders send before due date.
Overdue status updates.
Reservation can expire according to terms.
Balance payment updates receivable.
Duplicate payment does not double-count.
```

## Phase 10: Dispute, Refund Request, and Risk Controls

Build:

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

Acceptance criteria:

```txt
Customer can report issue.
Merchant can respond.
Admin can moderate.
High-dispute merchants can be flagged.
Storefront can be suspended.
Discount code can be suspended.
```

## Phase 11: Hardening and Production Rollout

Build:

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

Rollout:

```txt
Internal admin test
Sandbox merchant test
1–3 trusted beta merchants
Solo Lite Instant Sale beta
Storefront discount beta
Solo Plus Receivable Sale beta
Business storefront beta
Gradual public release
```

## 33. Testing Requirements

## 33.1 Migration tests

```txt
Individual becomes Solo Lite.
Business remains Business.
Starter remains Starter.
Existing invoices remain accessible.
Existing deposits remain accurate.
Existing payment references still resolve.
Existing Collection Invoices still collect payments.
Existing Record Invoices still display.
```

## 33.2 Compliance tests

```txt
Starter cannot collect.
Solo Lite cannot use Receivable Sale.
Solo Plus cannot use Receivable Sale before Enhanced approval.
Business cannot collect before KYB approval.
Collection caps update correctly.
Manual review triggers work.
```

## 33.3 Storefront tests

```txt
Store slug is unique.
Product inherits general rules.
Product override works.
Pickup displays correctly.
Delivery notice displays correctly.
Inactive storefront is not public.
Suspended storefront is blocked.
```

## 33.4 Instant Sale tests

```txt
Order creates Collection Invoice.
Checkout session is created.
Payment confirmation updates order.
Duplicate webhook does not duplicate payment.
Receipt is sent.
Merchant is notified.
```

## 33.5 Discount tests

```txt
Merchant can create discount code.
Discount code is unique per storefront.
Expired discount cannot be applied.
Inactive discount cannot be applied.
Usage limit is enforced.
Per-customer usage limit is enforced.
Discount applies before invoice creation.
Discount amount is saved on order.
Discount snapshot is saved.
Collection Invoice amount equals discounted total.
Usage is counted only after successful payment.
Concurrent redemptions do not exceed limit.
```

## 33.6 Receivable Sale tests

```txt
Guest cannot request Receivable Sale.
Registered customer can submit request.
No payment link before merchant confirmation.
Merchant rejection closes request.
Merchant acceptance creates deposit Collection Invoice.
Discount applies before deposit calculation.
Deposit payment activates reservation.
Balance due date is calculated.
Balance payment closes receivable.
Terms snapshot is immutable.
```

## 33.7 Review tests

```txt
Only paid customers can review.
One order can only be reviewed once.
Merchant cannot review self.
Admin can hide abusive review.
Rating summary updates.
```

## 34. MVP Scope

MVP includes:

```txt
Plan migration
Solo Plus plan
Compliance/limit engine
Storefront foundation
Product creation
General product rules
Product-level overrides
Pickup settings
Merchant-managed delivery notice
Instant Sale
Collection Invoice integration
Direct settlement tracking
Discount codes for Instant Sale
Merchant ratings
Receivable request
Merchant confirmation before deposit
Deposit Collection Invoice
Discount support for Receivable Sale
Balance Collection Invoice
Customer dashboard
Terms snapshot
Basic reminders
```

Not MVP:

```txt
Escrow
DeraLedger-managed logistics
Custom domains
Marketplace discovery
Advanced inventory
Coupons beyond percentage discount code
Fixed amount discount
Free delivery discount
Product variants
Multi-store branches
Delivery fee calculator
BNPL lending
Credit scoring
Provider-led hold/release
```

## 35. Final Product Summary

DeraLedger Smart Storefront should be built as an extension of the existing invoice, deposit, reference, checkout, Record Invoice, and Collection Invoice system.

The product should support:

```txt
Instant Sale:
Customer pays full amount immediately through existing checkout and Collection Invoice flow.

Receivable Sale:
Registered customer submits request, merchant confirms availability, deposit Collection Invoice is generated, customer pays deposit, reservation starts, balance is tracked, reminders are sent, and balance payment is collected through another Collection Invoice.

Discount Codes:
Merchant creates percentage discount codes with usage limits and expiry dates. Customer applies valid code at checkout. Discount is calculated before invoice/payment creation and is saved in the order, invoice, receivable, and terms snapshots.
```

The plan system should become:

```txt
Starter: Free
Solo Lite: ₦5,000/month
Solo Plus: ₦13,000/month
Business: ₦20,000/month
```

The compliance system must remain separate from the plan system.

The settlement model should be direct settlement for now.

The customer trust model should rely on:

```txt
Verified merchant badges
Clear terms
No deposit before merchant confirmation
Discount transparency
Terms snapshots
Verified customer ratings
Dispute/report issue flow
Merchant risk scoring
```

The final product direction is:

> DeraLedger Smart Storefront gives African merchants a simple public store page, but its real strength is not just product checkout. Its strength is helping merchants collect payments, apply controlled discounts, manage deposits, track balances, remind customers, record settlement, and build trust through verified transaction-based ratings.
