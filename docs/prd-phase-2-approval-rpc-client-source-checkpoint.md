# Approval RPC client source checkpoint

Date: 2026-08-25

Migration 026 installed `public.review_compliance_profile_decision_v1`; Migration 027 cleaned its local diagnostic instrumentation. This checkpoint records a source-only client adapter. It is not a runtime adoption.

## Adapter boundary

`src/lib/compliance/compliance-profile-approval-rpc-client-core.ts` maps an already validated approval command to the exact 13-input RPC signature through an injected transport. Its server-only facade requires the established `service_role` plus internal-review authorization boundary. It constructs no database or Supabase client, performs no import-time work, and has no route, page, action, webhook, or runtime consumer.

Known RPC outcomes map to `created`, `replay`, or `preserved`; expected RPC failures and unknown result codes fail closed with safe application diagnostics. The adapter preserves the decision idempotency key, expected profile row version, reviewer ID, policy version, reviewed timestamp, reason code, and the Lite, Business, and Solo Plus source types.

## Safety status

- No database touched and no RPC call executed against real data.
- No runtime adoption, approval execution, activation, collection unlock, provider/payment testing, or storefront work.
- No collection entitlement, activation, payment, provider, invoice, subscription, or storefront writes are represented.

## Next gate

Keep this adapter source-only until a separately reviewed runtime-adoption plan defines trusted profile resolution, service-role transport ownership, authorization, observability, and rollout/rehearsal gates. Collection remains locked.
