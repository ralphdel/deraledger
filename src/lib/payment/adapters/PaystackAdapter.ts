// PurpLedger — Paystack Adapter
// The ONLY file in the codebase that knows Paystack exists.
// Never import this directly. Use PaymentService instead.

import crypto from "crypto";
import type {
  IPaymentProcessor,
  TransactionParams,
  TransactionResult,
  SubaccountParams,
  SubaccountResult,
  BankListItem,
  AccountResolutionResult,
  WebhookVerificationResult,
} from "../types";

const PAYSTACK_BASE = "https://api.paystack.co";

export class PaystackAdapter implements IPaymentProcessor {
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown
  ): Promise<T> {
    const res = await fetch(`${PAYSTACK_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json();

    if (!res.ok || !json.status) {
      throw new Error(
        `Paystack API error [${res.status}] ${path}: ${json.message || "Unknown error"}`
      );
    }

    return json.data as T;
  }

  async initializeTransaction(p: TransactionParams): Promise<TransactionResult> {
    const payload: Record<string, unknown> = {
      email: p.email,
      amount: p.amountKobo,
      reference: p.reference,
      callback_url: p.callbackUrl,
      metadata: p.metadata,
    };

    if (p.subaccountCode) {
      payload.subaccount = p.subaccountCode;
      payload.bearer = p.bearer ?? "account";
    }

    const data = await this.request<{
      authorization_url: string;
      reference: string;
      access_code: string;
    }>("POST", "/transaction/initialize", payload);

    return {
      authorizationUrl: data.authorization_url,
      reference: data.reference,
      accessCode: data.access_code,
    };
  }

  async verifyTransaction(reference: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      "GET",
      `/transaction/verify/${encodeURIComponent(reference)}`
    );
  }

  async createSubaccount(p: SubaccountParams): Promise<SubaccountResult> {
    const data = await this.request<{
      subaccount_code: string;
      business_name: string;
      account_number: string;
      settlement_bank: string;
    }>("POST", "/subaccount", {
      business_name: p.businessName,
      settlement_bank: p.bankCode,
      account_number: p.accountNumber,
      percentage_charge: p.percentageCharge,
      settlement_schedule: p.settlementSchedule ?? "auto",
      primary_contact_email: p.primaryContactEmail,
      primary_contact_name: p.primaryContactName,
    });

    return {
      subaccountCode: data.subaccount_code,
      businessName: data.business_name,
      accountNumber: data.account_number,
      settlementBank: data.settlement_bank,
    };
  }

  async updateSubaccount(
    code: string,
    p: Partial<SubaccountParams>
  ): Promise<SubaccountResult> {
    const payload: Record<string, unknown> = {};
    if (p.businessName) payload.business_name = p.businessName;
    if (p.bankCode) payload.settlement_bank = p.bankCode;
    if (p.accountNumber) payload.account_number = p.accountNumber;
    if (p.percentageCharge !== undefined) payload.percentage_charge = p.percentageCharge;
    if (p.settlementSchedule) payload.settlement_schedule = p.settlementSchedule;

    const data = await this.request<{
      subaccount_code: string;
      business_name: string;
      account_number: string;
      settlement_bank: string;
    }>("PUT", `/subaccount/${code}`, payload);

    return {
      subaccountCode: data.subaccount_code,
      businessName: data.business_name,
      accountNumber: data.account_number,
      settlementBank: data.settlement_bank,
    };
  }

  async getBankList(country = "nigeria"): Promise<BankListItem[]> {
    const data = await this.request<
      { name: string; code: string; longcode?: string; type?: string }[]
    >("GET", `/bank?country=${country}&perPage=100`);

    return data.map((b) => ({
      name: b.name,
      code: b.code,
      longCode: b.longcode,
      type: b.type,
    }));
  }

  async resolveAccountNumber(
    bankCode: string,
    accountNumber: string
  ): Promise<AccountResolutionResult> {
    const data = await this.request<{
      account_name: string;
      account_number: string;
      bank_id?: number;
    }>(
      "GET",
      `/bank/resolve?bank_code=${encodeURIComponent(bankCode)}&account_number=${encodeURIComponent(accountNumber)}`
    );

    return {
      accountName: data.account_name,
      accountNumber: data.account_number,
      bankId: data.bank_id,
    };
  }

  verifyWebhook(payload: unknown, signature: string): WebhookVerificationResult {
    try {
      const body =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      const hash = crypto
        .createHmac("sha512", this.secretKey)
        .update(body)
        .digest("hex");

      if (hash !== signature) {
        return { valid: false, error: "Signature mismatch" };
      }
      return { valid: true };
    } catch (err: unknown) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Signature verification failed",
      };
    }
  }
}
