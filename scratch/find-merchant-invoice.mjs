import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findIds() {
  const { data: merchants } = await supabaseAdmin.from("merchants").select("id").limit(1);
  const { data: invoices } = await supabaseAdmin.from("invoices").select("id, merchant_id").limit(1);
  const { data: sessions } = await supabaseAdmin.from("payment_sessions").select("id").limit(1);

  console.log("Merchant:", merchants?.[0]);
  console.log("Invoice:", invoices?.[0]);
  console.log("Session:", sessions?.[0]);
}

findIds();
