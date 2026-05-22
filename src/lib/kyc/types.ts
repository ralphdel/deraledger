/**
 * DeraLedger — Verification Engine Shared Types
 *
 * All verification providers MUST implement VerificationProvider.
 * All responses MUST be normalized to these types before leaving the service layer.
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
  /** Raw provider response — stored in verification_records for audit */
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

// ── Error codes ───────────────────────────────────────────────────────────────

export type VerificationErrorCode =
  | "PROVIDER_INSUFFICIENT_BALANCE"   // 402 — mark provider unhealthy
  | "PROVIDER_PERMISSION_DENIED"      // 403 — disable provider temporarily
  | "BUSINESS_NOT_FOUND"              // 404 — verification failed cleanly
  | "PROVIDER_UNAVAILABLE"            // 5xx — retry / fallback
  | "BVN_NOT_FOUND"                   // BVN does not exist
  | "FACE_MATCH_FAILED"               // Match score too low
  | "NAME_MISMATCH"                   // BVN name vs profile name mismatch
  | "PROVIDER_NOT_CONFIGURED"         // Missing env credentials
  | "UNKNOWN_ERROR";

// ── Provider keys ─────────────────────────────────────────────────────────────

export type VerificationProviderKey = "DOJAH" | "YOUVERIFY";

export interface ProviderHealthRecord {
  DOJAH: ProviderHealthStatus;
  YOUVERIFY: ProviderHealthStatus;
}

export type ProviderHealthStatus =
  | "ACTIVE"
  | "UNAVAILABLE"
  | "INSUFFICIENT_BALANCE"
  | "PERMISSION_ISSUE"
  | "UNCHECKED";
