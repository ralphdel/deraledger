import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function run() {
  console.log("=== TESTING ANON CLIENT QUERY ===");
  const { data, error } = await supabase
    .from('business_registry_snapshots')
    .select('*')
    .limit(5);

  if (error) {
    console.error("Anon query error:", error);
  } else {
    console.log("Anon query success, rows returned:", data.length);
    if (data.length > 0) {
      console.log("First row ID:", data[0].id);
    }
  }
}

run();
