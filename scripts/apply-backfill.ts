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

  for (const m of merchants || []) {
    console.log(`\n--- Merchant ${m.id} (${m.owner_name}) ---`);

    const { data: snapshots, error: err2 } = await supabase
      .from("business_registry_snapshots")
      .select("id, raw_response_encrypted, directors_json")
      .eq("merchant_id", m.id)
      .order("created_at", { ascending: false });

    if (err2) {
      console.error("Error fetching snapshots", err2);
      continue;
    }

    for (const s of snapshots || []) {
      const raw = s.raw_response_encrypted;
      let keyPersonnel = [];
      if (raw?.data?.company?.keyPersonnel) {
        keyPersonnel = raw.data.company.keyPersonnel;
      } else if (raw?.data?.keyPersonnel) {
        keyPersonnel = raw.data.keyPersonnel;
      } else if (raw?.keyPersonnel) {
        keyPersonnel = raw.keyPersonnel;
      }

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
        
        console.log(`Updating snapshot ${s.id} with ${personnel.length} directors.`);
        const { error: updErr } = await supabase
          .from("business_registry_snapshots")
          .update({ directors_json: personnel })
          .eq("id", s.id);
          
        if (updErr) console.error("Error updating snapshot:", updErr);
        else console.log("Snapshot updated successfully.");
      }
    }
  }
}

run().catch(console.error);
