# PRD Phase 2 Reviewed Profile Bootstrap Plan

## Purpose of Reviewed Profile Bootstrap

Reviewed profile bootstrap is the controlled, source-of-truth step that may create a merchant compliance profile in a draft or pending state after a human-reviewed onboarding or compliance review flow. It exists so the compliance substrate can represent a merchant under review without treating that merchant as approved, active, or allowed to collect.

## Why Automatic Backfill Is Prohibited

Automatic backfill is prohibited because it would silently convert historical merchant state into compliance approval without a documented review decision. Existing payment, setup, or verification signals are not the same thing as PRD Phase 2 approval, and they must not be used to create an approved profile automatically.

## Source Evidence Allowed for Bootstrap

- Reviewed onboarding submission
- Explicit compliance reviewer decision
- Merchant identity linkage
- Workspace linkage
- Plan context
- Submitted business profile evidence
- Submitted verification evidence
- Submitted settlement readiness evidence
- Manual review outcome

## Source Evidence That Must Not Become Approval by Itself

- `payment_records`
- subscription activation
- `setup_mode`
- `live_features_enabled`
- `verification_status`
- provider settlement presence alone
- browser-submitted plan metadata
- browser-submitted merchant/workspace IDs
- any implicit paid state without review

## Canonical Status Mapping

- Safe bootstrap `compliance_status` values:
  - `draft`
  - `lite_pending`
  - `enhanced_pending`
  - `business_pending`
  - `needs_attention`
  - `restricted`
  - `rejected`
- Activation status during bootstrap:
  - `test_mode` by default
  - `restricted` or `suspended` only when explicitly recording a restriction or suspension outcome
- Restriction state:
  - `null` by default
  - `restricted` or `suspended` only for explicit reviewed restriction or suspension outcomes
  - never default active
- Review table status:
  - `draft`
  - `pending`
  - `approved`
  - `rejected`
  - `needs_attention`
  - `cancelled`

## Safe Initial Profile States

- `draft`
- `lite_pending`
- `enhanced_pending`
- `business_pending`
- `needs_attention`
- `restricted`
- `rejected`

These states may exist without enabling collection, storefront, or live provider behavior.

## Solo Lite Reviewed Bootstrap Path

Solo Lite may receive a reviewed bootstrap profile only after the reviewed onboarding or compliance flow captures sufficient evidence for a bootstrap profile. A Solo Lite payment alone is not approval. The bootstrap profile should remain `lite_pending` until a separate reviewed activation exists.

## Solo Plus Reviewed Bootstrap Path

Solo Plus may receive a reviewed bootstrap profile only after reviewed evidence supports the higher-risk plan path. The bootstrap result should be `enhanced_pending` unless a separate explicit approval transition exists.

## Business KYB Reviewed Bootstrap Path

Business may receive a reviewed bootstrap profile only after KYB evidence is reviewed. The profile should be `business_pending` by default, or `needs_attention` when the reviewer records an incomplete case.

## How To Handle Existing Paid Merchants

Existing paid merchants should be eligible for reviewed bootstrap only when a reviewer explicitly confirms that the merchant's evidence supports compliance profile creation. Historical payment and subscription data may inform the review, but they do not create approval on their own.

## How To Handle Missing or Ambiguous Evidence

Missing or ambiguous evidence must fail closed. The bootstrap flow may create no profile at all, or create only a canonical bootstrap profile if the review flow explicitly chooses to record an incomplete case. It must never infer approval.

## How To Handle Rejected, Restricted, or Suspended Merchants

Rejected, restricted, or suspended merchants may receive a profile state that records that outcome, but the state must remain non-operational. These merchants must not be treated as active or eligible for collection.

## Review Actor and Audit Expectations

- The actor must be an authenticated internal reviewer or approved compliance operator.
- The bootstrap action must record who reviewed the case.
- The audit trail must preserve the evidence classes used for the review decision.
- Any later activation must be separately auditable from bootstrap creation.

## Idempotency Expectations

- Repeating the same reviewed bootstrap decision must not create duplicate profile rows.
- The flow should upsert by merchant identity and review scope.
- Duplicate or conflicting review decisions must fail closed.

## What Profile Bootstrap May Write Later

- Compliance profile rows in canonical bootstrap states
- Review metadata
- Review outcome references
- Review timestamps
- Reviewer identity references

## What Profile Bootstrap Must Never Write

- Activation state
- Collection enablement
- `setup_mode=false`
- `live_features_enabled=true`
- approval states inferred from payment alone
- provider configuration changes
- payment/provider routing changes
- storefront enablement
- settlement unlocks

## Tests Required Before Implementation

- reviewed bootstrap can create only canonical bootstrap states
- payment alone does not create approval
- verification alone does not create approval
- setup/live flags do not create approval
- missing evidence fails closed
- ambiguous evidence fails closed
- rejected/restricted merchants remain non-operational
- repeated bootstrap is idempotent
- no automatic backfill occurs for all merchants

## Production Rollout Gates

- reviewed bootstrap design approved
- persistence contract approved
- transition rules approved
- implementation tests passing
- no collection-unlock dependency
- no storefront dependency
- explicit activation transition defined separately
