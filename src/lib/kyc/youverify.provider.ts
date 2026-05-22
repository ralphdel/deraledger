/**
 * DeraLedger — Youverify Verification Provider
 *
 * Implements VerificationProvider for Youverify sandbox/production.
 * Environment variables required:
 *   YOUVERIFY_APP_ID    — Youverify App/Token ID
 *   YOUVERIFY_SECRET_KEY — Youverify secret key
 *
 * IMPORTANT: This provider expects a selfie IMAGE URL (not base64).
 * The selfie must be uploaded to Supabase storage and a signed URL
 * generated BEFORE calling verifyBVNWithFace(). The VerificationService
 * handles this storage-first step.
 *
 * premiumBVN is always false per spec.
 */

import type {
  VerificationProvider,
  BVNFacePayload,
  BusinessVerificationPayload,
  VerificationResult,
  BusinessVerificationResult,
  PersonnelRecord,
  VerificationErrorCode,
} from "./types";

export class YouverifyProvider implements VerificationProvider {
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly secretKey: string;

  constructor() {
    // Use sandbox base URL unless YOUVERIFY_BASE_URL is explicitly set
    this.baseUrl =
      process.env.YOUVERIFY_BASE_URL || "https://api.sandbox.youverify.co";
    this.appId = process.env.YOUVERIFY_APP_ID || "";
    this.secretKey = process.env.YOUVERIFY_SECRET_KEY || "";
  }

  isConfigured(): boolean {
    return Boolean(this.appId && this.secretKey);
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      token: this.secretKey,
      "app-id": this.appId,
    };
  }

  // ── BVN + Face Verification ─────────────────────────────────────────────────

  async verifyBVNWithFace(payload: BVNFacePayload): Promise<VerificationResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        bvnExists: false,
        faceMatch: false,
        matchScore: null,
        returnedName: {},
        providerReference: null,
        rawResponse: {},
        errorCode: "PROVIDER_NOT_CONFIGURED",
        error: "Youverify is not configured. Set YOUVERIFY_APP_ID and YOUVERIFY_SECRET_KEY.",
      };
    }

    if (!payload.selfieImageUrl) {
      return {
        success: false,
        bvnExists: false,
        faceMatch: false,
        matchScore: null,
        returnedName: {},
        providerReference: null,
        rawResponse: {},
        errorCode: "UNKNOWN_ERROR",
        error: "Selfie image URL is required for Youverify BVN verification.",
      };
    }

    const body = {
      id: payload.bvn,
      isSubjectConsent: true,
      validations: {
        selfie: {
          image: payload.selfieImageUrl,
        },
      },
      premiumBVN: false, // MUST remain false per spec
    };

    try {
      const res = await fetch(
        `${this.baseUrl}/v2/api/identity/ind/bvn/verify-with-face`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(body),
        }
      );

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorCode = this.normalizeHttpError(res.status);
        const message =
          typeof json?.message === "string"
            ? json.message
            : `Youverify BVN request failed with status ${res.status}`;
        return {
          success: false,
          bvnExists: false,
          faceMatch: false,
          matchScore: null,
          returnedName: {},
          providerReference: json?.requestId || null,
          rawResponse: json,
          errorCode,
          error: message,
        };
      }

      return this.normalizeBVNResponse(json);
    } catch (err: any) {
      return {
        success: false,
        bvnExists: false,
        faceMatch: false,
        matchScore: null,
        returnedName: {},
        providerReference: null,
        rawResponse: {},
        errorCode: "PROVIDER_UNAVAILABLE",
        error: err.message || "Youverify service unreachable.",
      };
    }
  }

  // ── Business (CAC) Verification ─────────────────────────────────────────────

  async verifyBusiness(
    payload: BusinessVerificationPayload
  ): Promise<BusinessVerificationResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        companyName: null,
        registrationStatus: null,
        personnel: [],
        providerReference: null,
        rawResponse: {},
        errorCode: "PROVIDER_NOT_CONFIGURED",
        error: "Youverify is not configured. Set YOUVERIFY_APP_ID and YOUVERIFY_SECRET_KEY.",
      };
    }

    const body = {
      registrationNumber: payload.registrationNumber,
      countryCode: "NG",
      isConsent: true,
    };

    try {
      const res = await fetch(
        `${this.baseUrl}/v2/api/identity/businesses/cac`,
        {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(body),
        }
      );

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorCode = this.normalizeHttpError(res.status);
        // 404 is a clean "business not found" — not a provider error
        const message =
          res.status === 404
            ? `Business with registration number ${payload.registrationNumber} was not found in the CAC registry.`
            : typeof json?.message === "string"
            ? json.message
            : `Youverify CAC request failed with status ${res.status}`;
        return {
          success: false,
          companyName: null,
          registrationStatus: null,
          personnel: [],
          providerReference: json?.requestId || null,
          rawResponse: json,
          errorCode,
          error: message,
        };
      }

      return this.normalizeBusinessResponse(json);
    } catch (err: any) {
      return {
        success: false,
        companyName: null,
        registrationStatus: null,
        personnel: [],
        providerReference: null,
        rawResponse: {},
        errorCode: "PROVIDER_UNAVAILABLE",
        error: err.message || "Youverify service unreachable.",
      };
    }
  }

  // ── Response normalizers ────────────────────────────────────────────────────

  private normalizeBVNResponse(json: any): VerificationResult {
    const data = json?.data || json;
    const bvnData = data?.bvn || data;
    const selfieData = data?.selfie || data?.faceVerification || {};

    // Extract match score — Youverify returns 0–1 confidence or 0–100 percentage
    const rawScore =
      selfieData?.confidence ??
      selfieData?.matchScore ??
      selfieData?.faceMatchScore ??
      null;
    const matchScore =
      rawScore !== null && typeof rawScore === "number"
        ? rawScore <= 1
          ? Math.round(rawScore * 100)
          : Math.round(rawScore)
        : null;

    const faceMatch = selfieData?.match === true || (matchScore !== null && matchScore >= 70);
    const bvnExists = Boolean(bvnData?.bvn || bvnData?.id || json?.status === "success");

    return {
      success: bvnExists && faceMatch,
      bvnExists,
      faceMatch,
      matchScore,
      returnedName: {
        firstName: bvnData?.firstname || bvnData?.firstName || undefined,
        lastName: bvnData?.lastname || bvnData?.lastName || bvnData?.surname || undefined,
        middleName: bvnData?.middlename || bvnData?.middleName || undefined,
      },
      providerReference: json?.requestId || data?.id || null,
      rawResponse: json,
    };
  }

  private normalizeBusinessResponse(json: any): BusinessVerificationResult {
    const data = json?.data || json;
    const company = data?.company || data;

    // Extract all personnel across known roster types
    const personnel: PersonnelRecord[] = [];
    const addPersonnel = (arr: any[], role: string) => {
      if (!Array.isArray(arr)) return;
      for (const p of arr) {
        const name =
          p?.name || p?.fullName || p?.full_name ||
          [p?.firstName || p?.firstname, p?.lastName || p?.lastname || p?.surname]
            .filter(Boolean)
            .join(" ") || "";
        if (name.trim().length > 1) {
          personnel.push({ name: name.trim(), role });
        }
      }
    };

    addPersonnel(company?.directors,    "director");
    addPersonnel(company?.shareholders, "shareholder");
    addPersonnel(company?.proprietors,  "proprietor");
    addPersonnel(company?.partners,     "partner");
    addPersonnel(company?.trustees,     "trustee");
    addPersonnel(company?.officers,     "signatory");
    addPersonnel(company?.members,      "partner");

    // Handle proprietor as single string field
    const singleProp = company?.proprietorName || company?.proprietor_name;
    if (typeof singleProp === "string" && singleProp.trim().length > 1) {
      personnel.push({ name: singleProp.trim(), role: "proprietor" });
    }

    const companyName: string | null =
      company?.companyName || company?.company_name || company?.name || null;
    const registrationStatus: string | null =
      company?.status || company?.registrationStatus || json?.status || null;

    return {
      success: Boolean(companyName),
      companyName,
      registrationStatus,
      personnel,
      providerReference: json?.requestId || data?.id || null,
      rawResponse: json,
    };
  }

  // ── HTTP error → normalized error code ──────────────────────────────────────

  private normalizeHttpError(status: number): VerificationErrorCode {
    switch (status) {
      case 402: return "PROVIDER_INSUFFICIENT_BALANCE";
      case 403: return "PROVIDER_PERMISSION_DENIED";
      case 404: return "BUSINESS_NOT_FOUND";
      default:
        if (status >= 500) return "PROVIDER_UNAVAILABLE";
        return "UNKNOWN_ERROR";
    }
  }
}
