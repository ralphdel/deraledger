// PurpLedger — PaymentService Singleton
// Reads PAYMENT_PROVIDER env var to select the correct adapter.
// Import this — never import an adapter directly.

import { PaystackAdapter } from "./adapters/PaystackAdapter";
import { BreetAdapter } from "./adapters/BreetAdapter";
import { MonnifyAdapter } from "./adapters/MonnifyAdapter";
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
  BreetBankListItem,
  BreetBankValidationResult,
  BreetIntegrationBankResult,
  CryptoTransactionResult,
} from "./types";

type SupportedFiatProvider = "paystack" | "monnify";

function createProcessor(provider = (process.env.PAYMENT_PROVIDER ?? "paystack")): IPaymentProcessor {
  if (provider === "paystack") {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) {
      throw new Error(
        "PAYSTACK_SECRET_KEY is not set. Add it to .env.local and Vercel environment variables."
      );
    }
    return new PaystackAdapter(key);
  }

  if (provider === "monnify") {
    const apiKey = process.env.MONNIFY_API_KEY;
    const secretKey = process.env.MONNIFY_SECRET_KEY;
    const contractCode = process.env.MONNIFY_CONTRACT_CODE;
    if (!apiKey || !secretKey || !contractCode) {
      throw new Error(
        "Monnify is not configured. Set MONNIFY_API_KEY, MONNIFY_SECRET_KEY, and MONNIFY_CONTRACT_CODE."
      );
    }
    return new MonnifyAdapter(apiKey, secretKey, contractCode);
  }

  throw new Error(
    `Unknown PAYMENT_PROVIDER: "${provider}". Supported: "paystack", "monnify"`
  );
}

// Lazily initialised singleton — avoids creating an instance at module parse time
// which would throw if env vars aren't available during static analysis.
let _processor: IPaymentProcessor | null = null;
let _breet: BreetAdapter | null = null;
const _providers = new Map<SupportedFiatProvider, IPaymentProcessor>();

function getProcessor(): IPaymentProcessor {
  if (!_processor) {
    _processor = createProcessor();
  }
  return _processor;
}

function getProcessorFor(provider: SupportedFiatProvider): IPaymentProcessor {
  const cached = _providers.get(provider);
  if (cached) {
    return cached;
  }
  const created = createProcessor(provider);
  _providers.set(provider, created);
  return created;
}

function getBreetProcessor(): BreetAdapter {
  if (!_breet) {
    _breet = new BreetAdapter();
  }
  return _breet;
}

function createBreetProcessor(env?: "development" | "production"): BreetAdapter {
  if (!env) {
    return getBreetProcessor();
  }

  return new BreetAdapter({ env });
}

// ── Public PaymentService API ──────────────────────────────────────────────────
// Consumers call these. They never know which adapter is running underneath.

export const PaymentService = {
  initializeTransaction(p: TransactionParams, provider?: SupportedFiatProvider): Promise<TransactionResult> {
    return provider ? getProcessorFor(provider).initializeTransaction(p) : getProcessor().initializeTransaction(p);
  },

  verifyTransaction(reference: string, provider?: SupportedFiatProvider): Promise<Record<string, unknown>> {
    return provider ? getProcessorFor(provider).verifyTransaction(reference) : getProcessor().verifyTransaction(reference);
  },

  createSubaccount(p: SubaccountParams, provider?: SupportedFiatProvider): Promise<SubaccountResult> {
    return provider ? getProcessorFor(provider).createSubaccount(p) : getProcessor().createSubaccount(p);
  },

  updateSubaccount(code: string, p: Partial<SubaccountParams>, provider?: SupportedFiatProvider): Promise<SubaccountResult> {
    return provider ? getProcessorFor(provider).updateSubaccount(code, p) : getProcessor().updateSubaccount(code, p);
  },

  getBankList(country?: string, provider?: SupportedFiatProvider): Promise<BankListItem[]> {
    return provider ? getProcessorFor(provider).getBankList(country) : getProcessor().getBankList(country);
  },

  resolveAccountNumber(bankCode: string, accountNumber: string, provider?: SupportedFiatProvider): Promise<AccountResolutionResult> {
    return provider ? getProcessorFor(provider).resolveAccountNumber(bankCode, accountNumber) : getProcessor().resolveAccountNumber(bankCode, accountNumber);
  },

  verifyWebhook(payload: unknown, signature: string, provider?: SupportedFiatProvider): WebhookVerificationResult {
    return provider ? getProcessorFor(provider).verifyWebhook(payload, signature) : getProcessor().verifyWebhook(payload, signature);
  },

  generateCryptoDepositAddress(p: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    return createBreetProcessor(p.providerEnvironment).generateAddress(p);
  },

  generateInvoicePaymentAddress(p: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    return createBreetProcessor(p.providerEnvironment).generateInvoicePaymentAddress(p);
  },

  generatePlatformPaymentAddress(p: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    return createBreetProcessor(p.providerEnvironment).generatePlatformPaymentAddress(p);
  },

  initializeCryptoPayment(p: CryptoDepositAddressParams): Promise<CryptoDepositAddressResult> {
    return createBreetProcessor(p.providerEnvironment).initializePayment(p);
  },

  fetchCryptoTransaction(transactionId: string): Promise<CryptoTransactionResult> {
    return getBreetProcessor().fetchTransaction(transactionId);
  },

  normalizeBreetPaymentResponse(raw: Record<string, unknown>, fallbackLabel?: string) {
    return getBreetProcessor().normalizePaymentResponse(raw, fallbackLabel);
  },

  normalizeBreetWebhookPayload(raw: Record<string, unknown>) {
    return getBreetProcessor().normalizeWebhookPayload(raw);
  },

  verifyBreetWebhook(secretHeader: string | null): WebhookVerificationResult {
    return getBreetProcessor().verifyWebhook(secretHeader);
  },

  verifyBreetWebhookSignature(request: Request): WebhookVerificationResult {
    return getBreetProcessor().verifyWebhookSignature(request);
  },

  getBreetProviderHealth() {
    return getBreetProcessor().getProviderHealth();
  },

  fetchBreetBanks(currency?: string, env?: "development" | "production"): Promise<BreetBankListItem[]> {
    return createBreetProcessor(env).fetchBanks(currency);
  },

  validateBreetBankAccount(
    input: { bankId: string; accountNumber: string },
    env?: "development" | "production"
  ): Promise<BreetBankValidationResult> {
    return createBreetProcessor(env).validateBankAccount(input);
  },

  addBreetIntegrationBank(input: {
    bankId: string;
    accountNumber: string;
    narration: string;
  }, env?: "development" | "production"): Promise<BreetIntegrationBankResult> {
    return createBreetProcessor(env).addIntegrationBank(input);
  },

  fetchSavedBreetIntegrationBanks(env?: "development" | "production"): Promise<BreetIntegrationBankResult[]> {
    return createBreetProcessor(env).fetchSavedIntegrationBanks();
  },
} as const;
