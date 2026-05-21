import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function seed() {
  console.log("Seeding real blockchain transaction rows in treasury_transactions...");

  const merchantId = "216702a3-7610-4c11-8fa6-bd7553b4d78c";
  const invoiceId = "ee9e181c-1d0f-4969-9d5c-55ba6e40ef25";

  console.log("1. Clearing old logs to avoid duplicate rows...");
  await supabaseAdmin.from("treasury_transactions").delete().neq("status", "non_existent_status_value_to_match_all");

  const sessions = [
    { ref: "BRT-SESS-1", amount: 586.20 },
    { ref: "BRT-SESS-2", amount: 300.00 },
    { ref: "BRT-SESS-3", amount: 150.00 }
  ];

  const sessionIds = [];

  for (const s of sessions) {
    const { data, error } = await supabaseAdmin
      .from("payment_sessions")
      .insert({
        invoice_id: invoiceId,
        merchant_id: merchantId,
        payment_rail: "BREET_CRYPTO",
        source_currency: "USDT",
        destination_currency: "NGN",
        amount_ngn: s.amount * 1450,
        amount_crypto: s.amount,
        exchange_rate: 1450.00,
        wallet_address: "0x981bfda302810ab28dca99b0c2830f829c9910d2",
        reference: s.ref,
        expires_at: new Date(Date.now() + 86400000).toISOString()
      })
      .select("id")
      .single();

    if (error) {
      console.log(`Session already exists for ${s.ref}, fetching it...`);
      const { data: existing } = await supabaseAdmin
        .from("payment_sessions")
        .select("id")
        .eq("reference", s.ref)
        .single();
      sessionIds.push(existing.id);
    } else {
      sessionIds.push(data.id);
    }
  }

  console.log("Resolved Payment Session IDs:", sessionIds);

  console.log("3. Inserting stablecoin offramp rows...");
  const txs = [
    {
      merchant_id: merchantId,
      invoice_id: invoiceId,
      payment_session_id: sessionIds[0],
      blockchain_tx_hash: "0x8fae3256fb7d102e3b6a9a0e817cfa29a1b802611e9a26374a8109d9e6e8e811",
      source_currency: "USDT",
      source_amount: 586.20,
      exchange_rate: 1450.00,
      gross_ngn: 850000,
      platform_fee: 1.50,
      network_fee: 2.00,
      merchant_net_ngn: 845000,
      breet_reference: "BRT-USDT-99180",
      payment_rail: "Ethereum Mainnet (ERC20)",
      status: "SETTLED", // OFFRAMPED
      settlement_reference: "OFFRAMPED"
    },
    {
      merchant_id: merchantId,
      invoice_id: invoiceId,
      payment_session_id: sessionIds[1],
      blockchain_tx_hash: "0x7bbd8826ab5c091f0927815dca89901e82810a9918e9a28b7a23c0a1f0a823a0",
      source_currency: "USDC",
      source_amount: 300.00,
      exchange_rate: 1450.00,
      gross_ngn: 435000,
      platform_fee: 1.50,
      network_fee: 2.00,
      merchant_net_ngn: 430000,
      breet_reference: "BRT-USDC-99201",
      payment_rail: "Ethereum Mainnet (ERC20)",
      status: "BLOCKCHAIN_CONFIRMED", // PENDING_CONFIRMATION
      settlement_reference: "PENDING_CONFIRMATION"
    },
    {
      merchant_id: merchantId,
      invoice_id: invoiceId,
      payment_session_id: sessionIds[2],
      blockchain_tx_hash: "0x12aee891a90c01fa90281fb7cfa901e829a1b80aef8a09bcda3b0a28f89bcada",
      source_currency: "USDT",
      source_amount: 150.00,
      exchange_rate: 1450.00,
      gross_ngn: 217500,
      platform_fee: 1.50,
      network_fee: 2.00,
      merchant_net_ngn: 214000,
      breet_reference: "BRT-USDT-99341",
      payment_rail: "Binance Smart Chain (BEP20)",
      status: "FAILED", // CHAIN_MISMATCH
      settlement_reference: "HELD_IN_TREASURY"
    }
  ];

  const { error } = await supabaseAdmin.from("treasury_transactions").insert(txs);
  if (error) {
    console.error("Error inserting treasury rows:", error.message);
  } else {
    console.log("Successfully inserted all 3 rows into treasury_transactions!");
  }

  console.log("✅ Seeding completed successfully!");
}

seed();
