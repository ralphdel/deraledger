# Approval runtime boundary source checkpoint

Date: 2026-08-25

Added source-only, injectable reviewer-identity and canonical-read contracts with a pure approval command builder. The boundary accepts only target compliance status and safe reason code as UI intent; reviewer identity, merchant/workspace/profile/source identifiers, versions, policy version, review time, and idempotency key are re-derived by injected server-side repositories.

Only `super_admin` is currently accepted. Deferred compliance reviewer, merchant owner/team, customer, anonymous, browser-direct, and browser-origin identities reject before canonical reads. The core creates no Supabase client, transport, or database call. Its test-only execution port is injected and maps thrown/unknown outcomes fail closed.

The module has no route/page/action/webhook import and represents no activation, collection, payment, provider, invoice, subscription, or storefront write. Runtime adoption remains forbidden.

Next gate: independently review this source-only boundary before considering a server-only repository implementation or a future internal API design.
