/**
 * DeraLedger — Dojah Verification Provider
 *
 * Implements ProviderAdapter for Dojah sandbox/production.
 * Environment variables required:
 *   DOJAH_APP_ID     — Dojah App ID
 *   DOJAH_SECRET_KEY — Dojah secret key
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
} from './types';

type DojahSelfieVerification = {
  match?: boolean;
  match_score?: number;
  confidence_value?: number;
};

type DojahBVNEntity = {
  bvn?: string;
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  selfie_verification?: DojahSelfieVerification;
};

export type DojahBVNSelfieResult = {
  entity?: DojahBVNEntity;
  reference_id?: string;
  status?: boolean;
  message?: string;
  error?: string;
  http_status?: number;
  [key: string]: unknown;
};

export class DojahProvider implements ProviderAdapter {
  readonly providerName = 'DOJAH' as const;
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly secretKey: string;

  constructor(options: { sandboxMode?: boolean; baseUrl?: string } = {}) {
    const sandboxMode = options.sandboxMode ?? process.env.VERIFICATION_MODE === 'sandbox';
    this.baseUrl =
      options.baseUrl ||
      (sandboxMode
        ? process.env.DOJAH_SANDBOX_BASE_URL || 'https://sandbox.dojah.io'
        : process.env.DOJAH_PRODUCTION_BASE_URL || 'https://api.dojah.io');
    this.appId = process.env.DOJAH_APP_ID || '';
    this.secretKey = process.env.DOJAH_SECRET_KEY || '';
  }

  isConfigured(): boolean {
    return Boolean(this.appId && this.secretKey);
  }

  private get headers(): Record<string, string> {
    return {
      AppId: this.appId,
      Authorization: this.secretKey,
      'Content-Type': 'application/json',
    };
  }

  // ── Standalone BVN check ───────────────────────────────────────────────────

  async verifyBVN(payload: { bvn: string; customerReference?: string }): Promise<NormalizedVerificationResponse> {
    if (!this.isConfigured()) {
      return {
        status: 'failed',
        verification_type: 'bvn',
        provider: 'DOJAH',
        confidence_score: null,
        verification_id: null,
        raw_response: {},
        error: 'Dojah is not configured.',
        error_code: 'PROVIDER_NOT_CONFIGURED',
      };
    }

    try {
      const url = new URL('/api/v1/kyc/bvn', this.baseUrl);
      if (payload.customerReference) {
        url.searchParams.set('customer_reference', payload.customerReference);
      }
      url.searchParams.set('bvn', payload.bvn);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          AppId: this.appId,
          Authorization: this.secretKey,
          Accept: 'application/json',
        },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          status: 'failed',
          verification_type: 'bvn',
          provider: 'DOJAH',
          confidence_score: null,
          verification_id: json?.reference_id || null,
          raw_response: json,
          error: json?.error || json?.message || `Dojah request failed with ${res.status}`,
          error_code: this.normalizeHttpError(res.status),
        };
      }

      const verified = json?.entity?.bvn === payload.bvn || json?.status === true;

      return {
        status: verified ? 'verified' : 'failed',
        verification_type: 'bvn',
        provider: 'DOJAH',
        confidence_score: verified ? 100 : 0,
        verification_id: json?.reference_id || null,
        raw_response: json,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        verification_type: 'bvn',
        provider: 'DOJAH',
        confidence_score: null,
        verification_id: null,
        raw_response: {},
        error: err.message || 'Dojah service unreachable.',
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
        provider: 'DOJAH',
        confidence_score: null,
        verification_id: null,
        raw_response: {},
        error: 'Dojah is not configured.',
        error_code: 'PROVIDER_NOT_CONFIGURED',
      };
    }

    let base64 = payload.selfieBase64;
    if (!base64 && payload.selfieImageUrl) {
      try {
        const fetchRes = await fetch(payload.selfieImageUrl);
        if (fetchRes.ok) {
          const buf = await fetchRes.arrayBuffer();
          base64 = Buffer.from(buf).toString('base64');
        }
      } catch (err) {}
    }

    if (!base64) {
      return {
        status: 'failed',
        verification_type: 'selfie',
        provider: 'DOJAH',
        confidence_score: null,
        verification_id: null,
        raw_response: {},
        error: 'Dojah selfie verification requires base64 or a valid image URL.',
        error_code: 'UNKNOWN_ERROR',
      };
    }

    try {
      // Dojah photo comparison endpoint
      const res = await fetch(`${this.baseUrl}/api/v1/kyc/face/compare`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          image: base64,
          isSubjectConsent: true,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          status: 'failed',
          verification_type: 'selfie',
          provider: 'DOJAH',
          confidence_score: null,
          verification_id: json?.reference_id || null,
          raw_response: json,
          error: json?.message || `Dojah selfie check failed with ${res.status}`,
          error_code: this.normalizeHttpError(res.status),
        };
      }

      const match = json?.entity?.match === true || json?.entity?.confidence_value >= 70;
      const status: NormalizedVerificationStatus = match ? 'verified' : 'failed';

      return {
        status,
        verification_type: 'selfie',
        provider: 'DOJAH',
        confidence_score: json?.entity?.confidence_value || null,
        verification_id: json?.reference_id || null,
        raw_response: json,
      };
    } catch (err: any) {
      return {
        status: 'failed',
        verification_type: 'selfie',
        provider: 'DOJAH',
        confidence_score: null,
        verification_id: null,
        raw_response: {},
        error: err.message || 'Dojah service unreachable.',
        error_code: 'PROVIDER_UNAVAILABLE',
      };
    }
  }

  // ── BVN + Face Verification ─────────────────────────────────────────────────

  async verifyBVNWithFace(payload: BVNFacePayload): Promise<VerificationResult> {
    let base64 = payload.selfieBase64;
    if (!base64 && payload.selfieImageUrl) {
      try {
        const fetchRes = await fetch(payload.selfieImageUrl);
        if (fetchRes.ok) {
          const buf = await fetchRes.arrayBuffer();
          base64 = Buffer.from(buf).toString('base64');
        }
      } catch (err) {}
    }

    if (!base64) {
      return {
        success: false,
        bvnExists: false,
        faceMatch: false,
        matchScore: null,
        returnedName: {},
        providerReference: null,
        rawResponse: {},
        errorCode: 'UNKNOWN_ERROR',
        error: 'Selfie base64 or image URL is required for Dojah.',
      };
    }

    try {
      const rawResult = await this.verifyBVNWithSelfie({
        bvn: payload.bvn,
        selfieBase64: base64,
        customerReference: payload.customerReference,
      });

      const matchScore = extractDojahMatchScore(rawResult) ?? null;
      const bvnExists = Boolean(rawResult.entity?.bvn || rawResult.status);
      const faceMatch = matchScore !== null && matchScore >= 70;
      const providerError = rawResult.status === false || rawResult.error || rawResult.message;
      const errorCode = providerError
        ? this.normalizeHttpError(Number(rawResult.http_status) || 400)
        : faceMatch
          ? undefined
          : 'FACE_MATCH_FAILED';

      return {
        success: bvnExists && faceMatch,
        bvnExists,
        faceMatch,
        matchScore,
        returnedName: {
          firstName: rawResult.entity?.first_name,
          lastName: rawResult.entity?.last_name,
          middleName: rawResult.entity?.middle_name,
        },
        providerReference: rawResult.reference_id || null,
        rawResponse: rawResult,
        errorCode,
        error: providerError
          ? String(rawResult.error || rawResult.message || 'Dojah verification failed.')
          : faceMatch
            ? undefined
            : 'Dojah did not return a passing selfie match score.',
      };
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
        error: err.message || 'Dojah service failed.',
      };
    }
  }

  async verifyBVNWithSelfie(params: {
    bvn: string;
    selfieBase64: string;
    customerReference?: string;
  }): Promise<DojahBVNSelfieResult> {
    if (!this.isConfigured()) {
      throw new Error('Dojah is not configured. Set DOJAH_APP_ID and DOJAH_SECRET_KEY.');
    }

    const url = new URL('/api/v1/kyc/bvn/verify', this.baseUrl);
    if (params.customerReference) {
      url.searchParams.set('customer_reference', params.customerReference);
    }

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        bvn: params.bvn,
        selfie_image: params.selfieBase64,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = typeof json?.message === 'string' ? json.message : `Dojah request failed with ${res.status}`;
      return {
        ...(json as Record<string, unknown>),
        status: false,
        message,
        error: typeof json?.error === 'string' ? json.error : message,
        http_status: res.status,
        reference_id: json?.reference_id,
      } as DojahBVNSelfieResult;
    }

    return json as DojahBVNSelfieResult;
  }

  // ── Business (CAC) Verification ─────────────────────────────────────────────

  async verifyBusiness(payload: BusinessVerificationPayload): Promise<BusinessVerificationResult> {
    try {
      const rawResult = await this.verifyCAC({
        rcNumber: payload.registrationNumber,
        companyName: payload.businessName,
      });

      const data = rawResult?.entity || rawResult;
      const companyName = data?.company_name || data?.companyName || data?.name || null;
      const status = data?.status || data?.registration_status || rawResult?.status || null;

      const personnel: any[] = [];
      const addPersonnel = (arr: any[], role: string) => {
        if (!Array.isArray(arr)) return;
        for (const p of arr) {
          const name = p?.name || p?.fullName || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || '';
          if (name.trim().length > 1) {
            personnel.push({ name: name.trim(), role });
          }
        }
      };

      addPersonnel(data?.directors, 'director');
      addPersonnel(data?.shareholders, 'shareholder');
      addPersonnel(data?.proprietors, 'proprietor');
      addPersonnel(data?.partners, 'partner');
      addPersonnel(data?.trustees, 'trustee');

      return {
        success: Boolean(companyName),
        companyName,
        registrationStatus: status,
        personnel,
        providerReference: rawResult?.reference_id || null,
        rawResponse: rawResult,
      };
    } catch (err: any) {
      return {
        success: false,
        companyName: null,
        registrationStatus: null,
        personnel: [],
        providerReference: null,
        rawResponse: {},
        errorCode: this.normalizeHttpError(err.status || 500),
        error: err.message || 'Dojah CAC lookup failed.',
      };
    }
  }

  async verifyCAC(params: { rcNumber: string; companyName?: string }): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error('Dojah is not configured. Set DOJAH_APP_ID and DOJAH_SECRET_KEY.');
    }

    const url = new URL('/api/v1/kyc/cac', this.baseUrl);
    url.searchParams.set('rc_number', params.rcNumber);
    if (params.companyName) {
      url.searchParams.set('company_name', params.companyName);
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        AppId: this.appId,
        Authorization: this.secretKey,
        Accept: 'application/json',
      },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message =
        typeof json?.error === 'string'
          ? json.error
          : typeof json?.message === 'string'
          ? json.message
          : `Dojah request failed with ${res.status}`;
      throw new Error(message);
    }

    return json;
  }

  // ── Provider Health Monitoring ─────────────────────────────────────────────

  async checkProviderHealth(): Promise<ProviderHealthCheckResult> {
    const start = Date.now();
    try {
      if (!this.isConfigured()) {
        return {
          providerName: 'DOJAH',
          status: 'DISABLED',
          responseTimeMs: 0,
          error: 'Credentials not configured.',
        };
      }

      // Perform a minimal invalid lookup to check if the Dojah API is reachable.
      const res = await fetch(`${this.baseUrl}/api/v1/kyc/cac?rc_number=000000`, {
        method: 'GET',
        headers: {
          AppId: this.appId,
          Authorization: this.secretKey,
          Accept: 'application/json',
        },
      });

      const responseTimeMs = Date.now() - start;

      if (res.status === 402) {
        return {
          providerName: 'DOJAH',
          status: 'DOWN',
          responseTimeMs,
          error: 'Insufficient balance (HTTP 402).',
        };
      }

      if (res.status >= 500) {
        return {
          providerName: 'DOJAH',
          status: 'DOWN',
          responseTimeMs,
          error: `Server error (HTTP ${res.status}).`,
        };
      }

      return {
        providerName: 'DOJAH',
        status: 'ACTIVE',
        responseTimeMs,
      };
    } catch (err: any) {
      return {
        providerName: 'DOJAH',
        status: 'DOWN',
        responseTimeMs: Date.now() - start,
        error: err.message || 'Network unreachable.',
      };
    }
  }

  // ── Error normalization ────────────────────────────────────────────────────

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

export function extractDojahMatchScore(result: DojahBVNSelfieResult): number | null {
  const selfie = result.entity?.selfie_verification;
  const score = selfie?.match_score ?? selfie?.confidence_value;
  if (typeof score !== 'number' || Number.isNaN(score)) return null;
  return score > 1 ? score : score * 100;
}
