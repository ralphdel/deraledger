require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      merchant_id: "9e96ba28-2fda-428c-8fea-b67a68ebbae1",
      plan_type: "individual",
      amount_paid: 5000,
      start_date: new Date().toISOString(),
      expiry_date: new Date().toISOString(),
      status: "active",
      last_notified_at: null,
      is_banner_dismissed: false
    });
    
  console.log("Insert result:", { data, error });
}

run();
