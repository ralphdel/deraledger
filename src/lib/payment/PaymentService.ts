// PurpLedger — PaymentService Singleton
// Reads PAYMENT_PROVIDER env var to select the correct adapter.
// Import this — never import an adapter directly.

import { PaystackAdapter } from "./adapters/PaystackAdapter";
import { BreetAdapter } from "./adapters/BreetAdapter";
import type {
  IPaymentProcessor,
  TransactionParams,
  TransactionResult,
  SubaccountParams,
  SubaccountResult,
  BankListItem,
  AccountResolutionResult,
  WebhookVerificationResult,
  CryptoDepositAddressParams,
  CryptoDepositAddressResult,
  CryptoTransactionResult,
} from "./types";

function createProcessor(): IPaymentProcessor {
  const provider = process.env.PAYMENT_PROVIDER ?? "paystack";

  if (provider === "paystack") {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) {
      throw new Error(
        "PAYSTACK_SECRET_KEY is not set. Add it to .env.local and Vercel environment variables."
      );
    }
    return new PaystackAdapter(key);
  }

  // Future: add Monnify adapter here
  // if (provider === "monnify") { ... }

  throw new Error(
    `Unknown PAYMENT_PROVIDER: "${provider}". Supported: "paystack"`
  );
}

// Lazily initialised singleton — avoids creating an instance at module parse time
// which would throw if env vars aren't available during static analysis.
let _processor: IPaymentProcessor | null = null;
let _breet: BreetAdapter | null = null;

function getProcessor(): IPaymentProcessor {
  if (!_processor) {
    _processor = createProcessor();
  }
  return _processor;
}

function getBreetProcessor(): BreetAdapter {
  if (!_breet) {
    _breet = new BreetAdapter();
  }
  return _breet;
}

// ── Public PaymentService API ──────────────────────────────────────────────────
// Consumers call these. They never know which adapter is running underneath.

export const PaymentService = {
  initializeTransaction(p: TransactionParams): Promise<TransactionResult> {
    return getProcessor().initializeTransaction(p);
  },

  verifyTransaction(reference: string): Promise<Record<string, unknown>> {
    return getProcessor().verifyTransaction(reference);
  },

  createSubaccount(p: SubaccountParams): Promise<SubaccountResult> {
    return getProcessor().createSubaccount(p);
  },

  updateSubaccount(code: string, p: Partial<SubaccountParams>): Promise<SubaccountResult> {
    return getProcessor().updateSubaccount(code, p);
  },

  getBankList(country?: string): Promise<BankListItem[]> {
    return getProcessor().getBankList(country);
  },

  resolveAccountNumber(bankCode: string, accountNumber: string): Promise<AccountResolutionResult> {
    return getProcessor().resolveAccountNumber(bankCode, accountNumber);
  },

  verifyWebhook(payload: unknown, signature: string): WebhookVerificationResult {
    return getProcessor().verifyWebhook(payload, signature);
  },

  generateCryptoDepositAddress(p: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    return getBreetProcessor().generateAddress(p);
  },

  fetchCryptoTransaction(transactionId: string): Promise<CryptoTransactionResult> {
    return getBreetProcessor().fetchTransaction(transactionId);
  },

  verifyBreetWebhook(secretHeader: string | null): WebhookVerificationResult {
    return getBreetProcessor().verifyWebhook(secretHeader);
  },
} as const;
