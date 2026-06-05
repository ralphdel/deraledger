import type {
  BreetBankListItem,
  BreetBankValidationResult,
  BreetIntegrationBankResult,
  CryptoDepositAddressParams,
  CryptoDepositAddressResult,
  CryptoSettlementBankPayload,
  CryptoTransactionResult,
  WebhookVerificationResult,
} from "../types";
import { normalizeBreetApiEnvironment } from "@/lib/services/breet-crypto.service";

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
    this.env = normalizeBreetApiEnvironment(config?.env || process.env.BREET_ENV || process.env.PAYMENT_ENVIRONMENT);
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

  private async request<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
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

  private extractWalletId(raw: Record<string, unknown>) {
    const data = this.asRecord(raw.data);
    return String(
      raw.walletId ||
      raw.wallet_id ||
      raw.vaultId ||
      data.walletId ||
      data.wallet_id ||
      data.vaultId ||
      raw.id ||
      data.id ||
      ""
    );
  }

  private extractWalletAddress(raw: Record<string, unknown>) {
    const data = this.asRecord(raw.data);
    return String(
      raw.address ||
      raw.destinationAddress ||
      raw.walletAddress ||
      data.address ||
      data.destinationAddress ||
      data.walletAddress ||
      ""
    );
  }

  private asRecord(value: unknown) {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  private normalizeBankList(raw: unknown): BreetBankListItem[] {
    const bankRows = Array.isArray(raw)
      ? raw
      : Array.isArray(this.asRecord(raw).data)
        ? (this.asRecord(raw).data as unknown[])
        : Array.isArray(this.asRecord(raw).banks)
          ? (this.asRecord(raw).banks as unknown[])
          : [];

    return bankRows.map((row) => {
      const record = this.asRecord(row);
      return {
        id: String(record.id || ""),
        name: String(record.name || record.bankName || ""),
        currency: typeof record.currency === "string" ? record.currency : undefined,
        type: typeof record.type === "string" ? record.type : undefined,
        slug: typeof record.slug === "string" ? record.slug : undefined,
        redbillerCode: typeof record.redbillerCode === "string" ? record.redbillerCode : null,
        anchorCode: typeof record.anchorCode === "string" ? record.anchorCode : null,
        monnifyCode: typeof record.monnifyCode === "string" ? record.monnifyCode : null,
        palmpayCode: typeof record.palmpayCode === "string" ? record.palmpayCode : null,
        avatar: typeof record.avatar === "string" ? record.avatar : null,
      };
    }).filter((bank) => bank.id && bank.name);
  }

  private normalizeIntegrationBank(raw: Record<string, unknown>): BreetIntegrationBankResult {
    const data = this.asRecord(raw.data);
    return {
      id: String(raw.id || data.id || raw.walletId || data.walletId || ""),
      bankId: String(raw.bankId || data.bankId || raw.id || data.id || ""),
      bankName: typeof (raw.bankName || data.bankName) === "string" ? String(raw.bankName || data.bankName) : null,
      accountNumber: String(raw.accountNumber || data.accountNumber || ""),
      accountName: typeof (raw.accountName || data.accountName) === "string" ? String(raw.accountName || data.accountName) : null,
      narration: typeof (raw.narration || data.narration) === "string" ? String(raw.narration || data.narration) : null,
      autoSettlement: typeof (raw.autoSettlement || data.autoSettlement) === "boolean"
        ? Boolean(raw.autoSettlement || data.autoSettlement)
        : undefined,
      raw,
    };
  }

  private normalizeSellAssets(raw: unknown) {
    const rows = Array.isArray(raw)
      ? raw
      : Array.isArray(this.asRecord(raw).data)
        ? (this.asRecord(raw).data as unknown[])
        : [];

    return rows.map((row) => {
      const record = this.asRecord(row);
      return {
        id: String(record.id || record._id || ""),
        symbol: String(record.symbol || ""),
        identifier: typeof record.identifier === "string" ? record.identifier : "",
        name: String(record.name || ""),
        type: typeof record.type === "string" ? record.type : "",
        isActive: record.isActive !== false,
      };
    }).filter((asset) => asset.id && asset.symbol);
  }

  private matchesPreferredNetwork(asset: { identifier: string; name: string; type: string }, network?: string | null) {
    const normalized = String(network || "").trim().toUpperCase();
    const haystack = `${asset.identifier} ${asset.name} ${asset.type}`.toUpperCase();

    if (normalized === "TRON") return haystack.includes("TRON") || haystack.includes("TRC20") || haystack.includes("TRX");
    if (normalized === "ETHEREUM") return haystack.includes("ETH") || haystack.includes("ERC20") || haystack.includes("SEPOLIA");
    if (normalized === "BITCOIN") return haystack.includes("BTC") || haystack.includes("BITCOIN");

    return false;
  }

  private async resolveSellAssetId(assetId: string, network?: string | null) {
    const rawAssetId = String(assetId || "").trim();
    if (!rawAssetId) {
      throw new Error("Breet asset id is required.");
    }

    // Already looks like a provider id or an environment-specific identifier.
    if (/^[0-9a-f]{24}$/i.test(rawAssetId) || rawAssetId.includes("_")) {
      return rawAssetId;
    }

    const assetsRaw = await this.request<Record<string, unknown> | unknown[]>("GET", "/trades/sell/assets");
    const assets = this.normalizeSellAssets(assetsRaw).filter((asset) => asset.isActive);
    const matches = assets.filter((asset) => asset.symbol.toUpperCase() === rawAssetId.toUpperCase());
    if (matches.length === 0) {
      return rawAssetId;
    }

    const preferred = matches.find((asset) => this.matchesPreferredNetwork(asset, network));
    return (preferred || matches[0]).id;
  }

  private shouldEnableAutoSettlement(params: CryptoDepositAddressParams) {
    return params.settlementMode === "breet_auto_settlement" || params.settlementMode === "platform_auto_settlement";
  }

  private sanitizeLabel(label: string) {
    const normalized = String(label || "")
      .trim()
      .replace(/[^A-Za-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return normalized.slice(0, 100) || "breet-payment";
  }

  private sanitizeNarration(narration?: string | null) {
    return String(narration || "").trim().slice(0, 32);
  }

  private toGenerateAddressBody(params: CryptoDepositAddressParams, settlementBank: CryptoSettlementBankPayload | null) {
    return {
      label: this.sanitizeLabel(params.label),
      ...(settlementBank ? {
        bankId: settlementBank.bankId,
        accountNumber: settlementBank.accountNumber,
        narration: this.sanitizeNarration(settlementBank.narration),
      } : {}),
    };
  }

  async generateAddress(params: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    const settlementBank = params.settlementBank || null;
    const resolvedAssetId = await this.resolveSellAssetId(params.assetId, params.network);
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      `/trades/sell/assets/${encodeURIComponent(resolvedAssetId)}/generate-address`,
      this.toGenerateAddressBody(params, settlementBank)
    );
    const walletId = this.extractWalletId(raw);
    const address = this.extractWalletAddress(raw);
    let autoSettlementEnabled = false;
    let autoSettlementResponse: Record<string, unknown> | null = null;

    if (settlementBank && walletId && this.shouldEnableAutoSettlement(params)) {
      autoSettlementResponse = await this.request<Record<string, unknown>>(
        "PUT",
        `/trades/wallets/${encodeURIComponent(walletId)}/auto-settlement`,
        { autoSettlement: true }
      );
      autoSettlementEnabled = true;
    }
    const providerRaw = autoSettlementResponse
      ? { ...raw, autoSettlementResponse }
      : raw;

    return {
      id: walletId || String(raw.id || ""),
      vaultId: raw.vaultId ? String(raw.vaultId) : undefined,
      walletId: walletId || undefined,
      address,
      asset: raw.asset ? String(raw.asset) : params.assetId,
      label: raw.label ? String(raw.label) : params.label,
      settlementBankId: settlementBank?.bankId,
      settlementAccountMasked: settlementBank?.accountNumberMasked || null,
      autoSettlementEnabled,
      raw: providerRaw,
    };
  }

  async initializePayment(params: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    return this.generateAddress(params);
  }

  async generateInvoicePaymentAddress(params: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    return this.generateAddress({ ...params, paymentType: "invoice", settlementRecipientType: "merchant" });
  }

  async generatePlatformPaymentAddress(params: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    return this.generateAddress({
      ...params,
      paymentType: params.paymentType || "subscription",
      settlementRecipientType: "platform",
    });
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

  async fetchBanks(currency = "ngn"): Promise<BreetBankListItem[]> {
    const raw = await this.request<Record<string, unknown> | unknown[]>(
      "GET",
      `/payments/banks?currency=${encodeURIComponent(currency)}`
    );
    return this.normalizeBankList(raw);
  }

  async validateBankAccount(input: { bankId: string; accountNumber: string }): Promise<BreetBankValidationResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      "/payments/banks/validate",
      {
        id: input.bankId,
        accountNumber: input.accountNumber,
      }
    );
    const data = this.asRecord(raw.data);

    return {
      bankId: String(raw.id || data.id || input.bankId),
      accountNumber: String(raw.accountNumber || data.accountNumber || input.accountNumber),
      accountName: typeof (raw.accountName || data.accountName) === "string" ? String(raw.accountName || data.accountName) : null,
      bankName: typeof (raw.bankName || data.bankName) === "string" ? String(raw.bankName || data.bankName) : null,
      raw,
    };
  }

  async addIntegrationBank(input: {
    bankId: string;
    accountNumber: string;
    narration: string;
  }): Promise<BreetIntegrationBankResult> {
    const raw = await this.request<Record<string, unknown>>(
      "POST",
      "/payments/banks/add",
      {
        id: input.bankId,
        accountNumber: input.accountNumber,
        narration: input.narration,
      }
    );
    return this.normalizeIntegrationBank(raw);
  }

  async fetchSavedIntegrationBanks(): Promise<BreetIntegrationBankResult[]> {
    const raw = await this.request<Record<string, unknown> | unknown[]>(
      "GET",
      "/payments/integration-banks"
    );
    const rows = Array.isArray(raw)
      ? raw
      : Array.isArray(this.asRecord(raw).data)
        ? (this.asRecord(raw).data as unknown[])
        : [];

    return rows.map((row) => this.normalizeIntegrationBank(this.asRecord(row))).filter((bank) => bank.bankId || bank.id);
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

  normalizeWebhookPayload(payload: Record<string, unknown>) {
    return this.normalizePaymentResponse(payload, typeof payload.label === "string" ? payload.label : undefined);
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

  verifyWebhookSignature(request: Request): WebhookVerificationResult {
    const secretHeader = request.headers.get("x-webhook-secret") || request.headers.get("x-breet-webhook-secret");
    return this.verifyWebhook(secretHeader);
  }
}
