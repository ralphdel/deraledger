import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  console.log("=== INSPECTING COLUMNS ===");

  const tables = ["verification_logs", "business_director_verifications", "director_verifications"];

  for (const table of tables) {
    const { data, error } = await supabase
      .from("pg_attribute")
      .select("attname")
      .eq("attrelid", `${table}` as any); // using RPC or raw schema query if possible

    // Let's do a direct select of 1 row to get the keys as columns
    const { data: rows, error: selectError } = await supabase
      .from(table)
      .select("*")
      .limit(1);

    if (selectError) {
      console.error(`Error querying table ${table}:`, selectError.message);
    } else {
      console.log(`\nTable ${table} columns (from keys):`);
      if (rows && rows.length > 0) {
        console.log(Object.keys(rows[0]));
      } else {
        console.log("No rows in table to extract keys from. Querying one dummy insert to test schema...");
        // Try inserting a dummy row with a non-existent column name to see what columns it complains about, or query postgres catalog
      }
    }
  }

  // Let's query postgres catalog columns using an RPC or a system view if accessible
  const { data: cols, error: colError } = await supabase
    .rpc("get_columns", { table_name: "verification_logs" }) // checking if an rpc exists
    .catch(() => ({ data: null, error: { message: "RPC get_columns not found" } }));
    
  console.log("RPC get_columns result:", cols, colError);
}

run().catch(console.error);
