import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTreasury() {
  const { data, error } = await supabaseAdmin.from("treasury_transactions").select("*").limit(5);
  console.log("Treasury Transactions:", data);
  console.log("Error:", error);
}

checkTreasury();
