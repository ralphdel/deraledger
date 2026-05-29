export type ProviderSettlementCalculation = {
  providerFee: number | null;
  expectedSettlement: number | null;
  settlementStatus: "processing" | "manual_review";
  providerFeeSource: "provider_settlement_amount" | "provider_fee" | "provider_missing";
  expectedSettlementSource: "provider_settlement_amount" | "provider_fee" | "provider_missing";
};

type FeePayer = "business" | "customer" | string | null | undefined;

export function calculateProviderReportedSettlement(input: {
  grossAmount: number;
  feePayer: FeePayer;
  providerFeesKobo?: number | null;
  providerSettlementAmountKobo?: number | null;
}): ProviderSettlementCalculation {
  const grossAmount = roundMoney(input.grossAmount);
  const providerSettlementAmount = koboToNaira(input.providerSettlementAmountKobo);

  if (providerSettlementAmount !== null && providerSettlementAmount >= 0 && providerSettlementAmount <= grossAmount) {
    return {
      providerFee: roundMoney(Math.max(0, grossAmount - providerSettlementAmount)),
      expectedSettlement: providerSettlementAmount,
      settlementStatus: "processing",
      providerFeeSource: "provider_settlement_amount",
      expectedSettlementSource: "provider_settlement_amount",
    };
  }

  const providerFee = koboToNaira(input.providerFeesKobo);
  if (providerFee !== null && providerFee >= 0) {
    return {
      providerFee,
      expectedSettlement:
        input.feePayer === "customer"
          ? grossAmount
          : roundMoney(Math.max(0, grossAmount - providerFee)),
      settlementStatus: "processing",
      providerFeeSource: "provider_fee",
      expectedSettlementSource: "provider_fee",
    };
  }

  return {
    providerFee: null,
    expectedSettlement: null,
    settlementStatus: "manual_review",
    providerFeeSource: "provider_missing",
    expectedSettlementSource: "provider_missing",
  };
}

function koboToNaira(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return roundMoney(value / 100);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
