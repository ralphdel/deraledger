// PurpLedger — PaymentService Type Definitions
// The ONLY file in the codebase that defines the payment processor interface.
// Any call to a payment gateway must go through this abstraction.

export interface TransactionParams {
  email: string;
  amountKobo: number; // Always in kobo (1 NGN = 100 kobo)
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
  subaccountCode?: string; // ACCT_xxx — for Collection Invoice splits
  bearer?: "account" | "subaccount"; // Who bears Paystack fee
}

export interface TransactionResult {
  authorizationUrl: string;
  reference: string;
  accessCode: string;
}

export interface SubaccountParams {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  percentageCharge: number; // 0 = merchant gets 100%
  settlementSchedule?: "auto" | "weekly" | "monthly" | "manual";
  primaryContactEmail?: string;
  primaryContactName?: string;
}

export interface SubaccountResult {
  subaccountCode: string; // ACCT_xxx
  businessName: string;
  accountNumber: string;
  settlementBank: string;
}

export interface BankListItem {
  name: string;
  code: string; // 3-digit bank code used for resolving accounts
  longCode?: string;
  type?: string;
}

export interface AccountResolutionResult {
  accountName: string;
  accountNumber: string;
  bankId?: number;
}

export interface WebhookVerificationResult {
  valid: boolean;
  error?: string;
}

export interface CryptoDepositAddressParams {
  assetId: string;
  label: string;
}

export interface CryptoDepositAddressResult {
  id: string;
  vaultId?: string;
  address: string;
  asset?: string;
  label?: string;
  raw?: Record<string, unknown>;
}

export interface CryptoTransactionResult {
  id: string;
  status?: string;
  event?: string;
  asset?: string;
  cryptoAmount?: number;
  amountInUSD?: number;
  txHash?: string;
  raw?: Record<string, unknown>;
}

export interface IPaymentProcessor {
  initializeTransaction(p: TransactionParams): Promise<TransactionResult>;
  verifyTransaction(reference: string): Promise<Record<string, unknown>>;
  createSubaccount(p: SubaccountParams): Promise<SubaccountResult>;
  updateSubaccount(code: string, p: Partial<SubaccountParams>): Promise<SubaccountResult>;
  getBankList(country?: string): Promise<BankListItem[]>;
  resolveAccountNumber(bankCode: string, accountNumber: string): Promise<AccountResolutionResult>;
  verifyWebhook(payload: unknown, signature: string): WebhookVerificationResult;
}
