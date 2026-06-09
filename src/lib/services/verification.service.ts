/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DeraLedger — Resilient Verification Gateway Service
 *
 * The ONLY authorized caller of verification providers.
 * Onboarding flows and server actions MUST route through this service.
 *
 * Responsibilities:
 *  1. Resilient Failover: Switch to active backup provider if primary fails or runs out of balance.
 *  2. Database-backed Rate Limiting: Restrict attempts to max 5/hour and 20/day per merchant.
 *  3. Duplicate Prevention: Caches and returns successful verifications within 24h, and failed within 5m.
 *  4. Configurable Costs: Fetch costs dynamically from the database, falling back to static configurations.
 *  5. Enriched Logging: Save detailed audit logs to verification_logs.
 *  6. Retry Support: Dynamically trigger failed verification retries.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";
import {
  getActiveProvider,
  getFallbackProvider,
  getActiveProviderKey,
  isVerificationSandboxMode,
  updateProviderHealth,
  instantiateProvider,
} from "@/lib/kyc/index";
import type {
  VerificationResult,
  BusinessVerificationResult,
  NormalizedVerificationStatus,
  ProviderAdapter,
} from "@/lib/kyc/types";
import { PROVIDER_COSTS } from "@/lib/kyc/types";
import { enqueueRetry } from "./retry.service";
import { sendProviderDownAlert } from "@/lib/brevo";
import { persistBusinessRegistrySnapshot } from "@/lib/services/onboarding-flow.service";

// ── Supabase service client (server-only) ─────────────────────────────────────

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Rate Limiting Helper ──────────────────────────────────────────────────────

async function checkRateLimit(
  adminClient: any,
  merchantId: string
): Promise<{ blocked: boolean; error?: string }> {
  try {
    const now = new Date();
    const hourlyStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).toISOString();
    const dailyStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const { data: limits, error } = await adminClient
      .from("verification_rate_limits")
      .select("*")
      .eq("merchant_id", merchantId)
      .in("window_start", [hourlyStart, dailyStart]);

    if (error) {
      console.error("[VerificationService] Rate limit select error:", error.message);
    }

    if (limits) {
      const hourly = limits.find((l: any) => l.window_type === "hourly" && l.window_start === hourlyStart);
      const daily = limits.find((l: any) => l.window_type === "daily" && l.window_start === dailyStart);

      if (hourly && hourly.attempt_count >= 5) {
        return {
          blocked: true,
          error: "Rate limit exceeded: Maximum of 5 KYC attempts per hour. Please try again later.",
        };
      }

      if (daily && daily.attempt_count >= 20) {
        return {
          blocked: true,
          error: "Rate limit exceeded: Maximum of 20 KYC attempts per day. Please try again later.",
        };
      }
    }

    return { blocked: false };
  } catch (err: any) {
    console.error("[VerificationService] Rate limit check exception:", err.message);
    return { blocked: false }; // fail-open
  }
}

async function incrementRateLimit(
  adminClient: any,
  merchantId: string
): Promise<void> {
  try {
    const now = new Date();
    const hourlyStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).toISOString();
    const dailyStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const { data: currentLimits } = await adminClient
      .from("verification_rate_limits")
      .select("*")
      .eq("merchant_id", merchantId)
      .in("window_start", [hourlyStart, dailyStart]);

    const hourly = currentLimits?.find((l: any) => l.window_type === "hourly" && l.window_start === hourlyStart);
    const daily = currentLimits?.find((l: any) => l.window_type === "daily" && l.window_start === dailyStart);

    await Promise.all([
      adminClient.from("verification_rate_limits").upsert({
        merchant_id: merchantId,
        window_type: "hourly",
        window_start: hourlyStart,
        attempt_count: (hourly?.attempt_count || 0) + 1,
        created_at: new Date().toISOString(),
      }, { onConflict: "merchant_id,window_type,window_start" }),
      adminClient.from("verification_rate_limits").upsert({
        merchant_id: merchantId,
        window_type: "daily",
        window_start: dailyStart,
        attempt_count: (daily?.attempt_count || 0) + 1,
        created_at: new Date().toISOString(),
      }, { onConflict: "merchant_id,window_type,window_start" }),
    ]);
  } catch (err: any) {
    console.error("[VerificationService] Rate limit increment error:", err?.message);
  }
}

// ── Duplicate Prevention Helpers ──────────────────────────────────────────────

function generateFingerprint(bvnOrCAC: string, merchantId: string, type: string, context = ""): string {
  const normalized = (bvnOrCAC || "").trim().toLowerCase();
  const normalizedContext = context.trim().toLowerCase();
  const data = `${normalized}_${merchantId}_${type}_${normalizedContext}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function getCachedVerification(
  adminClient: any,
  fingerprint: string,
  type: "bvn_selfie" | "business" | "director",
  sandbox: boolean
): Promise<any | null> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // 1. Check for successfully verified within 24 hours
    const { data: verifiedLog } = await adminClient
      .from("verification_logs")
      .select("*")
      .eq("request_fingerprint", fingerprint)
      .eq("verification_type", type)
      .eq("is_sandbox", sandbox)
      .eq("normalized_status", "verified")
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (verifiedLog) {
      console.log(`[VerificationService] Found 24h cached verified log for fingerprint: ${fingerprint}`);
      return verifiedLog;
    }

    // 2. Check for failure within 5 minutes
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: failedLog } = await adminClient
      .from("verification_logs")
      .select("*")
      .eq("request_fingerprint", fingerprint)
      .eq("verification_type", type)
      .eq("is_sandbox", sandbox)
      .eq("normalized_status", "failed")
      .gte("created_at", fiveMinsAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (failedLog) {
      console.log(`[VerificationService] Found 5m cached failed log for fingerprint: ${fingerprint}`);
      return failedLog;
    }

    return null;
  } catch (err: any) {
    console.error("[VerificationService] Caching check error:", err?.message);
    return null;
  }
}

// ── Provider Cost Dynamic Resolver ───────────────────────────────────────────

async function fetchProviderCost(
  adminClient: any,
  providerName: string,
  type: "bvn_selfie" | "business" | "director"
): Promise<number> {
  try {
    const { data, error } = await adminClient
      .from("verification_providers")
      .select("bvn_selfie_cost, business_cost, director_cost")
      .eq("provider_name", providerName.toUpperCase())
      .maybeSingle();

    if (error) {
      console.warn("[VerificationService] Failed to load provider cost from DB. Using defaults.", error.message);
    }

    if (data) {
      if (type === "bvn_selfie" && data.bvn_selfie_cost !== null) return Number(data.bvn_selfie_cost);
      if (type === "business" && data.business_cost !== null) return Number(data.business_cost);
      if (type === "director" && data.director_cost !== null) return Number(data.director_cost);
    }
  } catch (err: any) {
    console.error("[VerificationService] Cost query failed, falling back to static config:", err?.message);
  }

  // Fallback to static PROVIDER_COSTS config
  const costs = PROVIDER_COSTS[providerName.toUpperCase()] || PROVIDER_COSTS.DEFAULT;
  return costs[type] ?? 150;
}

// ── Masking Utilities ─────────────────────────────────────────────────────────

function maskBVN(bvn: string): string {
  if (!bvn || bvn.length < 11) return "***********";
  return `${bvn.slice(0, 3)}******${bvn.slice(9)}`;
}

function isProviderRoutingFailure(errorCode?: string): boolean {
  return [
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_INSUFFICIENT_BALANCE",
    "PROVIDER_NOT_CONFIGURED",
    "PROVIDER_PERMISSION_DENIED",
  ].includes(errorCode || "");
}

function providerHealthStatusFor(errorCode?: string): "UNAVAILABLE" | "INSUFFICIENT_BALANCE" | "PERMISSION_ISSUE" {
  if (errorCode === "PROVIDER_INSUFFICIENT_BALANCE") return "INSUFFICIENT_BALANCE";
  if (errorCode === "PROVIDER_PERMISSION_DENIED" || errorCode === "PROVIDER_NOT_CONFIGURED") return "PERMISSION_ISSUE";
  return "UNAVAILABLE";
}

// ── Main Service Functions ────────────────────────────────────────────────────

/**
 * Verify a merchant's identity (BVN + selfie).
 */
export async function verifyMerchantIdentity(params: {
  merchantId: string;
  bvn: string;
  selfieBase64: string;
  selfieStoragePath: string;
  ownerName?: string;
}): Promise<VerificationResult & { selfieSignedUrl?: string }> {
  const adminClient = getServiceClient();
  const sandbox = await isVerificationSandboxMode();

  // 1. Rate Limiting Check
  if (!sandbox) {
    const rateLimit = await checkRateLimit(adminClient, params.merchantId);
    if (rateLimit.blocked) {
      return {
        success: false,
        bvnExists: false,
        faceMatch: false,
        matchScore: null,
        returnedName: {},
        providerReference: null,
        rawResponse: {},
        errorCode: "RATE_LIMITED",
        error: rateLimit.error,
      };
    }
    await incrementRateLimit(adminClient, params.merchantId);
  }

  // 2. Duplicate Check (Fingerprint Cache check)
  const fingerprint = generateFingerprint(params.bvn, params.merchantId, "bvn_selfie");
  const cached = await getCachedVerification(adminClient, fingerprint, "bvn_selfie", sandbox);

  if (cached) {
    // If cached success, return the stored provider result.
    if (cached.normalized_status === "verified") {
      const matchScore = Number(cached.match_score) || 95;
      return {
        success: true,
        bvnExists: true,
        faceMatch: true,
        matchScore,
        returnedName: {
          firstName: cached.raw_response?.entity?.first_name || cached.raw_response?.returnedName?.firstName || "Cached",
          lastName: cached.raw_response?.entity?.last_name || cached.raw_response?.returnedName?.lastName || "Record",
        },
        providerReference: cached.provider_reference || "CACHED_REFERENCE",
        rawResponse: cached.raw_response || {},
        selfieSignedUrl: cached.raw_response?.selfieSignedUrl || undefined,
      };
    } else {
      // Return cached failure
      return {
        success: false,
        bvnExists: false,
        faceMatch: false,
        matchScore: null,
        returnedName: {},
        providerReference: null,
        rawResponse: cached.raw_response || {},
        errorCode: cached.error_code || "UNKNOWN_ERROR",
        error: cached.error_message || "Cached failure returned.",
      };
    }
  }

  // 3. Upload selfie base64 to Supabase storage
  try {
    const buffer = Buffer.from(params.selfieBase64, "base64");
    await adminClient.storage.from("kyc-documents").upload(params.selfieStoragePath, buffer, {
      contentType: "image/jpeg",
      upsert: true,
    });
  } catch (err: any) {
    console.error("[VerificationService] Selfie upload failed:", err?.message);
  }

  // 4. Generate signed URL
  let selfieSignedUrl: string | undefined;
  try {
    const { data: urlData } = await adminClient.storage
      .from("kyc-documents")
      .createSignedUrl(params.selfieStoragePath, 86400);
    selfieSignedUrl = urlData?.signedUrl;
  } catch (err: any) {
    console.error("[VerificationService] Selfie signed URL gen failed:", err?.message);
  }

  // 5. Try Primary Provider. Sandbox mode uses the provider sandbox API.
  let providerKey = await getActiveProviderKey();
  const primaryProviderKey = providerKey;
  const provider = await getActiveProvider();
  let result: VerificationResult;
  let providerCallSucceeded = false;

  const cost = sandbox ? 0 : await fetchProviderCost(adminClient, providerKey, "bvn_selfie");

  try {
    result = await executeProviderBVNWithFace(provider, params.bvn, selfieSignedUrl || "", params.selfieBase64, params.merchantId);
    providerCallSucceeded = !isProviderRoutingFailure(result.errorCode);
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
      error: err?.message || "Primary provider request failed.",
    };
  }

  // 7. Failover Routing if Primary fails
  if (!providerCallSucceeded) {
    console.warn(`[VerificationService] Primary provider ${providerKey} failed. Trying fallback...`);

    // Mark primary provider degraded or down in health registry
    await updateProviderHealth(providerKey, providerHealthStatusFor(result.errorCode));

    const fallback = await getFallbackProvider(providerKey);

    if (fallback) {
      const fallbackKey = fallback.providerName;
      // Write temporary audit record for primary failure as "retrying" / "provider_down"
      await writeAuditLog(adminClient, {
        merchantId: params.merchantId,
        provider: providerKey,
        type: "bvn_selfie",
        fingerprint,
        maskedBvn: maskBVN(params.bvn),
        status: "provider_down",
        cost: 0,
        sandbox,
        result,
      });

      // Enqueue retry item for the primary provider to retry later
      await enqueueRetry(params.merchantId, providerKey, result.error || "Primary failure", 0);

      // Attempt verification with the fallback
      try {
        const fallbackResult = await executeProviderBVNWithFace(fallback, params.bvn, selfieSignedUrl || "", params.selfieBase64, params.merchantId);

        if (!isProviderRoutingFailure(fallbackResult.errorCode)) {
          providerKey = fallbackKey;
          result = fallbackResult;
          providerCallSucceeded = true;
        }
      } catch (fallbackErr: any) {
        console.error(`[VerificationService] Fallback provider ${fallbackKey} also failed:`, fallbackErr?.message);
      }
    }
  }

  // 8. Process Provider Health Updates on final result
  if (providerCallSucceeded) {
    await updateProviderHealth(providerKey, "ACTIVE");
  } else {
    // Both failed
    await updateProviderHealth(providerKey, "UNAVAILABLE");
    await sendProviderDownAlert(providerKey, 10);
  }

  // 9. Name Matching Check
  // Sandbox providers often return fixed or synthetic identities, so we
  // should not block successful test verifications on profile-name mismatch.
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

  // 10. Write audit record to verification_logs
  const bvnFirstName = String(result.returnedName?.firstName || "").trim();
  const bvnLastName = String(result.returnedName?.lastName || "").trim();
  const returnedBvnName = [bvnFirstName, bvnLastName].filter(Boolean).join(" ") || null;
  const nameMatchStatus = result.errorCode === "NAME_MISMATCH" ? "FAILED" : (result.success ? "PASSED" : null);

  await writeAuditLog(adminClient, {
    merchantId: params.merchantId,
    provider: providerKey,
    type: "bvn_selfie",
    fingerprint,
    maskedBvn: maskBVN(params.bvn),
    status: result.success ? "verified" : "failed",
    cost: sandbox ? 0 : providerKey === primaryProviderKey ? cost : await fetchProviderCost(adminClient, providerKey, "bvn_selfie"),
    sandbox,
    result,
    returnedBvnName,
    nameMatchStatus,
  });

  return { ...result, selfieSignedUrl };
}

/**
 * Verify a Nigerian business registration number (CAC).
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
  const sandbox = await isVerificationSandboxMode();

  // 1. Rate Limiting Check
  if (!sandbox) {
    const rateLimit = await checkRateLimit(adminClient, params.merchantId);
    if (rateLimit.blocked) {
      return {
        success: false,
        companyName: null,
        registrationStatus: null,
        personnel: [],
        providerReference: null,
        rawResponse: {},
        errorCode: "RATE_LIMITED",
        error: rateLimit.error,
        companyNameMatches: false,
        representativeFound: false,
      };
    }
    await incrementRateLimit(adminClient, params.merchantId);
  }

  // 2. Duplicate Check
  const fingerprint = generateFingerprint(
    params.registrationNumber,
    params.merchantId,
    "business",
    params.businessName
  );
  const cached = await getCachedVerification(adminClient, fingerprint, "business", sandbox);

  if (cached) {
    if (cached.normalized_status === "verified") {
      const companyName = cached.raw_response?.companyName || cached.raw_response?.company_name || params.businessName;
      return {
        success: true,
        companyName,
        registrationStatus: "ACTIVE",
        personnel: cached.raw_response?.personnel || [{ name: params.ownerName, role: "director" }],
        providerReference: cached.provider_reference || "CACHED_CAC",
        rawResponse: cached.raw_response || {},
        companyNameMatches: true,
        representativeFound: true,
      };
    } else {
      return {
        success: false,
        companyName: null,
        registrationStatus: null,
        personnel: [],
        providerReference: null,
        rawResponse: cached.raw_response || {},
        errorCode: cached.error_code || "UNKNOWN_ERROR",
        error: cached.error_message || "Cached CAC failure returned.",
        companyNameMatches: false,
        representativeFound: false,
      };
    }
  }

  // 3. Call Primary Provider. Sandbox mode uses the provider sandbox API.
  let providerKey = await getActiveProviderKey();
  const provider = await getActiveProvider();
  let result: BusinessVerificationResult;
  let providerCallSucceeded = false;

  try {
    result = await provider.verifyBusiness({
      registrationNumber: params.registrationNumber,
      businessName: params.businessName,
      ownerName: params.ownerName,
    });
    providerCallSucceeded = !isProviderRoutingFailure(result.errorCode);
  } catch (err: any) {
    result = {
      success: false,
      companyName: null,
      registrationStatus: null,
      personnel: [],
      providerReference: null,
      rawResponse: {},
      errorCode: "PROVIDER_UNAVAILABLE",
      error: err.message || "Primary business query failed.",
    };
  }

  // 5. Failover Routing if Primary fails
  if (!providerCallSucceeded) {
    console.warn(`[VerificationService] Primary CAC provider ${providerKey} failed. Trying fallback...`);
    await updateProviderHealth(providerKey, providerHealthStatusFor(result.errorCode));

    const fallback = await getFallbackProvider(providerKey);

    if (fallback) {
      const fallbackKey = fallback.providerName;
      await writeAuditLog(adminClient, {
        merchantId: params.merchantId,
        provider: providerKey,
        type: "business",
        fingerprint,
        maskedBvn: null,
        status: "provider_down",
        cost: 0,
        sandbox,
        result: result as any,
      });

      await enqueueRetry(params.merchantId, providerKey, result.error || "Primary business failure", 0);

      try {
        const fallbackResult = await fallback.verifyBusiness({
          registrationNumber: params.registrationNumber,
          businessName: params.businessName,
          ownerName: params.ownerName,
        });

        if (!isProviderRoutingFailure(fallbackResult.errorCode)) {
          providerKey = fallbackKey;
          result = fallbackResult;
          providerCallSucceeded = true;
        }
      } catch (fallbackErr: any) {
        console.error(`[VerificationService] Fallback business provider ${fallbackKey} failed:`, fallbackErr?.message);
      }
    }
  }

  // 6. Update Provider Health
  if (providerCallSucceeded) {
    await updateProviderHealth(providerKey, result.success ? "ACTIVE" : "ACTIVE");
  } else {
    await updateProviderHealth(providerKey, "UNAVAILABLE");
    await sendProviderDownAlert(providerKey, 10);
  }

  // 7. Company Name Matching
  let companyNameMatches = false;
  if (result.success && result.companyName) {
    companyNameMatches = fuzzyNameContains(result.companyName, params.businessName);
    if (!companyNameMatches) {
      result = {
        ...result,
        success: false,
        errorCode: "UNKNOWN_ERROR",
        error: `RC Number belongs to '${result.companyName}', which does not match your registered Business Name '${params.businessName}'.`,
      };
    }
  }

  // 8. Roster Matching
  let representativeFound = false;
  if (result.success && companyNameMatches) {
    representativeFound = findRepresentativeInRoster(params.ownerName, result.personnel);
    if (!representativeFound && result.personnel.length > 0) {
      console.warn(
        `[VerificationService] Representative '${params.ownerName}' not found in roster for ${params.registrationNumber}.`
      );
    }
  }

  // 9. Write audit record
  const verificationLogId = await writeAuditLog(adminClient, {
    merchantId: params.merchantId,
    provider: providerKey,
    type: "business",
    fingerprint,
    maskedBvn: null,
    status: result.success ? "verified" : "failed",
    cost: sandbox ? 0 : await fetchProviderCost(adminClient, providerKey, "business"),
    sandbox,
    result: result as any,
  });

  const hasBusinessRegistryPayload =
    Boolean(result.companyName) ||
    Boolean(result.personnel && result.personnel.length > 0) ||
    Object.keys(result.rawResponse || {}).length > 0;

  if (hasBusinessRegistryPayload) {
    const { data: merchantSnapshotContext } = await adminClient
      .from("merchants")
      .select("business_type, relationship_claim")
      .eq("id", params.merchantId)
      .maybeSingle();

    await persistBusinessRegistrySnapshot(adminClient, {
      merchantId: params.merchantId,
      providerName: providerKey,
      businessType: merchantSnapshotContext?.business_type || null,
      registeredName: result.companyName || params.businessName,
      registrationNumber: params.registrationNumber,
      registrationStatus: result.registrationStatus || (result.success ? "ACTIVE" : "unknown"),
      personnel: result.personnel || [],
      rawResponse: sanitizeRawResponse(result.rawResponse || {}),
      normalizedResponse: {
        companyName: result.companyName,
        registrationStatus: result.registrationStatus,
        personnel: result.personnel || [],
        success: result.success,
        errorCode: result.errorCode || null,
      },
      verificationReference: result.providerReference || null,
      verificationLogId,
      ownerName: params.ownerName,
      relationshipClaim: merchantSnapshotContext?.relationship_claim || "owner_affiliated_claim",
    });
  }

  return { ...result, companyNameMatches, representativeFound };
}

/**
 * Retries a failed verification log record.
 * Triggered by the retry service queue cron job.
 */
export async function retryVerificationFromLog(
  logId: string,
  providerName: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[VerificationService] Executing queue retry for log: ${logId} via ${providerName}`);
  const adminClient = getServiceClient();

  try {
    // 1. Load log details
    const { data: logRow, error: logErr } = await adminClient
      .from("verification_logs")
      .select("*")
      .eq("id", logId)
      .single();

    if (logErr || !logRow) {
      return { success: false, error: `Failed to find log row: ${logErr?.message}` };
    }

    const merchantId = logRow.merchant_id;
    if (!merchantId) {
      return { success: false, error: "Merchant ID missing from retry log." };
    }

    // 2. Fetch original verification credentials from merchant record
    const { data: merchant, error: mErr } = await adminClient
      .from("merchants")
      .select("bvn, selfie_url, business_name, owner_name, email, cac_number")
      .eq("id", merchantId)
      .single();

    if (mErr || !merchant) {
      return { success: false, error: `Failed to fetch merchant details: ${mErr?.message}` };
    }

    const provider = instantiateProvider(providerName);

    // 3. Re-execute based on type
    if (logRow.verification_type === "bvn_selfie" || logRow.verification_type === "identity") {
      if (!merchant.bvn) return { success: false, error: "No BVN found on merchant profile." };
      
      const signedUrl = merchant.selfie_url; // Already uploaded
      
      const result = await executeProviderBVNWithFace(
        provider,
        merchant.bvn,
        signedUrl || "",
        "", // no base64 fallback in background retries
        merchantId
      );

      if (result.success) {
        await adminClient
          .from("verification_logs")
          .update({
            normalized_status: "verified",
            response_status: "SUCCESS",
            provider_reference: result.providerReference,
            match_score: result.matchScore,
            raw_response: sanitizeRawResponse(result.rawResponse),
            response_timestamp: new Date().toISOString(),
          })
          .eq("id", logId);
        return { success: true };
      } else {
        return { success: false, error: result.error || "Retry verification failed." };
      }
    } else if (logRow.verification_type === "business") {
      // CAC lookup retry — use the actual cac_number stored on the merchant record.
      // Previously this used business_name as the registration number (which is wrong
      // and always causes a 404 from the provider).
      const registrationNumber = merchant.cac_number;
      if (!registrationNumber) {
        return { success: false, error: "No CAC/RC number found on merchant profile — cannot retry business verification." };
      }

      const result = await provider.verifyBusiness({
        registrationNumber,
        businessName: merchant.business_name,
        ownerName: merchant.owner_name || merchant.email,
      });

      if (result.success) {
        await adminClient
          .from("verification_logs")
          .update({
            normalized_status: "verified",
            response_status: "SUCCESS",
            provider_reference: result.providerReference,
            raw_response: sanitizeRawResponse(result.rawResponse),
            response_timestamp: new Date().toISOString(),
          })
          .eq("id", logId);
        return { success: true };
      } else {
        return { success: false, error: result.error || "Retry business CAC failed." };
      }
    }

    return { success: false, error: `Unsupported retry verification type: ${logRow.verification_type}` };
  } catch (err: any) {
    console.error("[VerificationService] retryVerificationFromLog exception:", err?.message);
    return { success: false, error: err?.message };
  }
}

// ── Private Provider Invocation Wrapper ──────────────────────────────────────

async function executeProviderBVNWithFace(
  provider: ProviderAdapter,
  bvn: string,
  selfieImageUrl: string,
  selfieBase64: string,
  merchantId: string
): Promise<VerificationResult> {
  const p = provider as any;
  if (typeof p.verifyBVNWithFace === "function") {
    return await p.verifyBVNWithFace({
      bvn,
      selfieImageUrl,
      selfieBase64,
      customerReference: merchantId,
    });
  } else if (typeof p.verifyBVNWithSelfie === "function") {
    const raw = await p.verifyBVNWithSelfie({
      bvn,
      selfieBase64,
      customerReference: merchantId,
    });
    
    // Normalize raw Dojah response
    const { extractDojahMatchScore } = await import("@/lib/kyc/dojah.provider");
    const matchScore = extractDojahMatchScore(raw) ?? null;
    const bvnExists = Boolean(raw.entity?.bvn || raw.status);
    const faceMatch = matchScore !== null && matchScore >= 70;
    return {
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
      rawResponse: raw as any,
    };
  }

  throw new Error(`Provider ${provider.providerName} lacks face verification capability.`);
}

// ── Audit Log Utility ────────────────────────────────────────────────────────

export async function writeAuditLog(
  adminClient: any,
  params: {
    merchantId: string;
    provider: string;
    type: "bvn_selfie" | "business" | "director";
    fingerprint: string;
    maskedBvn: string | null;
    status: NormalizedVerificationStatus;
    cost: number;
    sandbox: boolean;
    result: any;
    invitationId?: string | null;
    businessAffiliationId?: string | null;
    invitedDirectorName?: string | null;
    returnedBvnName?: string | null;
    nameMatchStatus?: string | null;
  }
): Promise<string | null> {
  try {
    const attemptNum = await getNextAttemptNumber(adminClient, params.merchantId, params.type);

    const subjectMap: Record<string, string> = {
      bvn_selfie: "representative",
      business: "business",
      director: "director",
    };

    const typeMap: Record<string, string> = {
      bvn_selfie: "representative_bvn_selfie",
      business: "business_registry",
      director: "director_bvn_selfie",
    };

    const insertPayload: any = {
      merchant_id: params.merchantId,
      provider_name: params.provider.toUpperCase(),
      verification_type: typeMap[params.type] || params.type,
      verification_subject: subjectMap[params.type] || params.type,
      request_fingerprint: params.fingerprint,
      masked_bvn: params.maskedBvn,
      normalized_status: params.status,
      response_status: params.result.success ? "SUCCESS" : (params.result.errorCode || "FAILED"),
      verification_cost: params.cost,
      is_sandbox: params.sandbox,
      error_code: params.result.errorCode || null,
      error_message: params.result.error || null,
      match_score: params.result.matchScore || null,
      provider_reference: params.result.providerReference || null,
      raw_response: sanitizeRawResponse(params.result.rawResponse || {}),
      attempt_number: attemptNum,
      request_timestamp: new Date().toISOString(),
      response_timestamp: new Date().toISOString(),
    };

    if (params.invitationId) insertPayload.invitation_id = params.invitationId;
    if (params.businessAffiliationId) insertPayload.business_affiliation_id = params.businessAffiliationId;
    if (params.invitedDirectorName) insertPayload.invited_director_name = params.invitedDirectorName;
    if (params.returnedBvnName) insertPayload.returned_bvn_name = params.returnedBvnName;
    if (params.nameMatchStatus) insertPayload.name_match_status = params.nameMatchStatus;

    const { data, error } = await adminClient.from("verification_logs").insert(insertPayload).select("id").single();
    if (error) {
      throw new Error(error.message);
    }

    if (data?.id) {
      await adminClient.from("verification_costs").insert({
        verification_log_id: data.id,
        merchant_id: params.merchantId,
        provider_name: params.provider.toUpperCase(),
        verification_type: params.type,
        status: params.status,
        cost_amount: params.cost,
        is_sandbox: params.sandbox,
      });
    }

    return data?.id || null;
  } catch (err: any) {
    console.error("[VerificationService] Audit write failed:", err?.message);
    throw err;
  }
}

async function getNextAttemptNumber(
  client: any,
  merchantId: string,
  type: string
): Promise<number> {
  try {
    const { count } = await client
      .from("verification_logs")
      .select("id", { count: "exact", head: true })
      .eq("merchant_id", merchantId)
      .eq("verification_type", type);
    return (count || 0) + 1;
  } catch {
    return 1;
  }
}

// ── Name Matching Utilities ───────────────────────────────────────────────────

function performNameMatch(
  ownerName: string,
  returnedName: { firstName?: string; lastName?: string; middleName?: string }
): { matches: boolean; bvnFullName: string } {
  const normalizeName = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z\s]/g, "")
      .trim();

  const tokenizeName = (value: string) =>
    normalizeName(value)
      .split(/\s+/)
      .filter(Boolean);

  const tokensMatch = (left: string, right: string): boolean => {
    if (!left || !right) return false;
    if (left === right) return true;

    const minFuzzyLength = 4;
    if (left.length < minFuzzyLength || right.length < minFuzzyLength) {
      return false;
    }

    return left.includes(right) || right.includes(left);
  };

  const bvnFullName = [returnedName.firstName, returnedName.middleName, returnedName.lastName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .trim();

  if (!bvnFullName) return { matches: true, bvnFullName: "—" };

  const ownerTokens = tokenizeName(ownerName);
  const bvnTokens = tokenizeName(bvnFullName);
  const bvnSurname = normalizeName(returnedName.lastName || "");

  if (!bvnSurname) {
    const matches = ownerTokens.some((ownerToken) =>
      bvnTokens.some((bvnToken) => tokensMatch(ownerToken, bvnToken))
    );
    return { matches, bvnFullName };
  }

  const surnameMatches = ownerTokens.some((ownerToken) => tokensMatch(ownerToken, bvnSurname));
  if (!surnameMatches) {
    return { matches: false, bvnFullName };
  }

  const nonSurnameBvnTokens = bvnTokens.filter((token) => token !== bvnSurname);
  const matches = nonSurnameBvnTokens.some((bvnToken) =>
    ownerTokens.some((ownerToken) => tokensMatch(ownerToken, bvnToken))
  );
  return { matches, bvnFullName };
}

function fuzzyNameContains(registryName: string, profileName: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const reg = normalize(registryName);
  const pro = normalize(profileName);
  return reg.includes(pro) || pro.includes(reg);
}

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

function sanitizeRawResponse(raw: any): any {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object") return raw;

  if (Array.isArray(raw)) {
    return raw.map(item => sanitizeRawResponse(item));
  }

  const sanitized: Record<string, any> = {};
  const sensitiveKeys = [
    "bvn", "selfie_image", "image", "selfieBase64", "base64", 
    "selfie_base64", "selfie", "photo", "face_image", "faceImage", 
    "biometric", "livenessImage", "liveness_image", "document", "document_image"
  ];

  for (const key of Object.keys(raw)) {
    const val = raw[key];
    const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()));
    const isBase64String = typeof val === "string" && (
      val.startsWith("data:image/") || 
      (val.length > 500 && !val.includes(" "))
    );

    if (isSensitive || isBase64String) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof val === "object") {
      sanitized[key] = sanitizeRawResponse(val);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}
