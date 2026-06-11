import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MERCHANT_ID = 'bfd66cab-3de2-4493-ad6f-ffdd9289f376';

async function run() {
  console.log('=== CONFIRMATION CHECK ===\n');

  // 1. Merchant live_features_enabled (payment lock)
  const { data: merchant } = await sb
    .from('merchants')
    .select('id, business_name, verification_status, live_features_enabled, setup_mode, subscription_plan, merchant_tier, business_affiliation_status, cac_number')
    .eq('id', MERCHANT_ID)
    .single();

  console.log('--- MERCHANT ---');
  console.log('  verification_status:', merchant?.verification_status);
  console.log('  live_features_enabled:', merchant?.live_features_enabled);
  console.log('  setup_mode:', merchant?.setup_mode);
  console.log('  business_affiliation_status:', merchant?.business_affiliation_status);
  console.log('  subscription_plan:', merchant?.subscription_plan);
  console.log('  cac_number:', merchant?.cac_number);
  console.log('  PAYMENT COLLECTION LOCKED:', merchant?.live_features_enabled !== true ? 'YES ✅' : 'NO ❌');

  // 2. Peter Doe director verification record
  const { data: dirs } = await sb
    .from('business_director_verifications')
    .select('id, director_name, verification_status, face_match_score, manual_review_required, admin_notes, invitation_id, provider_name')
    .eq('merchant_id', MERCHANT_ID);

  console.log('\n--- DIRECTOR VERIFICATIONS ---');
  if (!dirs || dirs.length === 0) {
    console.log('  None found.');
  } else {
    dirs.forEach(d => {
      console.log(`  Name: ${d.director_name}`);
      console.log(`  Status: ${d.verification_status}`);
      console.log(`  Manual review required: ${d.manual_review_required}`);
      console.log(`  Face match score: ${d.face_match_score}`);
      console.log(`  Provider: ${d.provider_name}`);
      console.log(`  invitation_id: ${d.invitation_id || 'NULL (unlinked)'}`);
      console.log(`  Admin notes: ${d.admin_notes}`);
      console.log(`  IS manual_review (not verified): ${d.verification_status !== 'verified' ? 'YES ✅' : 'NO ❌'}`);
    });
  }

  // 3. Director invitations status
  const { data: invites } = await sb
    .from('director_invitations')
    .select('id, selected_director_name, director_email, status')
    .eq('merchant_id', MERCHANT_ID);

  console.log('\n--- DIRECTOR INVITATIONS ---');
  if (!invites || invites.length === 0) {
    console.log('  None found.');
  } else {
    invites.forEach(i => {
      console.log(`  Name: ${i.selected_director_name}`);
      console.log(`  Email: ${i.director_email}`);
      console.log(`  Status: ${i.status}`);
      console.log(`  Is NOT set to verified by system (still approved/not verified): ${i.status !== 'verified' ? 'YES ✅' : 'Status is: ' + i.status}`);
    });
  }

  // 4. Registry snapshot + directors_json count
  const { data: snap } = await sb
    .from('business_registry_snapshots')
    .select('id, provider_name, registered_name, registration_number, directors_json')
    .eq('merchant_id', MERCHANT_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log('\n--- REGISTRY SNAPSHOT ---');
  if (!snap) {
    console.log('  NOT FOUND ❌');
  } else {
    console.log(`  ID: ${snap.id}`);
    console.log(`  Provider: ${snap.provider_name}`);
    console.log(`  Registered Name: ${snap.registered_name}`);
    console.log(`  Registration Number: ${snap.registration_number}`);
    const djLen = Array.isArray(snap.directors_json) ? snap.directors_json.length : 0;
    console.log(`  directors_json count: ${djLen} ${djLen > 0 ? '✅' : '❌'}`);
    if (djLen > 0) {
      const unique = [...new Map(snap.directors_json.map(p => [`${p.name}|${p.role || p.designation}`, p])).values()];
      console.log(`  Unique after dedup: ${unique.length}`);
      unique.forEach((p, i) => console.log(`    ${i+1}. ${p.name} — ${p.role || p.designation || 'DIRECTOR'}`));
    }
  }

  // 5. Verification logs provider
  const { data: logs } = await sb
    .from('verification_logs')
    .select('id, verification_type, provider_name, status')
    .eq('merchant_id', MERCHANT_ID)
    .order('created_at', { ascending: false });

  console.log('\n--- VERIFICATION LOGS ---');
  logs?.forEach(l => {
    console.log(`  Type: ${l.verification_type} | Provider: ${l.provider_name} | Status: ${l.status}`);
  });
}

run().catch(console.error);
