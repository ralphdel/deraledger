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
  VerificationProviderKey,
  NormalizedVerificationStatus,
  ProviderAdapter,
} from "@/lib/kyc/types";
import { PROVIDER_COSTS } from "@/lib/kyc/types";
import { enqueueRetry } from "./retry.service";
import { sendProviderDownAlert } from "@/lib/brevo";

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

function generateFingerprint(bvnOrCAC: string, merchantId: string, type: string): string {
  const normalized = (bvnOrCAC || "").trim().toLowerCase();
  const data = `${normalized}_${merchantId}_${type}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function getCachedVerification(
  adminClient: any,
  fingerprint: string,
  type: "bvn_selfie" | "business" | "director"
): Promise<any | null> {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // 1. Check for successfully verified within 24 hours
    const { data: verifiedLog } = await adminClient
      .from("verification_logs")
      .select("*")
      .eq("request_fingerprint", fingerprint)
      .eq("verification_type", type)
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
  const cached = await getCachedVerification(adminClient, fingerprint, "bvn_selfie");

  if (cached) {
    // If cached success, return mock cached success
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
      .createSignedUrl(params.selfieStoragePath, 3600);
    selfieSignedUrl = urlData?.signedUrl;
  } catch (err: any) {
    console.error("[VerificationService] Selfie signed URL gen failed:", err?.message);
  }

  // 5. Try Primary Provider
  let providerKey = await getActiveProviderKey();
  let provider = await getActiveProvider();
  let result: VerificationResult;
  let providerCallSucceeded = false;

  const cost = sandbox ? 0 : await fetchProviderCost(adminClient, providerKey, "bvn_selfie");

  try {
    result = await executeProviderBVNWithFace(provider, params.bvn, selfieSignedUrl || "", params.selfieBase64, params.merchantId);
    providerCallSucceeded = !result.errorCode || !["PROVIDER_UNAVAILABLE", "PROVIDER_INSUFFICIENT_BALANCE"].includes(result.errorCode);
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

  // 6. Failover Routing if Primary fails
  if (!providerCallSucceeded) {
    console.warn(`[VerificationService] Primary provider ${providerKey} failed. Trying fallback...`);
    
    // Mark primary provider degraded or down in health registry
    await updateProviderHealth(providerKey, result.errorCode === "PROVIDER_INSUFFICIENT_BALANCE" ? "INSUFFICIENT_BALANCE" : "UNAVAILABLE");
    
    const fallbackKey = providerKey === "DOJAH" ? "YOUVERIFY" : "DOJAH";
    const fallback = await getFallbackProvider(providerKey);

    if (fallback) {
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
        const fallbackCost = sandbox ? 0 : await fetchProviderCost(adminClient, fallbackKey, "bvn_selfie");
        const fallbackResult = await executeProviderBVNWithFace(fallback, params.bvn, selfieSignedUrl || "", params.selfieBase64, params.merchantId);
        
        if (fallbackResult.success || !fallbackResult.errorCode || !["PROVIDER_UNAVAILABLE", "PROVIDER_INSUFFICIENT_BALANCE"].includes(fallbackResult.errorCode)) {
          providerKey = fallbackKey;
          result = fallbackResult;
          providerCallSucceeded = true;
        }
      } catch (fallbackErr: any) {
        console.error(`[VerificationService] Fallback provider ${fallbackKey} also failed:`, fallbackErr?.message);
      }
    }
  }

  // 7. Process Provider Health Updates on final result
  if (providerCallSucceeded) {
    await updateProviderHealth(providerKey, result.success ? "ACTIVE" : "ACTIVE");
  } else {
    // Both failed
    await updateProviderHealth(providerKey, "UNAVAILABLE");
    await sendProviderDownAlert(providerKey, 10);
  }

  // 8. Sandbox override
  if (sandbox) {
    result = {
      ...result,
      success: true,
      bvnExists: true,
      faceMatch: true,
      matchScore: result.matchScore ?? 95,
    };
  }

  // 9. Name Matching Check
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
  await writeAuditLog(adminClient, {
    merchantId: params.merchantId,
    provider: providerKey,
    type: "bvn_selfie",
    fingerprint,
    maskedBvn: maskBVN(params.bvn),
    status: result.success ? "verified" : "failed",
    cost: sandbox ? 0 : await fetchProviderCost(adminClient, providerKey, "bvn_selfie"),
    sandbox,
    result,
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
  const fingerprint = generateFingerprint(params.registrationNumber, params.merchantId, "business");
  const cached = await getCachedVerification(adminClient, fingerprint, "business");

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

  // 3. Sandbox Bypass
  if (sandbox) {
    await writeAuditLog(adminClient, {
      merchantId: params.merchantId,
      provider: "DOJAH",
      type: "business",
      fingerprint,
      maskedBvn: null,
      status: "verified",
      cost: 0,
      sandbox: true,
      result: {
        success: true,
        companyName: params.businessName,
        registrationStatus: "ACTIVE",
        personnel: [{ name: params.ownerName, role: "director" }],
        providerReference: `sandbox-${Date.now()}`,
        rawResponse: { sandbox: true },
      } as any,
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

  // 4. Call Primary Provider
  let providerKey = await getActiveProviderKey();
  let provider = await getActiveProvider();
  let result: BusinessVerificationResult;
  let providerCallSucceeded = false;

  try {
    result = await provider.verifyBusiness({
      registrationNumber: params.registrationNumber,
      businessName: params.businessName,
      ownerName: params.ownerName,
    });
    providerCallSucceeded = !result.errorCode || !["PROVIDER_UNAVAILABLE", "PROVIDER_INSUFFICIENT_BALANCE"].includes(result.errorCode);
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
    await updateProviderHealth(providerKey, result.errorCode === "PROVIDER_INSUFFICIENT_BALANCE" ? "INSUFFICIENT_BALANCE" : "UNAVAILABLE");

    const fallbackKey = providerKey === "DOJAH" ? "YOUVERIFY" : "DOJAH";
    const fallback = await getFallbackProvider(providerKey);

    if (fallback) {
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

        if (fallbackResult.success || !fallbackResult.errorCode || !["PROVIDER_UNAVAILABLE", "PROVIDER_INSUFFICIENT_BALANCE"].includes(fallbackResult.errorCode)) {
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
  await writeAuditLog(adminClient, {
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
      .select("bvn, selfie_url, business_name, owner_name, email")
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
      // CAC lookup retry
      const registrationNumber = merchant.business_name || ""; // fallback representation
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
    return {
      success: raw.status === true || raw.entity?.bvn === bvn,
      bvnExists: Boolean(raw.entity?.bvn || raw.status),
      faceMatch: matchScore !== null && matchScore >= 70,
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

async function writeAuditLog(
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
  }
): Promise<void> {
  try {
    const attemptNum = await getNextAttemptNumber(adminClient, params.merchantId, params.type);

    await adminClient.from("verification_logs").insert({
      merchant_id: params.merchantId,
      provider_name: params.provider.toUpperCase(),
      verification_type: params.type,
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
    });
  } catch (err: any) {
    console.error("[VerificationService] Audit write failed:", err?.message);
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
  const bvnFullName = [returnedName.firstName, returnedName.middleName, returnedName.lastName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .trim();

  if (!bvnFullName) return { matches: true, bvnFullName: "—" };

  const ownerTokens = ownerName
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  const bvnTokens = bvnFullName
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  const matches = ownerTokens.some((t) => bvnTokens.includes(t));
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
