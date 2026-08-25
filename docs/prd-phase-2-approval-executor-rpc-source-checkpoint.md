# Approval executor RPC source checkpoint

Date: 2026-08-25

This source-only bridge connects the existing compliance approval command validator to the cleaned Migration 027 RPC adapter by dependency injection. It does not adopt the RPC in runtime.

The bridge validates the command before adapter invocation, preserves the decision key, expected profile version, source type/ID/version, reviewer, policy version, review time, and reason code, then maps adapter `created`, `replay`, `preserved`, and safe rejection results into the established executor result shapes. Unknown or thrown adapter outcomes fail closed.

No database or Supabase client is constructed. No route, page, action, webhook, payment, provider, entitlement, activation, subscription, invoice, or storefront operation imports or invokes this bridge. Collection remains locked.

Next gate: independently review this source-only wiring. Any real server transport ownership and runtime adoption require a separate reviewed design, rehearsal, and approval.
