/**
 * DeraLedger — Verification Engine Shared Types
 *
 * All verification providers MUST implement VerificationProvider.
 * All responses MUST be normalized to NormalizedVerificationResponse before leaving the service layer.
 * Onboarding flows and server actions MUST NOT call provider SDKs directly.
 * Only VerificationService can interact with providers.
 */

// ── Provider capability contract ─────────────────────────────────────────────

export interface VerificationProvider {
  /** Return true if required env credentials are set */
  isConfigured(): boolean;

  /**
   * Verify a BVN number against a facial selfie image.
   * selfieImageUrl: A publicly accessible or signed URL (Supabase storage).
   *                 Some providers accept base64; see implementation.
   */
  verifyBVNWithFace(payload: BVNFacePayload): Promise<VerificationResult>;

  /** Verify a Nigerian CAC business registration number */
  verifyBusiness(payload: BusinessVerificationPayload): Promise<BusinessVerificationResult>;
}

/**
 * Full provider adapter interface — all providers must implement this.
 * Extends the legacy VerificationProvider for backwards compatibility.
 */
export interface ProviderAdapter extends VerificationProvider {
  /** Provider name key */
  readonly providerName: VerificationProviderKey | 'SMILEID';

  /** Standalone BVN verification (without face) */
  verifyBVN?(payload: { bvn: string; customerReference?: string }): Promise<NormalizedVerificationResponse>;

  /** Standalone selfie / face-match verification */
  verifySelfie?(payload: {
    selfieImageUrl?: string;
    selfieBase64?: string;
    customerReference?: string;
  }): Promise<NormalizedVerificationResponse>;

  /** Liveness detection (future-ready) */
  verifyLiveness?(payload: {
    selfieBase64: string;
    customerReference?: string;
  }): Promise<NormalizedVerificationResponse>;

  /** Ping provider health endpoint */
  checkProviderHealth(): Promise<ProviderHealthCheckResult>;
}

// ── Payloads ─────────────────────────────────────────────────────────────────

export interface BVNFacePayload {
  bvn: string;
  /** Signed URL to the selfie stored in Supabase storage */
  selfieImageUrl: string;
  /** Raw base64 fallback (used by Dojah which accepts base64 directly) */
  selfieBase64?: string;
  /** Merchant ID used as customer reference for audit logs */
  customerReference?: string;
}

export interface BusinessVerificationPayload {
  registrationNumber: string; // e.g. "RC0000000", "BN000000", "IT000000"
  businessName?: string;       // Used for fuzzy name matching post-lookup
  ownerName?: string;          // Used for representative roster matching
}

export interface DirectorVerificationPayload {
  directorName: string;
  directorRole: DirectorRole;
  bvn: string;
  selfieBase64: string;
  selfieStoragePath: string;
  merchantId: string;
  businessVerificationId?: string;
  customerReference?: string;
}

// ── Normalized results ───────────────────────────────────────────────────────

export interface VerificationResult {
  success: boolean;
  /** BVN number found in provider system */
  bvnExists: boolean;
  /** Face match returned positive */
  faceMatch: boolean;
  /** Normalized match score 0–100. Null if provider did not return one. */
  matchScore: number | null;
  /** Name tokens returned by provider BVN lookup */
  returnedName: {
    firstName?: string;
    lastName?: string;
    middleName?: string;
  };
  /** Provider-specific reference ID for audit trail */
  providerReference: string | null;
  /** Raw provider response — stored in verification_logs for audit */
  rawResponse: Record<string, unknown>;
  /** Normalized error code if success = false */
  errorCode?: VerificationErrorCode;
  /** Human-readable error message */
  error?: string;
}

export interface BusinessVerificationResult {
  success: boolean;
  /** Exact company name from registry */
  companyName: string | null;
  /** CAC registration status */
  registrationStatus: string | null;
  /** All personnel records from registry (directors, shareholders, etc.) */
  personnel: PersonnelRecord[];
  /** Provider-specific reference for audit */
  providerReference: string | null;
  /** Raw provider response */
  rawResponse: Record<string, unknown>;
  /** Normalized error code */
  errorCode?: VerificationErrorCode;
  /** Human-readable error message */
  error?: string;
}

export interface PersonnelRecord {
  name: string;
  role: string; // director | shareholder | proprietor | partner | trustee | president | signatory
}

/**
 * Standardized verification response — all providers normalize to this shape.
 * PRD Section 14.2.
 */
export interface NormalizedVerificationResponse {
  status: NormalizedVerificationStatus;
  verification_type: string;
  provider: string;
  confidence_score: number | null;
  verification_id: string | null;
  raw_response: Record<string, unknown>;
  error?: string;
  error_code?: VerificationErrorCode;
}

export interface DirectorVerificationResult {
  success: boolean;
  faceMatchScore: number | null;
  livenessScore: number | null;
  verificationId: string | null;
  normalizedStatus: NormalizedVerificationStatus;
  providerName: string;
  error?: string;
  errorCode?: VerificationErrorCode;
  rawResponse: Record<string, unknown>;
}

export interface ProviderHealthCheckResult {
  providerName: string;
  status: ProviderStatus;
  responseTimeMs: number;
  error?: string;
}

// ── Error codes ───────────────────────────────────────────────────────────────

export type VerificationErrorCode =
  | 'PROVIDER_INSUFFICIENT_BALANCE'   // 402 — mark provider unhealthy
  | 'PROVIDER_PERMISSION_DENIED'      // 403 — disable provider temporarily
  | 'BUSINESS_NOT_FOUND'              // 404 — verification failed cleanly
  | 'PROVIDER_UNAVAILABLE'            // 5xx — retry / fallback
  | 'BVN_NOT_FOUND'                   // BVN does not exist
  | 'FACE_MATCH_FAILED'               // Match score too low
  | 'NAME_MISMATCH'                   // BVN name vs profile name mismatch
  | 'PROVIDER_NOT_CONFIGURED'         // Missing env credentials
  | 'RATE_LIMITED'                    // Too many attempts
  | 'DUPLICATE_REQUEST'               // Cached result returned
  | 'UNKNOWN_ERROR';

// ── Status types ──────────────────────────────────────────────────────────────

export type NormalizedVerificationStatus =
  | 'verified'
  | 'failed'
  | 'pending'
  | 'retrying'
  | 'provider_down';

export type ProviderStatus =
  | 'ACTIVE'
  | 'DEGRADED'
  | 'DOWN'
  | 'DISABLED'
  | 'UNCHECKED';

export type DirectorRole =
  | 'director'
  | 'shareholder'
  | 'beneficial_owner'
  | 'signatory'
  | 'proprietor'
  | 'partner'
  | 'trustee';

// ── Provider keys ─────────────────────────────────────────────────────────────

export type VerificationProviderKey = 'DOJAH' | 'YOUVERIFY' | 'SMILEID';

export interface ProviderHealthRecord {
  DOJAH: ProviderHealthStatus;
  YOUVERIFY: ProviderHealthStatus;
  SMILEID: ProviderHealthStatus;
}

export type ProviderHealthStatus =
  | 'ACTIVE'
  | 'UNAVAILABLE'
  | 'INSUFFICIENT_BALANCE'
  | 'PERMISSION_ISSUE'
  | 'UNCHECKED';

// ── Provider costs ────────────────────────────────────────────────────────────

/**
 * Hardcoded provider cost estimates per verification type.
 * Sandbox always returns 0. Update production values when provider pricing changes.
 */
export const PROVIDER_COSTS: Record<string, { bvn_selfie: number; business: number; director: number }> = {
  DOJAH: {
    bvn_selfie: 150,   // ₦150 per BVN + selfie call
    business: 100,     // ₦100 per CAC lookup
    director: 150,     // ₦150 per director selfie check
  },
  YOUVERIFY: {
    bvn_selfie: 120,   // ₦120 per BVN + face verify
    business: 80,      // ₦80 per business verify
    director: 120,     // ₦120 per director check
  },
  SMILEID: {
    bvn_selfie: 200,
    business: 150,
    director: 200,
  },
  DEFAULT: {
    bvn_selfie: 150,
    business: 100,
    director: 150,
  },
};

/**
 * Returns the cost estimate for a given provider + verification type.
 * Always returns 0 in sandbox mode.
 */
export function getVerificationCost(
  providerName: string,
  verificationType: keyof (typeof PROVIDER_COSTS)[string],
  isSandbox: boolean
): number {
  if (isSandbox) return 0;
  const costs = PROVIDER_COSTS[providerName.toUpperCase()] || PROVIDER_COSTS.DEFAULT;
  return costs[verificationType] ?? 0;
}
