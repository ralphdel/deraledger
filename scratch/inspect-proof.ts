import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const merchantId = "bfd66cab-3de2-4493-ad6f-ffdd9289f376";
  
  console.log("=== INSPECTING PROOF FOR MERCHANT ===");
  
  // 1. Fetch Merchant
  const { data: merchant } = await supabase
    .from("merchants")
    .select("*")
    .eq("id", merchantId)
    .single();
  console.log("Merchant:", {
    id: merchant?.id,
    business_name: merchant?.business_name,
    owner_name: merchant?.owner_name,
    verification_status: merchant?.verification_status,
    business_registry_snapshot_id: merchant?.business_registry_snapshot_id,
    cac_number: merchant?.cac_number,
    cac_status: merchant?.cac_status,
    bvn_status: merchant?.bvn_status,
    selfie_status: merchant?.selfie_status,
  });

  // 2. Fetch Snapshots
  const { data: snapshots } = await supabase
    .from("business_registry_snapshots")
    .select("*")
    .eq("merchant_id", merchantId);
  console.log(`\nSnapshots count: ${snapshots?.length}`);
  snapshots?.forEach(s => {
    console.log("Snapshot:", {
      id: s.id,
      merchant_id: s.merchant_id,
      cac_number: s.registration_number,
      directors_json: s.directors_json,
    });
  });

  // 3. Fetch Invitations
  const { data: invitations } = await supabase
    .from("director_invitations")
    .select("*")
    .eq("merchant_id", merchantId);
  console.log(`\nInvitations count: ${invitations?.length}`);
  invitations?.forEach(i => {
    console.log("Invitation:", {
      id: i.id,
      selected_director_name: i.selected_director_name,
      director_email: i.director_email,
      status: i.status,
      created_at: i.created_at,
    });
  });

  // 4. Fetch Affiliations
  const { data: affiliations } = await supabase
    .from("business_affiliations")
    .select("*")
    .eq("merchant_id", merchantId);
  console.log(`\nAffiliations count: ${affiliations?.length}`);
  affiliations?.forEach(a => {
    console.log("Affiliation:", {
      id: a.id,
      status: a.status,
      matched_registry_name: a.matched_registry_name,
    });
  });

  // 5. Fetch Director Verifications
  const { data: dirVerifications } = await supabase
    .from("business_director_verifications")
    .select("*")
    .eq("merchant_id", merchantId);
  console.log(`\nDirector Verifications count: ${dirVerifications?.length}`);
  dirVerifications?.forEach(d => {
    console.log("Director Verification:", {
      id: d.id,
      invitation_id: d.invitation_id,
      director_name: d.director_name,
      director_role: d.director_role,
      verification_status: d.verification_status,
      face_match_score: d.face_match_score,
      masked_bvn: d.masked_bvn,
      verification_id: d.verification_id,
    });
  });

  // 6. Fetch Verification Logs (last 10)
  const { data: logs } = await supabase
    .from("verification_logs")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false });
  console.log(`\nVerification Logs count: ${logs?.length}`);
  logs?.slice(0, 10).forEach(l => {
    console.log("Log:", {
      id: l.id,
      verification_type: l.verification_type,
      verification_subject: l.verification_subject,
      status: l.status,
      provider: l.provider,
      metadata: l.metadata,
      created_at: l.created_at,
    });
  });
}

run().catch(console.error);
