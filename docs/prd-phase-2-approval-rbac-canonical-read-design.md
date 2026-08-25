# Approval RBAC and canonical read boundary design

Date: 2026-08-25

## Status

This is a source-only design prerequisite for the approval runtime workflow. It creates no API, service, repository, database query, or approval decision.

The current codebase has a usable server-side `super_admin` pattern: `src/lib/admin-auth.ts` and the server-only Solo Plus access context derive the authenticated user from Supabase auth and inspect trusted user metadata. `requireAdminPortalSession` alone is insufficient because its `admin_session=authenticated` cookie does not identify a reviewer or establish a specific authorization grant.

The current merchant/team role model is merchant-scoped and includes ownership, team membership, and business custom roles. It does not provide a reviewed, platform-wide `compliance_reviewer` grant. Therefore the only currently supportable future approval reviewer role is `super_admin`. A separate `compliance_reviewer` role may be added only after an independent RBAC/schema design defines immutable platform-scoped membership, revocation, audit, and conflict rules; it must not be inferred from a merchant role or UI claim.

## Reviewer identity model

The future server-only approval service must call a dedicated `resolveApprovalReviewer` helper before any canonical profile/source read or service-role transport construction.

1. Resolve the authenticated Supabase session user using the cookie-bound server auth client.
2. Require a non-empty immutable user ID.
3. Derive `super_admin` from trusted server-read auth metadata using the existing Solo Plus pattern (`app_metadata.is_super_admin === true` or `user_metadata.is_super_admin === true`), pending future hardening of the authoritative claim source.
4. If a later platform-scoped compliance-reviewer registry exists, query it through a dedicated server-only repository and require an active, non-expired, approval-capable grant. Until then, do not accept the label.
5. Return only `{ reviewerId, authorization: "internal_compliance_reviewer" | "compliance_operator", authorized: true }` to the command layer. The reviewer ID never comes from UI input.

The helper must be server-only, injectable for tests, and must not return a Supabase client, service-role key, browser session token, or generic role-query API.

## Authorized and denied callers

| Caller | Decision authorization |
| --- | --- |
| Authenticated `super_admin` | Allowed, subject to canonical decision validation. |
| Future explicit platform compliance reviewer | Deferred; allowed only after separate role-model approval. |
| Merchant owner | Denied. |
| Merchant team member/custom role | Denied. |
| Customer/director/onboarding user | Denied. |
| Anonymous or missing session | Denied. |
| Browser-direct database/RPC caller | Denied by both server boundary and database grants. |
| Caller presenting a service-role-looking field/header | Denied; never authority. |

No merchant relationship, team permission, `admin_session` cookie alone, request header, or browser-provided reviewer identity grants approval authority.

## Canonical read model

The future service accepts a narrowly limited UI intent: an internal review record/case selector, requested target status, safe reason code, and an idempotency presentation token. It must re-derive all authority-bearing values in one server-only canonical read boundary before building the command.

| Required field | Canonical source and validation |
| --- | --- |
| `merchant_id` | Exactly one resolved profile's merchant ID. Ignore UI merchant ID except as a selector to cross-check. |
| `profile_id` | Exactly one compliance profile identified by the internal review context. |
| `plan_code` | Profile plan, cross-checked against the source record's plan/type. |
| `source_type` | Derived from the source table/type: Lite review, Business KYB review, or Solo Plus case. |
| `source_id` | Exact canonical review/case ID. |
| `source_version` | Current trusted source row version; must be positive and equal to the reviewed source snapshot/version. |
| `expected_profile_row_version` | Current profile row version, re-read immediately before command construction. |
| current compliance status | Current profile value; must be one of the approved pending/attention source states and plan-compatible. |
| `policy_version` | Current approved policy reference associated with the canonical review workflow/case; reject missing/blank/ambiguous values. |
| `reason_code` | UI proposal may be accepted only after allowlist validation and target-outcome requirements are rechecked server-side. |
| `reviewer_id` | Derived only from `resolveApprovalReviewer`. |
| `reviewed_at` | Server-generated timestamp at authorization/decision time. |
| `decision_idempotency_key` | Server-generated or server-reconciled immutable key bound to reviewer, profile, source, target, policy, and safe reason. |

The boundary must lock nothing itself; Migration 026 RPC remains responsible for the authoritative profile lock and expected-version check. The canonical reader prevents stale or cross-linked intent from reaching the RPC; the RPC repeats atomic checks at write time.

## UI trust boundary

The UI may request a target (`lite_verified`, `enhanced_verified`, `business_verified`, `needs_attention`, `restricted`, or `rejected`) and a safe reason where applicable. It may show canonical profile/source data supplied by a safe internal read API.

The server ignores or re-derives all UI-provided `merchant_id`, `profile_id`, `plan_code`, `source_type`, `source_id`, source/profile versions, reviewer ID, policy version, reviewed time, service-role context, entitlement fields, activation state, and collection capabilities. UI input cannot select a different merchant/source after server canonicalization.

## Fail-closed rules

- Missing/invalid session: `approval_reviewer_unauthorized`; no canonical reads beyond safe session resolution and no transport.
- Insufficient role or unsupported future reviewer label: `approval_reviewer_unauthorized`.
- Merchant/profile mismatch, profile multiplicity, cross-merchant source, or source multiplicity: reject as safe canonical-state mismatch.
- Missing source, unsupported source status/type, nonpositive or stale source version: reject; no inferred/default source facts.
- Stale profile row version/current state: reject as state changed; require fresh canonical review.
- Plan/source/target incompatibility: let command validation fail closed before adapter/transport invocation.
- Missing or ambiguous policy version: reject; never substitute a UI policy string.
- Invalid/missing required reason code: command validation fails closed.
- Replay mismatch, transport failure, malformed result, or unknown result: safe conflict/unavailable response; no alternate table write and no success claim.

## Minimal future repository interfaces

These are design contracts only. A later server-only implementation must keep them narrow and injectable.

```ts
type ApprovalReviewerAuthorization = {
  reviewerId: string;
  authorization: "internal_compliance_reviewer" | "compliance_operator";
  authorized: true;
};

interface ApprovalReviewerIdentityRepository {
  resolveAuthenticatedReviewer(): Promise<ApprovalReviewerAuthorization>;
}

type CanonicalApprovalProfile = {
  merchantId: string;
  profileId: string;
  planCode: "solo_lite" | "solo_plus" | "business";
  complianceStatus: "lite_pending" | "enhanced_pending" | "business_pending" | "needs_attention";
  rowVersion: number;
};

type CanonicalApprovalSource = {
  sourceType: "solo_lite_review" | "business_kyb_review" | "solo_plus_case";
  sourceId: string;
  sourceVersion: number;
  merchantId: string;
  profileId: string;
  planCode: "solo_lite" | "solo_plus" | "business";
  policyVersion: string;
  evidenceState: "complete";
};

interface CanonicalApprovalReadRepository {
  loadOneProfileForInternalReview(selector: { profileId: string }): Promise<CanonicalApprovalProfile | null>;
  loadOneSourceForInternalReview(selector: { sourceId: string; sourceType: CanonicalApprovalSource["sourceType"] }): Promise<CanonicalApprovalSource | null>;
  reconcileDecisionIdempotency(input: {
    reviewerId: string; profileId: string; sourceId: string; targetStatus: string; policyVersion: string; reasonCode: string | null;
  }): Promise<{ decisionIdempotencyKey: string }>;
}
```

Implementations must reject duplicate/ambiguous data explicitly instead of collapsing it to `null`, and must expose no activation, entitlement, payment, provider, invoice, subscription, merchant/workspace mutation, or generic Supabase-client surface.

## Non-activation and prohibited-write boundary

The RBAC and canonical read boundary authorizes no activation or collection unlock. It must not set setup/live flags or collection entitlement, and may not invoke provider, payment, checkout, limit, invoice, subscription, settlement, merchant, workspace, or storefront writes. The later approval RPC call remains limited to profile decision fields and its append-only compliance event.

## Next gate

Independently review this design. Then separately design/approve source-only reviewer identity and canonical-read implementations with fakes, static runtime-import checks, redacted diagnostics, idempotency reconciliation tests, and no-write boundary tests. No runtime API/UI adoption is authorized by this document.
