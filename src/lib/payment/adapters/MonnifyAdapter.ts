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

// Monnify account enquiry uses MONNIFY_BASE_URL; only switch to production
// when the environment is intentionally updated.
const MONNIFY_BASE = process.env.MONNIFY_BASE_URL || "https://sandbox.monnify.com";

type MonnifyAuthResponse = {
  requestSuccessful: boolean;
  responseBody?: {
    accessToken?: string;
  };
};

type MonnifyBank = {
  name?: string;
  code?: string;
  bankCode?: string;
};

type MonnifyAccountValidation = {
  accountName?: string;
  accountNumber?: string;
};

type MonnifySubaccountResponse = {
  subAccountCode?: string;
  accountNumber?: string;
  accountName?: string;
  bankCode?: string;
  bankName?: string;
  currencyCode?: string;
  defaultSplitPercentage?: number;
  email?: string;
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

  private async authorizedRequest<T>(path: string, body?: unknown) {
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

  private async authorizedGet<T>(path: string) {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${MONNIFY_BASE}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
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
    const redirectUrl = normalizeMonnifyRedirectUrl(p.callbackUrl);
    const paymentPurpose = String(p.metadata.payment_purpose || p.metadata.type || "").toLowerCase();
    const requiresMerchantSplit = MONNIFY_MERCHANT_COLLECTION_PURPOSES.has(paymentPurpose);
    const forbidsMerchantSplit = MONNIFY_PLATFORM_PAYMENT_PURPOSES.has(paymentPurpose);

    if (requiresMerchantSplit && (!p.incomeSplitConfig || p.incomeSplitConfig.length === 0)) {
      throw new Error(
        "Payment setup is not ready for this payout account. Please add another bank account or choose another payment method."
      );
    }

    if (forbidsMerchantSplit && p.incomeSplitConfig && p.incomeSplitConfig.length > 0) {
      throw new Error("Monnify platform payments must not include merchant income split configuration.");
    }

    const body: Record<string, unknown> = {
      amount: p.amountKobo / 100,
      customerName: String(p.metadata.business_name || p.metadata.trading_name || p.email),
      customerEmail: p.email,
      paymentReference: p.reference,
      paymentDescription: String(p.metadata.type || "DeraLedger payment"),
      redirectUrl,
      currencyCode: "NGN",
      contractCode: this.contractCode,
      paymentMethods: [p.paymentMethod === "bank_transfer" ? "ACCOUNT_TRANSFER" : p.paymentMethod === "ussd" ? "USSD" : "CARD"],
      metaData: p.metadata,
    };

    if (p.incomeSplitConfig && p.incomeSplitConfig.length > 0) {
      body.incomeSplitConfig = p.incomeSplitConfig;
    }

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
    try {
      const data = await this.authorizedGet<Record<string, unknown>>(
        `/api/v2/transactions/${encodeURIComponent(reference)}`
      );
      return this.normalizeTransaction(data);
    } catch (transactionReferenceError) {
      try {
        const params = new URLSearchParams({ paymentReference: reference });
        const data = await this.authorizedGet<Record<string, unknown>>(
          `/api/v2/merchant/transactions/query?${params.toString()}`
        );
        return this.normalizeTransaction(data);
      } catch {
        throw transactionReferenceError;
      }
    }
  }

  private normalizeTransaction(data: Record<string, unknown>) {
    const paymentStatus = String(data.paymentStatus || data.status || "").toUpperCase();
    const amountPaid = Number(data.amountPaid ?? data.amount ?? data.totalPayable ?? 0);
    const settlementAmount = Number(data.settlementAmount ?? 0);
    const rawMetadata = data.metaData ?? data.metadata ?? {};
    const metadata =
      typeof rawMetadata === "string"
        ? this.safeJsonParse(rawMetadata)
        : (rawMetadata as Record<string, unknown>);

    return {
      ...data,
      status: paymentStatus === "PAID" || paymentStatus === "SUCCESS" ? "success" : paymentStatus.toLowerCase(),
      amount: Math.round(amountPaid * 100),
      fees:
        settlementAmount > 0 && settlementAmount <= amountPaid
          ? Math.round((amountPaid - settlementAmount) * 100)
          : undefined,
      settlementAmount:
        settlementAmount > 0 && settlementAmount <= amountPaid
          ? Math.round(settlementAmount * 100)
          : undefined,
      metadata,
      reference: data.paymentReference || data.transactionReference || data.reference,
      provider_reference: data.transactionReference || data.paymentReference || data.reference,
    };
  }

  async createSubaccount(p: SubaccountParams): Promise<SubaccountResult> {
    const email = String(p.primaryContactEmail || "").trim();
    if (!email) {
      throw new Error("Monnify subaccount setup requires a contact email.");
    }

    const body = [
      {
        bankCode: p.bankCode,
        accountNumber: p.accountNumber,
        accountName: p.accountName || p.primaryContactName || p.businessName,
        currencyCode: p.currencyCode || "NGN",
        email,
        defaultSplitPercentage: p.defaultSplitPercentage ?? 100,
      },
    ];

    const response = await this.authorizedRequest<MonnifySubaccountResponse[] | MonnifySubaccountResponse>(
      "/api/v1/sub-accounts",
      body
    );
    const data = Array.isArray(response) ? response[0] : response;

    if (!data?.subAccountCode) {
      throw new Error("Monnify did not return a sub account code.");
    }

    return {
      subaccountCode: data.subAccountCode,
      businessName: p.businessName,
      accountNumber: data.accountNumber || p.accountNumber,
      accountName: data.accountName || p.accountName || p.primaryContactName || p.businessName,
      settlementBank: data.bankName || data.bankCode || p.bankCode,
      providerReference: data.subAccountCode,
      raw: data as Record<string, unknown>,
    };
  }

  async updateSubaccount(code: string, p: Partial<SubaccountParams>): Promise<SubaccountResult> {
    if (!code) {
      throw new Error("Monnify subaccount code is required.");
    }

    const payload: Record<string, unknown> = {
      bankCode: p.bankCode,
      accountNumber: p.accountNumber,
      accountName: p.accountName || p.primaryContactName || p.businessName,
      currencyCode: p.currencyCode || "NGN",
      email: p.primaryContactEmail,
      defaultSplitPercentage: p.defaultSplitPercentage ?? 100,
    };

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === null || payload[key] === "") {
        delete payload[key];
      }
    });

    const data = await this.authorizedRequest<MonnifySubaccountResponse>(
      `/api/v1/sub-accounts/${encodeURIComponent(code)}`,
      payload
    );

    return {
      subaccountCode: data.subAccountCode || code,
      businessName: p.businessName || p.primaryContactName || "Monnify Settlement Account",
      accountNumber: data.accountNumber || p.accountNumber || "",
      accountName: data.accountName || p.accountName || p.primaryContactName || undefined,
      settlementBank: data.bankName || data.bankCode || p.bankCode || "",
      providerReference: data.subAccountCode || code,
      raw: data as Record<string, unknown>,
    };
  }

  async getBankList(): Promise<BankListItem[]> {
    const banks = await this.authorizedGet<MonnifyBank[]>("/api/v1/banks");
    return banks
      .map((bank) => ({
        name: String(bank.name || "").trim(),
        code: String(bank.code || bank.bankCode || "").trim(),
      }))
      .filter((bank) => bank.name && bank.code);
  }

  async resolveAccountNumber(bankCode: string, accountNumber: string): Promise<AccountResolutionResult> {
    if (!bankCode) throw new Error("Bank code is required.");
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new Error("Account number must be exactly 10 digits.");
    }

    const params = new URLSearchParams({ accountNumber, bankCode });
    const data = await this.authorizedGet<MonnifyAccountValidation>(
      `/api/v1/disbursements/account/validate?${params.toString()}`
    );

    if (!data.accountName || !data.accountNumber) {
      throw new Error("Monnify did not return a valid account name.");
    }

    return {
      accountName: data.accountName,
      accountNumber: data.accountNumber,
    };
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

const MONNIFY_MERCHANT_COLLECTION_PURPOSES = new Set([
  "invoice_payment",
  "customer_invoice",
  "merchant_collection",
  "payment_link",
]);

const MONNIFY_PLATFORM_PAYMENT_PURPOSES = new Set([
  "plan_subscription",
  "plan_upgrade",
  "plan_renewal",
  "subscription",
  "subscription_renewal",
  "subscription_upgrade",
  "upgrade_payment",
  "renewal_payment",
  "platform_billing",
  "account_setup",
]);

function normalizeMonnifyRedirectUrl(callbackUrl: string) {
  try {
    const url = new URL(callbackUrl);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return callbackUrl.split("?")[0] || callbackUrl;
  }
}
