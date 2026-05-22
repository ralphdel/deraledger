/**
 * DeraLedger — Verification Service
 *
 * The ONLY authorized caller of verification providers.
 * Onboarding flows and server actions MUST route through this service.
 *
 * Responsibilities:
 *  1. Detect active provider (Dojah or Youverify) from DB config
 *  2. Route BVN+face and business verification requests to the correct provider
 *  3. Normalize all provider responses to shared types
 *  4. Handle sandbox mode (bypass strict checks)
 *  5. Perform server-side name matching
 *  6. Update provider health on error codes
 *  7. Write audit records to verification_records table
 *  8. Handle storage-first selfie upload for URL-based providers (Youverify)
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  getActiveVerificationProvider,
  getActiveProviderKey,
  isVerificationSandboxMode,
  updateProviderHealth,
} from "@/lib/kyc/index";
import type {
  VerificationResult,
  BusinessVerificationResult,
  VerificationProviderKey,
} from "@/lib/kyc/types";

// ── Supabase service client (server-only) ─────────────────────────────────────

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Main service functions ────────────────────────────────────────────────────

/**
 * Verify a merchant's identity (BVN + selfie).
 *
 * Steps:
 * 1. Upload selfie base64 to Supabase storage (required for Youverify URL-based flow)
 * 2. Get signed URL for the stored selfie
 * 3. Route to active provider with correct payload (URL for Youverify, base64 for Dojah)
 * 4. Normalize response
 * 5. Perform server-side name matching
 * 6. Write audit record
 * 7. Update provider health on error
 *
 * Returns a fully normalized VerificationResult.
 */
export async function verifyMerchantIdentity(params: {
  merchantId: string;
  bvn: string;
  selfieBase64: string;
  selfieStoragePath: string; // e.g. "merchant-id/selfie-2026-01-01.jpg"
  ownerName?: string;        // Used for name matching
}): Promise<VerificationResult & { selfieSignedUrl?: string }> {
  const adminClient = getServiceClient();
  const providerKey = await getActiveProviderKey();
  const sandbox = await isVerificationSandboxMode();
  const provider = await getActiveVerificationProvider();

  // 1. Upload selfie to Supabase storage (both providers need this stored)
  const buffer = Buffer.from(params.selfieBase64, "base64");
  await adminClient.storage.from("kyc-documents").upload(params.selfieStoragePath, buffer, {
    contentType: "image/jpeg",
    upsert: true,
  });

  // 2. Generate signed URL (valid 1 hour — sufficient for the API call + admin review)
  let selfieSignedUrl: string | undefined;
  const { data: urlData } = await adminClient.storage
    .from("kyc-documents")
    .createSignedUrl(params.selfieStoragePath, 3600);
  selfieSignedUrl = urlData?.signedUrl;

  // 3. Route to active provider
  let result: VerificationResult;

  try {
    // Duck-type the call: Youverify uses verifyBVNWithFace, Dojah uses verifyBVNWithSelfie.
    // Both providers are accessed via `any` to avoid forcing a shared interface on DojahProvider.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = provider as any;
    const callResult =
      typeof p.verifyBVNWithFace === "function"
        ? await p.verifyBVNWithFace({
            bvn: params.bvn,
            selfieImageUrl: selfieSignedUrl || "",
            selfieBase64: params.selfieBase64,
            customerReference: params.merchantId,
          })
        : await p.verifyBVNWithSelfie({
            bvn: params.bvn,
            selfieBase64: params.selfieBase64,
            customerReference: params.merchantId,
          });

    // Normalize Dojah raw result into VerificationResult shape if needed
    if (typeof callResult.bvnExists === "undefined") {
      // This is a raw DojahBVNSelfieResult — normalize it
      const { extractDojahMatchScore } = await import("@/lib/kyc/dojah.provider");
      const matchScore = extractDojahMatchScore(callResult) ?? null;
      result = {
        success: callResult.status === true || callResult.entity?.bvn === params.bvn,
        bvnExists: Boolean(callResult.entity?.bvn || callResult.status),
        faceMatch: matchScore !== null && matchScore >= 70,
        matchScore,
        returnedName: {
          firstName: callResult.entity?.first_name,
          lastName: callResult.entity?.last_name,
          middleName: callResult.entity?.middle_name,
        },
        providerReference: callResult.reference_id || null,
        rawResponse: callResult,
      };
    } else {
      result = callResult as VerificationResult;
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
      error: err.message || "Provider call failed unexpectedly.",
    };
  }

  // 4. Handle provider health updates on critical errors
  if (result.errorCode === "PROVIDER_INSUFFICIENT_BALANCE") {
    await updateProviderHealth(providerKey, "INSUFFICIENT_BALANCE");
  } else if (result.errorCode === "PROVIDER_PERMISSION_DENIED") {
    await updateProviderHealth(providerKey, "PERMISSION_ISSUE");
  } else if (result.errorCode === "PROVIDER_UNAVAILABLE") {
    await updateProviderHealth(providerKey, "UNAVAILABLE");
  } else if (result.success) {
    await updateProviderHealth(providerKey, "ACTIVE");
  }

  // 5. Sandbox bypass: override strict checks
  if (sandbox) {
    result = {
      ...result,
      success: true,
      bvnExists: true,
      faceMatch: true,
      matchScore: result.matchScore ?? 95,
    };
  }

  // 6. Server-side name matching (production only)
  if (!sandbox && result.success && params.ownerName) {
    const nameMatchResult = performNameMatch(params.ownerName, result.returnedName);
    if (!nameMatchResult.matches) {
      result = {
        ...result,
        success: false,
        errorCode: "NAME_MISMATCH",
        error: `BVN name does not match your registered profile name. BVN name: ${nameMatchResult.bvnFullName}. Please update your profile name or use the correct BVN.`,
      };
    }
  }

  // 7. Write audit record to verification_records
  const attemptNum = await getNextAttemptNumber(adminClient, params.merchantId, "identity");
  await adminClient.from("verification_records").insert({
    merchant_id: params.merchantId,
    verification_type: "identity",
    provider: providerKey,
    is_sandbox: sandbox,
    status: result.success ? "verified" : "failed",
    match_score: result.matchScore,
    provider_reference: result.providerReference,
    error_code: result.errorCode || null,
    error_message: result.error || null,
    raw_response: sanitizeRawResponse(result.rawResponse),
    attempt_number: attemptNum,
  });

  return { ...result, selfieSignedUrl };
}

/**
 * Verify a Nigerian business registration number (CAC).
 *
 * Does NOT repeat identity verification if the merchant is already identity_verified.
 * Only CAC + name matching is performed.
 *
 * Returns a BusinessVerificationResult + derived helper fields for the action.
 */
export async function verifyMerchantBusiness(params: {
  merchantId: string;
  registrationNumber: string;
  businessName: string;
  ownerName: string;
}): Promise<BusinessVerificationResult & {
  companyNameMatches: boolean;
  representativeFound: boolean;
}> {
  const adminClient = getServiceClient();
  const providerKey = await getActiveProviderKey();
  const sandbox = await isVerificationSandboxMode();
  const provider = await getActiveVerificationProvider();

  // Sandbox bypass
  if (sandbox) {
    const attemptNum = await getNextAttemptNumber(adminClient, params.merchantId, "business");
    await adminClient.from("verification_records").insert({
      merchant_id: params.merchantId,
      verification_type: "business",
      provider: providerKey,
      is_sandbox: true,
      status: "verified",
      provider_reference: `sandbox-${Date.now()}`,
      raw_response: { sandbox: true },
      attempt_number: attemptNum,
    });
    return {
      success: true,
      companyName: params.businessName,
      registrationStatus: "ACTIVE",
      personnel: [{ name: params.ownerName, role: "director" }],
      providerReference: `sandbox-${Date.now()}`,
      rawResponse: { sandbox: true },
      companyNameMatches: true,
      representativeFound: true,
    };
  }

  let result: BusinessVerificationResult;
  try {
    // Duck-type the call for provider compatibility
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = provider as any;
    const callResult =
      typeof p.verifyBusiness === "function"
        ? await p.verifyBusiness({
            registrationNumber: params.registrationNumber,
            businessName: params.businessName,
            ownerName: params.ownerName,
          })
        : null;

    if (!callResult) {
      result = {
        success: false,
        companyName: null,
        registrationStatus: null,
        personnel: [],
        providerReference: null,
        rawResponse: {},
        errorCode: "UNKNOWN_ERROR",
        error: "Active provider does not support business verification.",
      };
    } else {
      result = callResult as BusinessVerificationResult;
    }
  } catch (err: any) {
    result = {
      success: false,
      companyName: null,
      registrationStatus: null,
      personnel: [],
      providerReference: null,
      rawResponse: {},
      errorCode: "PROVIDER_UNAVAILABLE",
      error: err.message || "Provider call failed unexpectedly.",
    };
  }

  // Provider health updates
  if (result.errorCode === "PROVIDER_INSUFFICIENT_BALANCE") {
    await updateProviderHealth(providerKey, "INSUFFICIENT_BALANCE");
  } else if (result.errorCode === "PROVIDER_PERMISSION_DENIED") {
    await updateProviderHealth(providerKey, "PERMISSION_ISSUE");
  } else if (result.errorCode === "PROVIDER_UNAVAILABLE") {
    await updateProviderHealth(providerKey, "UNAVAILABLE");
  } else if (result.success) {
    await updateProviderHealth(providerKey, "ACTIVE");
  }

  // Company name matching
  let companyNameMatches = false;
  if (result.success && result.companyName) {
    companyNameMatches = fuzzyNameContains(
      result.companyName,
      params.businessName
    );
    if (!companyNameMatches) {
      result = {
        ...result,
        success: false,
        errorCode: "UNKNOWN_ERROR",
        error: `RC Number belongs to '${result.companyName}', which does not match your registered Business Name '${params.businessName}'.`,
      };
    }
  }

  // Representative roster matching
  let representativeFound = false;
  if (result.success && companyNameMatches) {
    representativeFound = findRepresentativeInRoster(params.ownerName, result.personnel);
    if (!representativeFound && result.personnel.length > 0) {
      // Not a hard failure — admin will review. Log as warning.
      console.warn(
        `[VerificationService] Representative '${params.ownerName}' not found in roster for ${params.registrationNumber}. Proceeding to admin review.`
      );
    }
  }

  // Write audit record
  const attemptNum = await getNextAttemptNumber(adminClient, params.merchantId, "business");
  await adminClient.from("verification_records").insert({
    merchant_id: params.merchantId,
    verification_type: "business",
    provider: providerKey,
    is_sandbox: false,
    status: result.success ? "verified" : "failed",
    provider_reference: result.providerReference,
    error_code: result.errorCode || null,
    error_message: result.error || null,
    raw_response: sanitizeRawResponse(result.rawResponse),
    attempt_number: attemptNum,
  });

  return { ...result, companyNameMatches, representativeFound };
}

// ── Name matching utilities ───────────────────────────────────────────────────

/**
 * Server-side name match: requires at least one token from ownerName
 * to match a token in the BVN-returned name.
 * Lowercase, trimmed, normalized.
 */
function performNameMatch(
  ownerName: string,
  returnedName: { firstName?: string; lastName?: string; middleName?: string }
): { matches: boolean; bvnFullName: string } {
  const bvnFullName = [returnedName.firstName, returnedName.middleName, returnedName.lastName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .trim();

  if (!bvnFullName) return { matches: true, bvnFullName: "—" }; // No name returned → pass (admin reviews)

  const ownerTokens = ownerName
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  const bvnTokens = bvnFullName
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  // At least one owner token must appear in BVN tokens
  const matches = ownerTokens.some((t) => bvnTokens.includes(t));
  return { matches, bvnFullName };
}

/**
 * Fuzzy bidirectional name containment check for CAC company names.
 */
function fuzzyNameContains(registryName: string, profileName: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const reg = normalize(registryName);
  const pro = normalize(profileName);
  return reg.includes(pro) || pro.includes(reg);
}

/**
 * Search personnel roster for a representative matching ownerName.
 * Uses multi-token partial matching.
 */
export function findRepresentativeInRoster(
  ownerName: string,
  personnel: { name: string; role: string }[]
): boolean {
  const ownerParts = ownerName
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  return personnel.some((p) => {
    const personName = p.name.toLowerCase().replace(/[^a-z\s]/g, "");
    const matchCount = ownerParts.filter((part) => personName.includes(part)).length;
    return matchCount >= Math.min(2, ownerParts.length);
  });
}

// ── Audit helpers ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getNextAttemptNumber(
  client: any,
  merchantId: string,
  type: "identity" | "business" | "representative"
): Promise<number> {
  try {
    const { count } = await client
      .from("verification_records")
      .select("id", { count: "exact", head: true })
      .eq("merchant_id", merchantId)
      .eq("verification_type", type);
    return (count || 0) + 1;
  } catch {
    return 1;
  }
}

/**
 * Remove any PII that should not be stored long-term in raw_response.
 * BVN numbers and selfie data are redacted.
 */
function sanitizeRawResponse(raw: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...raw };
  const sensitiveKeys = ["bvn", "selfie_image", "image", "selfieBase64", "base64"];
  for (const key of sensitiveKeys) {
    if (key in sanitized) {
      sanitized[key] = "[REDACTED]";
    }
  }
  return sanitized;
}
