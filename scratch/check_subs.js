require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("merchant_id, amount_paid, start_date, expiry_date, status, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
    
  console.log("Latest subscriptions:");
  console.log(JSON.stringify(data, null, 2));
}

run();
