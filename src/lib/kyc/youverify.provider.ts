/**
 * DeraLedger — Youverify Verification Provider
 *
 * Implements ProviderAdapter for Youverify sandbox/production.
 * Environment variables required:
 *   YOUVERIFY_APP_ID    — Youverify App/Token ID
 *   YOUVERIFY_SECRET_KEY — Youverify secret key
 */

import type {
  ProviderAdapter,
  BVNFacePayload,
  BusinessVerificationPayload,
  VerificationResult,
  BusinessVerificationResult,
  NormalizedVerificationResponse,
  ProviderHealthCheckResult,
  VerificationErrorCode,
  NormalizedVerificationStatus,
  ProviderStatus,
} from './types';

export class YouverifyProvider implements ProviderAdapter {
  readonly providerName = 'YOUVERIFY' as const;
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly secretKey: string;

  constructor(options: { sandboxMode?: boolean; baseUrl?: string } = {}) {
    const sandboxMode = options.sandboxMode ?? process.env.VERIFICATION_MODE === 'sandbox';
    this.baseUrl =
      options.baseUrl ||
      (sandboxMode
        ? process.env.YOUVERIFY_SANDBOX_BASE_URL || 'https://api.sandbox.youverify.co'
        : process.env.YOUVERIFY_PRODUCTION_BASE_URL || 'https://api.youverify.co');
    this.appId = process.env.YOUVERIFY_APP_ID || '';
    this.secretKey = process.env.YOUVERIFY_SECRET_KEY || '';
  }

  isConfigured(): boolean {
    return Boolean(this.appId && this.secretKey);
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      token: this.secretKey,
      'app-id': this.appId,
    };
  }

  // ── Standalone BVN check ───────────────────────────────────────────────────

  async verifyBVN(payload: { bvn: string; customerReference?: string }): Promise<NormalizedVerificationResponse> {
    if (!this.isConfigured()) {
      return {
        status: 'failed',
        verification_type: 'bvn',
        provider: 'YOUVERIFY',
        confidence_score: null,
        verification_id: null,
        raw_response: {},
        error: 'Youverify is not configured.',
        error_code: 'PROVIDER_NOT_CONFIGURED',
      };
    }

    try {
      const res = await fetch(`${this.baseUrl}/v2/api/identity/ind/bvn`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          id: payload.bvn,
          isSubjectConsent: true,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          status: 'failed',
          verification_type: 'bvn',
          provider: 'YOUVERIFY',
          confidence_score: null,
          verification_id: json?.requestId || null,
          raw_response: json,
          error: json?.message || `Youverify request failed with ${res.status}`,
          error_code: this.normalizeHttpError(res.status),
        };
      }

      const status: NormalizedVerificationStatus =
        json?.status === 'success' || json?.data?.status === 'success' ? 'verified' : 'failed';

      return {
        status,
        verification_type: 'bvn',
        provider: 'YOUVERIFY',
        confidence_score: status === 'verified' ? 100 : 0,
        verification_id: json?.requestId || json?.data?.id || null,
        raw_response: json,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        verification_type: 'bvn',
        provider: 'YOUVERIFY',
        confidence_score: null,
        verification_id: null,
        raw_response: {},
        error: err.message || 'Youverify service unreachable.',
        error_code: 'PROVIDER_UNAVAILABLE',
      };
    }
  }

  // ── Standalone Selfie Verification ─────────────────────────────────────────

  async verifySelfie(payload: {
    selfieImageUrl?: string;
    selfieBase64?: string;
    customerReference?: string;
  }): Promise<NormalizedVerificationResponse> {
    if (!this.isConfigured()) {
      return {
        status: 'failed',
        verification_type: 'selfie',
        provider: 'YOUVERIFY',
        confidence_score: null,
        verification_id: null,
        raw_response: {},
        error: 'Youverify is not configured.',
        error_code: 'PROVIDER_NOT_CONFIGURED',
      };
    }

    try {
      // Youverify selfie verification endpoint (often document or direct liveness check)
      const res = await fetch(`${this.baseUrl}/v2/api/identity/ind/selfie/verify`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          image: payload.selfieImageUrl || payload.selfieBase64,
          isSubjectConsent: true,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          status: 'failed',
          verification_type: 'selfie',
          provider: 'YOUVERIFY',
          confidence_score: null,
          verification_id: json?.requestId || null,
          raw_response: json,
          error: json?.message || `Youverify selfie check failed with ${res.status}`,
          error_code: this.normalizeHttpError(res.status),
        };
      }

      const match = json?.data?.match === true || json?.data?.matchScore >= 70;
      const status: NormalizedVerificationStatus = match ? 'verified' : 'failed';

      return {
        status,
        verification_type: 'selfie',
        provider: 'YOUVERIFY',
        confidence_score: json?.data?.matchScore || null,
        verification_id: json?.requestId || json?.data?.id || null,
        raw_response: json,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        verification_type: 'selfie',
        provider: 'YOUVERIFY',
        confidence_score: null,
        verification_id: null,
        raw_response: {},
        error: err.message || 'Youverify service unreachable.',
        error_code: 'PROVIDER_UNAVAILABLE',
      };
    }
  }

  // ── BVN + Face Verification (Legacy compatibility) ─────────────────────────

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
        errorCode: 'PROVIDER_NOT_CONFIGURED',
        error: 'Youverify is not configured. Set YOUVERIFY_APP_ID and YOUVERIFY_SECRET_KEY.',
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
        errorCode: 'UNKNOWN_ERROR',
        error: 'Selfie image URL is required for Youverify BVN verification.',
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
      premiumBVN: false,
    };

    try {
      const res = await fetch(`${this.baseUrl}/v2/api/identity/ind/bvn/verify-with-face`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorCode = this.normalizeHttpError(res.status);
        const message =
          typeof json?.message === 'string'
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
        errorCode: 'PROVIDER_UNAVAILABLE',
        error: err.message || 'Youverify service unreachable.',
      };
    }
  }

  // ── Business (CAC) Verification (Legacy compatibility) ──────────────────────

  async verifyBusiness(payload: BusinessVerificationPayload): Promise<BusinessVerificationResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        companyName: null,
        registrationStatus: null,
        personnel: [],
        providerReference: null,
        rawResponse: {},
        errorCode: 'PROVIDER_NOT_CONFIGURED',
        error: 'Youverify is not configured. Set YOUVERIFY_APP_ID and YOUVERIFY_SECRET_KEY.',
      };
    }

    const body = {
      registrationNumber: payload.registrationNumber,
      countryCode: 'NG',
      isConsent: true,
    };

    try {
      const res = await fetch(`${this.baseUrl}/v2/api/identity/businesses/cac`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorCode = this.normalizeHttpError(res.status);
        const message =
          res.status === 404
            ? `Business with registration number ${payload.registrationNumber} was not found in the CAC registry.`
            : typeof json?.message === 'string'
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
        errorCode: 'PROVIDER_UNAVAILABLE',
        error: err.message || 'Youverify service unreachable.',
      };
    }
  }

  // ── Provider Health Monitoring ─────────────────────────────────────────────

  async checkProviderHealth(): Promise<ProviderHealthCheckResult> {
    const start = Date.now();
    try {
      if (!this.isConfigured()) {
        return {
          providerName: 'YOUVERIFY',
          status: 'DISABLED',
          responseTimeMs: 0,
          error: 'Credentials not configured.',
        };
      }

      // Perform a cheap, invalid request to verify endpoint (e.g. empty post) to test connectivity
      const res = await fetch(`${this.baseUrl}/v2/api/identity/ind/bvn/verify-with-face`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({}),
      });

      const responseTimeMs = Date.now() - start;

      // If we get an authentication / validation response (400, 401, 422), it means server is UP
      if (res.status === 402) {
        return {
          providerName: 'YOUVERIFY',
          status: 'DOWN',
          responseTimeMs,
          error: 'Insufficient balance (HTTP 402).',
        };
      }

      if (res.status >= 500) {
        return {
          providerName: 'YOUVERIFY',
          status: 'DOWN',
          responseTimeMs,
          error: `Server error (HTTP ${res.status}).`,
        };
      }

      return {
        providerName: 'YOUVERIFY',
        status: 'ACTIVE',
        responseTimeMs,
      };
    } catch (err: any) {
      return {
        providerName: 'YOUVERIFY',
        status: 'DOWN',
        responseTimeMs: Date.now() - start,
        error: err.message || 'Network unreachable.',
      };
    }
  }

  // ── Response normalizers ────────────────────────────────────────────────────

  private normalizeBVNResponse(json: any): VerificationResult {
    const data = json?.data || json;
    const bvnData = data?.bvn || data;
    const selfieData = data?.selfie || data?.faceVerification || {};

    const rawScore = selfieData?.confidence ?? selfieData?.matchScore ?? selfieData?.faceMatchScore ?? null;
    const matchScore =
      rawScore !== null && typeof rawScore === 'number'
        ? rawScore <= 1
          ? Math.round(rawScore * 100)
          : Math.round(rawScore)
        : null;

    const faceMatch = selfieData?.match === true || (matchScore !== null && matchScore >= 70);
    const bvnExists = Boolean(bvnData?.bvn || bvnData?.id || json?.status === 'success');

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

    const personnel: any[] = [];
    const addPersonnel = (arr: any[], role: string) => {
      if (!Array.isArray(arr)) return;
      for (const p of arr) {
        const name =
          p?.name ||
          p?.fullName ||
          p?.full_name ||
          [p?.firstName || p?.firstname, p?.lastName || p?.lastname || p?.surname].filter(Boolean).join(' ') ||
          '';
        if (name.trim().length > 1) {
          personnel.push({ name: name.trim(), role });
        }
      }
    };

    addPersonnel(company?.directors, 'director');
    addPersonnel(company?.shareholders, 'shareholder');
    addPersonnel(company?.proprietors, 'proprietor');
    addPersonnel(company?.partners, 'partner');
    addPersonnel(company?.trustees, 'trustee');
    addPersonnel(company?.officers, 'signatory');
    addPersonnel(company?.members, 'partner');

    const singleProp = company?.proprietorName || company?.proprietor_name;
    if (typeof singleProp === 'string' && singleProp.trim().length > 1) {
      personnel.push({ name: singleProp.trim(), role: 'proprietor' });
    }

    const companyName: string | null = company?.companyName || company?.company_name || company?.name || null;
    const registrationStatus: string | null = company?.status || company?.registrationStatus || json?.status || null;

    return {
      success: Boolean(companyName),
      companyName,
      registrationStatus,
      personnel,
      providerReference: json?.requestId || data?.id || null,
      rawResponse: json,
    };
  }

  private normalizeHttpError(status: number): VerificationErrorCode {
    switch (status) {
      case 402:
        return 'PROVIDER_INSUFFICIENT_BALANCE';
      case 403:
        return 'PROVIDER_PERMISSION_DENIED';
      case 404:
        return 'BUSINESS_NOT_FOUND';
      default:
        if (status >= 500) return 'PROVIDER_UNAVAILABLE';
        return 'UNKNOWN_ERROR';
    }
  }
}
