import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const { data: merchants, error: err1 } = await supabase
    .from("merchants")
    .select("id, cac_number, owner_name, business_registry_snapshot_id")
    .eq("cac_number", "RC00000000");

  if (err1) {
    console.error("Error fetching merchant", err1);
    return;
  }

  console.log("Merchants found:", merchants?.length);

  for (const m of merchants || []) {
    console.log(`\n--- Merchant ${m.id} (${m.owner_name}) ---`);
    console.log(`Current snapshot ID: ${m.business_registry_snapshot_id}`);

    // Fetch all snapshots for this merchant
    const { data: snapshots, error: err2 } = await supabase
      .from("business_registry_snapshots")
      .select("id, raw_response_encrypted, directors_json")
      .eq("merchant_id", m.id)
      .order("created_at", { ascending: false });

    if (err2) {
      console.error("Error fetching snapshots", err2);
      continue;
    }

    console.log(`Found ${snapshots?.length} snapshots.`);

    for (const s of snapshots || []) {
      console.log(`Snapshot ${s.id}:`);
      const existingDirectors = s.directors_json;
      console.log(`  Current directors_json length:`, Array.isArray(existingDirectors) ? existingDirectors.length : existingDirectors);
      
      const raw = s.raw_response_encrypted;
      let keyPersonnel = [];
      if (raw?.data?.company?.keyPersonnel) {
        keyPersonnel = raw.data.company.keyPersonnel;
      } else if (raw?.data?.keyPersonnel) {
        keyPersonnel = raw.data.keyPersonnel;
      } else if (raw?.keyPersonnel) {
        keyPersonnel = raw.keyPersonnel;
      }

      console.log(`  Raw keyPersonnel found:`, keyPersonnel?.length || 0, "entries");

      if (keyPersonnel?.length > 0) {
        const personnel = [];
        for (const person of keyPersonnel) {
          const name = typeof person?.name === 'string' ? person.name.trim() : '';
          if (!name) continue;
          const designation = String(person?.designation || '').toUpperCase();
          let role = 'director';
          if (designation.includes('SHAREHOLDER')) role = 'shareholder';
          else if (designation.includes('SECRETARY') || designation.includes('SIGNATORY') || designation.includes('WITNESS')) role = 'signatory';
          else if (designation.includes('TRUSTEE')) role = 'trustee';
          else if (designation.includes('PARTNER')) role = 'partner';
          else if (designation.includes('PROPRIETOR')) role = 'proprietor';
          
          personnel.push({ name, role });
        }
        console.log(`  Extracted ${personnel.length} personnel from raw.`);
        console.log(`  Extracted sample:`, personnel.slice(0, 2));
      }
    }

    const { data: dirVerifications } = await supabase
      .from("business_director_verifications")
      .select("*")
      .eq("merchant_id", m.id);

    console.log(`Found ${dirVerifications?.length || 0} business_director_verifications for this merchant.`);
  }
}

run().catch(console.error);
