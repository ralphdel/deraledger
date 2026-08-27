# Canonical approval readiness source checkpoint

Date: 2026-08-27

Migration 030 v2 readiness RPCs are installed in production. This checkpoint adds a source-only, server-only mapping layer for issuing canonical approval decision requests and reading their canonical snapshots through injected narrow transports.

The layer is not imported by routes, actions, pages, or webhooks. It does not execute an approval, activate a merchant, unlock collection, or write payment, provider, subscription, invoice, or storefront data. Each operation resolves reviewer identity through an injected server-session/RBAC resolver; it accepts no caller-supplied authority, role, origin, or reviewer ID. Only a derived `super_admin` context is accepted; all other actor kinds and resolver failures fail closed.

M030 remains authoritative for deriving trusted source, version, workspace-linkage, and idempotency facts. The source layer maps only the locked v2 result codes; malformed or unknown responses, including unknown snapshot reason codes, fail closed without exposing database details.

Safe next step: independently source-review this isolated layer before any separately approved admin API integration. Runtime adoption remains blocked.
