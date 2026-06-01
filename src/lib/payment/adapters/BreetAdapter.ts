import type {
  CryptoDepositAddressParams,
  CryptoDepositAddressResult,
  CryptoTransactionResult,
  WebhookVerificationResult,
} from "../types";

const DEFAULT_BREET_BASE = "https://api.breet.io/v1";

export class BreetAdapter {
  private baseUrl: string;
  private appId: string;
  private appSecret: string;
  private env: string;
  private webhookSecret: string;

  constructor(config?: {
    baseUrl?: string;
    appId?: string;
    appSecret?: string;
    env?: string;
    webhookSecret?: string;
  }) {
    this.baseUrl = config?.baseUrl || process.env.BREET_BASE_URL || DEFAULT_BREET_BASE;
    this.appId = config?.appId || process.env.BREET_APP_ID || "";
    this.appSecret = config?.appSecret || process.env.BREET_APP_SECRET || "";
    this.env = config?.env || process.env.BREET_ENV || "development";
    this.webhookSecret = config?.webhookSecret || process.env.BREET_WEBHOOK_SECRET || "";
  }

  isConfigured() {
    return Boolean(this.appId && this.appSecret);
  }

  private headers() {
    if (!this.isConfigured()) {
      throw new Error("Breet is not configured. Set BREET_APP_ID and BREET_APP_SECRET.");
    }

    return {
      "x-app-id": this.appId,
      "x-app-secret": this.appSecret,
      "X-Breet-Env": this.env,
      "Content-Type": "application/json",
    };
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = typeof json?.message === "string" ? json.message : `Breet API error [${res.status}]`;
      throw new Error(message);
    }
    return json as T;
  }

  async generateAddress(params: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      `/trades/sell/assets/${encodeURIComponent(params.assetId)}/generate-address`,
      { label: params.label }
    );

    return {
      id: String(raw.id || ""),
      vaultId: raw.vaultId ? String(raw.vaultId) : undefined,
      address: String(raw.address || raw.destinationAddress || ""),
      asset: raw.asset ? String(raw.asset) : undefined,
      label: raw.label ? String(raw.label) : params.label,
      raw,
    };
  }

  async initializePayment(params: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    return this.generateAddress(params);
  }

  async fetchTransaction(transactionId: string): Promise<CryptoTransactionResult> {
    const raw = await this.request<Record<string, unknown>>(
      "GET",
      `/transactions/${encodeURIComponent(transactionId)}`
    );

    return {
      id: String(raw.id || transactionId),
      status: raw.status ? String(raw.status) : undefined,
      event: raw.event ? String(raw.event) : undefined,
      asset: raw.asset ? String(raw.asset) : undefined,
      cryptoAmount: typeof raw.cryptoAmount === "number" ? raw.cryptoAmount : undefined,
      amountInUSD: typeof raw.amountInUSD === "number" ? raw.amountInUSD : undefined,
      txHash: raw.txHash ? String(raw.txHash) : undefined,
      raw,
    };
  }

  normalizePaymentResponse(raw: Record<string, unknown>, fallbackLabel?: string) {
    return {
      provider: "breet",
      paymentMethod: "crypto",
      providerReference: String(raw.id || raw.reference || raw.transactionId || ""),
      internalReference: fallbackLabel || String(raw.label || raw.reference || raw.id || ""),
      cryptoAsset: String(raw.asset || raw.currency || raw.coin || ""),
      cryptoNetwork: String(raw.network || raw.chain || raw.protocol || ""),
      cryptoAmountReceived: typeof raw.cryptoAmount === "number" ? raw.cryptoAmount : typeof raw.amount === "number" ? raw.amount : null,
      convertedNgnAmount: typeof raw.amountInNGN === "number" ? raw.amountInNGN : typeof raw.ngnAmount === "number" ? raw.ngnAmount : null,
      conversionRate: typeof raw.exchangeRate === "number" ? raw.exchangeRate : typeof raw.rate === "number" ? raw.rate : null,
      providerFee: typeof raw.providerFee === "number" ? raw.providerFee : null,
      settlementFee: typeof raw.settlementFee === "number" ? raw.settlementFee : null,
      settlementStatus: String(raw.settlementStatus || raw.status || ""),
      raw,
    };
  }

  getProviderHealth() {
    return {
      provider: "breet",
      configured: this.isConfigured(),
      webhookConfigured: Boolean(this.webhookSecret),
      environment: this.env,
      baseUrl: this.baseUrl,
    };
  }

  verifyWebhook(secretHeader: string | null): WebhookVerificationResult {
    if (!this.webhookSecret) {
      return { valid: false, error: "BREET_WEBHOOK_SECRET is not set." };
    }

    if (secretHeader !== this.webhookSecret) {
      return { valid: false, error: "Webhook secret mismatch." };
    }

    return { valid: true };
  }
}
