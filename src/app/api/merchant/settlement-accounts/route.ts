import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProviderReadiness, type ProviderReadiness, type SettlementProvider } from "@/lib/services/settlement-ledger.service";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const merchantId = await resolveCurrentMerchantId(supabase);

  if (!merchantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("merchant_settlement_accounts")
    .select(`
      *,
      merchant_provider_settlement_accounts(*)
    `)
    .eq("merchant_id", merchantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    accounts: (data || []).map(sanitizeSettlementAccountRecord),
  });
}

async function resolveCurrentMerchantId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: owned } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (owned?.id) return owned.id as string;

  const { data: teamRow } = await supabase
    .from("merchant_team")
    .select("merchant_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (teamRow?.merchant_id as string | undefined) || null;
}

function sanitizeSettlementAccountRecord(account: Record<string, unknown>) {
  const providerMappings = Array.isArray(account.merchant_provider_settlement_accounts)
    ? account.merchant_provider_settlement_accounts
    : account.merchant_provider_settlement_accounts
      ? [account.merchant_provider_settlement_accounts]
      : [];

  return {
    ...account,
    account_number: maskAccountNumber(stringValue(account.account_number)),
    merchant_provider_settlement_accounts: providerMappings.map(sanitizeProviderMapping),
    provider_readiness: providerMappings.map((mapping) => buildProviderReadiness(mapping)),
  };
}

function sanitizeProviderMapping(mapping: Record<string, unknown>) {
  return {
    provider_name: stringValue(mapping.provider_name),
    status: stringValue(mapping.status),
    environment: stringValue(mapping.environment),
  };
}

function buildProviderReadiness(mapping: Record<string, unknown>): ProviderReadiness {
  const provider = asSettlementProvider(stringValue(mapping.provider_name));
  return getProviderReadiness(
    provider,
    {
      provider_name: stringValue(mapping.provider_name),
      provider_account_reference: stringValue(mapping.provider_account_reference),
      provider_subaccount_code: stringValue(mapping.provider_subaccount_code),
      provider_split_reference: stringValue(mapping.provider_split_reference),
      status: stringValue(mapping.status),
      environment: stringValue(mapping.environment),
      raw_provider_response: asRecord(mapping.raw_provider_response),
      last_sync_at: stringValue(mapping.last_sync_at),
    }
  );
}

function asSettlementProvider(value: string | null): SettlementProvider {
  if (value === "paystack" || value === "monnify" || value === "breet") {
    return value;
  }
  return "paystack";
}

function maskAccountNumber(accountNumber?: string | null) {
  if (!accountNumber) return null;
  if (accountNumber.startsWith("****")) return accountNumber;
  const last4 = accountNumber.slice(-4) || "----";
  return `****${last4}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
