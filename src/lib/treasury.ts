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
