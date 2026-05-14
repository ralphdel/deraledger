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
  [key: string]: unknown;
};

export class DojahProvider {
  private baseUrl: string;
  private appId: string;
  private secretKey: string;

  constructor() {
    this.baseUrl = process.env.DOJAH_BASE_URL || "https://sandbox.dojah.io";
    this.appId = process.env.DOJAH_APP_ID || "";
    this.secretKey = process.env.DOJAH_SECRET_KEY || "";
  }

  isConfigured() {
    return Boolean(this.appId && this.secretKey);
  }

  async verifyBVNWithSelfie(params: {
    bvn: string;
    selfieBase64: string;
    customerReference?: string;
  }): Promise<DojahBVNSelfieResult> {
    if (!this.isConfigured()) {
      throw new Error("Dojah is not configured. Set DOJAH_APP_ID and DOJAH_SECRET_KEY.");
    }

    const url = new URL("/api/v1/kyc/bvn/verify", this.baseUrl);
    if (params.customerReference) {
      url.searchParams.set("customer_reference", params.customerReference);
    }

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        AppId: this.appId,
        Authorization: this.secretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bvn: params.bvn,
        selfie_image: params.selfieBase64,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = typeof json?.message === "string" ? json.message : `Dojah request failed with ${res.status}`;
      throw new Error(message);
    }

    return json as DojahBVNSelfieResult;
  }
}

export function extractDojahMatchScore(result: DojahBVNSelfieResult): number | null {
  const selfie = result.entity?.selfie_verification;
  const score = selfie?.match_score ?? selfie?.confidence_value;
  if (typeof score !== "number" || Number.isNaN(score)) return null;
  return score > 1 ? score : score * 100;
}
