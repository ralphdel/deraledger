import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  const { data: dirVerifications } = await supabase
    .from('business_director_verifications')
    .select('*')
    .eq('merchant_id', 'bfd66cab-3de2-4493-ad6f-ffdd9289f376');

  if (dirVerifications && dirVerifications.length > 0) {
    const d = dirVerifications[0];
    console.log("Director Verification:");
    console.log("ID:", d.id);
    console.log("director_name:", d.director_name);
    console.log("normalized_response keys:", Object.keys(d.normalized_response));
    console.log("normalized_response.data:", JSON.stringify(d.normalized_response.data, null, 2));
  }
}

run();
