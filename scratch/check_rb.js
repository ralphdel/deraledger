require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("merchant_id", "8e5db888-de92-46d8-bf49-e6f46d8a5f32"); // rblegalaw@gmail.com
    
  console.log("Subscription:", subs);

  const { data: payments } = await supabase
    .from("subscription_payments")
    .select("*")
    .eq("merchant_id", "8e5db888-de92-46d8-bf49-e6f46d8a5f32")
    .order("created_at", { ascending: false });
    
  console.log("Payments:", payments);
}

run();
