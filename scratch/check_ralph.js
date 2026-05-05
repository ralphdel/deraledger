require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("merchant_id")
    .eq("merchant_id", "9e96ba28-2fda-428c-8fea-b67a68ebbae1");
    
  console.log("Total subs for ralph:", data.length);
  console.log(data);
}

run();
