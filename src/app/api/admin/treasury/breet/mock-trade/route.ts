import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";
import { loadBreetRuntimeConfig, normalizeBreetApiEnvironment } from "@/lib/services/breet-crypto.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type MockTradeRequest = {
  walletAddress?: unknown;
  asset?: unknown;
  amountInUSD?: unknown;
  cryptoReceived?: unknown;
  reference?: unknown;
  txHash?: unknown;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const runtimeConfig = await loadBreetRuntimeConfig(supabase);
  const env = normalizeBreetApiEnvironment(process.env.BREET_ENV || runtimeConfig.apiEnvironment);
  if (env !== "development" || runtimeConfig.apiEnvironment !== "development" || runtimeConfig.liveEnabled) {
    return NextResponse.json(
      { error: "Breet mock trades are only allowed in development mode with live mode disabled." },
      { status: 403 }
    );
  }

  const appId = process.env.BREET_APP_ID;
  const appSecret = process.env.BREET_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ error: "Breet development credentials are not configured." }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as MockTradeRequest | null;
  const validation = await validateRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const baseUrl = process.env.BREET_BASE_URL || "https://api.breet.io/v1";
  try {
    const response = await fetch(`${baseUrl}/trades/sell/mock-trade`, {
      method: "POST",
      headers: {
        "x-app-id": appId,
        "x-app-secret": appSecret,
        "X-Breet-Env": "development",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(validation.payload),
    });
    const providerPayload = await response.json().catch(() => ({}));

    await supabase.from("audit_logs").insert({
      event_type: "breet_sandbox_mock_trade_triggered",
      actor_id: null,
      actor_role: "admin",
      target_id: validation.payload.reference,
      target_type: "breet_mock_trade",
      metadata: {
        wallet_address: validation.payload.walletAddress,
        asset: validation.payload.asset,
        amount_in_usd: validation.payload.amountInUSD,
        crypto_received: validation.payload.cryptoReceived,
        reference: validation.payload.reference,
        tx_hash: validation.payload.txHash,
        provider_status: response.status,
        provider_message: providerMessage(providerPayload),
      },
    });

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      providerMessage: providerMessage(providerPayload),
      webhookExpected: response.ok,
      providerResponse: sanitizeProviderPayload(providerPayload),
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to trigger Breet mock trade.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function validateRequest(body: MockTradeRequest | null) {
  const walletAddress = stringValue(body?.walletAddress);
  const asset = stringValue(body?.asset);
  const amountInUSD = numberValue(body?.amountInUSD);
  const cryptoReceived = numberValue(body?.cryptoReceived);
  const reference = stringValue(body?.reference);
  const txHash = stringValue(body?.txHash);

  if (!walletAddress) return { ok: false as const, error: "walletAddress is required." };
  if (!asset) return { ok: false as const, error: "asset is required." };
  if (!amountInUSD || amountInUSD <= 0) return { ok: false as const, error: "amountInUSD must be greater than 0." };
  if (!cryptoReceived || cryptoReceived <= 0) return { ok: false as const, error: "cryptoReceived must be greater than 0." };
  if (!reference) return { ok: false as const, error: "reference is required." };
  if (!txHash) return { ok: false as const, error: "txHash is required." };

  const [referenceExists, txHashExists] = await Promise.all([
    valueExists(reference),
    valueExists(txHash),
  ]);

  if (referenceExists) return { ok: false as const, error: "reference must be unique." };
  if (txHashExists) return { ok: false as const, error: "txHash must be unique." };

  return {
    ok: true as const,
    payload: { walletAddress, asset, amountInUSD, cryptoReceived, reference, txHash },
  };
}

async function valueExists(value: string) {
  const [sessionRes, cryptoSessionRes, webhookRes] = await Promise.all([
    supabase
      .from("payment_sessions")
      .select("id")
      .or(`provider_reference.eq.${value},internal_reference.eq.${value}`)
      .limit(1),
    supabase
      .from("crypto_payment_sessions")
      .select("id")
      .or(`provider_reference.eq.${value},internal_reference.eq.${value},tx_hash.eq.${value}`)
      .limit(1),
    supabase
      .from("treasury_webhook_logs")
      .select("id")
      .eq("processor_reference", value)
      .limit(1),
  ]);

  return Boolean(
    (sessionRes.data && sessionRes.data.length > 0) ||
      (cryptoSessionRes.data && cryptoSessionRes.data.length > 0) ||
      (webhookRes.data && webhookRes.data.length > 0)
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function providerMessage(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return stringValue(record.message) || stringValue(record.responseMessage) || stringValue(record.status) || "No provider message returned.";
}

function sanitizeProviderPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return payload;
  const record = { ...(payload as Record<string, unknown>) };
  delete record.appSecret;
  delete record.app_secret;
  delete record["x-app-secret"];
  return record;
}
