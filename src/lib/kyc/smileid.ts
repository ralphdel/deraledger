/**
 * DeraLedger — SmileID Provider Stub
 *
 * Future-ready stub. All methods return PROVIDER_NOT_CONFIGURED.
 * Wire up when SmileID credentials are available.
 */

import type {
  ProviderAdapter,
  BVNFacePayload,
  BusinessVerificationPayload,
  VerificationResult,
  BusinessVerificationResult,
  NormalizedVerificationResponse,
  ProviderHealthCheckResult,
} from './types';

export class SmileIDProvider implements ProviderAdapter {
  readonly providerName = 'SMILEID' as const;

  isConfigured(): boolean {
    return false; // Not yet configured
  }

  async verifyBVNWithFace(_payload: BVNFacePayload): Promise<VerificationResult> {
    return {
      success: false,
      bvnExists: false,
      faceMatch: false,
      matchScore: null,
      returnedName: {},
      providerReference: null,
      rawResponse: {},
      errorCode: 'PROVIDER_NOT_CONFIGURED',
      error: 'SmileID is not yet configured. Contact DeraLedger engineering to enable this provider.',
    };
  }

  async verifyBusiness(_payload: BusinessVerificationPayload): Promise<BusinessVerificationResult> {
    return {
      success: false,
      companyName: null,
      registrationStatus: null,
      personnel: [],
      providerReference: null,
      rawResponse: {},
      errorCode: 'PROVIDER_NOT_CONFIGURED',
      error: 'SmileID business verification is not yet configured.',
    };
  }

  async verifySelfie(_payload: { selfieImageUrl?: string; selfieBase64?: string }): Promise<NormalizedVerificationResponse> {
    return {
      status: 'failed',
      verification_type: 'selfie',
      provider: 'SMILEID',
      confidence_score: null,
      verification_id: null,
      raw_response: {},
      error: 'SmileID is not yet configured.',
      error_code: 'PROVIDER_NOT_CONFIGURED',
    };
  }

  async verifyLiveness(_payload: { selfieBase64: string }): Promise<NormalizedVerificationResponse> {
    return {
      status: 'failed',
      verification_type: 'liveness',
      provider: 'SMILEID',
      confidence_score: null,
      verification_id: null,
      raw_response: {},
      error: 'SmileID liveness is not yet configured.',
      error_code: 'PROVIDER_NOT_CONFIGURED',
    };
  }

  async checkProviderHealth(): Promise<ProviderHealthCheckResult> {
    return {
      providerName: 'SMILEID',
      status: 'DISABLED',
      responseTimeMs: 0,
      error: 'SmileID is not configured.',
    };
  }
}
