export const SUPPORTED_CRYPTO_RAILS = ["USDT", "USDC", "BTC", "ETH"] as const;

export type CryptoRail = (typeof SUPPORTED_CRYPTO_RAILS)[number];

export function normalizeCryptoRail(value: string | null | undefined): CryptoRail {
  const upper = String(value || "USDT").toUpperCase();
  if (SUPPORTED_CRYPTO_RAILS.includes(upper as CryptoRail)) {
    return upper as CryptoRail;
  }
  return "USDT";
}

export function defaultNetworkForRail(rail: CryptoRail) {
  switch (rail) {
    case "BTC":
      return "BITCOIN";
    case "ETH":
    case "USDC":
      return "ETHEREUM";
    case "USDT":
    default:
      return "TRON";
  }
}

export function defaultConfirmationsForRail(rail: CryptoRail) {
  switch (rail) {
    case "BTC":
      return 3;
    case "ETH":
    case "USDT":
    case "USDC":
    default:
      return 12;
  }
}

export function rateSettingKeyForRail(rail: CryptoRail) {
  return `crypto_${rail.toLowerCase()}_ngn_rate`;
}

export function confirmationSettingKeyForRail(rail: CryptoRail) {
  return `crypto_${rail.toLowerCase()}_confirmations`;
}

export function toBasisPoints(value: number) {
  return Math.round(value * 10_000);
}

export function withinTolerance(expected: number, actual: number, toleranceBps: number) {
  if (expected <= 0) return false;
  const diff = Math.abs(actual - expected);
  return diff <= expected * (toleranceBps / 10_000);
}

export function computeCryptoAmount(amountNgn: number, exchangeRate: number) {
  if (!Number.isFinite(amountNgn) || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new Error("Invalid crypto pricing inputs.");
  }
  return Number((amountNgn / exchangeRate).toFixed(8));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readProviderNumber(raw: Record<string, unknown>, keys: string[]) {
  const data = asRecord(raw.data);
  const quote = asRecord(raw.quote);
  const pricing = asRecord(raw.pricing);
  const candidates = [raw, data, quote, pricing];

  for (const source of candidates) {
    for (const key of keys) {
      const value = positiveNumber(source[key]);
      if (value !== null) return value;
    }
  }

  return null;
}

function ceilCryptoAmount(value: number) {
  return Math.ceil(value * 100_000_000) / 100_000_000;
}

export function resolveBreetCheckoutQuote(input: {
  amountNgn: number;
  fallbackExchangeRate: number;
  providerRaw?: Record<string, unknown> | null;
  fallbackBufferBps?: number;
}) {
  const amountNgn = Number(input.amountNgn);
  const fallbackExchangeRate = Number(input.fallbackExchangeRate);
  if (!Number.isFinite(amountNgn) || amountNgn <= 0 || !Number.isFinite(fallbackExchangeRate) || fallbackExchangeRate <= 0) {
    throw new Error("Invalid Breet quote inputs.");
  }

  const raw = asRecord(input.providerRaw);
  const providerRate = readProviderNumber(raw, [
    "rate",
    "exchangeRate",
    "conversionRate",
    "ngnRate",
    "fiatRate",
  ]);
  const providerCryptoAmount = readProviderNumber(raw, [
    "cryptoAmount",
    "amountInUSD",
    "amountUsd",
    "amountUSD",
    "cryptoReceived",
    "amount",
  ]);

  if (providerCryptoAmount !== null) {
    return {
      cryptoAmount: providerCryptoAmount,
      exchangeRate: providerRate ?? Number((amountNgn / providerCryptoAmount).toFixed(2)),
      quoteSource: "breet_provider_quote" as const,
      providerQuoteAvailable: true,
      fallbackBufferBps: 0,
    };
  }

  if (providerRate !== null) {
    return {
      cryptoAmount: ceilCryptoAmount(amountNgn / providerRate),
      exchangeRate: providerRate,
      quoteSource: "breet_provider_rate" as const,
      providerQuoteAvailable: true,
      fallbackBufferBps: 0,
    };
  }

  const fallbackBufferBps = Number.isFinite(input.fallbackBufferBps) && Number(input.fallbackBufferBps) >= 0
    ? Number(input.fallbackBufferBps)
    : 300;
  const bufferedRate = fallbackExchangeRate * Math.max(0.01, 1 - fallbackBufferBps / 10_000);

  return {
    cryptoAmount: ceilCryptoAmount(amountNgn / bufferedRate),
    exchangeRate: Number(bufferedRate.toFixed(2)),
    quoteSource: "buffered_platform_estimate" as const,
    providerQuoteAvailable: false,
    fallbackBufferBps,
  };
}
