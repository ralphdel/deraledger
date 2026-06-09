import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log("=== TABLE RLS STATUS AND POLICIES ===");
  
  const tables = [
    'merchants',
    'business_registry_snapshots',
    'business_director_verifications',
    'director_invitations',
    'verification_logs'
  ];

  for (const table of tables) {
    const { data: rlsInfo, error: err1 } = await supabase.rpc('get_rls_status', { table_name: table }).catch(() => ({ data: null, error: 'RPC not available' }));
    
    // If RPC isn't available, we can query pg_tables and pg_policies directly via SQL if we have a way,
    // or we can run a custom query using supabase.
    // Let's run a query against pg_catalog.
    const { data: policies, error: err2 } = await supabase
      .from('pg_policies')
      .select('*')
      .eq('tablename', table)
      .catch(() => ({ data: null, error: 'Direct table query not possible' }));

    console.log(`Table: ${table}`);
    console.log(`- Policies:`, policies || err2);
  }

  // Let's also query pg_policies using custom SQL if possible, or print standard information.
  // Wait, let's run a query on pg_policies via pg_stats or a direct pg query.
  // Let's write a simple query.
  const { data: policyRows, error: pErr } = await supabase.from('pg_policies').select('*').limit(1).catch(() => ({ data: null, error: 'Cannot query pg_policies directly' }));
  console.log("pg_policies query result:", policyRows, pErr);
}

run();
