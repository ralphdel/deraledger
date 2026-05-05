require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("merchant_id, created_at, start_date")
    .is("created_at", null);
    
  console.log("Subscriptions with null created_at:", data);
}

run();
