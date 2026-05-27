import type {
  AccountResolutionResult,
  BankListItem,
  IPaymentProcessor,
  SubaccountParams,
  SubaccountResult,
  TransactionParams,
  TransactionResult,
  WebhookVerificationResult,
} from "../types";
import crypto from "crypto";

const MONNIFY_BASE = process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com";

type MonnifyAuthResponse = {
  requestSuccessful: boolean;
  responseBody?: {
    accessToken?: string;
  };
};

export class MonnifyAdapter implements IPaymentProcessor {
  constructor(
    private readonly apiKey: string,
    private readonly secretKey: string,
    private readonly contractCode: string
  ) {}

  private async getAccessToken() {
    const token = Buffer.from(`${this.apiKey}:${this.secretKey}`).toString("base64");
    const response = await fetch(`${MONNIFY_BASE}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
      },
    });

    const payload = (await response.json().catch(() => ({}))) as MonnifyAuthResponse;
    const accessToken = payload.responseBody?.accessToken;

    if (!response.ok || !accessToken) {
      throw new Error("Monnify authentication failed.");
    }

    return accessToken;
  }

  private async authorizedRequest<T>(path: string, body?: Record<string, unknown>) {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${MONNIFY_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      requestSuccessful?: boolean;
      responseBody?: T;
      responseMessage?: string;
    };

    if (!response.ok || payload.requestSuccessful === false || !payload.responseBody) {
      throw new Error(payload.responseMessage || "Monnify request failed.");
    }

    return payload.responseBody;
  }

  async initializeTransaction(p: TransactionParams): Promise<TransactionResult> {
    const body: Record<string, unknown> = {
      amount: p.amountKobo / 100,
      customerName: String(p.metadata.business_name || p.metadata.trading_name || p.email),
      customerEmail: p.email,
      paymentReference: p.reference,
      paymentDescription: String(p.metadata.type || "DeraLedger payment"),
      redirectUrl: p.callbackUrl,
      currencyCode: "NGN",
      contractCode: this.contractCode,
      paymentMethods: [p.paymentMethod === "bank_transfer" ? "ACCOUNT_TRANSFER" : p.paymentMethod === "ussd" ? "USSD" : "CARD"],
      metaData: p.metadata,
    };

    const data = await this.authorizedRequest<{
      checkoutUrl?: string;
      paymentReference?: string;
      transactionReference?: string;
    }>("/api/v1/merchant/transactions/init-transaction", body);

    if (!data.checkoutUrl || !data.paymentReference) {
      throw new Error("Monnify did not return a checkout URL.");
    }

    return {
      authorizationUrl: data.checkoutUrl,
      reference: data.paymentReference,
      accessCode: data.transactionReference || data.paymentReference,
    };
  }

  async verifyTransaction(reference: string): Promise<Record<string, unknown>> {
    const accessToken = await this.getAccessToken();
    const response = await fetch(
      `${MONNIFY_BASE}/api/v2/transactions/${encodeURIComponent(reference)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const payload = (await response.json().catch(() => ({}))) as {
      requestSuccessful?: boolean;
      responseBody?: Record<string, unknown>;
      responseMessage?: string;
    };

    if (!response.ok || payload.requestSuccessful === false || !payload.responseBody) {
      throw new Error(payload.responseMessage || "Monnify verification failed.");
    }

    return this.normalizeTransaction(payload.responseBody);
  }

  private normalizeTransaction(data: Record<string, unknown>) {
    const paymentStatus = String(data.paymentStatus || data.status || "").toUpperCase();
    const amountPaid = Number(data.amountPaid ?? data.amount ?? data.totalPayable ?? 0);
    const rawMetadata = data.metaData ?? data.metadata ?? {};
    const metadata =
      typeof rawMetadata === "string"
        ? this.safeJsonParse(rawMetadata)
        : (rawMetadata as Record<string, unknown>);

    return {
      ...data,
      status: paymentStatus === "PAID" || paymentStatus === "SUCCESS" ? "success" : paymentStatus.toLowerCase(),
      amount: Math.round(amountPaid * 100),
      metadata,
      reference: data.paymentReference || data.transactionReference || data.reference,
      provider_reference: data.transactionReference || data.paymentReference || data.reference,
    };
  }

  async createSubaccount(_p: SubaccountParams): Promise<SubaccountResult> {
    throw new Error("Monnify subaccount provisioning is not wired yet.");
  }

  async updateSubaccount(_code: string, _p: Partial<SubaccountParams>): Promise<SubaccountResult> {
    throw new Error("Monnify subaccount updates are not wired yet.");
  }

  async getBankList(): Promise<BankListItem[]> {
    throw new Error("Monnify bank list is not wired yet.");
  }

  async resolveAccountNumber(_bankCode: string, _accountNumber: string): Promise<AccountResolutionResult> {
    throw new Error("Monnify account resolution is not wired yet.");
  }

  verifyWebhook(payload: unknown, signature: string): WebhookVerificationResult {
    const secret = process.env.MONNIFY_WEBHOOK_SECRET || this.secretKey;
    if (!secret) {
      return { valid: false, error: "MONNIFY_WEBHOOK_SECRET or MONNIFY_SECRET_KEY is not configured." };
    }

    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const expected = crypto.createHmac("sha512", secret).update(body).digest("hex");
    const received = signature.trim().toLowerCase();

    if (!received) {
      return { valid: false, error: "Missing Monnify signature." };
    }

    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(received, "utf8");
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return { valid: false, error: "Monnify signature mismatch." };
    }

    return { valid: true };
  }

  private safeJsonParse(value: string) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }
}
