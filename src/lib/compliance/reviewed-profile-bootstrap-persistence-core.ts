import type { ReviewedProfileBootstrapPayload } from "./reviewed-profile-bootstrap-core";

/**
 * Write-contract only. A future server-side implementation must supply an
 * atomic executor (for example, a service-role transaction/RPC boundary).
 * This core never creates a client, reads at import time, or writes itself.
 */

export interface PersistedBootstrapProfile {
  id: string;
  merchantId: string;
  complianceStatus: string | null;
  restrictionState: string | null;
}

export interface PersistedBootstrapReview {
  id: string;
  merchantId: string;
  idempotencyKey: string;
}

export interface ReviewedProfileBootstrapAtomicWriter {
  findProfiles(merchantId: string): Promise<readonly PersistedBootstrapProfile[]>;
  findReviewByIdempotencyKey(input: {
    merchantId: string;
    idempotencyKey: string;
  }): Promise<readonly PersistedBootstrapReview[]>;
  insertProfile(row: Record<string, unknown>): Promise<{ id: string } | null>;
  insertReview(row: Record<string, unknown>): Promise<{ id: string } | null>;
  insertEvent(row: Record<string, unknown>): Promise<{ id: string } | null>;
}

/**
 * The executor is required so callers cannot represent a partial three-row
 * write as success. Its implementation must roll back if the callback throws.
 */
export interface ReviewedProfileBootstrapPersistenceDatabase {
  executeAtomically<T>(
    operation: (writer: ReviewedProfileBootstrapAtomicWriter) => Promise<T>,
  ): Promise<T>;
}

export type ReviewedProfileBootstrapPersistenceReasonCode =
  | "bootstrap_payload_invalid"
  | "bootstrap_plan_not_persistable"
  | "bootstrap_existing_result"
  | "bootstrap_profile_preserved"
  | "bootstrap_profile_ambiguous"
  | "bootstrap_review_ambiguous"
  | "bootstrap_atomic_write_failed";

export type ReviewedProfileBootstrapPersistenceResult =
  | { kind: "created"; profileId: string; reviewId: string | null; eventId: string }
  | { kind: "existing"; profileId: string | null; reviewId: string | null; diagnostics: readonly [{ code: "bootstrap_existing_result" | "bootstrap_profile_preserved" }] }
  | { kind: "rejected"; diagnostics: readonly [{ code: Exclude<ReviewedProfileBootstrapPersistenceReasonCode, "bootstrap_existing_result" | "bootstrap_profile_preserved"> }] };

function nonEmpty(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function isSafePayload(payload: ReviewedProfileBootstrapPayload): boolean {
  const untrustedPayload = payload as unknown as {
    activationStatus?: unknown;
    restrictionState?: unknown;
    merchantEntitlements?: Record<string, unknown>;
  };
  return Boolean(
    nonEmpty(payload.merchantId)
      && nonEmpty(payload.workspaceId)
      && nonEmpty(payload.bootstrapKey)
      && nonEmpty(payload.reviewSourceId)
      && nonEmpty(payload.reviewedBy)
      && nonEmpty(payload.reviewedAt)
      && untrustedPayload.activationStatus !== "approved"
      && untrustedPayload.restrictionState !== "active"
      && [
        "canCollectPayments",
        "canUseInstantSale",
        "canUseReceivableSale",
        "canUseStorefront",
        "canActivateSettlement",
        "canUseDepositBalance",
      ].every((key) => untrustedPayload.merchantEntitlements?.[key] === false),
  );
}

function preservesExisting(profile: PersistedBootstrapProfile): boolean {
  const status = String(profile.complianceStatus ?? "").trim().toLowerCase();
  const restriction = String(profile.restrictionState ?? "").trim().toLowerCase();
  return ["lite_verified", "enhanced_verified", "business_verified", "restricted", "rejected"].includes(status)
    || ["restricted", "suspended"].includes(restriction);
}

function reviewStatus(payload: ReviewedProfileBootstrapPayload): "pending" | "rejected" | "needs_attention" {
  if (payload.complianceStatus === "rejected") return "rejected";
  if (payload.complianceStatus === "needs_attention" || payload.complianceStatus === "restricted") {
    return "needs_attention";
  }
  return "pending";
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Persists only a reviewed, non-operational bootstrap payload. Solo Plus is
 * deliberately linked to its existing case rather than violating the 024
 * review-table check, which only permits Solo Lite and Business reviews.
 */
export async function persistReviewedProfileBootstrap(
  payload: ReviewedProfileBootstrapPayload,
  database: ReviewedProfileBootstrapPersistenceDatabase,
): Promise<ReviewedProfileBootstrapPersistenceResult> {
  if (!isSafePayload(payload)) {
    return { kind: "rejected", diagnostics: [{ code: "bootstrap_payload_invalid" }] };
  }
  if (payload.planCode === "starter") {
    return { kind: "rejected", diagnostics: [{ code: "bootstrap_plan_not_persistable" }] };
  }

  try {
    return await database.executeAtomically(async (writer) => {
      const [profiles, reviews] = await Promise.all([
        writer.findProfiles(payload.merchantId),
        writer.findReviewByIdempotencyKey({ merchantId: payload.merchantId, idempotencyKey: payload.bootstrapKey }),
      ]);
      if (reviews.length > 1) {
        return { kind: "rejected", diagnostics: [{ code: "bootstrap_review_ambiguous" }] };
      }
      if (reviews.length === 1) {
        return { kind: "existing", profileId: null, reviewId: reviews[0].id, diagnostics: [{ code: "bootstrap_existing_result" }] };
      }
      if (profiles.length > 1) {
        return { kind: "rejected", diagnostics: [{ code: "bootstrap_profile_ambiguous" }] };
      }
      if (profiles.length === 1) {
        if (preservesExisting(profiles[0])) {
          return { kind: "existing", profileId: profiles[0].id, reviewId: null, diagnostics: [{ code: "bootstrap_profile_preserved" }] };
        }
        return { kind: "rejected", diagnostics: [{ code: "bootstrap_profile_ambiguous" }] };
      }

      const profileId = newId();
      const needsReviewRow = payload.planCode === "solo_lite" || payload.planCode === "business";
      const reviewId = needsReviewRow ? newId() : null;
      const sourceType = payload.planCode === "solo_lite"
        ? "solo_lite_review"
        : payload.planCode === "business"
          ? "business_kyb_review"
          : "solo_plus_case";
      const sourceId = reviewId ?? payload.reviewSourceId;

      const profile = await writer.insertProfile({
        id: profileId,
        merchant_id: payload.merchantId,
        plan_code: payload.planCode,
        compliance_status: payload.complianceStatus,
        activation_status: payload.activationStatus,
        restriction_state: payload.restrictionState,
        can_collect_payments: false,
        can_use_instant_sale: false,
        can_use_receivable_sale: false,
        can_use_storefront: false,
        can_activate_settlement: false,
        can_use_deposit_balance: false,
        decision_source_type: sourceType,
        decision_source_id: sourceId,
        last_reviewed_at: payload.reviewedAt,
        reviewed_by: payload.reviewedBy,
      });
      if (!profile?.id) throw new Error("profile_insert_failed");

      if (needsReviewRow) {
        const review = await writer.insertReview({
          id: reviewId,
          merchant_id: payload.merchantId,
          profile_id: profile.id,
          review_type: payload.planCode === "business" ? "business_kyb" : "solo_lite",
          target_plan_code: payload.planCode,
          review_status: reviewStatus(payload),
          evidence_snapshot: { source: "reviewed_profile_bootstrap" },
          reviewed_at: payload.reviewedAt,
          reviewed_by: payload.reviewedBy,
          idempotency_key: payload.bootstrapKey,
        });
        if (!review?.id) throw new Error("review_insert_failed");
      }

      const event = await writer.insertEvent({
        id: newId(),
        merchant_id: payload.merchantId,
        profile_id: profile.id,
        event_type: "reviewed_profile_bootstrap_v1",
        from_state: {},
        to_state: {
          compliance_status: payload.complianceStatus,
          activation_status: payload.activationStatus,
          restriction_state: payload.restrictionState,
          merchant_entitlements: payload.merchantEntitlements,
        },
        actor_type: "admin",
        actor_id: payload.reviewedBy,
        source_type: sourceType,
        source_id: sourceId,
        idempotency_key: `${payload.bootstrapKey}:bootstrap`,
        resulting_row_version: 1,
        metadata: { source: "reviewed_profile_bootstrap" },
      });
      if (!event?.id) throw new Error("event_insert_failed");
      return { kind: "created", profileId: profile.id, reviewId, eventId: event.id };
    });
  } catch {
    return { kind: "rejected", diagnostics: [{ code: "bootstrap_atomic_write_failed" }] };
  }
}
