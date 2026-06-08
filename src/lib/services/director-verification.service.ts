/**
 * DeraLedger — Director KYB & Verification Service
 *
 * Handles director/shareholder identity and face verification for corporate accounts.
 * Writes records to business_director_verifications.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  getActiveProvider,
  getActiveProviderKey,
  isVerificationSandboxMode,
  updateProviderHealth,
} from "@/lib/kyc/index";
import { PROVIDER_COSTS } from "@/lib/kyc/types";
import type { VerificationResult, ProviderAdapter } from "@/lib/kyc/types";

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Provider Cost Dynamic Resolver ───────────────────────────────────────────

async function fetchDirectorCost(
  adminClient: any,
  providerName: string
): Promise<number> {
  try {
    const { data } = await adminClient
      .from("verification_providers")
      .select("director_cost")
      .eq("provider_name", providerName.toUpperCase())
      .maybeSingle();

    if (data && data.director_cost !== null) {
      return Number(data.director_cost);
    }
  } catch (err: any) {
    console.error("[DirectorService] Dynamic cost query failed:", err?.message);
  }

  const costs = PROVIDER_COSTS[providerName.toUpperCase()] || PROVIDER_COSTS.DEFAULT;
  return costs.director ?? 150;
}

function maskBVN(bvn: string): string {
  if (!bvn || bvn.length < 11) return "***********";
  return `${bvn.slice(0, 3)}******${bvn.slice(9)}`;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function tokenizeName(value: string): string[] {
  return normalizeName(value)
    .split(/\s+/)
    .filter(Boolean);
}

function nameTokensMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;

  const minFuzzyLength = 4;
  if (left.length < minFuzzyLength || right.length < minFuzzyLength) {
    return false;
  }

  return left.includes(right) || right.includes(left);
}

function directorNameMatchesProfile(
  profileName: string,
  returnedName: { firstName?: string; middleName?: string; lastName?: string }
): boolean {
  const profileTokens = tokenizeName(profileName);
  const bvnFullName = [returnedName.firstName, returnedName.middleName, returnedName.lastName]
    .filter(Boolean)
    .join(" ");
  const bvnTokens = tokenizeName(bvnFullName);
  const bvnSurname = normalizeName(returnedName.lastName || "");

  if (!bvnTokens.length) return true;

  if (!bvnSurname) {
    return profileTokens.some((profileToken) =>
      bvnTokens.some((bvnToken) => nameTokensMatch(profileToken, bvnToken))
    );
  }

  const surnameMatches = profileTokens.some((profileToken) => nameTokensMatch(profileToken, bvnSurname));
  if (!surnameMatches) return false;

  const nonSurnameBvnTokens = bvnTokens.filter((token) => token !== bvnSurname);
  return nonSurnameBvnTokens.some((bvnToken) =>
    profileTokens.some((profileToken) => nameTokensMatch(profileToken, bvnToken))
  );
}

// ── Main Service Functions ────────────────────────────────────────────────────

/**
 * Verify a director's identity (BVN + selfie).
 * Writes the results directly to the business_director_verifications table.
 */
export async function verifyDirectorIdentity(params: {
  merchantId: string;
  businessVerificationId?: string;
  directorName: string;
  directorRole: "director" | "shareholder" | "beneficial_owner" | "signatory" | "proprietor" | "partner" | "trustee";
  bvn: string;
  selfieBase64: string;
}): Promise<{
  success: boolean;
  verificationId?: string;
  faceMatchScore: number | null;
  status: "verified" | "failed" | "manual_review" | "pending";
  error?: string;
  duplicatePrevented?: boolean;
}> {
  const adminClient = getServiceClient();
  const sandbox = await isVerificationSandboxMode();

  const normalizedDirectorName = normalizeName(params.directorName);
  const existingQuery = adminClient
    .from("business_director_verifications")
    .select("id, director_name, verification_status, face_match_score, business_verification_id")
    .eq("merchant_id", params.merchantId)
    .order("created_at", { ascending: false });

  const { data: existingRows } = await existingQuery;
  const reusableVerification = (existingRows || []).find((row: {
    id?: string | null;
    verification_status?: string | null;
    face_match_score?: number | null;
    business_verification_id?: string | null;
    director_name?: string | null;
  }) => {
    const sameBusinessContext =
      !params.businessVerificationId ||
      !row.business_verification_id ||
      row.business_verification_id === params.businessVerificationId;

    const currentName = normalizeName(String((row as { director_name?: string | null }).director_name || ""));
    return sameBusinessContext && currentName === normalizedDirectorName;
  });

  if (reusableVerification?.verification_status === "verified") {
    return {
      success: true,
      verificationId: reusableVerification.id || undefined,
      faceMatchScore: reusableVerification.face_match_score ?? null,
      status: "verified",
      duplicatePrevented: true,
    };
  }

  if (reusableVerification?.verification_status === "manual_review") {
    return {
      success: false,
      verificationId: reusableVerification.id || undefined,
      faceMatchScore: reusableVerification.face_match_score ?? null,
      status: "manual_review",
      duplicatePrevented: true,
    };
  }

  const providerKey = await getActiveProviderKey();
  const provider = await getActiveProvider();
  const cost = sandbox ? 0 : await fetchDirectorCost(adminClient, providerKey);

  // 1. Upload selfie to storage bucket under a dedicated director folder
  const selfieStoragePath = `${params.merchantId}/directors/selfie-${Date.now()}.jpg`;
  try {
    const buffer = Buffer.from(params.selfieBase64, "base64");
    await adminClient.storage.from("kyc-documents").upload(selfieStoragePath, buffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
  } catch (err: any) {
    console.error("[DirectorService] Failed to upload director selfie:", err?.message);
  }

  // 2. Generate signed URL for selfie (valid for 1 year so admins can review later)
  let selfieSignedUrl = "";
  try {
    const { data: urlData } = await adminClient.storage
      .from("kyc-documents")
      .createSignedUrl(selfieStoragePath, 31536000); // 1 year
    selfieSignedUrl = urlData?.signedUrl || "";
  } catch (err: any) {
    console.error("[DirectorService] Signed URL creation failed:", err?.message);
  }

  // 3. Call Provider Gateway. Sandbox mode uses the provider sandbox API.
  let result: VerificationResult;
  try {
    const p = provider as any;
    if (typeof p.verifyBVNWithFace === "function") {
      result = await p.verifyBVNWithFace({
        bvn: params.bvn,
        selfieImageUrl: selfieSignedUrl,
        selfieBase64: params.selfieBase64,
        customerReference: params.merchantId,
      });
    } else {
      // Fallback duck typing
      const raw = await p.verifyBVNWithSelfie({
        bvn: params.bvn,
        selfieBase64: params.selfieBase64,
        customerReference: params.merchantId,
      });
      const { extractDojahMatchScore } = await import("@/lib/kyc/dojah.provider");
      const matchScore = extractDojahMatchScore(raw) ?? null;
      const bvnExists = Boolean(raw.entity?.bvn || raw.status);
      const faceMatch = matchScore !== null && matchScore >= 70;
      result = {
        success: bvnExists && faceMatch,
        bvnExists,
        faceMatch,
        matchScore,
        returnedName: {
          firstName: raw.entity?.first_name,
          lastName: raw.entity?.last_name,
          middleName: raw.entity?.middle_name,
        },
        providerReference: raw.reference_id || null,
        rawResponse: raw,
      };
    }
  } catch (err: any) {
    result = {
      success: false,
      bvnExists: false,
      faceMatch: false,
      matchScore: null,
      returnedName: {},
      providerReference: null,
      rawResponse: {},
      errorCode: "PROVIDER_UNAVAILABLE",
      error: err?.message || `${providerKey} director verification failed.`,
    };
  }

  // Handle health updates on provider
  if (result.success) {
    await updateProviderHealth(providerKey, "ACTIVE");
  } else if (result.errorCode === "PROVIDER_INSUFFICIENT_BALANCE") {
    await updateProviderHealth(providerKey, "INSUFFICIENT_BALANCE");
  }

  // 5. Perform Name Match Check for director.
  // Sandbox providers may return synthetic identities, so do not escalate
  // successful sandbox tests to manual review on name mismatch.
  let nameMatch = true;
  if (!sandbox && result.success && result.returnedName) {
    nameMatch = directorNameMatchesProfile(params.directorName, result.returnedName);
  }

  // Flag manual review if names mismatch or confidence is low (<70).
  // In sandbox, Youverify fixture photos can return a low confidence score even
  // when the sandbox BVN was found and the provider adapter accepted the test
  // response. Keep sandbox tests flowing unless the bypass is explicitly off.
  const bypassSandboxSelfieReview =
    sandbox && process.env.YOUVERIFY_SANDBOX_BYPASS_SELFIE_MATCH !== "false";
  const lowConfidence = result.matchScore !== null && result.matchScore < 70;
  const manualReview = result.success && (!nameMatch || (!bypassSandboxSelfieReview && lowConfidence));
  const finalStatus: "verified" | "failed" | "manual_review" =
    manualReview ? "manual_review" : (result.success ? "verified" : "failed");

  // 6. Write to business_director_verifications
  try {
    const { data: dbData, error: dbErr } = await adminClient
      .from("business_director_verifications")
      .insert({
        merchant_id: params.merchantId,
        business_verification_id: params.businessVerificationId || null,
        director_name: params.directorName,
        director_role: params.directorRole,
        masked_bvn: maskBVN(params.bvn),
        provider_name: providerKey,
        verification_status: finalStatus,
        selfie_url: selfieSignedUrl || null,
        face_match_score: result.matchScore,
        // liveness_score: use the actual matchScore as a continuous score (0–100)
        // rather than a binary 0/100. This ensures YouVerify scores are preserved
        // identically to Dojah scores in the admin panel.
        liveness_score: result.matchScore ?? (result.faceMatch ? 100 : 0),
        verification_id: result.providerReference,
        normalized_response: sanitizeResponse(result.rawResponse || {}),
        verification_cost: cost,
        manual_review_required: manualReview,
        admin_notes: manualReview ? "Automatically flagged for review due to name mismatch or low confidence score." : null,
      })
      .select("id")
      .single();

    if (dbErr) {
      console.error("[DirectorService] Database write error:", dbErr.message);
    }

    return {
      success: result.success && !manualReview,
      verificationId: dbData?.id || undefined,
      faceMatchScore: result.matchScore,
      status: finalStatus,
      error: result.error,
    };
  } catch (err: any) {
    console.error("[DirectorService] Save director record exception:", err?.message);
    return {
      success: false,
      faceMatchScore: null,
      status: "failed",
      error: err?.message,
    };
  }
}

/**
 * Aggregates verification statuses of all directors linked to a CAC Business Verification.
 */
export async function getDirectorVerificationStatus(
  businessVerificationId: string
): Promise<"all_passed" | "partially_verified" | "manual_review_required" | "none"> {
  try {
    const adminClient = getServiceClient();
    const { data: directors, error } = await adminClient
      .from("business_director_verifications")
      .select("verification_status, manual_review_required")
      .eq("business_verification_id", businessVerificationId);

    if (error || !directors || directors.length === 0) return "none";

    const allVerified = directors.every((d) => d.verification_status === "verified");
    const anyManualReview = directors.some((d) => d.manual_review_required || d.verification_status === "manual_review");
    const anyFailed = directors.some((d) => d.verification_status === "failed");

    if (allVerified) return "all_passed";
    if (anyManualReview) return "manual_review_required";
    if (anyFailed) return "partially_verified";

    return "partially_verified";
  } catch {
    return "none";
  }
}

/**
 * Manually changes a director's review status (called by admin actions).
 */
export async function updateDirectorManualStatus(params: {
  directorVerificationId: string;
  status: "verified" | "failed";
  adminNotes: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const adminClient = getServiceClient();
    const { error } = await adminClient
      .from("business_director_verifications")
      .update({
        verification_status: params.status,
        manual_review_required: false,
        admin_notes: params.adminNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.directorVerificationId);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message };
  }
}

function sanitizeResponse(raw: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...raw };
  const sensitiveKeys = ["bvn", "selfie_image", "image", "selfieBase64", "base64"];
  for (const key of sensitiveKeys) {
    if (key in sanitized) {
      sanitized[key] = "[REDACTED]";
    }
  }
  return sanitized;
}
