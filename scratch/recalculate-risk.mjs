import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function recalculateDisputeRisk() {
  console.log("Starting platform-wide Risk Index Recalculation Audit...");
  
  // 1. Fetch all disputes
  const { data: disputes, error } = await supabaseAdmin
    .from("payment_disputes")
    .select("*");

  if (error) {
    console.error("Failed to load disputes:", error.message);
    return;
  }

  console.log(`Found ${disputes.length} disputes to evaluate.`);

  for (const d of disputes) {
    console.log(`Evaluating Case ${d.case_id} (${d.payment_rail}, ${d.category}, ₦${d.amount.toLocaleString()})`);
    
    // Baseline points
    let calculatedRisk = 15;
    if (d.payment_rail === "BREET_CRYPTO") {
      calculatedRisk = 50;
    }

    // Size points
    const amt = Number(d.amount);
    if (amt >= 1000000) {
      calculatedRisk += 30;
    } else if (amt >= 100000) {
      calculatedRisk += 15;
    }

    // Category points
    const cat = (d.category || "").toUpperCase();
    if (cat.includes("FRAUD") || cat.includes("UNAUTHORIZED")) {
      calculatedRisk += 30;
    } else if (cat.includes("DUPLICATE") || cat.includes("DOUBLE")) {
      calculatedRisk += 15;
    } else {
      calculatedRisk += 5;
    }

    const finalScore = Math.min(100, Math.max(0, calculatedRisk));
    console.log(`  -> Current Score: ${d.risk_score} | Audited Score: ${finalScore}`);

    // Update the database record
    const { error: updErr } = await supabaseAdmin
      .from("payment_disputes")
      .update({ risk_score: finalScore })
      .eq("id", d.id);

    if (updErr) {
      console.error(`  [ERROR] Failed to update Case ${d.case_id}:`, updErr.message);
    } else {
      console.log(`  [SUCCESS] Case ${d.case_id} risk score locked at ${finalScore}/100.`);
    }
  }

  console.log("✅ Risk Index Recalculation Audit complete!");
}

recalculateDisputeRisk();
